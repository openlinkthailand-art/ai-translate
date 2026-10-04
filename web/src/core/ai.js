/**
 * ชั้นเชื่อมต่อ AI (OpenAI-compatible / Gemini / Anthropic / Ollama)
 * ใช้สำหรับ "แปลตามบริบท + อธิบาย + ตัวอย่างเหตุการณ์ + คำพ้องง่าย ๆ + ตัวช่วยจำ"
 */
import { fetchJson, fetchWithTimeout, parseJsonLoose, truncate, uniqueBy } from '../common/util.js';

export const AI_PROVIDERS = {
  openai: { label: 'OpenAI / OpenAI-compatible', defaultBase: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', needsKey: true },
  gemini: { label: 'Google Gemini', defaultBase: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-2.0-flash', needsKey: true },
  anthropic: { label: 'Anthropic Claude', defaultBase: 'https://api.anthropic.com/v1', defaultModel: 'claude-3-5-haiku-latest', needsKey: true },
  ollama: { label: 'Ollama / LM Studio (ในเครื่อง)', defaultBase: 'http://localhost:11434/v1', defaultModel: 'llama3.1', needsKey: false },
};

const SCHEMA_HINT = `{
  "translation": "คำแปลไทยที่ตรงบริบทที่สุด (สั้น กระชับ)",
  "literal": "ความหมายตรงตัวถ้าต่างจาก translation หรือ null",
  "reading": "คำอ่าน IPA หรือคำอ่านแบบไทย หรือ null",
  "partOfSpeech": "ชนิดของคำ เช่น n. / v. / adj. / phrase / idiom หรือ null",
  "register": "ระดับภาษา เช่น ทางการ / กลาง / กันเอง / สแลง / สำนวน หรือ null",
  "contextMeaning": "อธิบาย 1-2 ประโยคเป็นภาษาไทยว่าคำนี้ในบริบทที่ให้มาหมายถึงอะไร",
  "alternatives": [{ "translation": "คำแปลไทยทางเลือก", "when": "ใช้เมื่อไร/ต่างจากตัวหลักอย่างไร" }],
  "definitions": [{ "pos": "adj.", "meaning": "ความหมายภาษาอังกฤษสั้น ๆ", "th": "ความหมายภาษาไทย" }],
  "synonyms": [{ "word": "คำอังกฤษที่ใช้แทนกันได้", "th": "คำแปลไทยของคำนั้น", "level": "easy|normal|advanced", "note": "ใช้ต่างกันอย่างไร (สั้น ๆ)" }],
  "examples": [{ "en": "ตัวอย่างประโยคอังกฤษ", "th": "คำแปลไทย" }],
  "collocations": ["วลีที่ใช้คู่กันบ่อย เช่น highly resilient"],
  "memoryHook": "ตัวช่วยจำสั้น ๆ เป็นภาษาไทย เช่น ภาพในหัวหรือเสียงคล้องจอง",
  "notes": "ข้อควรระวังหรือความหมายอื่นที่อาจสับสน หรือ null"
}`;

function buildSystemPrompt({ targetLang, sourceLang }) {
  return [
    'You are an expert bilingual lexicographer and language coach for a THAI learner who reads English books and PDFs.',
    `Explain the requested word/phrase IN ITS GIVEN CONTEXT. Source language: ${sourceLang || 'auto'}. Target language: Thai (${targetLang}).`,
    'Hard rules:',
    '1. Reply with ONE valid JSON object only. No markdown, no code fences, no extra text.',
    '2. All Thai must be natural everyday Thai that a Thai speaker actually uses — never literal machine-style Thai.',
    '3. "synonyms": give COMMON, EVERYDAY English words a learner already knows (prefer the ~2000 most frequent English words). Rank easiest/most common FIRST. Avoid literary or rare words; if only hard words exist, say so in "note".',
    '4. "examples": 2-4 short concrete situations from real life (work, school, shopping, feelings, travel) that make the meaning obvious. Each example max ~14 words, each with a Thai translation.',
    '5. "memoryHook": a vivid Thai mnemonic, sound-alike, or mental image that makes the word stick.',
    '6. If the query is a phrase/sentence, translate the whole thing and also list the 2-3 key words inside it as separate definitions.',
    '7. Never invent facts. If unsure about a nuance, put it in "notes".',
    '8. Keep the whole JSON compact (under ~700 tokens).',
  ].join('\n');
}

function buildUserPrompt({ query, context, baseTranslation, mode }) {
  const lines = [`คำ/ข้อความที่ต้องการ: """${query}"""`];
  if (context && context.trim() && context.trim() !== query.trim()) {
    lines.push(`บริบทที่กำลังอ่านอยู่: """${truncate(context, 900)}"""`);
  }
  if (baseTranslation) lines.push(`คำแปลจากเครื่องแปลทั่วไป (ใช้เป็นข้อมูลตั้งต้น ปรับปรุงให้ดีขึ้นได้): """${baseTranslation}"""`);
  lines.push(
    mode === 'translate-only'
      ? 'ตอบ JSON โดยเน้น field "translation" เป็นหลัก'
      : `ตอบ JSON ตามโครงสร้างนี้เท่านั้น:\n${SCHEMA_HINT}`
  );
  return lines.join('\n\n');
}

/** เรียก AI แล้วคืนผลลัพธ์ที่ normalize แล้ว */
export async function aiAnalyze({
  settings,
  query,
  context = '',
  sourceLang = 'auto',
  targetLang = 'th',
  baseTranslation = '',
  mode = 'full',
  signal = null,
}) {
  const cfg = settings?.ai || {};
  const provider = cfg.provider || 'openai';
  const meta = AI_PROVIDERS[provider] || AI_PROVIDERS.openai;
  const model = cfg.model || meta.defaultModel;
  const baseUrl = (cfg.baseUrl || meta.defaultBase).replace(/\/+$/, '');
  const timeoutMs = cfg.timeoutMs || 30000;
  const temperature = typeof cfg.temperature === 'number' ? cfg.temperature : 0.2;
  const maxTokens = cfg.maxTokens || 1500;

  const messages = [
    { role: 'system', content: buildSystemPrompt({ targetLang, sourceLang }) },
    { role: 'user', content: buildUserPrompt({ query, context, baseTranslation, mode }) },
  ];

  let text = '';
  if (provider === 'gemini') {
    text = await callGemini({ baseUrl, model, apiKey: cfg.apiKey, messages, temperature, maxTokens, timeoutMs, signal });
  } else if (provider === 'anthropic') {
    text = await callAnthropic({ baseUrl, model, apiKey: cfg.apiKey, messages, temperature, maxTokens, timeoutMs, signal });
  } else {
    text = await callOpenAiCompatible({
      baseUrl,
      model,
      apiKey: cfg.apiKey,
      messages,
      temperature,
      maxTokens,
      timeoutMs,
      signal,
      jsonMode: provider !== 'ollama',
    });
  }

  const parsed = parseJsonLoose(text);
  return normalizeAiResult(parsed, { provider, model });
}

/** ทดสอบการเชื่อมต่อ AI ด้วยคำถามสั้น ๆ */
export async function testAiConnection(settings) {
  const started = Date.now();
  const res = await aiAnalyze({
    settings,
    query: 'hello',
    context: 'Hello, how are you?',
    targetLang: 'th',
    mode: 'translate-only',
  });
  return { ok: true, ms: Date.now() - started, provider: res.provider, sample: res.translation };
}

/* ------------------------------------------------------------------ */
/* ตัวเรียกผู้ให้บริการแต่ละเจ้า                                        */
/* ------------------------------------------------------------------ */

async function callOpenAiCompatible({ baseUrl, model, apiKey, messages, temperature, maxTokens, timeoutMs, signal, jsonMode }) {
  const body = { model, messages, temperature, max_tokens: maxTokens };
  if (jsonMode) body.response_format = { type: 'json_object' };
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const doCall = (payload) =>
    fetchJson(
      `${baseUrl}/chat/completions`,
      { method: 'POST', headers, body: JSON.stringify(payload) },
      timeoutMs,
      signal
    );

  let data;
  try {
    data = await doCall(body);
  } catch (err) {
    // บางเซิร์ฟเวอร์ (Ollama รุ่นเก่า/LM Studio) ไม่รองรับ response_format
    if (body.response_format) {
      delete body.response_format;
      data = await doCall(body);
    } else {
      throw err;
    }
  }
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI ไม่ได้ตอบกลับ (ตรวจสอบ model และ API key)');
  return typeof content === 'string' ? content : JSON.stringify(content);
}

async function callGemini({ baseUrl, model, apiKey, messages, temperature, maxTokens, timeoutMs, signal }) {
  if (!apiKey) throw new Error('ยังไม่ได้ใส่ Gemini API key');
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const data = await fetchJson(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        generationConfig: { temperature, maxOutputTokens: maxTokens, responseMimeType: 'application/json' },
      }),
    },
    timeoutMs,
    signal
  );
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
  if (!text) throw new Error(data?.error?.message || 'Gemini ไม่ได้ตอบกลับ');
  return text;
}

async function callAnthropic({ baseUrl, model, apiKey, messages, temperature, maxTokens, timeoutMs, signal }) {
  if (!apiKey) throw new Error('ยังไม่ได้ใส่ Anthropic API key');
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const msgs = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content }));
  const data = await fetchJson(
    `${baseUrl}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model, system, messages: msgs, temperature, max_tokens: maxTokens }),
    },
    timeoutMs,
    signal
  );
  const text = (data?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  if (!text) throw new Error(data?.error?.message || 'Claude ไม่ได้ตอบกลับ');
  return text;
}

/* ------------------------------------------------------------------ */
/* Normalize                                                           */
/* ------------------------------------------------------------------ */

function str(v) {
  if (typeof v !== 'string') return '';
  return v.trim();
}

function strOrNull(v) {
  const s = str(v);
  if (!s || /^(null|none|n\/a|-)$/i.test(s)) return null;
  return s;
}

export function normalizeAiResult(raw, { provider = 'ai', model = '' } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = {
    provider: `ai:${provider}`,
    model,
    translation: str(r.translation || r.translated || r.thai),
    literal: strOrNull(r.literal),
    reading: strOrNull(r.reading || r.ipa || r.phonetic),
    partOfSpeech: strOrNull(r.partOfSpeech || r.pos),
    register: strOrNull(r.register || r.tone),
    contextMeaning: strOrNull(r.contextMeaning || r.context_meaning || r.meaningInContext),
    alternatives: toArray(r.alternatives || r.alternativeTranslations)
      .map((a) => (typeof a === 'string' ? { translation: str(a), when: '' } : { translation: str(a?.translation || a?.text), when: str(a?.when || a?.note) }))
      .filter((a) => a.translation),
    definitions: toArray(r.definitions)
      .map((d) => (typeof d === 'string' ? { pos: '', meaning: str(d), th: '' } : { pos: str(d?.pos), meaning: str(d?.meaning || d?.definition), th: str(d?.th || d?.thai) }))
      .filter((d) => d.meaning || d.th),
    synonyms: toArray(r.synonyms)
      .map((s) => (typeof s === 'string' ? { word: str(s), th: '', level: 'normal', note: '' } : { word: str(s?.word), th: str(s?.th || s?.thai), level: normalizeLevel(s?.level), note: str(s?.note) }))
      .filter((s) => s.word),
    examples: toArray(r.examples)
      .map((e) => (typeof e === 'string' ? { en: str(e), th: '' } : { en: str(e?.en || e?.example || e?.text), th: str(e?.th || e?.thai) }))
      .filter((e) => e.en),
    collocations: toArray(r.collocations).map(str).filter(Boolean),
    memoryHook: strOrNull(r.memoryHook || r.mnemonic),
    notes: strOrNull(r.notes || r.note || r.warning),
  };
  out.synonyms = uniqueBy(out.synonyms, (s) => s.word.toLowerCase());
  out.examples = uniqueBy(out.examples, (e) => e.en.toLowerCase());
  return out;
}

function toArray(v) {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  return [v];
}

function normalizeLevel(v) {
  const s = str(v).toLowerCase();
  if (['easy', 'ง่าย', 'basic', 'common', 'simple'].includes(s)) return 'easy';
  if (['advanced', 'hard', 'formal', 'ยาก', 'ทางการ'].includes(s)) return 'advanced';
  return 'normal';
}
