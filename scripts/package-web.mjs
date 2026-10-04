/**
 * แพ็กเว็บแอปเป็น ZIP สำหรับอัปโหลดขึ้นโฮสต์ฟรี (GitHub Pages / Netlify Drop / Cloudflare Pages)
 * วิธีใช้: node scripts/package-web.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const webDir = path.join(root, 'web');
const distDir = path.join(root, 'dist');

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

function zip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name.replace(/\\/g, '/'), 'utf8');
    const crc = crc32(e.data);
    const deflated = zlib.deflateRawSync(e.data, { level: 9 });
    const useDeflate = deflated.length < e.data.length;
    const body = useDeflate ? deflated : e.data;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(e.data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuf, end]);
}

function walk(dir, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel));
    else out.push({ name: rel, data: fs.readFileSync(path.join(dir, entry.name)) });
  }
  return out;
}

if (!fs.existsSync(path.join(webDir, 'index.html'))) {
  console.error('ยังไม่ได้ build เว็บแอป — รัน node scripts/build-web.mjs ก่อน');
  process.exit(1);
}

const version = JSON.parse(fs.readFileSync(path.join(webDir, 'precache-manifest.json'), 'utf8')).version || '1.0.0';
const files = walk(webDir).filter((f) => !/\.(map|log)$/.test(f.name));
const outFile = path.join(distDir, `atthai-web-${version}.zip`);
fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(outFile, zip(files));

const rawSize = files.reduce((n, f) => n + f.data.length, 0);
console.log(`แพ็กเว็บแอปสำเร็จ: ${path.relative(root, outFile)}`);
console.log(`  ไฟล์ ${files.length} ไฟล์ · ขนาดรวม ${(rawSize / 1048576).toFixed(2)} MB · ไฟล์ zip ${(fs.statSync(outFile).size / 1048576).toFixed(2)} MB`);
console.log('\nวิธีเอาไปใช้บนมือถือ: แตกไฟล์ ZIP แล้วอัปโหลดโฟลเดอร์ขึ้นโฮสต์ที่มี HTTPS (ดู docs/MOBILE.md)');
