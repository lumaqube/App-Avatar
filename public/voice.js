// The avatar's voice. For each line, in order:
//   1. /speak on our server: a pre-rendered clip or a live local TTS take (WAV).
//      Lip sync comes from the audio itself (loudness + rough vowel colour).
//   2. the browser's speechSynthesis (Windows voices); mouth from the word's vowels.
//   3. silent: subtitle + mouth moving, so the avatar still "talks".
const VOWEL_TO_SHAPE = { a: 'aa', i: 'ih', u: 'ou', e: 'ee', o: 'oh' };
const SYLLABLE_MS = 140;
const NONE = () => ({ aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 });

export class Voice {
  constructor({ lang, browserVoice, browserFallback = true, gender = 'female' }) {
    this.gender = gender;
    this.lang = lang;
    this.browserFallback = browserFallback;
    this.preferred = browserVoice;
    this.browser = null;
    this.speaking = false;
    this.onText = () => {};
    this.onSource = () => {};
    this.queue = [];
    this.token = 0;
    this.ctx = null;
    this.analyser = null;
    this.source = null;
    this.textMouth = null; // { vowels, start } for browser / silent mode
    this.pickBrowserVoice();
    if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => this.pickBrowserVoice();
  }

  pickBrowserVoice() {
    const voices = 'speechSynthesis' in window ? speechSynthesis.getVoices() : [];
    const tag = ['en', 'zh'].includes(this.lang) ? this.lang : 'id';
    const p = (this.preferred || '').toLowerCase();
    this.browser =
      (p && voices.find(v => v.name.toLowerCase().includes(p))) ||
      voices.find(v => v.lang.toLowerCase().startsWith(tag) && (this.gender === 'male' ? /male|andika|ardi|david|mark|guy|kangkang|yunxi/i : /female|gadis|zira|aria|jenny|ava|emma|huihui|xiaoxiao|yaoyao/i).test(v.name)) ||
      voices.find(v => v.lang.toLowerCase().startsWith(tag)) || null;
  }

  // Must run once after a user gesture (or with the autoplay flag).
  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512; // short window: the mouth follows syllables
      this.analyser.smoothingTimeConstant = 0.3;
      this.analyser.connect(this.ctx.destination);
      this.freq = new Uint8Array(this.analyser.frequencyBinCount);
      this.wave = new Uint8Array(this.analyser.fftSize);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  say(text, interrupt) {
    if (!text) return;
    if (interrupt) { this.queue = []; this.stop(); }
    // Asked for at once: the server makes the next sentence while this one plays.
    this.queue.push({ text, audio: this.fetchAudio(text) });
    if (!this.speaking) this.next();
  }

  fetchAudio(text) {
    return fetch(`/speak?lang=${this.lang}&text=${encodeURIComponent(text)}`)
      .then(async r => r.ok ? { data: await r.arrayBuffer(), source: r.headers.get('X-Voice-Source') || 'server' } : null)
      .catch(() => null);
  }

  // Streamed speech (Gemini Live): 16-bit mono PCM chunks played back to back,
  // through the same analyser, so the mouth follows them like any other audio.
  playPcm(buffer, rate = 24000) {
    this.unlock();
    const pcm = new Int16Array(buffer);
    if (!pcm.length) return;
    const buf = this.ctx.createBuffer(1, pcm.length, rate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.analyser);
    const at = Math.max(this.ctx.currentTime + 0.04, this.streamEnd || 0);
    src.start(at);
    this.streamEnd = at + buf.duration;
    (this.streamSources ||= new Set()).add(src);
    this.source = src;
    this.speaking = true;
    src.onended = () => {
      this.streamSources.delete(src);
      if (this.streamSources.size) return;
      this.source = null;
      this.speaking = false;
      this.onStreamEnd?.();
    };
  }

  // Cut the streamed speech short (the guest interrupted).
  stopStream() {
    for (const s of this.streamSources || []) { s.onended = null; try { s.stop(); } catch { } }
    this.streamSources?.clear();
    this.streamEnd = 0;
    this.source = null;
    this.speaking = false;
    this.onStreamEnd?.();
  }

  stop() {
    this.token++;
    if (this.streamSources?.size) this.stopStream();
    try { this.source?.stop(); } catch { }
    this.source = null;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    clearTimeout(this.watchdog);
    this.textMouth = null;
    this.speaking = false;
  }

  async next() {
    const item = this.queue.shift();
    if (!item) { this.speaking = false; this.onText(''); return; }
    const text = item.text;
    const token = ++this.token;
    this.speaking = true;
    const done = () => {
      if (token !== this.token) return;
      clearTimeout(this.watchdog);
      this.source = null;
      this.textMouth = null;
      this.speaking = false;
      setTimeout(() => { if (!this.speaking) this.next(); }, 120); // a breath between sentences
    };

    if (await this.playServer(item, token, done)) return;
    if (token !== this.token) return;
    this.onText(text); // the subtitle shows when the voice starts
    if (this.browserFallback && this.browser) { this.playBrowser(text, done); this.onSource('browser: ' + this.browser.name); return; }
    // Silent: mouth over the whole line, ends on a timer.
    this.onSource('silent');
    this.textMouth = { vowels: text.toLowerCase().match(/[aiueo]/g) || ['a'], start: performance.now() };
    this.watchdog = setTimeout(done, 800 + text.length * 65);
  }

  async playServer({ text, audio }, token, done) {
    if (!this.ctx) return false;
    try {
      const a = await audio;
      if (!a) return false;
      const buf = await this.ctx.decodeAudioData(a.data);
      if (token !== this.token) return true; // interrupted while loading
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.analyser);
      src.onended = done;
      this.onText(text);
      src.start();
      this.source = src;
      this.onSource(a.source);
      return true;
    } catch (err) {
      console.warn('voice: server audio failed', err);
      return false;
    }
  }

  playBrowser(text, done) {
    this.textMouth = { vowels: ['a'], start: performance.now() };
    const setWord = at => {
      const word = text.slice(at).match(/^[^\s]*/)[0].toLowerCase();
      this.textMouth = { vowels: word.match(/[aiueo]/g) || ['a'], start: performance.now() };
    };
    setWord(0);
    this.watchdog = setTimeout(done, 3000 + text.length * 65); // onend sometimes never fires
    const u = new SpeechSynthesisUtterance(text);
    u.voice = this.browser;
    u.lang = this.browser.lang;
    u.pitch = 1.1;
    u.onboundary = e => setWord(e.charIndex);
    u.onend = done;
    u.onerror = done;
    speechSynthesis.speak(u);
  }

  // Mouth shape weights for this frame: { aa, ih, ou, ee, oh }.
  mouth(now) {
    const w = NONE();
    if (!this.speaking) return w;
    if (this.source) return this.audioMouth();
    if (!this.textMouth) return w;
    const t = (now - this.textMouth.start) / SYLLABLE_MS;
    const i = Math.floor(t);
    const v = this.textMouth.vowels;
    w[VOWEL_TO_SHAPE[v[i % v.length]]] = 0.25 + 0.6 * Math.sin((t - i) * Math.PI);
    return w;
  }

  // Loudness opens the mouth; where the energy sits picks the shape:
  // mostly low (< 700 Hz) -> round "ou/oh", strong 1.5-3.5 kHz -> spread "ih/ee", else open "aa".
  audioMouth() {
    const w = NONE();
    this.analyser.getByteTimeDomainData(this.wave);
    let sum = 0;
    for (const s of this.wave) { const x = (s - 128) / 128; sum += x * x; }
    const rms = Math.sqrt(sum / this.wave.length);
    // Auto gain: loudness relative to the recent peak, so quiet and loud voices both move the mouth.
    this.peak = Math.max((this.peak || 0.05) * 0.995, rms, 0.03);
    // The curve keeps syllables visible instead of holding the mouth wide open (tuned on real clips).
    const open = Math.pow(Math.min(1, Math.max(0, (rms / this.peak - 0.2) / 0.8)), 1.5);
    if (open <= 0) return w;

    this.analyser.getByteFrequencyData(this.freq);
    const hz = this.ctx.sampleRate / this.analyser.fftSize;
    const band = (a, b) => { let s = 0; for (let i = Math.floor(a / hz); i < Math.ceil(b / hz); i++) s += this.freq[i]; return s; };
    const low = band(150, 700), mid = band(700, 1500), high = band(1500, 3500);
    const total = low + mid + high || 1;
    const hi = high / total, lo = low / total;
    w.ih = open * Math.max(0, (hi - 0.3) * 2) * 0.8;
    w.ee = w.ih * 0.5;
    w.ou = open * Math.max(0, (lo - 0.55) * 2.5) * 0.7;
    w.oh = w.ou * 0.6;
    w.aa = open * Math.max(0.25, 1 - w.ih - w.ou) * 0.9;
    return w;
  }
}
