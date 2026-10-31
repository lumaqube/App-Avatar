// The settings screen's server side (public/settings.js is the page side).
//   GET  /settings          -> current values (the QBooth password is never sent back)
//   POST /settings          -> save to config.json; applied live, or the app restarts
//   POST /settings/test     -> try a QBooth address + password
//   POST /settings/booth    -> connect + event list, run / stop an event
//   POST /settings/test-llm -> one short request to the chosen LLM
//   POST /settings/openrouter-login -> sign in at OpenRouter in the browser, keep the key
//   GET  /avatars, POST /avatars?name=x.vrm (body = the file)
import fs from 'node:fs';
import path from 'node:path';
import { configWritePath, loadOwnConfig } from './config.js';
import { avatarInfo } from './avatar-info.js';
import { avatarGender, voiceFor } from './tts.js';
import { brandName } from './public/brand.js';

// Keys the screen edits. "restart" = only takes effect on a fresh start.
export const FIELDS = {
  mock: { type: 'bool', restart: true },
  'qbooth.host': { type: 'string' },
  'qbooth.port': { type: 'int' },
  'qbooth.password': { type: 'secret' },
  'qbooth.eventId': { type: 'string' },     // the event the settings run (and autoStart starts)
  'qbooth.autoStart': { type: 'bool' },     // start that event when the app opens, if none is running
  brandName: { type: 'string' },            // the booth app's name to show; empty = what it reports (public/brand.js)
  assistantName: { type: 'string' },
  persona: { type: 'enum', values: ['ceria', 'formal', 'kalem', 'lucu', 'energik'] },
  talk: { type: 'enum', values: ['short', 'normal', 'chatty'], default: 'normal' }, // how much it says (chat.js TALK)
  language: { type: 'enum', values: ['id', 'en', 'zh'] },
  askLanguage: { type: 'bool' }, // the choice screen at launch (default on)
  eventInfo: { type: 'text' },
  pronunciations: { type: 'text' }, // "word = how to say it" lines (pronounce.js)
  avatar: { type: 'string' },
  avatarStyle: { type: 'json' }, // { "avatars/x.vrm": { colors: { skin: '#…' }, glasses: { type, color } } }
  display: { type: 'int', restart: true },
  screenGpu: { type: 'enum', values: ['auto', 'nvidia', 'software'], restart: true, default: 'auto' }, // electron/main.js
  // the window on top of QBooth (electron/main.js): its first place, until the operator drags it
  'overlay.side': { type: 'enum', values: ['right', 'left'], restart: true, default: 'right' },
  'overlay.size': { type: 'int', restart: true, default: 70 }, // % of the screen height
  'overlay.layout': { type: 'json' }, // where the character and its buttons stand (public/layout.js), screen fractions
  'overlay.menuButton': { type: 'bool', default: true }, // the ☰ button (opens the settings)
  'overlay.langButton': { type: 'bool', default: true }, // the language button
  'overlay.langPin': { type: 'bool', default: true },    // the language button asks the settings PIN (when one is set)
  idleInviteSec: { type: 'int' },
  micDevice: { type: 'string' },
  micSensitivity: { type: 'int' },
  listenMode: { type: 'enum', values: ['tap', 'auto', 'wake'] },
  'llm.provider': { type: 'enum', values: ['local', 'gemini', 'openrouter', 'gemini-live'] },
  'llm.live.voice': { type: 'string' },
  'llm.live.model': { type: 'string' },
  'llm.live.bargeIn': { type: 'bool' },
  'llm.gemini.apiKey': { type: 'secret' },
  'llm.gemini.model': { type: 'string' },
  'llm.openrouter.apiKey': { type: 'secret' },
  'llm.openrouter.model': { type: 'string' },
  'llm.fallbackLocal': { type: 'bool' },
  saveRecordings: { type: 'bool' },
  settingsPin: { type: 'secret' },
};

const get = (o, k) => k.split('.').reduce((v, p) => v?.[p], o);
function set(o, k, val) {
  const parts = k.split('.');
  let t = o;
  for (const p of parts.slice(0, -1)) t = t[p] ||= {};
  t[parts.at(-1)] = val;
}

function coerce(f, v) {
  if (f.type === 'bool') return !!v;
  if (f.type === 'int') { const n = parseInt(v, 10); return Number.isFinite(n) ? n : undefined; }
  if (f.type === 'enum') return f.values.includes(v) ? v : undefined;
  if (f.type === 'json') return v && typeof v === 'object' && !Array.isArray(v) && JSON.stringify(v).length < 20000 ? v : undefined;
  return String(v ?? '').slice(0, f.type === 'text' ? 4000 : 300);
}

// In mock mode cfg.qbooth points at the fake booth; the real address is kept in cfg.realQbooth.
const source = (cfg, k) => k.startsWith('qbooth.') && cfg.realQbooth ? { qbooth: cfg.realQbooth } : cfg;

export function readSettings(cfg, mock, appInfo) {
  const values = {};
  for (const [k, f] of Object.entries(FIELDS)) {
    values[k] = f.type === 'secret' ? '' : get(source(cfg, k), k) ?? f.default; // (a default shown is not a change: no restart)
  }
  values.mock = mock;
  return {
    values,
    has: {
      'qbooth.password': !!(cfg.realQbooth || cfg.qbooth)?.password, settingsPin: !!cfg.settingsPin,
      'llm.gemini.apiKey': !!cfg.llm?.gemini?.apiKey, 'llm.openrouter.apiKey': !!cfg.llm?.openrouter?.apiKey,
    },
    file: configWritePath(),
    app: appInfo,
    // the voice each language speaks with for this avatar (fallback: its gender's is not installed)
    gender: avatarGender(cfg),
    voices: Object.fromEntries(['id', 'en', 'zh'].map(l => [l, voiceFor(cfg, l)])),
  };
}

// Saves the changed fields into config.json (only the owner's own keys, so the
// file stays short) and into the running cfg. Returns whether a restart is needed.
export function saveSettings(cfg, mock, changes) {
  const own = loadOwnConfig();
  let restart = false;
  for (const [k, raw] of Object.entries(changes || {})) {
    const f = FIELDS[k];
    if (!f) continue;
    if (f.type === 'secret' && raw === '') continue; // empty = keep the saved one
    const v = f.type === 'secret' && raw === null ? '' : coerce(f, raw); // null = remove (the PIN)
    if (v === undefined) continue;
    const now = k === 'mock' ? mock : get(source(cfg, k), k);
    if (JSON.stringify(now) === JSON.stringify(v)) continue;
    set(own, k, v);
    if (f.restart) restart = true;
    else set(source(cfg, k), k, v); // live (the mock keeps its own booth address)
  }
  fs.writeFileSync(configWritePath(), JSON.stringify(own, null, 2) + '\n');
  return { restart };
}

// One Local API call with the address / password typed on the settings screen.
async function boothCall({ host, port, password }, method, p, body) {
  try {
    const r = await fetch(`http://${host}:${port}/api/v1/${p}`, {
      method, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(6000),
      headers: { Authorization: 'Bearer ' + password, 'Content-Type': 'application/json' },
    });
    return await r.json();
  } catch (err) {
    return { ok: false, error: { code: 'offline', message: err.cause?.code || err.message } };
  }
}

const boothError = e => e?.code === 'offline' ? `not reachable (${e.message}): is the Local API on in the booth app?`
  : e?.code === 'unauthorized' ? 'wrong password' : e?.code === 'too_many_attempts' ? 'too many wrong passwords, wait a minute'
    : [e?.code, e?.message].filter(Boolean).join(': ') || 'error';

export async function testBooth(conn) {
  const j = await boothCall(conn, 'GET', 'status');
  if (j.ok) return { ok: true, brand: brandName(j.data.app?.name), message: `${brandName(j.data.app?.name) || 'Booth'} ${j.data.app?.version || ''}` + (j.data.event ? ` · event: ${j.data.event.name}` : ' · no event running') };
  return { ok: false, code: j.error?.code, detail: j.error?.message, message: boothError(j.error) };
}

// The Local API rows of the settings screen: connect (status + event list), run / stop an event.
export async function boothAction(conn, { action, id }) {
  if (action === 'connect') {
    const s = await boothCall(conn, 'GET', 'status');
    if (!s.ok) return { ok: false, code: s.error?.code, detail: s.error?.message, message: boothError(s.error) };
    const ev = await boothCall(conn, 'GET', 'events');
    return {
      // brand: the name it reports, as shown ("QBooth" -> "Q-Booth")
      ok: true, brand: brandName(s.data.app?.name), message: `${brandName(s.data.app?.name) || 'Booth'} ${s.data.app?.version || ''}`,
      running: s.data.event, events: (ev.data || []).filter(e => !e.archived || e.running),
    };
  }
  if (action === 'start' || action === 'stop') {
    const r = await boothCall(conn, 'POST', 'event/' + action, action === 'start' ? { id } : undefined);
    if (!r.ok) return { ok: false, code: r.error?.code, detail: r.error?.message, message: boothError(r.error) };
    // the effect shows in status a moment later (a launch warning may be on the booth screen)
    let running = null;
    for (let i = 0; i < 12; i++) {
      await new Promise(res => setTimeout(res, 500));
      const s = await boothCall(conn, 'GET', 'status');
      running = s.data?.event || null;
      if (s.ok && (action === 'start' ? running?.id === id : !running)) break;
      if (s.data?.busy?.dialog) return { ok: true, running, message: 'dialog' };
    }
    return { ok: true, running };
  }
  return { ok: false, message: 'unknown action' };
}

// One short request to a cloud LLM, to check the key and the model (and see the speed).
export async function testLlm(cfg, { provider, apiKey, model }) {
  const p = cfg.llm?.[provider];
  if (!p) return { ok: false, code: 'local', message: 'local: see the debug panel (D)' };
  const key = apiKey || p.apiKey;
  if (!key) return { ok: false, code: 'no_key', message: 'no API key' };
  const t0 = Date.now();
  try {
    const r = await fetch(p.url, {
      method: 'POST', signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key, 'X-Title': 'Avatar' },
      body: JSON.stringify({
        model: model || p.model, max_tokens: provider === 'gemini' ? 1024 : 64,
        messages: [{ role: 'user', content: 'Jawab dengan satu kata saja: siap' }],
        ...(provider === 'gemini' ? { reasoning_effort: 'low' } : {}),
      }),
    });
    const j = await r.json().catch(() => ({}));
    const ms = ((Date.now() - t0) / 1000).toFixed(1);
    if (!r.ok) {
      const e = Array.isArray(j) ? j[0]?.error : j.error; // Gemini answers errors as a list
      const msg = String(e?.message || JSON.stringify(j).slice(0, 160)).replace(/(sk-or-v1-|AIza|AQ\.)[A-Za-z0-9_\-.]{8,}/g, '$1…');
      return { ok: false, code: 'http', message: `HTTP ${r.status}: ${msg}` };
    }
    return { ok: true, message: `${ms} s: "${(j.choices?.[0]?.message?.content || '').trim().slice(0, 40)}"` };
  } catch (err) {
    return { ok: false, code: 'offline', detail: err.cause?.code || err.message, message: 'not reachable: ' + (err.cause?.code || err.message) };
  }
}

// Store a key the OpenRouter sign-in returned (and use it at once).
export function saveOpenRouterKey(cfg, key) {
  const own = loadOwnConfig();
  set(own, 'llm.openrouter.apiKey', key);
  set(cfg, 'llm.openrouter.apiKey', key);
  fs.writeFileSync(configWritePath(), JSON.stringify(own, null, 2) + '\n');
}

// The gallery: every .vrm with its name, authors and credit line.
// (the catalog, avatars.json, names the bundled ones and says their gender)
export function listAvatars(dir) {
  let cat = {};
  try { cat = JSON.parse(fs.readFileSync(path.join(dir, 'avatars.json'), 'utf8')); } catch { }
  return fs.readdirSync(dir).filter(f => /\.vrm$/i.test(f)).map(f => {
    let info = {};
    try { info = avatarInfo(path.join(dir, f)); } catch { }
    return { file: 'avatars/' + f, ...info, ...(cat[f]?.name ? { name: cat[f].name } : {}), gender: cat[f]?.gender || 'female' };
  });
}

export function saveAvatar(dir, name, body) {
  const safe = path.basename(String(name || '')).replace(/[^\w .()-]+/g, '_');
  if (!/\.vrm$/i.test(safe)) throw new Error('not a .vrm file');
  if (body.length < 1000 || body.toString('ascii', 0, 4) !== 'glTF') throw new Error('not a VRM / glTF file');
  fs.writeFileSync(path.join(dir, safe), body);
  return 'avatars/' + safe;
}
