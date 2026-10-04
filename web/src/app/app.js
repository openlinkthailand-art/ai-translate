/**
 * หน้าหลักของเว็บแอป (มือถือ) — รับข้อความที่แชร์มาจากแอปอื่น หรือวางจากคลิปบอร์ด แล้วแปล
 * ใช้การ์ดแปลตัวเดียวกับส่วนขยาย (src/ui/card.js) ในโหมด "วางในเนื้อหา"
 */
import { TranslateCard } from '../ui/card.js';
import { send, getSettings, applyTheme, toast, escapeHtml, fmtRelative, readClipboard, addWebNav } from '../ui/api.js';
import { getPlatform, appVersion } from '../common/platform.js';

const $ = (id) => document.getElementById(id);
const SHARE_CACHE = 'atthai-share';
const SHARE_KEY = './share-data';

/** คำที่พบบ่อยจนไม่น่าสนใจสำหรับการเปิดดูรายละเอียด */
const STOP_WORDS = new Set(
  ('the and that this with from have has had was were are you your they their them she her his him its for but not what when where which who will ' +
    'would could should there here about into over after before because been being than then some such only also just very much many more most other ' +
    'another these those said says like make made take took time people thing things well even still back down out off again once all any both each ' +
    'few nor own same too can may must shall does did done get got one two three how why dont didnt doesnt isnt wasnt arent wont cant couldnt shouldnt ' +
    'wouldnt thats whats theres theyre youre').split(' ')
);

let settings = null;
let card = null;
let mode = 'auto';
let installPrompt = null;

init();

async function init() {
  settings = await getSettings();
  applyTheme(settings);
  addWebNav();
  $('sub').textContent = `พร้อมแปล · v${appVersion()}`;

  card = new TranslateCard({
    bridge: makeBridge(),
    settings,
    host: $('result-host'),
    variant: 'inline',
  });

  bind();
  registerServiceWorker();
  setupInstallPrompt();
  await handleIncomingShare();
  await refreshStats();
  await refreshRecent();
}

function makeBridge() {
  return {
    translate: (payload) =>
      send({ type: 'translate', ...payload, sourceType: 'web', pageTitle: document.title, pageUrl: location.href }),
    save: (result, meta) =>
      send({ type: 'saveWord', entry: result, sourceType: 'web', pageTitle: meta?.sourceTitle || document.title, pageUrl: location.href }),
    isSaved: (text, targetLang) => send({ type: 'isSaved', text, targetLang }),
    speak: (text) => speak(text),
    openPage: (page, query) => Promise.resolve(getPlatform().openPage(page, query)).catch(() => {}),
  };
}

/* ------------------------------------------------------------------ */
/* เหตุการณ์บนหน้าจอ                                                    */
/* ------------------------------------------------------------------ */

function bind() {
  $('go').addEventListener('click', () => translateNow($('input').value));
  $('input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) translateNow($('input').value);
  });
  $('paste').addEventListener('click', async () => {
    const text = await readClipboard();
    if (!text.trim()) {
      toast('อ่านคลิปบอร์ดไม่ได้ — ลองกดค้างในช่องข้อความแล้วเลือก "วาง"', 3200);
      $('input').focus();
      return;
    }
    $('input').value = text.trim();
    await translateNow(text);
  });
  $('clear').addEventListener('click', () => {
    $('input').value = '';
    card.hide();
    $('input').focus();
  });
  $('btn-speak').addEventListener('click', () => speak($('input').value));
  // วางข้อความด้วยเมนู "วาง" ของระบบ → แปลให้ทันที
  $('input').addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text/plain');
    if (text && text.trim().length > 1) setTimeout(() => translateNow(text), 0);
  });
  $('modes').addEventListener('click', (e) => {
    const btn = e.target.closest('.mode');
    if (!btn) return;
    mode = btn.dataset.mode;
    $('modes').querySelectorAll('.mode').forEach((b) => b.classList.toggle('is-active', b === btn));
    if ($('input').value.trim()) translateNow($('input').value);
  });
  if (settings?.ai?.enabled) $('modes').hidden = false;
}

/* ------------------------------------------------------------------ */
/* รับข้อความที่แชร์เข้ามา (share target)                                */
/* ------------------------------------------------------------------ */

async function handleIncomingShare() {
  const params = new URLSearchParams(location.search);
  let text = params.get('text') || '';
  let title = params.get('title') || '';

  if (params.get('share') === '1') {
    const stashed = await readStashedShare();
    if (stashed) {
      text = stashed.text || text;
      title = stashed.title || title;
    }
  }

  if (!text.trim()) {
    // ถ้าไม่มีข้อความแชร์มา ให้ลองดึงจากคลิปบอร์ด (บางเบราว์เซอร์อนุญาตเมื่อผู้ใช้เพิ่งแตะไอคอนแอป)
    const clip = await readClipboard().catch(() => '');
    if (clip && clip.trim().length > 1 && clip.trim().length < 2000) {
      $('input').value = clip.trim();
      $('sub').textContent = 'ดึงข้อความจากคลิปบอร์ดแล้ว กด "แปล" ได้เลย';
    }
    return;
  }

  $('input').value = text.trim();
  history.replaceState(null, '', location.pathname);
  await translateNow(text.trim(), title);
}

async function readStashedShare() {
  try {
    const cache = await caches.open(SHARE_CACHE);
    const res = await cache.match(SHARE_KEY);
    if (!res) return null;
    const data = await res.json();
    await cache.delete(SHARE_KEY);
    return data;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* แปล                                                                 */
/* ------------------------------------------------------------------ */

async function translateNow(text, sourceTitle = '') {
  const value = String(text || '').trim();
  if (!value) {
    toast('ยังไม่มีข้อความให้แปล');
    return;
  }
  if (value.length > 4000) {
    toast('ข้อความยาวเกินไป — เลือกเฉพาะช่วงที่ต้องการ', 3200);
    return;
  }
  $('input-card').classList.add('is-busy');
  try {
    await card.lookup(value, {
      context: value,
      mode,
      sourceType: 'web',
      rect: null,
    });
    card.pageTitle = sourceTitle;
    card.pageUrl = location.href;
    renderWordChips(value);
    $('result-host').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } finally {
    $('input-card').classList.remove('is-busy');
  }
}

/**
 * ข้อความยาว: เสนอคำที่น่าสนใจในข้อความนั้นให้แตะดูรายละเอียดต่อ
 * (บนมือถือผู้ใช้มักแชร์มาทั้งประโยค การดูคำเดียวจึงต้องมีทางเข้าให้)
 */
function renderWordChips(text) {
  const card = $('words-card');
  const box = $('word-chips');
  const words = [...new Set(String(text).toLowerCase().match(/[a-z][a-z'-]{3,}/g) || [])]
    .filter((w) => !STOP_WORDS.has(w.replace(/['-]/g, '')))
    .sort((a, b) => b.length - a.length)
    .slice(0, 6);
  if (words.length < 2) {
    card.hidden = true;
    box.innerHTML = '';
    return;
  }
  box.innerHTML = words
    .map((w) => `<button class="chip-btn" type="button" data-word="${escapeHtml(w)}">${escapeHtml(w)}</button>`)
    .join('');
  box.querySelectorAll('.chip-btn').forEach((btn) =>
    btn.addEventListener('click', () => {
      $('input').value = btn.dataset.word;
      translateNow(btn.dataset.word);
    })
  );
  card.hidden = false;
}

/* ------------------------------------------------------------------ */
/* สถิติ + คำล่าสุด                                                     */
/* ------------------------------------------------------------------ */

async function refreshStats() {
  try {
    const s = await send({ type: 'stats' });
    $('s-total').textContent = s.total;
    $('s-due').textContent = s.due;
    $('s-today').textContent = s.addedToday;
    $('due-badge').textContent = s.due ? ` ${s.due}` : '';
  } catch {
    /* ยังไม่มีข้อมูล */
  }
}

async function refreshRecent() {
  try {
    const { items } = await send({ type: 'db:list', options: { sort: 'newest', limit: 5 } });
    const box = $('recent');
    if (!items.length) {
      box.innerHTML = '<p class="small muted center" style="padding:10px 0">ยังไม่มีคำที่บันทึกไว้</p>';
      return;
    }
    box.innerHTML = items
      .map(
        (w) => `<div class="word" data-id="${escapeHtml(w.id)}">
          <div class="w-head"><span class="w-term">${escapeHtml(w.word)}</span><span class="w-tr">${escapeHtml(w.translation)}</span></div>
          <div class="w-src">${escapeHtml(fmtRelative(w.createdAt))}</div>
        </div>`
      )
      .join('');
    box.querySelectorAll('.word').forEach((n) =>
      n.addEventListener('click', () => {
        const word = n.querySelector('.w-term')?.textContent || '';
        $('input').value = word;
        translateNow(word);
      })
    );
  } catch {
    /* ไม่มีข้อมูล */
  }
}

/* ------------------------------------------------------------------ */
/* Service worker + การติดตั้ง                                          */
/* ------------------------------------------------------------------ */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
}

function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    $('btn-install').hidden = false;
  });
  $('btn-install').addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    $('btn-install').hidden = true;
  });
  window.addEventListener('appinstalled', () => toast('ติดตั้งแล้ว ✓ เปิดใช้จากหน้าจอโฮมได้เลย'));
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  $('install-hint').textContent = standalone
    ? 'ติดตั้งเป็นแอปแล้ว ✓ เวลาอ่านอยู่ให้เลือกข้อความแล้วกดแชร์ → อ่านไทย'
    : 'ถ้ายังไม่เห็นปุ่ม "ติดตั้งแอป" ให้เปิดเมนู ⋮ ของเบราว์เซอร์แล้วเลือก "เพิ่มลงในหน้าจอหลัก"';
}

/* ------------------------------------------------------------------ */
/* ออกเสียง                                                             */
/* ------------------------------------------------------------------ */

function speak(text) {
  const value = String(text || '').trim();
  if (!value || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(value.slice(0, 400));
    const isThai = /[\u0E00-\u0E7F]/.test(value);
    u.lang = isThai ? 'th-TH' : 'en-US';
    u.rate = settings?.tts?.rate || 0.95;
    const voice = window.speechSynthesis.getVoices().find((v) => v.lang?.replace('_', '-').startsWith(u.lang.slice(0, 2)));
    if (voice) u.voice = voice;
    window.speechSynthesis.speak(u);
  } catch {
    /* ไม่มีเสียง */
  }
}
