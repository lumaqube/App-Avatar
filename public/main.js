// QBooth Avatar (overlay): only the character, on top of QBooth's event screen.
// It follows the booth through the Local API (fixed lines per screen), talks with the
// guests (speech to text -> LLM -> voice, or Gemini Live) and presses QBooth's own
// buttons by voice. Nothing else is drawn: QBooth's screen around it is the screen.
//   tap the character = talk · hold it 5 s = settings · the language button · the ☰ button
//   Ctrl+Alt+Shift+S settings · +P place the character and the buttons · +Q quit (electron/main.js)
import { Avatar } from './avatar.js';
import { Voice } from './voice.js';
import { Mic } from './mic.js';
import { react } from './brain.js';
import { qb } from './qbooth.js';
import { pick, UI } from './lines.js';
import { initSettings } from './settings.js';
import { runBoot } from './boot.js';
import { LiveLink } from './live.js';
import { openAvatarEditor } from './avatar-editor.js';
import { initLayout } from './layout.js';
import { setBrandOverride, noteAppName, noteStatus } from './brand.js';

const $ = id => document.getElementById(id);
const cfg = await (await fetch('/config.json')).json();
const params = new URLSearchParams(location.search);
const lang = params.get('lang') || cfg.language || 'en';
const ui = UI[lang] || UI.id;
// The booth app's name (brand.js): the "brandName" setting, else the last one the server saw;
// every status poll below keeps it up to date.
setBrandOverride(cfg.brandName);
noteAppName(cfg.brandSeen);
document.documentElement.lang = lang;

const avatar = new Avatar($('stage'));
const speech = new Voice({ lang, browserVoice: cfg.voice, browserFallback: cfg.tts?.browserFallback, gender: cfg.avatarGender });
const mic = new Mic({ device: cfg.micDevice || '', sensitivity: cfg.micSensitivity ?? 5 });
let status = null;          // last good status (null = offline / not yet)
let online = null;
let lastActivity = performance.now();

// ---- Avatar (loaded by the start-up screen, see the end) ----
(function loop() {
  avatar.setMouth(speech.mouth(performance.now()));
  avatar.update();
  // the thinking bubble rides beside the head (on the side of the hand at the chin)
  const think = $('think');
  if (!think.hidden) {
    const st = $('stage').getBoundingClientRect(), h = avatar.headScreen();
    if (h) { think.style.left = st.x + h.x + st.height * 0.1 + 'px'; think.style.top = st.y + h.y + 'px'; }
  }
  requestAnimationFrame(loop);
})();

// ---- Voice (no words on screen: only the debug panel shows them) ----
speech.onText = text => { if (text) $('dbgSaid').textContent = 'said: ' + text; };
speech.onSource = src => log('voice: ' + src);

// Chromium blocks audio until the page gets a tap. The desktop app passes
// --autoplay-policy=no-user-gesture-required and ?autostart=1 to skip this.
let active = params.get('autostart') === '1';
if (active) speech.unlock();
else {
  $('activate').textContent = ui.tapToStart;
  $('activate').hidden = false;
  $('activate').onclick = () => { $('activate').hidden = true; speech.unlock(); active = true; status = null; };
}

// While a conversation turn runs, the fixed script keeps quiet (the LLM is
// already talking about what it just did), except the camera's timed lines.
const TIMED = ['countFirst', 'countNext', 'retake'];
let talking = false;
let booted = false; // the start-up screen is done: the avatar may speak

let liveActive = false; // Gemini Live is connected: it speaks the booth's lines too (one voice)
let liveWanted = !!cfg.live; // Live is the brain, also while it (re)connects: no local voice / listening then
let livePending = null;      // the booth's latest line while Live reconnects, sent once it is back

function perform(r) {
  if (!active || !booted) return;
  if (talking && !TIMED.includes(r.key)) return;
  if (r.gesture) avatar.play(r.gesture);
  if (r.mood) avatar.flash(r.mood);
  if (liveActive) live.event(`Booth: ${r.key}. Kalimat yang disarankan: "${pick(lang, r.key, r.vars)}"`);
  else if (liveWanted) livePending = r; // Live is reconnecting (new guest, short drop): it says it then
  else speech.say(pick(lang, r.key, r.vars), r.interrupt);
  lastActivity = performance.now();
}

// ---- QBooth polling: each new screen / camera phase gets its line ----
async function poll() {
  const r = await qb.status();
  const ok = !!(r.ok && r.data);
  if (ok) noteStatus(r.data);
  setOnline(ok, ok ? null : r.error);
  if (ok && active) {
    const cur = r.data;
    // The guest is done: Live forgets the talk before the next guest. (Not at the start:
    // a session started by voice would cut Live off in the middle of its answer.)
    if (liveActive && !cur.session?.active && status?.session?.active) { liveResetting = true; live.reset(); }
    for (const x of react(status, cur)) perform(x);
    status = cur;
    idleInvite(cur);
  } else if (!ok) status = null;
  renderDebug(ok ? r.data : null);
  setTimeout(poll, cfg.pollMs || 400);
}

function setOnline(ok, error) {
  if (ok === online) return;
  online = ok;
  $('dot').className = 'dot ' + (ok ? 'ok' : 'bad');
  $('conn').textContent = ok ? `connected${cfg.mock ? ' (MOCK)' : ''}` : `offline: ${error?.code || '?'}${error?.code === 'unauthorized' ? ' (check the password)' : ''}`;
  log(ok ? 'booth connected' : 'booth not reachable: ' + (error?.message || error?.code));
}

// While the booth sits on Welcome and nobody is around, invite now and then.
function idleInvite(cur) {
  if (cur.page !== 'welcome' || speech.speaking || cur.busy?.dialog) return;
  if (performance.now() - lastActivity > (cfg.idleInviteSec || 30) * 1000) {
    perform({ key: 'invite', gesture: Math.random() < 0.5 ? 'wave' : 'present' });
  }
}

// ---- Conversation: tap the character -> /listen (speech to text) -> /chat (LLM, streamed) ----
// AI servers: 'starting', 'ready', or 'off' (not installed / failed).
let ai = 'starting';
// idle | listening | thinking | auto (hands-free, waiting for speech): the character
// shows "listening"; the debug panel shows the rest.
let talkState = 'idle';
function setTalkState(state) {
  talkState = state;
  avatar.setListening(state === 'listening');
  // "thinking…" (hand to the chin + the bubble) until the answer starts
  avatar.setThinking(state === 'thinking');
  $('think').hidden = state !== 'thinking';
  $('dbgMic').textContent = `talk: ${state}${ai !== 'ready' ? ` (AI ${ai})` : ''}${mic.stream ? ' · mic: ' + (mic.stream.getAudioTracks()[0]?.label || '?') : ''}`;
}
setTalkState('idle');

function showHeard(text) { if (text) $('dbgHeard').textContent = 'heard: ' + text; }

async function talk() {
  if (!active || !booted) return;
  if (liveActive) { liveTapUntil = performance.now() + 10000; speech.stopStream(); setTalkState('listening'); return; }
  if (liveWanted || ai !== 'ready') return; // Live is reconnecting / the AI is not up yet
  if (mic.recording) { mic.stop(); return; }
  if (talking) return;
  speech.stop(); // barge in
  talking = true;
  setTalkState('listening');
  try {
    const recording = mic.record();
    await mic.open();
    const wav = await recording;
    if (!wav) { log('mic: no speech heard'); return; }
    setTalkState('thinking');
    const t0 = performance.now();
    const r = await (await fetch(`/listen?lang=${lang}`, { method: 'POST', body: wav })).json();
    if (!r.ok) throw new Error(r.error?.message || 'speech to text failed');
    if (!r.text) { speech.say(pick(lang, 'notHeard'), true); return; }
    await ask(r.text, { sttMs: r.ms, t0 });
    lastExchange = performance.now();
  } catch (err) {
    log('talk: ' + err.message);
    speech.say(pick(lang, 'aiOffline'), true);
  } finally {
    talking = false;
    setTalkState('idle');
  }
}

// Send the guest's words to the LLM and speak the reply sentence by sentence.
// timing: { sttMs, t0 } from a spoken question, for the debug panel's latency line.
async function ask(text, timing = {}) {
  const t0 = timing.t0 ?? performance.now();
  let firstMs = null;
  talking = true;
  showHeard(text);
  setTalkState('thinking');
  lastActivity = performance.now();
  const res = await fetch('/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, lang }) });
  if (!res.ok) throw new Error((await res.json()).error?.code || 'chat failed');
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', first = true;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const m = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (m.t === 'say') {
        if (first) { first = false; setTalkState('idle'); avatar.play('nod'); log('LLM: ' + m.text); }
        speech.say(m.text);
      } else if (m.t === 'timing') {
        firstMs = m.firstMs;
        // When the first sentence starts playing, show where the time went.
        const shown = () => {
          if (!speech.speaking) return setTimeout(shown, 50);
          const total = (performance.now() - t0) / 1000;
          $('dbgTime').textContent = 'answer after ' + total.toFixed(1) + ' s  (' +
            (timing.sttMs != null ? `speech to text ${(timing.sttMs / 1000).toFixed(1)} s · ` : '') +
            `LLM first sentence ${(firstMs / 1000).toFixed(1)} s · voice + rest ${(total - firstMs / 1000 - (timing.sttMs || 0) / 1000).toFixed(1)} s)`;
        };
        shown();
      } else if (m.t === 'action') log(`LLM action: ${m.tool} -> ${m.ok ? 'ok' : m.code}`);
      else if (m.t === 'error') { log('LLM error: ' + m.message); speech.say(pick(lang, 'aiOffline')); }
    }
  }
  setTalkState('idle');
  // Keep the fixed script quiet until the reply has been spoken.
  await new Promise(r => { const w = () => (speech.speaking || speech.queue.length ? setTimeout(w, 200) : r()); w(); });
  lastActivity = performance.now();
  talking = false;
}

// ---- Hands-free: "auto" = always listening, "wake" = the assistant's name first ----
// While the avatar speaks nobody is recorded (it would hear itself); a take that
// overlaps its voice is thrown away. Tapping the character still works.
const WAKE_WINDOW_MS = 30000; // after a reply, a follow-up needs no name
const FILLER = /^(h+m+|e+h+|a+h+|o+h+|e+m+|u+h+|ya|iya|oke|ok)$/;
let lastExchange = -1e9, lastSaid = '', lastSpeechEnd = 0, autoRec = false;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const words = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
// The name, also slightly misheard ("Lumah", "Luna" for "Luma").
const hasName = text => {
  const name = words(cfg.assistantName || 'Luma').join('');
  return words(text).some(w => w === name || (w.length >= 4 && lev(w, name) <= 1));
};
// Mostly the words the avatar just said: it heard itself (speaker into mic).
// Only a longer take: a short answer naturally repeats the avatar's own words ("…atau lanjut
// proses?" -> "Proses."), and was thrown away as an echo.
const isEcho = text => {
  const said = new Set(words(lastSaid)), w = words(text);
  return w.length >= 4 && w.filter(x => said.has(x)).length / w.length > 0.7;
};
{
  const show = speech.onText;
  speech.onText = text => {
    show(text);
    if (text) { lastSaid = text; if (autoRec) mic.cancel(); }
    else lastSpeechEnd = performance.now();
  };
}

async function handsFree() {
  for (;;) {
    const mode = cfg.listenMode || 'tap';
    const idle = booted && active && ai === 'ready' && !talking && !liveWanted && !settings.isOpen()
      && !speech.speaking && !speech.queue.length && performance.now() - lastSpeechEnd > 700;
    if (mode === 'tap' || !idle) { await sleep(300); continue; }
    autoRec = true;
    setTalkState('auto');
    let wav = null;
    try { wav = await mic.record({ noSpeechMs: 8000, minSpeechMs: 450 }); }
    catch (err) { log('mic: ' + err.message); await sleep(2000); }
    autoRec = false;
    if (!wav || talking) { if (!talking) setTalkState('idle'); continue; }
    talking = true;
    setTalkState('thinking');
    try {
      const t0 = performance.now();
      const r = await (await fetch(`/listen?lang=${lang}`, { method: 'POST', body: wav })).json();
      const text = (r.ok && r.text || '').trim();
      const w = words(text);
      const inTalk = performance.now() - lastExchange < WAKE_WINDOW_MS;
      if (!w.length || (w.length === 1 && FILLER.test(w[0]))) log(`heard, ignored: ${text || '-'}`);
      else if (isEcho(text)) log(`heard my own voice, ignored: ${text}`);
      else if (mode === 'wake' && !inTalk && !hasName(text)) log(`heard, no name, ignored: ${text}`);
      else { await ask(text, { sttMs: r.ms, t0 }); lastExchange = performance.now(); }
    } catch (err) {
      log('listen: ' + err.message);
    } finally {
      talking = false;
      setTalkState('idle');
    }
  }
}
handsFree();

// ---- Gemini Live (llm.provider "gemini-live") ----
let live = null, liveTapUntil = 0, liveResetting = false, liveFails = 0, heardTurn = '', saidTurn = '';
function startLive() {
  live = new LiveLink({
    speech, mic,
    handlers: {
      onReady: m => {
        if (!liveWanted) log('Gemini Live: back, leaving the local mode');
        liveActive = liveWanted = true;
        liveFails = 0;
        liveResetting = false;
        log(`Gemini Live: ready (voice ${m.voice})`);
        liveIdle();
        live.startMic().catch(err => log('mic: ' + err.message));
        if (livePending) { const r = livePending; livePending = null; perform(r); }
      },
      onHeard: t => { heardTurn += t; showHeard(heardTurn.trim()); lastExchange = performance.now(); lastActivity = performance.now(); },
      onSaid: t => { if (talkState === 'thinking') liveIdle(); saidTurn += t; $('dbgSaid').textContent = 'said: ' + saidTurn.trim(); lastSaid = saidTurn; },
      onTurn: () => { heardTurn = ''; saidTurn = ''; liveTapUntil = 0; if (!speech.speaking) liveIdle(); },
      onAction: m => log(`Live action: ${m.tool} -> ${m.ok ? 'ok' : m.code}`),
      onSpeechStart: () => setTalkState('listening'),
      onSpeechEnd: () => setTalkState('thinking'),
      onLog: log,
      // Who may be heard: not while the avatar speaks (it would hear itself) unless
      // barge-in is on; in tap mode only after a tap on the character.
      canSend: () => booted && !settings.isOpen()
        && (cfg.live?.bargeIn || (!speech.speaking && performance.now() - lastSpeechEnd > 400))
        && ((cfg.listenMode || 'tap') !== 'tap' || performance.now() < liveTapUntil),
      onClosed: wasReady => {
        liveActive = false;
        mic.stopStream();
        if (wasReady && !liveResetting) log('Gemini Live: disconnected');
        if (!liveResetting && ++liveFails > 3) {
          // Live is down (no internet, Google busy): the local voice and brain take over,
          // and Live is tried again every 30 s in the background.
          if (liveWanted) log('Gemini Live: unavailable, using the local mode');
          liveWanted = false;
          if (livePending) { const r = livePending; livePending = null; perform(r); }
          setTalkState('idle');
          setTimeout(() => { liveFails = 3; startLive(); }, 30000);
          return;
        }
        setTimeout(startLive, liveResetting ? 200 : 2000);
      },
    },
  });
  live.connect();
}
speech.onStreamEnd = () => {
  lastSpeechEnd = performance.now();
  if (liveActive) setTimeout(() => { if (!speech.speaking && !live.sending) liveIdle(); }, 300);
};
// Idle state in Live mode: listening by itself, or waiting for a tap.
function liveIdle() { setTalkState((cfg.listenMode || 'tap') === 'tap' ? 'idle' : 'auto'); }

// Status of the local AI servers, for the debug panel and talking.
async function pollServices() {
  try {
    const s = await (await fetch('/services')).json();
    $('dbgAi').textContent = `speech-to-text: ${s.stt.state}${s.stt.error ? ` (${s.stt.error})` : ''} · LLM: ${s.llm.state}${s.llm.error ? ` (${s.llm.error})` : ''}`;
    ai = s.stt.state === 'ready' && s.llm.state === 'ready' ? 'ready'
      : [s.stt.state, s.llm.state].some(x => x === 'failed' || x === 'off' || x === 'stopped') ? 'off' : 'starting';
  } catch { }
  setTimeout(pollServices, 3000);
}
pollServices();

// ---- Debug panel (?debug=1, or D with the window focused) ----
function renderDebug(s) {
  $('dbgState').textContent = s
    ? `${s.app?.name} ${s.app?.version} · event: ${s.event?.name || '-'} · page: ${s.page}` +
      (s.camera ? ` · cam: ${s.camera.phase} ${s.camera.captured}/${s.camera.shots}` : '') +
      (s.busy?.processing ? ' · processing' : '') + (s.busy?.dialog ? ' · dialog' : '')
    : `booth ${cfg.qbooth.host}:${cfg.qbooth.port}`;
}
function log(msg) {
  console.log('[assistant]', msg);
  $('dbgLast').textContent = msg;
}
$('debug').hidden = params.get('debug') !== '1';
if (params.get('debug') === '1') window.assistant = { avatar, speech, ask, mic, talk }; // for the console / tests

// ---- Settings (hold the character 5 s, Ctrl+Alt+Shift+S, or S with the window focused) ----
const settings = initSettings({
  lang, locked: cfg.settingsLocked, onOpen: () => speech.stop(),
  onAvatar: pin => openAvatarEditor({ avatar, cfg, lang, pin }),
});

addEventListener('keydown', e => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || settings.isOpen()) return;
  if (e.key === 's' || e.key === 'S') { e.preventDefault(); settings.open(); return; }
  if (e.key === 'd' || e.key === 'D') $('debug').hidden = !$('debug').hidden;
  if ((e.key === 't' || e.key === 'T') && !talking) { // type instead of speaking (testing without a mic)
    e.preventDefault();
    const q = prompt(ui.typePrompt);
    if (q?.trim()) ask(q.trim()).catch(err => { log('chat: ' + err.message); talking = false; });
  }
});

// ---- The screen: the character + two buttons, each placed on its own (layout.js) ----
const layout = initLayout({
  cfg, stage: $('stage'), boot: $('boot'), langBtn: $('langBtn'), menuBtn: $('menuBtn'),
  onChange: () => avatar.resize(), labels: ui,
});
const position = () => { settings.close(); closeLangs(); layout.edit(); };
window.__qba = { settings: () => settings.open(), position }; // the secret keys (electron/main.js)

// ☰ = the settings (the PIN first, when one is set)
$('menuBtn').onclick = () => { if (!layout.isEditing()) settings.open(); };

// The language button: Bahasa Indonesia / English / 中文, next to it. With a settings PIN
// set it asks for it first (unless "overlay.langPin" is off: guests may switch then).
const LANG_NAMES = [['id', 'Bahasa Indonesia'], ['en', 'English'], ['zh', '中文']];
const pop = $('langPop');
function closeLangs() { pop.hidden = true; }
$('langBtn').onclick = async () => {
  if (layout.isEditing()) return;
  if (!pop.hidden) return closeLangs();
  if (cfg.overlay?.langPin !== false && !(await settings.unlock())) return;
  pop.replaceChildren(...LANG_NAMES.map(([code, name]) => Object.assign(document.createElement('button'), {
    type: 'button', textContent: name, className: code === lang ? 'on' : '',
    onclick: async () => {
      closeLangs();
      if (code === lang) return;
      await fetch('/settings/language', { method: 'POST', body: JSON.stringify({ language: code }) });
      location.reload(); // the page, the voice and Live in the new language
    },
  })));
  // beside the button, on the side with room
  const r = $('langBtn').getBoundingClientRect();
  pop.hidden = false;
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  pop.style.left = Math.max(8, Math.min(innerWidth - pw - 8, r.left + r.width / 2 - pw / 2)) + 'px';
  pop.style.top = (r.bottom + ph + 8 < innerHeight ? r.bottom + 8 : Math.max(8, r.top - ph - 8)) + 'px';
  clearTimeout(closeLangs.t);
  closeLangs.t = setTimeout(closeLangs, 15000);
};

// tap the character = talk, hold it 5 s = settings
let hold = null, held = false;
$('stage').addEventListener('pointerdown', () => {
  held = false;
  clearTimeout(hold);
  hold = setTimeout(() => { held = true; settings.open(); }, 5000);
});
addEventListener('pointerup', () => clearTimeout(hold));
$('stage').addEventListener('click', () => { if (!held && !layout.isEditing()) talk(); });

// The window covers the screen and is cut to what shows: the character (from its bones),
// the bubble, the two buttons, the language list, the start-up / debug boxes; all of it
// while the settings, the language screen, the avatar editor or the placing are open.
if (cfg.desktop) {
  let sent = '';
  const FULL = '.set-overlay, .av-panel, .lang-screen, .overlay:not([hidden]), body.lay-editing';
  const seen = el => !el.hidden && el.checkVisibility();
  const rectOf = (el, extra = 0) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height + extra }; };
  setInterval(() => {
    document.body.classList.toggle('full', !!document.querySelector('.set-overlay, .lang-screen'));
    let rects = [];
    if (document.querySelector(FULL)) rects = [{ x: 0, y: 0, width: innerWidth, height: innerHeight }];
    else {
      const st = $('stage').getBoundingClientRect(), a = avatar.screenBox();
      if (a && !$('boot').checkVisibility()) rects.push({ x: st.x + a.x, y: st.y + a.y, width: a.width, height: a.height });
      if (seen($('think'))) rects.push(rectOf($('think'), 12));
      for (const el of [$('langBtn'), $('menuBtn'), pop, $('boot'), $('debug')]) if (seen(el)) rects.push(rectOf(el));
    }
    // whole pixels, 8 px steps: the window is only re-cut when something really moved
    rects = rects.filter(r => r.width > 0 && r.height > 0).map(r => ({ x: Math.floor(r.x / 8) * 8, y: Math.floor(r.y / 8) * 8, width: Math.ceil((r.width + 8) / 8) * 8, height: Math.ceil((r.height + 8) / 8) * 8 }));
    if (!rects.length) rects = [{ x: 0, y: 0, width: 1, height: 1 }];
    const sig = JSON.stringify(rects);
    if (sig === sent) return;
    sent = sig;
    fetch('/app/shape', { method: 'POST', body: JSON.stringify({ rects }) }).catch(() => { sent = ''; });
  }, 250);
}

// Frames drawn so far: the desktop app's watchdog reads it to spot a frozen screen.
(function countFrames() { window.__frames = (window.__frames || 0) + 1; requestAnimationFrame(countFrames); })();

poll();

// Language screen at launch (askLanguage, default on): the avatar speaks the language
// chosen here. Skipped after a reload this screen caused (?lang=…), and after 20 s.
async function chooseLanguage() {
  if (cfg.askLanguage === false || params.get('lang') || sessionStorage.getItem('qba.langChosen')) return;
  const pick = await new Promise(resolve => {
    const btn = (code, label, sub) => Object.assign(document.createElement('button'), { className: 'lang-btn' + (code === lang ? ' current' : ''), innerHTML: `<b>${label}</b><small>${sub}</small>`, onclick: () => resolve(code) });
    const box = document.createElement('div');
    box.className = 'lang-screen';
    box.append(Object.assign(document.createElement('h1'), { textContent: 'Pilih bahasa · Choose your language · 选择语言' }),
      Object.assign(document.createElement('div'), { className: 'lang-row' }), Object.assign(document.createElement('div'), { className: 'lang-auto' }));
    box.querySelector('.lang-row').append(btn('id', 'Bahasa Indonesia', 'Avatar berbicara bahasa Indonesia'), btn('en', 'English', 'The avatar speaks English'), btn('zh', '中文', '助手说普通话'));
    document.body.append(box);
    let left = 20;
    const tick = setInterval(() => { box.querySelector('.lang-auto').textContent = `${{ en: 'English', zh: '中文' }[lang] || 'Bahasa Indonesia'} · ${left}s`; if (--left < 0) resolve(lang); }, 1000);
    chooseLanguage.done = () => { clearInterval(tick); box.remove(); };
  });
  chooseLanguage.done();
  try { sessionStorage.setItem('qba.langChosen', '1'); } catch { }
  if (pick === lang) return;
  await fetch('/settings/language', { method: 'POST', body: JSON.stringify({ language: pick }) });
  location.reload(); // the page, the voice and Live in the new language
  await new Promise(() => { }); // (the reload takes over)
}

// Start-up screen: everything loads behind it; the avatar greets once it is gone.
runBoot({
  lang, cfg,
  loadAvatar: async () => {
    const file = params.get('avatar') || cfg.avatar;
    await avatar.load(file);
    avatar.applyStyle(cfg.avatarStyle?.[file]); // colours, glasses (avatar editor)
  },
  warmVoice: async () => { // the first take of Piper loads its model: do it now
    const r = await fetch(`/speak?lang=${lang}&text=${encodeURIComponent(pick(lang, 'greet'))}`);
    return r.ok ? 'server' : 'browser';
  },
  boothOnline: async () => !!(await qb.status()).ok,
}).then(chooseLanguage).then(() => {
  booted = true;
  status = null; // react to the current page as if new: the greeting
  log('ready');
  if (cfg.live) startLive();
});
