// A fake QBooth Local API (v1) for testing the assistant without the real app.
// Same reply shapes and page / phase names as md_files/LOCAL_API.md in the QBooth repo.
// Flow: welcome -> templatePicker -> camera (3 shots, 1 retake) -> processing -> result.
import http from 'node:http';
import { listenRetry } from './listen.js';

const TEMPLATES = [
  { id: 't_strip', name: 'Strip 3', index: 1 },
  { id: 't_portrait', name: 'Portrait Gold', index: 2 },
  { id: 't_ai', name: 'Cinematic AI', index: 3 },
];

export function startMock(port, password) {
  const s = {
    event: { id: 'mock_EVENT', name: 'Mock Wedding' },
    page: 'welcome',
    session: { active: false, templateId: null, templateName: null },
    camera: null,
    result: null,
    busy: { dialog: false, processing: false },
  };
  let timers = [];
  const later = (ms, fn) => timers.push(setTimeout(fn, ms));
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };

  function available() {
    const a = [];
    if (s.busy.dialog || s.busy.processing) return s.event ? ['event/stop'] : [];
    if (!s.event) return ['event/start'];
    if (s.page === 'welcome') a.push('session/start', 'template/select');
    else a.push('session/end');
    if (s.page === 'templatePicker') a.push('template/select');
    const c = s.camera;
    if (c && (c.phase === 'liveIdle' || c.phase === 'shotDelay')) a.push('camera/capture');
    if (c && c.phase === 'review') { if (c.retakesLeft > 0) a.push('camera/retake'); a.push('camera/process'); }
    if (s.page === 'result') a.push('result/print', 'result/qr');
    a.push('event/stop');
    return a;
  }

  function status() {
    return {
      app: { name: 'QBooth (mock)', version: '0.0.0', apiVersion: '1' },
      event: s.event, page: s.event ? s.page : 'none', session: s.session,
      camera: s.camera, result: s.result, busy: s.busy, available: available(),
    };
  }

  function shoot(isRetake) {
    const c = s.camera;
    c.phase = 'counting';
    c.shot = isRetake ? c.shot : c.captured + 1;
    later(3000, () => { c.phase = 'capturing'; });
    later(3400, () => { c.phase = 'reveal'; if (!isRetake) c.captured++; });
    later(4600, () => {
      if (!isRetake && c.captured < c.shots) { c.phase = 'shotDelay'; later(1500, () => shoot(false)); }
      else c.phase = 'review';
    });
  }

  function toCamera(t) {
    s.session = { active: true, templateId: t.id, templateName: t.name };
    s.page = 'camera';
    s.camera = { phase: 'liveIdle', shot: 0, shots: 3, captured: 0, feed: 'live', retakesLeft: 1 };
  }

  function endSession() {
    clearTimers();
    Object.assign(s, { page: 'welcome', camera: null, result: null, busy: { dialog: false, processing: false } });
    s.session = { active: false, templateId: null, templateName: null };
  }

  const fail = (code, http, message) => ({ http, body: { ok: false, error: { code, message: message || code } } });
  const accepted = cmd => ({ http: 202, body: { ok: true, accepted: cmd } });
  const data = d => ({ http: 200, body: { ok: true, data: d } });

  function handle(cmd, p) {
    if (cmd === 'status') return data(status());
    if (cmd === 'events') return data([{ id: 'mock_EVENT', name: 'Mock Wedding', archived: false, templateCount: TEMPLATES.length, running: !!s.event }]);
    if (cmd === 'templates') return data(TEMPLATES.map(t => ({ ...t, onScreen: s.page === 'templatePicker' })));
    if (cmd === 'categories') return data([]);
    if (!available().includes(cmd)) {
      if (s.busy.dialog) return fail('dialog_open', 409);
      if (s.busy.processing) return fail('processing', 409);
      if (!s.event) return fail('no_event', 409);
      return fail(cmd.startsWith('camera/') && s.page === 'camera' ? 'wrong_phase' : 'wrong_page', 409);
    }
    switch (cmd) {
      case 'event/start': s.event = { id: 'mock_EVENT', name: 'Mock Wedding' }; endSession(); break;
      case 'event/stop': endSession(); s.event = null; break;
      case 'session/start': s.session.active = true; s.page = 'templatePicker'; break;
      case 'session/end': endSession(); break;
      case 'template/select': {
        const t = TEMPLATES.find(x => x.id === p.id) || TEMPLATES[(+p.index || 1) - 1];
        if (!t) return fail('unknown_template', 404);
        toCamera(t);
        break;
      }
      case 'camera/capture': shoot(false); break;
      case 'camera/retake': s.camera.retakesLeft--; shoot(true); break;
      case 'camera/process':
        s.busy.processing = true;
        later(4000, () => { s.busy.processing = false; s.page = 'result'; s.camera = null; s.result = { index: 1, count: 1 }; });
        break;
      case 'result/print': break;
      case 'result/qr': s.busy.dialog = true; later(6000, () => { s.busy.dialog = false; }); break;
    }
    return accepted(cmd);
  }

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      let r;
      if (!u.pathname.startsWith('/api/v1/')) r = fail('not_found', 404);
      else if ((req.headers.authorization || '') !== 'Bearer ' + password) r = fail('unauthorized', 401);
      else {
        let p = Object.fromEntries(u.searchParams);
        try { if (chunks.length) p = { ...p, ...JSON.parse(Buffer.concat(chunks).toString() || '{}') }; } catch { }
        r = handle(u.pathname.slice('/api/v1/'.length), p);
      }
      res.writeHead(r.http, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r.body));
    });
  });
  // Resolves with the server once listening (waits a while for a busy port).
  return listenRetry(server, port).catch(err => {
    throw new Error(err.code === 'EADDRINUSE' ? `Mock port ${port} is in use: another mock is probably running.` : err.message);
  });
}
