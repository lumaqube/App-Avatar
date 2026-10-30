// First start from the source folder: downloads the large parts it leaves out (tools/, models/):
// llama.cpp, whisper.cpp, Piper and its voices, and the models. Only what the config uses and
// is missing; one file at a time; a cut download resumes on the next start. The NVIDIA parts
// (whisper CUDA build + large-v3-turbo, ~1.3 GB) come in the background and are used from the
// next start on: the first start runs on the CPU model meanwhile.
// "autoDownload": false in config.json turns it off (then copy tools/ and models/ by hand).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from './tts.js';

const abs = p => path.isAbsolute(p) ? p : path.join(ROOT, p);
const GH = 'https://github.com/', HF = 'https://huggingface.co/';

// Programs: a release zip, unpacked so that `exe` lands at the configured path.
const PROGRAMS = {
  'llama-server.exe': GH + 'ggml-org/llama.cpp/releases/download/b11982/llama-b11982-bin-win-vulkan-x64.zip',
  'whisper-server.exe': GH + 'ggml-org/whisper.cpp/releases/download/b5454/whisper-blas-bin-x64.zip',
  'whisper-server.exe (cuda)': GH + 'ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-win-cuda-12.4.0-x64.zip',
  'piper.exe': GH + 'rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip',
};
// Model files by name (whisper's and Piper's follow a pattern, see modelUrl).
const MODELS = {
  'Qwen3.5-0.8B-Q8_0.gguf': HF + 'unsloth/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q8_0.gguf',
};
function modelUrl(file) {
  const name = path.basename(file);
  if (MODELS[name]) return MODELS[name];
  if (/^ggml-[\w.-]+\.bin$/.test(name)) return HF + 'ggerganov/whisper.cpp/resolve/main/' + name;
  // Piper voice "id_ID-news_tts-medium.onnx(.json)" -> id/id_ID/news_tts/medium/...
  const v = name.match(/^(([a-z]{2,3})_[A-Z]{2})-(.+)-(x_low|low|medium|high)\.onnx(\.json)?$/);
  if (v) return `${HF}rhasspy/piper-voices/resolve/main/${v[2]}/${v[1]}/${v[3]}/${v[4]}/${name}`;
  return null;
}

// Progress for the start-up screen (GET /services): state checking / downloading / done / failed.
export const setup = { state: 'checking', part: '', done: 0, total: 0, error: null, background: null, expect: null };
let ready; // resolves when the parts the first start needs are in
export const setupDone = new Promise(r => { ready = r; });

const nvidia = devices => devices.some(d => /nvidia|geforce|rtx|quadro/i.test(d.name));

// What this config needs, as { label, path, url, zip? }; `gpu`: the NVIDIA parts instead.
function wanted(cfg, { gpu = false, devices = [] } = {}) {
  const out = [];
  const add = (label, p, zipKey) => {
    if (!p || fs.existsSync(abs(p))) return;
    const url = zipKey ? PROGRAMS[zipKey] : modelUrl(p);
    if (url) out.push({ label, path: p, url, zip: !!zipKey });
  };
  const { stt, llm, tts } = cfg;
  if (gpu) {
    if (stt && !stt.url && stt.useGpu !== false && nvidia(devices)) {
      add('speech recognition (GPU)', stt.gpuExe, 'whisper-server.exe (cuda)');
      add('speech model (GPU)', stt.gpuModel);
    }
    return out;
  }
  const cloudOnly = (llm?.provider === 'gemini' || llm?.provider === 'openrouter' || llm?.provider === 'gemini-live') && llm.fallbackLocal === false;
  if (llm && !llm.url && !cloudOnly) {
    add('AI brain', llm.exe, 'llama-server.exe');
    add('AI brain model', llm.model);
  }
  if (stt && !stt.url) {
    add('speech recognition', stt.exe, 'whisper-server.exe');
    add('speech model', stt.model);
  }
  // Piper and every Piper voice the config points at (voices table, or the older engine per language).
  const voices = new Set();
  for (const byGender of Object.values(tts?.voices || {}))
    for (const v of Object.values(byGender || {})) if (v?.engine === 'piper' && v.model) voices.add(v.model);
  const engine = tts?.engine;
  for (const [lang, model] of Object.entries(tts?.piper?.models || {}))
    if ((typeof engine === 'object' ? engine?.[lang] : engine) === 'piper') voices.add(model);
  if (voices.size) add('voice engine', tts?.piper?.exe || 'tools/piper/piper.exe', 'piper.exe');
  for (const v of voices) { add('voice ' + path.basename(v, '.onnx'), v); add('voice ' + path.basename(v, '.onnx'), v + '.json'); }
  return out;
}

// The parts the first start needs (blocks the start-up screen while it runs).
export async function ensureParts(cfg) {
  try {
    if (cfg.autoDownload === false) return;
    const parts = wanted(cfg);
    if (parts.length) await install(parts, false);
  } finally {
    // failed: the parts that did not come (the app starts with what it has)
    Object.assign(setup, failures.length ? { state: 'failed', part: failures.map(f => f.part).join(', '), error: failures[0].error } : { state: 'done' });
    ready();
  }
}

// The NVIDIA parts, once the GPU list is known: in the background, for the next start.
export function ensureGpuParts(cfg, devices) {
  if (cfg.autoDownload === false) return;
  const parts = wanted(cfg, { gpu: true, devices });
  if (parts.length) install(parts, true).catch(err => console.log('download (GPU parts): ' + err.message));
}

let queue = Promise.resolve(); // one download at a time
const failures = []; // first-start parts that failed
let current = null; // the first-start part being downloaded: { p, ctl, local } (useLocalFile)
function install(parts, background) {
  const run = async () => {
    const total = parts.length;
    for (const [i, p] of parts.entries()) {
      if (fs.existsSync(abs(p.path))) continue;
      const label = `${p.label} (${i + 1}/${total})`;
      const job = { p };
      if (!background) {
        current = job;
        // what the "choose file" button asks for
        setup.expect = { name: path.basename(p.path), zip: p.zip ? path.basename(new URL(p.url).pathname) : null };
      }
      const progress = (done, size) => {
        if (background) setup.background = { part: label, done, total: size };
        else Object.assign(setup, { state: 'downloading', part: label, label: p.label, step: i + 1, steps: total, done, total: size, error: null });
      };
      progress(0, 0); // shown (and choosable) before the first byte
      try {
        for (let attempt = 1; ; attempt++) {
          try { await (p.zip ? installZip(p, progress, job) : download(p.url, abs(p.path), progress, job)); break; } catch (err) {
            // the user gave a copy of their own (useLocalFile): done, or unpack the given zip
            if (job.local) {
              job.local = false;
              fs.rmSync(abs(p.path) + '.part', { force: true }); // the download it replaced
              if (fs.existsSync(abs(p.path))) { if (p.zip) fs.rmSync(TMP, { recursive: true, force: true }); break; }
              attempt--;
              continue;
            }
            if (attempt >= 3) throw err;
            console.log(`download ${p.label}: ${err.message}, trying again`);
            await new Promise(r => setTimeout(r, 3000 * attempt));
          }
        }
        console.log(`downloaded ${p.label}: ${p.path}`);
      } catch (err) {
        if (background) { setup.background = { part: label, error: err.message }; throw err; }
        failures.push({ part: p.label, error: err.message });
        console.log(`download ${p.label} failed: ${err.message}`);
        // carry on: the other parts may still come, and the app starts with what it has
      }
    }
    if (background) setup.background = null;
    else { current = null; setup.expect = null; }
  };
  return (queue = queue.then(run, run));
}

// Streams url to dest via dest.part (resumed if there), reporting progress.
async function download(url, dest, progress, job = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = dest + '.part';
  let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
  const ctl = job.ctl = new AbortController();
  let idle = setTimeout(() => ctl.abort(), 60000); // no data for a minute: give up (resumed later)
  try {
    const res = await fetch(url, { headers: have ? { Range: `bytes=${have}-` } : {}, signal: ctl.signal });
    if (res.status === 200) have = 0; // the server sent it all again
    else if (res.status !== 206) throw new Error(`HTTP ${res.status}`);
    const size = have + Number(res.headers.get('content-length') || 0);
    const out = fs.createWriteStream(part, { flags: have ? 'a' : 'w' });
    const closed = new Promise((ok, bad) => { out.on('close', ok); out.on('error', bad); });
    let done = have, shown = 0;
    try {
      for await (const chunk of res.body) {
        clearTimeout(idle);
        idle = setTimeout(() => ctl.abort(), 60000);
        if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
        done += chunk.length;
        if (done - shown > 1 << 20 || done === size) { shown = done; progress(done, size); }
      }
    } finally { out.end(); await closed; }
    if (size && done !== size) throw new Error(`cut off at ${done} of ${size} bytes`);
    fs.renameSync(part, dest);
  } finally { clearTimeout(idle); }
}

// A release zip: download, unpack (Windows' own tar reads zip), then move the folder
// that holds the exe to where the config expects it.
const TMP = path.join(ROOT, 'tools', '_download');
const zipOf = p => path.join(TMP, path.basename(new URL(p.url).pathname));
async function installZip(p, progress, job) {
  const exe = abs(p.path), dir = path.dirname(exe);
  const tmp = TMP, zip = zipOf(p);
  if (!fs.existsSync(zip)) await download(p.url, zip, progress, job);
  const out = path.join(tmp, 'unpacked');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  try {
    await run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', out]);
  } catch (err) { fs.rmSync(zip, { force: true }); throw err; } // a broken zip: fetch it again
  const found = findFile(out, path.basename(exe));
  if (!found) throw new Error(`${path.basename(exe)} is not in ${path.basename(zip)}`);
  // Moved in file by file: what is there already (e.g. Piper voices) stays.
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(path.dirname(found))) {
    fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    fs.renameSync(path.join(path.dirname(found), name), path.join(dir, name));
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

// "I have it already": the user picked a file of their own for the part being downloaded
// (start-up screen, desktop app). A model or voice is copied in (same type, and the same size
// as the download when that is known); for a program, its release .zip (unpacked as if
// downloaded) or its exe in an existing folder (the whole folder is copied).
export async function useLocalFile(file) {
  const job = current;
  if (!job) return { ok: false, error: 'nothing is downloading' };
  const { p } = job, name = path.basename(file), want = path.basename(p.path);
  const copy = async (from, to) => { // via a temp name: a half copy never counts as done
    fs.mkdirSync(path.dirname(to), { recursive: true });
    await fs.promises.copyFile(from, to + '.copy');
    fs.renameSync(to + '.copy', to);
  };
  const sameSize = () => !setup.total || fs.statSync(file).size === setup.total;
  try {
    if (p.zip && /\.zip$/i.test(name)) {
      if (!sameSize()) return { ok: false, error: `not the same file as ${setup.expect?.zip} (size differs)` };
      await copy(file, zipOf(p));
    } else if (p.zip && name.toLowerCase() === want.toLowerCase()) {
      await fs.promises.cp(path.dirname(file), path.dirname(abs(p.path)), { recursive: true });
    } else if (!p.zip && name.toLowerCase().endsWith(path.extname(want).toLowerCase())) {
      if (!sameSize()) return { ok: false, error: `not the same file as ${want} (size differs)` };
      await copy(file, abs(p.path));
    } else {
      return { ok: false, error: p.zip ? `choose ${want} or ${setup.expect?.zip}` : `choose ${want}` };
    }
  } catch (err) { return { ok: false, error: err.message }; }
  job.local = true;
  job.ctl?.abort(); // stop downloading it; install() carries on with the copy
  console.log(`${p.label}: using the user's own ${file}`);
  return { ok: true };
}

function findFile(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === name.toLowerCase()) return p;
    if (e.isDirectory()) { const f = findFile(p, name); if (f) return f; }
  }
  return null;
}

function run(exe, args) {
  return new Promise((resolve, reject) => {
    let err = '';
    const p = spawn(exe, args, { windowsHide: true });
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => code ? reject(new Error(`${path.basename(exe)} exited ${code}: ${err.trim().slice(0, 200)}`)) : resolve());
  });
}
