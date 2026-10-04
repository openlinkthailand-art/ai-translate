/**
 * ประกอบเว็บแอป (PWA) จาก "ต้นฉบับชุดเดียว" กับส่วนขยาย
 * คัดลอกโค้ดที่ใช้ร่วมกันจาก extension/src มาที่ web/src แล้วสร้างไฟล์ที่เว็บต้องมีเอง
 * (config, ไอคอน, precache-manifest) — แก้ที่เดียวจึงมีผลทั้งสองที่
 *
 * วิธีใช้: node scripts/build-web.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { writeWebIcons } from './make-icons.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const extDir = path.join(root, 'extension');
const webDir = path.join(root, 'web');

/** โฟลเดอร์/ไฟล์ที่คัดลอกจากส่วนขยายมาใช้ร่วมกัน (เว้น popup เพราะเป็นของเบราว์เซอร์เท่านั้น) */
const SHARED = ['common', 'core', 'ui', 'viewer', 'library', 'review', 'options'];

/** ไฟล์ที่เว็บเป็นเจ้าของเอง ห้ามทับด้วยของส่วนขยาย */
const WEB_OWNED = new Set(['config.js', 'app']);

/** ไฟล์ที่ไม่ต้องแคชไว้ล่วงหน้า (แคชเมื่อเปิดใช้ครั้งแรก) */
const PRECACHE_SKIP = /^vendor\//;

const manifest = JSON.parse(fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf8'));
const VERSION = manifest.version;

/* ------------------------------------------------------------------ */
/* 1) ล้างโฟลเดอร์ src ของเว็บ (เก็บไฟล์ที่เว็บเป็นเจ้าของ)               */
/* ------------------------------------------------------------------ */

const webSrc = path.join(webDir, 'src');
if (fs.existsSync(webSrc)) {
  for (const entry of fs.readdirSync(webSrc)) {
    if (WEB_OWNED.has(entry)) continue;
    fs.rmSync(path.join(webSrc, entry), { recursive: true, force: true });
  }
}
fs.mkdirSync(webSrc, { recursive: true });

/* ------------------------------------------------------------------ */
/* 2) คัดลอกโค้ดที่ใช้ร่วมกัน                                            */
/* ------------------------------------------------------------------ */

function copyDir(from, to, { skip = () => false } = {}) {
  fs.mkdirSync(to, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (skip(entry.name, src)) continue;
    if (entry.isDirectory()) count += copyDir(src, dst, { skip });
    else {
      fs.copyFileSync(src, dst);
      count += 1;
    }
  }
  return count;
}

let copied = 0;
for (const dir of SHARED) {
  const from = path.join(extDir, 'src', dir);
  if (!fs.existsSync(from)) continue;
  copied += copyDir(from, path.join(webSrc, dir), {
    skip: (name) => name === 'config.js' || name === 'popup.html' || name === 'popup.js',
  });
}

/* pdf.js: วางไว้ที่ web/vendor/pdfjs เพื่อให้ path สัมพันธ์ของ viewer.html ใช้ได้เหมือนส่วนขยาย */
const pdfSrc = path.join(extDir, 'vendor', 'pdfjs');
const pdfDst = path.join(webDir, 'vendor', 'pdfjs');
if (fs.existsSync(pdfSrc)) {
  fs.rmSync(pdfDst, { recursive: true, force: true });
  copied += copyDir(pdfSrc, pdfDst);
}

/* ------------------------------------------------------------------ */
/* 3) สร้างไฟล์ config ของเว็บ                                          */
/* ------------------------------------------------------------------ */

const configJs = `/**
 * ค่าประจำสภาพแวดล้อม — "เว็บแอป/PWA"
 * ไฟล์นี้ถูกสร้างโดย scripts/build-web.mjs — ห้ามแก้ด้วยมือ (แก้ที่ต้นฉบับแล้วรัน build ใหม่)
 */
globalThis.__ATTHAI_CONFIG__ = {
  env: 'web',
  version: ${JSON.stringify(VERSION)},
  builtAt: ${JSON.stringify(new Date().toISOString())},
  pdfWorkerUrl: '../../vendor/pdfjs/pdf.worker.min.js',
  cMapUrl: '../../vendor/pdfjs/cmaps/',
  standardFontDataUrl: '../../vendor/pdfjs/standard_fonts/',
};
`;
fs.writeFileSync(path.join(webSrc, 'config.js'), configJs);

/* ------------------------------------------------------------------ */
/* 4) ไอคอนของเว็บ                                                     */
/* ------------------------------------------------------------------ */

const icons = writeWebIcons(path.join(webDir, 'icons'));

/* ------------------------------------------------------------------ */
/* 5) precache-manifest.json ให้ service worker                        */
/* ------------------------------------------------------------------ */

function walk(dir, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

const allFiles = walk(webDir).filter((f) => !f.startsWith('icons/') || f.endsWith('.png'));
const precache = allFiles
  .filter((f) => !f.startsWith('dist/'))
  .filter((f) => !PRECACHE_SKIP.test(f))
  .filter((f) => !/\.(zip|md|map|log)$/.test(f))
  .filter((f) => f !== 'precache-manifest.json' && f !== 'sw.js' && f !== 'build-info.json');

const precachePath = path.join(webDir, 'precache-manifest.json');
fs.writeFileSync(
  precachePath,
  JSON.stringify({ version: VERSION, builtAt: new Date().toISOString(), count: precache.length, files: precache }, null, 2)
);

/* ------------------------------------------------------------------ */
/* 6) build-info.json สำหรับตรวจว่า build ค้างเก่าหรือไม่                 */
/* ------------------------------------------------------------------ */

const hash = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 12);
const sources = {};
for (const dir of SHARED) {
  const from = path.join(extDir, 'src', dir);
  if (!fs.existsSync(from)) continue;
  for (const rel of walk(from)) {
    if (rel === 'config.js') continue;
    const srcFile = path.join(from, rel);
    const dstFile = path.join(webSrc, dir, rel);
    sources[`${dir}/${rel}`] = {
      src: hash(srcFile),
      copy: fs.existsSync(dstFile) ? hash(dstFile) : null,
    };
  }
}
const outOfSync = Object.entries(sources).filter(([, v]) => v.src !== v.copy).map(([k]) => k);

fs.writeFileSync(
  path.join(webDir, 'build-info.json'),
  JSON.stringify({ version: VERSION, builtAt: new Date().toISOString(), copied, files: sources }, null, 2)
);

/* ------------------------------------------------------------------ */
console.log(`ประกอบเว็บแอปเสร็จ (เวอร์ชัน ${VERSION})`);
console.log(`  คัดลอกโค้ดที่ใช้ร่วมกัน ${copied} ไฟล์ → web/src`);
console.log(`  ไอคอน ${icons.length} ไฟล์ → web/icons`);
console.log(`  รายการแคชล่วงหน้า ${precache.length} ไฟล์ → web/precache-manifest.json`);
if (outOfSync.length) {
  console.error(`  ✗ พบไฟล์ที่ไม่ตรงกับต้นฉบับ ${outOfSync.length} รายการ: ${outOfSync.slice(0, 5).join(', ')}`);
  process.exit(1);
}
console.log('  ✓ ทุกไฟล์ตรงกับต้นฉบับใน extension/src');
