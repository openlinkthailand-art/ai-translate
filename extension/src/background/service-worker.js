/**
 * Service worker ของส่วนขยาย — ทำหน้าที่เฉพาะที่เป็นของเบราว์เซอร์เท่านั้น
 * (เมนูคลิกขวา, คีย์ลัด, เปลี่ยนเส้นทาง PDF, badge)
 * ส่วน logic ทั้งหมดอยู่ใน src/core/router.js ซึ่งใช้ร่วมกับเว็บแอปมือถือ
 */
import { MSG, DEFAULT_SETTINGS, SETTINGS_KEY, VIEWER_PATH } from '../common/constants.js';
import { getSettings } from '../common/settings.js';
import { handleMessage } from '../core/router.js';
import * as db from '../core/db.js';
import * as cache from '../core/cache.js';

const PDF_GUARD_MS = 15000;
const redirectedTabs = new Map(); // tabId -> { url, ts }

/* ------------------------------------------------------------------ */
/* เริ่มต้นระบบ                                                        */
/* ------------------------------------------------------------------ */

chrome.runtime.onInstalled.addListener(async (details) => {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  if (!stored[SETTINGS_KEY]) await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  await setupContextMenus();
  await refreshBadge();
  await ensureMaintenanceAlarm();
  cache.pruneCache(30).catch(() => {});
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html?welcome=1') });
  } else {
    injectIntoExistingTabs();
  }
});

chrome.runtime.onStartup.addListener(() => {
  cache.pruneCache(30).catch(() => {});
  refreshBadge().catch(() => {});
  ensureMaintenanceAlarm().catch(() => {});
});

function ensureMaintenanceAlarm() {
  return chrome.alarms.create('maintenance', { periodInMinutes: 60, delayInMinutes: 5 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'maintenance') {
    cache.pruneCache(30).catch(() => {});
    refreshBadge().catch(() => {});
  }
});

async function setupContextMenus() {
  await chrome.contextMenus.removeAll();
  const mk = (opts) => chrome.contextMenus.create(opts, () => void chrome.runtime.lastError);
  mk({ id: 'at-translate', title: 'แปล "%s"', contexts: ['selection'] });
  mk({ id: 'at-save', title: 'บันทึก "%s" เข้าคลังคำศัพท์', contexts: ['selection'] });
  mk({ id: 'at-sep', type: 'separator', contexts: ['selection', 'page', 'link'] });
  mk({ id: 'at-reader-page', title: 'เปิดหน้านี้ในโหมดอ่านแปล', contexts: ['page'] });
  mk({ id: 'at-reader-link', title: 'เปิดลิงก์นี้ในโหมดอ่านแปล', contexts: ['link'] });
  mk({ id: 'at-options', title: 'ตั้งค่าอ่านไทย', contexts: ['action'] });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const target = info.linkUrl || info.pageUrl || tab?.url || '';
  switch (info.menuItemId) {
    case 'at-translate':
      sendToTab(tab?.id, { type: MSG.TRANSLATE_SELECTION, text: info.selectionText });
      break;
    case 'at-save':
      sendToTab(tab?.id, { type: MSG.SAVE_SELECTION, text: info.selectionText });
      break;
    case 'at-reader-page':
    case 'at-reader-link':
      if (target) openReader(target, tab?.title, tab?.id);
      break;
    case 'at-options':
      chrome.runtime.openOptionsPage();
      break;
    default:
      break;
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  if (command === 'translate-selection') sendToTab(tab.id, { type: MSG.TRANSLATE_SELECTION });
  if (command === 'save-selection') sendToTab(tab.id, { type: MSG.SAVE_SELECTION });
});

function sendToTab(tabId, msg) {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, msg).catch(() => {
    chrome.scripting
      .executeScript({ target: { tabId, allFrames: false }, files: ['src/content/content.js'] })
      .then(() => chrome.tabs.sendMessage(tabId, msg))
      .catch(() => {});
  });
}

async function injectIntoExistingTabs() {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }).catch(() => []);
  for (const tab of tabs) {
    if (!tab.id) continue;
    chrome.scripting
      .executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['src/content/content.js'] })
      .catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* เปิด PDF ในโหมดอ่านแปลอัตโนมัติ                                     */
/* ------------------------------------------------------------------ */

const VIEWER_PREFIX = () => chrome.runtime.getURL(VIEWER_PATH);

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) return;
    if (!details.url || details.url.startsWith(VIEWER_PREFIX())) return;
    const header = (details.responseHeaders || []).find((h) => h.name.toLowerCase() === 'content-type');
    const ct = header?.value || '';
    if (/application\/pdf/i.test(ct) || looksLikePdfUrl(details.url)) {
      maybeRedirectPdf(details.tabId, details.url, details.responseHeaders);
    }
  },
  { urls: ['<all_urls>'], types: ['main_frame'] },
  ['responseHeaders']
);

chrome.webNavigation.onCommitted.addListener((d) => {
  if (d.frameId !== 0) return;
  if (!looksLikePdfUrl(d.url)) return;
  if (d.url.startsWith(VIEWER_PREFIX())) return;
  maybeRedirectPdf(d.tabId, d.url, null);
});

function looksLikePdfUrl(url) {
  if (!url) return false;
  if (/^data:/i.test(url) || /^blob:/i.test(url)) return false;
  return /\.pdf(\?|#|$)/i.test(url);
}

async function maybeRedirectPdf(tabId, url, responseHeaders) {
  try {
    const settings = await getSettings();
    if (!settings.pdf?.autoOpen) return;
    if (!settings.general?.enabled) return;

    const host = hostOf(url) || 'local-file';
    const skip = settings.pdf.skipHosts || [];
    if (skip.some((h) => host === h || host.endsWith('.' + h))) return;

    const last = redirectedTabs.get(tabId);
    if (last && last.url === url && Date.now() - last.ts < PDF_GUARD_MS) return;

    const disp = (responseHeaders || []).find((h) => h.name.toLowerCase() === 'content-disposition')?.value || '';
    if (/attachment/i.test(disp) && !looksLikePdfUrl(url)) return;

    redirectedTabs.set(tabId, { url, ts: Date.now() });
    const viewer = `${chrome.runtime.getURL(VIEWER_PATH)}?file=${encodeURIComponent(url)}&auto=1`;
    await chrome.tabs.update(tabId, { url: viewer });
  } catch {
    /* เงียบไว้ ไม่ให้รบกวนการเปิดไฟล์ของผู้ใช้ */
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function openReader(url, title, fromTabId) {
  const viewer = `${chrome.runtime.getURL(VIEWER_PATH)}?file=${encodeURIComponent(url)}${
    title ? `&title=${encodeURIComponent(title)}` : ''
  }`;
  if (fromTabId && looksLikePdfUrl(url)) {
    chrome.tabs.update(fromTabId, { url: viewer });
  } else {
    chrome.tabs.create({ url: viewer, active: true });
  }
}

/* ------------------------------------------------------------------ */
/* Badge: จำนวนคำที่ถึงกำหนดทบทวน                                      */
/* ------------------------------------------------------------------ */

async function refreshBadge() {
  const s = await db.stats().catch(() => null);
  if (!s) return;
  if (s.due > 0) {
    await chrome.action.setBadgeText({ text: s.due > 99 ? '99+' : String(s.due) });
    await chrome.action.setBadgeBackgroundColor({ color: '#e8590c' });
  } else {
    await chrome.action.setBadgeText({ text: '' });
  }
}

/* ------------------------------------------------------------------ */
/* ส่งคำสั่งทั้งหมดไปที่ router กลาง                                    */
/* ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, { url: sender?.tab?.url || '', title: sender?.tab?.title || '' })
    .then((data) => {
      sendResponse({ ok: true, data });
      if (msg?.type === MSG.SAVE_WORD || msg?.type === MSG.DB_REVIEW) refreshBadge().catch(() => {});
    })
    .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true;
});
