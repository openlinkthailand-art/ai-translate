/**
 * เซิร์ฟเวอร์สำหรับพัฒนา/ทดสอบเว็บแอป
 * - http://localhost = secure context จึงใช้ Service Worker และติดตั้งเป็นแอปได้
 * - เปิดให้เครื่องอื่นในวง LAN เข้าถึงได้ด้วย (สำหรับทดสอบบนมือถือ ต้องเปิด flag ของ Chrome ดูคำแนะนำท้ายข้อความ)
 *
 * วิธีใช้: node scripts/serve-web.mjs [--port 8080]
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const portArg = process.argv.indexOf('--port');
const PORT = portArg > -1 ? Number(process.argv[portArg + 1]) : 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const server = createStaticServer(root);

/** สร้างเซิร์ฟเวอร์ไฟล์นิ่งของโฟลเดอร์ web/ (ให้สคริปต์ทดสอบนำไปใช้ได้) */
export function createStaticServer(webRoot) {
  return http.createServer((req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      const filePath = path.join(webRoot, rel);

      // กันการเข้าถึงไฟล์นอกโฟลเดอร์
      if (!filePath.startsWith(webRoot)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`ไม่พบไฟล์: ${rel}`);
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const body = fs.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': body.length,
        // ไม่แคชตอนพัฒนา เพื่อให้เห็นการแก้ไขทันที (service worker จัดการแคชของแอปเอง)
        'Cache-Control': 'no-store',
        'Service-Worker-Allowed': '/',
      });
      res.end(body);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end(String(err.message));
    }
  });
}

const isCli = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));

if (isCli) {
  server.listen(PORT, '0.0.0.0', () => {
    const nets = Object.values(os.networkInterfaces())
      .flat()
      .filter((n) => n && n.family === 'IPv4' && !n.internal)
      .map((n) => n.address);
    console.log('เว็บแอปพร้อมใช้งาน:');
    console.log(`  บนเครื่องนี้ : http://localhost:${PORT}/`);
    for (const ip of nets) console.log(`  ในวง LAN    : http://${ip}:${PORT}/`);
    console.log('');
    console.log('หมายเหตุ: การติดตั้งเป็นแอปและ Share Sheet ต้องเป็น HTTPS (หรือ localhost)');
    console.log('  · ทดสอบบนมือถือผ่าน LAN ให้เปิด chrome://flags/#unsafely-treat-insecure-origin-as-secure');
    console.log('    แล้วใส่ URL ของ LAN ข้างบน จากนั้นรีสตาร์ท Chrome');
    console.log('  · ใช้งานจริงควรอัปโหลดโฟลเดอร์ web/ ขึ้นโฮสต์ฟรีที่มี HTTPS (ดู docs/MOBILE.md)');
  });
}
