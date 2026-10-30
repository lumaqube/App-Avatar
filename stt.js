// Speech to text through whisper-server (whisper.cpp). Input: a 16 kHz mono WAV.
import { services } from './services.js';

// Whisper "hears" these in silence or noise; drop them.
const HALLUCINATIONS = [
  // nothing but punctuation (Unicode-aware: Chinese characters are letters, not \W)
  /^[\p{P}\p{S}\s]*$/u, /terima kasih (telah|sudah) menonton/i, /thank(s| you) for watching/i,
  /^\s*[\[(].*[\])]\s*$/, /subtitle|subtitel|amara\.org/i,
  /谢谢观看|订阅|点赞|字幕|明镜|点点栏目/,
  /^\W*(\S+?)\W*(?:[\s,.]+\1\W*){2,}$/i, // one word over and over ("Photo Photo Photo Photo"): noise, not a guest

];

// Words a guest is likely to say, given to whisper as its "prompt": it then
// spells them right and mishears them less (template names above all).
const VOCAB = {
  id: 'Percakapan di photobooth Q-Booth. Ayo foto, mau foto, ambil foto, foto lagi, ulangi, template, pilih template, proses, lanjut, cetak, print, QR, scan, download, selesai, makasih.',
  zh: '在 Q-Booth 拍照亭的对话。我要拍照，拍吧，重拍，模板，选模板，处理，继续，打印，二维码，扫码，下载，结束，谢谢。',
  en: 'A conversation at a Q-Booth photo booth. Take a photo, retake, template, choose a template, process, print, QR code, scan, download, done, thanks.',
};

// What a guest says on each screen, last in the prompt (whisper leans most on the end of it):
// a word that sounds alike then comes out as the command that is possible right now.
const SCREEN = {
  id: { welcome: 'Ayo foto, mulai.', templatePicker: 'Pilih template, nomor satu, nomor dua, yang ini.', liveIdle: 'Foto, jepret, siap, sekarang.', review: 'Foto ulang, proses, lanjut, ulangi.', result: 'Cetak, QR, download, mulai lagi, selesai, terima kasih.' },
  en: { welcome: "Let's take a photo, start.", templatePicker: 'Pick a template, number one, number two, this one.', liveIdle: 'Photo, take it, ready, now.', review: 'Retake, process, continue, again.', result: 'Print, QR code, download, start over, done, thank you.' },
  zh: { welcome: '我要拍照，开始。', templatePicker: '选模板，第一个，第二个，这个。', liveIdle: '拍吧，拍照，准备好了。', review: '重拍，处理，继续。', result: '打印，二维码，下载，重新开始，结束，谢谢。' },
};
const screenOf = status => status?.camera ? (status.camera.phase === 'review' ? 'review' : 'liveIdle') : status?.page;

// name: the assistant's own name, spelled right (wake mode listens for it). status: the booth
// now; its screen's words go last, and the template names only where templates are picked.
export function vocabPrompt(lang, templateNames = [], name = '', status = null) {
  const screen = screenOf(status);
  const pick = !status || screen === 'welcome' || screen === 'templatePicker';
  const names = pick && templateNames.length ? ({ en: ' Templates: ', zh: ' 模板：' }[lang] || ' Template: ') + templateNames.join(', ') + '.' : '';
  const now = (SCREEN[lang] || SCREEN.id)[screen];
  return (name ? name + '. ' : '') + (VOCAB[lang] || VOCAB.id) + names + (now ? ' ' + now : '');
}

export async function transcribe(wav, lang, prompt) {
  const s = services.stt;
  if (s.state !== 'ready') throw new Error(`speech-to-text is ${s.state}${s.error ? ': ' + s.error : ''}`);
  const fd = new FormData();
  fd.append('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav');
  fd.append('language', ['en', 'zh'].includes(lang) ? lang : 'id');
  fd.append('response_format', 'json');
  fd.append('temperature', '0');
  if (prompt) fd.append('prompt', prompt);
  const r = await fetch(s.url + '/inference', { method: 'POST', body: fd, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`whisper ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const text = ((await r.json()).text || '').replace(/\s+/g, ' ').trim();
  // Whisper sometimes just repeats its prompt back when it heard nothing.
  if (prompt && text.length > 20 && prompt.includes(text)) return '';
  return HALLUCINATIONS.some(re => re.test(text)) ? '' : text;
}
