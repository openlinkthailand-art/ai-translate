/**
 * ตัวประสานงานหลัก: เลือกผู้ให้บริการ, รวมผลจากหลายแหล่ง, เติมตัวอย่าง/คำพ้อง, แคช
 * นี่คือ "สมอง" ของส่วนขยาย — service worker เรียกฟังก์ชันนี้เพียงจุดเดียว
 */
import { runProvider } from './providers.js';
import { datamuseLookup, tatoebaExamples, wiktionaryLookup } from './dictionary.js';
import { aiAnalyze } from './ai.js';
import * as cache from './cache.js';
import { detectLang, normalizeQuery, pickContext, pickSentenceWith, uniqueBy, truncate } from '../common/util.js';

const LEVEL_RANK = { easy: 0, normal: 1, advanced: 2 };

/**
 * แปล + อธิบายคำเดียวหรือข้อความหนึ่งช่วง
 * @param {object} p
 * @param {string} p.text        คำ/ข้อความที่ต้องการ
 * @param {string} [p.context]   บริบทที่กำลังอ่าน (ใช้ให้ AI แปลให้ตรงบริบท)
 * @param {object} p.settings    settings ทั้งก้อนจาก getSettings()
 * @param {'auto'|'fast'|'ai'} [p.mode]
 * @returns {Promise<object>} ผลลัพธ์พร้อมใช้กับ UI
 */
export async function translateQuery({ text, context = '', settings, mode = 'auto', forceRefresh = false, signal = null }) {
  const query = normalizeQuery(text);
  if (!query) throw new Error('ไม่มีข้อความให้แปล');

  const tCfg = settings.translation || {};
  const enr = settings.enrichment || {};
  const targetLang = tCfg.targetLang || 'th';
  const srcPref = tCfg.sourceLang || 'auto';
  const sourceLang = srcPref === 'auto' ? detectLang(query) || 'en' : srcPref;
  const ctx = pickContext(context || query, query, settings.lookup?.maxContextChars || 700);

  const aiEnabled = !!settings.ai?.enabled;
  const useAi = aiEnabled && mode !== 'fast';
  const aiFirst = useAi && (settings.ai.mode === 'first' || mode === 'ai');

  const chain = (tCfg.providers || []).filter((p) => p !== 'ai');
  const providerChain = chain.length ? chain : ['google-free', 'google-chrome-dict', 'mymemory'];

  const key = cache.cacheKey([
    'v3',
    query.toLowerCase(),
    ctx.slice(0, 80),
    sourceLang,
    targetLang,
    providerChain.join('+'),
    useAi ? `ai:${settings.ai.provider}:${settings.ai.model}:${settings.ai.mode}` : 'noai',
  ]);
  if (!forceRefresh) {
    const hit = await cache.cacheGet(key);
    if (hit) return { ...hit, cached: true, elapsedMs: 0 };
  }

  const warnings = [];
  const started = Date.now();
  let mt = null;
  let ai = null;

  // ข้อความต้นทางเป็นภาษาเป้าหมายอยู่แล้ว ไม่ต้องแปล
  if (sourceLang === targetLang && !useAi) {
    const result = baseResult({ query, ctx, sourceLang, targetLang, provider: 'none', translation: query });
    result.warnings.push({ stage: 'detect', error: `ข้อความนี้เป็นภาษา${targetLang === 'th' ? 'ไทย' : targetLang}อยู่แล้ว` });
    result.elapsedMs = Date.now() - started;
    await cache.cacheSet(key, result);
    return result;
  }

  if (aiFirst) {
    try {
      ai = await aiAnalyze({ settings, query, context: ctx, sourceLang, targetLang, mode: 'full', signal });
    } catch (err) {
      warnings.push({ stage: 'ai', error: errText(err) });
    }
  }

  if (!ai?.translation) {
    mt = await runMtChain(providerChain, { text: query, from: sourceLang, to: targetLang, settings, warnings, signal });
  }

  if (!ai && useAi) {
    try {
      ai = await aiAnalyze({
        settings,
        query,
        context: ctx,
        sourceLang,
        targetLang,
        baseTranslation: mt?.translation || '',
        signal,
      });
    } catch (err) {
      warnings.push({ stage: 'ai', error: errText(err) });
    }
  }

  const translation = ai?.translation || mt?.translation;
  if (!translation) {
    const detail = warnings.map((w) => `${w.provider || w.stage}: ${w.error}`).join(' | ');
    throw new Error(`แปลไม่สำเร็จ — ${detail || 'ไม่สามารถเชื่อมต่อผู้ให้บริการได้'}`);
  }

  // ---- ข้อมูลเสริม (ทำขนานกัน) ----
  const isEnglish = sourceLang === 'en';
  const singleWord = !/\s/.test(query) && /^[A-Za-z][A-Za-z'’-]*$/.test(query);
  const enrichTimeout = Math.min(tCfg.timeoutMs || 9000, 8000);
  const [dictRes, tatoebaRes, wikiRes] = await Promise.allSettled([
    enr.datamuse !== false && isEnglish && singleWord
      ? datamuseLookup(query, { timeoutMs: enrichTimeout, signal, simpleOnly: enr.simpleSynonymsOnly !== false })
      : Promise.resolve({ synonyms: [], definitions: [] }),
    enr.tatoeba !== false && enr.examples !== false && isEnglish && targetLang === 'th'
      ? tatoebaExamples(query, {
          from: sourceLang,
          to: targetLang,
          timeoutMs: enrichTimeout,
          signal,
          limit: Math.max(2, enr.exampleCount || 3),
        })
      : Promise.resolve([]),
    enr.definitions !== false && isEnglish && singleWord
      ? wiktionaryLookup(query, { timeoutMs: enrichTimeout, signal })
      : Promise.resolve({ definitions: [], examples: [], partOfSpeech: null }),
  ]);
  const dictData = dictRes.status === 'fulfilled' ? dictRes.value : { synonyms: [], definitions: [] };
  const tatoeba = tatoebaRes.status === 'fulfilled' ? tatoebaRes.value : [];
  const wiki = wikiRes.status === 'fulfilled' ? wikiRes.value : { definitions: [], examples: [], partOfSpeech: null };
  if (dictRes.status === 'rejected') warnings.push({ stage: 'datamuse', error: errText(dictRes.reason) });
  if (tatoebaRes.status === 'rejected') warnings.push({ stage: 'tatoeba', error: errText(tatoebaRes.reason) });
  if (wikiRes.status === 'rejected') warnings.push({ stage: 'wiktionary', error: errText(wikiRes.reason) });

  const result = baseResult({
    query,
    ctx,
    sourceLang,
    targetLang,
    translation,
    provider: mt?.provider || (ai ? `ai:${settings.ai.provider}` : 'unknown'),
  });

  result.aiUsed = !!ai;
  result.aiModel = ai?.model || '';
  result.literal = ai?.literal || null;
  result.reading = ai?.reading || null;
  result.partOfSpeech = ai?.partOfSpeech || wiki.partOfSpeech || null;
  result.register = ai?.register || null;
  result.contextMeaning = ai?.contextMeaning || null;
  result.memoryHook = ai?.memoryHook || null;
  result.notes = ai?.notes || null;
  result.collocations = ai?.collocations || [];

  const dictExamples = (mt?.dictionary?.entries || []).flatMap((e) => e.examples || []);
  const googleSynonyms = (mt?.dictionary?.entries || []).flatMap((e) =>
    (e.synonyms || []).map((w) => ({ word: w, level: 'normal', freq: 0 }))
  );
  result.alternatives = mergeAlternatives(ai?.alternatives, mt?.alternatives, mt?.dictionary);
  result.definitions = mergeDefinitions(ai?.definitions, mt?.dictionary, [
    ...(dictData.definitions || []),
    ...(wiki.definitions || []),
  ]);
  result.synonyms = mergeSynonyms(ai?.synonyms, dictData.synonyms, googleSynonyms, enr, query);

  // ประโยคที่ผู้ใช้กำลังอ่านอยู่นี้คือ "ตัวอย่างที่ตรงบริบทที่สุด" จึงให้ความสำคัญอันดับแรก
  const contextExample =
    enr.examples !== false ? await buildContextExample(ctx, query, { settings, sourceLang, targetLang, signal, warnings }) : null;

  result.examples = mergeExamples(
    ai?.examples,
    contextExample ? [contextExample] : [],
    tatoeba,
    dictExamples,
    wiki.examples,
    enr.exampleCount || 3
  );

  // คำเดียวที่ไม่มีบริบทเลย (เช่นแชร์คำเดียวมาจากมือถือ) มักไม่พบตัวอย่าง
  // จึงลองหาประโยคจริงของ "คำพ้อง" มาประกอบ แล้วติดป้ายกำกับให้ชัดว่าเป็นคำอื่น
  if (
    result.examples.length === 0 &&
    singleWord &&
    isEnglish &&
    targetLang === 'th' &&
    enr.tatoeba !== false &&
    enr.examples !== false
  ) {
    result.examples = await fillExamplesFromSynonyms(result.examples, result.synonyms, {
      settings,
      sourceLang,
      targetLang,
      signal,
      limit: Math.min(2, enr.exampleCount || 3),
    });
  }

  if (!ai && result.synonyms.some((s) => !s.th) && enr.synonyms !== false) {
    result.synonyms = await glossSynonyms(result.synonyms, { settings, sourceLang, targetLang, signal, warnings });
  }

  result.warnings = warnings;
  result.elapsedMs = Date.now() - started;
  await cache.cacheSet(key, result);
  return result;
}

/* ------------------------------------------------------------------ */

function baseResult({ query, ctx, sourceLang, targetLang, translation, provider }) {
  return {
    query,
    context: ctx,
    sourceLang,
    targetLang,
    translation,
    provider,
    literal: null,
    reading: null,
    partOfSpeech: null,
    register: null,
    contextMeaning: null,
    memoryHook: null,
    notes: null,
    alternatives: [],
    definitions: [],
    synonyms: [],
    examples: [],
    collocations: [],
    aiUsed: false,
    aiModel: '',
    warnings: [],
    elapsedMs: 0,
    cached: false,
    createdAt: Date.now(),
  };
}

async function runMtChain(chain, { text, from, to, settings, warnings, signal }) {
  const timeoutMs = settings.translation?.timeoutMs || 9000;
  for (const id of chain) {
    try {
      const r = await runProvider(id, { text, from, to, settings, timeoutMs, signal });
      if (r?.translation) return r;
      warnings.push({ stage: 'provider', provider: id, error: 'ไม่คืนคำแปล' });
    } catch (err) {
      warnings.push({ stage: 'provider', provider: id, error: errText(err) });
    }
  }
  return null;
}

function mergeAlternatives(aiAlts, mtAlts, mtDict) {
  const list = [];
  for (const a of aiAlts || []) list.push({ translation: a.translation, when: a.when || '' });
  for (const t of mtAlts || []) if (t && t !== '') list.push({ translation: String(t).trim(), when: '' });
  for (const e of mtDict?.entries || []) for (const t of e.terms || []) list.push({ translation: t, when: '' });
  return uniqueBy(list, (x) => x.translation).slice(0, 6);
}

function mergeDefinitions(aiDefs, mtDict, extraDefs) {
  const list = [];
  for (const d of aiDefs || []) list.push({ pos: d.pos || '', meaning: d.meaning || '', th: d.th || '' });
  for (const e of mtDict?.entries || []) {
    for (const meaning of e.definitions || []) list.push({ pos: e.pos || '', meaning, th: '' });
  }
  for (const d of extraDefs || []) list.push({ pos: d.pos || '', meaning: d.meaning || '', th: d.th || '' });
  const merged = uniqueBy(list, (x) => (x.meaning + x.th).toLowerCase());
  // ถ้าไม่มีความหมายภาษาไทยเลย (ไม่ได้ใช้ AI) ให้เหลือน้อยชิ้น เพื่อไม่ให้อ่านหนักเกินไป
  const hasThai = merged.some((d) => d.th);
  return merged.slice(0, hasThai ? 5 : 3);
}

function mergeSynonyms(aiSyn, datamuseSyn, googleSyn, enr, query = '') {
  const simpleOnly = enr.simpleSynonymsOnly !== false;
  const self = String(query).trim().toLowerCase();
  const list = [];
  for (const s of aiSyn || []) {
    list.push({ word: s.word, th: s.th || '', level: s.level || 'normal', note: s.note || '', from: 'ai' });
  }
  for (const s of datamuseSyn || []) {
    list.push({ word: s.word, th: '', level: s.level || 'normal', note: '', from: 'datamuse', freq: s.freq });
  }
  for (const s of googleSyn || []) {
    list.push({ word: s.word, th: '', level: s.level || 'normal', note: '', from: 'google', freq: s.freq || 0 });
  }
  let merged = uniqueBy(list, (x) => x.word.toLowerCase()).filter((x) => x.word.trim().toLowerCase() !== self);
  if (simpleOnly) {
    const easy = merged.filter((x) => x.level !== 'advanced');
    if (easy.length >= 4) merged = easy;
  }
  const sourceRank = { ai: 0, datamuse: 1, google: 2 };
  merged.sort((a, b) => {
    const r = (LEVEL_RANK[a.level] ?? 1) - (LEVEL_RANK[b.level] ?? 1);
    if (r !== 0) return r;
    if (a.from !== b.from) return (sourceRank[a.from] ?? 3) - (sourceRank[b.from] ?? 3);
    return (b.freq || 0) - (a.freq || 0);
  });
  return merged.slice(0, 10);
}

function mergeExamples(aiExamples, contextExamples, tatoeba, dictExamples, wikiExamples, limit) {
  const list = [];
  for (const e of aiExamples || []) list.push({ en: e.en, th: e.th || '', source: 'AI' });
  for (const e of contextExamples || []) list.push(e);
  for (const e of tatoeba || []) list.push({ en: e.en, th: e.th, source: e.source || 'Tatoeba' });
  for (const e of dictExamples || []) list.push({ en: e.en, th: e.th || '', source: 'Google' });
  for (const e of wikiExamples || []) list.push({ en: e.en, th: e.th || '', source: e.source || 'Wiktionary' });
  const clean = list.filter((e) => e.en && e.en.length < 220);
  return uniqueBy(clean, (e) => e.en.toLowerCase().trim()).slice(0, Math.max(1, limit));
}

/**
 * สร้างตัวอย่างจากประโยคที่ผู้ใช้กำลังอ่านจริง แล้วแปลเป็นไทย
 * เป็นตัวอย่างที่ตรงบริบทที่สุด จึงจัดไว้ลำดับแรก
 */
async function buildContextExample(ctx, query, { settings, sourceLang, targetLang, signal, warnings }) {
  const sentence = pickSentenceWith(ctx, query);
  if (!sentence || sentence.length < query.length + 8 || sentence.length > 300) return null;
  if (sentence.trim().toLowerCase() === query.trim().toLowerCase()) return null;
  try {
    const th = await translateText(sentence, { settings, sourceLang, targetLang, signal });
    if (!th) return null;
    return { en: sentence, th, source: 'ประโยคที่คุณอ่าน' };
  } catch (err) {
    warnings.push({ stage: 'context-example', error: errText(err) });
    return null;
  }
}

/** แปลข้อความสั้น ๆ ด้วยผู้ให้บริการตัวแรกที่ใช้ได้ (ใช้กับตัวอย่างประโยค) */
async function translateText(text, { settings, sourceLang, targetLang, signal }) {
  const chain = (settings.translation?.providers || []).filter((p) => p !== 'ai');
  const timeoutMs = Math.min(settings.translation?.timeoutMs || 9000, 8000);
  for (const id of chain.length ? chain : ['google-free', 'google-chrome-dict', 'mymemory']) {
    try {
      const r = await runProvider(id, { text, from: sourceLang, to: targetLang, settings, timeoutMs, signal });
      if (r?.translation) return r.translation;
    } catch {
      /* ลองตัวถัดไป */
    }
  }
  return '';
}

/**
 * เติมตัวอย่างประโยคจากคำพ้องความหมาย (ใช้เมื่อหาประโยคของคำตั้งต้นไม่เจอเลย)
 * ติดป้ายกำกับว่าเป็นคำอื่น เพื่อไม่ให้เข้าใจผิดว่าเป็นคำที่ค้น
 */
async function fillExamplesFromSynonyms(examples, synonyms, { settings, sourceLang, targetLang, signal, limit }) {
  const out = [...(examples || [])];
  const timeoutMs = Math.min(settings.translation?.timeoutMs || 9000, 8000);
  for (const syn of (synonyms || []).slice(0, 3)) {
    if (out.length >= limit) break;
    try {
      const found = await tatoebaExamples(syn.word, { from: sourceLang, to: targetLang, timeoutMs, signal, limit: 1 });
      for (const ex of found) {
        if (out.some((e) => e.en.toLowerCase() === ex.en.toLowerCase())) continue;
        out.push({ ...ex, source: `ตัวอย่างจากคำพ้อง (${syn.word})` });
        break;
      }
    } catch {
      /* ข้ามคำนี้ */
    }
  }
  return out.slice(0, limit);
}

/**
 * แปลคำพ้องความหมายสั้น ๆ เป็นไทย เมื่อไม่ได้ใช้ AI
 * เลือกเฉพาะคำที่มาจาก Datamuse/Google ระดับง่าย-กลาง (ไม่แปลคำที่มาจาก reverse dictionary
 * เพราะมักเป็นคำยากและแปลเดี่ยว ๆ ได้กำกวม) และจำกัดจำนวนเพื่อไม่ให้ช้า
 */
async function glossSynonyms(synonyms, { settings, sourceLang, targetLang, signal, warnings }) {
  const need = synonyms
    .filter((s) => !s.th && s.from !== 'google' && s.level !== 'advanced')
    .slice(0, 4);
  if (!need.length) return synonyms;
  const providerId = (settings.translation?.providers || ['google-free'])[0];
  const timeoutMs = Math.min(settings.translation?.timeoutMs || 9000, 7000);
  const settled = await Promise.allSettled(
    need.map((s) =>
      runProvider(providerId, { text: s.word, from: sourceLang, to: targetLang, settings, timeoutMs, signal })
    )
  );
  settled.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    const th = r.value?.translation?.trim();
    // กันผลลัพธ์ที่แปลไม่ได้จริง (คืนคำเดิม) หรือไม่มีอักษรไทย
    if (!th || th.toLowerCase() === need[i].word.toLowerCase() || !/[\u0E00-\u0E7F]/.test(th)) return;
    need[i].th = th;
  });
  return synonyms;
}

function errText(err) {
  if (!err) return 'unknown';
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'หมดเวลาเชื่อมต่อ';
  return truncate(String(err.message || err), 160);
}
