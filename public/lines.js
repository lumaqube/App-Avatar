// Fixed lines, per language. Each key has variants; one is picked at random.
// {name} = template name, {n} / {total} = shot numbers.
export const LINES = {
  id: {
    greet: ['Halo! Selamat datang di photobooth. Yuk, foto bareng!', 'Hai! Senang ketemu kamu. Mau foto seru hari ini?', 'Halo, selamat datang! Bilang saja "ayo foto" kalau mau mulai.'],
    invite: ['Ayo foto! Bilang saja "ayo foto" ke aku.', 'Bawa teman-temanmu, makin ramai makin seru!', 'Mau kenang-kenangan hari ini? Foto di sini, yuk!', 'Psst, fotonya bisa langsung dicetak lho.'],
    survey: ['Isi survei singkatnya dulu ya.'],
    categoryPicker: ['Pilih kategori yang kamu suka.'],
    templatePicker: ['Sekarang pilih template favoritmu.', 'Mau gaya yang mana? Pilih templatenya ya.', 'Pilih template di layar, atau sebut namanya ke aku.'],
    templateChosen: ['Pilihan bagus! {name}.', 'Oke, {name}. Keren!'],
    input: ['Isi datanya dulu ya.'],
    cameraReady: ['Siap? Lihat ke kamera, lalu bilang "foto" kalau sudah siap.', 'Atur posenya dulu, kalau sudah siap bilang "foto" ya.'],
    countFirst: ['Senyum!', 'Siap-siap, senyum!'],
    countNext: ['Foto {nth}. Ganti gaya!', 'Foto {nth}. Pose baru!'],
    review: ['Bagus! Mau foto ulang, atau lanjut proses?'],
    reviewNoRetake: ['Keren! Bilang "proses" untuk lanjut.'],
    retake: ['Oke, kita ulang ya.'],
    processing: ['Sebentar ya, fotonya sedang diproses. Sambil nunggu, ngobrol sama aku yuk!', 'Hasilnya lagi disiapkan. Sambil menunggu, mau tanya apa?'],
    result: ['Fotonya sudah jadi! Mau dicetak, atau scan QR untuk download?', 'Taraa! Hasilnya keren. Cetak atau scan QR, ya.'],
    dialog: ['Ikuti petunjuk di layar ya.'],
    bye: ['Terima kasih! Sampai jumpa lagi.', 'Makasih sudah mampir! Dadah!'],
    noEvent: ['Photobooth sedang disiapkan. Sebentar ya.'],
    offline: ['Koneksi ke Q-Booth terputus.'],
    notHeard: ['Maaf, aku belum dengar. Coba ngomong lagi ya, agak dekat ke layar.', 'Hmm, suaranya belum masuk. Coba sekali lagi ya.'],
    aiOffline: ['Maaf, aku lagi belum bisa ngobrol. Pakai tombol di layar Q-Booth dulu ya.'],
  },
  zh: {
    greet: ['你好！欢迎来到拍照亭。一起来拍照吧！', '嗨！很高兴见到你。今天想拍几张好玩的照片吗？', '你好，欢迎！想开始的话，就跟我说“我要拍照”。'],
    invite: ['来拍照吧！跟我说“我要拍照”就行。', '叫上你的朋友，人越多越热闹！', '想留个纪念吗？来这里拍张照吧！', '悄悄告诉你，照片可以马上打印出来哦。'],
    survey: ['请先填一下简短的问卷。'],
    categoryPicker: ['选一个你喜欢的分类吧。'],
    templatePicker: ['现在选一个你喜欢的模板吧。', '想要哪种风格？选一个模板吧。', '在屏幕上选模板，或者告诉我它的名字。'],
    templateChosen: ['好选择！{name}。', '好的，{name}。很酷！'],
    input: ['请先填一下资料。'],
    cameraReady: ['准备好了吗？看着相机，准备好了就说“拍吧”。', '先摆好姿势，准备好了就说“拍吧”。'],
    countFirst: ['笑一个！', '准备，笑一个！'],
    countNext: ['第{n}张，换个姿势！', '第{n}张，新姿势！'],
    review: ['拍得真好！要重拍，还是继续处理？'],
    reviewNoRetake: ['很棒！说“继续”就开始处理。'],
    retake: ['好的，我们重拍一张。'],
    processing: ['稍等一下，照片正在处理。等的时候，跟我聊聊天吧！', '照片马上就好。等的时候，想问我什么吗？'],
    result: ['照片好了！要打印，还是扫二维码下载？', '当当！拍得真好看。打印或者扫二维码都可以。'],
    dialog: ['请按照屏幕上的提示操作。'],
    bye: ['谢谢！下次见。', '谢谢光临！拜拜！'],
    noEvent: ['拍照亭正在准备中，请稍等。'],
    offline: ['和 Q-Booth 的连接断开了。'],
    notHeard: ['不好意思，我没听清。请再说一次，靠近屏幕一点。', '嗯，声音没进来。再试一次吧。'],
    aiOffline: ['不好意思，我现在还不能聊天。请先用 Q-Booth 屏幕上的按钮。'],
  },
  en: {
    greet: ['Hi! Welcome to the photo booth. Let\'s take a picture!', 'Hello! Nice to see you. Ready for some fun photos?', 'Welcome! Just say "let\'s take a photo" to start.'],
    invite: ['Come take a photo! Just tell me "let\'s take a photo".', 'Bring your friends, the more the merrier!', 'Want a souvenir from today? Take a photo here!', 'Psst, your photo can be printed right away.'],
    survey: ['Please fill in the short survey first.'],
    categoryPicker: ['Pick a category you like.'],
    templatePicker: ['Now pick your favourite template.', 'Which style do you like? Pick a template.', 'Pick a template on the screen, or tell me its name.'],
    templateChosen: ['Great choice! {name}.', 'Okay, {name}. Nice!'],
    input: ['Please fill in your details first.'],
    cameraReady: ['Ready? Look at the camera, and say "photo" when you are.', 'Strike a pose, and say "photo" when you\'re ready.'],
    countFirst: ['Smile!', 'Get ready, smile!'],
    countNext: ['Photo {n}. New pose!', 'Photo {n}. Change it up!'],
    review: ['Looks great! Retake, or go on to process?'],
    reviewNoRetake: ['Nice! Say "process" to continue.'],
    retake: ['Okay, let\'s do that one again.'],
    processing: ['One moment, your photo is being processed. Chat with me while you wait!', 'Getting your photo ready. Anything you want to ask meanwhile?'],
    result: ['Your photo is ready! Print it, or scan the QR to download.', 'Ta-da! Looks great. Print it or scan the QR.'],
    dialog: ['Please follow the steps on the screen.'],
    bye: ['Thank you! See you again.', 'Thanks for stopping by! Bye!'],
    noEvent: ['The photo booth is getting ready. One moment.'],
    offline: ['Lost connection to Q-Booth.'],
    notHeard: ['Sorry, I didn\'t catch that. Try again, a little closer to the screen.', 'Hmm, I didn\'t hear you. One more time?'],
    aiOffline: ['Sorry, I can\'t chat right now. Please use the buttons on the Q-Booth screen.'],
  },
};

// UI labels: the start overlay (a browser without ?autostart=1), typing a question (T),
// placing the character and its buttons (Ctrl+Alt+Shift+P).
export const UI = {
  id: { tapToStart: 'Sentuh untuk mengaktifkan asisten', typePrompt: 'Ketik pertanyaan:', tip: 'Geser karakter dan tiap tombol ke tempatnya · − / + ukuran karakter', reset: 'Atur ulang', done: 'Selesai' },
  en: { tapToStart: 'Tap to activate the assistant', typePrompt: 'Type a question:', tip: 'Drag the character and each button into place · − / + the character\'s size', reset: 'Reset', done: 'Done' },
  zh: { tapToStart: '点击启动助手', typePrompt: '输入问题：', tip: '把角色和每个按钮拖到合适的位置 · − / + 调整角色大小', reset: '重置', done: '完成' },
};

// Indonesian ordinals, so TTS says "kedua" rather than reading "ke-2".
const ORDINAL_ID = ['', 'pertama', 'kedua', 'ketiga', 'keempat', 'kelima', 'keenam', 'ketujuh', 'kedelapan', 'kesembilan', 'kesepuluh'];

const fill = (line, vars) => line.replace(/\{(\w+)\}/g, (_, k) =>
  k === 'nth' ? (ORDINAL_ID[vars.n] || 'ke-' + vars.n) : (vars[k] ?? ''));

export function pick(lang, key, vars = {}) {
  const list = (LINES[lang] || LINES.id)[key];
  if (!list) return '';
  return fill(list[Math.floor(Math.random() * list.length)], vars);
}

// Every line the avatar can say, for pre-rendering clips (tools/render-voice.mjs).
// {n}/{nth} are expanded for shots 2-10; lines with {name} need the template
// names, passed in (from the booth's events), and are skipped without them.
export function allTexts(lang, templateNames = []) {
  const out = new Set();
  for (const line of Object.values(LINES[lang] || {}).flat()) {
    if (/\{name\}/.test(line)) templateNames.forEach(name => out.add(fill(line, { name })));
    else if (/\{n(th)?\}/.test(line)) for (let n = 2; n <= 10; n++) out.add(fill(line, { n }));
    else out.add(line);
  }
  return [...out];
}
