// The booth app's name as guests and operators see it ("brand"). The booth app comes in brand
// builds with the same Local API: QBooth.exe (product "QBooth"), BleepShare.exe ("BleepShareAI"),
// XBooth.exe ("XBooth"). Its status reply names the product (status.app.name), so nothing the
// user sees is tied to one brand: texts carry {booth} / {Booth} / {boothShort}, filled here.
// The setting "brandName" overrides the reported name; before any connection a neutral word.
// Used by the page and the server alike (each keeps its own last seen name, for the session).

// Neutral words: long = in a sentence ("Lost connection to the booth app"), short = a title.
const NEUTRAL = {
  id: { long: 'aplikasi booth', short: 'Booth' },
  en: { long: 'the booth app', short: 'Booth' },
  zh: { long: '拍照亭应用', short: '拍照亭' },
};

// The product name the Local API reports, as people write it ("QBooth" -> "Q-Booth").
export function brandName(appName) {
  const n = String(appName || '').replace(/\s*\(mock\)\s*$/i, '').trim();
  if (!n) return null;
  return n === 'QBooth' ? 'Q-Booth' : n;
}

let seen = null, override = '';
const listeners = new Set();
const changed = () => listeners.forEach(fn => { try { fn(currentBrand()); } catch { } });

// The "brandName" setting (empty = the name the booth app reports).
export function setBrandOverride(name) {
  const n = String(name || '').trim();
  if (n === override) return;
  override = n;
  changed();
}

// A name the booth app reported (status.app.name), or a status reply.
export function noteAppName(appName) {
  const b = brandName(appName);
  if (!b || b === seen) return;
  const before = currentBrand();
  seen = b;
  if (currentBrand() !== before) changed();
}
export const noteStatus = status => noteAppName(status?.app?.name);

export const seenBrand = () => seen;
// The name to show, or null before any connection (and no override).
export const currentBrand = () => override || seen || null;
export const isQBooth = () => currentBrand() === 'Q-Booth';
// Called with the new name whenever it changes; returns an "unsubscribe".
export function onBrand(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function boothVars(lang) {
  const b = currentBrand(), n = NEUTRAL[lang] || NEUTRAL.en;
  const long = b || n.long;
  return { booth: long, Booth: long[0].toUpperCase() + long.slice(1), boothShort: b || n.short };
}

// "{booth}" -> "XBooth" / "the booth app", "{Booth}" -> the same at a sentence start,
// "{boothShort}" -> "XBooth" / "Booth".
export function fillBooth(text, lang) {
  const v = boothVars(lang);
  return String(text ?? '').replace(/\{(booth|Booth|boothShort)\}/g, (_, k) => v[k]);
}
