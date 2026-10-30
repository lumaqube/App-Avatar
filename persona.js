// The assistant's personas (settings: "persona"): how it talks (system prompt
// style line, chat.js and live.js) and how fast Piper speaks.
// How the assistant talks. lengthScale: Piper's speed (above 1 = slower).
export const PERSONAS = {
  ceria: { id: 'ramah, ceria, sopan, bahasa Indonesia santai (pakai "kamu")', en: 'warm, cheerful, polite, casual English', zh: '热情、开朗、有礼貌，口语化的普通话', lengthScale: 1.0 },
  formal: { id: 'sopan, profesional, bahasa Indonesia baku (pakai "Anda")', en: 'polite, professional, formal English', zh: '礼貌、专业，正式的普通话（用“您”）', lengthScale: 1.05 },
  kalem: { id: 'lembut, tenang, hangat, bicara pelan dan menenangkan (pakai "kamu")', en: 'gentle, calm, warm and unhurried', zh: '温柔、平静、亲切，说话慢一点', lengthScale: 1.12 },
  lucu: { id: 'jenaka, suka bercanda ringan dan memuji, tetap sopan (pakai "kamu")', en: 'funny and playful, light jokes and compliments, still polite', zh: '幽默俏皮，爱开小玩笑、爱夸人，但有礼貌', lengthScale: 1.0 },
  energik: { id: 'sangat bersemangat seperti MC acara, heboh tapi sopan (pakai "kamu")', en: 'very energetic like an event MC, lively but polite', zh: '像活动主持人一样充满活力，热闹但有礼貌', lengthScale: 0.93 },
};
export const personaOf = cfg => PERSONAS[cfg.persona] || PERSONAS.ceria;
