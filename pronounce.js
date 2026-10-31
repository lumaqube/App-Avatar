// How the voice says words its engine gets wrong: the text is rewritten as it sounds before
// it is spoken (only the voice; nothing is shown on screen). Checked by ear-proxy: each
// spelling spoken by Piper, heard back by whisper (e.g. "Q-Booth" came out as "keyboard").
// The owner's own list ("pronunciations" in the settings: one "word = how to say it" a line)
// comes first and applies to every language. The Q-Booth rules (QBOOTH) apply only when the
// connected booth app is Q-Booth (public/brand.js); the other brand builds keep their name.
import { isQBooth } from './public/brand.js';

const QBOOTH = {
  id: [[/\bQ-?\s?Booth\b/gi, 'Kyubuth']],
  en: [[/\bQ-?Booth\b/gi, 'Q Booth']],
  zh: [[/\bQ-?\s?Booth\b/gi, '丘布斯']], // the Mandarin voice cannot say Latin letters
};

const BUILT_IN = {
  id: [
    [/\bphoto\s?booth\b/gi, 'fotobut'],
    [/\bQRIS\b/g, 'kris'],
    [/\bQR(nya)?\b/g, 'kyu ar$1'],
    // with Indonesian affixes: templatenya, discan, diupload
    [/\btemplates\b/gi, 'templet'],
    [/\btemplate(nya)?\b/gi, 'templet$1'],
    [/\b(di|ter)?scan(nya)?\b/gi, '$1sken$2'],
    [/\b(di|meng|ter)?upload(nya)?\b/gi, '$1aplod$2'],
    [/\bonline\b/gi, 'onlen'],
  ],
  en: [
    [/\bQRIS\b/g, 'Kris'],
  ],
  zh: [
    // the Mandarin voice cannot say Latin letters: the nearest Chinese sounds
    [/\bQRIS\b/g, '克里斯'],
    [/(?<![A-Za-z])QR(?![A-Za-z])\s?(码|code)?/gi, '二维码'], // "QR码" too: no 码 twice
  ],
};

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "Q-Booth = Kyubuth" lines -> [regex, replacement]
function ownList(text) {
  return String(text || '').split(/\r?\n/).map(l => l.split('=')).filter(p => p.length === 2 && p[0].trim() && p[1].trim())
    .map(([w, say]) => [new RegExp(`(^|[^\\p{L}\\p{N}])${escape(w.trim())}(?=$|[^\\p{L}\\p{N}])`, 'giu'), '$1' + say.trim()]);
}

export function pronounce(cfg, lang, text) {
  let out = text;
  const brand = isQBooth() ? QBOOTH[lang] || [] : [];
  for (const [re, say] of [...ownList(cfg.pronunciations), ...brand, ...(BUILT_IN[lang] || [])]) out = out.replace(re, say);
  return out;
}
