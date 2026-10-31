// Start-up screen: a progress bar and the step being worked on, until the
// avatar, speech to text, the AI brain, the voice and the booth link are ready.
// Steps that fail are shown and skipped, so the assistant still starts (with less).
// {booth} / {Booth}: the booth app's name (brand.js), filled at each render (it becomes known
// while this screen is up).
import { fillBooth } from './brand.js';

const T = {
  id: {
    title: 'Avatar', avatar: 'Memuat avatar', stt: 'Menyalakan pendengaran', llm: 'Menyiapkan otak AI',
    voice: 'Menyiapkan suara', booth: 'Menghubungkan ke {booth}', warming: 'memanaskan', loading: 'memuat model',
    cloud: 'cloud', mock: 'mode uji (mock)', offline: '{Booth} belum terhubung, lanjut dulu', ready: 'Siap!',
    failed: 'tidak aktif', browserVoice: 'suara browser', cloudFailed: 'cloud gagal, pakai AI lokal',
    download: 'Mengunduh (sekali saja)', downloadFailed: 'Unduhan gagal',
    havePart: 'Sudah punya filenya? Pilih', copying: 'Menyalin…',
    parts: { 'AI brain': 'Otak AI', 'AI brain model': 'Model otak AI', 'speech recognition': 'Pengenal suara', 'speech model': 'Model pengenal suara', 'voice engine': 'Mesin suara', voice: 'Suara' },
  },
  zh: {
    title: 'Avatar', avatar: '加载形象', stt: '启动语音识别', llm: '准备 AI', voice: '准备声音', booth: '连接{booth}',
    warming: '预热中', loading: '加载模型', cloud: '云端', mock: '测试模式（mock）', offline: '{booth}还没连上，先继续', ready: '准备好了！',
    failed: '未运行', browserVoice: '浏览器声音', cloudFailed: '云端失败，使用本地 AI',
    download: '下载中（仅一次）', downloadFailed: '下载失败',
    havePart: '已有这个文件？选择', copying: '复制中…',
    parts: { 'AI brain': 'AI 程序', 'AI brain model': 'AI 模型', 'speech recognition': '语音识别程序', 'speech model': '语音识别模型', 'voice engine': '语音引擎', voice: '声音' },
  },
  en: {
    title: 'Avatar', avatar: 'Loading the avatar', stt: 'Starting speech recognition', llm: 'Getting the AI brain ready',
    voice: 'Getting the voice ready', booth: 'Connecting to {booth}', warming: 'warming up', loading: 'loading the model',
    cloud: 'cloud', mock: 'test mode (mock)', offline: '{Booth} not connected yet, carrying on', ready: 'Ready!',
    failed: 'not running', browserVoice: 'browser voice', cloudFailed: 'cloud failed, using the local AI',
    download: 'Downloading (first start only)', downloadFailed: 'Download failed',
    havePart: 'Have it already? Choose', copying: 'Copying…',
    parts: { 'AI brain': 'AI brain', 'AI brain model': 'AI brain model', 'speech recognition': 'Speech recognition', 'speech model': 'Speech model', 'voice engine': 'Voice engine', voice: 'Voice' },
  },
};
// Rough durations (s) for the bar to move while a step is busy.
const EXPECT = { avatar: 3, stt: 6, llm: 15, voice: 2, booth: 4 };
const WEIGHT = { avatar: 1, stt: 2, llm: 4, voice: 1, booth: 1 };

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function runBoot({ lang, cfg, loadAvatar, warmVoice, boothOnline }) {
  const t = T[lang] || T.id;
  const root = document.getElementById('boot');
  root.innerHTML = `<div class="boot-box"><h1>${t.title}</h1><div class="boot-bar"><i></i></div>
    <div class="boot-now"></div><ul class="boot-steps"></ul></div>`;
  root.hidden = false;
  const bar = root.querySelector('.boot-bar i'), now = root.querySelector('.boot-now'), list = root.querySelector('.boot-steps');

  // First start from the source folder: the missing tools and models download before the rest
  // (setup.js), with the real progress. Already there: this passes in a moment.
  const mb = n => Math.round(n / 1048576);
  // Desktop app: "I have this file already" -> a file dialog, the app copies it in instead.
  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = 'boot-pick';
  pick.hidden = true;
  const pickNote = document.createElement('small');
  pickNote.className = 'boot-pick-note';
  now.after(pick, pickNote);
  pick.onclick = async () => {
    pick.disabled = true;
    pickNote.textContent = t.copying;
    try {
      const r = await (await fetch('/app/pick-part', { method: 'POST', body: '{}' })).json();
      pickNote.textContent = r.ok || r.cancelled ? '' : r.error;
    } catch (err) { pickNote.textContent = err.message; }
    pick.disabled = false;
  };
  for (;;) {
    let d;
    try { d = (await (await fetch('/services')).json()).setup; } catch { await sleep(500); continue; }
    if (d?.state === 'downloading') {
      bar.style.width = (d.total ? 100 * d.done / d.total : 0).toFixed(1) + '%';
      const part = t.parts[d.label] || String(d.label || '').replace(/^voice /, t.parts.voice + ' ');
      now.textContent = `${t.download}: ${part} (${d.step}/${d.steps}) · ${mb(d.done)} / ${mb(d.total)} MB`;
      pick.hidden = !cfg.desktop || !d.expect;
      if (d.expect && !pick.disabled) pick.textContent = `${t.havePart} ${d.expect.name}`;
    } else if (d?.state !== 'checking') {
      pick.remove();
      pickNote.remove();
      if (d?.state === 'failed') { // the app starts with what it has; the steps below show what is off
        const li = document.createElement('li');
        li.className = 'boot-skip';
        li.textContent = `⚠  ${t.downloadFailed}: ${d.part} · ${d.error}`;
        list.append(li);
      }
      break;
    }
    await sleep(500);
  }
  bar.style.width = '0%';

  const steps = Object.fromEntries(Object.keys(WEIGHT).map(k => {
    const li = document.createElement('li');
    list.append(li);
    return [k, { li, state: 'wait', detail: '', t0: 0 }];
  }));
  const set = (k, state, detail = '') => {
    const s = steps[k];
    if (state === 'busy' && s.state !== 'busy') s.t0 = performance.now();
    s.state = state;
    s.detail = detail;
  };
  const render = () => {
    let done = 0, total = 0, current = null;
    for (const [k, s] of Object.entries(steps)) {
      total += WEIGHT[k];
      if (s.state === 'done' || s.state === 'skip') done += WEIGHT[k];
      else if (s.state === 'busy') { done += WEIGHT[k] * Math.min(0.9, (performance.now() - s.t0) / 1000 / EXPECT[k] * 0.9); current ||= k; }
      const icon = { wait: '○', busy: '◌', done: '✓', skip: '⚠' }[s.state];
      s.li.className = 'boot-' + s.state;
      s.li.textContent = `${icon}  ${fillBooth(t[k], lang)}${s.detail ? ' · ' + fillBooth(s.detail, lang) : ''}`;
    }
    bar.style.width = (100 * done / total).toFixed(1) + '%';
    now.textContent = current ? `${fillBooth(t[current], lang)}${steps[current].detail ? ' (' + fillBooth(steps[current].detail, lang) + ')' : ''}…` : t.ready;
  };
  const ticker = setInterval(render, 100);

  // Avatar and voice in the browser, the AI servers on the server: all at once.
  set('avatar', 'busy');
  const avatarDone = loadAvatar().then(() => set('avatar', 'done'), err => set('avatar', 'skip', err.message));
  set('voice', 'busy');
  const voiceDone = warmVoice().then(v => set('voice', 'done', v === 'browser' ? t.browserVoice : ''), () => set('voice', 'skip', t.failed));
  set('booth', 'busy', cfg.mock ? t.mock : '');

  const aiDone = (async () => {
    for (;;) {
      let s;
      try { s = await (await fetch('/services')).json(); } catch { await sleep(500); continue; }
      const stt = s.stt, llm = s.llm;
      const sttName = /GPU/.test(stt.name || '') ? 'GPU' : /CPU/.test(stt.name || '') ? 'CPU' : '';
      if (stt.state === 'ready') set('stt', 'done', sttName);
      else if (['failed', 'off', 'stopped'].includes(stt.state)) set('stt', 'skip', stt.error || t.failed);
      else set('stt', 'busy', sttName);
      if (llm.state === 'ready') set('llm', llm.cloudError ? 'skip' : 'done', llm.cloudError ? t.cloudFailed : llm.via !== 'local' ? `${llm.via}, ${t.cloud}` : '');
      else if (['failed', 'off', 'stopped'].includes(llm.state)) set('llm', 'skip', llm.error || t.failed);
      else set('llm', 'busy', llm.state === 'warming' ? t.warming : t.loading);
      if (['done', 'skip'].includes(steps.stt.state) && ['done', 'skip'].includes(steps.llm.state)) return;
      await sleep(500);
    }
  })();

  // The booth link: wait for it while the rest loads, then at most 6 s more.
  const boothDone = (async () => {
    const until = () => ['avatar', 'stt', 'llm', 'voice'].every(k => ['done', 'skip'].includes(steps[k].state));
    let extra = 0;
    for (;;) {
      if (await boothOnline()) { set('booth', 'done', cfg.mock ? t.mock : ''); return; }
      if (until() && (extra += 1) > 12) { set('booth', 'skip', t.offline); return; }
      await sleep(500);
    }
  })();

  await Promise.all([avatarDone, voiceDone, aiDone, boothDone]);
  render();
  await sleep(600);
  clearInterval(ticker);
  root.classList.add('boot-out');
  await sleep(500);
  root.hidden = true;
}
