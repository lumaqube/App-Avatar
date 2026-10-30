// The 3D avatar: loads a VRM, frames it, and animates it procedurally
// (idle pose, breathing, sway, blinks, eye contact, gestures, mouth shapes).
// No animation files needed. Bone rotations are on the normalized humanoid
// (T-pose = all zero, model facing +Z, its left hand on +X).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const GESTURES = {
  wave: { duration: 2.6 },
  nod: { duration: 1.0 },
  present: { duration: 2.2 },
};

const smooth = x => x * x * (3 - 2 * x);
// 0 -> 1 -> 0 envelope over a gesture, with soft in/out ramps.
function envelope(t, d, ramp = 0.35) {
  if (t <= 0 || t >= d) return 0;
  return smooth(Math.min(1, t / ramp, (d - t) / ramp));
}

export class Avatar {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 20);

    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(0.6, 1.6, 2.0);
    const rim = new THREE.DirectionalLight(0xbcd2ff, 1.0);
    rim.position.set(-1.2, 1.8, -1.5);
    this.scene.add(key, rim, new THREE.HemisphereLight(0xffffff, 0x444466, 0.9));

    this.timer = new THREE.Timer();
    this.vrm = null;
    this.gesture = null;      // { name, t }
    this.mood = null;         // { name, t, d }
    this.mouthShapes = {};
    this.nextBlink = 2;
    this.blinkT = -1;
    this.lookTarget = new THREE.Object3D();
    this.scene.add(this.lookTarget);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  async load(url) {
    const loader = new GLTFLoader();
    loader.register(parser => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync(url);
    const vrm = gltf.userData.vrm;
    if (!vrm) throw new Error('Not a VRM file: ' + url);
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    VRMUtils.rotateVRM0(vrm); // VRM 0.x faces -Z; turn it to face the camera
    vrm.scene.traverse(o => { o.frustumCulled = false; });

    if (this.vrm) { this.scene.remove(this.vrm.scene); VRMUtils.deepDispose(this.vrm.scene); }
    this.vrm = vrm;
    this.scene.add(vrm.scene);
    if (vrm.lookAt) vrm.lookAt.target = this.lookTarget;
    this.pose(0, 0);
    vrm.update(0);
    this.frame();
    this.findTargets();
    this.glasses = null;
    return vrm;
  }

  // Parts that can be recoloured. VRoid avatars name their materials by part
  // (Body_00_SKIN, Hair_00_HAIR, Tops_01_CLOTH, ...); other avatars get one entry
  // per material instead.
  findTargets() {
    const mats = new Map();
    this.vrm.scene.traverse(o => {
      for (const m of [].concat(o.material || [])) if (m?.color && !/(Outline)/.test(m.name) && !mats.has(m.name)) mats.set(m.name, m);
    });
    const all = [...mats.values()].filter(m => m.name);
    // every copy of a material (three-vrm may clone them per mesh)
    const byName = name => { const out = []; this.vrm.scene.traverse(o => { for (const m of [].concat(o.material || [])) if (m?.name === name) out.push(m); }); return out; };
    const GROUPS = [['skin', /_SKIN/], ['hair', /_HAIR/], ['eyes', /EyeIris/], ['top', /Tops/], ['bottom', /Bottoms/], ['onepiece', /Onepiece/], ['shoes', /Shoes/], ['accessory', /Accessory/]];
    let targets = GROUPS.map(([key, re]) => ({ key, mats: all.filter(m => re.test(m.name)).flatMap(m => byName(m.name)) })).filter(t => t.mats.length);
    if (!targets.length) {
      targets = all.filter(m => !/eye.?(white|highlight)|eyeline|brow|mouth|trans|emit|logo|_nm$/i.test(m.name))
        .map(m => ({ key: 'mat:' + m.name, label: m.name, mats: byName(m.name) }));
    }
    for (const t of targets) for (const m of t.mats) {
      m.userData.orig ||= { color: m.color.clone(), shade: m.shadeColorFactor?.clone() };
    }
    this.targets = targets;
  }

  // [{ key, label?, color: '#rrggbb' (as it is now) }] for the avatar editor.
  styleTargets() {
    return (this.targets || []).map(t => ({ key: t.key, label: t.label, color: '#' + t.mats[0].color.getHexString() }));
  }

  // style: { colors: { key: '#rrggbb' }, glasses: { type: 'round'|'square'|'sun', color } }.
  // A colour multiplies the part's texture: it works best on light parts (skin,
  // white clothes); a dark texture only gets darker.
  applyStyle(style = {}) {
    for (const t of this.targets || []) {
      const hex = style.colors?.[t.key];
      for (const m of t.mats) {
        const o = m.userData.orig;
        if (hex) {
          m.color.set(hex);
          if (m.shadeColorFactor) m.shadeColorFactor.set(hex).multiplyScalar(0.75);
        } else {
          m.color.copy(o.color);
          if (m.shadeColorFactor && o.shade) m.shadeColorFactor.copy(o.shade);
        }
      }
    }
    this.setGlasses(style.glasses);
  }

  // Glasses on the head bone, at the eyes: built here, no model file needed.
  setGlasses(g) {
    if (this.glasses) { this.glasses.parent?.remove(this.glasses); this.glasses = null; }
    if (!g?.type || g.type === 'none' || !this.vrm) return;
    const h = this.vrm.humanoid;
    // the raw head bone: it is what gets drawn (the normalized rig only drives it)
    const head = h.getRawBoneNode('head');
    // the eyes: the eye bones when the model has them, else the look-at point
    const le = h.getRawBoneNode('leftEye'), re = h.getRawBoneNode('rightEye');
    const pL = new THREE.Vector3(), pR = new THREE.Vector3();
    let ipd = 0.062;
    head.updateWorldMatrix(true, false);
    let center;
    if (le && re) {
      le.getWorldPosition(pL); re.getWorldPosition(pR);
      ipd = Math.max(0.045, pL.distanceTo(pR)) * 1.3; // the drawn eyes are wider apart than the eye bones
      center = pL.add(pR).multiplyScalar(0.5);
    } else {
      center = head.getWorldPosition(new THREE.Vector3()).add(this.vrm.lookAt?.offsetFromHeadBone?.clone() || new THREE.Vector3(0, 0.06, 0.02));
    }
    const r = ipd * 0.47, tube = r * 0.08; // anime eyes are big: the lenses nearly meet
    const frame = new THREE.MeshStandardMaterial({ color: g.color || '#1c1c1c', roughness: 0.4, metalness: 0.3 });
    const grp = new THREE.Group();
    const square = g.type === 'square';
    for (const side of [-1, 1]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, square ? 4 : 32), frame);
      if (square) { ring.rotation.z = Math.PI / 4; ring.scale.set(1.15, 0.85, 1); }
      ring.position.x = side * ipd / 2;
      grp.add(ring);
      if (g.type === 'sun') {
        const lens = new THREE.Mesh(new THREE.CircleGeometry(r, 32), new THREE.MeshBasicMaterial({ color: '#111', transparent: true, opacity: 0.78 }));
        lens.position.x = side * ipd / 2;
        grp.add(lens);
      }
      // the arm to the ear
      const arm = new THREE.Mesh(new THREE.BoxGeometry(tube * 1.6, tube * 1.6, ipd * 1.5), frame);
      arm.position.set(side * (ipd / 2 + r), 0, -ipd * 0.75);
      grp.add(arm);
    }
    const bridge = new THREE.Mesh(new THREE.CylinderGeometry(tube, tube, Math.max(ipd - 2 * r, tube * 2), 8), frame);
    bridge.rotation.z = Math.PI / 2;
    bridge.position.y = r * 0.25;
    grp.add(bridge);
    // Eye bones sit inside the head: find the face's surface in front of them (a ray
    // from the front, hair ignored) and put the glasses just before it.
    let frontZ = center.z + ipd * 1.1;
    const ray = new THREE.Raycaster(new THREE.Vector3(center.x, center.y, center.z + 1), new THREE.Vector3(0, 0, -1));
    const hit = ray.intersectObject(this.vrm.scene, true)
      .find(i => i.object.visible && i.object.isMesh && !/HAIR|hair/.test([].concat(i.object.material)[0]?.name || ''));
    if (hit) frontZ = hit.point.z + ipd * 0.25;
    // Built facing +Z in world terms: undo the head bone's own orientation (VRM bones
    // can be rotated any way).
    const headQ = head.getWorldQuaternion(new THREE.Quaternion());
    grp.quaternion.copy(headQ.clone().invert());
    grp.position.copy(head.worldToLocal(new THREE.Vector3(center.x, center.y - r * 0.1, frontZ)));
    head.add(grp);
    this.glasses = grp;
  }

  // Frame from the top of the head down to about the hips. Portrait screens
  // (a vertical TV) fit by width instead, which shows a bit more body.
  frame() {
    if (!this.vrm) return;
    const head = new THREE.Vector3();
    this.vrm.humanoid.getNormalizedBoneNode('head').getWorldPosition(head);
    const top = head.y + 0.34, bottom = head.y - 0.95; // head bone sits at the skull base
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const fitH = (top - bottom) / 2 / Math.tan(fov / 2);
    const fitW = 1.3 / 2 / (Math.tan(fov / 2) * this.camera.aspect); // room for the "present" hand
    const dist = Math.max(fitH, fitW);
    const centerY = this.camera.aspect < 1 ? top - (top - bottom) * 0.55 : (top + bottom) / 2;
    this.camera.position.set(0, centerY, dist);
    this.camera.lookAt(0, centerY, 0);
    this.lookTarget.position.set(0, head.y, dist);
    this.lookY0 = head.y; // eye height (thinking looks up from here)
  }

  // Where the character is on the canvas (CSS px): head, hands, elbows, hips projected,
  // down to the canvas' bottom edge. For the overlay window's shape. null before a VRM loads.
  screenBox() {
    if (!this.vrm) return null;
    const c = this.renderer.domElement, w = c.clientWidth, h = c.clientHeight;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity;
    const p = new THREE.Vector3();
    for (const bone of ['head', 'leftHand', 'rightHand', 'leftLowerArm', 'rightLowerArm', 'leftUpperArm', 'rightUpperArm', 'hips']) {
      const node = this.vrm.humanoid.getNormalizedBoneNode(bone);
      if (!node) continue;
      node.getWorldPosition(p);
      if (bone === 'head') p.y += 0.3; // the top of the head (the bone sits at the skull base)
      p.project(this.camera);
      const sx = (p.x + 1) / 2 * w, sy = (1 - p.y) / 2 * h;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy);
    }
    const pad = w * 0.08; // hair, sleeves, fingers
    x0 = Math.max(0, x0 - pad); x1 = Math.min(w, x1 + pad); y0 = Math.max(0, y0 - pad);
    return { x: x0, y: y0, width: x1 - x0, height: h - y0 };
  }

  resize() {
    // the canvas' own box (full screen, or its part of it next to the live view)
    const c = this.renderer.domElement;
    const w = c.clientWidth || window.innerWidth, h = c.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.frame();
  }

  play(name) {
    if (GESTURES[name]) this.gesture = { name, t: 0 };
  }

  flash(name, seconds = 2.5) {
    this.mood = { name, t: 0, d: seconds };
  }

  setMouth(shapes) {
    this.mouthShapes = shapes;
  }

  // Listening: head tilted, leaning in a little. Eases in and out.
  setListening(on) {
    this.listening = on;
  }

  // Thinking (the answer is on its way): hand to the chin, head tilted the other way,
  // eyes up to the side. Eases in and out.
  setThinking(on) {
    this.thinking = on;
  }

  // Where the top of the head is on the canvas (CSS px), for the "thinking" bubble.
  headScreen() {
    if (!this.vrm) return null;
    const c = this.renderer.domElement;
    const p = this.vrm.humanoid.getNormalizedBoneNode('head').getWorldPosition(new THREE.Vector3());
    p.y += 0.22;
    p.project(this.camera);
    return { x: (p.x + 1) / 2 * c.clientWidth, y: (1 - p.y) / 2 * c.clientHeight };
  }

  // Sets every animated bone for time `time` (seconds since start).
  pose(time, dt) {
    const h = this.vrm.humanoid;
    const bone = n => h.getNormalizedBoneNode(n);
    // A VRM 0.x model is turned around (rotateVRM0): its bones' X and Z axes point the other way.
    const m = this.vrm.meta?.metaVersion === '0' ? -1 : 1;
    const set = (n, x, y, z) => { const b = bone(n); if (b) b.rotation.set(m * x, y, m * z); };

    const breath = Math.sin(time * 1.6);
    const sway = Math.sin(time * 0.45);

    // Idle base.
    let rUA = { x: 0, y: 0, z: 1.22 }, rLA = { x: 0, y: 0.25, z: 0 }, rHand = { x: 0, y: 0, z: 0.1 };
    let headX = 0.02 + Math.sin(time * 0.7) * 0.015, headY = Math.sin(time * 0.33) * 0.05, headZ = sway * 0.02;
    this.listenW = (this.listenW || 0) + ((this.listening ? 1 : 0) - (this.listenW || 0)) * Math.min(1, dt * 4);
    headZ += 0.13 * this.listenW;
    headX += 0.06 * this.listenW;
    headY *= 1 - 0.7 * this.listenW;
    const tw = this.thinkW = (this.thinkW || 0) + ((this.thinking ? 1 : 0) - (this.thinkW || 0)) * Math.min(1, dt * 5);
    headZ += -0.12 * tw;
    headX += -0.07 * tw;
    headY += 0.12 * tw;
    // her left arm (screen right): hand up to the chin
    const lUA = { x: 0, y: lerp(0, -0.85, tw), z: lerp(-1.22, -1.1, tw) };
    const lLA = { x: 0, y: lerp(-0.25, -2.6, tw), z: 0 };
    const lHand = { x: lerp(0, -0.7, tw), y: 0, z: lerp(-0.1, 0.45, tw) };

    const g = this.gesture;
    if (g) {
      g.t += dt;
      const d = GESTURES[g.name].duration;
      const e = envelope(g.t, d);
      if (g.name === 'wave') {
        rUA = { x: 0, y: lerp(0, -0.25, e), z: lerp(1.22, 0.35, e) };
        rLA = { x: 0, y: lerp(0.25, 0, e), z: lerp(0, -1.9, e) + Math.sin(g.t * 9) * 0.3 * e };
        rHand = { x: 0, y: 0, z: lerp(0.1, 0, e) };
        headZ += -0.06 * e;
      } else if (g.name === 'nod') {
        headX += Math.sin(Math.min(g.t / d, 1) * Math.PI * 2) * 0.12 * e;
      } else if (g.name === 'present') {
        // Open palm out to her right (screen left), toward the booth screen.
        rUA = { x: 0, y: lerp(0, -0.7, e), z: lerp(1.22, 0.75, e) };
        rLA = { x: 0, y: lerp(0.25, 0.9, e), z: 0 };
        rHand = { x: lerp(0, -0.9, e), y: 0, z: lerp(0.1, -0.2, e) };
        headY += -0.12 * e;
      }
      if (g.t >= d) this.gesture = null;
    }

    set('hips', 0, sway * 0.03, sway * 0.012);
    set('spine', breath * 0.012 + 0.05 * this.listenW, 0, 0);
    set('chest', breath * 0.018, -sway * 0.02, 0);
    set('neck', headX * 0.4, headY * 0.4, headZ * 0.4);
    set('head', headX * 0.6, headY * 0.6, headZ * 0.6);
    set('leftUpperArm', lUA.x, lUA.y, lUA.z - breath * 0.015);
    set('leftLowerArm', lLA.x, lLA.y, lLA.z);
    set('leftHand', lHand.x, lHand.y, lHand.z);
    set('rightUpperArm', rUA.x, rUA.y, rUA.z + breath * 0.015);
    set('rightLowerArm', rLA.x, rLA.y, rLA.z);
    set('rightHand', rHand.x, rHand.y, rHand.z);
    // Relaxed fingers.
    for (const side of ['left', 'right']) {
      const s = side === 'left' ? -1 : 1;
      for (const f of ['Index', 'Middle', 'Ring', 'Little']) {
        // (thinking: the hand at the chin curls into a loose fist)
        for (const j of ['Proximal', 'Intermediate', 'Distal']) set(side + f + j, 0, 0, s * (0.25 + (side === 'left' ? 1.0 * tw : 0)));
      }
    }
  }

  update() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    const time = this.timer.getElapsed();
    if (this.vrm) {
      this.pose(time, dt);
      const em = this.vrm.expressionManager;
      if (em) {
        // Blink.
        this.nextBlink -= dt;
        if (this.nextBlink <= 0 && this.blinkT < 0) { this.blinkT = 0; this.nextBlink = 2 + Math.random() * 4; }
        let blink = 0;
        if (this.blinkT >= 0) {
          this.blinkT += dt;
          blink = Math.sin(Math.min(this.blinkT / 0.16, 1) * Math.PI);
          if (this.blinkT >= 0.16) this.blinkT = -1;
        }
        em.setValue('blink', blink);
        // Mood: a soft smile at rest, a short "happy" flash on cue.
        let happy = 0;
        if (this.mood) {
          this.mood.t += dt;
          happy = envelope(this.mood.t, this.mood.d, 0.4) * 0.7;
          if (this.mood.t >= this.mood.d) this.mood = null;
        }
        em.setValue('relaxed', 0.35 * (1 - happy));
        em.setValue('happy', happy);
        // Mouth.
        for (const k of ['aa', 'ih', 'ou', 'ee', 'oh']) {
          const cur = em.getValue(k) || 0;
          em.setValue(k, cur + ((this.mouthShapes[k] || 0) - cur) * Math.min(1, dt * 18));
        }
      }
      // Small eye wanders around the guest's face.
      // (thinking: up and to the side)
      this.lookTarget.position.x = Math.sin(time * 0.31) * 0.12 * (1 - (this.thinkW || 0)) + 0.35 * (this.thinkW || 0);
      if (this.lookY0 != null) this.lookTarget.position.y = this.lookY0 + 0.3 * (this.thinkW || 0);
      this.vrm.update(dt);
    }
    this.renderer.render(this.scene, this.camera);
  }
}

function lerp(a, b, t) { return a + (b - a) * t; }
