/**
 * สร้างไอคอน PNG (ไม่ต้องพึ่ง library ภายนอก)
 * ใช้ได้ทั้งไอคอนส่วนขยายและไอคอนแอปมือถือ (รวมแบบ maskable สำหรับ Android)
 *
 * วิธีใช้: node scripts/make-icons.mjs
 * หรือเรียกจากสคริปต์อื่น: import { renderIconPng } from './make-icons.mjs'
 */
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SS = 4; // supersampling

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** ระยะห่างจากขอบของสี่เหลี่ยมมุมมน (ค่าลบ = อยู่ข้างใน) */
function roundRectSdf(x, y, left, top, right, bottom, radius) {
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const hw = (right - left) / 2 - radius;
  const hh = (bottom - top) / 2 - radius;
  const dx = Math.abs(x - cx) - hw;
  const dy = Math.abs(y - cy) - hh;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius;
}

/**
 * วาดไอคอนที่ขนาด size*SS แล้วย่อลงมาเพื่อให้ขอบเนียน
 * @param {number} size ขนาดที่ต้องการ (พิกเซล)
 * @param {{maskable?: boolean}} [opts] maskable = พื้นเต็มจอ + ย่อภาพเข้าขอบปลอดภัย 72%
 */
export function renderIconPng(size, { maskable = false } = {}) {
  const S = size * SS;
  const acc = new Float64Array(size * size * 4);
  const px = new Float64Array(S * S * 4);
  const shrink = 0.72;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S;
      const v = (y + 0.5) / S;
      // พิกัดสำหรับวาดรูปทรง (โหมด maskable จะย่อเข้าหาศูนย์กลาง)
      const au = maskable ? 0.5 + (u - 0.5) / shrink : u;
      const av = maskable ? 0.5 + (v - 0.5) / shrink : v;

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      const bgSdf = maskable ? -1 : roundRectSdf(au, av, 0.02, 0.02, 0.98, 0.98, 0.24);
      const bgA = clamp01(0.5 - bgSdf * S * 0.5 + 0.5);
      if (bgA > 0) {
        const t = clamp01(v * 0.9 + u * 0.1);
        r = lerp(0x0f, 0x2d, t);
        g = lerp(0x76, 0xd4, t);
        b = lerp(0x6e, 0xbf, t);
        a = bgA;
      }

      // หน้าเอกสารสีขาว
      const docA = clamp01(0.5 - roundRectSdf(au, av, 0.24, 0.19, 0.76, 0.81, 0.07) * S * 0.5 + 0.5);
      if (docA > 0) {
        r = lerp(r, 255, docA);
        g = lerp(g, 255, docA);
        b = lerp(b, 255, docA);
        a = Math.max(a, docA);
      }

      // เส้นข้อความ 3 เส้น
      for (const [x1, x2, yy, h] of [
        [0.34, 0.665, 0.335, 0.055],
        [0.34, 0.665, 0.455, 0.055],
        [0.34, 0.55, 0.575, 0.055],
      ]) {
        const la = clamp01(0.5 - roundRectSdf(au, av, x1, yy, x2, yy + h, h / 2) * S * 0.5 + 0.5);
        if (la > 0) {
          r = lerp(r, 0x0d, la);
          g = lerp(g, 0x94, la);
          b = lerp(b, 0x88, la);
        }
      }

      // จุดเน้นสีส้ม
      const dotA = clamp01(0.5 - (Math.hypot(au - 0.665, av - 0.3) - 0.045) * S * 0.5 + 0.5);
      if (dotA > 0) {
        r = lerp(r, 0xf5, dotA);
        g = lerp(g, 0x9e, dotA);
        b = lerp(b, 0x0b, dotA);
      }

      const i = (y * S + x) * 4;
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = a * 255;
    }
  }

  // box filter downsample
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * S + (x * SS + sx)) * 4;
          r += px[i];
          g += px[i + 1];
          b += px[i + 2];
          a += px[i + 3];
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      acc[o] = r / n;
      acc[o + 1] = g / n;
      acc[o + 2] = b / n;
      acc[o + 3] = a / n;
    }
  }

  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    out[i * 4] = Math.round(acc[i * 4]);
    out[i * 4 + 1] = Math.round(acc[i * 4 + 1]);
    out[i * 4 + 2] = Math.round(acc[i * 4 + 2]);
    out[i * 4 + 3] = Math.round(acc[i * 4 + 3]);
  }
  return encodePng(size, size, out);
}

/** เขียนไฟล์ไอคอนชุดของส่วนขยาย */
export function writeExtensionIcons(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const size of [16, 32, 48, 128]) {
    const file = path.join(outDir, `icon${size}.png`);
    fs.writeFileSync(file, renderIconPng(size));
    written.push(file);
  }
  return written;
}

/** เขียนไฟล์ไอคอนชุดของเว็บแอป (รวม maskable + apple-touch) */
export function writeWebIcons(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const plan = [
    ['icon192.png', 192, false],
    ['icon512.png', 512, false],
    ['icon192-maskable.png', 192, true],
    ['icon512-maskable.png', 512, true],
    ['apple-touch-icon.png', 180, true],
    ['favicon.png', 64, false],
  ];
  const written = [];
  for (const [name, size, maskable] of plan) {
    const file = path.join(outDir, name);
    fs.writeFileSync(file, renderIconPng(size, { maskable }));
    written.push(file);
  }
  return written;
}

/* ทำงานเมื่อถูกเรียกจากบรรทัดคำสั่ง */
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const files = writeExtensionIcons(path.join(HERE, '..', 'extension', 'assets'));
  for (const f of files) console.log(`✓ ${path.relative(path.join(HERE, '..'), f)} (${fs.statSync(f).size} bytes)`);
}
