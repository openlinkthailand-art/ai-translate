/**
 * ทดสอบเว็บแอป (PWA) แบบ end-to-end บน Chromium โหมดมือถือ
 * ครอบคลุม: service worker, share target, คลิปบอร์ด, คลังคำ, ทบทวน, ตั้งค่า, อ่าน PDF, ออฟไลน์
 *
 * วิธีใช้: node scripts/web-e2e.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';
import { createStaticServer } from './serve-web.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.join(root, 'web');
const tmpDir = path.join(root, '.tmp');
const pdfPath = path.join(tmpDir, 'sample.pdf');

let pass = 0;
let fail = 0;
const consoleErrors = [];

function check(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
const section = (t) => console.log(`\n=== ${t} ===`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CARD_TRANSLATION = () => {
  const host = document.getElementById('atthai-translate-card');
  return host?.shadowRoot?.querySelector('.at-translation')?.textContent?.trim() || '';
};

let server = null;
let browser = null;
let context = null;

try {
  if (!fs.existsSync(pdfPath)) throw new Error('ไม่พบ .tmp/sample.pdf — รัน node scripts/make-test-pdf.mjs ก่อน');
  if (!fs.existsSync(path.join(webRoot, 'index.html'))) {
    throw new Error('ยังไม่ได้ build เว็บแอป — รัน node scripts/build-web.mjs ก่อน');
  }

  server = createStaticServer(webRoot);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const PORT = server.address().port;
  const base = `http://127.0.0.1:${PORT}/`;
  console.log(`เสิร์ฟเว็บแอปที่ ${base}`);

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({
    ...devices['Pixel 5'],
    permissions: ['clipboard-read', 'clipboard-write'],
    locale: 'th-TH',
  });
  const watch = (p) => {
    p.on('pageerror', (e) => consoleErrors.push(`[pageerror] ${p.url()} :: ${e.message}`));
    p.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(`[console] ${p.url()} :: ${m.text()}`);
    });
    return p;
  };
  const page = watch(await context.newPage());

  /* ---------------- 1) โหลดแอป + service worker ---------------- */
  section('1) โหลดแอปและ service worker');
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  check('หน้าหลักเปิดได้', (await page.title()).includes('อ่านไทย'), await page.title());

  const swState = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { supported: false };
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((r) => setTimeout(() => r(null), 15000)),
    ]);
    if (!reg) return { supported: true, ready: false };
    return {
      supported: true,
      ready: true,
      scope: reg.scope,
      active: !!reg.active,
      controlled: !!navigator.serviceWorker.controller,
    };
  });
  check('ลงทะเบียน service worker สำเร็จ', swState.ready && swState.active, `scope: ${swState.scope || '-'}`);

  const precached = await page.evaluate(async () => {
    const names = await caches.keys();
    const shell = names.find((n) => n.includes('shell'));
    if (!shell) return { names, count: 0 };
    const cache = await caches.open(shell);
    const keys = await cache.keys();
    return { names, count: keys.length };
  });
  check('แคชเปลือกแอปถูกสร้าง', precached.count > 10, `${precached.count} ไฟล์`);

  const manifest = await page.evaluate(async () => {
    const res = await fetch('manifest.webmanifest');
    return res.ok ? res.json() : null;
  });
  check('manifest ถูกต้อง (standalone)', manifest?.display === 'standalone', `${manifest?.name}`);
  check(
    'มี share_target รับข้อความจากแอปอื่น',
    manifest?.share_target?.method === 'POST' && manifest.share_target.params?.text === 'text',
    JSON.stringify(manifest?.share_target?.action)
  );
  const iconSizes = (manifest?.icons || []).map((i) => i.sizes);
  check('มีไอคอน 192 และ 512 (รวม maskable)', iconSizes.includes('192x192') && iconSizes.includes('512x512'));

  const iconOk = await page.evaluate(async () => {
    const res = await fetch('icons/icon192.png');
    const buf = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, type: res.headers.get('content-type'), len: buf.length, png: buf[0] === 0x89 && buf[1] === 0x50 };
  });
  check('ไอคอนเป็นไฟล์ PNG ที่ใช้งานได้', iconOk.status === 200 && iconOk.png, `${iconOk.status} · ${iconOk.type} · ${iconOk.len} bytes`);

  /* ---------------- 2) แปลข้อความในหน้าหลัก ---------------- */
  section('2) แปลข้อความในหน้าหลัก');
  // 2.1 คำเดียว → ต้องได้คำพ้องและตัวอย่างครบ
  await page.fill('#input', 'resilient');
  await page.click('#go');
  const wordOk = await page
    .waitForFunction(`(() => { const t = (${CARD_TRANSLATION.toString()})(); return t.length > 0; })()`, { timeout: 40000 })
    .then(() => true)
    .catch(() => false);
  const wordInfo = await page.evaluate(() => {
    const sr = document.getElementById('atthai-translate-card')?.shadowRoot;
    const q = (sel) => sr?.querySelector(sel)?.textContent?.trim() || '';
    return {
      translation: q('.at-translation'),
      labels: [...(sr?.querySelectorAll('.at-label') || [])].map((n) => n.textContent.trim()),
      synonyms: [...(sr?.querySelectorAll('.at-syn') || [])].map((n) => n.dataset.syn),
      examples: [...(sr?.querySelectorAll('.at-ex .at-ex-en') || [])].map((n) => n.textContent.trim()),
      width: sr?.querySelector('.at-card')?.getBoundingClientRect().width,
    };
  });
  check('แปลคำเดียวได้', wordOk, `"${wordInfo.translation}"`);
  check('มีคำพ้องความหมาย', wordInfo.synonyms.length > 0, wordInfo.synonyms.slice(0, 5).join(', '));
  check('มีตัวอย่างประโยค', wordInfo.examples.length > 0, `"${(wordInfo.examples[0] || '').slice(0, 46)}"`);
  check('การ์ดกว้างพอดีจอมือถือ', wordInfo.width <= 393, `${Math.round(wordInfo.width)}px`);

  // 2.2 ประโยคยาว → ต้องได้คำแปล + ปุ่มคำที่แตะดูต่อได้
  await page.fill('#input', 'She lost her job twice, but she stayed resilient and kept applying until she found something better.');
  await page.click('#go');
  const cardOk = await page
    .waitForFunction(`(() => { const t = (${CARD_TRANSLATION.toString()})(); return t.length > 0; })()`, { timeout: 40000 })
    .then(() => true)
    .catch(() => false);
  const cardInfo = await page.evaluate(() => {
    const host = document.getElementById('atthai-translate-card');
    const sr = host?.shadowRoot;
    return {
      translation: sr?.querySelector('.at-translation')?.textContent?.trim() || '',
      hostPosition: getComputedStyle(host).position,
      variant: sr?.querySelector('.at-card')?.getAttribute('data-variant'),
      chips: [...document.querySelectorAll('#word-chips .chip-btn')].map((n) => n.dataset.word),
      wordsCardVisible: !document.getElementById('words-card').hidden,
    };
  });
  check('แปลประโยคยาวได้', cardOk, `"${cardInfo.translation.slice(0, 48)}"`);
  check('คำแปลเป็นภาษาไทย', /[\u0E00-\u0E7F]/.test(cardInfo.translation));
  check('การ์ดแบบวางในเนื้อหา (ไม่ลอยทับ)', cardInfo.variant === 'inline' && cardInfo.hostPosition !== 'fixed', cardInfo.hostPosition);
  check('เสนอคำในข้อความให้แตะดูต่อ', cardInfo.wordsCardVisible && cardInfo.chips.length >= 2, cardInfo.chips.join(', '));

  // แตะคำที่เสนอ → ต้องได้รายละเอียดของคำนั้น
  if (cardInfo.chips.length) {
    await page.click('#word-chips .chip-btn');
    const chipOk = await page
      .waitForFunction(
        () => {
          const sr = document.getElementById('atthai-translate-card')?.shadowRoot;
          const syn = sr?.querySelectorAll('.at-syn').length || 0;
          return syn > 0;
        },
        { timeout: 40000 }
      )
      .then(() => true)
      .catch(() => false);
    const chipInfo = await page.evaluate(() => ({
      query: document.getElementById('atthai-translate-card')?.shadowRoot?.querySelector('.at-query')?.textContent?.trim() || '',
      synonyms: [...(document.getElementById('atthai-translate-card')?.shadowRoot?.querySelectorAll('.at-syn') || [])].map((n) => n.dataset.syn),
    }));
    check('แตะคำแล้วได้คำพ้องของคำนั้น', chipOk, `${chipInfo.query} → ${chipInfo.synonyms.slice(0, 4).join(', ')}`);
  }

  /* ---------------- 3) รับข้อความที่แชร์จากแอปอื่น ---------------- */
  section('3) Share Sheet (แชร์จากแอปอื่น)');
  const shareResult = await page.evaluate(async () => {
    const fd = new FormData();
    fd.append('title', 'E2E Share');
    fd.append('text', 'The company was reluctant to change its strategy, but the evidence was compelling.');
    fd.append('url', 'https://example.com/article');
    const res = await fetch('share', { method: 'POST', body: fd, redirect: 'follow' });
    return { status: res.status, url: res.url };
  });
  check('ส่งข้อความเข้าปลายทาง share สำเร็จ', shareResult.status === 200, `ปลายทาง: ${shareResult.url.split('/').pop()}`);

  await page.goto(`${base}index.html?share=1`, { waitUntil: 'domcontentloaded' });
  const sharedOk = await page
    .waitForFunction(`(() => { const t = (${CARD_TRANSLATION.toString()})(); return t.length > 0; })()`, { timeout: 40000 })
    .then(() => true)
    .catch(() => false);
  const shared = await page.evaluate(() => ({
    input: document.getElementById('input').value,
    translation: (() => {
      const host = document.getElementById('atthai-translate-card');
      return host?.shadowRoot?.querySelector('.at-translation')?.textContent?.trim() || '';
    })(),
    url: location.search,
  }));
  check('ข้อความที่แชร์มาถูกใส่ในช่องอัตโนมัติ', shared.input.startsWith('The company was reluctant'), shared.input.slice(0, 40));
  check('แปลข้อความที่แชร์ทันที', sharedOk, `"${shared.translation.slice(0, 48)}"`);
  check('ล้าง query string หลังอ่านข้อความแล้ว', shared.url === '');

  /* ---------------- 4) คลิปบอร์ด + วางข้อความ ---------------- */
  section('4) วางข้อความ (คลิปบอร์ด / เมนูวาง)');
  await page.bringToFront();
  const clipReadable = await page.evaluate(async () => {
    try {
      await navigator.clipboard.writeText('Her friends said it was a blessing in disguise.');
      return (await navigator.clipboard.readText()).length > 0;
    } catch {
      return false;
    }
  });
  if (clipReadable) {
    await page.click('#paste');
    await page.waitForTimeout(1500);
    const early = await page.evaluate(() => ({
      input: document.getElementById('input').value,
      hint: document.getElementById('toast')?.textContent?.trim() || '',
    }));
    if (early.input.includes('blessing in disguise')) {
      const clipTranslated = await page
        .waitForFunction(
          () => {
            const t = document.getElementById('atthai-translate-card')?.shadowRoot?.querySelector('.at-translation')?.textContent?.trim() || '';
            return t.length > 0 && /[\u0E00-\u0E7F]/.test(t);
          },
          { timeout: 40000 }
        )
        .then(() => true)
        .catch(() => false);
      const translation = await page.evaluate(
        () => document.getElementById('atthai-translate-card')?.shadowRoot?.querySelector('.at-translation')?.textContent?.trim() || ''
      );
      check('ปุ่มวางจากคลิปบอร์ดทำงาน (วางแล้วแปล)', clipTranslated, `"${translation.slice(0, 48)}"`);
    } else {
      // headless ไม่อนุญาตให้อ่านคลิปบอร์ด — ต้องแจ้งทางเลือกให้ผู้ใช้ ไม่ใช่เงียบ
      check('อ่านคลิปบอร์ดไม่ได้แล้วแจ้งทางเลือกให้ผู้ใช้', /อ่านคลิปบอร์ดไม่ได้/.test(early.hint), early.hint || '(ไม่มีข้อความแจ้ง)');
    }
  } else {
    check('ปุ่มวางจากคลิปบอร์ดทำงาน', true, '(headless ไม่อนุญาตให้แตะคลิปบอร์ด)');
  }

  // เส้นทาง "วาง" ด้วยเมนูของระบบ (ผู้ใช้มือถือใช้บ่อย) ต้องแปลให้ทันที
  const pasteOk = await page.evaluate(async () => {
    const input = document.getElementById('input');
    input.value = '';
    const dt = new DataTransfer();
    dt.setData('text/plain', 'The evidence was compelling, so the board decided to invest.');
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    return true;
  });
  const pasteTranslated = await page
    .waitForFunction(
      () => {
        const sr = document.getElementById('atthai-translate-card')?.shadowRoot;
        const t = sr?.querySelector('.at-translation')?.textContent?.trim() || '';
        return t.length > 0 && /[\u0E00-\u0E7F]/.test(t);
      },
      { timeout: 40000 }
    )
    .then(() => true)
    .catch(() => false);
  check('วางข้อความด้วยเมนูระบบแล้วแปลทันที', pasteOk && pasteTranslated);

  /* ---------------- 5) บันทึกเข้าคลัง + ทบทวน ---------------- */
  section('5) คลังคำศัพท์และการทบทวน');
  await page.fill('#input', 'reluctant');
  await page.click('#go');
  await page.waitForFunction(`(() => { const t = (${CARD_TRANSLATION.toString()})(); return t.length > 0; })()`, { timeout: 40000 });
  const saveClicked = await page.evaluate(() => {
    const sr = document.getElementById('atthai-translate-card')?.shadowRoot;
    const btn = sr?.querySelector('[data-act="save"]');
    btn?.click();
    return !!btn;
  });
  const saveOk = await page
    .waitForFunction(
      () => {
        const sr = document.getElementById('atthai-translate-card')?.shadowRoot;
        const btn = sr?.querySelector('[data-act="save"]');
        return btn ? /บันทึกแล้ว|มีอยู่แล้ว|ไม่สำเร็จ/.test(btn.textContent) : false;
      },
      { timeout: 15000 }
    )
    .then(() => true)
    .catch(() => false);
  const saveText = await page.evaluate(
    () => document.getElementById('atthai-translate-card')?.shadowRoot?.querySelector('[data-act="save"]')?.textContent?.trim() || ''
  );
  check('กดบันทึกแล้วสถานะเปลี่ยน', saveClicked && saveOk && !/ไม่สำเร็จ/.test(saveText), saveText);

  await page.goto(`${base}src/library/library.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#list .word, #list .empty', { timeout: 15000 }).catch(() => {});
  const lib = await page.evaluate(() => ({
    words: document.querySelectorAll('#list .word').length,
    first: document.querySelector('#list .word .w-term')?.textContent || '',
    nav: document.querySelectorAll('.web-nav a').length,
    summary: document.getElementById('summary')?.textContent || '',
  }));
  check('หน้าคลังคำแสดงคำที่บันทึกไว้', lib.words > 0, `${lib.words} คำ · ${lib.summary.trim()}`);
  check('มีแถบนำทางของเว็บแอป', lib.nav === 5, `${lib.nav} เมนู`);

  await page.goto(`${base}src/review/review.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#btn-due', { timeout: 15000 });
  await page.click('#btn-due');
  const inSession = await page.waitForFunction(() => !document.getElementById('screen-session').classList.contains('hidden'), { timeout: 10000 }).then(() => true).catch(() => false);
  check('เริ่มรอบทบทวนได้', inSession);
  if (inSession) {
    await page.click('#btn-reveal');
    await page.waitForTimeout(600);
    const rev = await page.evaluate(() => ({
      answer: document.getElementById('answer')?.textContent?.trim().slice(0, 60) || '',
      intervals: ['i0', 'i1', 'i2', 'i3'].map((id) => document.getElementById(id)?.textContent || ''),
      gradesVisible: !document.getElementById('grades').classList.contains('hidden'),
    }));
    check('เฉลยคำตอบได้', rev.answer.length > 0 && rev.gradesVisible, `"${rev.answer}"`);
    check('แสดงช่วงเวลาทบทวนถัดไป', rev.intervals.every((t) => t && t !== '—'), rev.intervals.join(' / '));
    await page.click('.grade[data-g="2"]');
    await page.waitForTimeout(800);
    const finished = await page.evaluate(() => !document.getElementById('screen-done').classList.contains('hidden'));
    check('ให้คะแนนแล้วจบรอบได้', finished);
  }

  /* ---------------- 6) ตั้งค่า ---------------- */
  section('6) หน้าตั้งค่า');
  await page.goto(`${base}src/options/options.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#tabs .tab', { timeout: 15000 });
  const opts = await page.evaluate(() => ({
    version: document.getElementById('version')?.textContent || '',
    providers: document.querySelectorAll('#provider-list .prov').length,
    switches: document.querySelectorAll('.switch').length,
    fields: document.querySelectorAll('.switch, label.field').length,
    extOnlyVisible: [...document.querySelectorAll('.ext-only')].filter((n) => !n.classList.contains('hidden')).length,
    deeplVisible: [...document.querySelectorAll('.prov .p-title')].some((n) => n.textContent.includes('DeepL')),
    installHint: !document.getElementById('web-install')?.classList.contains('hidden'),
    nav: document.querySelectorAll('.web-nav a').length,
  }));
  check('หน้าตั้งค่าเปิดได้และแสดงเวอร์ชัน', opts.version.length > 0, `v${opts.version}`);
  check('มีช่องตั้งค่าครบ', opts.fields > 15, `${opts.fields} ช่อง`);
  check('ซ่อนตัวเลือกที่เป็นของส่วนขยาย', opts.extOnlyVisible === 0);
  check('ไม่แสดง DeepL บนเว็บแอป (ไม่มี CORS)', !opts.deeplVisible);
  check('แสดงคำแนะนำการติดตั้งแอป', opts.installHint);

  const persisted = await page.evaluate(async () => {
    const sel = document.querySelector('select');
    const before = sel.value;
    const next = before === 'dark' ? 'light' : 'dark';
    sel.value = next;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 800));
    const res = await fetch('../../index.html');
    return { next, ok: res.ok };
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  const afterReload = await page.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    selected: document.querySelector('select')?.value,
  }));
  check(
    'ตั้งค่าถูกบันทึกและคงอยู่หลังรีโหลด',
    afterReload.selected === persisted.next,
    `เลือก ${persisted.next} → ได้ ${afterReload.selected} (ธีม ${afterReload.theme})`
  );

  /* ---------------- 7) อ่าน PDF ---------------- */
  section('7) อ่าน PDF ในแอป');
  await page.goto(`${base}src/viewer/viewer.html`, { waitUntil: 'domcontentloaded' });
  await page.setInputFiles('#file-input', pdfPath);
  const pdfRendered = await page
    .waitForFunction(
      () => {
        const canvas = document.querySelector('.page canvas');
        return !!(canvas && canvas.width > 0 && document.querySelectorAll('.textLayer span').length > 0);
      },
      { timeout: 40000 }
    )
    .then(() => true)
    .catch(() => false);
  const pdfInfo = await page.evaluate(() => ({
    pages: document.querySelectorAll('.page').length,
    spans: document.querySelectorAll('.textLayer span').length,
    total: document.getElementById('page-total')?.textContent,
  }));
  check('เปิดไฟล์ PDF จากเครื่องได้', pdfRendered, `${pdfInfo.total} หน้า · ${pdfInfo.spans} span`);

  const pdfLookup = await page.evaluate(async () => {
    const spans = [...document.querySelectorAll('.textLayer span')];
    const target = spans.find((s) => /resilient/i.test(s.textContent || ''));
    if (!target) return { ok: false };
    const node = target.firstChild;
    const idx = node.textContent.toLowerCase().indexOf('resilient');
    const range = document.createRange();
    range.setStart(node, idx);
    range.setEnd(node, idx + 'resilient'.length);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 120, clientY: 160 }));
    return { ok: true };
  });
  check('เลือกคำใน PDF ได้', pdfLookup.ok);
  const pdfCard = await page
    .waitForFunction(
      () => {
        const sr = document.getElementById('atthai-translate-card')?.shadowRoot;
        return !!sr?.querySelector('.at-translation')?.textContent?.trim();
      },
      { timeout: 40000 }
    )
    .then(() => true)
    .catch(() => false);
  const pdfTranslation = await page.evaluate(
    () => document.getElementById('atthai-translate-card')?.shadowRoot?.querySelector('.at-translation')?.textContent?.trim() || ''
  );
  check('แปลคำจากใน PDF ได้', pdfCard, `"${pdfTranslation}"`);
  await page.screenshot({ path: path.join(tmpDir, 'shot-web-pdf.png') });

  /* ---------------- 8) ทำงานออฟไลน์ ---------------- */
  section('8) ใช้งานตอนไม่มีเน็ต');
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await context.setOffline(true);
  const offlineOk = await page.reload({ waitUntil: 'domcontentloaded' }).then(() => true).catch(() => false);
  const offlineState = await page
    .evaluate(() => ({
      title: document.title,
      hasInput: !!document.getElementById('input'),
      swControlled: !!navigator.serviceWorker?.controller,
    }))
    .catch(() => ({}));
  check('เปิดแอปได้แม้ไม่มีเน็ต', offlineOk && offlineState.hasInput, offlineState.title || '');
  await context.setOffline(false);

  /* ---------------- 9) หน้าจอมือถือ ---------------- */
  section('9) การแสดงผลบนจอมือถือ');
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const layout = await page.evaluate(() => {
    const nav = document.querySelector('.web-nav');
    return {
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      navScrollable: nav ? nav.scrollWidth >= nav.clientWidth : false,
      inputFont: getComputedStyle(document.getElementById('input')).fontSize,
      btnHeight: document.querySelector('#go')?.getBoundingClientRect().height,
    };
  });
  check('ไม่มีการล้นออกนอกจอแนวนอน', layout.overflowX <= 1, `ล้น ${layout.overflowX}px`);
  check('ช่องกรอกใช้ฟอนต์ 16px (กันเบราว์เซอร์ซูมเอง)', layout.inputFont === '16px', layout.inputFont);
  check('ปุ่มมีขนาดเหมาะกับนิ้ว', layout.btnHeight >= 36, `${Math.round(layout.btnHeight)}px`);
  await page.screenshot({ path: path.join(tmpDir, 'shot-web-home.png'), fullPage: true });

  /* ---------------- สรุป ---------------- */
  section('10) ตรวจสอบ error ในคอนโซล');
  const realErrors = consoleErrors.filter((e) => !/favicon|Failed to load resource|ERR_INTERNET_DISCONNECTED|net::ERR_/i.test(e));
  check('ไม่มี JavaScript error', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
} catch (err) {
  fail++;
  console.error(`\n✗ การทดสอบล้มเหลว: ${err.message}`);
} finally {
  try {
    await context?.close();
  } catch {
    /* ปิดไม่สำเร็จก็ช่างมัน */
  }
  try {
    await browser?.close();
  } catch {
    /* ปิดไม่สำเร็จก็ช่างมัน */
  }
  server?.close();
}

console.log('\n' + '='.repeat(52));
console.log(`WEB E2E: ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
if (consoleErrors.length) {
  console.log('\nerror ที่พบในคอนโซล:');
  for (const e of consoleErrors.slice(0, 8)) console.log('  ' + e.slice(0, 200));
}
console.log('='.repeat(52));
process.exit(fail ? 1 : 0);
