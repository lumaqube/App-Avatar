// Text-to-speech for the assistant, shared by server.js (live) and
// tools/render-voice.mjs (pre-rendered clips).
//
// speak(lang, text) looks, in order, for:
//   1. a pre-rendered clip  public/voice/<lang>/<hash>.wav   (rendered once, plays instantly)
//   2. an earlier live take cache/tts/<lang>/<hash>.wav
//   3. the live engine set for that language in config.tts.engine
// Engines: piper (CPU, fast), omnivoice (Voice Studio on :3900, GPU, ~10 s a line),
// sapi (Windows voices), none. Calls run one at a time: the GPU fits one model.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { personaOf } from './persona.js';
import { pronounce } from './pronounce.js';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));

export const hashOf = (lang, text) => crypto.createHash('sha1').update(lang + '|' + text.trim()).digest('hex').slice(0, 12);
export const clipPath = (lang, text) => path.join(ROOT, 'public/voice', lang, hashOf(lang, text) + '.wav');
// Takes in another voice or at another persona speed are kept apart.
const cachePath = (lang, text, speed = 1, voice = '') => path.join(ROOT, 'cache/tts', lang,
  hashOf(lang + (voice ? '|' + voice : ''), text) + (speed === 1 ? '' : '_' + speed) + '.wav');

export function engineFor(cfg, lang) {
  if (cfg.tts?.voices?.[lang]) return voiceFor(cfg, lang).engine;
  const e = cfg.tts?.engine;
  return (typeof e === 'object' ? e?.[lang] : e) || 'none';
}

// The avatar's gender picks its voice: set in the avatar editor (avatarStyle[file].gender), else
// the avatars' catalog (public/avatars/avatars.json), else female.
let catalog = null;
export function avatarGender(cfg) {
  const file = cfg.avatar || '';
  const own = cfg.avatarStyle?.[file]?.gender;
  if (own === 'male' || own === 'female') return own;
  if (!catalog) { try { catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/avatars/avatars.json'), 'utf8')); } catch { catalog = {}; } }
  return catalog[path.basename(file)]?.gender || 'female';
}

// Windows' voices on this PC (System.Speech + OneCore), read once at start: a voice a language
// pack did not install is not offered.
let winVoices = null;
export function loadWindowsVoices() {
  const ps = `Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | % { $_.VoiceInfo.Name };
    try { [void][Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime];
      [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | % { 'onecore:' + $_.DisplayName } } catch { }`;
  return new Promise(resolve => {
    const p = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.on('error', () => resolve(winVoices = []));
    p.on('close', () => resolve(winVoices = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean)));
  });
}
const installed = v => {
  if (v.engine === 'sapi') return !winVoices || winVoices.some(n => !n.startsWith('onecore:') && n.toLowerCase() === String(v.voice).toLowerCase());
  if (v.engine === 'winrt') return !!winVoices?.some(n => n.startsWith('onecore:') && n.toLowerCase().includes(String(v.voice).toLowerCase()));
  if (v.engine === 'piper') return !v.model || fs.existsSync(abs(v.model));
  return true;
};

// The voice for a language and the avatar's gender: config.tts.voices[lang][gender] =
// { engine, voice | model }. When that one is not on this PC (no Windows language pack), the
// other gender's voice speaks (fallback: true), so the avatar is never silent.
export function voiceFor(cfg, lang) {
  const gender = avatarGender(cfg);
  const table = cfg.tts?.voices?.[lang];
  if (table) {
    const want = table[gender];
    if (want && installed(want)) return { ...want, gender };
    const other = table[gender === 'male' ? 'female' : 'male'];
    if (other && installed(other)) return { ...other, gender, fallback: true };
  }
  const e = cfg.tts?.engine; // an older config: one engine per language
  const engine = (typeof e === 'object' ? e?.[lang] : e) || 'none';
  return { engine, model: cfg.tts?.piper?.models?.[lang], voice: cfg.tts?.sapi?.voices?.[lang], gender };
}
const voiceKey = v => `${v.engine}:${v.voice || v.model || ''}`;

let chain = Promise.resolve();
const oneAtATime = job => (chain = chain.then(job, job));

// -> { file, source: 'clip' | 'cache' | <engine> } or null when nothing can speak it.
export async function speak(cfg, lang, text) {
  // Words the engine says wrong are rewritten as they sound (pronounce.js); a line that
  // changes is never taken from a clip rendered before, and is cached under what is said.
  const said = pronounce(cfg, lang, text);
  const voice = voiceFor(cfg, lang);
  // pre-rendered clips are in the female voice
  const clip = clipPath(lang, text);
  if (said === text && voice.gender === 'female' && !voice.fallback && fs.existsSync(clip)) return { file: clip, source: 'clip' };
  const speed = voice.engine === 'piper' ? personaOf(cfg).lengthScale : 1;
  const cached = cachePath(lang, said, speed, voiceKey(voice));
  if (fs.existsSync(cached)) return { file: cached, source: 'cache' };
  if (!ENGINES[voice.engine]) return null;
  await oneAtATime(() => fs.existsSync(cached) ? null : generate(cfg, voice, lang, said, cached, speed));
  return { file: cached, source: voice.engine };
}

export function shutdown() {
  for (const w of Object.values(pipers)) w.p.kill();
}

// voice: { engine, voice | model } (voiceFor), or just an engine's name (tools/render-voice.mjs)
export async function generate(cfg, voice, lang, text, out, speed) {
  if (typeof voice === 'string') voice = { engine: voice };
  const engine = voice.engine;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmp = out + '.part';
  const c = { ...(cfg.tts[engine] || {}), ...voice };
  await ENGINES[engine](speed && engine === 'piper' ? { ...c, lengthScale: speed } : c, lang, text, tmp);
  if (!fs.existsSync(tmp) || fs.statSync(tmp).size < 1000) throw new Error(`${engine} produced no audio`);
  fs.renameSync(tmp, out);
}

const abs = p => path.isAbsolute(p) ? p : path.join(ROOT, p);

function run(exe, args, { input, env } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(exe, args, { windowsHide: true, env: { ...process.env, ...env } });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve() : reject(new Error(`${path.basename(exe)} exited ${code}: ${err.slice(-400)}`)));
    if (input !== undefined) p.stdin.end(input);
  });
}

// One Piper process per language stays running (--json-input), so the voice
// model loads once: a line then takes well under a second on the CPU.
const pipers = {};
function piperProcess(c, lang) {
  const model = c.model || c.models?.[lang];
  const key = model + ':' + (c.lengthScale || 1); // one process per voice and speed
  if (pipers[key]) return pipers[key];
  if (!model) throw new Error(`piper: no model for "${lang}" in config.tts.piper.models`);
  const args = ['--model', abs(model), '--json-input'];
  if (c.lengthScale) args.push('--length_scale', String(c.lengthScale));
  const p = spawn(abs(c.exe || 'tools/piper/piper.exe'), args, { windowsHide: true });
  const w = pipers[key] = { p, waiting: [], err: '' };
  let buf = '';
  p.stdout.on('data', d => { // piper prints the output path when a line is done
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { buf = buf.slice(i + 1); w.waiting.shift()?.resolve(); }
  });
  p.stderr.on('data', d => { w.err = (w.err + d).slice(-400); });
  const fail = err => { delete pipers[key]; w.waiting.splice(0).forEach(x => x.reject(err)); };
  p.on('error', fail);
  p.on('close', code => fail(new Error(`piper exited ${code}: ${w.err}`)));
  return w;
}

const ENGINES = {
  // Piper: https://github.com/rhasspy/piper (Windows build: piper.exe + an .onnx voice per language).
  async piper(c, lang, text, out) {
    const w = piperProcess(c, lang);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { w.p.kill(); reject(new Error('piper timed out')); }, 30000);
      w.waiting.push({ resolve: () => { clearTimeout(timer); resolve(); }, reject: e => { clearTimeout(timer); reject(e); } });
      w.p.stdin.write(JSON.stringify({ text, output_file: out }) + '\n');
    });
  },

  // OmniVoice Studio (the owner's Voice Studio app). POST /generate is multipart.
  async omnivoice(c, lang, text, out) {
    const fd = new FormData();
    fd.append('text', text);
    fd.append('language', c.languages?.[lang] || ({ en: 'English', zh: 'Chinese' }[lang] || 'Indonesian'));
    if (c.profiles?.[lang]) fd.append('profile_id', c.profiles[lang]);
    else if (c.instruct) fd.append('instruct', c.instruct);
    fd.append('effect_preset', c.effect || 'broadcast');
    if (c.seed !== undefined) fd.append('seed', String(c.seed));
    const url = (c.url || 'http://127.0.0.1:3900').replace(/\/$/, '') + '/generate';
    let r;
    for (let i = 0; i < 3; i++) { // /generate sometimes drops the connection: retry
      try { r = await fetch(url, { method: 'POST', body: fd, signal: AbortSignal.timeout(120000) }); break; }
      catch (err) { if (i === 2) throw err; }
    }
    if (!r.ok) throw new Error(`omnivoice ${r.status}: ${(await r.text()).slice(0, 300)}`);
    fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
  },

  // Windows SAPI voices (System.Speech). Only the languages Windows has voices for.
  async sapi(c, lang, text, out) {
    const txt = path.join(os.tmpdir(), `qba_${process.pid}_${Date.now()}.txt`);
    fs.writeFileSync(txt, text, 'utf8');
    const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer;
      if ($env:QBA_VOICE) { $s.SelectVoice($env:QBA_VOICE) }; $s.Rate = [int]$env:QBA_RATE;
      $s.SetOutputToWaveFile($env:QBA_OUT); $s.Speak([IO.File]::ReadAllText($env:QBA_TXT)); $s.Dispose()`;
    try {
      await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps],
        { env: { QBA_VOICE: c.voice || c.voices?.[lang] || '', QBA_RATE: String(c.rate || 0), QBA_OUT: out, QBA_TXT: txt } });
    } finally { fs.rmSync(txt, { force: true }); }
  },

  // Windows' newer (OneCore) voices: the ones a language pack adds, e.g. Indonesian "Andika",
  // Mandarin "Kangkang" / "Huihui". c.voice = part of the voice's name.
  async winrt(c, lang, text, out) {
    const txt = path.join(os.tmpdir(), `qba_${process.pid}_${Date.now()}.txt`);
    fs.writeFileSync(txt, text, 'utf8');
    const ps = `Add-Type -AssemblyName System.Runtime.WindowsRuntime;
      $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | ? { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0];
      function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); [void]$t.Wait(-1); $t.Result }
      [void][Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime];
      [void][Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime];
      $s = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer;
      $v = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | ? { $_.DisplayName -like ('*' + $env:QBA_VOICE + '*') } | Select-Object -First 1;
      if (-not $v) { throw ('no Windows voice like ' + $env:QBA_VOICE) }; $s.Voice = $v;
      $st = Await ($s.SynthesizeTextToStreamAsync([IO.File]::ReadAllText($env:QBA_TXT))) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream]);
      $r = New-Object Windows.Storage.Streams.DataReader($st.GetInputStreamAt(0));
      [void](Await ($r.LoadAsync([uint32]$st.Size)) ([uint32]));
      $b = New-Object byte[] $st.Size; $r.ReadBytes($b); [IO.File]::WriteAllBytes($env:QBA_OUT, $b)`;
    try {
      await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { env: { QBA_VOICE: c.voice || '', QBA_OUT: out, QBA_TXT: txt } });
    } finally { fs.rmSync(txt, { force: true }); }
  },
};
