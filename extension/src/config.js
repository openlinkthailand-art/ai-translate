/**
 * ค่าประจำสภาพแวดล้อม — "ส่วนขยาย Chrome"
 * ไฟล์นี้ถูกแทนที่ด้วย src/config.js ของเว็บแอปเมื่อ build (ดู scripts/build-web.mjs)
 */
globalThis.__ATTHAI_CONFIG__ = {
  env: 'extension',
  version: chrome.runtime.getManifest().version,
  pdfWorkerUrl: chrome.runtime.getURL('vendor/pdfjs/pdf.worker.min.js'),
  cMapUrl: chrome.runtime.getURL('vendor/pdfjs/cmaps/'),
  standardFontDataUrl: chrome.runtime.getURL('vendor/pdfjs/standard_fonts/'),
};
