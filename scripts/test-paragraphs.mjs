/**
 * ทดสอบตัวแยกย่อหน้าของโหมดอ่าน + การหาคำในคลัง + การ normalize ผลสรุปจาก AI (รันใน Node ไม่ต้องมีเน็ต)
 * วิธีใช้: node scripts/test-paragraphs.mjs
 */
import { extractParagraphs, markKnownWords } from '../extension/src/viewer/paragraphs.js';
import { normalizeDigest } from '../extension/src/core/ai.js';

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** สร้าง item แบบที่ pdf.js คืนมา: บรรทัดละ item ห่างกัน 16pt ขนาด 13pt */
function itemsFrom(lines, { size = 13, lead = 16, x = 72, top = 720, charW = 6.5 } = {}) {
  return lines.map((text, i) => ({
    str: text,
    transform: [size, 0, 0, size, typeof text === 'object' ? text.x : x, top - i * lead],
    width: String(text).length * charW,
    height: size,
    hasEOL: true,
  }));
}

console.log('=== แยกย่อหน้า ===');
{
  const paras = extractParagraphs(
    itemsFrom([
      'Chapter 1 - The Resilient Reader',
      '',
      'She lost her job twice, but she stayed resilient and kept',
      'applying until she found something better. Her friends said',
      'it was a blessing in disguise.',
      '',
      'Reading English books is one of the best ways to build',
      'vocabulary. When you meet a new word, look it up in context,',
      'write down one example, and review it tomorrow.',
    ])
  );
  check('บรรทัดว่างคั่น → แยกเป็น 3 ย่อหน้า', paras.length === 3, JSON.stringify(paras));
  check('ต่อบรรทัดในย่อหน้าเดียวกันด้วยช่องว่าง', paras[1] === 'She lost her job twice, but she stayed resilient and kept applying until she found something better. Her friends said it was a blessing in disguise.', paras[1]);
}
{
  const paras = extractParagraphs(itemsFrom(['The evidence was compel-', 'ling, so the board agreed.']));
  check('ตัดยัติภังค์ท้ายบรรทัด (compel-/ling → compelling)', paras[0] === 'The evidence was compelling, so the board agreed.', paras[0]);
}
{
  const paras = extractParagraphs(itemsFrom(['Well-known authors write a lot. They also read a', 'lot.', 'Then a new paragraph starts here and keeps going', 'on the next line.']));
  check('บรรทัดสั้นที่จบประโยค → ขึ้นย่อหน้าใหม่ แม้ไม่มีบรรทัดว่าง', paras.length === 2, JSON.stringify(paras));
}
{
  const items = [
    { str: 'Hello', transform: [12, 0, 0, 12, 72, 700], width: 28, height: 12 },
    { str: 'world', transform: [12, 0, 0, 12, 104, 700], width: 30, height: 12, hasEOL: true },
  ];
  check('item แยกในบรรทัดเดียวกันที่มีระยะห่าง → ใส่ช่องว่าง', extractParagraphs(items)[0] === 'Hello world', extractParagraphs(items)[0]);
}
check('ข้อมูลเสีย/ว่าง → คืน []', extractParagraphs(null).length === 0 && extractParagraphs([{}, { str: null }]).length === 0);

console.log('\n=== คำในคลัง ===');
{
  const known = new Set(['resilient', 'apply', 'book', 'decide']);
  const parts = markKnownWords('She stayed Resilient, kept applying, read books and decided.', known);
  const hits = parts.filter((p) => p.known).map((p) => `${p.text}→${p.known}`);
  check('เจอคำผัน: Resilient, applying, books, decided', hits.join(',') === 'Resilient→resilient,applying→apply,books→book,decided→decide', hits.join(','));
  check('ต่อชิ้นกลับแล้วได้ข้อความเดิม', parts.map((p) => p.text).join('') === 'She stayed Resilient, kept applying, read books and decided.');
  check('คลังว่าง → ไม่ไฮไลต์', markKnownWords('abc def', new Set()).length === 1);
}

console.log('\n=== normalize ผลสรุปจาก AI ===');
{
  const d = normalizeDigest({
    summary: ['ข้อ 1', '', 'ข้อ 2'],
    quiz: [
      { question: 'Q1', choices: ['a', 'b', 'c', 'd'], answer: 2, explain: 'เพราะ…' },
      { question: 'Q2', choices: ['a'], answer: 0 },
      { question: 'Q3', choices: ['a', 'b'], answer: 5 },
      { question: 'Q4', options: ['x', 'y', 'z'], answer: 'B' },
    ],
  });
  check('ตัดข้อสรุปว่างทิ้ง', d.summary.length === 2);
  check('ตัดคำถามที่ตัวเลือก < 2 หรือเฉลยเกินช่วง', d.quiz.length === 2, JSON.stringify(d.quiz));
  check('รับเฉลยเป็นตัวอักษร (B → 1) และ field ชื่อ options', d.quiz[1]?.answer === 1 && d.quiz[1]?.choices.length === 3);
  const empty = normalizeDigest('not json');
  check('ข้อมูลเสีย → summary/quiz ว่าง ไม่ throw', Array.isArray(empty.summary) && empty.quiz.length === 0);
}

console.log(`\nผ่าน ${pass} / ${pass + fail}`);
if (fail) process.exit(1);
