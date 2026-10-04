/**
 * ตัวเชื่อมต่อผู้ให้บริการแปลแต่ละเจ้า
 * โมดูลนี้ต้องเป็น "pure" คือไม่เรียก chrome.* เลย เพื่อให้ทดสอบด้วย Node ได้
 * (การเรียก fetch ทั้งหมดต้องวิ่งผ่าน service worker เท่านั้น เพราะ content script ติด CORS)
 */
import { fetchJson, detectLang, truncate } from '../common/util.js';

export const PROVIDER_META = {
  'google-free': {
    label: 'Google Translate (ไม่ต้องใช้คีย์)',
    kind: 'mt',
    needsKey: false,
    quality: 4,
    note: 'ให้ข้อมูลพจนานุกรม คำพ้อง และตัวอย่างประโยคมาด้วย',
  },
  'google-chrome-dict': {
    label: 'Google Dictionary (ไม่ต้องใช้คีย์)',
    kind: 'mt',
    needsKey: false,
    quality: 3,
    note: 'เร็วและเสถียร แต่ได้คำแปลสั้น ไม่มีตัวอย่าง',
  },
  mymemory: {
    label: 'MyMemory (ไม่ต้องใช้คีย์)',
    kind: 'mt',
    needsKey: false,
    quality: 2,
    note: 'คลังความจำการแปลของชุมชน ใช้เป็นตัวสำรอง',
  },
  libre: {
    label: 'LibreTranslate (เซิร์ฟเวอร์ของคุณเอง/สาธารณะ)',
    kind: 'mt',
    needsKey: false,
    quality: 2,
    note: 'ตั้งค่า endpoint ได้ เหมาะกับการรันในเครื่อง',
  },
  deepl: {
    label: 'DeepL',
    kind: 'mt',
    needsKey: true,
    quality: 5,
    note: 'คุณภาพสูงมากสำหรับประโยคยาว ต้องมี API key',
  },
  ai: {
    label: 'AI (OpenAI / Gemini / Claude / Ollama)',
    kind: 'ai',
    needsKey: true,
    quality: 5,
    note: 'แปลตามบริบท พร้อมตัวอย่าง คำพ้อง และตัวช่วยจำ',
  },
};

const LANG_ALIASES = {
  'zh-CN': { google: 'zh-CN', libre: 'zh', deepl: 'ZH', mymemory: 'zh-CN' },
  zh: { google: 'zh-CN', libre: 'zh', deepl: 'ZH', mymemory: 'zh-CN' },
};

function toLang(code, target) {
  const c = code || 'auto';
  const alias = LANG_ALIASES[c]?.[target];
  return alias || c;
}

export function listProviderIds() {
  return Object.keys(PROVIDER_META);
}

/** เรียกผู้ให้บริการตาม id แล้วคืนผลลัพธ์รูปแบบเดียวกันหมด */
export async function runProvider(id, opts) {
  const { text, from = 'auto', to = 'th', settings = {}, timeoutMs = 9000, signal = null } = opts;
  const base = { provider: id, translation: '', detectedSource: '', dictionary: null, alternatives: [] };
  switch (id) {
    case 'google-free':
      return { ...base, ...(await googleFree({ text, from, to, timeoutMs, signal })) };
    case 'google-chrome-dict':
      return { ...base, ...(await googleChromeDict({ text, from, to, timeoutMs, signal })) };
    case 'mymemory':
      return { ...base, ...(await myMemory({ text, from, to, timeoutMs, signal })) };
    case 'libre':
      return { ...base, ...(await libreTranslate({ text, from, to, timeoutMs, signal, cfg: settings?.providers?.libre || {} })) };
    case 'deepl':
      return { ...base, ...(await deepl({ text, from, to, timeoutMs, signal, cfg: settings?.providers?.deepl || {} })) };
    case 'ai':
      throw new Error('AI provider ถูกเรียกผ่าน ai.js ไม่ใช่ providers.js');
    default:
      throw new Error(`ไม่รู้จักผู้ให้บริการ: ${id}`);
  }
}

/* ------------------------------------------------------------------ */
/* Google Translate แบบไม่เป็นทางการ (client=gtx)                      */
/* ------------------------------------------------------------------ */

async function googleFree({ text, from, to, timeoutMs, signal }) {
  const params = new URLSearchParams({
    client: 'gtx',
    sl: from || 'auto',
    tl: toLang(to, 'google'),
    dt: 't',
    q: text,
  });
  params.append('dt', 'bd');
  params.append('dt', 'ex');
  params.append('dt', 'ss');
  const url = `https://translate.googleapis.com/translate_a/single?${params}`;
  const data = await fetchJson(url, {}, timeoutMs, signal);

  const segments = Array.isArray(data?.[0]) ? data[0] : [];
  const translation = segments
    .map((s) => (Array.isArray(s) ? s[0] : s))
    .filter((s) => typeof s === 'string')
    .join('')
    .trim();

  const detectedSource = typeof data?.[2] === 'string' ? data[2] : '';
  const dict = parseGoogleDict(data?.[1]);
  if (!translation) throw new Error('Google ไม่คืนคำแปล');

  return {
    translation,
    detectedSource,
    dictionary: dict.entries.length ? dict : null,
    alternatives: dict.entries.flatMap((e) => e.terms).slice(0, 8),
  };
}

/**
 * แยกข้อมูลพจนานุกรมจาก response ของ Google
 * โครงสร้างจริงของ d[1] (ตรวจจากของจริงแล้ว):
 *   [ partOfSpeech,
 *     [คำแปล/คำพ้องในภาษาเป้าหมาย...],
 *     [ [คำแปล, [คำพ้องภาษาอังกฤษ...], [คู่ตัวอย่างประโยค], คะแนน], ... ],
 *     คำตั้งต้น, จำนวน ]
 * จุดสำคัญ: entry[2] ไม่ใช่ "นิยาม" แต่เป็นพจนานุกรมย้อนกลับ (คำแปล -> คำอังกฤษที่ตรงกัน)
 */
export function parseGoogleDict(raw) {
  const entries = [];
  if (!Array.isArray(raw)) return { entries };
  for (const entry of raw) {
    if (!Array.isArray(entry)) continue;
    const pos = typeof entry[0] === 'string' ? entry[0] : '';
    const e = { pos, terms: [], synonyms: [], definitions: [], examples: [] };

    if (Array.isArray(entry[1])) {
      for (const t of entry[1]) if (typeof t === 'string' && t.trim()) e.terms.push(t.trim());
    }

    if (Array.isArray(entry[2])) {
      for (const item of entry[2]) {
        if (!Array.isArray(item)) continue;
        if (Array.isArray(item[1])) {
          for (const s of item[1]) {
            if (typeof s === 'string' && /^[A-Za-z][A-Za-z' -]*$/.test(s.trim())) e.synonyms.push(s.trim());
          }
        }
        if (Array.isArray(item[2])) {
          for (const ex of item[2]) {
            if (!Array.isArray(ex)) continue;
            const strs = ex.filter((x) => typeof x === 'string' && x.trim());
            if (strs.length >= 2 && (/\s/.test(strs[0]) || /\s/.test(strs[1]))) {
              if (/[A-Za-z]/.test(strs[0])) e.examples.push({ en: strs[0], th: strs[1] });
              else e.examples.push({ en: strs[1], th: strs[0] });
            }
          }
        }
      }
    }

    // กันเหนียว: บางคำตอบอาจมีนิยามจริงปนมา — รับเฉพาะข้อความที่ยาวพอจะเป็นนิยาม
    for (const part of entry.slice(3)) {
      if (typeof part === 'string') {
        const s = part.trim();
        if (s.length > 25 && /\s/.test(s) && s.toLowerCase() !== String(entry[3] || '').toLowerCase()) {
          e.definitions.push(s);
        }
      }
    }

    if (e.terms.length || e.definitions.length || e.examples.length || e.synonyms.length) entries.push(e);
  }
  return { entries };
}

/* ------------------------------------------------------------------ */
/* Google Dictionary endpoint (clients5) — เบาและเสถียร                  */
/* ------------------------------------------------------------------ */

async function googleChromeDict({ text, from, to, timeoutMs, signal }) {
  const url =
    'https://clients5.google.com/translate_a/t?' +
    new URLSearchParams({ client: 'dict-chrome-ex', sl: from || 'auto', tl: toLang(to, 'google'), q: text });
  const data = await fetchJson(url, {}, timeoutMs, signal);
  const items = Array.isArray(data) ? data : [data];
  const parts = [];
  let detectedSource = '';
  for (const it of items) {
    if (typeof it === 'string') parts.push(it);
    else if (Array.isArray(it)) {
      if (typeof it[0] === 'string') parts.push(it[0]);
      if (typeof it[1] === 'string' && /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(it[1])) detectedSource = it[1];
    }
  }
  const translation = parts.join('').trim();
  if (!translation) throw new Error('Google Dictionary ไม่คืนคำแปล');
  return { translation, detectedSource, dictionary: null, alternatives: [] };
}

/* ------------------------------------------------------------------ */
/* MyMemory                                                            */
/* ------------------------------------------------------------------ */

async function myMemory({ text, from, to, timeoutMs, signal }) {
  const src = !from || from === 'auto' ? detectLang(text) || 'en' : from;
  const url =
    'https://api.mymemory.translated.net/get?' +
    new URLSearchParams({ q: truncate(text, 480), langpair: `${toLang(src, 'mymemory')}|${toLang(to, 'mymemory')}` });
  const data = await fetchJson(url, {}, timeoutMs, signal);
  const translation = data?.responseData?.translatedText?.trim();
  if (!translation) throw new Error(data?.responseDetails || 'MyMemory ไม่คืนคำแปล');
  if (/^MYMEMORY WARNING/i.test(translation)) throw new Error(translation);
  const alternatives = (data?.matches || [])
    .map((m) => m?.translation)
    .filter((t) => typeof t === 'string' && t.trim() && t !== translation)
    .slice(0, 5);
  return { translation, detectedSource: src, dictionary: null, alternatives };
}

/* ------------------------------------------------------------------ */
/* LibreTranslate                                                      */
/* ------------------------------------------------------------------ */

async function libreTranslate({ text, from, to, timeoutMs, signal, cfg }) {
  const endpoint = (cfg.endpoint || 'https://libretranslate.com').replace(/\/+$/, '');
  const body = {
    q: text,
    source: from === 'auto' ? 'auto' : toLang(from, 'libre'),
    target: toLang(to, 'libre'),
    format: 'text',
  };
  if (cfg.apiKey) body.api_key = cfg.apiKey;
  const data = await fetchJson(
    `${endpoint}/translate`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    timeoutMs,
    signal
  );
  const translation = (data?.translatedText || '').trim();
  if (!translation) throw new Error('LibreTranslate ไม่คืนคำแปล');
  return { translation, detectedSource: data?.detectedLanguage?.language || '', dictionary: null, alternatives: [] };
}

/* ------------------------------------------------------------------ */
/* DeepL                                                               */
/* ------------------------------------------------------------------ */

async function deepl({ text, from, to, timeoutMs, signal, cfg }) {
  if (!cfg.apiKey) throw new Error('ยังไม่ได้ใส่ DeepL API key');
  const host = cfg.pro ? 'https://api.deepl.com' : 'https://api-free.deepl.com';
  const body = { text: [text], target_lang: toLang(to, 'deepl') };
  if (from && from !== 'auto') body.source_lang = toLang(from, 'deepl').slice(0, 2).toUpperCase();
  const data = await fetchJson(
    `${host}/v2/translate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `DeepL-Auth-Key ${cfg.apiKey}` },
      body: JSON.stringify(body),
    },
    timeoutMs,
    signal
  );
  const translation = data?.translations?.[0]?.text?.trim();
  if (!translation) throw new Error('DeepL ไม่คืนคำแปล');
  return {
    translation,
    detectedSource: data?.translations?.[0]?.detected_source_language?.toLowerCase() || '',
    dictionary: null,
    alternatives: [],
  };
}
