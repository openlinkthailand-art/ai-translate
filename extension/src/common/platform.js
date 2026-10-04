/**
 * ชั้นแยกสภาพแวดล้อม (platform) — จุดเดียวในโปรเจกต์ที่โค้ดรับรู้ว่ากำลังรันอยู่ที่ไหน
 *
 *   extension  = ส่วนขยาย Chrome (service worker / content script / หน้าเว็บของส่วนขยาย)
 *   web        = เว็บแอป / PWA บนมือถือ (ไม่มีการข้าม CORS จึงต้องใช้ endpoint ที่มี CORS)
 *   headless   = รันใน Node เพื่อทดสอบ (ใช้ chrome.storage ที่ถูกจำลองไว้)
 *
 * ทุกโมดูลอื่นเรียกผ่าน getPlatform() เท่านั้น จึงไม่ต้องมีโค้ดสองชุด
 */

const EXT_PAGES = {
  home: 'src/options/options.html',
  options: 'src/options/options.html',
  library: 'src/library/library.html',
  review: 'src/review/review.html',
  viewer: 'src/viewer/viewer.html',
};

const WEB_PAGES = {
  home: 'index.html',
  options: 'src/options/options.html',
  library: 'src/library/library.html',
  review: 'src/review/review.html',
  viewer: 'src/viewer/viewer.html',
};

let impl = null;

/** ใช้ในกรณีที่ต้องการบังคับ platform (เช่นตอนทดสอบ) */
export function setPlatform(platform) {
  impl = platform;
  return impl;
}

export function getPlatform() {
  if (!impl) impl = detect();
  return impl;
}

export function isExtension() {
  return getPlatform().name === 'extension';
}

export function isWeb() {
  return getPlatform().name === 'web';
}

/** เวอร์ชันของแอปในสภาพแวดล้อมปัจจุบัน (ส่วนขยายอ่านจาก manifest, เว็บแอปอ่านจาก config) */
export function appVersion() {
  return globalThis.__ATTHAI_CONFIG__?.version || '1.0.0';
}

/** ชื่อสภาพแวดล้อมที่อ่านง่าย สำหรับแสดงในหน้าจอ */
export function envLabel() {
  const env = getPlatform().name;
  if (env === 'extension') return 'ส่วนขยายเบราว์เซอร์';
  if (env === 'web') return 'เว็บแอป (มือถือ)';
  return 'ทดสอบ';
}

function detect() {
  const c = globalThis.chrome;
  if (c?.storage?.local) {
    // หน้าเว็บของส่วนขยายมี runtime.getURL, ส่วน service worker/การทดสอบใน Node ไม่มี
    return c.runtime?.getURL ? extensionPlatform(c) : headlessPlatform(c);
  }
  return webPlatform();
}

/* ------------------------------------------------------------------ */
/* ส่วนขยาย Chrome                                                     */
/* ------------------------------------------------------------------ */

function extensionPlatform(c) {
  const pagePath = (page) => EXT_PAGES[page] || EXT_PAGES.home;
  return {
    name: 'extension',
    isExtension: true,
    storage: chromeStorage(c),
    send: (msg) => sendViaChrome(c, msg),
    url: (p) => c.runtime.getURL(p),
    async openPage(page, query) {
      const url = c.runtime.getURL(pagePath(page)) + (query ? `?${query}` : '');
      if (c.tabs?.create) await c.tabs.create({ url });
      else await sendViaChrome(c, { type: 'openPage', page, query });
    },
    onStorageChanged(cb) {
      const handler = (changes, area) => {
        if (area !== 'local') return;
        cb(Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.newValue])));
      };
      c.storage.onChanged.addListener(handler);
      return () => c.storage.onChanged.removeListener(handler);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Node (ทดสอบ) / service worker ที่ไม่มี runtime.getURL               */
/* ------------------------------------------------------------------ */

function headlessPlatform(c) {
  return {
    name: 'headless',
    isExtension: false,
    storage: chromeStorage(c),
    async send(msg) {
      const { handleMessage } = await import('../core/router.js');
      return handleMessage(msg, {});
    },
    url: (p) => p,
    async openPage() {
      /* ไม่มีแท็บให้เปิดในบริบทนี้ */
    },
    onStorageChanged(cb) {
      if (!c.storage?.onChanged) return () => {};
      const handler = (changes, area) => {
        if (area !== 'local') return;
        cb(Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.newValue])));
      };
      c.storage.onChanged.addListener(handler);
      return () => c.storage.onChanged.removeListener(handler);
    },
  };
}

/* ------------------------------------------------------------------ */
/* เว็บแอป / PWA                                                       */
/* ------------------------------------------------------------------ */

function webPlatform() {
  return {
    name: 'web',
    isExtension: false,
    storage: webStorage(),
    async send(msg) {
      const { handleMessage } = await import('../core/router.js');
      return handleMessage(msg, {
        url: globalThis.location?.href || '',
        title: globalThis.document?.title || '',
      });
    },
    url: (p) => new URL(p, globalThis.location?.href || 'http://localhost/').href,
    async openPage(page, query) {
      const target = WEB_PAGES[page] || WEB_PAGES.home;
      const base = new URL(target, globalThis.location?.href || 'http://localhost/');
      if (query) base.search = query;
      globalThis.location.href = base.href;
    },
    onStorageChanged(cb) {
      const handler = (e) => cb({ [e.detail.key]: e.detail.value });
      globalThis.addEventListener('atthai:storage', handler);
      return () => globalThis.removeEventListener('atthai:storage', handler);
    },
  };
}

function sendViaChrome(c, msg) {
  return new Promise((resolve, reject) => {
    c.runtime.sendMessage(msg, (res) => {
      if (c.runtime.lastError) return reject(new Error(c.runtime.lastError.message));
      if (!res) return reject(new Error('ไม่ได้รับการตอบกลับจากส่วนขยาย'));
      if (res.ok) return resolve(res.data);
      return reject(new Error(res.error || 'เกิดข้อผิดพลาด'));
    });
  });
}

/* ------------------------------------------------------------------ */
/* ที่เก็บข้อมูล                                                        */
/* ------------------------------------------------------------------ */

function chromeStorage(c) {
  return {
    async get(keys) {
      const stored = await c.storage.local.get(keys ?? null);
      return stored || {};
    },
    async set(obj) {
      await c.storage.local.set(obj);
    },
    async remove(keys) {
      await c.storage.local.remove(keys);
    },
    async clear() {
      await c.storage.local.clear();
    },
  };
}

/**
 * ที่เก็บข้อมูลของเว็บแอป — ใช้ IndexedDB เป็นหลัก (ไม่ติดเพดาน 5MB ของ localStorage)
 * ถ้า IndexedDB ใช้ไม่ได้จะถอยไปใช้ localStorage แล้วถอยไปใช้หน่วยความจำ
 */
function webStorage() {
  const DB_NAME = 'atthai_kv';
  const STORE = 'kv';
  const LS_PREFIX = 'atthai:';
  const memory = new Map();
  let dbp = null;
  let backend = null; // 'idb' | 'ls' | 'mem'

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) return reject(new Error('ไม่มี indexedDB'));
      const req = globalThis.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('เปิด IndexedDB ไม่ได้'));
    });
    return dbp;
  }

  async function pick() {
    if (backend) return backend;
    try {
      await open();
      backend = 'idb';
    } catch {
      try {
        globalThis.localStorage.setItem(`${LS_PREFIX}__probe`, '1');
        globalThis.localStorage.removeItem(`${LS_PREFIX}__probe`);
        backend = 'ls';
      } catch {
        backend = 'mem';
      }
    }
    return backend;
  }

  const idbReq = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  };

  const lsKeys = () =>
    Object.keys(globalThis.localStorage)
      .filter((k) => k.startsWith(LS_PREFIX))
      .map((k) => k.slice(LS_PREFIX.length));

  return {
    async get(keys) {
      const mode = await pick();
      const wanted = keys == null ? null : Array.isArray(keys) ? keys : [keys];
      if (mode === 'idb') {
        const list = wanted ?? (await idbReq('readonly', (s) => s.getAllKeys()));
        const values = await Promise.all(list.map((k) => idbReq('readonly', (s) => s.get(k))));
        const out = {};
        list.forEach((k, i) => {
          if (values[i] !== undefined) out[k] = values[i];
        });
        return out;
      }
      if (mode === 'ls') {
        const list = wanted ?? lsKeys();
        const out = {};
        for (const k of list) {
          const raw = globalThis.localStorage.getItem(LS_PREFIX + k);
          if (raw != null) {
            try {
              out[k] = JSON.parse(raw);
            } catch {
              out[k] = raw;
            }
          }
        }
        return out;
      }
      const list = wanted ?? [...memory.keys()];
      const out = {};
      for (const k of list) if (memory.has(k)) out[k] = memory.get(k);
      return out;
    },

    async set(obj) {
      const mode = await pick();
      if (mode === 'idb') {
        const db = await open();
        await new Promise((resolve, reject) => {
          const t = db.transaction(STORE, 'readwrite');
          const store = t.objectStore(STORE);
          for (const [k, v] of Object.entries(obj)) store.put(v, k);
          t.oncomplete = () => resolve();
          t.onerror = () => reject(t.error);
        });
      } else if (mode === 'ls') {
        for (const [k, v] of Object.entries(obj)) {
          try {
            globalThis.localStorage.setItem(LS_PREFIX + k, JSON.stringify(v));
          } catch {
            /* ที่เต็ม — ข้ามไป */
          }
        }
      } else {
        for (const [k, v] of Object.entries(obj)) memory.set(k, v);
      }
      for (const [k, v] of Object.entries(obj)) {
        globalThis.dispatchEvent?.(new CustomEvent('atthai:storage', { detail: { key: k, value: v } }));
      }
    },

    async remove(keys) {
      const mode = await pick();
      const list = Array.isArray(keys) ? keys : [keys];
      if (mode === 'idb') {
        const db = await open();
        await new Promise((resolve, reject) => {
          const t = db.transaction(STORE, 'readwrite');
          const store = t.objectStore(STORE);
          for (const k of list) store.delete(k);
          t.oncomplete = () => resolve();
          t.onerror = () => reject(t.error);
        });
      } else if (mode === 'ls') {
        for (const k of list) globalThis.localStorage.removeItem(LS_PREFIX + k);
      } else {
        for (const k of list) memory.delete(k);
      }
    },

    async clear() {
      const mode = await pick();
      if (mode === 'idb') {
        const db = await open();
        await new Promise((resolve, reject) => {
          const t = db.transaction(STORE, 'readwrite');
          t.objectStore(STORE).clear();
          t.oncomplete = () => resolve();
          t.onerror = () => reject(t.error);
        });
      } else if (mode === 'ls') {
        for (const k of lsKeys()) globalThis.localStorage.removeItem(LS_PREFIX + k);
      } else {
        memory.clear();
      }
    },
  };
}
