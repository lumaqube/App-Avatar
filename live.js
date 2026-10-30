// Gemini Live: speech in, speech out, in one stream (llm.provider "gemini-live").
// The page connects to /live on our server (WebSocket); we hold the Gemini session
// with the key, so the key never reaches the page.
//   page -> us:  binary = mic audio, 16 kHz 16-bit mono PCM (only while someone talks:
//                the page's own voice detection gates it, which keeps the cost down)
//                text JSON = { type: 'event', text } (a booth event to speak about)
//                            { type: 'reset' } (a new guest: fresh conversation)
//   us -> page:  binary = the avatar's voice, 24 kHz 16-bit mono PCM
//                text JSON = { type: 'ready' | 'heard' | 'said' | 'turn' | 'interrupted' | 'action' | 'error' | 'closed', ... }
// Booth actions are tool calls, run here against the QBooth Local API, the same
// commands as the local chat (chat.js TOOLS).
import { WebSocketServer } from 'ws';
import { avatarGender } from './tts.js';
import { TOOLS, statusNote, systemPrompt, boothTool, toolReply, inScreenOrder } from './chat.js';

const ENDPOINT = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

// Prebuilt voices offered in the settings (Gemini has more; any name works in config).
export const LIVE_VOICES = [
  ['Kore', 'female', 'firm'], ['Aoede', 'female', 'breezy'], ['Leda', 'female', 'youthful'], ['Zephyr', 'female', 'bright'],
  ['Sulafat', 'female', 'warm'], ['Puck', 'male', 'upbeat'], ['Charon', 'male', 'informative'], ['Fenrir', 'male', 'excitable'],
  ['Orus', 'male', 'firm'], ['Achird', 'male', 'friendly'],
];

function liveTools(lang) {
  return [{
    functionDeclarations: Object.entries(TOOLS).map(([name, t]) => ({
      name, description: t[lang],
      ...(t.params ? { parameters: { type: 'OBJECT', properties: { name: { type: 'STRING', description: t.params.name.description } }, required: ['name'] } } : {}),
    })),
  }];
}

function livePrompt(cfg, lang, status) {
  const extra = lang === 'zh'
    ? `\n你能直接听到客人的声音。拍照亭的事件会以 [方括号] 文字发来（比如新画面、倒计时）：用一句简短的话回应，意思和里面建议的句子一样。只说普通话。`
    : lang === 'en'
    ? `\nYou hear the guests directly. Booth events arrive as text in [brackets] (e.g. a new screen, a countdown): react with ONE short spoken sentence, in the spirit of the line suggested there. Speak English only.`
    : `\nKamu mendengar suara pengunjung langsung. Kejadian di photobooth datang sebagai teks dalam [kurung siku] (misalnya layar baru, hitung mundur): tanggapi dengan SATU kalimat pendek yang diucapkan, sesuai maksud kalimat yang disarankan di situ. Bicara hanya dalam bahasa Indonesia.`;
  return systemPrompt(cfg, lang, status)
    .replace(/\n.*(pengenalan suara|speech recognition).*$/m, '') // it hears the audio itself
    + extra;
}

// Returns the upgrade handler for /live (server.js routes WebSocket upgrades by path).
export function liveUpgrade({ cfg, qb }) {
  const wss = new WebSocketServer({ noServer: true });

  async function session(page) {
    const lang = ['id', 'en', 'zh'].includes(cfg.language) ? cfg.language : 'en';
    const say = o => page.readyState === 1 && page.send(JSON.stringify(o));
    const live = cfg.llm?.live || {};
    const key = cfg.llm?.gemini?.apiKey;
    if (!key) { say({ type: 'error', message: 'no Gemini API key' }); return page.close(); }

    let status = (await qb('GET', 'status')).data || null;
    let templates = [], tplEvent = null;
    // the running event's templates (again for another event, and on QBooth's Template
    // Picker, where they come with their place on screen)
    const loadTemplates = async () => {
      const key = status?.event ? status.event.id + (status.page === 'templatePicker' ? ':picker' : '') : null;
      if (key === tplEvent) return;
      tplEvent = key;
      templates = key ? inScreenOrder((await qb('GET', 'templates')).data || []) : [];
    };
    await loadTemplates();
    const note = () => statusNote(lang, status, templates);
    let gem = null, ready = false;
    // the voice matches the avatar's gender: a chosen voice of the other gender gives way
    const gender = avatarGender(cfg);
    let voiceName = live.voice || 'Kore';
    const known = LIVE_VOICES.find(v => v[0] === voiceName);
    if (known && known[1] !== gender) voiceName = gender === 'male' ? 'Puck' : 'Kore';

    const open = () => {
      ready = false;
      gem = new WebSocket(`${ENDPOINT}?key=${encodeURIComponent(key)}`);
      gem.binaryType = 'arraybuffer';
      gem.onopen = () => gem.send(JSON.stringify({
        setup: {
          model: 'models/' + (live.model || 'gemini-3.8-live'),
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
          },
          systemInstruction: { parts: [{ text: livePrompt(cfg, lang, status) }] },
          tools: liveTools(lang),
          realtimeInputConfig: { automaticActivityDetection: { prefixPaddingMs: 200, silenceDurationMs: 700 } },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      }));
      gem.onmessage = async e => {
        let m;
        try { m = JSON.parse(typeof e.data === 'string' ? e.data : Buffer.from(e.data).toString()); } catch { return; }
        if (m.setupComplete) {
          ready = true;
          say({ type: 'ready', voice: voiceName });
          // What the booth shows right now, so the first answer fits.
          gem.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text: note() + ({ en: ' (status only, no need to answer)', zh: '（只是状态，不用回答）' }[lang] || ' (hanya status, tidak perlu dijawab)') }] }], turnComplete: false } }));
          return;
        }
        const sc = m.serverContent;
        if (sc) {
          for (const part of sc.modelTurn?.parts || []) {
            if (part.inlineData?.data && page.readyState === 1) page.send(Buffer.from(part.inlineData.data, 'base64'));
          }
          if (sc.inputTranscription?.text) say({ type: 'heard', text: sc.inputTranscription.text });
          if (sc.outputTranscription?.text) say({ type: 'said', text: sc.outputTranscription.text });
          if (sc.interrupted) say({ type: 'interrupted' });
          if (sc.turnComplete) say({ type: 'turn' });
        }
        if (m.toolCall) {
          const functionResponses = [];
          for (const call of m.toolCall.functionCalls || []) {
            const result = await runTool(call.name, call.args || {});
            say({ type: 'action', tool: call.name, ok: !!result.ok, code: result.error });
            functionResponses.push({ id: call.id, name: call.name, response: { result } });
          }
          if (gem.readyState === 1) gem.send(JSON.stringify({ toolResponse: { functionResponses } }));
        }
        if (m.goAway) say({ type: 'closing', timeLeft: m.goAway.timeLeft });
      };
      gem.onerror = () => { };
      gem.onclose = e => {
        ready = false;
        console.log(`Gemini Live closed: ${e.code} ${(e.reason || '').slice(0, 160)}`);
        say({ type: 'closed', code: e.code, reason: String(e.reason || '').slice(0, 300) });
        page.close();
      };
    };

    async function runTool(name, args) {
      status = (await qb('GET', 'status')).data || status; // the guest may have tapped since
      await loadTemplates();
      const r = await boothTool({ qb, status, templates }, name, args);
      if (!r.ok) return toolReply(name, r, lang);
      await new Promise(res => setTimeout(res, 600)); // let the booth react
      status = (await qb('GET', 'status')).data || status;
      return { ...toolReply(name, r, lang), booth: note() };
    }

    page.on('message', async (data, isBinary) => {
      if (isBinary) {
        if (ready) gem.send(JSON.stringify({ realtimeInput: { audio: { data: Buffer.from(data).toString('base64'), mimeType: 'audio/pcm;rate=16000' } } }));
        return;
      }
      let m;
      try { m = JSON.parse(String(data)); } catch { return; }
      if (m.type === 'event' && ready) {
        // Booth events: refresh what we know, then let the model say a line.
        status = (await qb('GET', 'status')).data || status;
        await loadTemplates();
        gem.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text: `${note()}\n[${m.text}]` }] }], turnComplete: true } }));
      } else if (m.type === 'speechEnd' && ready) {
        gem.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      } else if (m.type === 'reset') {
        gem?.close(1000, 'new guest');
      }
    });
    page.on('close', () => { if (gem && gem.readyState <= 1) gem.close(1000, 'page closed'); });
    open();
  }
  return (req, socket, head) => wss.handleUpgrade(req, socket, head, ws => session(ws));
}
