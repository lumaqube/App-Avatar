// What the avatar gallery shows about each VRM: its name, authors, licence /
// credit line (from the VRM meta) and its thumbnail (an image inside the file).
import fs from 'node:fs';

// The glTF JSON and BIN chunks of a .vrm (binary glTF).
function readGlb(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'glTF') throw new Error('not a VRM / glTF file');
  let off = 12, json = null, bin = null;
  while (off < b.length) {
    const len = b.readUInt32LE(off), type = b.toString('ascii', off + 4, off + 8);
    if (type === 'JSON') json = JSON.parse(b.slice(off + 8, off + 8 + len).toString());
    else if (type === 'BIN\0') bin = b.slice(off + 8, off + 8 + len);
    off += 8 + len;
  }
  return { json, bin };
}

export function avatarInfo(file) {
  const { json } = readGlb(file);
  const v1 = json.extensions?.VRMC_vrm, v0 = json.extensions?.VRM;
  const m = v1?.meta || v0?.meta || {};
  const authors = m.authors || (m.author ? [m.author] : []);
  // VRM 1.0 says whether a credit is required; the 0.x meta has no such field.
  const credit = (v1 ? m.creditNotation === 'required' : false) ? `${m.name || 'Model'} by ${authors.join(', ')}` : '';
  return { name: m.name || m.title || '', authors, license: m.licenseUrl || m.otherLicenseUrl || m.licenseName || '', credit };
}

// The thumbnail image: { type, data } or null.
export function avatarThumb(file) {
  const { json, bin } = readGlb(file);
  const v1 = json.extensions?.VRMC_vrm, v0 = json.extensions?.VRM;
  let img = v1 ? v1.meta?.thumbnailImage : json.textures?.[v0?.meta?.texture]?.source;
  const image = json.images?.[img];
  if (image?.bufferView === undefined || !bin) return null;
  const bv = json.bufferViews[image.bufferView];
  return { type: image.mimeType || 'image/png', data: bin.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength) };
}
