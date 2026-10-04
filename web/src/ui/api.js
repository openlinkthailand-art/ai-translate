/** ตัวช่วยที่หน้าเว็บของส่วนขยายและหน้าเว็บของ PWA ใช้ร่วมกัน */
import { getPlatform } from '../common/platform.js';

/** ส่งคำสั่งไปยัง router กลาง (ส่วนขยายส่งผ่าน service worker, เว็บแอปเรียกตรง) */
export function send(message) {
  return getPlatform().send(message);
}

export async function getSettings() {
  return send({ type: 'getSettings' });
}

export async function setSettings(patch) {
  return send({ type: 'setSettings', patch });
}

export function applyTheme(settings) {
  const pref = settings?.general?.theme || 'auto';
  const dark = pref === 'dark' || (pref === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#14161b' : '#0f766e');
}

export function toast(message, ms = 1800) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), ms);
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return node;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtRelative(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'เมื่อสักครู่';
  if (min < 60) return `${min} นาทีที่แล้ว`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} ชม.ที่แล้ว`;
  const day = Math.round(hr / 24);
  if (day < 31) return `${day} วันที่แล้ว`;
  return fmtDate(ts);
}

export function dueLabel(ts) {
  if (!ts) return 'ยังไม่กำหนด';
  const diff = ts - Date.now();
  if (diff <= 0) return 'ถึงกำหนดแล้ว';
  const day = Math.ceil(diff / 86400000);
  if (day <= 1) return 'พรุ่งนี้';
  return `อีก ${day} วัน`;
}

export function download(filename, content, mime = 'application/json') {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function toCsv(rows, headers) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.map((h) => esc(h.label)).join(',')];
  for (const r of rows) lines.push(headers.map((h) => esc(h.get(r))).join(','));
  return '\uFEFF' + lines.join('\r\n'); // ใส่ BOM ให้ Excel อ่านภาษาไทยออก
}

/** อ่านข้อความจากคลิปบอร์ด (ต้องถูกเรียกจากการแตะของผู้ใช้เท่านั้น) */
export async function readClipboard() {
  try {
    return (await navigator.clipboard.readText()) || '';
  } catch {
    return '';
  }
}

/**
 * แทรกแถบนำทางด้านบน — ใช้เฉพาะเมื่อรันเป็นเว็บแอปบนมือถือ
 * (หน้าเหล่านี้เป็นไฟล์เดียวกับของส่วนขยาย จึงต้องเติมเมนูให้ตอนรันเป็นเว็บเท่านั้น)
 */
export function addWebNav() {
  if (getPlatform().name !== 'web') return;
  const inSub = /\/src\//.test(location.pathname);
  const base = inSub ? '../../' : '';
  const items = [
    ['index.html', '🔎 แปล'],
    ['src/library/library.html', '📚 คลังคำ'],
    ['src/review/review.html', '🎯 ทบทวน'],
    ['src/viewer/viewer.html', '📄 PDF'],
    ['src/options/options.html', '⚙ ตั้งค่า'],
  ];
  const current = location.pathname.split('/').pop() || 'index.html';
  const nav = document.createElement('nav');
  nav.className = 'web-nav';
  nav.innerHTML = items
    .map(([href, label]) => {
      const file = href.split('/').pop();
      return `<a href="${base}${href}" class="${file === current ? 'is-active' : ''}">${label}</a>`;
    })
    .join('');
  document.body.insertBefore(nav, document.body.firstChild);
}
