/**
 * สร้างตัวติดตั้งแอป Windows (.exe) จาก web/ ด้วย Electron + electron-builder
 * ขั้นตอน: build:web → electron-builder (NSIS) → คัดลอกไป dist/atthai-windows-<เวอร์ชัน>-setup.exe
 *
 * วิธีใช้: node scripts/build-win.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const winDir = path.join(root, 'windows');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8'));

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) {
    console.error(`✗ คำสั่งล้มเหลว: ${cmd} ${args.join(' ')}`);
    process.exit(1);
  }
}

// 1) ประกอบ web/ ใหม่ให้ตรงกับต้นฉบับ
run(process.execPath, [path.join(root, 'scripts', 'build-web.mjs')]);

// 2) ติดตั้ง dependency ของ windows/ ถ้ายังไม่มี
if (!fs.existsSync(path.join(winDir, 'node_modules'))) {
  run('cmd.exe', ['/c', 'npm', 'install'], { cwd: winDir });
}

// 3) แพ็กตัวติดตั้ง (เซ็นด้วยใบรับรองไม่ได้ ถ้าไม่มี — Windows SmartScreen จะเตือนว่าไม่รู้จักผู้เผยแพร่)
run(process.execPath, [path.join(winDir, 'node_modules', 'electron-builder', 'cli.js'), '--win', 'nsis', '--x64'], {
  cwd: winDir,
});

const built = fs.readdirSync(path.join(winDir, 'dist')).find((f) => f.endsWith('.exe') && /setup/i.test(f));
if (!built) {
  console.error('✗ electron-builder จบแล้วแต่ไม่พบตัวติดตั้ง .exe ใน windows/dist');
  process.exit(1);
}
const distDir = path.join(root, 'dist');
fs.mkdirSync(distDir, { recursive: true });
const out = path.join(distDir, `atthai-windows-${manifest.version}-setup.exe`);
fs.copyFileSync(path.join(winDir, 'dist', built), out);
console.log(`✓ ได้ไฟล์ ${out} (${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB)`);
