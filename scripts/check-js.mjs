/**
 * ตรวจ syntax ของไฟล์ JavaScript ทั้งหมด (ES modules) และความถูกต้องของ manifest.json
 * ใช้ `node --check` ซึ่งตรวจ syntax โดยไม่รันโค้ด (จึงไม่พังเพราะไม่มี chrome/document)
 * วิธีใช้: node scripts/check-js.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = [
  path.join(root, 'extension', 'src'),
  path.join(root, 'scripts'),
  path.join(root, 'desktop'),
  path.join(root, 'web'),
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.m?js$/.test(entry.name)) out.push(full);
  }
  return out;
}

let failed = 0;
const files = targets
  .flatMap((t) => walk(t))
  .filter((f) => !f.includes(`${path.sep}.tmp${path.sep}`))
  .filter((f) => !f.includes(`${path.sep}node_modules${path.sep}`))
  .filter((f) => !f.includes(`${path.sep}dist${path.sep}`))
  .filter((f) => !f.includes(`${path.sep}vendor${path.sep}`));

for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log(`✓ ${path.relative(root, file)}`);
  } catch (err) {
    failed++;
    const msg = (err.stderr?.toString() || err.message).split('\n').slice(0, 6).join('\n   ');
    console.error(`✗ ${path.relative(root, file)}\n   ${msg}`);
  }
}

/* ---- ตรวจ manifest.json ---- */
const manifestPath = path.join(root, 'extension', 'manifest.json');
try {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const required = ['manifest_version', 'name', 'version', 'background', 'action', 'content_scripts'];
  const missing = required.filter((k) => !(k in manifest));
  if (missing.length) {
    failed++;
    console.error(`✗ manifest.json ขาดคีย์: ${missing.join(', ')}`);
  } else if (manifest.manifest_version !== 3) {
    failed++;
    console.error('✗ manifest.json ต้องเป็น manifest_version 3');
  } else {
    console.log('✓ manifest.json (โครงสร้างถูกต้อง)');
  }

  const refs = [
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    manifest.options_page,
    ...(manifest.content_scripts || []).flatMap((cs) => cs.js || []),
    ...Object.values(manifest.icons || {}),
  ].filter(Boolean);
  let missingFiles = 0;
  for (const ref of refs) {
    if (!fs.existsSync(path.join(root, 'extension', ref))) {
      failed++;
      missingFiles++;
      console.error(`✗ manifest อ้างไฟล์ที่ไม่มีอยู่: ${ref}`);
    }
  }
  if (!missingFiles) console.log(`✓ ไฟล์ที่ manifest อ้างถึงมีครบ (${refs.length} ไฟล์)`);

  // ตรวจว่า resource ที่ web_accessible_resources ประกาศไว้ครอบคลุมโมดูลที่โหลดด้วย dynamic import
  const war = (manifest.web_accessible_resources || []).flatMap((w) => w.resources || []);
  const needed = ['src/ui/*', 'src/common/*'];
  for (const n of needed) {
    if (!war.includes(n)) {
      failed++;
      console.error(`✗ web_accessible_resources ไม่ได้ประกาศ ${n} (content script จะโหลดโมดูลไม่ได้)`);
    }
  }
} catch (err) {
  failed++;
  console.error(`✗ อ่าน manifest.json ไม่ได้: ${err.message}`);
}

/* ---- ตรวจ manifest ของเว็บแอป (PWA) ---- */
const webManifestPath = path.join(root, 'web', 'manifest.webmanifest');
if (fs.existsSync(webManifestPath)) {
  try {
    const wm = JSON.parse(fs.readFileSync(webManifestPath, 'utf8'));
    const problems = [];
    if (wm.display !== 'standalone') problems.push('display ต้องเป็น standalone');
    if (!wm.start_url) problems.push('ขาด start_url');
    if (!wm.icons?.some((i) => i.sizes === '192x192')) problems.push('ขาดไอคอน 192x192');
    if (!wm.icons?.some((i) => i.sizes === '512x512')) problems.push('ขาดไอคอน 512x512');
    if (!wm.icons?.some((i) => (i.purpose || '').includes('maskable'))) problems.push('ขาดไอคอนแบบ maskable');
    if (wm.share_target?.method !== 'POST') problems.push('share_target ต้องใช้ method POST');
    if (wm.share_target?.params?.text !== 'text') problems.push('share_target ต้องรับพารามิเตอร์ text');
    for (const icon of wm.icons || []) {
      if (!fs.existsSync(path.join(root, 'web', icon.src))) problems.push(`ไม่พบไฟล์ไอคอน ${icon.src}`);
    }
    if (problems.length) {
      failed += problems.length;
      for (const p of problems) console.error(`✗ web/manifest.webmanifest: ${p}`);
    } else {
      console.log('✓ web/manifest.webmanifest (PWA + share_target ครบถ้วน)');
    }
    if (!fs.existsSync(path.join(root, 'web', 'sw.js'))) {
      failed++;
      console.error('✗ ไม่พบ web/sw.js (จำเป็นสำหรับ share_target และโหมดออฟไลน์)');
    }
  } catch (err) {
    failed++;
    console.error(`✗ อ่าน web/manifest.webmanifest ไม่ได้: ${err.message}`);
  }
}

/* ---- ตรวจว่าไฟล์ที่ใช้ร่วมกันใน web/src ไม่ค้างเก่า ---- */
const buildInfoPath = path.join(root, 'web', 'build-info.json');
if (fs.existsSync(buildInfoPath)) {
  try {
    const { expectedHash } = await import('./lib/transform.mjs');
    const info = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
    const stale = [];
    for (const rel of Object.keys(info.files || {})) {
      const copyFile = path.join(root, 'web', 'src', rel);
      const srcFile = path.join(root, 'extension', 'src', rel);
      if (!fs.existsSync(copyFile)) {
        stale.push(`${rel} (ไม่มีไฟล์ปลายทาง)`);
        continue;
      }
      if (!fs.existsSync(srcFile)) {
        stale.push(`${rel} (ไม่มีไฟล์ต้นฉบับ)`);
        continue;
      }
      // คำนวณค่าที่ควรจะเป็นจาก "ต้นฉบับปัจจุบัน" เสมอ
      // จึงจับได้ทั้งการแก้ไฟล์ปลายทางโดยตรง และการแก้ต้นฉบับแล้วลืม build
      const expected = expectedHash(fs.readFileSync(srcFile, 'utf8'), rel);
      const copyHash = crypto.createHash('sha1').update(fs.readFileSync(copyFile)).digest('hex').slice(0, 12);
      if (copyHash !== expected) stale.push(rel);
    }
    if (stale.length) {
      failed++;
      console.error(`✗ web/src ค้างเก่า ${stale.length} ไฟล์ (รัน npm run build:web): ${stale.slice(0, 4).join(', ')}`);
    } else {
      console.log(`✓ web/src ตรงกับต้นฉบับใน extension/src (${Object.keys(info.files || {}).length} ไฟล์)`);
    }
  } catch (err) {
    failed++;
    console.error(`✗ ตรวจความสอดคล้องของ web/src ไม่ได้: ${err.message}`);
  }
}

console.log(failed ? `\nพบปัญหา ${failed} จุด` : '\nทุกไฟล์ผ่านการตรวจสอบ');
process.exit(failed ? 1 : 0);
