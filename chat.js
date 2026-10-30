// The conversation: guest text in, spoken sentences (and booth actions) out.
// The LLM sees the booth's live status and gets tools only for the commands
// QBooth would accept right now (status.available), so it cannot press a
// button that isn't there. Every tool runs through the Local API.
import { services, cloudKey, cloud } from './services.js';
import { personaOf } from './persona.js';

// tool name -> Local API command, with what the LLM is told about it.
// `next` goes back to the LLM with the result: the booth only *accepted* the
// command, so the LLM must not claim an outcome (e.g. "photo taken") that hasn't happened.
export const TOOLS = {
  start_session: {
    cmd: 'session/start', id: 'Mulai sesi foto (tombol Start di layar Welcome).', en: 'Start a photo session (the Start button on Welcome).', zh: '开始拍照（欢迎页上的开始按钮）。',
    next: { id: 'Sesi dimulai. Layar berikutnya muncul; ajak tamu mengikuti petunjuk di layar.', en: 'Session started. The next screen appears; tell the guest to follow the screen.', zh: '已开始。下一个画面出现，请让客人按照屏幕提示操作。' },
  },
  choose_template: {
    cmd: 'template/select', id: 'Pilih template/gaya foto berdasarkan nama atau nomornya (di layar pilih template; di layar awal ini membuka pilihan template dulu).', en: 'Pick a photo template by its name or number (on the template screen; on the start screen this opens the template choice first).', zh: '按名称或编号选择拍照模板（在选择模板画面；在欢迎页会先打开模板选择）。',
    params: { name: { type: 'string', description: 'Template name or its number, from the list in the status' } },
    next: { id: 'Template dipilih. Layar kamera terbuka; foto BELUM diambil; tamu bersiap lalu bilang \"foto\" (atau tekan tombol foto).', en: 'Template chosen. The camera screen opens; NO photo taken yet; the guest gets ready, then says \"photo\" (or presses the photo button).', zh: '模板已选好。相机画面打开了，还没有拍照；客人准备好后说“拍照”（或按拍照按钮）。' },
  },
  take_photo: {
    cmd: 'camera/capture', id: 'Ambil foto (tombol foto, mulai hitung mundur).', en: 'Take the photo (starts the countdown).', zh: '拍照（拍照按钮，开始倒计时）。',
    next: { id: 'Hitung mundur DIMULAI. Foto belum jadi; ajak tamu bergaya dan tersenyum.', en: 'Countdown STARTED. The photo is not taken yet; tell the guest to pose and smile.', zh: '倒计时已开始。照片还没拍好，请让客人摆好姿势、微笑。' },
  },
  retake_photo: {
    cmd: 'camera/retake', id: 'Ulangi foto yang sedang ditampilkan.', en: 'Retake the photo on screen.', zh: '重拍屏幕上的这张照片。',
    next: { id: 'Foto diulang, hitung mundur dimulai lagi.', en: 'Retaking: the countdown starts again.', zh: '重拍中，倒计时重新开始。' },
  },
  process_photo: {
    cmd: 'camera/process', id: 'Selesai foto, proses hasilnya.', en: 'Done shooting: process the result.', zh: '拍完了，处理照片。',
    next: { id: 'Foto sedang diproses, hasilnya muncul sebentar lagi.', en: 'The photo is being processed; the result shows in a moment.', zh: '照片正在处理，结果马上出来。' },
  },
  print_photo: {
    cmd: 'result/print', id: 'Cetak hasil foto.', en: 'Print the result.', zh: '打印照片。',
    next: { id: 'Perintah cetak dikirim; hasil cetak keluar dari printer sebentar lagi.', en: 'Print sent; the print comes out of the printer shortly.', zh: '打印指令已发送，照片稍后从打印机出来。' },
  },
  show_qr: {
    cmd: 'result/qr', id: 'Tampilkan QR untuk mengunduh foto.', en: 'Show the QR code to download the photo.', zh: '显示下载照片的二维码。',
    next: { id: 'QR tampil di layar booth; tamu scan pakai kamera HP.', en: 'The QR code is on the booth screen; the guest scans it with a phone camera.', zh: '二维码显示在屏幕上，客人用手机扫码下载。' },
  },
  // "start over": back to the start screen for a new go (the same Home button as finishing)
  start_over: {
    cmd: 'session/end', id: 'Mulai dari awal lagi: kembali ke layar awal untuk sesi baru.', en: 'Start over: back to the start screen for a new session.', zh: '重新开始：回到开始画面，开始新的拍照。',
    next: { id: 'Booth kembali ke layar awal; tamu bisa mulai sesi baru.', en: 'The booth is back on the start screen; the guest can start a new session.', zh: '已回到开始画面，客人可以重新开始拍照。' },
  },
  finish_session: {
    cmd: 'session/end', id: 'Akhiri sesi, kembali ke layar awal.', en: 'End the session, back to the start screen.', zh: '结束拍照，回到开始画面。',
    next: { id: 'Sesi selesai, booth kembali ke layar awal.', en: 'Session ended, the booth is back on the start screen.', zh: '已结束，回到开始画面。' },
  },
};

const PAGE = {
  id: { none: 'photobooth belum dibuka', welcome: 'layar awal (Welcome)', survey: 'survei', categoryPicker: 'pilih kategori', templatePicker: 'pilih template', input: 'isi data', camera: 'kamera', result: 'hasil foto' },
  en: { none: 'booth not open yet', welcome: 'start screen (Welcome)', survey: 'survey', categoryPicker: 'category picker', templatePicker: 'template picker', input: 'data form', camera: 'camera', result: 'result' },
  zh: { none: '拍照亭还没打开', welcome: '开始画面（欢迎页）', survey: '问卷', categoryPicker: '选择分类', templatePicker: '选择模板', input: '填写资料', camera: '相机', result: '照片结果' },
};

// How much the assistant says ("talk" in the settings). rule: the prompt's length line, per
// language; sentences: where a spoken answer is cut; tokens: the local model's budget.
export const TALK = {
  short: {
    sentences: 2, tokens: 120,
    id: 'Jawab SINGKAT: 1-2 kalimat, maksimal 25 kata, langsung ke intinya.',
    en: 'Answer SHORT: 1-2 sentences, at most 25 words, straight to the point.',
    zh: '回答要简短：1到2句话，最多35个字，直接说重点。',
  },
  normal: {
    sentences: 3, tokens: 200,
    id: 'Jawab dengan ramah dalam 2-3 kalimat (maksimal 45 kata). Boleh tutup dengan satu pertanyaan ringan supaya obrolan berlanjut.',
    en: 'Answer warmly in 2-3 sentences (at most 45 words). You may end with one light question to keep the talk going.',
    zh: '用2到3句话热情地回答（最多60个字）。可以用一个轻松的问题结尾，让聊天继续。',
  },
  chatty: {
    sentences: 5, tokens: 320,
    id: 'Kamu suka mengobrol: jawab dalam 3-5 kalimat (maksimal 70 kata), tambahkan basa-basi, pujian atau cerita kecil yang ramah, dan selalu tutup dengan pertanyaan supaya tamu terus ngobrol.',
    en: 'You love to chat: answer in 3-5 sentences (at most 70 words), add friendly small talk, a compliment or a little story, and always end with a question so the guest keeps talking.',
    zh: '你很爱聊天：用3到5句话回答（最多100个字），加上友好的寒暄、夸奖或小故事，并且总是用一个问题结尾，让客人继续聊。',
  },
};
export const talkOf = cfg => TALK[cfg.talk] || TALK.normal;

export function systemPrompt(cfg, lang, status) {
  const name = cfg.assistantName || 'Luma';
  const style = personaOf(cfg)[lang] || personaOf(cfg).en;
  if (lang === 'zh') return `你是${name}，Q-Booth 拍照亭的虚拟助手${status?.event ? `，在活动“${status.event.name}”上` : ''}。你站在拍照亭屏幕的一角，在 Q-Booth 画面上面，和客人聊天。客人能看到你周围的 Q-Booth 画面（开始按钮、模板选择、相机、照片结果）：带着他们一步步操作。
风格：${style}。${talkOf(cfg).zh}你的回答会被读出来。不要表情符号，不要 markdown，不要列表。只在自我介绍时说你的名字。只说简体中文（普通话）。
你的任务：迎接客人，帮他们使用拍照亭，轻松聊天。
你可以用工具操作拍照亭。只有客人明确要求某个操作时才调用工具，然后简短说明接下来会发生什么。没有成功的工具结果时，绝对不要说操作已经完成（模板已选、照片已拍、已打印）；按照工具结果里的 "next" 说明来说。
不要编造下面没有写的活动信息、价格或规则；不知道的话，建议客人问工作人员。
如果有人问你用的是什么技术或 AI，就说你是在这台电脑上运行的 Q-Booth 助手；不要说出模型、公司或软件的名字。
不要询问或保存个人信息。
客人的话来自语音识别，可能听错：按拍照亭场景猜最可能的意思。如果真的听不懂，简短地请对方再说一次。
活动信息：${cfg.eventInfo || '-'}
拍照亭当前状态在客人的话前面的 [方括号] 里，也在工具结果的 "booth" 里。`;
  if (lang === 'en') return `You are ${name}, the virtual assistant of a Q-Booth photo booth${status?.event ? ` at the event "${status.event.name}"` : ''}. You stand in a corner of the booth's screen, on top of the Q-Booth screen, and talk with guests. The guests see the Q-Booth screen around you (start button, template choices, camera, result): guide them through it.
Style: ${style}. ${talkOf(cfg).en} Your answer is spoken aloud. No emoji, no markdown, no lists. Say your name only when introducing yourself.
Your job: greet guests, help them use the photo booth, and make light small talk.
You can operate the booth with the tools you have. Call a tool only when the guest clearly asks for that action, then say briefly what happens next. NEVER say an action is done (template chosen, photo taken, printed) without an ok tool result for it; follow the "next" note in the tool result.
Never make up event details, prices or rules that are not given below; if you don't know, suggest asking the event staff.
If asked what technology or AI you use, say you are the Q-Booth assistant running right here on this computer; never name models, companies or software.
Do not ask for or keep personal data.
The guest's words come from speech recognition and may be misheard: guess the most likely meaning at a photo booth. If it is really unclear, briefly ask them to repeat.
Event info: ${cfg.eventInfo || '-'}
The booth's current status comes in [brackets] before the guest's words, and as "booth" in tool results.`;
  return `Kamu adalah ${name}, asisten virtual photobooth Q-Booth${status?.event ? ` di acara "${status.event.name}"` : ''}. Kamu tampil di pojok layar photobooth, di atas layar Q-Booth, dan mengobrol dengan pengunjung. Pengunjung melihat layar Q-Booth di sekitarmu (tombol mulai, pilihan template, kamera, hasil): pandu mereka melalui layar itu.
Gaya: ${style}. ${talkOf(cfg).id} Jawabanmu diucapkan. Tanpa emoji, tanpa markdown, tanpa daftar. Tulis angka sebagai kata. Sebut namamu hanya saat memperkenalkan diri.
Tugasmu: menyapa, membantu pengunjung memakai photobooth, dan mengobrol ringan.
Kamu bisa menjalankan photobooth dengan tools yang tersedia. Panggil tool hanya kalau pengunjung jelas meminta aksinya, lalu bilang singkat apa yang terjadi berikutnya. JANGAN PERNAH bilang sebuah aksi sudah dilakukan (template dipilih, foto diambil, dicetak) kalau tidak ada hasil tool yang ok untuk itu; ikuti keterangan "next" di hasil tool.
Jangan mengarang info acara, harga, atau aturan yang tidak tertulis di bawah; kalau tidak tahu, sarankan bertanya ke panitia.
Kalau ditanya teknologi atau AI apa yang dipakai, jawab bahwa kamu asisten Q-Booth yang berjalan langsung di komputer ini; jangan sebut nama model, perusahaan, atau software.
Jangan meminta atau menyimpan data pribadi.
Kata-kata pengunjung berasal dari pengenalan suara dan bisa salah dengar: tebak maksud yang paling masuk akal di photobooth. Kalau benar-benar tidak jelas, minta diulang dengan singkat.
Info acara: ${cfg.eventInfo || '-'}
Status photobooth saat ini ada dalam [kurung siku] sebelum kata-kata pengunjung, dan sebagai "booth" di hasil tool.`;
}

// The live booth status goes in front of the guest's latest words, not in the
// system prompt: the system prompt, tools and earlier turns then stay the same
// from turn to turn, and llama.cpp reuses them from its cache instead of
// reading the whole prompt again.
export function statusNote(lang, status, templates) {
  const page = PAGE[lang][status?.page || 'none'] || status?.page;
  const c = status?.camera;
  const cam = !c ? '' : lang === 'en' ? `, camera ${c.phase}, photo ${c.captured}/${c.shots}, retakes left ${c.retakesLeft}`
    : lang === 'zh' ? `，相机 ${c.phase}，照片 ${c.captured}/${c.shots}，还能重拍 ${c.retakesLeft} 次`
      : `, kamera ${c.phase}, foto ${c.captured}/${c.shots}, sisa ulang ${c.retakesLeft}`;
  const busy = !status?.busy?.processing ? ''
    : { en: ', processing a photo (chat with the guest meanwhile)', zh: '，照片正在处理（等待时和客人聊聊天）' }[lang] || ', foto sedang diproses (ajak tamu ngobrol sambil menunggu)';
  const tpl = templates.length ? templates.map((t, i) => `${i + 1} ${t.name}`).join(', ') : '-';
  const can = Object.entries(TOOLS).filter(([, t]) => (status?.available || []).includes(t.cmd)).map(([n]) => n).join(', ') || '-';
  if (lang === 'zh') return `[拍照亭：${page}${cam}${busy}。模板：${tpl}。现在可用的工具：${can}。]`;
  return lang === 'en'
    ? `[Booth: ${page}${cam}${busy}. Templates: ${tpl}. Tools usable now: ${can}.]`
    : `[Booth: ${page}${cam}${busy}. Template: ${tpl}. Tool yang bisa dipakai sekarang: ${can}.]`;
}

// The templates in the order the guest sees them: on QBooth's Template Picker the cards
// on screen first, by their index there ("yang kedua" = the second card on QBooth's screen).
export const inScreenOrder = list => {
  const shown = list.filter(t => t.index != null).sort((a, b) => a.index - b.index);
  return shown.length ? [...shown, ...list.filter(t => t.index == null)] : list;
};

// One booth tool, for the local chat and Gemini Live alike: the Local API reply
// (+ the template picked), or "not possible now" when QBooth would refuse it.
export async function boothTool({ qb, status, templates }, name, args = {}) {
  const tool = TOOLS[name];
  const available = status?.available || [];
  if (!tool) return { ok: false, error: { code: 'unknown_tool' } };
  if (!available.includes(tool.cmd)) return { ok: false, error: { code: 'not_available_now', message: 'Not possible on this screen.' } };
  // No screen is skipped: a template asked for on Welcome opens QBooth's Template Picker first.
  if (name === 'choose_template' && status?.page !== 'templatePicker') {
    if (status?.page === 'welcome' && available.includes('session/start')) return { ...(await qb('POST', 'session/start')), started: true };
    return { ok: false, error: { code: 'not_available_now', message: 'Templates are picked on the template screen.' } };
  }
  if (name === 'choose_template') {
    const t = findTemplate(templates, args.name);
    if (!t) return { ok: false, error: { code: 'unknown_template', message: 'Choices: ' + templates.map((x, i) => `${i + 1} ${x.name}`).join(', ') } };
    const r = await qb('POST', tool.cmd, { id: t.id });
    return r.ok ? { ...r, template: t.name } : r;
  }
  return qb('POST', tool.cmd, tool.cmd === 'result/qr' ? { type: 'web' } : undefined);
}

// What the avatar says right after a clear command ran (routed in code): no LLM wait.
// Empty = QBooth's own screen change brings the line (the countdown's "Smile!").
export const ACK = {
  start_session: { id: 'Siap! Yuk, pilih template di layar.', en: 'Great! Pick a template on the screen.', zh: '好的！在屏幕上选一个模板吧。' },
  choose_template: { id: 'Oke, {name}! Atur pose, lalu bilang "foto" kalau sudah siap.', en: 'Okay, {name}! Strike a pose and say "photo" when you are ready.', zh: '好的，{name}！摆好姿势，准备好了就说“拍吧”。' },
  take_photo: { id: '', en: '', zh: '' },
  retake_photo: { id: '', en: '', zh: '' },
  process_photo: { id: 'Sip, fotonya diproses sebentar ya.', en: 'Great, processing your photo now.', zh: '好的，照片马上处理。' },
  print_photo: { id: 'Siap, fotonya dicetak sekarang.', en: 'Printing your photo now.', zh: '好的，现在打印照片。' },
  show_qr: { id: 'QR-nya sudah di layar, scan pakai HP ya.', en: 'The QR code is on the screen, scan it with your phone.', zh: '二维码在屏幕上，用手机扫一扫吧。' },
  finish_session: { id: 'Terima kasih, sampai jumpa lagi!', en: 'Thank you, see you again!', zh: '谢谢，下次见！' },
  start_over: { id: 'Oke, kita kembali ke awal ya!', en: 'Okay, back to the start!', zh: '好的，我们回到开始画面！' },
};

// What the LLM is told after a tool: what happens next, or why it failed.
export function toolReply(name, r, lang) {
  const tool = TOOLS[name];
  return r.ok
    ? { ok: true, ...(r.template ? { template: r.template } : {}), next: (r.started ? TOOLS.start_session.next : tool.next)[lang] }
    : { ok: false, error: r.error?.code, message: r.error?.message };
}

// All tools, always (a stable prompt prefix); one QBooth won't accept right now is refused in runTool.
function toolDefs(lang) {
  return Object.entries(TOOLS).map(([name, t]) => ({
    type: 'function',
    function: {
      name, description: t[lang],
      parameters: { type: 'object', properties: t.params || {}, required: Object.keys(t.params || {}) },
    },
  }));
}

// Best match for a spoken template name ("yang emas" -> "Portrait Gold" won't work,
// but "portrait" or "strip tiga" -> "Strip 3" mostly will).
const NUM = {
  satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, delapan: 8, sembilan: 9, sepuluh: 10,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
const ORD = {
  pertama: 1, kedua: 2, ketiga: 3, keempat: 4, kelima: 5, keenam: 6, ketujuh: 7, kedelapan: 8, kesembilan: 9, kesepuluh: 10,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
};
const norm = s => String(s || '').toLowerCase().replace(/([a-z])(\d)|(\d)([a-z])/g, '$1$3 $2$4') // "strip3" -> "strip 3"
  .replace(/[a-z]+/g, w => NUM[w] ?? w).replace(/[^a-z0-9]+/g, ' ').trim();

// A card number in what the guest said: "nomor dua", "yang ketiga", "ke-3", "the second one", or just "3".
// A bare number only counts when it is all that was said ("dua orang" is not card 2).
const NUM_BEFORE = ['nomor', 'nomer', 'no', 'number', 'num', 'nr', 'kartu', 'card', 'ke', 'template', 'yang'];
const ZH_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const zhNum = t => /^\d+$/.test(t) ? +t : t.length === 1 ? ZH_NUM[t] : t[0] === '十' ? 10 + (ZH_NUM[t[1]] || 0) : t.length === 2 && t[1] === '十' ? ZH_NUM[t[0]] * 10 : ZH_NUM[t[0]] * 10 + ZH_NUM[t[2]];
export function templateNumber(text, count) {
  const z = String(text || '').match(/第\s*([0-9]+|[一二两三四五六七八九十]+)\s*(个|张|号)?|([0-9]+|[一二两三四五六七八九十]+)\s*号/);
  if (z) { const n = zhNum(z[1] || z[3]); return n >= 1 && n <= count ? n : null; }
  const w = String(text || '').toLowerCase().replace(/\bke(\d+)\b/g, 'ke $1').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).map(x => NUM[x] ?? x);
  let n = null;
  w.forEach((x, i) => {
    if (ORD[x] && (w.length <= 2 || ['yang', 'the', 'nomor', 'number'].includes(w[i - 1]))) n = ORD[x];
    else if (/^\d+$/.test(String(x)) && (w.length === 1 || NUM_BEFORE.includes(w[i - 1]))) n = +x;
  });
  return n >= 1 && n <= count ? n : null;
}

export function findTemplate(templates, name) {
  const q = norm(name);
  if (!q) return null;
  const exact = templates.find(t => norm(t.name) === q); // a template really called "Template 2"
  if (exact) return exact;
  const num = templateNumber(name, templates.length);
  if (num) return templates[num - 1];
  let best = null, bestScore = 0;
  for (const t of templates) {
    const n = norm(t.name);
    const words = q.split(' ');
    const score = n === q ? 100 : (n.includes(q) || q.includes(n) ? 50 : 0) + words.filter(w => n.split(' ').includes(w)).length * 10;
    if (score > bestScore) { best = t; bestScore = score; }
  }
  return bestScore > 0 ? best : null;
}

// Clear commands, per tool, Indonesian + English. Checked only when QBooth
// would accept that command right now. Questions ("how do I print?") are left to the LLM.
const INTENTS = [
  ['retake_photo', /\b(ulang(i|in)?|foto (lagi|ulang)|sekali lagi|lagi (dong|ya|deh)|coba lagi|ganti (foto|pose)|retake|again|redo|one more)\b/],
  ['process_photo', /\b(proses(in|kan)?|lanjut(kan|in)?|terus(kan|in)?|udah(an)? (bagus|oke|cukup|keren)|sudah (bagus|oke|cukup|keren)|pakai yang (ini|itu)|yang ini aja|process|continue|go on|looks good|next)\b/],
  ['take_photo', /\b(ambil (foto|gambar)(nya)?|foto(in)? (sekarang|dong|aja|yuk)|jepret(in)?|cekrek|(me)?(m|p)otret(in)?|siap|ready|take (the |a )?(photo|picture)|snap|shoot|cheese)\b/],
  ['print_photo', /\b(cetak(in|kan)?|dicetak(in)?|print(in)?)\b/],
  ['show_qr', /\b(qr|unduh|download|kirim ke (hp|wa|whatsapp)|simpan (di|ke) (hp|handphone)|scan|barcode)\b/],
  ['start_session', /\b((mau|pengen|pengin|pingin|ingin) (di)?foto|difoto(in)?|foto (berdua|bertiga|bareng|bersama|rame)|ayo foto|foto dong|mulai|start|let'?s (take|start|go)|i want (a|to take a) (photo|picture))\b/],
  ['finish_session', /\b(udahan|sudah selesai|udah selesai|selesai|(sudah|udah) cukup|keluar|pamit|dadah|terima ?kasih|makasih|that'?s all|finish|we'?re done|i'?m done|bye|thank(s| you))\b/],
];
const INTENTS_ZH = [
  ['retake_photo', /重拍|再拍一张|再来一张|重新拍/],
  ['process_photo', /处理|继续|就这张|可以了|好了/],
  ['take_photo', /拍吧|开拍|拍照吧|现在拍|快拍|准备好了|茄子/],
  ['print_photo', /打印|印出来/],
  ['show_qr', /二维码|扫码|下载|发到手机/],
  ['start_session', /我要拍照|想拍照|要拍照|拍个照|拍张照|来拍照|开始/],
  ['finish_session', /结束|不拍了|拍完了|就这样吧/],
];
const START_OVER = /\b(mulai (lagi|dari awal|ulang|baru)|ulang dari awal|dari awal( lagi)?|balik ke (awal|depan|home|menu)|kembali ke (awal|depan|home|menu)|ke (halaman|layar) (awal|depan|utama)|sesi baru|start (over|again)|restart|new session|(go )?back to (the )?(start|home|beginning|menu)|home)\b|重新开始|再来一次|回到首页|返回首页|回到开始|从头开始/;
const QUESTION_ZH =/怎么|如何|为什么|多少|吗[？?]?$|能不能|可不可以/;
const NEGATION_ZH = /不要|别|还没|不用|没有/;
const QUESTION = /\b(gimana|bagaimana|caranya|apakah|kenapa|mengapa|berapa|bisa (nggak|gak|ga|tidak)|boleh (nggak|gak|ga)|how|what|why|can i|could i)\b/;
const NEGATION = /\b(belum|jangan|nggak|gak|ga|tidak|enggak|engga|bukan|don'?t|not|no)\b/;

// A command word misheard by a letter ("prosess", "lanjud", "jepred", "cetal") is that command
// word: words of 5+ letters within 1 edit (8+ letters: 2) of one. Only these words are touched.
const COMMAND_WORDS = ['proses', 'prosesin', 'lanjut', 'lanjutkan', 'ulang', 'ulangi', 'jepret', 'cekrek', 'cetak', 'cetakin', 'download',
  'selesai', 'mulai', 'udahan', 'process', 'continue', 'retake', 'print', 'again', 'start', 'picture', 'photo', 'finish'];
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
function fuzzyFix(q) {
  return q.replace(/[a-z]{5,}/g, w => {
    if (COMMAND_WORDS.includes(w)) return w;
    const max = w.length >= 8 ? 2 : 1;
    let best = null, bestD = max + 1;
    for (const c of COMMAND_WORDS) { const d = editDistance(w, c, max); if (d < bestD) { best = c; bestD = d; } }
    return best && bestD <= max ? best : w;
  });
}

function routeIntent(text, status, templates) {
  // (speech to text sometimes glues the particle on: "fotodong", "fotoin")
  // (and its commas: "Ayo, foto." is "ayo foto")
  const q = fuzzyFix(text.toLowerCase().replace(/[,.!;:…]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\bfoto(dong|yuk|aja|deh|in)\b/g, 'foto $1'));
  const avail = status.available || [];
  const can = name => avail.includes(TOOLS[name].cmd);
  // A template named in full on the picker (or Welcome) wins.
  // "Start over" on the result or before the camera: back to Welcome. (Not on the camera
  // page: photos being taken are not thrown away by a stray word.) Also as a question.
  if (status.page !== 'welcome' && status.page !== 'camera' && can('start_over')
    && (START_OVER.test(q) || (status.page === 'result' && /\bfoto lagi\b|\bmore photos?\b|再拍/.test(q)))) return { name: 'start_over' };
  // A template named in full. Only on QBooth's Template Picker: no screen is skipped, so on
  // Welcome a template's name ("Photo", or "ayo foto" misheard as "I have photo") opens the picker.
  const nq = ' ' + norm(text) + ' ';
  const named = templates.find(t => { const n = norm(t.name); return n && nq.includes(' ' + n + ' '); })
    || templates.find(t => { const w = norm(t.name).split(' ').filter(x => x.length > 2); return w.length && w.every(x => nq.includes(' ' + x + ' ')); });
  if (named && status.page === 'welcome' && can('start_session') && !QUESTION.test(q) && !NEGATION.test(q) && !/[?？]/.test(text)) return { name: 'start_session' };
  if (can('choose_template') && status.page === 'templatePicker') {
    const t = named;
    if (t) return { name: 'choose_template', args: { name: t.name } };
    const n = templateNumber(text, templates.length); // "nomor dua", "yang ketiga"
    if (n) return { name: 'choose_template', args: { name: templates[n - 1].name } };
  }
  if (/[\u4e00-\u9fff]/.test(q)) { // Chinese
    if (QUESTION_ZH.test(q) || NEGATION_ZH.test(q)) return null;
    for (const [name, re] of INTENTS_ZH) {
      if (name === 'finish_session' && status.page !== 'result') continue;
      if (can(name) && re.test(q)) return { name };
    }
    return null;
  }
  if (QUESTION.test(q) || NEGATION.test(q)) return null;
  for (const [name, re] of INTENTS) {
    if (name === 'finish_session' && status.page !== 'result') continue; // "selesai" mid-session means something else
    if (can(name) && re.test(q)) return { name };
  }
  return goWord(q, status, can);
}

// A short "go" ("mulai", "lakukan", "gas", "yuk", "oke", "let's go", "开始") means the screen's
// next step: start on Welcome, the photo on the camera, carry on after the review.
const GO = /^(?:\W*(?:ayo|yuk|hayuk|ayuk|kuy|cus|gas(?:kan|lah|in)?|lanjut(?:kan|in)?|terus(?:kan|in)?|mulai(?:kan|in)?|lakukan|lakuin|kerjakan|langsung|sekarang|cepet(?:an)?|cepat|buruan|boleh|bisa|oke+|ok|okay|sip|siap|mantap|yes|ya+|iya+|yoi|sure|go+|do it|let'?s(?: go| do it| start)?|aja|dong|deh|lah|yok|nih|ah|kak|min)\W*)+$/;
const GO_ZH = /^(?:好的?|来吧|开始|走吧?|可以|行|继续|没问题|拍吧|来|吧|[，。！!,.\s])+$/;
const FORWARD = /lanjut|terus|gas|oke|ok|sip|mantap|go|继续|好/;
function goWord(q, status, can) {
  if (!(GO.test(q) || GO_ZH.test(q))) return null;
  const phase = status.camera?.phase;
  if (status.page === 'welcome' && can('start_session')) return { name: 'start_session' };
  if (status.page === 'camera' && (phase === 'liveIdle' || phase === 'shotDelay') && can('take_photo')) return { name: 'take_photo' };
  // after the review "ya" could answer "retake?": only clear forward words go on
  if (status.page === 'camera' && phase === 'review' && FORWARD.test(q) && can('process_photo')) return { name: 'process_photo' };
  return null;
}

// What the intent picker may choose, in its own words (with sample wordings: a small model
// follows examples better than definitions). No print / finish: paper and a guest's photos
// are not left to a guess; those need their clear words above.
const PICK = {
  start_session: 'start a photo session. E.g. "ayo foto", "mau difoto", "mulai", "gas", "yuk", "lakukan", "lanjut", "cekrek", "let\'s go", "开始", "拍照"',
  choose_template: 'pick one of the templates by its look or theme (template: which one)',
  take_photo: 'take the photo now (countdown). E.g. "foto", "jepret", "cekrek", "siap", "sekarang", "lakukan", "gas", "go", "拍吧"',
  retake_photo: 'redo the photo just taken. E.g. "ulang", "sekali lagi", "foto lagi", "jelek", "mataku merem", "again", "重拍"',
  process_photo: 'the photos are fine: continue, process them. E.g. "lanjut", "udah bagus", "oke", "proses", "next", "继续"',
  show_qr: 'QR code to save / download the photo on a phone. E.g. "simpan di hp", "download", "kirim ke hp", "QR", "二维码"',
  start_over: 'back to the start screen for a new session. E.g. "mulai lagi", "dari awal", "mau foto lagi", "start over", "重新开始"',
};

// The action the guest means, or null. Only the local LLM (a cloud brain calls its tools well).
export async function pickIntent({ text, status, templates }) {
  if (services.llm.state !== 'ready' || !services.llm.url) return null;
  const avail = status?.available || [];
  const acts = Object.keys(PICK).filter(n => avail.includes(TOOLS[n].cmd)
    && (n !== 'choose_template' || (templates.length && status.page === 'templatePicker'))
    && (n !== 'start_over' || status.page === 'result')); // (the photos are done there)
  if (!acts.length) return null;
  const screen = status.camera ? `camera, ${status.camera.phase}` : status.page;
  const system = `You decide what a photo booth guest wants, from their words (speech recognition, may be misheard; any language).
Screen now: ${screen}. Actions possible now:
${acts.map(a => `- ${a}: ${PICK[a]}`).join('\n')}
- none: a question, small talk, a compliment, "no", "not yet", "wait". E.g. "toiletnya di mana?", "bagus banget hasilnya", "tunggu dulu", "nanti aja".
${acts.includes('choose_template') ? `Templates: ${templates.map(t => t.name).join(', ')}.\n` : ''}Pick the action the guest asks for, in any wording, else none.`;
  const props = { action: { type: 'string', enum: [...acts, 'none'] } };
  if (acts.includes('choose_template')) props.template = { type: 'string', enum: ['-', ...templates.map(t => t.name)] };
  try {
    const r = await fetch(services.llm.url + '/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        messages: [{ role: 'system', content: system }, { role: 'user', content: text }],
        temperature: 0, max_tokens: 40, cache_prompt: true, chat_template_kwargs: { enable_thinking: false },
        id_slot: 1, // its own cache slot: the conversation's long prompt stays cached in slot 0
        response_format: { type: 'json_schema', json_schema: { name: 'intent', schema: { type: 'object', properties: props, required: Object.keys(props) } } },
      }),
    });
    const j = JSON.parse((await r.json()).choices?.[0]?.message?.content || '{}');
    if (!acts.includes(j.action)) return null;
    if (j.action === 'choose_template') return templates.some(t => t.name === j.template) ? { name: 'choose_template', args: { name: j.template } } : null;
    return { name: j.action };
  } catch { return null; }
}


// Strip what a voice can't say: markdown, emoji, hidden reasoning.
const PRICE = /\b(harga(nya)?|biaya(nya)?|bayar(nya)?|tarif(nya)?|price|prices|cost|how much)\b|多少钱|价格|价钱|费用|收费/;
const PRICE_INFO = /\b(harga|biaya|bayar|tarif|rp|gratis|free|price|cost)\b|价格|费用|收费|免费|元/i;
const PRICE_REPLY = {
  id: 'Soal harga, langsung tanya ke panitia ya. Kalau mau foto, aku bantu!',
  en: 'For prices, please ask the event staff. If you want a photo, I can help!',
  zh: '价格的话，请问一下工作人员哦。想拍照的话，我来帮你！',
};

// (A small model sometimes writes its tool call as text: never read that out.)
const speakable = s => s.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\s*\/?\s*(tool_?call|function)[\s\S]*/gi, '').replace(/[*_#`>~]/g, '')
  .replace(/\p{Extended_Pictographic}/gu, '').replace(/\s+/g, ' ').trim();

export class Chat {
  constructor(cfg, qb) {
    this.cfg = cfg;
    this.qb = qb;         // (method, path, body) -> Local API JSON
    this.history = [];
    this.lastTurn = 0;
    this.sessionKey = null;
  }

  // A new guest = a fresh conversation: a new booth session, or 3 quiet minutes.
  maybeReset(status) {
    const key = status?.session?.active ? 'session:' + (status.session.templateId || 'open') : 'idle';
    const newSession = status?.session?.active && !String(this.sessionKey).startsWith('session:');
    if (newSession || Date.now() - this.lastTurn > 180000) this.history = [];
    this.sessionKey = key;
  }

  // The first question otherwise waits while llama reads the whole system prompt and the
  // tools (seconds on a CPU): read them now, with the booth's current event in the prompt.
  async warm(lang) {
    if (services.llm.state !== 'ready') return;
    try {
      const status = (await this.qb('GET', 'status')).data || null;
      const t0 = Date.now();
      await fetch(services.llm.url + '/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(60000),
        body: JSON.stringify({
          messages: [{ role: 'system', content: systemPrompt(this.cfg, lang, status) }, { role: 'user', content: statusNote(lang, status, []) + '\n' + 'Halo' }],
          tools: toolDefs(lang), tool_choice: 'auto', max_tokens: 1, cache_prompt: true, id_slot: 0, chat_template_kwargs: { enable_thinking: false },
        }),
      });
      console.log(`LLM: prompt cached for "${lang}" in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    } catch (err) { console.log('LLM warm-up: ' + err.message); }
  }

  // emit({ t: 'say', text } | { t: 'action', tool, cmd, ok, code } | { t: 'error', message })
  async turn(text, lang, emit) {
    const llm = services.llm;
    if (!cloudKey(this.cfg.llm) && llm.state !== 'ready') throw new Error(`LLM is ${llm.state}${llm.error ? ': ' + llm.error : ''}`);
    let status = (await this.qb('GET', 'status')).data || null;
    this.status = status;
    this.maybeReset(status);
    this.lastTurn = Date.now();
    let templates = [];
    if (status?.event) templates = inScreenOrder((await this.qb('GET', 'templates')).data || []);

    // History only ever grows within a conversation (append-only): the prompt then
    // stays a cached prefix, for llama.cpp and for the cloud providers alike. The
    // booth status goes in with the guest's words; after an action, the new status
    // rides on the tool result.
    this.history.push({ role: 'user', content: statusNote(lang, status, templates) + '\n' + text });
    // Long talks: keep the last turns, starting at a guest message (never an orphan tool result).
    while (this.history.length > 24 || (this.history.length && this.history[0].role !== 'user')) this.history.shift();

    // A clear command ("take the photo", "print", a template's name) runs right
    // away in code; the LLM then only talks about it. A small model sometimes
    // *says* it did something without calling the tool, so we don't rely on it
    // for the obvious cases.
    // Prices: a small model makes them up. Unless the event info gives them, a fixed answer.
    if (PRICE.test(text.toLowerCase()) && !PRICE_INFO.test(this.cfg.eventInfo || '')) {
      const reply = PRICE_REPLY[lang];
      this.history.push({ role: 'assistant', content: reply });
      emit({ t: 'say', text: reply });
      return;
    }

    // A clear command in code; else the intent picker (any wording, ~0.2 s on a GPU)
    const routed = status && (routeIntent(text, status, templates) || (!this.cfg.llm?.noPicker && await pickIntent({ text, status, templates })));
    if (routed) console.log(`intent: ${routed.name}${routed.args?.name ? ' ' + routed.args.name : ''}`);
    if (routed) {
      const call = { id: 'call_routed', type: 'function', function: { name: routed.name, arguments: JSON.stringify(routed.args || {}) } };
      this.history.push({ role: 'assistant', content: null, tool_calls: [call] });
      const result = await this.runTool(call, templates, lang, emit);
      // Done: a fixed line now, no LLM (it only talks when the command failed, to explain).
      if (result.ok) {
        const ack = (ACK[routed.name]?.[lang] ?? '').replace('{name}', result.template || '');
        if (ack) emit({ t: 'say', text: ack });
        this.history.push({ role: 'assistant', content: ack || TOOLS[routed.name].next[lang] });
        return;
      }
      status = await this.settle(status, lang, templates);
    }

    const system = systemPrompt(this.cfg, lang, status); // the same all conversation long
    for (let round = routed ? 1 : 0; round < 2; round++) {
      // After an action: talk about it, no further tools (the tool list stays in the prompt for the cache).
      const messages = [{ role: 'system', content: system }, ...this.history];
      const { content, toolCalls } = await this.stream(messages, toolDefs(lang), emit, round === 0 ? 'auto' : 'none');
      this.history.push(toolCalls.length
        ? { role: 'assistant', content: content || null, tool_calls: toolCalls }
        : { role: 'assistant', content });
      if (!toolCalls.length) return;
      for (const call of toolCalls) await this.runTool(call, templates, lang, emit);
      status = await this.settle(status, lang, templates);
    }
  }

  // Let the booth react, then read the new state. It goes on the last tool result,
  // which the LLM has not seen yet, so the history stays append-only.
  async settle(status, lang, templates) {
    await new Promise(r => setTimeout(r, 600));
    const s = (await this.qb('GET', 'status')).data || status;
    this.status = s;
    const last = this.history.at(-1);
    if (last?.role === 'tool') last.content = JSON.stringify({ ...JSON.parse(last.content), booth: statusNote(lang, s, templates) });
    return s;
  }

  async runTool(call, templates, lang, emit) {
    const name = call.function.name;
    let args = {};
    try { args = JSON.parse(call.function.arguments || '{}'); } catch { }
    const result = await boothTool({ qb: this.qb, status: this.status, templates }, name, args);
    emit({ t: 'action', tool: name, cmd: TOOLS[name]?.cmd, ok: !!result.ok, code: result.error?.code });
    this.history.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(toolReply(name, result, lang)) });
    return result;
  }

  // One streamed completion: the cloud LLM when one is set up, the local one
  // otherwise, or as the stand-in when the cloud fails before saying anything
  // (no internet at the venue, a key out of quota, ...).
  async stream(messages, tools, emit, toolChoice = 'auto') {
    const c = this.cfg.llm || {};
    const key = cloudKey(c);
    // After a failure the cloud gets a minute off (no internet: each turn would
    // otherwise wait for its timeout first), unless no local LLM can stand in.
    const resting = cloud.state === 'failed' && Date.now() - cloud.failedAt < 60000 && services.llm.state === 'ready';
    if (key && !resting) {
      let said = false;
      try {
        const out = await this.streamFrom(cloudRequest(c, key, { messages, tools, toolChoice }), o => { said = true; emit(o); }, 8000);
        Object.assign(cloud, { state: 'ready', error: null });
        return out;
      } catch (err) {
        Object.assign(cloud, { state: 'failed', error: err.message, failedAt: Date.now() });
        if (said || services.llm.state !== 'ready') throw err;
        console.log(`cloud LLM (${c.provider}) failed: ${err.message}; answering with the local LLM`);
      }
    }
    return this.streamFrom({
      url: services.llm.url + '/v1/chat/completions', headers: {},
      body: {
        messages, stream: true, temperature: c.temperature ?? 0.7, max_tokens: c.maxTokens || talkOf(this.cfg).tokens,
        // Qwen's settings for its small models without thinking: keeps a 1-2B model from
        // repeating itself until the token limit
        top_p: c.topP ?? 0.8, top_k: c.topK ?? 20, presence_penalty: c.presencePenalty ?? 1.5,
        tools, tool_choice: toolChoice, cache_prompt: true, id_slot: 0,
        chat_template_kwargs: { enable_thinking: false },
      },
    }, emit, 60000);
  }

  // Sentences are emitted as soon as they end, so the avatar starts talking while
  // the model is still writing. firstMs: how long to wait for the answer to start.
  async streamFrom({ url, headers, body }, emit, firstMs) {
    const ctl = new AbortController();
    let timer = setTimeout(() => ctl.abort(new Error(`no answer within ${firstMs / 1000} s`)), firstMs);
    let r;
    try {
      r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal });
    } catch (err) {
      clearTimeout(timer);
      throw ctl.signal.aborted ? ctl.signal.reason : err;
    }
    clearTimeout(timer);
    if (!r.ok) throw new Error(`LLM ${r.status}: ${scrubKey((await r.text()).slice(0, 300))}`);
    timer = setTimeout(() => ctl.abort(new Error('answer took too long')), 60000);

    // where a spoken answer stops (the talk level): a small model sometimes goes on and on
    const MAX_SENTENCES = talkOf(this.cfg).sentences;
    let content = '', pending = '', sse = '', said = '', sentences = 0;
    const calls = [];
    const flush = all => {
      // A sentence ends at . ! ? followed by a space (or at the very end).
      let m;
      while (sentences < MAX_SENTENCES && (m = pending.match(/^([\s\S]*?(?:[。！？]+|[.!?…]+(?=\s|$)))(\s*)/)) && (m[2] || all || /[。！？]$/.test(m[1]))) {
        const s = speakable(m[1]);
        if (s) { emit({ t: 'say', text: s }); said += (said ? ' ' : '') + s; sentences++; }
        pending = pending.slice(m[0].length);
      }
      if (all && sentences < MAX_SENTENCES && speakable(pending)) { const s = speakable(pending); emit({ t: 'say', text: s }); said += (said ? ' ' : '') + s; }
      if (all) pending = '';
    };
    const decoder = new TextDecoder();
    for await (const chunk of r.body) {
      sse += decoder.decode(chunk, { stream: true });
      let i;
      while ((i = sse.indexOf('\n')) >= 0) {
        const line = sse.slice(0, i).trim();
        sse = sse.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        const json = JSON.parse(data);
        if (json.error) throw new Error('LLM: ' + scrubKey(json.error.message || JSON.stringify(json.error)));
        const delta = json.choices?.[0]?.delta || {};
        if (delta.content) {
          content += delta.content;
          pending += delta.content;
          if (/<\/think>/.test(pending)) pending = pending.replace(/^[\s\S]*<\/think>/, ''); // drop hidden reasoning
          if (!/<think>/.test(pending)) flush(false);
          if (sentences >= MAX_SENTENCES) break; // enough said: stop the model
        }
        for (const tc of delta.tool_calls || []) {
          // Gemini sends each call whole, sometimes without an index
          const known = tc.id ? calls.findIndex(x => x?.id === tc.id) : -1;
          const k = tc.index ?? (known >= 0 ? known : calls.length);
          calls[k] ||= { id: tc.id || 'call_' + k, type: 'function', function: { name: '', arguments: '' } };
          if (tc.id) calls[k].id = tc.id;
          if (tc.function?.name) calls[k].function.name += tc.function.name;
          if (tc.function?.arguments) calls[k].function.arguments += tc.function.arguments;
          if (tc.extra_content) calls[k].extra_content = tc.extra_content; // Gemini 3: its thought signature, sent back with the history
        }
      }
      if (sentences >= MAX_SENTENCES) break; // (leaving the stream closes it: the model stops)
    }
    clearTimeout(timer);
    flush(true);
    // (the history keeps what was said, not what was cut off)
    return { content: sentences >= MAX_SENTENCES ? said : speakable(content), toolCalls: calls.filter(Boolean) };
  }
}

// The request for a cloud LLM: OpenAI-compatible chat completions on both.
function cloudRequest(c, key, { messages, tools, toolChoice }) {
  const prov = c.provider === 'gemini-live' ? 'gemini' : c.provider; // Live's text stand-in
  const p = c[prov];
  const common = { model: p.model, messages, stream: true, temperature: c.temperature ?? 0.7, tools, tool_choice: toolChoice };
  if (prov === 'gemini') {
    // Gemini 3 wants each earlier tool call back with its thought signature. Calls it did not
    // make (routed in code, or by the local stand-in) get Google's documented skip value.
    const signed = messages.map(m => !m.tool_calls ? m : { ...m, tool_calls: m.tool_calls.map(tc => tc.extra_content?.google?.thought_signature ? tc
      : { ...tc, extra_content: { google: { thought_signature: 'skip_thought_signature_validator' } } }) });
    // Gemini counts its thinking inside max_tokens: leave room, and think little (speed).
    return { url: p.url, headers: { Authorization: 'Bearer ' + key }, body: { ...common, messages: signed, max_tokens: 4096, reasoning_effort: 'low' } };
  }
  return {
    url: p.url,
    headers: { Authorization: 'Bearer ' + key, 'HTTP-Referer': 'https://www.lumaqube.com', 'X-Title': 'QBooth Avatar' },
    body: { ...common, max_tokens: 1024, reasoning: { effort: 'low' } },
  };
}

// Never let an API key reach a log or the page.
const scrubKey = s => String(s).replace(/(sk-or-v1-|AIza|AQ\.)[A-Za-z0-9_\-.]{8,}/g, '$1…');
