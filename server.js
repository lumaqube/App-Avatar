// QBooth Avatar (overlay): local server.
// Serves the avatar page, and proxies /qb/* to the QBooth Local API (/api/v1/*)
// with the password added here, so the password never reaches the browser.
//   node server.js          -> talks to the real QBooth (config.json)
//   node server.js --mock   -> talks to a built-in fake QBooth (mock-qbooth.js)
// The desktop app (electron/main.js) imports startServer() and runs it in-process.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock } from './mock-qbooth.js';
import { speak, engineFor, shutdown, loadWindowsVoices, avatarGender, voiceFor } from './tts.js';
import { loadConfig } from './config.js';
import { services, startServices, stopServices, brainState, cloudKey, cloud } from './services.js';
import { setup, setupDone, useLocalFile } from './setup.js';
import { transcribe, vocabPrompt } from './stt.js';
import { Chat, ACK } from './chat.js';
import { listenRetry } from './listen.js';
import { readSettings, saveSettings, testBooth, boothAction, testLlm, saveOpenRouterKey, listAvatars, saveAvatar } from './settings.js';
import { loginOpenRouter } from './openrouter-login.js';
import { liveUpgrade, LIVE_VOICES } from './live.js';
import { avatarThumb } from './avatar-info.js';
import { allTexts } from './public/lines.js';
import { spawn } from 'node:child_process';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
let cfg, MOCK, chat; // set by startServer()
// The languages the avatar speaks: Indonesian, English, Mandarin.
const LANGS = ['id', 'en', 'zh'];
const langOf = v => LANGS.includes(v) ? v : 'en'; // (English when nothing is set: a fresh install)

// Server-side Local API call (the chat's tools use it).
async function qb(method, p, body) {
  try {
    const r = await fetch(`http://${cfg.qbooth.host}:${cfg.qbooth.port}/api/v1/${p}`, {
      method, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(4000),
      headers: { 'Authorization': 'Bearer ' + cfg.qbooth.password, 'Content-Type': 'application/json' },
    });
    return await r.json();
  } catch (err) {
    return { ok: false, error: { code: 'offline', message: err.message } };
  }
}

const STATIC = [
  ['/vendor/three/', path.join(ROOT, 'node_modules/three/')],
  ['/vendor/three-vrm/', path.join(ROOT, 'node_modules/@pixiv/three-vrm/lib/')],
  ['/', path.join(ROOT, 'public/')],
];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.vrm': 'model/gltf-binary',
  '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
};

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function serveStatic(req, res) {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const [prefix, dir] of STATIC) {
    if (!url.startsWith(prefix)) continue;
    let file = path.join(dir, url.slice(prefix.length) || 'index.html');
    if (!file.startsWith(dir)) break; // path traversal
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) continue;
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
    return;
  }
  sendJson(res, 404, { ok: false, error: { code: 'not_found' } });
}

function proxy(req, res) {
  const u = new URL(req.url, 'http://x');
  const target = '/api/v1/' + u.pathname.slice('/qb/'.length) + u.search;
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const up = http.request({
      host: cfg.qbooth.host, port: cfg.qbooth.port, path: target, method: req.method, timeout: 4000,
      headers: {
        'Authorization': 'Bearer ' + cfg.qbooth.password,
        'Content-Type': 'application/json',
        'Content-Length': body.length,
      },
    }, upRes => {
      res.writeHead(upRes.statusCode, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      upRes.pipe(res);
    });
    up.on('timeout', () => up.destroy(new Error('timeout')));
    up.on('error', err => sendJson(res, 502, { ok: false, error: { code: 'offline', message: err.message } }));
    up.end(body);
  });
}

// GET /speak?lang=id&text=... -> WAV (pre-rendered clip, cached take or live engine),
// or 404 no_voice so the page falls back to the browser's own voice.
async function speakRoute(req, res) {
  const u = new URL(req.url, 'http://x');
  const lang = langOf(u.searchParams.get('lang'));
  const text = (u.searchParams.get('text') || '').trim().slice(0, 600);
  if (!text) return sendJson(res, 400, { ok: false, error: { code: 'bad_request' } });
  try {
    const r = await speak(cfg, lang, text);
    if (!r) return sendJson(res, 404, { ok: false, error: { code: 'no_voice' } });
    res.writeHead(200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store', 'X-Voice-Source': r.source });
    fs.createReadStream(r.file).pipe(res);
  } catch (err) {
    console.error('tts:', err.message);
    sendJson(res, 502, { ok: false, error: { code: 'tts_failed', message: err.message } });
  }
}

const readBody = (req, max) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  req.on('data', c => { size += c.length; if (size > max) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

// POST /listen?lang=id  body: 16 kHz mono WAV  ->  { ok, text }
async function listenRoute(req, res) {
  try {
    const lang = langOf(new URL(req.url, 'http://x').searchParams.get('lang'));
    const wav = await readBody(req, 4e6);
    const t0 = Date.now();
    const [status, templates] = await Promise.all([qb('GET', 'status').then(r => r.data || null), qb('GET', 'templates').then(r => r.data || [])]);
    const text = await transcribe(wav, lang, vocabPrompt(lang, templates.map(t => t.name), cfg.assistantName || 'Luma', status));
    console.log(`heard (${((Date.now() - t0) / 1000).toFixed(1)}s): ${text || '(nothing)'}`);
    // For tuning only (off by default: guests' voices are personal data).
    if (cfg.saveRecordings) {
      const dir = path.join(ROOT, 'logs', 'heard');
      fs.mkdirSync(dir, { recursive: true });
      const name = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      fs.writeFileSync(path.join(dir, name + '.wav'), wav);
      fs.writeFileSync(path.join(dir, name + '.txt'), text + '\n');
    }
    sendJson(res, 200, { ok: true, text, ms: Date.now() - t0 });
  } catch (err) {
    sendJson(res, 503, { ok: false, error: { code: 'stt_failed', message: err.message } });
  }
}

// POST /chat { text, lang }  ->  NDJSON stream of { t: 'say' | 'action' | 'error' | 'done', ... }
let chatBusy = false;
async function chatRoute(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req, 64e3)); } catch { return sendJson(res, 400, { ok: false, error: { code: 'bad_request' } }); }
  const text = String(body.text || '').trim().slice(0, 500);
  if (!text) return sendJson(res, 400, { ok: false, error: { code: 'bad_request' } });
  if (chatBusy) return sendJson(res, 409, { ok: false, error: { code: 'busy' } });
  chatBusy = true;
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
  const emit = o => res.write(JSON.stringify(o) + '\n');
  const t0 = Date.now();
  let first = true;
  try {
    await chat.turn(text, langOf(body.lang), o => {
      if (first && o.t === 'say') {
        first = false;
        console.log(`first sentence after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        emit({ t: 'timing', firstMs: Date.now() - t0 });
      }
      if (o.t === 'action') console.log(`action ${o.tool} -> ${o.ok ? 'ok' : o.code}`);
      emit(o);
    });
  } catch (err) {
    console.error('chat:', err.message);
    emit({ t: 'error', message: err.message });
  } finally {
    chatBusy = false;
    emit({ t: 'done' });
    res.end();
  }
}

// Is the cloud brain usable (key, model, internet)? At start and after the settings change.
async function checkCloud() {
  if (!cloudKey(cfg.llm)) { cloud.state = 'off'; return; }
  cloud.state = 'checking';
  const r = await testLlm(cfg, { provider: cfg.llm.provider === 'gemini-live' ? 'gemini' : cfg.llm.provider });
  Object.assign(cloud, r.ok ? { state: 'ready', error: null } : { state: 'failed', error: r.message, failedAt: Date.now() });
  console.log(`cloud LLM (${cfg.llm.provider}): ${r.ok ? 'ok, ' + r.message : 'FAILED, ' + r.message}`);
}

// The desktop app tells us how to restart / quit it, which screens it has, and how to
// shape, move and size its window.
let restartApp = null, quitApp = null, appInfo = { desktop: false, displays: [] };
let appShape = null;   // (rects) -> cut the window to them
let pickFile = null;   // ({ name, zip }) -> a file the user picked, or null (first-start downloads)
// Opens a page in the default browser (the desktop app passes Electron's shell.openExternal).
let openExternal = url => new Promise((resolve, reject) => {
  const p = spawn('rundll32', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' });
  p.on('error', reject);
  p.on('spawn', () => { p.unref(); resolve(); });
});
export function setAppHooks({ restart, quit, info, open, shape, pick }) {
  if (restart) restartApp = restart;
  if (quit) quitApp = quit;
  if (open) openExternal = open;
  if (shape) appShape = shape;
  if (pick) pickFile = pick;
  if (info) appInfo = { ...appInfo, ...info };
}

// The window: its shape (what the page shows), and where the character and its two buttons
// stand (public/layout.js; saved for the next start).
async function appRoute(req, res, p) {
  try {
    const m = JSON.parse(await readBody(req, 16e3) || '{}');
    // "I have it already": the user picks their own copy of the part being downloaded
    if (p === '/app/pick-part') {
      if (!pickFile || !setup.expect) return sendJson(res, 200, { ok: false, error: 'nothing to choose' });
      const file = await pickFile(setup.expect);
      return sendJson(res, 200, file ? await useLocalFile(file) : { ok: false, cancelled: true });
    }
    if (p === '/app/shape') {
      const rects = m.rects.slice(0, 40).map(r => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) }));
      appShape?.(rects);
    } else if (p === '/app/layout') saveSettings(cfg, MOCK, { 'overlay.layout': m.layout });
    sendJson(res, 200, { ok: true });
  } catch { sendJson(res, 400, { ok: false }); }
}

// Settings screen. With a settings PIN set, changing anything needs it.
async function settingsRoute(req, res) {
  const u = new URL(req.url, 'http://x');
  const pinOk = pin => !cfg.settingsPin || String(pin ?? '') === String(cfg.settingsPin);
  try {
    if (req.method === 'GET' && u.pathname === '/settings') return sendJson(res, 200, { ok: true, ...readSettings(cfg, MOCK, appInfo), liveVoices: LIVE_VOICES });
    if (req.method === 'GET' && u.pathname === '/avatars') return sendJson(res, 200, { ok: true, avatars: listAvatars(path.join(ROOT, 'public/avatars')) });
    if (req.method === 'POST' && u.pathname === '/settings/unlock') {
      const { pin } = JSON.parse(await readBody(req, 4e3) || '{}');
      return sendJson(res, pinOk(pin) ? 200 : 403, { ok: pinOk(pin) });
    }
    // the language screen at launch: only the language, no PIN (a guest-safe choice)
    if (req.method === 'POST' && u.pathname === '/settings/language') {
      const { language } = JSON.parse(await readBody(req, 1e3) || '{}');
      if (!LANGS.includes(language)) return sendJson(res, 400, { ok: false, error: { code: 'bad_request' } });
      saveSettings(cfg, MOCK, { language });
      warmUp(language);
      return sendJson(res, 200, { ok: true });
    }
    if (!pinOk(req.headers['x-settings-pin'])) return sendJson(res, 403, { ok: false, error: { code: 'pin' } });
    if (req.method === 'POST' && u.pathname === '/avatars') {
      const file = saveAvatar(path.join(ROOT, 'public/avatars'), u.searchParams.get('name'), await readBody(req, 200e6));
      return sendJson(res, 200, { ok: true, avatar: file });
    }
    if (req.method === 'POST' && (u.pathname === '/settings/test' || u.pathname === '/settings/booth')) {
      const b = JSON.parse(await readBody(req, 16e3));
      const real = cfg.realQbooth || cfg.qbooth;
      const conn = { host: b.host || real.host, port: b.port || real.port, password: b.password || real.password };
      return sendJson(res, 200, u.pathname === '/settings/test' ? await testBooth(conn) : await boothAction(conn, b));
    }
    if (req.method === 'POST' && u.pathname === '/settings/quit') { // no window frame to close it with
      sendJson(res, 200, { ok: !!quitApp });
      if (quitApp) setTimeout(quitApp, 200);
      return;
    }
    if (req.method === 'POST' && u.pathname === '/settings/test-llm') {
      return sendJson(res, 200, await testLlm(cfg, JSON.parse(await readBody(req, 16e3))));
    }
    if (req.method === 'POST' && u.pathname === '/settings/openrouter-login') {
      try {
        saveOpenRouterKey(cfg, await loginOpenRouter({ openExternal }));
        console.log('OpenRouter: signed in, key saved');
        checkCloud();
        return sendJson(res, 200, { ok: true });
      } catch (err) {
        return sendJson(res, 200, { ok: false, error: { code: err.code || 'failed', message: err.message } });
      }
    }
    if (req.method === 'POST' && u.pathname === '/settings') {
      const changes = JSON.parse(await readBody(req, 64e3));
      let { restart } = saveSettings(cfg, MOCK, changes);
      // another voice (the avatar's gender), or another system prompt: cache them again
      if (['avatar', 'avatarStyle', 'talk', 'persona', 'assistantName', 'eventInfo'].some(k => k in changes)) warmUp(cfg.language);
      // The local LLM now needed (local brain, or the cloud's stand-in) but not running: restart.
      const localNeeded = !cloudKey(cfg.llm) || cfg.llm.fallbackLocal !== false;
      if (localNeeded && services.llm.state === 'off') restart = true;
      console.log('settings saved' + (restart ? ', restarting' : ''));
      if (!restart) checkCloud();
      sendJson(res, 200, { ok: true, restart: restart && !!restartApp, restartNeeded: restart });
      if (restart && restartApp) setTimeout(restartApp, 300);
      return;
    }
    sendJson(res, 404, { ok: false, error: { code: 'not_found' } });
  } catch (err) {
    sendJson(res, 400, { ok: false, error: { code: 'bad_request', message: err.message } });
  }
}

// Starts the page server (+ the mock booth, + the AI servers in the background).
// Resolves with { port, cfg } once listening. A busy port is waited for a while
// (the previous copy may still be closing), then it rejects.
const listening = [];
// deferServices: the desktop app starts the AI servers itself (beginServices) once its
// window is on screen, so loading the models does not hold up the first paint.
export async function startServer({ mock, deferServices } = {}) {
  cfg = loadConfig();
  MOCK = mock ?? !!cfg.mock;
  process.on('exit', stopAll);
  if (MOCK) {
    cfg.realQbooth = cfg.qbooth; // what the settings screen shows and edits
    cfg.qbooth = { host: '127.0.0.1', port: 8739, password: 'mock' };
    listening.push(await startMock(cfg.qbooth.port, cfg.qbooth.password));
  }
  chat = new Chat(cfg, qb);
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/qb/')) return proxy(req, res);
    if (req.url.startsWith('/speak?')) return speakRoute(req, res);
    if (req.method === 'POST' && req.url.startsWith('/listen')) return listenRoute(req, res);
    if (req.method === 'POST' && req.url.startsWith('/chat')) return chatRoute(req, res);
    const p = req.url.split('?')[0];
    if (req.method === 'POST' && p.startsWith('/app/')) return appRoute(req, res, p);
    if (p === '/settings' || p.startsWith('/settings/') || p === '/avatars') return settingsRoute(req, res); // not /settings.js, /avatars/x.vrm
    if (p === '/avatar-thumb') { // the thumbnail inside a .vrm, for the gallery
      try {
        const f = path.join(ROOT, 'public/avatars', path.basename(new URL(req.url, 'http://x').searchParams.get('f') || ''));
        const t = avatarThumb(f);
        if (!t) return sendJson(res, 404, { ok: false });
        res.writeHead(200, { 'Content-Type': t.type, 'Cache-Control': 'max-age=3600' });
        return res.end(t.data);
      } catch { return sendJson(res, 404, { ok: false }); }
    }
    if (req.url === '/services') return sendJson(res, 200, {
      stt: { state: services.stt.state, error: services.stt.error, name: services.stt.name },
      llm: brainState(cfg.llm),
      localLlm: { state: services.llm.state, error: services.llm.error },
      setup, // first start from source: downloading the tools and models
    });
    if (req.url.split('?')[0] === '/config.json') {
      const { qbooth, tts, stt, llm, realQbooth, settingsPin, ...pub } = cfg; // never the password or PIN
      return sendJson(res, 200, {
        ...pub, mock: MOCK, qbooth: { host: qbooth.host, port: qbooth.port }, settingsLocked: !!settingsPin,
        desktop: appInfo.desktop, // the overlay window (shape, position) exists only in the desktop app
        live: llm.provider === 'gemini-live' && !!llm.gemini?.apiKey ? { voice: llm.live?.voice, bargeIn: !!llm.live?.bargeIn } : null,
        tts: { id: engineFor(cfg, 'id'), en: engineFor(cfg, 'en'), zh: engineFor(cfg, 'zh'), browserFallback: tts.browserFallback !== false },
        avatarGender: avatarGender(cfg), // the browser's own voice and Gemini Live's follow it
      });
    }
    serveStatic(req, res);
  });
  // WebSocket /live (Gemini Live)
  const live = liveUpgrade({ cfg, qb });
  server.on('upgrade', (req, socket, head) => {
    if (req.url.startsWith('/live')) return live(req, socket, head);
    socket.destroy();
  });
  try {
    await listenRetry(server, cfg.port);
  } catch (err) {
    throw new Error(err.code === 'EADDRINUSE' ? `Port ${cfg.port} is in use: the assistant is probably already running.` : err.message);
  }
  listening.push(server);
  fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
  // Only now, with the port ours: a second copy started by mistake gives up
  // above and never touches the running copy's AI servers.
  if (!deferServices) beginServices();
  checkCloud();
  autoStartEvent();
  // which Windows voices this PC has (a male Indonesian / Mandarin voice needs a language pack)
  loadWindowsVoices().then(() => { const v = voiceFor(cfg, langOf(cfg.language)); console.log(`voice (${avatarGender(cfg)}): ${v.engine} ${v.voice || v.model || ''}${v.fallback ? ' (the other gender: this one is not installed)' : ''}`); });
  console.log(`QBooth Avatar: http://127.0.0.1:${cfg.port}/`);
  console.log(MOCK ? 'QBooth: MOCK (fake booth on port 8739)' : `QBooth Local API: http://${cfg.qbooth.host}:${cfg.qbooth.port}/`);
  console.log(`Live voice: id = ${engineFor(cfg, 'id')}, en = ${engineFor(cfg, 'en')}, zh = ${engineFor(cfg, 'zh')} (pre-rendered clips always first)`);
  return { port: cfg.port, cfg };
}

// qbooth.autoStart: the event chosen in the settings is launched once QBooth answers,
// unless one is already running. Once per app start (an operator's Stop stays stopped).
async function autoStartEvent() {
  const q = cfg.qbooth;
  if (MOCK || !q.autoStart || !q.eventId) return;
  for (let i = 0; i < 60; i++) { // ~5 minutes: QBooth may still be opening
    const s = await qb('GET', 'status');
    if (s.ok && s.data.event) return console.log(`autoStart: "${s.data.event.name}" is already running`);
    if (s.ok && s.data.available?.includes('event/start')) {
      const r = await qb('POST', 'event/start', { id: q.eventId });
      return console.log(`autoStart: event ${q.eventId} -> ${r.ok ? 'started' : r.error?.code}`);
    }
    await new Promise(r => setTimeout(r, 5000));
  }
}

// Stops Piper, speech-to-text and the LLM (they are child processes), and frees
// our ports at once, so a new copy can start even while this process winds down.
let servicesBegun = false;
export function beginServices() {
  if (servicesBegun) return;
  servicesBegun = true;
  startServices(cfg).catch(err => console.error('services:', err.message)); // in the background
  warmUp(cfg.language);
}

// Once the local LLM is up: its prompt read into the cache (the first question answers as fast
// as the next), and every fixed line's voice made, one at a time in the background (a live
// answer waits for one line at most), so the fixed lines play at once from the first time.
// Again for the new language when it changes.
let warmLang = null;
async function warmUp(lang) {
  lang = langOf(lang);
  warmLang = lang;
  await setupDone; // the voice engine and the LLM may still be downloading
  for (let i = 0; i < 300 && ['starting', 'warming'].includes(services.llm.state); i++) await new Promise(r => setTimeout(r, 1000));
  if (warmLang !== lang) return;
  await chat.warm(lang);
  let made = 0;
  const t0 = Date.now();
  const acks = Object.values(ACK).map(a => a[lang]).filter(t => t && !t.includes('{name}'));
  for (const text of [...allTexts(lang), ...acks]) {
    if (warmLang !== lang) return; // the language changed meanwhile
    try { const r = await speak(cfg, lang, text); if (r && r.source !== 'clip' && r.source !== 'cache') made++; } catch { }
  }
  if (made) console.log(`voice: ${made} fixed lines made for "${lang}" in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

export function stopAll() {
  shutdown();
  stopServices();
  for (const s of listening.splice(0)) { s.close(); s.closeAllConnections?.(); }
}

// Run directly: node server.js [--mock]
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.on('SIGINT', () => process.exit(0));
  startServer({ mock: process.argv.includes('--mock') || undefined }).catch(err => { console.error(err.message); process.exit(1); });
}
