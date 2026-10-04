/**
 * คลังคำศัพท์ส่วนตัว เก็บใน IndexedDB (อยู่ในเครื่องเท่านั้น ไม่ส่งขึ้น cloud)
 * พร้อมระบบทบทวนแบบ spaced repetition (SM-2 แบบย่อ)
 */
import { clamp, uid, uniqueBy } from '../common/util.js';

const DB_NAME = 'atthai_library';
const DB_VERSION = 1;
const STORE = 'words';
const META = 'meta';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('word', 'word', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('due', 'srs.due', { unique: false });
        store.createIndex('starred', 'starred', { unique: false });
      }
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'k' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction([STORE, META], mode);
        let result;
        const store = t.objectStore(STORE);
        const meta = t.objectStore(META);
        try {
          result = fn(store, meta);
        } catch (err) {
          reject(err);
          return;
        }
        t.oncomplete = () => resolve(result && result.__req ? result.__req.result : result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

function req(r) {
  return { __req: r };
}

/* ------------------------------------------------------------------ */
/* โครงสร้างข้อมูลคำศัพท์                                              */
/* ------------------------------------------------------------------ */

export function makeWordEntry(result, meta = {}) {
  const now = Date.now();
  return {
    id: uid(),
    word: result.query,
    translation: result.translation || '',
    reading: result.reading || '',
    partOfSpeech: result.partOfSpeech || '',
    register: result.register || '',
    contextMeaning: result.contextMeaning || '',
    context: result.context || '',
    literal: result.literal || '',
    memoryHook: result.memoryHook || '',
    notes: result.notes || '',
    alternatives: result.alternatives || [],
    definitions: result.definitions || [],
    synonyms: result.synonyms || [],
    examples: result.examples || [],
    collocations: result.collocations || [],
    sourceLang: result.sourceLang || '',
    targetLang: result.targetLang || '',
    provider: result.provider || '',
    aiUsed: !!result.aiUsed,
    sourceTitle: meta.sourceTitle || '',
    sourceUrl: meta.sourceUrl || '',
    sourceType: meta.sourceType || 'web',
    tags: meta.tags || [],
    starred: !!meta.starred,
    createdAt: now,
    updatedAt: now,
    lastReviewedAt: 0,
    reviewCount: 0,
    srs: { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: now, lastGrade: null },
  };
}

export function mergeWordEntry(existing, incoming) {
  const merged = { ...existing };
  for (const key of ['translation', 'reading', 'partOfSpeech', 'register', 'contextMeaning', 'literal', 'memoryHook', 'context']) {
    if (!merged[key] && incoming[key]) merged[key] = incoming[key];
  }
  for (const key of ['alternatives', 'definitions', 'synonyms', 'examples', 'collocations']) {
    merged[key] = uniqueBy([...(existing[key] || []), ...(incoming[key] || [])], (x) => JSON.stringify(x).slice(0, 120));
  }
  merged.notes = [existing.notes, incoming.notes].filter(Boolean).join('\n');
  merged.updatedAt = Date.now();
  return merged;
}

/* ------------------------------------------------------------------ */
/* CRUD                                                                */
/* ------------------------------------------------------------------ */

export async function addWord(entry) {
  const existing = await findByWord(entry.word, entry.targetLang);
  if (existing) {
    const merged = mergeWordEntry(existing, entry);
    await tx('readwrite', (s) => req(s.put(merged)));
    return { entry: merged, created: false };
  }
  await tx('readwrite', (s) => req(s.put(entry)));
  return { entry, created: true };
}

export async function getWord(id) {
  return tx('readonly', (s) => req(s.get(id)));
}

export async function findByWord(word, targetLang = '') {
  const all = await tx('readonly', (s) => req(s.getAll()));
  const w = String(word || '').trim().toLowerCase();
  const list = all.filter((e) => e.word?.toLowerCase() === w && (!targetLang || e.targetLang === targetLang));
  return list.sort((a, b) => b.createdAt - a.createdAt)[0] || null;
}

export async function updateWord(id, patch) {
  const current = await getWord(id);
  if (!current) throw new Error('ไม่พบคำนี้ในคลัง');
  const next = { ...current, ...patch, id, updatedAt: Date.now() };
  await tx('readwrite', (s) => req(s.put(next)));
  return next;
}

export async function deleteWord(id) {
  await tx('readwrite', (s) => req(s.delete(id)));
  return true;
}

export async function deleteMany(ids) {
  await tx('readwrite', (s) => {
    ids.forEach((id) => s.delete(id));
    return ids.length;
  });
  return ids.length;
}

export async function listWords({ query = '', tag = '', sort = 'newest', starredOnly = false, dueOnly = false, limit = 0, offset = 0 } = {}) {
  let all = await tx('readonly', (s) => req(s.getAll()));
  if (starredOnly) all = all.filter((e) => e.starred);
  if (dueOnly) all = all.filter((e) => (e.srs?.due || 0) <= Date.now());
  if (tag) all = all.filter((e) => (e.tags || []).includes(tag));
  if (query) {
    const q = query.toLowerCase();
    all = all.filter(
      (e) =>
        e.word?.toLowerCase().includes(q) ||
        e.translation?.toLowerCase().includes(q) ||
        e.contextMeaning?.toLowerCase().includes(q) ||
        e.context?.toLowerCase().includes(q) ||
        (e.tags || []).some((t) => t.toLowerCase().includes(q))
    );
  }
  const sorters = {
    newest: (a, b) => b.createdAt - a.createdAt,
    oldest: (a, b) => a.createdAt - b.createdAt,
    alpha: (a, b) => String(a.word).localeCompare(String(b.word)),
    due: (a, b) => (a.srs?.due || 0) - (b.srs?.due || 0),
    reviews: (a, b) => (b.reviewCount || 0) - (a.reviewCount || 0),
  };
  all.sort(sorters[sort] || sorters.newest);
  const total = all.length;
  const items = limit ? all.slice(offset, offset + limit) : all.slice(offset);
  return { items, total };
}

export async function countAll() {
  return tx('readonly', (s) => req(s.count()));
}

export async function dueWords(limit = 50, now = Date.now()) {
  const all = await tx('readonly', (s) => req(s.getAll()));
  const due = all.filter((e) => (e.srs?.due || 0) <= now);
  due.sort((a, b) => (a.srs?.due || 0) - (b.srs?.due || 0) || a.createdAt - b.createdAt);
  return limit ? due.slice(0, limit) : due;
}

export async function allTags() {
  const all = await tx('readonly', (s) => req(s.getAll()));
  const counter = new Map();
  for (const e of all) for (const t of e.tags || []) counter.set(t, (counter.get(t) || 0) + 1);
  return [...counter.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
}

export async function stats() {
  const all = await tx('readonly', (s) => req(s.getAll()));
  const now = Date.now();
  const dayAgo = now - 86400000;
  return {
    total: all.length,
    due: all.filter((e) => (e.srs?.due || 0) <= now).length,
    starred: all.filter((e) => e.starred).length,
    addedToday: all.filter((e) => e.createdAt >= dayAgo).length,
    reviewedToday: all.filter((e) => (e.lastReviewedAt || 0) >= dayAgo).length,
    mature: all.filter((e) => (e.srs?.interval || 0) >= 21).length,
    learning: all.filter((e) => (e.srs?.interval || 0) < 21).length,
  };
}

/* ------------------------------------------------------------------ */
/* Spaced repetition                                                   */
/* ------------------------------------------------------------------ */

/** คำนวณกำหนดทบทวนถัดไป (grade: 0=อีกครั้ง 1=ยาก 2=ดี 3=ง่าย) */
export function scheduleNext(srs, grade, now = Date.now()) {
  let { ease = 2.5, interval = 0, reps = 0, lapses = 0 } = srs || {};
  let due;
  if (grade <= 0) {
    lapses += 1;
    reps = 0;
    ease = clamp(ease - 0.2, 1.3, 3.0);
    interval = 0;
    due = now + 10 * 60 * 1000;
  } else {
    reps += 1;
    if (grade === 1) {
      ease = clamp(ease - 0.15, 1.3, 3.0);
      interval = interval ? Math.max(1, Math.round(interval * 1.2)) : 1;
    } else if (grade === 2) {
      interval = interval ? Math.round(interval * ease) : 1;
    } else {
      ease = clamp(ease + 0.15, 1.3, 3.0);
      interval = interval ? Math.round(interval * ease * 1.3) : 3;
    }
    interval = clamp(interval, 1, 365);
    due = now + interval * 86400000;
  }
  return { ease: Number(ease.toFixed(2)), interval, reps, lapses, due, lastGrade: grade, lastReviewedAt: now };
}

export async function applyReview(id, grade) {
  const word = await getWord(id);
  if (!word) throw new Error('ไม่พบคำนี้ในคลัง');
  const srs = scheduleNext(word.srs, grade);
  const next = { ...word, srs, reviewCount: (word.reviewCount || 0) + 1, lastReviewedAt: Date.now(), updatedAt: Date.now() };
  await tx('readwrite', (s) => req(s.put(next)));
  return next;
}

/* ------------------------------------------------------------------ */
/* นำเข้า / ส่งออก                                                     */
/* ------------------------------------------------------------------ */

export async function exportAll() {
  const all = await tx('readonly', (s) => req(s.getAll()));
  return {
    app: 'atthai-translate-reader',
    version: 1,
    exportedAt: new Date().toISOString(),
    count: all.length,
    words: all,
  };
}

export async function importAll(payload, { merge = true } = {}) {
  const incoming = Array.isArray(payload) ? payload : payload?.words;
  if (!Array.isArray(incoming)) throw new Error('ไฟล์ไม่ถูกต้อง: ต้องมีคีย์ "words" เป็น array');
  let added = 0;
  let merged = 0;
  for (const raw of incoming) {
    if (!raw || !raw.word) continue;
    const entry = { ...makeWordEntry({ query: raw.word, ...raw }, {}), ...raw, id: raw.id || uid() };
    if (merge) {
      const existing = await findByWord(entry.word, entry.targetLang);
      if (existing) {
        await tx('readwrite', (s) => req(s.put(mergeWordEntry(existing, entry))));
        merged += 1;
        continue;
      }
    }
    await tx('readwrite', (s) => req(s.put(entry)));
    added += 1;
  }
  return { added, merged, total: incoming.length };
}

export async function clearAll() {
  const count = await countAll();
  await tx('readwrite', (s) => req(s.clear()));
  return count;
}
