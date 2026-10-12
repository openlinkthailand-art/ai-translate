'use strict';
/**
 * แอป Windows ของ "อ่านไทย" — ห่อเว็บแอปใน ../web ด้วย Electron
 * - เปิดเว็บแอปจากโปรโตคอล app://atthai (origin คงที่ ข้อมูลคลังคำใน IndexedDB จึงไม่หาย)
 * - คีย์ลัดระดับระบบ: Ctrl+Alt+T แปลข้อความที่เลือก, Ctrl+Alt+Y แปลข้อความในคลิปบอร์ด
 * - ย่อลงถาดระบบเมื่อปิดหน้าต่าง เพื่อให้คีย์ลัดยังทำงาน
 */
const { app, BrowserWindow, Tray, Menu, globalShortcut, clipboard, protocol, net, shell, nativeImage } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');

const ORIGIN = 'app://atthai';
const WEB_DIR = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..', 'web');
const COPY_SCRIPT = app.isPackaged
  ? path.join(process.resourcesPath, 'copy-selection.ps1')
  : path.join(__dirname, 'copy-selection.ps1');
const ICON = path.join(WEB_DIR, 'icons', 'icon512.png');

/** ข้อความที่ยาวเกินนี้ไม่ส่งเข้า URL (กันเผลอเลือกทั้งเอกสาร) */
const MAX_TEXT = 5000;

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

let win = null;
let tray = null;
let quitting = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', () => showWindow());

function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 780,
    minWidth: 360,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#14161b',
    icon: ICON,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      // หน้าต่างนี้โหลดเฉพาะเนื้อหาของแอปเอง (app://) — ปิดข้อจำกัด CORS เพื่อให้เรียก API แปลได้เหมือนส่วนขยาย
      webSecurity: false,
    },
  });

  // ลิงก์ภายนอกเปิดในเบราว์เซอร์ปกติ ไม่เปิดในหน้าต่างแอป
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${ORIGIN}/`)) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  // ซูมด้วยการถ่างนิ้วบนจอสัมผัส (Ctrl+ล้อเมาส์ทำใน preload.js)
  win.webContents.setVisualZoomLevelLimits(1, 3);

  win.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    win.hide();
  });

  win.loadURL(`${ORIGIN}/index.html`);
  win.once('ready-to-show', () => win.show());
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function translateText(raw) {
  const text = String(raw || '').trim().slice(0, MAX_TEXT);
  if (!win) return;
  if (!text) {
    showWindow();
    return;
  }
  win.loadURL(`${ORIGIN}/index.html?text=${encodeURIComponent(text)}`);
  showWindow();
}

/** คัดลอกข้อความที่เลือกในโปรแกรมอื่น แล้วคืนค่าคลิปบอร์ดเดิม */
function translateSelection() {
  const before = clipboard.readText();
  clipboard.writeText('');
  execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', COPY_SCRIPT],
    { windowsHide: true, timeout: 5000 },
    () => {
      // รอให้โปรแกรมปลายทางเขียนคลิปบอร์ดให้เสร็จ (สูงสุด ~1 วินาที)
      let tries = 0;
      const timer = setInterval(() => {
        const got = clipboard.readText();
        tries += 1;
        if (got || tries >= 20) {
          clearInterval(timer);
          clipboard.writeText(before);
          translateText(got);
        }
      }, 50);
    }
  );
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('อ่านไทย — Ctrl+Alt+T แปลข้อความที่เลือก');
  const build = () =>
    Menu.buildFromTemplate([
      { label: 'เปิดอ่านไทย', click: showWindow },
      { label: 'แปลจากคลิปบอร์ด (Ctrl+Alt+Y)', click: () => translateText(clipboard.readText()) },
      { type: 'separator' },
      {
        label: 'เปิดพร้อม Windows',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
      },
      { type: 'separator' },
      {
        label: 'ออก',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]);
  tray.setContextMenu(build());
  tray.on('click', showWindow);
}

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.normalize(path.join(WEB_DIR, rel));
    // กัน path traversal ออกนอกโฟลเดอร์เว็บ
    if (!file.startsWith(WEB_DIR + path.sep)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });

  createWindow();
  createTray();

  const okSelection = globalShortcut.register('Control+Alt+T', translateSelection);
  const okClipboard = globalShortcut.register('Control+Alt+Y', () => translateText(clipboard.readText()));
  if (!okSelection || !okClipboard) {
    console.warn('ลงทะเบียนคีย์ลัดไม่สำเร็จ (อาจถูกโปรแกรมอื่นใช้อยู่):', { okSelection, okClipboard });
  }

  // ใช้ตรวจหลัง build: ATTHAI_SMOKE=1 → โหลดหน้าแรก พิมพ์ชื่อหน้า แล้วปิด
  if (process.env.ATTHAI_SMOKE) {
    win.webContents.once('did-finish-load', async () => {
      const title = await win.webContents.executeJavaScript('document.title');
      const hasModule = await win.webContents.executeJavaScript(
        "typeof globalThis.__ATTHAI_CONFIG__ === 'object' && globalThis.__ATTHAI_CONFIG__.env"
      );
      console.log(`SMOKE title=${title} env=${hasModule}`);
      quitting = true;
      app.quit();
    });
  }
});

app.on('before-quit', () => {
  quitting = true;
});
app.on('will-quit', () => globalShortcut.unregisterAll());
// ไม่ปิดแอปเมื่อปิดหน้าต่างทั้งหมด — ค้างในถาดระบบเพื่อให้คีย์ลัดทำงานต่อ
app.on('window-all-closed', () => {});
