// Where things stand on the screen: the character and its two buttons (language, ☰ menu).
// The window covers the whole screen (electron/main.js) and is cut to them, so each can sit
// anywhere. Saved as screen fractions in "overlay.layout":
//   { char: { x, y, h }, lang: { x, y }, menu: { x, y } }
//   char: top-left corner + height (its width follows: 0.9 × height, at most half the screen)
//   lang / menu: the button's top-left corner
// Until it is first placed: a bottom corner ("overlay.side"), "overlay.size" % of the height,
// the two buttons at the character's top corners.
// edit(): drag each of the three, − / + for the character's size, Done saves (POST /app/layout).

const BTN = () => Math.round(Math.min(Math.max(innerHeight * 0.065, 44), 72)); // a button's size, px
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function initLayout({ cfg, stage, boot, langBtn, menuBtn, onChange, labels }) {
  const ov = cfg.overlay || {};
  let L = normalize(ov.layout) || defaults();

  function defaults() {
    const h = clamp((ov.size || 70) / 100, 0.3, 1);
    const w = charWidth(h);
    const x = ov.side === 'left' ? 0 : 1 - w;
    const b = BTN() / innerWidth, bh = BTN() / innerHeight, pad = 10 / innerWidth;
    return {
      char: { x, y: 1 - h, h },
      // the buttons at the character's top corners, inside the screen
      menu: { x: clamp(x + w - b - pad, 0, 1 - b), y: clamp(1 - h + 0.01, 0, 1 - bh) },
      lang: { x: clamp(x + w - 2 * b - 2 * pad, 0, 1 - b), y: clamp(1 - h + 0.01, 0, 1 - bh) },
    };
  }
  // the character's box width (fraction of the screen width) for a height fraction
  function charWidth(h) { return Math.min(0.5, h * innerHeight * 0.9 / innerWidth); }

  function normalize(l) {
    if (!l?.char || !(l.char.h > 0)) return null;
    const d = defaults();
    return { char: { ...l.char }, lang: { ...(l.lang || d.lang) }, menu: { ...(l.menu || d.menu) } };
  }

  // Put everything where L says (px), keeping it on screen.
  function apply() {
    const W = innerWidth, H = innerHeight, c = L.char;
    c.h = clamp(c.h, 0.2, 1);
    const w = charWidth(c.h);
    c.x = clamp(c.x, 0, 1 - w);
    c.y = clamp(c.y, 0, 1 - c.h);
    const box = { left: c.x * W, top: c.y * H, width: w * W, height: c.h * H };
    for (const el of [stage, boot]) Object.assign(el.style, { left: box.left + 'px', top: box.top + 'px', width: box.width + 'px', height: box.height + 'px', right: 'auto', bottom: 'auto' });
    const b = BTN();
    for (const [el, p] of [[langBtn, L.lang], [menuBtn, L.menu]]) {
      p.x = clamp(p.x, 0, 1 - b / W);
      p.y = clamp(p.y, 0, 1 - b / H);
      Object.assign(el.style, { left: p.x * W + 'px', top: p.y * H + 'px', width: b + 'px', height: b + 'px' });
    }
    frame.style.cssText = `left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px`;
    onChange?.();
  }
  addEventListener('resize', apply);

  // ---- editing: drag the character and each button; − / + size; Done / reset ----
  const frame = Object.assign(document.createElement('div'), { className: 'lay-frame', hidden: true });
  frame.innerHTML = `<div class="lay-size"><button type="button" data-k="0.92">−</button><button type="button" data-k="1.08">+</button></div>`;
  const bar = Object.assign(document.createElement('div'), { className: 'lay-bar', hidden: true });
  bar.innerHTML = `<span>${labels.tip}</span><button type="button" data-reset>${labels.reset}</button><button type="button" data-done class="primary">${labels.done}</button>`;
  document.body.append(frame, bar);
  let editing = false;

  frame.querySelectorAll('[data-k]').forEach(btn => {
    btn.onpointerdown = e => e.stopPropagation(); // a size tap is not a drag
    btn.onclick = () => { // bigger / smaller, standing on the same spot (bottom centre)
      const c = L.char, w0 = charWidth(c.h), bottom = c.y + c.h, mid = c.x + w0 / 2;
      c.h = clamp(c.h * +btn.dataset.k, 0.2, 1);
      c.y = bottom - c.h;
      c.x = mid - charWidth(c.h) / 2;
      apply();
    };
  });
  bar.querySelector('[data-reset]').onclick = () => { L = defaults(); apply(); };
  bar.querySelector('[data-done]').onclick = () => {
    stop();
    fetch('/app/layout', { method: 'POST', body: JSON.stringify({ layout: L }) }).catch(() => { });
  };

  // drag: pointer moves the thing by as much (fractions of the screen)
  function draggable(el, pos) {
    el.addEventListener('pointerdown', e => {
      if (!editing) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const sx = e.clientX, sy = e.clientY, p = pos(), x0 = p.x, y0 = p.y;
      const move = m => { p.x = x0 + (m.clientX - sx) / innerWidth; p.y = y0 + (m.clientY - sy) / innerHeight; apply(); };
      const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
  }
  draggable(frame, () => L.char);
  draggable(langBtn, () => L.lang);
  draggable(menuBtn, () => L.menu);

  function start() {
    editing = true;
    frame.hidden = bar.hidden = false;
    document.body.classList.add('lay-editing');
    langBtn.hidden = menuBtn.hidden = false; // placed even when switched off (they may be switched on later)
    apply();
  }
  function stop() {
    editing = false;
    frame.hidden = bar.hidden = true;
    document.body.classList.remove('lay-editing');
    langBtn.hidden = ov.langButton === false;
    menuBtn.hidden = ov.menuButton === false;
    apply();
  }
  langBtn.hidden = ov.langButton === false;
  menuBtn.hidden = ov.menuButton === false;
  apply();

  return { edit: start, isEditing: () => editing, apply };
}
