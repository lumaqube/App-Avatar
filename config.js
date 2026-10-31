// config.json overrides config.example.json, merged key by key at every level.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// Where config.json is looked for: next to "Avatar.exe" first (in the
// packaged app the code sits deep in resources\app), then next to this file.
export function configPath() {
  const candidates = [path.join(path.dirname(process.execPath), 'config.json'), path.join(ROOT, 'config.json')];
  return candidates.find(f => fs.existsSync(f)) || null;
}

// Where the settings screen saves: the existing config.json, else next to the
// exe in the packaged app, else next to this file (development).
export function configWritePath() {
  const packaged = path.basename(process.execPath).toLowerCase() === 'avatar.exe';
  return configPath() || path.join(packaged ? path.dirname(process.execPath) : ROOT, 'config.json');
}

// The owner's own settings only (config.json), without the defaults.
export function loadOwnConfig() {
  const file = configPath();
  return file ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

export function loadConfig() {
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.example.json'), 'utf8'));
  const file = configPath();
  const own = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  return deepMerge(base, own);
}

// Plain objects merge key by key at every level (own wins); anything else is replaced.
function deepMerge(base, own) {
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  const out = { ...base };
  for (const [k, v] of Object.entries(own || {})) out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : v;
  return out;
}
