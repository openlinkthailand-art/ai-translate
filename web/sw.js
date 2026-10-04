/**
 * Service worker ของเว็บแอป
 *  1) ทำให้เปิดแอปได้แม้ไม่มีเน็ต (แคชเปลือกแอป)
 *  2) รับข้อความที่ผู้ใช้ "แชร์" จากแอปอื่น (share target) แล้วส่งต่อให้หน้าหลัก
 */
const CACHE = 'atthai-shell-v1';
const SHARE_CACHE = 'atthai-share';
const SHARE_KEY = './share-data';
const SCOPE = self.registration.scope;

/* ------------------------------------------------------------------ */
/* ติดตั้ง: แคชเปลือกแอปตามรายการที่ build สร้างไว้                       */
/* ------------------------------------------------------------------ */

self.addEventListener('install', (event) => {
  event.waitUntil(precache());
});

async function precache() {
  const cache = await caches.open(CACHE);
  let files = ['index.html', 'manifest.webmanifest'];
  try {
    const res = await fetch(new Request('precache-manifest.json', { cache: 'no-store' }));
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.files) && data.files.length) files = data.files;
    }
  } catch {
    /* ใช้รายการเริ่มต้น */
  }
  await Promise.all(
    files.map(async (file) => {
      try {
        const url = new URL(file, SCOPE).href;
        const res = await fetch(new Request(url, { cache: 'reload' }));
        if (res.ok) await cache.put(url, res);
      } catch {
        /* ไฟล์ใดโหลดไม่ได้ก็ข้ามไป ไม่ให้การติดตั้งล้มเหลว */
      }
    })
  );
  await self.skipWaiting();
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE && k !== SHARE_CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

/* ------------------------------------------------------------------ */
/* ดักคำขอ                                                             */
/* ------------------------------------------------------------------ */

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1) ข้อความที่แชร์เข้ามา (POST จากระบบปฏิบัติการ)
  if (req.method === 'POST' && url.pathname.replace(/\/+$/, '').endsWith('/share')) {
    event.respondWith(handleShare(req));
    return;
  }

  // 2) คำขอไปยังบริการภายนอก (Google, Datamuse, AI ฯลฯ) ปล่อยผ่านไม่แตะ
  if (url.origin !== self.location.origin) return;
  if (req.method !== 'GET') return;

  // favicon: ตอบจากแคช เพื่อไม่ให้เกิด 404 รบกวนในคอนโซล
  if (url.pathname.endsWith('/favicon.ico')) {
    event.respondWith(faviconResponse());
    return;
  }

  // 3) เปิดหน้าใหม่ → ใช้เน็ตก่อน ถ้าไม่มีเน็ตใช้แคช
  if (req.mode === 'navigate') {
    event.respondWith(handleNavigate(req));
    return;
  }

  // 4) ไฟล์ในแอป → ใช้แคชก่อน
  event.respondWith(cacheFirst(req));
});

async function faviconResponse() {
  const cache = await caches.open(CACHE);
  const icon = (await cache.match(new URL('icons/icon192.png', SCOPE).href)) || (await cache.match(new URL('icons/favicon.png', SCOPE).href));
  if (icon) return icon;
  return fetch(new URL('icons/favicon.png', SCOPE).href).catch(() => new Response('', { status: 404 }));
}

async function handleShare(req) {
  try {
    const form = await req.formData();
    const data = {
      title: String(form.get('title') || ''),
      text: String(form.get('text') || ''),
      url: String(form.get('url') || ''),
      at: Date.now(),
    };
    const cache = await caches.open(SHARE_CACHE);
    await cache.put(SHARE_KEY, new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }));
  } catch {
    /* อ่านไม่ได้ก็ยังพาไปหน้าหลัก */
  }
  return Response.redirect(new URL('index.html?share=1', SCOPE).href, 303);
}

async function handleNavigate(req) {
  try {
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(CACHE);
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch {
    const cached = await caches.match(req);
    if (cached) return cached;
    const shell = await caches.match(new URL('index.html', SCOPE).href);
    if (shell) return shell;
    return new Response('ออฟไลน์ และยังไม่มีข้อมูลในแคช', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') {
      const cache = await caches.open(CACHE);
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch {
    return new Response('', { status: 504 });
  }
}
