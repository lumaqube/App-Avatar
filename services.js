// Starts the local AI servers the assistant needs, as child processes:
//   whisper-server (speech to text, whisper.cpp) and llama-server (the LLM, llama.cpp).
// Each one is skipped when its exe or model is missing, or when config gives a
// "url" of a server that is already running elsewhere. They stop with us.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from './tts.js';
import { ensureParts, ensureGpuParts } from './setup.js';

const abs = p => path.isAbsolute(p) ? p : path.join(ROOT, p);
const children = [];

export const services = {
  stt: { name: 'speech-to-text', state: 'off', url: null, error: null },
  llm: { name: 'LLM', state: 'off', url: null, error: null },
};

// Resolves when the server is ready or has failed (svc.state tells which).
function start(key, exe, args, url, healthPath, tries) {
  const svc = services[key];
  svc.url = url;
  fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
  const log = fs.createWriteStream(path.join(ROOT, 'logs', key + '.log'));
  const p = spawn(abs(exe), args, { cwd: path.dirname(abs(exe)), windowsHide: true });
  p.stdout.pipe(log);
  p.stderr.pipe(log);
  children.push(p);
  svc.state = 'starting';
  p.on('error', err => { svc.state = 'failed'; svc.error = err.message; });
  p.on('close', code => { if (svc.state !== 'stopped' && svc.proc === p) { svc.state = 'failed'; svc.error = `exited ${code}, see logs/${key}.log`; } });
  svc.proc = p;
  return waitReady(svc, url + healthPath, tries).then(() => {
    if (svc.state === 'failed') p.kill();
  });
}

async function waitReady(svc, url, tries = 240) {
  for (let i = 0; i < tries && svc.state === 'starting'; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (r.ok) {
        if (svc === services.llm) await warmUp(svc);
        svc.state = 'ready';
        console.log(`${svc.name}: ready at ${svc.url}`);
        return;
      }
    } catch { }
    await new Promise(r => setTimeout(r, 500));
  }
  if (svc.state === 'starting') { svc.state = 'failed'; svc.error = 'did not become ready'; }
}

// The first request on a fresh llama-server (Vulkan) is very slow: it builds
// its GPU pipelines then (about a minute). Do that now, with a prompt the size
// of a real turn and a tool, so the first guest gets a quick answer.
async function warmUp(svc) {
  svc.state = 'warming';
  const t0 = Date.now();
  try {
    await fetch(svc.url + '/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(300000),
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'Kamu asisten photobooth yang ramah. '.repeat(60) },
          { role: 'user', content: 'Halo, aku mau foto.' },
        ],
        tools: [{ type: 'function', function: { name: 'start_session', description: 'Mulai sesi foto.', parameters: { type: 'object', properties: {} } } }],
        max_tokens: 8, chat_template_kwargs: { enable_thinking: false },
      }),
    });
    console.log(`${svc.name}: warmed up in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  } catch (err) {
    console.log(`${svc.name}: warm-up failed (${err.message}), carrying on`);
  }
}

// Which GPU llama.cpp should use. A laptop shows the integrated GPU too
// ("Vulkan0: Intel(R) UHD Graphics"); left alone, llama.cpp may split the model
// onto it. Pick the discrete GPU with the most free memory; none -> CPU.
async function listDevices(exe) {
  const out = await runAsync(abs(exe), ['--list-devices']);
  return [...out.matchAll(/^\s*(\w+\d+): (.+?) \((\d+) MiB, (\d+) MiB free\)/gm)]
    .map(m => ({ id: m[1], name: m[2], free: +m[4] }));
}
function pickDevice(devs) {
  const discrete = devs.filter(d => !/UHD|Iris|Intel\(R\) Graphics|Radeon\(TM\) Graphics|Vega \d+ Graphics/i.test(d.name));
  const best = discrete.sort((a, b) => b.free - a.free)[0];
  if (best) console.log(`LLM device: ${best.id} ${best.name} (${best.free} MiB free)`);
  else console.log('LLM device: none found, running on the CPU');
  return best?.id || 'none';
}

const whisperArgs = (stt, audioCtx) => [
  '--host', '127.0.0.1', '--port', String(stt.port), '-l', 'auto',
  // Speed: greedy decoding, no timestamps, and no temperature fallback (on noisy
  // audio the fallback re-decodes again and again: one line once took over 30 s).
  '-bo', '1', '-nt', '-nf',
  // Whisper always encodes a 30 s window; a guest's question is under 12 s (mic.js
  // stops there), so on the CPU a 640-frame (12.8 s) context is about twice as fast.
  // Not for large-v3-turbo: a short context makes it repeat itself; on a GPU the
  // full window is quick anyway.
  '-ac', String(audioCtx),
];

// Speech to text: the big, accurate model (large-v3-turbo) on an NVIDIA GPU when
// that build is installed, else (or if it fails) the small model on the CPU.
async function startStt(stt, devices) {
  const has = p => p && fs.existsSync(abs(p));
  const url = `http://127.0.0.1:${stt.port}`;
  const nvidia = devices.some(d => /nvidia|geforce|rtx|quadro/i.test(d.name));
  if (stt.useGpu !== false && nvidia && has(stt.gpuExe) && has(stt.gpuModel)) {
    services.stt.name = `speech-to-text (GPU, ${path.basename(stt.gpuModel)})`;
    await start('stt', stt.gpuExe, ['-m', abs(stt.gpuModel), '-t', '4', ...whisperArgs(stt, stt.gpuAudioCtx ?? 0)], url, '/', 120);
    // A CUDA build missing a DLL runs on the CPU without a word: the big model then
    // takes ~18 s a sentence. Its log says "no GPU found"; use the small model instead.
    const log = fs.readFileSync(path.join(ROOT, 'logs', 'stt.log'), 'utf8');
    if (services.stt.state === 'ready' && /no GPU found/i.test(log)) {
      services.stt.state = 'stopped';
      services.stt.proc.kill();
      services.stt.error = 'the GPU build found no GPU';
      await new Promise(r => setTimeout(r, 500)); // let the port go
    }
    if (services.stt.state === 'ready') return;
    console.log(`${services.stt.name}: ${services.stt.error}; falling back to the CPU model`);
  }
  if (!has(stt.exe) || !has(stt.model)) { services.stt.state = 'off'; services.stt.error = 'not installed (tools/whisper + models/)'; return; }
  services.stt.name = `speech-to-text (CPU, ${path.basename(stt.model)})`;
  services.stt.error = null;
  await start('stt', stt.exe, ['-m', abs(stt.model), '-t', String(stt.threads || 8), ...whisperArgs(stt, stt.audioCtx ?? 640)], url, '/');
}

// If the assistant was killed hard (console window closed), its servers keep
// running and holding the GPU. Stop any left over from our tools folder.
// (Get-Process by name is quick; a WMI process query took ~20 s on the owner's laptop.)
async function killLeftovers() {
  const dir = path.join(ROOT, 'tools') + path.sep;
  const ps = `Get-Process llama-server, whisper-server, piper -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($env:QBA_TOOLS, 'OrdinalIgnoreCase') } | ForEach-Object { Stop-Process -Id $_.Id -Force; $_.Name }`;
  const names = (await runAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { QBA_TOOLS: dir })).trim();
  if (names) console.log('stopped leftover servers: ' + names.split(/\s+/).join(', '));
}

// Runs a command without blocking the server; resolves with stdout + stderr.
function runAsync(exe, args, env = {}) {
  return new Promise(resolve => {
    let out = '';
    const p = spawn(exe, args, { windowsHide: true, env: { ...process.env, ...env } });
    const timer = setTimeout(() => p.kill(), 30000);
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += d; });
    p.on('error', () => { clearTimeout(timer); resolve(out); });
    p.on('close', () => { clearTimeout(timer); resolve(out); });
  });
}

// Async: the page is served right away while the AI servers come up behind it.
export async function startServices(cfg) {
  const { stt, llm } = cfg;
  for (const s of Object.values(services)) s.state = 'starting';
  await killLeftovers();
  await ensureParts(cfg); // from the source folder: download the missing tools and models first
  // (both stay "starting" until their start below settles: the start-up screen waits on it)
  // The GPU list (llama.cpp's Vulkan view) decides where both models run.
  let devices = [];
  for (let i = 0; i < 3 && llm?.exe && fs.existsSync(abs(llm.exe)) && !devices.length; i++) {
    if (i) await new Promise(r => setTimeout(r, 3000));
    devices = await listDevices(llm.exe);
  }
  ensureGpuParts(cfg, devices); // NVIDIA speech parts, in the background, for the next start
  if (stt?.url) { services.stt.url = stt.url.replace(/\/$/, ''); services.stt.state = 'starting'; waitReady(services.stt, services.stt.url + '/'); }
  else if (stt) { services.stt.state = 'starting'; startStt(stt, devices).catch(err => { services.stt.state = 'failed'; services.stt.error = err.message; }); }
  else { services.stt.state = 'off'; services.stt.error = 'not set up'; }

  // The local LLM runs when it is the brain, or the stand-in for a cloud brain
  // (venue internet drops). Cloud only, without the stand-in: leave the GPU free.
  if (llm && cloudKey(llm) && llm.fallbackLocal === false) { services.llm.state = 'off'; services.llm.error = 'not used (cloud LLM)'; }
  else if (llm?.url) { services.llm.url = llm.url.replace(/\/$/, ''); services.llm.state = 'starting'; waitReady(services.llm, services.llm.url + '/health'); }
  else if (llm?.exe && fs.existsSync(abs(llm.exe)) && fs.existsSync(abs(llm.model))) {
    services.llm.state = 'starting';
    const device = llm.device || pickDevice(devices);
    start('llm', llm.exe, [
      '-m', abs(llm.model), '--host', '127.0.0.1', '--port', String(llm.port),
      '--device', device, '-ngl', device === 'none' ? '0' : String(llm.gpuLayers ?? 99),
      '-c', String(llm.ctx || 12288), '--jinja', // (shared by the two slots)
      '--parallel', '2', // two cache slots: the conversation (0) and the intent picker (1), each kept warm
      '--reasoning-budget', '0', // answer straight away: no hidden "thinking" before speaking
    ], `http://127.0.0.1:${llm.port}`, '/health');
  } else { services.llm.state = 'off'; services.llm.error = 'not installed (tools/llama + models/)'; }
}

// The cloud LLM's health: off (not used), checking, ready, failed (+ since when).
export const cloud = { state: 'off', error: null, failedAt: 0 };

// The cloud LLM in use, or null: provider "gemini" / "openrouter" with a key.
// ("gemini-live" talks through live.js, and uses the Gemini key for text too.)
export function cloudKey(llm) {
  const p = llm?.provider === 'gemini-live' ? 'gemini' : llm?.provider;
  return (p === 'gemini' || p === 'openrouter') && llm[p]?.apiKey ? llm[p].apiKey : null;
}

// What the page shows as "the LLM": the cloud when it is set up (with the local
// one as stand-in, if running), else the local server.
export function brainState(llm) {
  const local = { state: services.llm.state, error: services.llm.error, via: 'local' };
  if (!cloudKey(llm)) return local;
  if (cloud.state === 'ready') return { state: 'ready', error: null, via: llm.provider };
  if (cloud.state === 'checking') return { state: 'starting', error: null, via: llm.provider };
  // The cloud failed: the local LLM stands in, if it runs.
  return { ...local, error: local.error || 'cloud: ' + cloud.error, via: 'local', cloudError: cloud.error };
}

export function stopServices() {
  for (const s of Object.values(services)) if (s.state !== 'off') s.state = 'stopped';
  for (const p of children) p.kill();
}
