// Settings screen: hold the character 5 s, Ctrl+Alt+Shift+S, or S with the window focused.
// With a settings PIN set, the PIN is asked first. Saves through POST /settings (settings.js
// on the server). While it is open the window has the whole screen (main.js).
import { Mic, thresholds } from './mic.js';
import { fillBooth, isQBooth, onBrand, noteAppName, seenBrand } from './brand.js';

const T = {
  id: {
    title: 'Pengaturan', booth: '{boothShort}', mode: 'Koneksi', real: '{boothShort} (asli)', mock: 'Mock (uji tanpa {booth})',
    host: 'Alamat {boothShort}', port: 'Port Local API', password: 'Password Local API', kept: 'tersimpan (kosongkan = tetap)',
    testing: 'Mengetes…', assistant: 'Asisten', name: 'Nama asisten', language: 'Bahasa',
    pron: 'Kamus pelafalan', pronHint: 'Satu kata per baris: tulisan = cara membacanya. Contoh: QRIS = kris. QR, QRIS, template, scan, upload, online{qbooth} sudah diatur.',
    eventInfo: 'Info acara', eventHint: 'Nama acara, jadwal, letak toilet, dll. Asisten hanya menjawab dari sini.',
    look: 'Tampilan', avatar: 'Avatar', addVrm: 'Tambah VRM…', uploading: 'Mengunggah…',
    display: 'Layar', invite: 'Ajak tamu tiap (detik)',
    audio: 'Mikrofon', mic: 'Mikrofon', micDefault: '(bawaan sistem)', save: 'Simpan rekaman suara (untuk diagnosis)',
    saveHint: 'Hanya untuk uji: suara tamu = data pribadi.', security: 'Keamanan', pin: 'PIN pengaturan', pinHint: 'Kosong = tanpa PIN',
    clearPin: 'Hapus PIN', cancel: 'Batal', saveBtn: 'Simpan', saving: 'Menyimpan…', restarting: 'Menyimpan dan memulai ulang…',
    restartManual: 'Tersimpan. Berlaku setelah app dijalankan ulang.', enterPin: 'Masukkan PIN pengaturan', wrongPin: 'PIN salah',
    file: 'Disimpan di', sens: 'Sensitivitas mic', sensHint: 'Geser ke kanan kalau harus bicara keras. Bicara biasa: bar harus hijau, diam: abu-abu.',
    editAvatar: 'Ubah tampilan avatar…',
    talk: 'Gaya bicara', talks: { short: 'Singkat (1-2 kalimat)', normal: 'Normal (2-3 kalimat, ramah)', chatty: 'Cerewet (suka ngobrol, banyak tanya)' },
    talkHint: 'Seberapa panjang dan aktif avatar mengobrol. Cerewet: jawaban lebih lama terdengar dan lebih berat untuk AI lokal.',
    persona: 'Persona', personas: { ceria: 'Ceria & ramah', formal: 'Formal & profesional', kalem: 'Kalem & lembut', lucu: 'Lucu & jenaka', energik: 'Energik (gaya MC)' },
    liveName: 'Gemini Live (suara realtime, cloud)', voice: 'Suara', female: 'wanita', male: 'pria',
    bargeIn: 'Tamu boleh memotong', bargeInHint: 'Hanya kalau speaker tidak terdengar mic (headset atau mic searah): avatar bisa salah mendengar suaranya sendiri.',
    liveHint: 'Mendengar dan menjawab langsung dengan suara; butuh internet. Kalau putus, otomatis pakai mode lokal.',
    brain: 'Otak AI', provider: 'Dijalankan oleh', local: 'Komputer ini (offline)', gemini: 'Gemini (cloud, Google)', openrouter: 'OpenRouter (cloud)',
    apiKey: 'API key', model: 'Model', geminiHint: 'Ambil key gratis di aistudio.google.com/apikey',
    orLogin: 'Login dengan OpenRouter', orWaiting: 'Selesaikan login di browser…', orDone: '✓ Terhubung, key tersimpan', orFail: '✗ Login gagal',
    fallback: 'Pakai AI lokal kalau cloud gagal', fallbackHint: 'Internet di venue putus? Asisten tetap menjawab (memakai ~1 GB VRAM).',
    cloudHint: 'Cloud: kata-kata tamu dikirim ke penyedia AI.', testLlm: 'Tes otak AI',
    listen: 'Cara mendengar', tap: 'Ketuk karakternya', auto: 'Otomatis (dengar terus)', wake: 'Panggil nama dulu (mis. "Halo Luma")',
    listenHint: 'Otomatis: cocok untuk ruangan tenang. Panggil nama: lebih aman di acara ramai. Ketuk karakter selalu bisa.',
    screenGpu: 'GPU untuk tampilan', gpuAuto: 'Otomatis (pilihan Windows)', gpuNvidia: 'GPU NVIDIA', gpuSoft: 'Tanpa GPU (CPU, lebih berat)',
    gpuHint: 'Ganti kalau karakter beku/hilang atau ada kotak hitam di belakangnya. Berlaku setelah app dimulai ulang.',
    askLang: 'Pilih bahasa saat app dibuka', askLangHint: 'Layar Bahasa Indonesia / English / 中文 sebelum avatar menyapa.',
    connect: 'Hubungkan', connecting: 'Menghubungkan…', event: 'Event', connectFirst: '— hubungkan dulu —', pickEvent: '— pilih event —',
    run: 'Jalankan', stop: 'Hentikan', running: 'berjalan', starting: 'Menjalankan…', stopping: 'Menghentikan…', started: '✓ Event berjalan di {booth}',
    stopped: '✓ Event dihentikan', opening: '{Booth} sedang membuka event…', notYet: 'Perintah terkirim, tapi event belum terlihat berjalan. Cek layar {booth}.',
    dialog: 'Ada dialog di layar {booth}: selesaikan di sana dulu.', otherRunning: 'Event lain sedang berjalan: hentikan dulu.',
    tplCount: '{n} template', autoStart: 'Jalankan event ini saat app dibuka', autoStartHint: 'Hanya kalau di {booth} belum ada event yang berjalan.',
    brandName: 'Nama brand', brandHint: 'Kosong = nama yang dilaporkan aplikasi booth.',
    ovSide: 'Posisi awal', right: 'Kanan bawah', left: 'Kiri bawah', ovSize: 'tinggi', ovPlace: 'Atur posisi karakter & tombol…',
    ovHint: 'Posisi awal dipakai sampai karakter dan tombol diatur dengan "Atur posisi".',
    ovKeys: 'Ketuk karakter = bicara · tahan 5 detik = pengaturan · Ctrl+Alt+Shift+S pengaturan · Ctrl+Alt+Shift+P atur posisi · Ctrl+Alt+Shift+Q keluar',
    menuBtn: 'Tombol menu (☰)', menuBtnHint: 'Membuka pengaturan (minta PIN kalau ada). Tanpa tombol ini: tahan karakter 5 detik atau Ctrl+Alt+Shift+S.',
    langBtn: 'Tombol bahasa', langPin: 'Tombol bahasa minta PIN', langPinHint: 'Hanya kalau PIN pengaturan diisi. Matikan supaya tamu bebas mengganti bahasa.',
    quit: 'Tutup app',
    voiceNow: 'Suara avatar', female: 'wanita', male: 'pria', voiceGender: 'ikut gender avatar (Ubah tampilan avatar → Suara)',
    voiceMissing: 'Suara {g} untuk bahasa ini belum terpasang di Windows, jadi dipakai suara lain. Pasang: Windows Settings → Time & language → Language & region → tambah bahasanya → Text-to-speech.',
    err: { offline: 'Tidak terhubung ({d}): apakah Local API di {booth} sudah aktif?', unauthorized: 'Password salah', too_many_attempts: 'Terlalu banyak password salah: tunggu satu menit',
      event_running: 'Sudah ada event yang berjalan', editor_open: 'Editor event di {booth} sedang terbuka: tutup dulu', dialog_open: 'Ada dialog di layar {booth}: selesaikan dulu',
      no_event: 'Tidak ada event yang berjalan', processing: 'Foto sedang diproses, tunggu sebentar', busy: '{Booth} sedang sibuk, coba lagi sebentar', unknown_event: 'Event tidak ditemukan',
      no_key: 'Belum ada API key', http: 'Penyedia AI mengembalikan error', local: 'AI lokal: lihat panel debug (D)' },
  },
  zh: {
    title: '设置', booth: '{boothShort}', mode: '连接', real: '{boothShort}（正式）', mock: 'Mock（不连{booth}测试）',
    host: '{boothShort} 地址', port: 'Local API 端口', password: 'Local API 密码', kept: '已保存（留空则不变）',
    testing: '测试中…', assistant: '助手', name: '助手名字', language: '语言',
    pron: '发音词典', pronHint: '每行一个：写法 = 读法。例如 QRIS = kris。QR、QRIS、template、scan、upload、online{qbooth} 已内置。',
    eventInfo: '活动信息', eventHint: '活动名称、时间安排、洗手间位置…… 助手只根据这里回答。',
    look: '外观', avatar: '形象', addVrm: '添加 VRM…', uploading: '上传中…',
    display: '屏幕', invite: '邀请客人间隔（秒）',
    audio: '麦克风', mic: '麦克风', micDefault: '（系统默认）', save: '保存语音录音（用于诊断）',
    saveHint: '仅供测试：客人的声音属于个人信息。', security: '安全', pin: '设置 PIN 码', pinHint: '留空 = 不设 PIN',
    clearPin: '删除 PIN', cancel: '取消', saveBtn: '保存', saving: '保存中…', restarting: '保存并重新启动…',
    restartManual: '已保存。重新启动应用后生效。', enterPin: '请输入设置 PIN 码', wrongPin: 'PIN 码错误',
    file: '保存于', sens: '麦克风灵敏度', sensHint: '如果要大声说话才行，就往右调。正常说话时条应变绿，安静时为灰色。',
    editAvatar: '编辑形象…',
    talk: '说话风格', talks: { short: '简短（1到2句）', normal: '正常（2到3句，友好）', chatty: '健谈（爱聊天，常提问）' },
    talkHint: '形象说话的长短和主动程度。健谈：回答说得更久，本地 AI 负担也更重。',
    persona: '性格', personas: { ceria: '开朗友好', formal: '正式专业', kalem: '温柔平静', lucu: '幽默俏皮', energik: '活力四射（主持人风格）' },
    liveName: 'Gemini Live（实时语音，云端）', voice: '声音', female: '女声', male: '男声',
    bargeIn: '客人可以打断', bargeInHint: '仅在扬声器声音传不到麦克风时开启（耳麦或指向性麦克风）：否则助手可能听到自己的声音。',
    liveHint: '直接听和用语音回答；需要网络。断网时自动改用本地模式。',
    brain: 'AI 大脑', provider: '运行在', local: '这台电脑（离线）', gemini: 'Gemini（云端，Google）', openrouter: 'OpenRouter（云端）',
    apiKey: 'API 密钥', model: '模型', geminiHint: '在 aistudio.google.com/apikey 免费获取密钥',
    orLogin: '用 OpenRouter 登录', orWaiting: '请在浏览器中完成登录…', orDone: '✓ 已连接，密钥已保存', orFail: '✗ 登录失败',
    fallback: '云端失败时使用本地 AI', fallbackHint: '现场断网？助手仍然可以回答（约占 1 GB 显存）。',
    cloudHint: '云端：客人的话会发送给 AI 服务商。', testLlm: '测试 AI 大脑',
    listen: '聆听方式', tap: '点击角色', auto: '自动（一直在听）', wake: '先叫名字（例如“你好 Luma”）',
    listenHint: '自动：适合安静的场地。先叫名字：热闹的活动更稳妥。点击角色随时可用。',
    screenGpu: '显示用的 GPU', gpuAuto: '自动（由 Windows 决定）', gpuNvidia: 'NVIDIA 显卡', gpuSoft: '不用 GPU（CPU，较吃力）',
    gpuHint: '如果角色卡住、消失或背后出现黑框，请更换。重新启动后生效。',
    askLang: '启动时选择语言', askLangHint: '助手打招呼前先显示 Bahasa Indonesia / English / 中文 选择画面。',
    connect: '连接', connecting: '连接中…', event: '活动', connectFirst: '— 请先连接 —', pickEvent: '— 选择活动 —',
    run: '运行', stop: '停止', running: '运行中', starting: '启动中…', stopping: '停止中…', started: '✓ 活动已在{booth}中运行',
    stopped: '✓ 活动已停止', opening: '{booth}正在打开活动…', notYet: '已发送，但活动还没有显示为运行中。请查看{booth}屏幕。',
    dialog: '{booth}屏幕上有一个对话框：请先在那里完成。', otherRunning: '另一个活动正在运行：请先停止它。',
    tplCount: '{n} 个模板', autoStart: '应用启动时运行此活动', autoStartHint: '仅当{booth}中还没有活动在运行时。',
    brandName: '品牌名称', brandHint: '留空 = 使用拍照亭应用报告的名称。',
    ovSide: '初始位置', right: '右下角', left: '左下角', ovSize: '高度', ovPlace: '摆放角色和按钮…',
    ovHint: '在摆放角色和按钮之前使用初始位置。',
    ovKeys: '点击角色 = 说话 · 按住 5 秒 = 设置 · Ctrl+Alt+Shift+S 设置 · Ctrl+Alt+Shift+P 摆放 · Ctrl+Alt+Shift+Q 退出',
    menuBtn: '菜单按钮（☰）', menuBtnHint: '打开设置（如设了 PIN 需输入）。没有它时：按住角色 5 秒，或 Ctrl+Alt+Shift+S。',
    langBtn: '语言按钮', langPin: '语言按钮需要 PIN', langPinHint: '仅在设置了 PIN 时有效。关闭后客人可以自由切换语言。',
    quit: '关闭应用',
    voiceNow: '形象声音', female: '女声', male: '男声', voiceGender: '跟随形象的性别（编辑形象 → 声音）',
    voiceMissing: 'Windows 中没有安装该语言的{g}，所以用其他声音代替。安装方法：Windows 设置 → 时间和语言 → 语言和区域 → 添加该语言 → 文本转语音。',
    err: { offline: '连接不上（{d}）：{booth}的 Local API 打开了吗？', unauthorized: '密码错误', too_many_attempts: '密码错误次数太多，请等一分钟',
      event_running: '已经有活动在运行', editor_open: '{booth}的活动编辑器正在打开：请先关闭', dialog_open: '{booth}屏幕上有对话框：请先完成',
      no_event: '没有正在运行的活动', processing: '照片正在处理，请稍候', busy: '{booth}正忙，请稍后再试', unknown_event: '找不到这个活动',
      no_key: '没有 API 密钥', http: '服务商返回错误', local: '本地 AI：请看调试面板（D）' },
  },
  en: {
    title: 'Settings', booth: '{boothShort}', mode: 'Connection', real: '{boothShort} (real)', mock: 'Mock (test without {booth})',
    host: '{boothShort} address', port: 'Local API port', password: 'Local API password', kept: 'saved (leave empty to keep)',
    testing: 'Testing…', assistant: 'Assistant', name: 'Assistant name', language: 'Language',
    pron: 'Pronunciations', pronHint: 'One a line: written = how to say it. E.g. QRIS = kris. QR, QRIS, template, scan, upload, online{qbooth} are built in.',
    eventInfo: 'Event info', eventHint: 'Event name, schedule, where the toilets are… The assistant only answers from this.',
    look: 'Look', avatar: 'Avatar', addVrm: 'Add VRM…', uploading: 'Uploading…',
    display: 'Screen', invite: 'Invite guests every (seconds)',
    audio: 'Microphone', mic: 'Microphone', micDefault: '(system default)', save: 'Save voice recordings (for diagnosis)',
    saveHint: "Testing only: guests' voices are personal data.", security: 'Security', pin: 'Settings PIN', pinHint: 'Empty = no PIN',
    clearPin: 'Remove PIN', cancel: 'Cancel', saveBtn: 'Save', saving: 'Saving…', restarting: 'Saving and restarting…',
    restartManual: 'Saved. Applies after the app is restarted.', enterPin: 'Enter the settings PIN', wrongPin: 'Wrong PIN',
    file: 'Saved in', sens: 'Mic sensitivity', sensHint: 'Slide right if you have to speak loudly. Normal speech should turn the bar green; silence grey.',
    editAvatar: 'Edit the avatar…',
    talk: 'Gaya bicara', talks: { short: 'Singkat (1-2 kalimat)', normal: 'Normal (2-3 kalimat, ramah)', chatty: 'Cerewet (suka ngobrol, banyak tanya)' },
    talkHint: 'Seberapa panjang dan aktif avatar mengobrol. Cerewet: jawaban lebih lama terdengar dan lebih berat untuk AI lokal.',
    talk: 'Talkativeness', talks: { short: 'Short (1-2 sentences)', normal: 'Normal (2-3 sentences, friendly)', chatty: 'Chatty (loves to talk, asks questions)' },
    talkHint: 'How long and how actively the avatar talks. Chatty: answers take longer to speak and are heavier for the local AI.',
    persona: 'Persona', personas: { ceria: 'Cheerful & friendly', formal: 'Formal & professional', kalem: 'Calm & gentle', lucu: 'Funny & playful', energik: 'Energetic (MC style)' },
    liveName: 'Gemini Live (real-time voice, cloud)', voice: 'Voice', female: 'female', male: 'male',
    bargeIn: 'Guests may interrupt', bargeInHint: 'Only when the speakers do not reach the mic (headset or directional mic): the avatar may hear itself.',
    liveHint: 'Hears and answers in voice directly; needs internet. Falls back to the local mode when it drops.',
    brain: 'AI brain', provider: 'Runs on', local: 'This computer (offline)', gemini: 'Gemini (cloud, Google)', openrouter: 'OpenRouter (cloud)',
    apiKey: 'API key', model: 'Model', geminiHint: 'Get a free key at aistudio.google.com/apikey',
    orLogin: 'Log in with OpenRouter', orWaiting: 'Finish the login in the browser…', orDone: '✓ Connected, key saved', orFail: '✗ Login failed',
    fallback: 'Use the local AI if the cloud fails', fallbackHint: 'Venue internet down? The assistant still answers (uses ~1 GB of VRAM).',
    cloudHint: "Cloud: the guests' words are sent to the AI provider.", testLlm: 'Test the AI brain',
    listen: 'Listening', tap: 'Tap the character', auto: 'Automatic (always listening)', wake: 'Say the name first (e.g. "Hi Luma")',
    listenHint: 'Automatic: for quiet rooms. Name first: safer at a busy event. Tapping the character always works.',
    screenGpu: 'GPU for the screen', gpuAuto: 'Automatic (Windows decides)', gpuNvidia: 'NVIDIA GPU', gpuSoft: 'No GPU (CPU, heavier)',
    gpuHint: 'Change it if the character freezes, vanishes or shows a black box behind it. Applies after a restart.',
    askLang: 'Choose the language at launch', askLangHint: 'A Bahasa Indonesia / English / 中文 screen before the avatar greets.',
    connect: 'Connect', connecting: 'Connecting…', event: 'Event', connectFirst: '— connect first —', pickEvent: '— pick an event —',
    run: 'Run', stop: 'Stop', running: 'running', starting: 'Starting…', stopping: 'Stopping…', started: '✓ The event is running in {booth}',
    stopped: '✓ Event stopped', opening: '{Booth} is opening the event…', notYet: 'Sent, but the event does not show as running yet. Check {booth}\'s screen.',
    dialog: 'A dialog is open on {booth}\'s screen: finish it there first.', otherRunning: 'Another event is running: stop it first.',
    tplCount: '{n} templates', autoStart: 'Run this event when the app opens', autoStartHint: 'Only when no event is running in {booth} yet.',
    brandName: 'Brand name', brandHint: 'Empty = the name the booth app reports.',
    ovSide: 'Start position', right: 'Bottom right', left: 'Bottom left', ovSize: 'height', ovPlace: 'Place the character & buttons…',
    ovHint: 'The start position is used until the character and buttons are placed.',
    ovKeys: 'Tap the character = talk · hold 5 s = settings · Ctrl+Alt+Shift+S settings · Ctrl+Alt+Shift+P placing · Ctrl+Alt+Shift+Q quit',
    menuBtn: 'Menu button (☰)', menuBtnHint: 'Opens the settings (PIN if set). Without it: hold the character 5 s, or Ctrl+Alt+Shift+S.',
    langBtn: 'Language button', langPin: 'Language button asks the PIN', langPinHint: 'Only when a settings PIN is set. Switch off to let guests change the language.',
    quit: 'Close the app',
    voiceNow: 'Avatar voice', female: 'female', male: 'male', voiceGender: "follows the avatar's gender (Edit the avatar → Voice)",
    voiceMissing: 'No {g} voice for this language is installed in Windows, so another one speaks. Install it: Windows Settings → Time & language → Language & region → add the language → Text-to-speech.',
    err: { offline: 'Not reachable ({d}): is the Local API on in {booth}?', unauthorized: 'Wrong password', too_many_attempts: 'Too many wrong passwords: wait a minute',
      event_running: 'An event is already running', editor_open: 'The event editor is open in {booth}: close it first', dialog_open: 'A dialog is open on {booth}\'s screen: finish it first',
      no_event: 'No event is running', processing: 'A photo is being processed: wait a moment', busy: '{Booth} is busy: try again in a moment', unknown_event: 'Event not found',
      no_key: 'No API key', http: 'The provider answered with an error', local: 'Local AI: see the debug panel (D)' },
  },
};

// Texts name the booth app with {booth} / {Booth} / {boothShort} (brand.js); {qbooth} lists
// Q-Booth among the built-in pronunciations, only when that is the booth app. A filled text
// remembers its template (BoothText), and the elements showing one are filled again when the
// name becomes known or changes while the settings are open (refreshBrand).
const HAS_BOOTH = /\{(booth|Booth|boothShort|qbooth)\}/;
const fillText = (tpl, lang) => fillBooth(tpl, lang).replace('{qbooth}', !isQBooth() ? '' : lang === 'zh' ? '、Q-Booth' : ', Q-Booth');
class BoothText extends String {
  constructor(tpl, lang) { super(fillText(tpl, lang)); this.tpl = tpl; this.lang = lang; }
}
const branded = (table, lang) => new Proxy(table, {
  get(o, k) {
    const v = o[k];
    if (typeof v === 'string' && HAS_BOOTH.test(v)) return new BoothText(v, lang);
    return v && typeof v === 'object' ? branded(v, lang) : v;
  },
});
let bound = []; // [element, property, BoothText]
function refreshBrand() {
  bound = bound.filter(([e]) => e.isConnected);
  for (const [e, k, b] of bound) e[k] = fillText(b.tpl, b.lang);
}

const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  for (const [k, v] of Object.entries(props)) if (v instanceof BoothText) bound.push([e, k, v]);
  e.append(...kids.filter(k => k != null));
  return e;
};

export function initSettings({ lang, locked, onOpen, onAvatar }) {
  const t = branded(T[lang] || T.id, lang);
  onBrand(() => { if (overlay) refreshBrand(); });
  // A server answer in this language: its code, else (an unknown one) its own words.
  const errText = r => { const m = r.code && t.err[r.code]; return m ? m.replace('{d}', r.detail || '') + (r.code === 'http' && r.message ? ': ' + r.message : '') : r.message; };
  let pin = '';

  // The language button with a PIN set: the PIN, every time (a kiosk stays unlocked otherwise).
  async function unlock() { return !locked || askPin(); }

  async function open() {
    if (overlay) return;
    onOpen?.();
    if (locked && !(await askPin())) return;
    const s = await (await fetch('/settings')).json();
    const avatars = (await (await fetch('/avatars')).json()).avatars || [];
    let mics = [];
    try { mics = await Mic.list(); } catch { }
    show(buildForm(s, avatars, mics));
  }

  function askPin() {
    return new Promise(resolve => {
      const input = el('input', { type: 'password', inputMode: 'numeric', autocomplete: 'off' });
      const msg = el('div', { className: 'set-msg' });
      const ok = el('button', { className: 'set-primary', textContent: 'OK' });
      const cancel = el('button', { textContent: t.cancel });
      const box = el('div', { className: 'set-panel set-pin' }, el('h2', { textContent: t.enterPin }), input, msg, el('div', { className: 'set-actions' }, cancel, ok));
      const done = v => { close(); resolve(v); };
      ok.onclick = async () => {
        const r = await fetch('/settings/unlock', { method: 'POST', body: JSON.stringify({ pin: input.value }) });
        if (r.ok) { pin = input.value; done(true); } else { msg.textContent = t.wrongPin; input.select(); }
      };
      cancel.onclick = () => done(false);
      input.onkeydown = e => { if (e.key === 'Enter') ok.click(); if (e.key === 'Escape') cancel.click(); };
      show(box);
      input.focus();
    });
  }

  function buildForm(s, avatars, mics) {
    const v = s.values;
    const fields = {}; // key -> () => value
    const row = (label, input, hint) => el('label', { className: 'set-row' },
      el('span', { className: 'set-label', textContent: label }), input, hint ? el('small', { textContent: hint }) : null);
    const text = (k, type = 'text') => { const i = el('input', { type, value: v[k] ?? '' }); fields[k] = () => type === 'number' ? i.value : i.value.trim(); return i; };
    const check = k => { const i = el('input', { type: 'checkbox', checked: !!v[k] }); fields[k] = () => i.checked; return i; };
    const select = (k, opts) => {
      const i = el('select', {}, ...opts.map(([val, label]) => el('option', { value: String(val), textContent: label, selected: String(v[k] ?? '') === String(val) })));
      fields[k] = () => i.value;
      return i;
    };
    const note = (m, text, ok) => { m.textContent = text; m.className = 'set-msg' + (ok == null ? '' : ok ? ' good' : ' bad'); };

    // ---- The booth app: connect first, then the event list, Run / Stop ----
    const mode = el('select', {}, el('option', { value: 'real', textContent: t.real, selected: !v.mock }), el('option', { value: 'mock', textContent: t.mock, selected: !!v.mock }));
    fields.mock = () => mode.value === 'mock';
    const pass = el('input', { type: 'password', placeholder: s.has['qbooth.password'] ? t.kept : '', autocomplete: 'new-password' });
    fields['qbooth.password'] = () => pass.value;
    const host = text('qbooth.host'), port = text('qbooth.port', 'number');
    const booth = (action, extra) => fetch('/settings/booth', { method: 'POST', headers: { 'x-settings-pin': pin },
      body: JSON.stringify({ action, host: host.value, port: port.value, password: pass.value, ...extra }) }).then(r => r.json());
    const testMsg = el('span', { className: 'set-msg' });
    const testBtn = el('button', { type: 'button', textContent: t.connect });
    const eventSel = el('select', { disabled: true }, el('option', { value: v['qbooth.eventId'] || '', textContent: t.connectFirst }));
    eventSel.style.cssText = 'flex: 1 1 0; min-width: 0';
    fields['qbooth.eventId'] = () => eventSel.value;
    const runBtn = el('button', { type: 'button', textContent: t.run, disabled: true });
    const stopBtn = el('button', { type: 'button', textContent: t.stop, disabled: true });
    const evMsg = el('span', { className: 'set-msg' });
    let running = null;
    const showRunning = () => {
      [...eventSel.options].forEach(o => { if (o.dataset.label) o.textContent = o.dataset.label + (running?.id === o.value ? ` · ${t.running}` : ''); });
      runBtn.disabled = !eventSel.value || running?.id === eventSel.value;
      stopBtn.disabled = !running;
    };
    testBtn.onclick = async () => {
      note(testMsg, t.connecting);
      testBtn.disabled = true;
      const r = await booth('connect');
      testBtn.disabled = false;
      note(testMsg, (r.ok ? '✓ ' + r.message : '✗ ' + errText(r)), r.ok);
      if (!r.ok) return;
      if (r.brand && !v.mock && mode.value === 'real') noteAppName(r.brand);
      running = r.running;
      const want = eventSel.value || running?.id || '';
      eventSel.replaceChildren(el('option', { value: '', textContent: t.pickEvent }),
        ...r.events.map(e => { const o = el('option', { value: e.id, textContent: e.name }); o.dataset.label = `${e.name} (${t.tplCount.replace('{n}', e.templateCount)})`; return o; }));
      eventSel.value = r.events.some(e => e.id === want) ? want : '';
      eventSel.disabled = false;
      showRunning();
    };
    eventSel.onchange = () => { evMsg.textContent = ''; showRunning(); };
    const runStop = async action => {
      if (action === 'start' && running) return note(evMsg, t.otherRunning, false);
      note(evMsg, action === 'start' ? t.starting : t.stopping);
      runBtn.disabled = stopBtn.disabled = true;
      const id = eventSel.value;
      const r = await booth(action, { id });
      if (r.ok) running = r.running;
      // QBooth can take a while to open a big event: keep looking (a minute at most)
      for (let i = 0; r.ok && r.message !== 'dialog' && action === 'start' && running?.id !== id && i < 30; i++) {
        showRunning();
        note(evMsg, t.opening);
        await new Promise(res => setTimeout(res, 2000));
        const c = await booth('connect');
        if (c.ok) running = c.running;
      }
      showRunning();
      const done = action === 'start' ? running?.id === id : !running;
      note(evMsg, !r.ok ? '✗ ' + errText(r) : r.message === 'dialog' ? t.dialog : !done ? t.notYet : action === 'start' ? t.started : t.stopped, r.ok && done);
    };
    runBtn.onclick = () => runStop('start');
    stopBtn.onclick = () => runStop('stop');
    // a saved connection: connect straight away (the event list fills in)
    if (s.has['qbooth.password']) setTimeout(() => testBtn.click());

    // ---- Look: avatar list + upload ----
    const avatar = select('avatar', avatars.map(a => [a.file, a.name || a.file.replace(/^avatars\//, '')]));
    const editBtn = el('button', { type: 'button', textContent: t.editAvatar });
    editBtn.onclick = () => { close(); onAvatar?.(pin); };
    const upload = el('input', { type: 'file', accept: '.vrm', hidden: true });
    const addBtn = el('button', { type: 'button', textContent: t.addVrm });
    addBtn.onclick = () => upload.click();
    upload.onchange = async () => {
      const f = upload.files[0];
      if (!f) return;
      addBtn.textContent = t.uploading;
      const r = await (await fetch('/avatars?name=' + encodeURIComponent(f.name), { method: 'POST', headers: { 'x-settings-pin': pin }, body: f })).json();
      addBtn.textContent = t.addVrm;
      if (!r.ok) { alert(r.error?.message || 'upload failed'); return; }
      if (![...avatar.options].some(o => o.value === r.avatar)) avatar.append(el('option', { value: r.avatar, textContent: r.avatar.replace(/^avatars\//, '') }));
      avatar.value = r.avatar;
    };
    const placeBtn = el('button', { type: 'button', textContent: t.ovPlace });
    placeBtn.onclick = () => { close(); window.__qba?.position(); };
    const size = text('overlay.size', 'number');
    Object.assign(size, { min: 30, max: 100 });
    size.style.width = '5em';

    // ---- Microphone + PIN ----
    const mic = select('micDevice', [['', t.micDefault], ...mics.map(m => [m, m])]);
    const pinIn = el('input', { type: 'password', inputMode: 'numeric', placeholder: s.has.settingsPin ? t.kept : t.pinHint, autocomplete: 'new-password' });
    const clearPin = el('input', { type: 'checkbox' });
    fields.settingsPin = () => clearPin.checked ? null : pinIn.value;

    // ---- AI brain: provider, keys, models, the local stand-in, a test ----
    const provider = select('llm.provider', [['local', t.local], ['gemini', t.gemini], ['openrouter', t.openrouter], ['gemini-live', t.liveName]]);
    const secret = k => { const i = el('input', { type: 'password', placeholder: s.has[k] ? t.kept : '', autocomplete: 'new-password' }); fields[k] = () => i.value; return i; };
    const gemKey = secret('llm.gemini.apiKey'), orKey = secret('llm.openrouter.apiKey');
    const orMsg = el('span', { className: 'set-msg' });
    const orBtn = el('button', { type: 'button', textContent: t.orLogin });
    orBtn.onclick = async () => {
      orBtn.disabled = true;
      note(orMsg, t.orWaiting);
      const r = await (await fetch('/settings/openrouter-login', { method: 'POST', headers: { 'x-settings-pin': pin } })).json();
      orBtn.disabled = false;
      note(orMsg, r.ok ? t.orDone : `${t.orFail} (${r.error?.code})`, r.ok);
      if (r.ok) { orKey.placeholder = t.kept; s.has['llm.openrouter.apiKey'] = true; }
    };
    const llmMsg = el('span', { className: 'set-msg' });
    const llmBtn = el('button', { type: 'button', textContent: t.testLlm });
    llmBtn.onclick = async () => {
      const p = provider.value;
      note(llmMsg, t.testing);
      const q = p === 'gemini-live' ? 'gemini' : p; // the key is checked with a text request
      const body = q === 'local' ? { provider: q } : { provider: q, apiKey: (q === 'gemini' ? gemKey : orKey).value, model: fields[`llm.${q}.model`]() };
      const r = await (await fetch('/settings/test-llm', { method: 'POST', headers: { 'x-settings-pin': pin }, body: JSON.stringify(body) })).json();
      note(llmMsg, (r.ok ? '✓ ' + r.message : '✗ ' + errText(r)), r.ok);
    };
    const gemKeyRow = row(t.apiKey, gemKey, t.geminiHint), gemModelRow = row(t.model, text('llm.gemini.model'));
    const liveRows = [
      row(t.voice, select('llm.live.voice', (s.liveVoices || []).map(([n, g, style]) => [n, `${n} (${t[g] || g}, ${style})`]))),
      row(t.bargeIn, check('llm.live.bargeIn'), t.bargeInHint),
      row(t.model, text('llm.live.model')),
      el('small', { className: 'set-note', textContent: t.liveHint }),
    ];
    const orRows = [el('div', { className: 'set-row' }, el('span'), el('div', { className: 'set-inline' }, orBtn, orMsg)), row(t.apiKey, orKey), row(t.model, text('llm.openrouter.model'))];
    const cloudRows = [row(t.fallback, check('llm.fallbackLocal'), t.fallbackHint), el('small', { className: 'set-note', textContent: t.cloudHint })];
    const showBrain = () => {
      const p = provider.value;
      gemModelRow.hidden = p !== 'gemini';
      gemKeyRow.hidden = p !== 'gemini' && p !== 'gemini-live';
      liveRows.forEach(r => { r.hidden = p !== 'gemini-live'; });
      orRows.forEach(r => { r.hidden = p !== 'openrouter'; });
      cloudRows.forEach(r => { r.hidden = p === 'local'; });
      llmBtn.hidden = p === 'local';
    };
    provider.onchange = showBrain;
    showBrain();

    // Sensitivity: a slider and a live meter. The line is where speech starts at this setting.
    const sens = el('input', { type: 'range', min: 1, max: 10, step: 1, value: v.micSensitivity ?? 5 });
    const sensVal = el('b', { textContent: sens.value });
    fields.micSensitivity = () => sens.value;
    const meterFill = el('i'), meterLine = el('u');
    const meter = el('div', { className: 'set-meter' }, meterFill, meterLine);
    sens.oninput = () => { sensVal.textContent = sens.value; };
    startMeter(meterFill, meterLine, () => thresholds(sens.value), mic.value);

    const section = (title, ...rows) => Object.assign(el('fieldset', {}, el('legend', { textContent: title }), ...rows), { tabTitle: title });
    const msg = el('div', { className: 'set-msg' });
    const saveBtn = el('button', { className: 'set-primary', textContent: t.saveBtn });
    const cancelBtn = el('button', { textContent: t.cancel });
    const quitBtn = el('button', { type: 'button', textContent: t.quit });
    quitBtn.onclick = () => fetch('/settings/quit', { method: 'POST', headers: { 'x-settings-pin': pin } });
    const askLang = el('input', { type: 'checkbox', checked: v.askLanguage !== false });
    fields.askLanguage = () => askLang.checked;
    const pron = el('textarea', { rows: 3, value: v.pronunciations || '', placeholder: isQBooth() ? 'Q-Booth = Kyubuth' : 'QRIS = kris' });
    fields.pronunciations = () => pron.value.trim();
    const info = el('textarea', { rows: 4, value: v.eventInfo || '' });
    const brandIn = text('brandName');
    brandIn.placeholder = seenBrand() || ''; // what the booth app reports
    fields.eventInfo = () => info.value.trim();

    // One tab per section: a side menu on a landscape screen, a row of tabs on a portrait one
    // (style.css). Each tab fits on the screen, no long scroll. Every field stays in the form
    // (hidden tabs included), so Save reads them all.
    const sections = [
      section(t.booth,
        row(t.mode, mode), row(t.host, host), row(t.port, port), row(t.password, pass),
        el('div', { className: 'set-row' }, el('span'), el('div', { className: 'set-inline' }, testBtn, testMsg)),
        row(t.event, el('div', { className: 'set-inline' }, eventSel, runBtn, stopBtn)),
        el('div', { className: 'set-row' }, el('span'), evMsg),
        row(t.autoStart, check('qbooth.autoStart'), t.autoStartHint),
        row(t.brandName, brandIn, t.brandHint)),
      section(t.assistant,
        row(t.name, text('assistantName')),
        row(t.persona, select('persona', Object.entries(t.personas))),
        row(t.talk, select('talk', Object.entries(t.talks)), t.talkHint),
        row(t.language, select('language', [['id', 'Bahasa Indonesia'], ['en', 'English'], ['zh', '中文 (Mandarin)']])),
        row(t.askLang, askLang, t.askLangHint),
        (() => { // the voice the avatar speaks this language with, and whether its gender's is installed
          const vo = s.voices?.[v.language] || {};
          const who = vo.engine === 'piper' ? 'Piper' : vo.engine === 'sapi' || vo.engine === 'winrt' ? 'Windows ' + String(vo.voice || '').replace(/^Microsoft |s*Desktop$/g, '') : vo.engine || '-';
          return row(t.voiceNow, el('span', { textContent: `${t[s.gender] || s.gender} · ${who} · ${t.voiceGender}` }), vo.fallback ? t.voiceMissing.replace('{g}', t[s.gender] || s.gender) : null);
        })(),
        row(t.eventInfo, info, t.eventHint),
        row(t.pron, pron, t.pronHint)),
      section(t.brain,
        row(t.provider, provider),
        gemKeyRow, gemModelRow, ...liveRows, ...orRows, ...cloudRows,
        el('div', { className: 'set-row' }, el('span'), el('div', { className: 'set-inline' }, llmBtn, llmMsg))),
      section(t.look,
        row(t.avatar, el('div', { className: 'set-inline' }, avatar, addBtn, upload)),
        el('div', { className: 'set-row' }, el('span'), el('div', { className: 'set-inline' }, editBtn)),
        s.app?.displays?.length > 1 ? row(t.display, select('display', s.app.displays.map(d => [d.index, d.label]))) : null,
        row(t.ovSide, el('div', { className: 'set-inline' }, select('overlay.side', [['right', t.right], ['left', t.left]]), el('span', { textContent: t.ovSize }), size, el('span', { textContent: '%' })), t.ovHint),
        s.app?.desktop ? el('div', { className: 'set-row' }, el('span'), el('div', { className: 'set-inline' }, placeBtn)) : null,
        row(t.menuBtn, check('overlay.menuButton'), t.menuBtnHint),
        row(t.langBtn, check('overlay.langButton')),
        row(t.langPin, check('overlay.langPin'), t.langPinHint),
        el('small', { className: 'set-note', textContent: t.ovKeys }),
        row(t.screenGpu, select('screenGpu', [['auto', t.gpuAuto], ['nvidia', t.gpuNvidia], ['software', t.gpuSoft]]), t.gpuHint),
        row(t.invite, text('idleInviteSec', 'number'))),
      section(t.audio,
        row(t.listen, select('listenMode', [['tap', t.tap], ['auto', t.auto], ['wake', t.wake]]), t.listenHint),
        row(t.mic, mic),
        row(t.sens, el('div', { className: 'set-inline' }, sens, sensVal, meter), t.sensHint),
        row(t.save, check('saveRecordings'), t.saveHint)),
      section(t.security,
        row(t.pin, pinIn),
        s.has.settingsPin ? row(t.clearPin, clearPin) : null),
    ];
    const nav = el('nav', { className: 'set-tabs' });
    const tabBtns = sections.map((fs, i) => {
      const b = el('button', { type: 'button', textContent: fs.tabTitle });
      b.onclick = () => openTab(i);
      return b;
    });
    nav.append(...tabBtns);
    const pages = el('div', { className: 'set-pages' }, ...sections);
    function openTab(i) {
      sections.forEach((fs, k) => { fs.hidden = k !== i; tabBtns[k].classList.toggle('on', k === i); });
      pages.scrollTop = 0;
      try { sessionStorage.setItem('qba.setTab', String(i)); } catch { }
    }
    let first = 0;
    try { first = Math.min(sections.length - 1, +sessionStorage.getItem('qba.setTab') || 0); } catch { }
    openTab(first);

    const form = el('div', { className: 'set-panel tabbed' },
      el('h2', { textContent: '⚙ ' + t.title }),
      nav, pages,
      msg,
      el('div', { className: 'set-actions' }, el('small', { className: 'set-file', textContent: `${t.file}: ${s.file}` }),
        s.app?.desktop ? quitBtn : null, cancelBtn, saveBtn),
    );

    cancelBtn.onclick = close;
    saveBtn.onclick = async () => {
      // Only what changed (secrets: what was typed; null = remove the PIN).
      const changes = {};
      for (const [k, read] of Object.entries(fields)) {
        const now = read();
        if (k === 'qbooth.password' || k === 'settingsPin' || k.endsWith('.apiKey')) { if (now === null || now) changes[k] = now; continue; }
        if (String(now) !== String(v[k] ?? '')) changes[k] = now;
      }
      saveBtn.disabled = true;
      msg.textContent = t.saving;
      const r = await (await fetch('/settings', { method: 'POST', headers: { 'x-settings-pin': pin }, body: JSON.stringify(changes) })).json();
      if (!r.ok) { msg.textContent = '✗ ' + (r.error?.message || r.error?.code); saveBtn.disabled = false; return; }
      if (r.restart) { msg.textContent = t.restarting; return; } // the app closes and comes back
      if (r.restartNeeded) { msg.textContent = t.restartManual; setTimeout(() => location.reload(), 2500); return; }
      location.reload(); // avatar, language, voice...
    };
    return form;
  }

  // Live mic level for the sensitivity meter (its own stream; stopped with the panel).
  let meterStop = null;
  async function startMeter(fill, line, th, device) {
    meterStop?.();
    let stream, ctx, raf;
    try {
      const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
      if (device) {
        const d = (await navigator.mediaDevices.enumerateDevices()).find(x => x.kind === 'audioinput' && x.label.toLowerCase().includes(device.toLowerCase()));
        if (d) audio.deviceId = { exact: d.deviceId };
      }
      stream = await navigator.mediaDevices.getUserMedia({ audio });
    } catch { return; }
    ctx = new AudioContext();
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(an.fftSize);
    const pos = rms => Math.min(100, Math.sqrt(rms / 0.15) * 100); // same scale as the mic meter
    let noise = 0.01;
    const tick = () => {
      an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const x of buf) sum += x * x;
      const rms = Math.sqrt(sum / buf.length);
      noise = rms < noise ? rms : noise * 0.995 + rms * 0.005; // follows the quiet moments
      const t = th();
      const start = Math.max(Math.max(noise, 0.002) * t.startX, t.startMin);
      fill.style.width = pos(rms) + '%';
      fill.classList.toggle('on', rms > start);
      line.style.left = pos(start) + '%';
      raf = requestAnimationFrame(tick);
    };
    tick();
    meterStop = () => { cancelAnimationFrame(raf); stream.getTracks().forEach(x => x.stop()); ctx.close(); meterStop = null; };
  }

  let overlay = null;
  function show(panel) {
    close();
    overlay = el('div', { className: 'set-overlay' }, panel);
    overlay.onkeydown = e => { if (e.key === 'Escape') close(); e.stopPropagation(); };
    document.body.append(overlay);
  }
  function close() { meterStop?.(); overlay?.remove(); overlay = null; }

  return { open, close, unlock, isOpen: () => !!overlay };
}
