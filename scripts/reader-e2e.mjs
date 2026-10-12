/**
 * ทดสอบ "โหมดอ่าน" ของตัวอ่าน PDF บน Chromium จริง (จอคอม 1280 และจอมือถือ Pixel 5)
 * ครอบคลุม: แยกย่อหน้า, ขนาดตัวอักษร/ระยะบรรทัด/ความกว้าง (จำค่าไว้), แถบบรรทัด, แปลคู่ทีละย่อหน้า,
 * ไฮไลต์คำในคลัง, แตะคำเพื่อแปล, AI สรุป + คำถาม (ผ่านเซิร์ฟเวอร์ AI จำลองในเครื่อง), เปลี่ยนหน้า
 *
 * วิธีใช้: node scripts/reader-e2e.mjs   (ต้อง build:web และมี .tmp/sample.pdf ก่อน · การแปลต้องมีเน็ต)
 */
import fs from 'node:fs';
import http from 'node:http';
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
const THAI = /[฀-๿]/;

/* เซิร์ฟเวอร์ AI จำลอง (รูปแบบ OpenAI /chat/completions) — ใช้ตรวจท่อส่ง/การแสดงผล ไม่ได้ตรวจคุณภาพของ AI จริง */
const aiRequests = [];
const fakeAi = http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    aiRequests.push(body);
    const content = JSON.stringify({
      summary: ['เธอตกงานสองครั้งแต่ไม่ยอมแพ้', 'การอ่านหนังสือช่วยเพิ่มคำศัพท์'],
      quiz: [
        { question: 'เธอทำอย่างไรหลังตกงาน?', choices: ['เลิกหางาน', 'สมัครงานต่อไป', 'ย้ายประเทศ', 'กลับไปเรียน'], answer: 1, explain: 'ข้อความบอกว่า "kept applying"' },
        { question: 'วิธีเพิ่มคำศัพท์ที่ดีคืออะไร?', choices: ['ท่องพจนานุกรม', 'อ่านหนังสืออังกฤษ', 'ดูหนัง', 'เล่นเกม'], answer: 1, explain: '"Reading English books"' },
        { question: 'บริษัทลังเลเรื่องอะไร?', choices: ['เปลี่ยนกลยุทธ์', 'จ้างคน', 'ขายบริษัท', 'ย้ายสำนักงาน'], answer: 0, explain: '"reluctant to change its strategy"' },
      ],
    });
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
});

let server = null;
let browser = null;

async function openReaderPage(context, base) {
  const page = await context.newPage();
  page.on('pageerror', (e) => consoleErrors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`[console] ${m.text()}`);
  });
  await page.goto(`${base}src/viewer/viewer.html`, { waitUntil: 'domcontentloaded' });
  await page.setInputFiles('#file-input', pdfPath);
  await page.waitForFunction(() => document.querySelector('.page canvas') || !document.getElementById('reader').hidden, null, { timeout: 40000 });
  return page;
}

const setSettings = (page, patch) =>
  page.evaluate(async (p) => {
    const m = await import('/src/common/settings.js');
    await m.setSettings(p);
  }, patch);

const send = (page, msg) =>
  page.evaluate(async (m) => {
    const { getPlatform } = await import('/src/common/platform.js');
    return getPlatform().send(m);
  }, msg);

try {
  if (!fs.existsSync(pdfPath)) throw new Error('ไม่พบ .tmp/sample.pdf — รัน node scripts/make-test-pdf.mjs ก่อน');
  server = createStaticServer(webRoot);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  await new Promise((r) => fakeAi.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const aiBase = `http://127.0.0.1:${fakeAi.address().port}/v1`;
  browser = await chromium.launch({ headless: true });

  /* ================= จอคอม 1280 ================= */
  section('จอคอม 1280×800');
  const desk = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'th-TH' });
  let page = await openReaderPage(desk, base);

  // เก็บคำไว้ในคลังก่อน เพื่อทดสอบไฮไลต์ + เปิด autoSave เพื่อพิสูจน์ว่าแปลคู่ไม่ยัดย่อหน้าเข้าคลัง
  await send(page, { type: 'saveWord', entry: { query: 'resilient', translation: 'ยืดหยุ่น', targetLang: 'th' } });
  await setSettings(page, { library: { autoSave: true } });

  await page.click('#btn-reader');
  await page.waitForSelector('.rd-para', { timeout: 20000 });
  const paras = await page.$$eval('.rd-para', (els) => els.map((e) => e.textContent));
  check('เปิดโหมดอ่าน → ซ่อนหน้า PDF แสดงย่อหน้า', await page.$eval('#pages', (e) => e.hidden), `${paras.length} ย่อหน้า`);
  check('แยกย่อหน้าตามต้นฉบับ (หัวข้อ + 3 ย่อหน้า + เลขหน้า)', paras.length === 5, JSON.stringify(paras.map((p) => p.slice(0, 24))));
  check('ต่อบรรทัดในย่อหน้าเดียวกัน', /resilient and kept applying until/.test(paras[1] || ''), paras[1]);

  const marks = await page.$$eval('.rd-known', (els) => els.map((e) => `${e.textContent}|${e.title}`));
  check('ไฮไลต์คำที่อยู่ในคลัง (resilient)', marks.some((m) => /^resilient\|ยืดหยุ่น$/i.test(m)), marks.join(', '));

  await page.click('#rd-settings-btn');
  await page.click('.rd-seg button[data-key="fontSize"][data-value="23"]');
  await page.click('.rd-seg button[data-key="lineHeight"][data-value="2.1"]');
  await page.click('.rd-seg button[data-key="width"][data-value="narrow"]');
  const typo = await page.$eval('.rd-para', (e) => {
    const cs = getComputedStyle(e);
    return { size: cs.fontSize, lh: parseFloat(cs.lineHeight) / parseFloat(cs.fontSize), w: document.getElementById('rd-article').getBoundingClientRect().width };
  });
  check('ปรับขนาดตัวอักษร → 23px', typo.size === '23px', typo.size);
  check('ปรับระยะบรรทัด → 2.1', Math.abs(typo.lh - 2.1) < 0.02, typo.lh.toFixed(2));
  check('ปรับความกว้างข้อความ → แคบ (32em)', Math.abs(typo.w - 23 * 32) < 2, `${Math.round(typo.w)}px`);

  await page.click('#rd-ruler');
  // ตอนเปิดแถบ ต้องวางทับบรรทัดแรกของย่อหน้าแรก ไม่ใช่ลอยอยู่ขอบบนการ์ด
  const align = await page.evaluate(() => {
    const band = document.getElementById('rd-ruler-band').getBoundingClientRect();
    const para = document.querySelector('.rd-para');
    const p = para.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(para).lineHeight);
    return { mid: band.top + band.height / 2, top: p.top, bottom: p.top + lh };
  });
  check('เปิดแถบบรรทัดแล้วอยู่ตรงบรรทัดแรก', align.mid > align.top && align.mid < align.bottom,
    `band กลาง ${Math.round(align.mid)} / บรรทัด ${Math.round(align.top)}–${Math.round(align.bottom)}`);
  const box =await page.$eval('#rd-article', (e) => e.getBoundingClientRect().toJSON());
  await page.mouse.move(box.x + 100, box.y + 120);
  const t1 = await page.$eval('#rd-ruler-band', (e) => ({ hidden: e.hidden, t: e.style.transform, h: e.offsetHeight }));
  await page.mouse.move(box.x + 100, box.y + 260);
  const t2 = await page.$eval('#rd-ruler-band', (e) => e.style.transform);
  check('แถบบรรทัดแสดงและสูงเท่าหนึ่งบรรทัด', !t1.hidden && Math.abs(t1.h - 23 * 2.1) < 2, `${t1.h}px`);
  check('แถบบรรทัดเลื่อนตามเมาส์', t1.t && t2 && t1.t !== t2, `${t1.t} → ${t2}`);

  await page.click('#rd-bilingual');
  const bilingual = await page
    .waitForFunction(() => [...document.querySelectorAll('.rd-th')].filter((e) => /[฀-๿]/.test(e.textContent) && !e.classList.contains('is-pending')).length >= 4, null, { timeout: 60000 })
    .then(() => true)
    .catch(() => false);
  const ths = await page.$$eval('.rd-th', (els) => els.map((e) => e.textContent));
  check('แปลคู่: มีคำแปลไทยใต้ย่อหน้า', bilingual, (ths[1] || '').slice(0, 60));
  const lib = await send(page, { type: 'db:list', options: {} });
  check('แปลคู่ไม่บันทึกย่อหน้าเข้าคลัง (แม้เปิดบันทึกอัตโนมัติ)', lib.total === 1, `คลังมี ${lib.total} รายการ`);
  await page.screenshot({ path: path.join(tmpDir, 'shot-reader-1280.png') });

  // จำค่าไว้: โหลดใหม่ต้องเข้าโหมดอ่านพร้อมค่าเดิม
  await page.close();
  page = await openReaderPage(desk, base);
  await page.waitForSelector('.rd-para', { timeout: 20000 }).catch(() => {});
  const remembered = await page.evaluate(() => ({
    open: !document.getElementById('reader').hidden,
    size: document.querySelector('.rd-para') && getComputedStyle(document.querySelector('.rd-para')).fontSize,
    bilingual: document.getElementById('rd-bilingual').getAttribute('aria-pressed'),
  }));
  check('เปิดไฟล์ใหม่ → จำโหมดอ่านและการตั้งค่าไว้', remembered.open && remembered.size === '23px' && remembered.bilingual === 'true', JSON.stringify(remembered));

  await page.click('#rd-digest');
  const noAi = await page.$eval('#rd-digest-box', (e) => e.textContent);
  check('สรุปเมื่อยังไม่เปิด AI → บอกว่าต้องทำอะไรต่อ', /เปิด "AI ช่วยอธิบาย"/.test(noAi), noAi.slice(0, 60));

  await setSettings(page, { ai: { enabled: true, provider: 'openai', baseUrl: aiBase, apiKey: 'test-key', model: 'fake-model' } });
  await page.close();
  page = await openReaderPage(desk, base);
  await page.waitForSelector('.rd-para', { timeout: 20000 });
  await page.click('#rd-digest');
  await page.waitForSelector('.rd-quiz li', { timeout: 20000 }).catch(() => {});
  const digest = await page.evaluate(() => ({
    summary: document.querySelectorAll('#rd-digest-box ul li').length,
    quiz: document.querySelectorAll('.rd-quiz > li').length,
  }));
  check('AI สรุป: แสดงข้อสรุปและคำถาม', digest.summary === 2 && digest.quiz === 3, JSON.stringify(digest));
  check('ส่งข้อความของหน้านี้ไปให้ AI', aiRequests.some((b) => /kept applying/.test(b)));
  await page.click('.rd-quiz > li:first-child .rd-choice:first-child');
  const answered = await page.evaluate(() => {
    const li = document.querySelector('.rd-quiz > li');
    return {
      wrong: li.querySelector('.rd-choice:nth-child(1)').classList.contains('is-wrong'),
      right: li.querySelector('.rd-choice:nth-child(2)').classList.contains('is-correct'),
      explain: li.querySelector('.rd-explain').textContent,
    };
  });
  check('ตอบผิด → เฉลยข้อที่ถูก + คำอธิบาย', answered.wrong && answered.right && /ยังไม่ใช่/.test(answered.explain), answered.explain);

  await page.click('#rd-next');
  await page.waitForFunction(() => /หน้า 2/.test(document.getElementById('rd-page').textContent), null, { timeout: 10000 }).catch(() => {});
  const p2 = await page.evaluate(() => ({ label: document.getElementById('rd-page').textContent, input: document.getElementById('page-input').value, digest: document.getElementById('rd-digest-box').hidden }));
  check('หน้าถัดไป → แสดงหน้า 2 และซ่อนสรุปของหน้าเก่า', p2.label === 'หน้า 2 / 3' && p2.input === '2' && p2.digest, JSON.stringify(p2));
  const p2Thai = await page
    .waitForFunction(() => [...document.querySelectorAll('.rd-th')].some((e) => /[฀-๿]/.test(e.textContent) && !e.classList.contains('is-pending')), null, { timeout: 40000 })
    .then(() => true)
    .catch(() => false);
  check('แปลคู่ยังทำงานต่อในหน้าใหม่', p2Thai);
  await page.screenshot({ path: path.join(tmpDir, 'shot-reader-1280-p2.png') });

  await page.click('#btn-reader');
  const back = await page
    .waitForFunction(() => !document.getElementById('pages').hidden && document.querySelector('.page canvas'), null, { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  check('ปิดโหมดอ่าน → กลับไปหน้า PDF เดิม', back && (await page.$eval('#page-input', (e) => e.value)) === '2');
  await desk.close();

  /* ================= มือถือ Pixel 5 ================= */
  section('มือถือ (จอสัมผัส 375px)');
  const mobile = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 375, height: 812 }, locale: 'th-TH' });
  page = await openReaderPage(mobile, base);
  await page.click('#btn-reader');
  await page.waitForSelector('.rd-para', { timeout: 20000 });
  const layout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    minBtn: Math.min(...[...document.querySelectorAll('.rd-bar .tb-btn, .rd-nav .tb-btn')].map((b) => b.getBoundingClientRect().height)),
  }));
  check('ไม่มีการเลื่อนแนวนอนทั้งหน้า', layout.overflow <= 0, `${layout.overflow}px`);
  check('ปุ่มสูงอย่างน้อย 44px', layout.minBtn >= 44, `${layout.minBtn}px`);

  const target = await page.evaluate(() => {
    const p = [...document.querySelectorAll('.rd-para')].find((e) => /reluctant/.test(e.textContent));
    const node = [...p.childNodes].find((n) => n.nodeType === 3 && /reluctant/.test(n.textContent));
    const i = node.textContent.indexOf('reluctant');
    const r = document.createRange();
    r.setStart(node, i + 2);
    r.setEnd(node, i + 3);
    const rect = r.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await page.touchscreen.tap(target.x, target.y);
  const tapped = await page
    .waitForFunction(() => {
      const sr = document.getElementById('atthai-translate-card')?.shadowRoot;
      return /reluctant/i.test(sr?.querySelector('.at-query')?.textContent || '') && !!sr.querySelector('.at-translation')?.textContent.trim();
    }, null, { timeout: 40000 })
    .then(() => true)
    .catch(() => false);
  const tapTr = await page.evaluate(() => document.getElementById('atthai-translate-card')?.shadowRoot?.querySelector('.at-translation')?.textContent?.trim() || '');
  check('แตะคำเดียวในโหมดอ่าน → เปิดการ์ดแปลคำนั้น', tapped, `"${tapTr}"`);
  await page.screenshot({ path: path.join(tmpDir, 'shot-reader-375.png') });
  await mobile.close();

  section('คอนโซล');
  const realErrors = consoleErrors.filter((e) => !/favicon|Failed to load resource|net::ERR_/i.test(e));
  check('ไม่มี JavaScript error', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
} catch (err) {
  fail++;
  console.error(`\n✗ การทดสอบล้มเหลว: ${err.stack || err.message}`);
} finally {
  await browser?.close().catch(() => {});
  server?.close();
  fakeAi.close();
}

console.log(`\nREADER E2E: ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
process.exit(fail ? 1 : 0);
