/**
 * Smoke test — ตรวจว่าท่อการแปลจริงทำงานได้ (ยิง API จริง)
 * วิธีใช้: node scripts/smoke-test.mjs
 * หมายเหตุ: ต้องต่ออินเทอร์เน็ต · บางเครือข่ายอาจบล็อก endpoint ของ Google (จะรายงานเป็นคำเตือน ไม่ถือว่าไม่ผ่าน)
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);

/* ---------------- stub chrome.storage.local ---------------- */
const store = new Map();
globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => {
        if (keys == null) return Object.fromEntries(store);
        const list = Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const k of list) if (store.has(k)) out[k] = store.get(k);
        return out;
      },
      set: async (obj) => {
        for (const [k, v] of Object.entries(obj)) store.set(k, v);
      },
      remove: async (keys) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
      },
    },
  },
};

const { DEFAULT_SETTINGS } = await load('extension/src/common/constants.js');
const util = await load('extension/src/common/util.js');
const { truncate } = util;
const { runProvider } = await load('extension/src/core/providers.js');
const { datamuseLookup, tatoebaExamples, wiktionaryLookup } = await load('extension/src/core/dictionary.js');
const { translateQuery } = await load('extension/src/core/translate-service.js');
const { parseGoogleDict, normalizeAiResult } = { ...(await load('extension/src/core/providers.js')), ...(await load('extension/src/core/ai.js')) };

let pass = 0;
let fail = 0;
const warnings = [];

function check(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

const settings = structuredClone(DEFAULT_SETTINGS);
settings.translation.providers = ['google-free', 'google-chrome-dict', 'mymemory'];
settings.translation.timeoutMs = 12000;
settings.enrichment.tatoeba = true;
settings.enrichment.datamuse = true;

/* ---------------- 1. ฟังก์ชันช่วยเหลือ ---------------- */
section('1) ฟังก์ชันช่วยเหลือ (util)');
check('detectLang ภาษาไทย', util.detectLang('สวัสดีครับ') === 'th');
check('detectLang ภาษาอังกฤษ', util.detectLang('hello world') === 'en');
check('detectLang ภาษาจีน', util.detectLang('你好世界') === 'zh');
check('cleanWord ตัดเครื่องหมาย', util.cleanWord('“Resilient,”') === 'Resilient', util.cleanWord('“Resilient,”'));
check('normalizeQuery ยุบช่องว่าง', util.normalizeQuery('  hello   world  ') === 'hello world');
const ctx = util.pickContext('The cat sat on the mat. She is resilient in hard times. Next sentence here.', 'resilient', 200);
check('pickContext เลือกประโยคที่มีคำเป้าหมาย', ctx.includes('resilient'), ctx.slice(0, 60));
check('parseJsonLoose อ่าน JSON ที่ห่อด้วย ```', util.parseJsonLoose('```json\n{"a":1}\n```').a === 1);
check('parseJsonLoose อ่าน JSON ที่มีข้อความปน', util.parseJsonLoose('นี่คือผลลัพธ์ {"a":2} ครับ').a === 2);
check('hashKey คงที่', util.hashKey('abc') === util.hashKey('abc') && util.hashKey('abc') !== util.hashKey('abd'));

/* ---------------- 2. ตัวแยกข้อมูลพจนานุกรม ---------------- */
section('2) ตัวแยกข้อมูล (parser)');
const fakeGoogle = [
  [['ยืดหยุ่น', 'resilient', null, null, 10]],
  [
    [
      'adjective',
      ['ยืดหยุ่น', 'คืนกลับ', 'ฟื้นคืนสภาพ'],
      [
        ['ยืดหยุ่น', ['resilient', 'limber', 'springy'], [['She stayed resilient.', 'เธอยังคงยืดหยุ่น']], 0.616],
        ['คืนกลับ', ['resilient']],
        ['ฟื้นคืนสภาพ', ['resilient']],
      ],
      'resilient',
      3,
    ],
  ],
  'en',
];
const dict = parseGoogleDict(fakeGoogle[1]);
check('parseGoogleDict ได้ชนิดคำ', dict.entries[0]?.pos === 'adjective', dict.entries[0]?.pos);
check('parseGoogleDict ได้คำแปลอื่น (terms)', (dict.entries[0]?.terms || []).includes('ยืดหยุ่น'), (dict.entries[0]?.terms || []).join(', '));
check('parseGoogleDict ได้คำพ้องภาษาอังกฤษ', (dict.entries[0]?.synonyms || []).includes('limber'), (dict.entries[0]?.synonyms || []).join(', '));
check('parseGoogleDict ได้ตัวอย่างประโยค', (dict.entries[0]?.examples || []).some((e) => e.en.includes('resilient')));
check(
  'parseGoogleDict ไม่เอา "คำแปล" มาเป็น "ความหมาย"',
  (dict.entries[0]?.definitions || []).length === 0,
  (dict.entries[0]?.definitions || []).join(' | ')
);
check('parseGoogleDict ทนข้อมูลพังได้', parseGoogleDict(null).entries.length === 0 && parseGoogleDict([1, 'x']).entries.length === 0);

const aiNorm = normalizeAiResult({
  translation: 'ยืดหยุ่น',
  synonyms: ['tough', { word: 'strong', th: 'แข็งแรง', level: 'easy' }],
  examples: [{ en: 'He is resilient.', th: 'เขาเป็นคนยืดหยุ่น' }],
  memoryHook: 'คิดถึงยางที่เด้งกลับ',
  definitions: 'should be wrapped',
});
check('normalizeAiResult รองรับ synonym แบบ string', aiNorm.synonyms.length === 2);
check('normalizeAiResult จัดระดับคำง่าย', aiNorm.synonyms.find((s) => s.word === 'strong')?.level === 'easy');
check('normalizeAiResult ได้ตัวอย่าง', aiNorm.examples[0]?.th === 'เขาเป็นคนยืดหยุ่น');
check('normalizeAiResult ห่อ definition ที่เป็น string ให้อัตโนมัติ', aiNorm.definitions.length === 1 && aiNorm.definitions[0].meaning.includes('wrapped'));

/* ---------------- 3. ผู้ให้บริการแปล (ยิงจริง) ---------------- */
section('3) ผู้ให้บริการแปล (เรียก API จริง)');
for (const id of ['google-chrome-dict', 'mymemory', 'google-free']) {
  try {
    const r = await runProvider(id, { text: 'resilient', from: 'en', to: 'th', settings, timeoutMs: 12000 });
    check(`${id} แปลได้`, !!r.translation, `"${r.translation}"`);
  } catch (err) {
    if (id === 'google-free') {
      warnings.push(`google-free ใช้ไม่ได้จากเครือข่ายนี้ (${err.message}) — ในเบราว์เซอร์ผู้ใช้มักใช้ได้ และมีตัวสำรองอยู่แล้ว`);
      console.log(`  ! google-free: ${err.message} (คำเตือน)`);
    } else {
      check(`${id} แปลได้`, false, err.message);
    }
  }
}

/* ---------------- 4. ข้อมูลเสริม ---------------- */
section('4) ข้อมูลเสริม (Datamuse / Tatoeba)');
const dm = await datamuseLookup('resilient', { limit: 10 }).catch((e) => ({ error: e.message }));
check('Datamuse ให้คำพ้อง', (dm.synonyms || []).length > 0, (dm.synonyms || []).slice(0, 6).map((s) => s.word).join(', '));
check('Datamuse เรียงคำง่ายก่อน', (dm.synonyms || [])[0]?.level === 'easy' || (dm.synonyms || [])[0]?.level === 'normal');
check('Datamuse ให้ความหมาย', (dm.definitions || []).length > 0, (dm.definitions || [])[0]?.meaning?.slice(0, 60));

const tb = await tatoebaExamples('happy', { limit: 3 }).catch((e) => []);
check('Tatoeba ให้ตัวอย่างประโยค', tb.length > 0, tb[0] ? `"${tb[0].en}" → "${tb[0].th}"` : '');
check('Tatoeba มีคำแปลไทยทุกประโยค', tb.every((t) => t.th && /[\u0E00-\u0E7F]/.test(t.th)));

const wiki = await wiktionaryLookup('resilient', {}).catch((e) => ({ error: e.message }));
check('Wiktionary ให้ชนิดคำ', !!wiki.partOfSpeech, wiki.partOfSpeech);
check('Wiktionary ให้ความหมาย', (wiki.definitions || []).length > 0, (wiki.definitions || [])[0]?.meaning?.slice(0, 60));
check('Wiktionary ตัด HTML ออกแล้ว', !(wiki.definitions || []).some((d) => /<[a-z]/i.test(d.meaning)));

/* ---------------- 5. ท่อการแปลเต็มรูปแบบ ---------------- */
section('5) ท่อการแปลเต็มรูปแบบ (translateQuery)');
try {
  const res = await translateQuery({
    text: 'resilient',
    context: 'She lost her job twice but stayed resilient and kept applying until she found something better.',
    settings,
  });
  check('ได้คำแปล', !!res.translation, `"${res.translation}"`);
  check('ได้คำพ้องความหมาย', (res.synonyms || []).length > 0, (res.synonyms || []).slice(0, 6).map((s) => s.word).join(', '));
  check('มีตัวอย่างประโยค', (res.examples || []).length > 0, `${(res.examples || []).length} ประโยค`);
  check('ตัวอย่างมีคำแปลไทย', (res.examples || []).some((e) => /[\u0E00-\u0E7F]/.test(e.th || '')));
  check(
    'ตัวอย่างแรกคือประโยคที่ผู้ใช้กำลังอ่าน',
    (res.examples || [])[0]?.source === 'ประโยคที่คุณอ่าน' && res.examples[0].en.includes('resilient'),
    `"${truncate((res.examples || [])[0]?.en || '', 60)}"`
  );
  check('รู้จักชนิดคำ', !!res.partOfSpeech, res.partOfSpeech || '(ว่าง)');
  check('มีความหมายให้อ่าน', (res.definitions || []).length > 0, `${(res.definitions || []).length} ความหมาย`);
  check('ระบุผู้ให้บริการที่ใช้', !!res.provider, res.provider);
  check('บันทึกบริบทที่ส่งไป', res.context.includes('resilient'));

  const again = await translateQuery({
    text: 'resilient',
    context: 'She lost her job twice but stayed resilient and kept applying until she found something better.',
    settings,
  });
  check('แคชทำงาน (ครั้งที่สองเร็วและติดธง cached)', again.cached === true);

  const phrase = await translateQuery({ text: 'a blessing in disguise', context: '', settings });
  check('แปลวลี/สำนวนได้', !!phrase.translation, `"${phrase.translation}"`);

  const longText = 'Reading English books is one of the best ways to build vocabulary. '.repeat(6);
  const longRes = await translateQuery({ text: longText, context: '', settings, mode: 'fast' });
  check('แปลข้อความยาวได้', !!longRes.translation, `${longRes.translation.length} ตัวอักษร`);

  const th = await translateQuery({ text: 'สวัสดีครับ', context: '', settings });
  check('ข้อความภาษาไทยไม่ถูกแปลซ้ำ', th.translation === 'สวัสดีครับ' && th.warnings.length > 0);
} catch (err) {
  check('ท่อการแปลเต็มรูปแบบ', false, err.message);
}

/* ---------------- สรุป ---------------- */
console.log('\n' + '='.repeat(52));
console.log(`ผลการทดสอบ: ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
if (warnings.length) {
  console.log('\nคำเตือน:');
  for (const w of warnings) console.log('  ! ' + w);
}
console.log('='.repeat(52));
process.exit(fail ? 1 : 0);
