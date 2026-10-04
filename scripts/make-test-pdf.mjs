/**
 * สร้างไฟล์ PDF ตัวอย่างสำหรับทดสอบตัวอ่าน (ไม่ต้องพึ่ง library ภายนอก)
 * วิธีใช้: node scripts/make-test-pdf.mjs [จำนวนหน้า]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pages = Number(process.argv[2] || 3);
const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.tmp', 'sample.pdf');

const LINES = [
  'Chapter 1 - The Resilient Reader',
  '',
  'She lost her job twice, but she stayed resilient and kept',
  'applying until she found something better. Her friends said',
  'it was a blessing in disguise.',
  '',
  'Reading English books is one of the best ways to build',
  'vocabulary. When you meet a new word, look it up in context,',
  'write down one example, and review it tomorrow.',
  '',
  'The company was reluctant to change its strategy, even though',
  'the evidence was compelling. Eventually, the board decided to',
  'take a leap of faith and invest in the new technology.',
];

const escapeText = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

function contentFor(pageIndex) {
  const ops = ['BT', '/F1 13 Tf', '72 720 Td', '16 TL'];
  for (const line of LINES) ops.push(`(${escapeText(line)}) Tj T*`);
  ops.push('/F1 10 Tf', 'T*', 'T*', `(page ${pageIndex} of ${pages}) Tj`, 'ET');
  return ops.join('\n');
}

const objects = [];
const addObj = (body) => {
  objects.push(body);
  return objects.length; // หมายเลข object
};

const catalogId = addObj(null); // จะเติมทีหลัง
const pagesId = addObj(null);
const fontId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

const pageIds = [];
for (let i = 1; i <= pages; i++) {
  const content = contentFor(i);
  const streamId = addObj(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  pageIds.push(
    addObj(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${streamId} 0 R >>`
    )
  );
}

objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages} >>`;

let pdf = '%PDF-1.4\n';
const offsets = [0];
objects.forEach((body, i) => {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
});
const xrefOffset = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (let i = 1; i <= objects.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, pdf, 'latin1');
console.log(`สร้างไฟล์ทดสอบแล้ว: ${outPath} (${pages} หน้า, ${pdf.length} bytes)`);
