/**
 * การแปลงไฟล์ตอน build เว็บแอป — ใช้ร่วมกันระหว่าง build-web.mjs และ check-js.mjs
 * เพื่อให้ "ไฟล์ที่คัดลอกมา" ตรวจความไม่ตรงกับต้นฉบับได้แม้ถูกแปลงเล็กน้อย
 *
 * เหตุผลของการแปลง: หน้าเว็บที่คัดลอกมาจากส่วนขยายไม่มี <link rel="icon">
 * ทำให้เบราว์เซอร์ขอ /favicon.ico ที่ระดับรากโดเมน ซึ่งอยู่นอก scope ของ service worker
 * และได้ 404 (เห็นเป็น error ในคอนโซล) จึงเติมลิงก์ไอคอนให้ตอน build
 */
import crypto from 'node:crypto';

export const TRANSFORM_ID = 'inject-icons-v1';

/** หน้าที่ถูกแปลงคือไฟล์ .html ที่คัดลอกมา (ไม่รวม index.html ที่เว็บเขียนเอง) */
export function transformIdFor(relPath) {
  return relPath.endsWith('.html') ? TRANSFORM_ID : '';
}

/**
 * เติมลิงก์ไอคอนตามความลึกของโฟลเดอร์
 * relPath เป็นพาธเทียบกับ web/src เช่น 'viewer/viewer.html'
 * ไฟล์อยู่ที่ web/src/viewer/viewer.html จึงต้องถอยขึ้น 2 ระดับ (src → web) เพื่อถึง web/icons
 */
export function transformHtml(content, relPath) {
  if (!content.includes('</head>') || content.includes('rel="icon"')) return content;
  const depth = relPath.split('/').length;
  const base = '../'.repeat(depth);
  const links = [
    `<link rel="icon" type="image/png" href="${base}icons/favicon.png" />`,
    `<link rel="apple-touch-icon" href="${base}icons/apple-touch-icon.png" />`,
  ].join('\n  ');
  return content.replace('</head>', `  ${links}\n</head>`);
}

/** ค่าแฮชของไฟล์ปลายทางที่ควรจะเป็น (หลังแปลงแล้ว) */
export function expectedHash(content, relPath) {
  const id = transformIdFor(relPath);
  const finalContent = id ? transformHtml(content, relPath) : content;
  return crypto.createHash('sha1').update(finalContent).digest('hex').slice(0, 12);
}

export function fileHash(buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 12);
}
