// The page side of Gemini Live: a WebSocket to our server's /live (which holds
// the Gemini session). Sends mic audio while someone talks, plays the voice that
// comes back, and passes booth events on. See live.js on the server for the protocol.
const PREROLL_FRAMES = 8;   // ~0.5 s of audio before speech is detected: word starts
const TAIL_MS = 1200;       // keep sending this long after the voice stops

export class LiveLink {
  constructor({ speech, mic, handlers }) {
    this.speech = speech;
    this.mic = mic;
    this.h = handlers; // onReady, onHeard, onSaid, onTurn, onAction, onClosed, canSend()
    this.ws = null;
    this.ready = false;
    this.sending = false;
    this.preroll = [];
    this.lastVoice = 0;
  }

  connect() {
    this.ws = new WebSocket(`ws://${location.host}/live`);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onmessage = e => {
      if (typeof e.data !== 'string') { this.speech.playPcm(e.data, 24000); return; }
      const m = JSON.parse(e.data);
      if (m.type === 'ready') { this.ready = true; this.h.onReady?.(m); }
      else if (m.type === 'heard') this.h.onHeard?.(m.text);
      else if (m.type === 'said') this.h.onSaid?.(m.text);
      else if (m.type === 'interrupted') this.speech.stopStream();
      else if (m.type === 'turn') this.h.onTurn?.();
      else if (m.type === 'action') this.h.onAction?.(m);
      else if (m.type === 'ui') this.h.onUi?.(m);
      else if (m.type === 'error' || m.type === 'closed') this.h.onLog?.(`Live: ${m.type} ${m.message || m.code || ''} ${m.reason || ''}`);
    };
    this.ws.onclose = () => {
      const was = this.ready;
      this.ready = false;
      this.sending = false;
      this.h.onClosed?.(was);
    };
  }

  // Mic frames: only speech goes up (with a little before and after), which keeps
  // the cost down and stops Gemini answering the room's noise.
  async startMic() {
    await this.mic.startStream((pcm, voiced) => {
      const now = performance.now();
      if (voiced) this.lastVoice = now;
      const allowed = this.ready && this.h.canSend();
      if (!this.sending) {
        this.preroll.push(pcm);
        if (this.preroll.length > PREROLL_FRAMES) this.preroll.shift();
        if (voiced && allowed) {
          this.sending = true;
          for (const f of this.preroll) this.ws.send(f.buffer);
          this.preroll = [];
          this.h.onSpeechStart?.();
        }
        return;
      }
      if (!allowed) { this.endSpeech(); return; }
      this.ws.send(pcm.buffer);
      if (now - this.lastVoice > TAIL_MS) this.endSpeech();
    });
  }

  endSpeech() {
    if (!this.sending) return;
    this.sending = false;
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ type: 'speechEnd' }));
    this.h.onSpeechEnd?.();
  }

  event(text) { if (this.ready) this.ws.send(JSON.stringify({ type: 'event', text })); }
  reset() { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ type: 'reset' })); }
}
