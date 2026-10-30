// Tap-to-talk recorder. Records after a tap, stops by itself after a pause in
// speech (or a time limit) and returns a 16 kHz mono WAV for whisper.
// Gives up (returns null) when nobody speaks.
const RATE = 16000;
const SILENCE_MS = 1100;   // pause that ends the question (0.8 s cut people off between words)
const NO_SPEECH_MS = 5000; // nobody spoke
const MAX_MS = 12000;

export class Mic {
  // device: part of a microphone's name to use (empty = the system default).
  // sensitivity: 1 (needs a loud voice) .. 10 (hears a soft voice), 5 = the default.
  constructor({ device = '', sensitivity = 5 } = {}) {
    this.device = device;
    this.thresholds = thresholds(sensitivity);
    this.stream = null;
    this.recording = false;
    this.level = 0;      // 0..1, for the level meter
    this.voiced = false; // counted as speech right now (vs. room noise)
  }

  // Safe to call more than once (and at the same time): asks for the mic once.
  open() {
    this.opening ||= (async () => {
      const audio = { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true };
      if (this.device) {
        const want = this.device.toLowerCase();
        const dev = (await navigator.mediaDevices.enumerateDevices())
          .find(d => d.kind === 'audioinput' && d.label.toLowerCase().includes(want));
        if (dev) audio.deviceId = { exact: dev.deviceId };
      }
      this.stream = await navigator.mediaDevices.getUserMedia({ audio });
      // A 16 kHz context: the browser resamples the mic with a proper filter
      // (whisper's rate), which hears better than our own downsampling did.
      try { this.ctx = new AudioContext({ sampleRate: RATE }); } catch { this.ctx = new AudioContext(); }
      this.src = this.ctx.createMediaStreamSource(this.stream);
    })().catch(err => { this.opening = null; throw err; });
    return this.opening;
  }

  // Microphones the page can use (names show after the mic was allowed once).
  static async list() {
    return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput').map(d => d.label).filter(Boolean);
  }

  // Resolves with a WAV Blob, or null when no speech was heard. stop() ends early
  // (keeps what was said), cancel() throws the take away.
  //   noSpeechMs   give up when nobody starts talking within this time
  //   minSpeechMs  less speech than this (a cough, a door) counts as nothing
  async record({ noSpeechMs = NO_SPEECH_MS, minSpeechMs = 0 } = {}) {
    await this.open();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const node = this.ctx.createScriptProcessor(1024, 1, 1);
    const frameMs = 1024 / this.ctx.sampleRate * 1000;
    const learnFrames = Math.ceil(300 / frameMs); // ~300 ms of room noise
    const chunks = [];
    const t0 = performance.now();
    let noise = 1, frames = 0, spokeAt = 0, spokeFrame = 0, lastVoice = 0, voicedMs = 0;
    this.recording = true;

    return new Promise(resolve => {
      const finish = keep => {
        if (!this.recording) return;
        this.recording = false;
        this.level = 0;
        this.voiced = false;
        node.disconnect();
        this.src.disconnect(node);
        if (!keep || !spokeAt || voicedMs < minSpeechMs) return resolve(null);
        // From ~400 ms before the speech began: a long wait before it is just silence for whisper.
        resolve(toWav(chunks.slice(Math.max(0, spokeFrame - Math.ceil(400 / frameMs))), this.ctx.sampleRate));
      };
      this.stop = () => finish(true);
      this.cancel = () => finish(false);
      node.onaudioprocess = e => {
        const x = e.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(x));
        let sum = 0;
        for (const v of x) sum += v * v;
        const rms = Math.sqrt(sum / x.length);
        const now = performance.now();
        this.level = Math.min(1, Math.sqrt(rms / 0.15)); // meter: ~0.15 RMS (loud speech) = full
        // Room noise = the quietest moment of the first ~300 ms (a guest who starts
        // talking at once must not be taken for the noise floor).
        if (frames++ < learnFrames) { noise = Math.min(noise, rms); return; }
        noise = Math.max(noise, 0.002);
        // Speech starts when clearly above the room; once talking, anything a bit
        // above the room still counts, so the quiet end of a word or a breath is not
        // taken for the end of the question (that cut sentences off mid-word).
        const th = this.thresholds;
        const voiced = rms > (spokeAt ? Math.max(noise * th.holdX, th.holdMin) : Math.max(noise * th.startX, th.startMin));
        this.voiced = voiced;
        if (voiced) {
          lastVoice = now;
          voicedMs += frameMs;
          if (!spokeAt) { spokeAt = now; spokeFrame = chunks.length - 1; }
        } else if (!spokeAt) noise = noise * 0.98 + rms * 0.02;
        if (spokeAt && now - lastVoice > SILENCE_MS) finish(true);
        else if (!spokeAt && now - t0 > noSpeechMs) finish(false);
        else if (spokeAt && now - spokeAt > MAX_MS) finish(true);
      };
      this.src.connect(node);
      node.connect(this.ctx.destination); // ScriptProcessor only runs when connected (outputs silence)
    });
  }

  stop() { }
  cancel() { }

  // Continuous stream (Gemini Live): onFrame(int16 PCM at 16 kHz, voiced) every
  // ~64 ms, with the same speech detection and sensitivity as a take.
  async startStream(onFrame) {
    await this.open();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.stopStream();
    const node = this.ctx.createScriptProcessor(1024, 1, 1);
    const ratio = this.ctx.sampleRate / RATE;
    let noise = 1, frames = 0, talking = false;
    const learnFrames = Math.ceil(300 / (1024 / this.ctx.sampleRate * 1000));
    node.onaudioprocess = e => {
      const x = e.inputBuffer.getChannelData(0);
      let sum = 0;
      for (const v of x) sum += v * v;
      const rms = Math.sqrt(sum / x.length);
      this.level = Math.min(1, Math.sqrt(rms / 0.15));
      if (frames++ < learnFrames) noise = Math.min(noise, rms);
      noise = Math.max(noise, 0.002);
      const th = this.thresholds;
      const voiced = rms > (talking ? Math.max(noise * th.holdX, th.holdMin) : Math.max(noise * th.startX, th.startMin));
      if (!voiced && !talking) noise = noise * 0.995 + rms * 0.005; // follow the room slowly
      talking = voiced;
      this.voiced = voiced;
      // to 16 kHz (the context already is, normally)
      const n = Math.floor(x.length / ratio), out = new Int16Array(n);
      for (let i = 0; i < n; i++) out[i] = Math.max(-1, Math.min(1, x[Math.floor(i * ratio)])) * 32767;
      onFrame(out, voiced);
    };
    this.src.connect(node);
    node.connect(this.ctx.destination);
    this.streamNode = node;
  }

  stopStream() {
    if (!this.streamNode) return;
    this.streamNode.disconnect();
    try { this.src.disconnect(this.streamNode); } catch { }
    this.streamNode = null;
    this.level = 0;
    this.voiced = false;
  }
}

// Float32 chunks at `rate` -> 16-bit PCM WAV at 16 kHz.
function toWav(chunks, rate) {
  const len = chunks.reduce((n, c) => n + c.length, 0);
  const all = new Float32Array(len);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  const ratio = rate / RATE;
  const n = Math.floor(len / ratio);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (p, s) => [...s].forEach((ch, i) => v.setUint8(p + i, ch.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    // average the source samples that fall into this output sample (simple low-pass)
    const a = Math.floor(i * ratio), b = Math.min(len, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let j = a; j < b; j++) s += all[j];
    s = Math.max(-1, Math.min(1, s / Math.max(1, b - a)));
    v.setInt16(44 + i * 2, s * 32767, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// Speech thresholds for a sensitivity of 1..10. At 5 (the default): speech starts
// at 3x the room's noise (and at least 0.006 RMS), and holds above 1.8x (0.004).
// Each step up lowers them (a softer voice counts), each step down raises them.
export function thresholds(sensitivity = 5) {
  const s = Math.min(10, Math.max(1, Number(sensitivity) || 5));
  const f = 2 ** ((5 - s) / 2); // 10 -> 0.18, 5 -> 1, 1 -> 4
  return { startX: 1.5 + 1.5 * f, startMin: 0.006 * f, holdX: 1.2 + 0.6 * f, holdMin: 0.004 * f };
}
