/**
 * แหล่งข้อมูลเสริม: คำพ้องความหมาย/นิยาม (Datamuse) และตัวอย่างประโยคจริงพร้อมคำแปลไทย (Tatoeba)
 * โมดูล pure ไม่พึ่ง chrome.* เพื่อให้ทดสอบได้
 */
import { fetchJson, truncate, uniqueBy, datamuseFrequency } from '../common/util.js';

const TATOEBA_LANG = {
  en: 'eng',
  th: 'tha',
  ja: 'jpn',
  ko: 'kor',
  zh: 'cmn',
  'zh-CN': 'cmn',
  fr: 'fra',
  de: 'deu',
  es: 'spa',
  ru: 'rus',
  vi: 'vie',
  hi: 'hin',
  ar: 'ara',
};

/** จัดระดับความง่ายของคำจากความถี่ที่ใช้จริง (Datamuse อ้างอิงจากคลังข้อความ) */
export function levelFromFrequency(freq) {
  if (freq == null) return 'normal';
  if (freq >= 10) return 'easy';
  if (freq >= 1) return 'normal';
  return 'advanced';
}

/**
 * ดึงคำพ้องความหมายที่ "ใช้บ่อย/ง่าย" และนิยามภาษาอังกฤษจาก Datamuse
 * ถ้าคำที่พิมพ์มามีตัวพิมพ์ใหญ่แล้วไม่พบผลลัพธ์ จะลองตัวพิมพ์เล็กให้อีกครั้ง
 * (คำต้นประโยคในหนังสือมักขึ้นต้นด้วยตัวใหญ่ เช่น "Resilient")
 * @returns {{synonyms: Array, definitions: Array}}
 */
export async function datamuseLookup(word, { timeoutMs = 7000, signal = null, limit = 12, simpleOnly = true } = {}) {
  const w = String(word || '').trim();
  if (!w || !/[A-Za-z]/.test(w)) return { synonyms: [], definitions: [] };

  const once = async (term) => {
    const [synRaw, defRaw] = await Promise.all([
      fetchJson(
        `https://api.datamuse.com/words?${new URLSearchParams({ rel_syn: term, md: 'f', max: '40' })}`,
        {},
        timeoutMs,
        signal
      ).catch(() => []),
      fetchJson(
        `https://api.datamuse.com/words?${new URLSearchParams({ sp: term, md: 'dfps', max: '3' })}`,
        {},
        timeoutMs,
        signal
      ).catch(() => []),
    ]);

    let synItems = Array.isArray(synRaw) ? synRaw : [];
    if (!synItems.length) {
      const ml = await fetchJson(
        `https://api.datamuse.com/words?${new URLSearchParams({ ml: term, md: 'f', max: '20' })}`,
        {},
        timeoutMs,
        signal
      ).catch(() => []);
      synItems = Array.isArray(ml) ? ml : [];
    }

    const scored = synItems
      .map((item) => ({
        word: item.word,
        freq: datamuseFrequency(item.tags),
        level: levelFromFrequency(datamuseFrequency(item.tags)),
      }))
      .filter((s) => s.word && s.word.toLowerCase() !== term.toLowerCase() && /^[a-z][a-z'-]*$/i.test(s.word))
      .map((s) => ({ ...s, freq: s.freq ?? 0 }))
      .sort((a, b) => b.freq - a.freq);

    const filtered = simpleOnly ? scored.filter((s) => s.freq >= 0.5) : scored;
    const synonyms = uniqueBy(filtered.length ? filtered : scored, (s) => s.word).slice(0, limit);

    const exact = (Array.isArray(defRaw) ? defRaw : []).find((e) => (e.word || '').toLowerCase() === term.toLowerCase());
    const definitions = (exact?.defs || [])
      .map((d) => {
        const [pos, meaning] = String(d).split('\t');
        return { pos: (pos || '').trim(), meaning: (meaning || '').trim() };
      })
      .filter((d) => d.meaning)
      .slice(0, 4);

    return { synonyms, definitions };
  };

  const result = await once(w);
  if ((result.synonyms.length || result.definitions.length) || w === w.toLowerCase()) return result;
  return once(w.toLowerCase());
}

/**
 * ดึงตัวอย่างประโยคสองภาษาจาก Tatoeba (ประโยคจริงที่คนแปลไว้แล้ว)
 * ใช้ API ใหม่ (api.tatoeba.org) เป็นหลักเพราะ "มี CORS" จึงใช้ได้ทั้งส่วนขยายและเว็บแอป
 * แล้วถอยไปใช้ API เดิม (tatoeba.org/en/api_v0) ถ้า API ใหม่ล้มเหลว
 * @returns {Array<{en:string, th:string, source:string}>}
 */
export async function tatoebaExamples(text, { from = 'en', to = 'th', timeoutMs = 8000, signal = null, limit = 3 } = {}) {
  const q = truncate(String(text || '').trim(), 60);
  if (!q) return [];
  const src = TATOEBA_LANG[from] || 'eng';
  const dst = TATOEBA_LANG[to] || 'tha';
  const needle = q.toLowerCase();
  const single = !/\s/.test(needle);
  const wordRe = new RegExp(`\\b${escapeRe(needle)}\\b`, 'i');
  const keep = (en) => en && en.length <= 160 && (!single || wordRe.test(en));

  // ---- API ใหม่ (มี CORS + ให้คำแปลมาพร้อมกัน) ----
  let newApiWorked = false;
  try {
    const url =
      'https://api.tatoeba.org/unstable/sentences?' +
      new URLSearchParams({
        lang: src,
        q,
        sort: 'relevance',
        limit: String(Math.max(limit * 4, 12)),
        'trans:lang': dst,
      });
    const data = await fetchJson(url, {}, timeoutMs, signal);
    newApiWorked = true;
    const picked = [];
    for (const r of data?.data || []) {
      const en = String(r?.text || '').trim();
      if (!keep(en)) continue;
      const th = (r?.translations || []).find((t) => t?.lang === dst)?.text;
      if (!th) continue;
      picked.push({ en, th: String(th).trim(), source: 'Tatoeba' });
      if (picked.length >= limit * 2) break;
    }
    if (picked.length) return uniqueBy(picked, (p) => p.en).slice(0, limit);
  } catch {
    newApiWorked = false;
  }
  // ถ้า API ใหม่ตอบแล้วแค่ไม่มีประโยคที่ตรง ไม่ต้องไปลอง API เดิม
  // (API เดิมไม่มี CORS จึงใช้ไม่ได้ในเว็บแอป และจะทำให้เกิด error รบกวนในคอนโซล)
  if (newApiWorked) return [];

  // ---- API เดิม (สำรอง สำหรับส่วนขยาย/สภาพแวดล้อมที่ยังเรียกได้) ----
  try {
    const url =
      'https://tatoeba.org/en/api_v0/search?' +
      new URLSearchParams({ from: src, to: dst, query: q, sort: 'relevance' });
    const data = await fetchJson(url, {}, timeoutMs, signal);
    const picked = [];
    for (const r of data?.results || []) {
      const en = String(r?.text || '').trim();
      if (!keep(en)) continue;
      const translations = (r?.translations || []).flat().filter(Boolean);
      const th = translations.find((t) => t?.lang === dst)?.text || translations[0]?.text || '';
      if (!th) continue;
      picked.push({ en, th: String(th).trim(), source: 'Tatoeba' });
      if (picked.length >= limit * 2) break;
    }
    return uniqueBy(picked, (p) => p.en).slice(0, limit);
  } catch {
    return [];
  }
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const POS_MAP = {
  Adjective: 'adj.',
  Noun: 'n.',
  Verb: 'v.',
  Adverb: 'adv.',
  Preposition: 'prep.',
  Conjunction: 'conj.',
  Pronoun: 'pron.',
  Interjection: 'interj.',
  Numeral: 'num.',
  Determiner: 'det.',
  Particle: 'part.',
  Phrase: 'phrase',
  Idiom: 'idiom',
  Proverb: 'proverb',
};

/**
 * ดึงนิยามภาษาอังกฤษ (และตัวอย่าง ถ้ามี) จาก Wiktionary REST API
 * ใช้เติมข้อมูลตอนที่ไม่ได้เปิด AI เพื่อให้ยังมีชนิดคำและความหมายให้อ่าน
 * หมายเหตุ: API นี้แยกตัวพิมพ์เล็ก-ใหญ่ ("Resilient" ได้ 404 แต่ "resilient" ได้ปกติ)
 * จึงลองตามที่พิมพ์มาก่อน แล้วถ้าไม่ได้ค่อยลองตัวพิมพ์เล็ก
 */
export async function wiktionaryLookup(word, { timeoutMs = 7000, signal = null, lang = 'en' } = {}) {
  const w = String(word || '').trim();
  const out = { definitions: [], examples: [], partOfSpeech: null };
  if (!w || !/^[A-Za-z][A-Za-z'’ -]*$/.test(w)) return out;

  const attempt = async (term) => {
    const data = await fetchJson(
      `https://${lang}.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(term)}`,
      {},
      timeoutMs,
      signal
    ).catch(() => null);
    const parts = Array.isArray(data?.[lang]) ? data[lang] : [];
    const found = { definitions: [], examples: [], partOfSpeech: null };
    for (const part of parts) {
      const pos = POS_MAP[part?.partOfSpeech] || part?.partOfSpeech || '';
      if (!found.partOfSpeech && pos) found.partOfSpeech = pos;
      for (const d of (part?.definitions || []).slice(0, 3)) {
        const meaning = truncate(stripHtml(d?.definition || '').split('\n')[0], 220);
        if (meaning) found.definitions.push({ pos, meaning, th: '' });
        for (const ex of (d?.examples || []).slice(0, 1)) {
          const en = stripHtml(ex);
          if (en && en.length < 200) found.examples.push({ en, th: '', source: 'Wiktionary' });
        }
        if (found.definitions.length >= 4) break;
      }
      if (found.definitions.length >= 4) break;
    }
    return found;
  };

  // ลองตัวพิมพ์เล็กก่อนเสมอ เพราะคำต้นประโยคในหนังสือมักขึ้นต้นด้วยตัวใหญ่
  // และ API นี้แยกตัวพิมพ์เล็ก-ใหญ่ ("Resilient" ตอบ 404 แต่ "resilient" ปกติ)
  // ถ้าไม่พบผลลัพธ์จึงลองตามที่พิมพ์มา (เผื่อเป็นชื่อเฉพาะ)
  const lower = w.toLowerCase();
  let result = await attempt(lower);
  if (!result.definitions.length && lower !== w) result = await attempt(w);
  return result;
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
