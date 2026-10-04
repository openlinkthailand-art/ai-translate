/** ฟังก์ชันช่วยเหลือทั่วไป (ใช้ได้ทุกบริบท: content script / service worker / หน้าเว็บ) */

const THAI = /[\u0E00-\u0E7F]/;
const CJK = /[\u4E00-\u9FFF\u3400-\u4DBF]/;
const KANA = /[\u3040-\u30FF]/;
const HANGUL = /[\uAC00-\uD7AF\u1100-\u11FF]/;
const CYRILLIC = /[\u0400-\u04FF]/;
const ARABIC = /[\u0600-\u06FF]/;
const DEVANAGARI = /[\u0900-\u097F]/;
const LATIN = /[A-Za-z]/;

/** เดาภาษาของข้อความแบบหยาบ ๆ พอสำหรับเลือกคู่ภาษาให้ตัวแปล */
export function detectLang(text) {
  if (!text) return '';
  const s = text.slice(0, 600);
  const counts = {
    th: count(s, THAI),
    zh: count(s, CJK),
    ja: count(s, KANA),
    ko: count(s, HANGUL),
    ru: count(s, CYRILLIC),
    ar: count(s, ARABIC),
    hi: count(s, DEVANAGARI),
    en: count(s, LATIN),
  };
  let best = '';
  let bestN = 0;
  for (const [lang, n] of Object.entries(counts)) {
    if (n > bestN) {
      best = lang;
      bestN = n;
    }
  }
  return bestN === 0 ? '' : best;
}

function count(str, re) {
  const m = str.match(new RegExp(re.source, 'g'));
  return m ? m.length : 0;
}

export function isThai(text) {
  return THAI.test(text || '');
}

/** hash แบบ FNV-1a 32-bit ใช้เป็นคีย์แคช */
export function hashKey(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'w_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** ตัดช่องว่างซ้ำและอักขระครอบที่เกินมา เช่น "  word,  " -> "word" */
export function normalizeQuery(text) {
  let s = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.replace(/^["'“”‘’(\[{<«]+/, '').replace(/["'“”‘’)\]}>»]+$/, '');
  s = s.replace(/[.,;:!?]+$/, '');
  return s.trim();
}

/** ทำความสะอาดคำที่ได้จากการดับเบิลคลิก (ตัดเครื่องหมายที่ติดมา) */
export function cleanWord(text) {
  const s = normalizeQuery(text);
  return s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').trim();
}

export function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function truncate(s, n) {
  const str = String(s ?? '');
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

/**
 * ดึงข้อความรอบ ๆ คำเป้าหมายเพื่อส่งเป็นบริบทให้ตัวแปล/AI
 * จะพยายามเลือกประโยคที่ครอบคำเป้าหมายก่อน ถ้าไม่พบจึงตัดหน้าต่างข้อความ
 */
export function pickContext(fullText, target, maxChars = 700) {
  const full = String(fullText || '').replace(/\s+/g, ' ').trim();
  if (!full) return '';
  if (full.length <= maxChars) return full;

  const idx = target ? full.toLowerCase().indexOf(String(target).toLowerCase().slice(0, 40)) : -1;
  if (idx >= 0) {
    const sentences = splitSentences(full);
    const hit = sentences.find((s) => s.toLowerCase().includes(String(target).toLowerCase().slice(0, 40)));
    if (hit && hit.length <= maxChars) return hit;
    const start = Math.max(0, idx - Math.floor(maxChars / 2));
    const end = Math.min(full.length, start + maxChars);
    return (start > 0 ? '…' : '') + full.slice(start, end).trim() + (end < full.length ? '…' : '');
  }
  return full.slice(0, maxChars) + '…';
}

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/** เลือกประโยคที่มีคำเป้าหมายอยู่ในนั้น (ใช้ยกประโยคที่ผู้ใช้อ่านเป็นตัวอย่าง) */
export function pickSentenceWith(text, needle) {
  const sentences = splitSentences(text);
  if (!sentences.length) return '';
  const n = String(needle || '').trim().toLowerCase();
  if (n) {
    const hit = sentences.find((s) => s.toLowerCase().includes(n));
    if (hit) return hit;
  }
  return sentences[0];
}

export function debounce(fn, ms = 150) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function uniqueBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of arr || []) {
    const k = keyFn(item);
    if (k == null || seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** fetch ที่มี timeout และแนบ signal จากภายนอกได้ */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 9000, outerSignal = null) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs);
  const onAbort = () => ctrl.abort(new DOMException('aborted', 'AbortError'));
  if (outerSignal) {
    if (outerSignal.aborted) onAbort();
    else outerSignal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    if (outerSignal) outerSignal.removeEventListener('abort', onAbort);
  }
}

export async function fetchJson(url, options = {}, timeoutMs = 9000, outerSignal = null) {
  const res = await fetchWithTimeout(url, options, timeoutMs, outerSignal);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText} ${truncate(body, 120)}`);
  }
  return res.json();
}

/** ดึง JSON ออกจากข้อความที่ AI ตอบ (รองรับกรณีห่อด้วย ```json) */
export function parseJsonLoose(text) {
  if (!text) throw new Error('empty response');
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(s.slice(start, end + 1));
    throw new Error('ไม่พบ JSON ในคำตอบของ AI');
  }
}

export function formatThaiDate(ts) {
  try {
    return new Date(ts).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return new Date(ts).toISOString().slice(0, 10);
  }
}

export function formatRelativeThai(ts) {
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'เมื่อสักครู่';
  if (min < 60) return `${min} นาทีที่แล้ว`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} ชั่วโมงที่แล้ว`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} วันที่แล้ว`;
  return formatThaiDate(ts);
}

/** แปลงค่า frequency จาก Datamuse (tags: f:1.335) เป็นคะแนน "คำง่าย/ใช้บ่อย" */
export function datamuseFrequency(tags) {
  const t = (tags || []).find((x) => typeof x === 'string' && x.startsWith('f:'));
  if (!t) return null;
  const v = Number(t.slice(2));
  return Number.isFinite(v) ? v : null;
}

export function deburr(str) {
  return String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
