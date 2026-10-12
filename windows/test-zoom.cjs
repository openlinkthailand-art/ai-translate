'use strict';
/**
 * ตรวจว่า Ctrl+ล้อเมาส์ ซูมหน้าต่างแอปได้ (เคยซูมไม่ได้เพราะ Electron ไม่ซูมให้เอง)
 * วิธีใช้: node node_modules/electron/cli.js test-zoom.cjs   (รันในโฟลเดอร์ windows/)
 */
const { app, BrowserWindow } = require('electron');
require('./main.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = await new Promise((resolve) => {
    const tick = setInterval(() => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w && !w.webContents.isLoading()) {
        clearInterval(tick);
        resolve(w);
      }
    }, 100);
  });
  const wc = win.webContents;
  await wait(500);

  const wheel = (deltaY) =>
    wc.sendInputEvent({ type: 'mouseWheel', x: 200, y: 200, deltaX: 0, deltaY, modifiers: ['control'], canScroll: true });

  const results = [];
  const check = (name, ok) => results.push({ name, ok });

  // วัดจาก devicePixelRatio ในหน้าเว็บ — ค่านี้เปลี่ยนตามระดับซูมจริงของหน้า
  const ratio = () => wc.executeJavaScript('window.devicePixelRatio');

  const start = await ratio();
  wheel(120); // เลื่อนขึ้น = ซูมเข้า
  await wait(400);
  const zoomedIn = await ratio();
  check(`Ctrl+ล้อขึ้น ซูมเข้า (${start} → ${zoomedIn})`, zoomedIn > start);

  wheel(-120);
  wheel(-120);
  await wait(400);
  const zoomedOut = await ratio();
  check(`Ctrl+ล้อลง ซูมออก (${zoomedIn} → ${zoomedOut})`, zoomedOut < zoomedIn);

  // ล้อเมาส์ปกติ (ไม่กด Ctrl) ต้องไม่ซูม
  wc.sendInputEvent({ type: 'mouseWheel', x: 200, y: 200, deltaX: 0, deltaY: 120, canScroll: true });
  await wait(300);
  check('ล้อเมาส์ปกติไม่ซูม', (await ratio()) === zoomedOut);

  for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `ไม่ผ่าน ${failed}` : 'ผ่านทั้งหมด');
  app.exit(failed ? 1 : 0);
});
