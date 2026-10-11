/**
 * สร้างไฟล์ APK (Android) จาก web/ ด้วย Capacitor
 * ขั้นตอน: build:web → cap sync → gradle assembleDebug → คัดลอกไป dist/atthai-android-<เวอร์ชัน>.apk
 * ลงชื่อด้วย debug key (ติดตั้งในเครื่องตัวเองได้ ยังไม่ใช่ไฟล์สำหรับขึ้น Play Store)
 *
 * วิธีใช้: node scripts/build-apk.mjs
 * ต้องมี JDK 21+ (หาจาก JAVA_HOME หรือ D:/Tools/jdk-21) และ Android SDK (ANDROID_HOME หรือ %LOCALAPPDATA%/Android/Sdk)
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = path.join(root, 'android');
const nativeDir = path.join(androidDir, 'android');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8'));

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) fail(`คำสั่งล้มเหลว: ${cmd} ${args.join(' ')}`);
}

/** หา JDK 21+ (Capacitor 7 บังคับ) — ไม่ใช้ Java 8 ที่อยู่ใน PATH ของระบบ เพราะ Gradle รุ่นปัจจุบันรันไม่ได้ */
function findJdk() {
  const candidates = [process.env.JAVA_HOME, 'D:/Tools/jdk-21'].filter(Boolean);
  for (const dir of candidates) {
    const java = path.join(dir, 'bin', 'java.exe');
    if (!fs.existsSync(java)) continue;
    const out = spawnSync(java, ['-version'], { encoding: 'utf8' });
    const m = /version "(\d+)/.exec(`${out.stderr}${out.stdout}`);
    if (m && Number(m[1]) >= 21) return dir;
  }
  return null;
}

function findSdk() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk'),
  ].filter(Boolean);
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'platforms'))) || null;
}

const jdk = findJdk();
if (!jdk) fail('ไม่พบ JDK 21 ขึ้นไป — ตั้ง JAVA_HOME หรือติดตั้งไว้ที่ D:/Tools/jdk-21');
const sdk = findSdk();
if (!sdk) fail('ไม่พบ Android SDK — ตั้ง ANDROID_HOME หรือติดตั้ง Android Studio');
console.log(`JDK: ${jdk}\nSDK: ${sdk}`);

const env = { ...process.env, JAVA_HOME: jdk, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk };

// 1) ประกอบ web/ ใหม่ให้ตรงกับต้นฉบับ
run(process.execPath, [path.join(root, 'scripts', 'build-web.mjs')]);

// 2) ติดตั้ง dependency ของ android/ ถ้ายังไม่มี
if (!fs.existsSync(path.join(androidDir, 'node_modules'))) {
  run('cmd.exe', ['/c', 'npm', 'install'], { cwd: androidDir, env });
}

// 3) บอก Gradle ว่า SDK อยู่ที่ไหน (ไฟล์นี้ถูก gitignore)
fs.writeFileSync(path.join(nativeDir, 'local.properties'), `sdk.dir=${sdk.replace(/\\/g, '/')}\n`, 'utf8');

// 4) คัดลอก web/ เข้าโปรเจกต์ native
run(process.execPath, [path.join(androidDir, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor'), 'sync', 'android'], {
  cwd: androidDir,
  env,
});

// 5) Gradle → APK
run('cmd.exe', ['/c', path.join(nativeDir, 'gradlew.bat'), 'assembleDebug'], { cwd: nativeDir, env });

const built = path.join(nativeDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
if (!fs.existsSync(built)) fail(`Gradle จบแล้วแต่ไม่พบไฟล์ ${built}`);

const distDir = path.join(root, 'dist');
fs.mkdirSync(distDir, { recursive: true });
const out = path.join(distDir, `atthai-android-${manifest.version}.apk`);
fs.copyFileSync(built, out);
console.log(`✓ ได้ไฟล์ ${out} (${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB)`);
