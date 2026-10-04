/**
 * E2E test — โหลดส่วนขยายเข้า Chrome จริง แล้วทดสอบการทำงานแบบผู้ใช้จริง
 * ต้องมี: Chrome ติดตั้งในเครื่อง + playwright-core (npm i -D playwright-core)
 * วิธีใช้: npm run e2e            (มีหน้าต่าง Chrome เด้งขึ้นมาระหว่างทดสอบ)
 *         npm run e2e -- --headless
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const extDir = path.join(root, 'extension');
const tmpDir = path.join(root, '.tmp');
const profileDir = path.join(tmpDir, 'chrome-e2e');
let PORT = 0; // จะเลือกพอร์ตว่างให้อัตโนมัติ
const headless = process.argv.includes('--headless');

const CHROME_ARGS = [
  `--disable-extensions-except=${extDir}`,
  `--load-extension=${extDir}`,
  '--disable-features=DisableLoadExtensionCommandLineSwitch',
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=1440,1000',
  '--window-position=40,20',
];

/** เปิด Chromium (ตัวที่ Playwright เตรียมไว้) พร้อมโหลดส่วนขยายเข้าไป */
function launchWithExtension(headlessMode) {
  return chromium.launchPersistentContext(profileDir, {
    headless: headlessMode,
    // โหมด headless ต้องใช้ channel 'chromium' (headless shell ไม่รองรับส่วนขยาย)
    channel: headlessMode ? 'chromium' : undefined,
    viewport: null,
    args: CHROME_ARGS,
  });
}

async function findServiceWorker(ctx, timeoutMs = 15000) {
  const isOurs = (w) => w.url().includes('/src/background/service-worker.js');
  let found = ctx.serviceWorkers().find(isOurs) || null;
  const deadline = Date.now() + timeoutMs;
  while (!found && Date.now() < deadline) {
    const w = await ctx.waitForEvent('serviceworker', { timeout: 2500 }).catch(() => null);
    if (w && isOurs(w)) found = w;
  }
  return found;
}

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

/* ---------------- เซิร์ฟเวอร์ทดสอบ ---------------- */
const TEST_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>E2E Test Page</title></head>
<body style="font-family:Georgia,serif;max-width:720px;margin:40px auto;font-size:18px;line-height:1.8">
<h1>Reading test</h1>
<p id="p1">She lost her job twice, but she stayed <span id="w">resilient</span> and kept applying
until she found something better. Her friends said it was a blessing in disguise.</p>
<p id="p2">The company was reluctant to change its strategy even though the evidence was compelling.</p>
</body></html>`;

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/test.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(TEST_HTML);
  } else if (req.url.startsWith('/sample.pdf')) {
    const buf = fs.readFileSync(path.join(tmpDir, 'sample.pdf'));
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': buf.length });
    res.end(buf);
  } else if (req.url.startsWith('/favicon')) {
    res.writeHead(204).end();
  } else {
    res.writeHead(404).end('not found');
  }
});

/* ---------------- เริ่มทำงาน ---------------- */
let context = null;

try {
  if (!fs.existsSync(path.join(tmpDir, 'sample.pdf'))) {
    throw new Error('ไม่พบ .tmp/sample.pdf — รัน node scripts/make-test-pdf.mjs ก่อน');
  }

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  PORT = server.address().port;
  console.log('เซิร์ฟเวอร์ทดสอบที่พอร์ต ' + PORT);
  fs.rmSync(profileDir, { recursive: true, force: true });
  fs.mkdirSync(profileDir, { recursive: true });

  console.log(`เปิด Chromium ${headless ? '(headless)' : '(มีหน้าต่าง)'} พร้อมโหลดส่วนขยาย…`);
  context = await launchWithExtension(headless);

  /* ---------------- หา extension id ---------------- */
  section('0) โหลดส่วนขยาย');
  let sw = await findServiceWorker(context, headless ? 10000 : 20000);
  if (!sw && headless) {
    console.log('  ! โหมด headless ไม่พบส่วนขยาย — ลองใหม่แบบมีหน้าต่าง');
    await context.close().catch(() => {});
    fs.rmSync(profileDir, { recursive: true, force: true });
    fs.mkdirSync(profileDir, { recursive: true });
    context = await launchWithExtension(false);
    sw = await findServiceWorker(context, 20000);
  }
  console.log(
    '  service worker ทั้งหมด:',
    context.serviceWorkers().map((w) => w.url().replace('chrome-extension://', '')).join(' , ') || '(ไม่มี)'
  );
  check('service worker ของส่วนขยายทำงาน', !!sw, sw ? sw.url().replace('chrome-extension://', '').slice(0, 70) : 'ไม่พบ');
  if (!sw) throw new Error('ส่วนขยายไม่ถูกโหลด — ตรวจสอบ manifest.json');
  const extId = new URL(sw.url()).host;

  // ดัก error จากทุกหน้า
  const watch = (page) => {
    page.on('pageerror', (e) => consoleErrors.push(`[pageerror] ${page.url()} :: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(`[console] ${page.url()} :: ${m.text()}`);
    });
    return page;
  };
  context.on('page', watch);

  /* ---------------- 1) แปลบนหน้าเว็บด้วยการดับเบิลคลิกจริง ---------------- */
  section('1) หน้าเว็บ: ดับเบิลคลิกคำเพื่อแปล');
  const page = watch(await context.newPage());
  await page.goto(`http://127.0.0.1:${PORT}/test.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700); // ให้ content script ทำงาน

  // content script ทำงานใน "isolated world" จึงตรวจจาก main world ด้วย window.__atthaiInjected ไม่ได้
  // ต้องถาม CDP ว่ามี execution context ของส่วนขยายอยู่ในหน้านี้หรือไม่
  const cdp = await context.newCDPSession(page);
  const ctxList = [];
  cdp.on('Runtime.executionContextCreated', (e) => ctxList.push(e.context));
  await cdp.send('Runtime.enable');
  await page.waitForTimeout(600);
  const isolated = ctxList.filter((c) => c.auxData?.type === 'isolated' && String(c.origin || '').includes(extId));
  check('content script ถูกฉีดเข้าไปในหน้าเว็บ (isolated world)', isolated.length > 0, isolated.map((c) => c.name).join(', '));
  await cdp.detach().catch(() => {});

  await page.dblclick('#w');
  const cardOk = await page
    .waitForFunction(
      () => {
        const host = document.getElementById('atthai-translate-card');
        const tr = host?.shadowRoot?.querySelector('.at-translation');
        return !!(tr && tr.textContent.trim().length > 0);
      },
      { timeout: 30000 }
    )
    .then(() => true)
    .catch(() => false);
  check('การ์ดแปลแสดงผลหลังดับเบิลคลิก', cardOk);

  const cardData = await page.evaluate(() => {
    const sr = document.getElementById('atthai-translate-card')?.shadowRoot;
    if (!sr) return null;
    const q = (sel) => sr.querySelector(sel)?.textContent?.trim() || '';
    return {
      query: q('.at-query'),
      translation: q('.at-translation'),
      labels: [...sr.querySelectorAll('.at-label')].map((n) => n.textContent.trim()),
      synonyms: [...sr.querySelectorAll('.at-syn')].map((n) => n.dataset.syn),
      examples: [...sr.querySelectorAll('.at-ex .at-ex-en')].map((n) => n.textContent.trim()),
      hasSaveBtn: !!sr.querySelector('[data-act="save"]'),
      meta: q('.at-meta'),
    };
  });
  check('คำที่ค้นหาถูกต้อง', cardData?.query === 'resilient', cardData?.query);
  check('ได้คำแปลเป็นภาษาไทย', /[\u0E00-\u0E7F]/.test(cardData?.translation || ''), cardData?.translation);
  check('มีส่วนคำพ้องความหมาย', (cardData?.synonyms || []).length > 0, (cardData?.synonyms || []).slice(0, 5).join(', '));
  check('มีส่วนตัวอย่างประโยค', cardData?.labels?.some((l) => l.includes('ตัวอย่าง')), (cardData?.examples || [])[0]?.slice(0, 60));
  check('มีปุ่มบันทึกเข้าคลังคำ', !!cardData?.hasSaveBtn);
  check('แสดงผู้ให้บริการที่ใช้', !!cardData?.meta, cardData?.meta);

  await page.screenshot({ path: path.join(tmpDir, 'shot-card.png') });
  console.log('  → บันทึกภาพ: .tmp/shot-card.png');

  /* ---------------- 2) คลุมข้อความ → ปุ่มลอย → แปล ---------------- */
  section('2) หน้าเว็บ: คลุมข้อความแล้วกดปุ่มลอย');
  await page.evaluate(() => {
    document.getElementById('atthai-translate-card')?.remove();
    document.querySelectorAll('#atthai-pill').forEach((n) => n.remove());
    const p2 = document.getElementById('p2');
    const range = document.createRange();
    range.selectNodeContents(p2);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    p2.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 200, clientY: 300 }));
  });
  const pillOk = await page
    .waitForFunction(() => !!document.getElementById('atthai-pill'), { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  check('ปุ่มลอย 🌐 แปล ปรากฏเมื่อคลุมข้อความ', pillOk);

  if (pillOk) {
    await page.evaluate(() => {
      const pill = document.getElementById('atthai-pill');
      pill.shadowRoot.querySelector('button').click();
    });
    const phraseOk = await page
      .waitForFunction(
        () => {
          const tr = document.getElementById('atthai-translate-card')?.shadowRoot?.querySelector('.at-translation');
          return !!(tr && tr.textContent.trim().length > 0);
        },
        { timeout: 30000 }
      )
      .then(() => true)
      .catch(() => false);
    const phrase = await page.evaluate(() => {
      const sr = document.getElementById('atthai-translate-card')?.shadowRoot;
      return {
        query: sr?.querySelector('.at-query')?.textContent?.trim() || '',
        translation: sr?.querySelector('.at-translation')?.textContent?.trim() || '',
      };
    });
    check('แปลข้อความที่คลุมได้', phraseOk, `"${phrase.query.slice(0, 40)}" → "${phrase.translation.slice(0, 50)}"`);
  }

  /* ---------------- 3) บันทึกคำเข้าคลัง ---------------- */
  section('3) บันทึกคำเข้าคลังคำศัพท์');
  const saved = await page.evaluate(async () => {
    const sr = document.getElementById('atthai-translate-card')?.shadowRoot;
    sr?.querySelector('[data-act="save"]')?.click();
    await new Promise((r) => setTimeout(r, 1200));
    const btn = sr?.querySelector('[data-act="save"]')?.textContent || '';
    return btn;
  });
  check('กดบันทึกแล้วปุ่มเปลี่ยนสถานะ', /บันทึกแล้ว|มีอยู่แล้ว/.test(saved), saved.trim());

  const dbCount = await sw.evaluate(async () => {
    const dbs = await indexedDB.databases();
    return dbs.map((d) => d.name);
  }).catch(() => []);
  check('ฐานข้อมูลคลังคำศัพท์ถูกสร้าง', dbCount.includes('atthai_library'), dbCount.join(', ') || '(ไม่พบ)');

  /* ---------------- 4) เปิด PDF → ถูกพาไปโหมดอ่านแปลอัตโนมัติ ---------------- */
  section('4) PDF: เปิดอัตโนมัติในโหมดอ่านแปล');
  const pdfPage = watch(await context.newPage());
  await pdfPage.goto(`http://127.0.0.1:${PORT}/sample.pdf`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  const redirected = await pdfPage
    .waitForFunction(() => location.href.startsWith('chrome-extension://') && location.href.includes('viewer.html'), {
      timeout: 20000,
    })
    .then(() => true)
    .catch(() => false);
  check('ลิงก์ .pdf ถูกเปลี่ยนไปหน้า viewer อัตโนมัติ', redirected, pdfPage.url().slice(0, 90));

  if (redirected) {
    const rendered = await pdfPage
      .waitForFunction(
        () => {
          const canvas = document.querySelector('.page canvas');
          const spans = document.querySelectorAll('.textLayer span');
          return !!(canvas && canvas.width > 0 && spans.length > 0);
        },
        { timeout: 30000 }
      )
      .then(() => true)
      .catch(() => false);
    const info = await pdfPage.evaluate(() => ({
      pages: document.querySelectorAll('.page').length,
      spans: document.querySelectorAll('.textLayer span').length,
      text: (document.querySelector('.textLayer')?.textContent || '').slice(0, 80),
      total: document.getElementById('page-total')?.textContent,
    }));
    check('เรนเดอร์หน้า PDF ได้ (canvas + text layer)', rendered, `หน้า: ${info.total}, span: ${info.spans}`);
    check('ดึงข้อความจาก PDF ได้', info.text.trim().length > 5, `"${info.text.trim().slice(0, 60)}"`);

    // เลือกคำใน text layer แล้วดับเบิลคลิก → การ์ดแปลต้องขึ้น
    const pdfLookup = await pdfPage.evaluate(async () => {
      const spans = [...document.querySelectorAll('.textLayer span')];
      const target = spans.find((s) => /resilient/i.test(s.textContent || ''));
      if (!target) return { ok: false, reason: 'ไม่พบคำ resilient ใน text layer' };
      const node = target.firstChild;
      const text = node.textContent;
      const idx = text.toLowerCase().indexOf('resilient');
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + 'resilient'.length);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 100, clientY: 100 }));
      return { ok: true };
    });
    check('เลือกคำใน PDF ได้', pdfLookup.ok, pdfLookup.reason || '');

    const pdfCardOk = await pdfPage
      .waitForFunction(
        () => {
          const sr = document.getElementById('atthai-translate-card')?.shadowRoot;
          return !!sr?.querySelector('.at-translation')?.textContent?.trim();
        },
        { timeout: 30000 }
      )
      .then(() => true)
      .catch(() => false);
    const pdfCard = await pdfPage.evaluate(() => {
      const sr = document.getElementById('atthai-translate-card')?.shadowRoot;
      return {
        query: sr?.querySelector('.at-query')?.textContent?.trim() || '',
        translation: sr?.querySelector('.at-translation')?.textContent?.trim() || '',
      };
    });
    check('แปลคำจากใน PDF ได้', pdfCardOk, `"${pdfCard.query}" → "${pdfCard.translation}"`);
    check('คำแปลใน PDF เป็นภาษาไทย', /[\u0E00-\u0E7F]/.test(pdfCard.translation || ''));

    // แปลทั้งหน้า
    await pdfPage.click('#btn-translate-page');
    const pageTrans = await pdfPage
      .waitForFunction(
        () => {
          const body = document.getElementById('trans-body');
          return !!body && body.textContent.trim().length > 20 && /[\u0E00-\u0E7F]/.test(body.textContent);
        },
        { timeout: 60000 }
      )
      .then(() => true)
      .catch(() => false);
    const transText = await pdfPage.evaluate(() => (document.getElementById('trans-body')?.textContent || '').slice(0, 120));
    check('แปลทั้งหน้าได้', pageTrans, transText.trim().slice(0, 70));

    await pdfPage.screenshot({ path: path.join(tmpDir, 'shot-pdf.png') });
    console.log('  → บันทึกภาพ: .tmp/shot-pdf.png');
  }

  /* ---------------- 5) หน้าตั้งค่า / คลังคำ / ทบทวน ---------------- */
  section('5) หน้าจออื่น ๆ ของส่วนขยาย');
  for (const [name, rel, readySel] of [
    ['หน้าตั้งค่า', 'src/options/options.html', '#tabs .tab'],
    ['คลังคำศัพท์', 'src/library/library.html', '#list'],
    ['ทบทวน', 'src/review/review.html', '#screen-start'],
    ['ป๊อปอัป', 'src/popup/popup.html', '#s-total'],
  ]) {
    const p = watch(await context.newPage());
    await p.goto(`chrome-extension://${extId}/${rel}`, { waitUntil: 'domcontentloaded' });
    const ok = await p
      .waitForSelector(readySel, { timeout: 12000 })
      .then(() => true)
      .catch(() => false);
    check(`${name} เปิดได้`, ok);
    if (name === 'หน้าตั้งค่า') {
      const counts = await p.evaluate(() => ({
        providers: document.querySelectorAll('#provider-list .prov').length,
        fields: document.querySelectorAll('.switch, label.field').length,
      }));
      check('หน้าตั้งค่าแสดงรายการผู้ให้บริการและช่องตั้งค่า', counts.providers >= 5 && counts.fields > 15, `ผู้ให้บริการ ${counts.providers}, ช่องตั้งค่า ${counts.fields}`);
    }
    if (name === 'คลังคำศัพท์') {
      const words = await p.evaluate(() => document.querySelectorAll('#list .word').length);
      check('คลังคำศัพท์แสดงคำที่เพิ่งบันทึก', words > 0, `${words} คำ`);
    }
    if (name === 'ทบทวน') {
      const due = await p.evaluate(() => document.getElementById('st-due')?.textContent);
      check('หน้าทบทวนอ่านสถิติได้', due !== undefined && due !== null, `ถึงกำหนด ${due} คำ`);
      await p.click('#btn-due').catch(() => {});
      await p.waitForTimeout(400);
      const inSession = await p.evaluate(() => !document.getElementById('screen-session').classList.contains('hidden'));
      check('เริ่มรอบทบทวนได้', inSession);
      if (inSession) {
        await p.click('#btn-reveal');
        await p.waitForTimeout(500);
        const revealed = await p.evaluate(() => ({
          answer: document.getElementById('answer')?.textContent?.trim().slice(0, 60) || '',
          grades: !document.getElementById('grades').classList.contains('hidden'),
          intervals: ['i0', 'i1', 'i2', 'i3'].map((id) => document.getElementById(id)?.textContent),
        }));
        check('เฉลยคำตอบและแสดงปุ่มให้คะแนน', revealed.answer.length > 0 && revealed.grades, `"${revealed.answer}"`);
        check('แสดงช่วงเวลาทบทวนถัดไปของแต่ละระดับ', revealed.intervals.every((t) => t && t !== '—'), revealed.intervals.join(' / '));
        await p.screenshot({ path: path.join(tmpDir, 'shot-review.png') });
      }
    }
    if (name === 'หน้าตั้งค่า') await p.screenshot({ path: path.join(tmpDir, 'shot-options.png'), fullPage: true });
    if (name === 'คลังคำศัพท์') {
      await p.evaluate(() => document.querySelector('#list .word')?.click());
      await p.waitForTimeout(400);
      await p.screenshot({ path: path.join(tmpDir, 'shot-library.png') });
    }
    await p.close();
  }
  console.log('  → บันทึกภาพ: .tmp/shot-options.png, shot-library.png, shot-review.png');

  /* ---------------- สรุป ---------------- */
  section('6) ตรวจสอบ error ในคอนโซล');
  const realErrors = consoleErrors.filter((e) => !/favicon|net::ERR_|ERR_BLOCKED|Download the React/i.test(e));
  check('ไม่มี JavaScript error ในหน้าที่ทดสอบ', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
} catch (err) {
  fail++;
  console.error(`\n✗ การทดสอบล้มเหลว: ${err.message}`);
} finally {
  try {
    await context?.close();
  } catch {
    /* ปิดไม่สำเร็จก็ช่างมัน */
  }
  server.close();
}

console.log('\n' + '='.repeat(52));
console.log(`E2E: ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
if (consoleErrors.length) {
  console.log('\nerror ที่พบในคอนโซล:');
  for (const e of consoleErrors.slice(0, 10)) console.log('  ' + e.slice(0, 220));
}
console.log('='.repeat(52));
process.exit(fail ? 1 : 0);
