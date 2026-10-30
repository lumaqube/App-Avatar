// Avatar editor: a side panel (the avatar stays in view, changes show at once):
// pick a model from the gallery, recolour its parts, add glasses. Saves the
// model and a style per model (config: avatar, avatarStyle).
const T = {
  id: {
    title: 'Avatar', gallery: 'Model', parts: 'Warna', glasses: 'Kacamata', none: 'Tanpa', round: 'Bulat', square: 'Kotak', sun: 'Kacamata hitam',
    frame: 'Warna bingkai', reset: 'Asli', hint: 'Warna dikalikan dengan tekstur: paling bagus untuk kulit dan baju terang. Wajah, model rambut dan baju: buat di VRoid Studio, lalu "Tambah VRM".',
    voice: 'Suara', female: 'Wanita', male: 'Pria', voiceHint: 'Avatar bicara dengan suara ini di semua bahasa.',
    cancel: 'Batal', save: 'Simpan', saving: 'Menyimpan…', loading: 'Memuat…', credit: 'Kredit',
    keys: { skin: 'Kulit', hair: 'Rambut', eyes: 'Mata', top: 'Atasan', bottom: 'Bawahan', onepiece: 'Terusan', shoes: 'Sepatu', accessory: 'Aksesori' },
  },
  zh: {
    title: '形象', gallery: '模型', parts: '颜色', glasses: '眼镜', none: '无', round: '圆框', square: '方框', sun: '墨镜',
    frame: '镜框颜色', reset: '原色', hint: '颜色会与贴图相乘：皮肤和浅色衣服效果最好。脸型、发型和服装：请在 VRoid Studio 中制作，然后“添加 VRM”。',
    voice: '声音', female: '女声', male: '男声', voiceHint: '形象在所有语言中都用这个声音说话。',
    cancel: '取消', save: '保存', saving: '保存中…', loading: '加载中…', credit: '作者',
    keys: { skin: '皮肤', hair: '头发', eyes: '眼睛', top: '上衣', bottom: '下装', onepiece: '连衣裙', shoes: '鞋子', accessory: '配饰' },
  },
  en: {
    title: 'Avatar', gallery: 'Model', parts: 'Colours', glasses: 'Glasses', none: 'None', round: 'Round', square: 'Square', sun: 'Sunglasses',
    frame: 'Frame colour', reset: 'Original', hint: 'A colour multiplies the texture: best on skin and light clothes. Face, hairstyle and outfit: make them in VRoid Studio, then "Add VRM".',
    voice: 'Voice', female: 'Female', male: 'Male', voiceHint: 'The avatar speaks with this voice in every language.',
    cancel: 'Cancel', save: 'Save', saving: 'Saving…', loading: 'Loading…', credit: 'Credit',
    keys: { skin: 'Skin', hair: 'Hair', eyes: 'Eyes', top: 'Top', bottom: 'Bottom', onepiece: 'Dress', shoes: 'Shoes', accessory: 'Accessory' },
  },
};
const SKIN_TONES = ['#ffe0c8', '#f1c27d', '#e0ac69', '#c68642', '#a0663f', '#8d5524', '#5c3a21'];

const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids.filter(k => k != null));
  return e;
};

export function openAvatarEditor({ avatar, cfg, lang, pin }) {
  const t = T[lang] || T.id;
  const styles = structuredClone(cfg.avatarStyle || {});
  const startFile = cfg.avatar;
  let file = cfg.avatar;
  let style = styles[file] ||= {};

  const panel = el('div', { className: 'av-panel' });
  document.body.append(panel);
  const gallery = el('div', { className: 'av-gallery' });
  const credit = el('div', { className: 'av-credit' });
  const parts = el('div', { className: 'av-parts' });
  const msg = el('div', { className: 'set-msg' });

  // the voice: female / male (the bundled models' gender is in avatars.json)
  let list = [];
  const sex = el('select', {}, el('option', { value: 'female', textContent: t.female }), el('option', { value: 'male', textContent: t.male }));
  const base = () => list.find(a => a.file === file)?.gender || 'female';
  const syncSex = () => { sex.value = style.gender || base(); };
  sex.onchange = () => { if (sex.value === base()) delete style.gender; else style.gender = sex.value; };

  // glasses
  const gType = el('select', {}, ...['none', 'round', 'square', 'sun'].map(k => el('option', { value: k, textContent: t[k] })));
  const gColor = el('input', { type: 'color' });
  const syncGlasses = () => { gType.value = style.glasses?.type || 'none'; gColor.value = style.glasses?.color || '#1c1c1c'; };
  const onGlasses = () => { style.glasses = gType.value === 'none' ? undefined : { type: gType.value, color: gColor.value }; avatar.setGlasses(style.glasses); };
  gType.onchange = onGlasses;
  gColor.oninput = onGlasses;

  function renderParts() {
    parts.replaceChildren(...avatar.styleTargets().map(p => {
      const orig = p.color;
      const input = el('input', { type: 'color', value: style.colors?.[p.key] || orig });
      const apply = hex => { (style.colors ||= {})[p.key] = hex; input.value = hex; avatar.applyStyle(style); };
      input.oninput = () => apply(input.value);
      const reset = el('button', { type: 'button', textContent: t.reset });
      reset.onclick = () => { delete style.colors?.[p.key]; avatar.applyStyle(style); input.value = avatar.styleTargets().find(x => x.key === p.key)?.color || orig; };
      const swatches = p.key === 'skin'
        ? el('div', { className: 'av-swatches' }, ...SKIN_TONES.map(c => { const b = el('button', { type: 'button', title: c }); b.style.background = c; b.onclick = () => apply(c); return b; }))
        : null;
      return el('div', { className: 'av-row' }, el('span', { textContent: t.keys[p.key] || p.label || p.key }), input, reset, swatches);
    }));
  }

  async function choose(f, info) {
    msg.textContent = t.loading;
    try {
      await avatar.load(f);
      file = f;
      style = styles[file] ||= {};
      avatar.applyStyle(style);
      renderParts();
      syncGlasses();
      syncSex();
      for (const c of gallery.children) c.classList.toggle('on', c.dataset.file === f);
      credit.textContent = info?.credit ? `${t.credit}: ${info.credit}` : (info?.authors?.length ? `© ${info.authors.join(', ')}` : '');
      msg.textContent = '';
    } catch (err) { msg.textContent = '✗ ' + err.message; }
  }

  (async () => {
    list = (await (await fetch('/avatars')).json()).avatars || [];
    gallery.replaceChildren(...list.map(a => {
      const card = el('button', { type: 'button', className: 'av-card', title: a.name || a.file },
        el('img', { src: '/avatar-thumb?f=' + encodeURIComponent(a.file.replace(/^avatars\//, '')), alt: '' }),
        el('span', { textContent: a.name || a.file.replace(/^avatars\//, '') }));
      card.dataset.file = a.file;
      card.onclick = () => choose(a.file, a);
      return card;
    }));
    const cur = list.find(a => a.file === file);
    for (const c of gallery.children) c.classList.toggle('on', c.dataset.file === file);
    credit.textContent = cur?.credit ? `${t.credit}: ${cur.credit}` : (cur?.authors?.length ? `© ${cur.authors.join(', ')}` : '');
    renderParts();
    syncGlasses();
    syncSex();
  })();

  const cancel = el('button', { type: 'button', textContent: t.cancel });
  const save = el('button', { type: 'button', className: 'set-primary', textContent: t.save });
  cancel.onclick = async () => {
    panel.remove();
    if (file !== startFile) await avatar.load(startFile);
    avatar.applyStyle(cfg.avatarStyle?.[startFile]);
  };
  save.onclick = async () => {
    save.disabled = true;
    msg.textContent = t.saving;
    for (const k of Object.keys(styles)) if (!Object.keys(styles[k]).length) delete styles[k];
    const r = await (await fetch('/settings', { method: 'POST', headers: { 'x-settings-pin': pin || '' }, body: JSON.stringify({ avatar: file, avatarStyle: styles }) })).json();
    if (!r.ok) { msg.textContent = '✗ ' + (r.error?.message || r.error?.code); save.disabled = false; return; }
    cfg.avatar = file;
    cfg.avatarStyle = styles;
    location.reload(); // the voice (and Gemini Live's) follows the avatar's gender
  };

  panel.append(
    el('h2', { textContent: '🧍 ' + t.title }),
    el('h3', { textContent: t.gallery }), gallery, credit,
    el('h3', { textContent: t.voice }), el('div', { className: 'av-row' }, sex), el('small', { className: 'av-hint', textContent: t.voiceHint }),
    el('h3', { textContent: t.parts }), parts,
    el('h3', { textContent: t.glasses }), el('div', { className: 'av-row' }, gType, el('span', { textContent: t.frame }), gColor),
    el('small', { className: 'av-hint', textContent: t.hint }),
    msg,
    el('div', { className: 'set-actions' }, cancel, save),
  );
}
