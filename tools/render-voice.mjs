// Pre-renders every fixed line into public/voice/<lang>/<hash>.wav, so the
// avatar plays them instantly and the booth PC needs no TTS engine (or GPU) for them.
//
//   node tools/render-voice.mjs --lang id                     engine from config.tts.engine
//   node tools/render-voice.mjs --lang id --engine omnivoice  best quality (Voice Studio on :3900, ~10 s a line)
//   node tools/render-voice.mjs --lang id --from-booth        also the "{name}" lines for every
//                                                             template of every event (QBooth Local API)
//   node tools/render-voice.mjs --lang id --templates "Strip 3,Portrait Gold"
//   --force   render again even if the clip exists        --list   only print the lines
//
// One line at a time (the GPU fits one model). public/voice/<lang>/index.json maps clip -> text.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { ROOT, hashOf, clipPath, engineFor, generate, shutdown } from '../tts.js';
import { allTexts } from '../public/lines.js';

const argv = process.argv.slice(2);
const opt = n => { const i = argv.indexOf('--' + n); return i < 0 ? undefined : (argv[i + 1]?.startsWith('--') ? true : argv[i + 1] ?? true); };
const cfg = loadConfig();
const lang = opt('lang') === 'en' ? 'en' : 'id';
const engine = opt('engine') || engineFor(cfg, lang);

async function boothTemplateNames() {
  const { host, port, password } = cfg.qbooth;
  const get = async p => {
    const r = await fetch(`http://${host}:${port}/api/v1/${p}`, { headers: { Authorization: 'Bearer ' + password } });
    const j = await r.json();
    if (!j.ok) throw new Error(`QBooth ${p}: ${j.error?.code}`);
    return j.data;
  };
  const names = new Set();
  for (const ev of await get('events')) {
    if (ev.archived) continue;
    for (const t of await get('templates?eventId=' + encodeURIComponent(ev.id))) names.add(t.name);
  }
  return [...names];
}

const names = (typeof opt('templates') === 'string' ? opt('templates').split(',').map(s => s.trim()).filter(Boolean) : [])
  .concat(opt('from-booth') ? await boothTemplateNames() : []);
const texts = allTexts(lang, names);

if (opt('list')) { texts.forEach(t => console.log(hashOf(lang, t), t)); process.exit(0); }
if (!['piper', 'omnivoice', 'sapi'].includes(engine)) {
  console.error(`No TTS engine for "${lang}": pass --engine piper|omnivoice|sapi or set config.tts.engine.${lang}`);
  process.exit(1);
}

const dir = path.join(ROOT, 'public/voice', lang);
const indexFile = path.join(dir, 'index.json');
fs.mkdirSync(dir, { recursive: true });
const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : {};

console.log(`${texts.length} lines, language ${lang}, engine ${engine}`);
let made = 0, failed = 0;
for (const [i, text] of texts.entries()) {
  const file = clipPath(lang, text);
  if (fs.existsSync(file) && !opt('force')) continue;
  const t0 = Date.now();
  try {
    await generate(cfg, engine, lang, text, file);
    index[path.basename(file)] = { text, engine, at: new Date().toISOString() };
    fs.writeFileSync(indexFile, JSON.stringify(index, null, 1));
    made++;
    console.log(`[${i + 1}/${texts.length}] ${((Date.now() - t0) / 1000).toFixed(1)}s  ${text}`);
  } catch (err) {
    failed++;
    console.error(`[${i + 1}/${texts.length}] FAILED  ${text}\n  ${err.message}`);
    if (/ECONNREFUSED|fetch failed/.test(err.message)) { console.error(`${engine} is not running: stopping.`); break; }
  }
}
console.log(`done: ${made} rendered, ${failed} failed, ${texts.length - made - failed} already there`);
shutdown();
