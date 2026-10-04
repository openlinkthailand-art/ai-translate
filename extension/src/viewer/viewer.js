/**
 * โหมดอ่าน PDF — ใช้ pdf.js ที่ฝังมากับส่วนขยาย
 * จุดเด่น: เลือกข้อความ/ดับเบิลคลิกเพื่อแปลได้เหมือนหน้าเว็บ + แปลทั้งหน้าได้
 */
import { TranslateCard } from '../ui/card.js';
import { cleanWord, pickContext, hashKey, truncate } from '../common/util.js';
import { MSG } from '../common/constants.js';
import { getSettings } from '../common/settings.js';
import { getPlatform } from '../common/platform.js';

const pdfjsLib = window.pdfjsLib;
/** ค่าที่แต่ละสภาพแวดล้อมกำหนดเอง (ที่อยู่ไฟล์ pdf.js) — ดู src/viewer/config.js ของแต่ละที่ */
const CFG = window.__ATTHAI_CONFIG__ || {};
const ASSETS = {
  worker: CFG.pdfWorkerUrl || getPlatform().url('vendor/pdfjs/pdf.worker.min.js'),
  cmaps: CFG.cMapUrl || getPlatform().url('vendor/pdfjs/cmaps/'),
  fonts: CFG.standardFontDataUrl || getPlatform().url('vendor/pdfjs/standard_fonts/'),
};
const send = (msg) => getPlatform().send(msg);
const isTouch = () => globalThis.matchMedia?.('(pointer: coarse)').matches === true;

const el = (id) => document.getElementById(id);
const ui = {
  pages: el('pages'),
  viewport: el('viewport'),
  pageInput: el('page-input'),
  pageTotal: el('page-total'),
  zoomLabel: el('zoom-label'),
  docTitle: el('doc-title'),
  sidebar: el('sidebar'),
  dropzone: el('dropzone'),
  toast: el('toast'),
  loading: el('loading'),
  loadingText: el('loading-text'),
  errorPanel: el('error-panel'),
  errorMessage: el('error-message'),
  transPanel: el('translation-panel'),
  transBody: el('trans-body'),
  transStatus: el('trans-status'),
  searchInput: el('search-input'),
  searchResults: el('search-results'),
};

const state = {
  settings: null,
  doc: null,
  numPages: 0,
  scale: 1,
  fitMode: 'page-width',
  rotation: 0,
  fileUrl: '',
  title: '',
  baseSize: { width: 612, height: 792 },
  rendered: new Set(),
  pageText: new Map(),
  card: null,
  currentPage: 1,
  busy: false,
};

/* ------------------------------------------------------------------ */
/* เริ่มต้น                                                            */
/* ------------------------------------------------------------------ */

init().catch((err) => showError(err?.message || String(err)));

async function init() {
  state.settings = await getSettings();
  applyTheme();
  pdfjsLib.GlobalWorkerOptions.workerSrc = ASSETS.worker;
  state.card = new TranslateCard({
    bridge: makeBridge(),
    settings: state.settings,
    host: document.documentElement,
  });
  bindToolbar();
  bindSelection();
  bindKeys();
  addWebHomeButton();

  const params = new URLSearchParams(location.search);
  const file = params.get('file');
  const title = params.get('title');
  state.title = title || '';
  if (file) {
    loadDocument(file, Number(params.get('page') || 0) || null);
  } else {
    ui.dropzone.hidden = false;
  }
}

function applyTheme() {
  const pref = state.settings?.general?.theme || 'auto';
  const dark = pref === 'dark' || (pref === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

function makeBridge() {
  return {
    translate: (payload) => send({ type: MSG.TRANSLATE, ...payload, sourceType: 'pdf', pageTitle: state.title, pageUrl: state.fileUrl }),
    save: (result, meta) =>
      send({ type: MSG.SAVE_WORD, entry: result, pageTitle: state.title, pageUrl: state.fileUrl, sourceType: 'pdf' }),
    isSaved: (text, targetLang) => send({ type: MSG.IS_SAVED, text, targetLang }),
    speak: (text, lang) => speakText(text, lang),
    openPage: (page, query) => Promise.resolve(getPlatform().openPage(page, query)).catch(() => {}),
  };
}

/* ------------------------------------------------------------------ */
/* โหลดเอกสาร                                                          */
/* ------------------------------------------------------------------ */

async function loadDocument(url, restorePage = null) {
  state.fileUrl = url;
  showLoading('กำลังโหลดไฟล์ PDF…');
  hideError();
  ui.dropzone.hidden = true;
  try {
    const options = {
      url,
      cMapUrl: ASSETS.cmaps,
      cMapPacked: true,
      standardFontDataUrl: ASSETS.fonts,
    };
    let doc;
    try {
      doc = await pdfjsLib.getDocument({ ...options, withCredentials: true }).promise;
    } catch (err) {
      doc = await pdfjsLib.getDocument({ ...options, withCredentials: false }).promise;
    }
    state.doc = doc;
    state.numPages = doc.numPages;
    state.rendered.clear();
    state.pageText.clear();

    const info = await doc.getMetadata().catch(() => null);
    if (!state.title) state.title = info?.info?.Title || decodeURIComponent(url.split('/').pop() || 'เอกสาร');
    document.title = `${state.title} — อ่านไทย`;
    ui.docTitle.textContent = state.title;
    ui.docTitle.title = state.title;
    ui.pageTotal.textContent = `/ ${state.numPages}`;
    ui.pageInput.max = String(state.numPages);

    const first = await doc.getPage(1);
    state.baseSize = first.getViewport({ scale: 1 });

    await buildSidebar();
    await computeScale();
    buildPlaceholders();
    const saved = restorePage || loadPosition();
    hideLoading();
    await goToPage(saved?.page || 1, false);
    if (saved?.scale && saved.fitMode === 'custom') {
      state.scale = saved.scale;
      setZoomLabel();
      buildPlaceholders();
      await goToPage(saved.page || 1, false);
    }
  } catch (err) {
    hideLoading();
    showError(err?.message || String(err));
  }
}

function buildPlaceholders() {
  ui.pages.innerHTML = '';
  const w = state.baseSize.width * state.scale;
  const h = state.baseSize.height * state.scale;
  const frag = document.createDocumentFragment();
  for (let i = 1; i <= state.numPages; i++) {
    const div = document.createElement('div');
    div.className = 'page';
    div.dataset.page = String(i);
    div.style.width = `${w}px`;
    div.style.height = `${h}px`;
    div.style.setProperty('--scale-factor', String(state.scale));
    div.innerHTML = `<div class="page-loading">หน้า ${i}</div><div class="textLayer"></div><div class="page-num">${i}</div>`;
    frag.appendChild(div);
  }
  ui.pages.appendChild(frag);
  state.rendered.clear();
  updateVisiblePages();
}

async function renderPage(index) {
  const pageDiv = ui.pages.querySelector(`.page[data-page="${index}"]`);
  if (!pageDiv || state.rendered.has(index) || state.busy) return;
  state.rendered.add(index);
  try {
    const page = await state.doc.getPage(index);
    const viewport = page.getViewport({ scale: state.scale, rotation: state.rotation });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    pageDiv.style.width = `${viewport.width}px`;
    pageDiv.style.height = `${viewport.height}px`;
    pageDiv.style.setProperty('--scale-factor', String(state.scale));
    pageDiv.querySelector('.page-loading')?.remove();
    pageDiv.insertBefore(canvas, pageDiv.firstChild);

    await page.render({
      canvasContext: canvas.getContext('2d', { alpha: false }),
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
    }).promise;

    const textLayerDiv = pageDiv.querySelector('.textLayer');
    textLayerDiv.innerHTML = '';
    const textContent = await page.getTextContent();
    await pdfjsLib.renderTextLayer({
      textContentSource: textContent,
      textContent,
      container: textLayerDiv,
      viewport,
      textDivs: [],
    }).promise;
    pageDiv.querySelector('.textLayer')?.classList.add('ready');
  } catch (err) {
    state.rendered.delete(index);
    const loading = pageDiv.querySelector('.page-loading');
    if (loading) loading.textContent = `หน้า ${index} โหลดไม่ได้`;
    console.warn('[อ่านไทย] เรนเดอร์หน้าไม่สำเร็จ', index, err);
  }
}

function unrenderPage(index) {
  const pageDiv = ui.pages.querySelector(`.page[data-page="${index}"]`);
  if (!pageDiv) return;
  pageDiv.querySelector('canvas')?.remove();
  const tl = pageDiv.querySelector('.textLayer');
  if (tl) tl.innerHTML = '';
  if (!pageDiv.querySelector('.page-loading')) {
    const d = document.createElement('div');
    d.className = 'page-loading';
    d.textContent = `หน้า ${index}`;
    pageDiv.insertBefore(d, pageDiv.firstChild);
  }
  state.rendered.delete(index);
}

let visibleTimer = null;
function onViewportScroll() {
  if (visibleTimer) return;
  visibleTimer = setTimeout(() => {
    visibleTimer = null;
    updateVisiblePages();
  }, 90);
}

function updateVisiblePages() {
  if (!state.numPages) return;
  const rect = ui.viewport.getBoundingClientRect();
  const mid = rect.top + rect.height / 2;
  let current = state.currentPage;
  let bestDist = Infinity;
  for (const pageDiv of ui.pages.children) {
    const r = pageDiv.getBoundingClientRect();
    const dist = Math.abs(r.top + r.height / 2 - mid);
    if (dist < bestDist) {
      bestDist = dist;
      current = Number(pageDiv.dataset.page);
    }
  }
  state.currentPage = current;
  ui.pageInput.value = String(current);

  const keep = new Set();
  for (let i = current - 1; i <= current + 2; i++) {
    if (i >= 1 && i <= state.numPages) {
      keep.add(i);
      renderPage(i);
    }
  }
  for (const idx of [...state.rendered]) {
    if (!keep.has(idx) && Math.abs(idx - current) > 5) unrenderPage(idx);
  }
  highlightThumb(current);
  savePositionDebounced();
}

/* ------------------------------------------------------------------ */
/* ซูม / นำทาง                                                         */
/* ------------------------------------------------------------------ */

/* ระดับซูมที่แสดงผล: เทียบมาตรฐานเดียวกับ Chrome (100% = 96/72 ของหน่วย pdf.js) */
const DPI_RATIO = 96 / 72;
function setZoomLabel() {
  ui.zoomLabel.textContent = `${Math.round((state.scale / DPI_RATIO) * 100)}%`;
}

async function computeScale() {
  const avail = ui.viewport.clientWidth - 36;
  const mode = state.settings?.pdf?.defaultZoom || 'page-width';
  state.fitMode = mode === 'custom' ? 'page-width' : mode;
  if (state.fitMode === 'page-fit') {
    const availH = ui.viewport.clientHeight - 40;
    state.scale = Math.min(avail / state.baseSize.width, availH / state.baseSize.height);
  } else {
    state.scale = avail / state.baseSize.width;
  }
  state.scale = Math.max(0.2, Math.min(state.scale, 4));
  setZoomLabel();
}

async function setScale(scale) {
  state.scale = Math.max(0.2, Math.min(scale, 4));
  state.fitMode = 'custom';
  setZoomLabel();
  const anchor = state.currentPage;
  buildPlaceholders();
  await goToPage(anchor, false);
}

/** จัดหน้าใหม่ให้พอดีเมื่อพื้นที่อ่านเปลี่ยน (เช่น เปิด/ปิดแผงแปล) */
async function refitIfAuto() {
  if (state.fitMode === 'custom' || !state.doc) return;
  await computeScale();
  buildPlaceholders();
  await goToPage(state.currentPage, false);
}

async function goToPage(n, smooth = true) {
  const page = Math.max(1, Math.min(Number(n) || 1, state.numPages || 1));
  state.currentPage = page;
  ui.pageInput.value = String(page);
  const pageDiv = ui.pages.querySelector(`.page[data-page="${page}"]`);
  if (pageDiv) {
    ui.viewport.scrollTo({ top: pageDiv.offsetTop - 12, behavior: smooth ? 'smooth' : 'auto' });
    for (let i = page - 1; i <= page + 2; i++) if (i >= 1) renderPage(i);
  }
  savePositionDebounced();
}

function highlightThumb(page) {
  ui.sidebar.querySelectorAll('.thumb').forEach((t) => {
    t.classList.toggle('is-active', Number(t.dataset.page) === page);
  });
}

/* ------------------------------------------------------------------ */
/* แถบข้าง: สารบัญ / ภาพย่อ / ค้นหา                                     */
/* ------------------------------------------------------------------ */

async function buildSidebar() {
  // สารบัญ
  const outlineEl = el('tab-outline');
  outlineEl.innerHTML = '';
  try {
    const outline = await state.doc.getOutline();
    if (outline?.length) {
      outlineEl.appendChild(renderOutline(outline, 0));
    } else {
      outlineEl.innerHTML = '<p class="tb-label">ไฟล์นี้ไม่มีสารบัญ</p>';
    }
  } catch {
    outlineEl.innerHTML = '<p class="tb-label">อ่านสารบัญไม่ได้</p>';
  }

  // ภาพย่อ
  const thumbsEl = el('tab-thumbs');
  thumbsEl.innerHTML = '';
  for (let i = 1; i <= state.numPages; i++) {
    const btn = document.createElement('button');
    btn.className = 'thumb';
    btn.dataset.page = String(i);
    btn.style.aspectRatio = `${state.baseSize.width} / ${state.baseSize.height}`;
    btn.innerHTML = `<span class="thumb-label">${i}</span>`;
    btn.addEventListener('click', () => goToPage(i));
    thumbsEl.appendChild(btn);
  }
  loadThumbs();
}

function renderOutline(items, depth) {
  const frag = document.createDocumentFragment();
  for (const item of items) {
    const btn = document.createElement('button');
    btn.className = 'outline-item';
    btn.style.paddingLeft = `${7 + depth * 12}px`;
    btn.textContent = truncate(item.title || '(ไม่มีชื่อ)', 60);
    btn.addEventListener('click', async () => {
      try {
        const dest = typeof item.dest === 'string' ? await state.doc.getDestination(item.dest) : item.dest;
        const idx = await state.doc.getPageIndex(dest[0]);
        goToPage(idx + 1);
      } catch {
        /* ปลายทางเสียหาย */
      }
    });
    frag.appendChild(btn);
    if (item.items?.length) frag.appendChild(renderOutline(item.items, depth + 1));
  }
  return frag;
}

async function loadThumbs() {
  const thumbs = [...ui.sidebar.querySelectorAll('.thumb')];
  for (const btn of thumbs) {
    if (!ui.sidebar.offsetParent) return;
    const pageNo = Number(btn.dataset.page);
    if (Math.abs(pageNo - state.currentPage) > 12) continue;
    try {
      const page = await state.doc.getPage(pageNo);
      const vp = page.getViewport({ scale: 0.22 });
      const canvas = document.createElement('canvas');
      canvas.width = vp.width;
      canvas.height = vp.height;
      btn.prepend(canvas);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    } catch {
      /* ข้ามภาพย่อที่ทำไม่ได้ */
    }
  }
}

async function getPageText(index) {
  if (state.pageText.has(index)) return state.pageText.get(index);
  const page = await state.doc.getPage(index);
  const content = await page.getTextContent();
  const text = content.items.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim();
  state.pageText.set(index, text);
  return text;
}

async function runSearch() {
  const q = ui.searchInput.value.trim();
  ui.searchResults.innerHTML = '';
  if (!q || !state.doc) return;
  const needle = q.toLowerCase();
  ui.searchResults.innerHTML = '<p class="tb-label">กำลังค้น…</p>';
  const hits = [];
  for (let i = 1; i <= state.numPages && hits.length < 120; i++) {
    const text = await getPageText(i).catch(() => '');
    const lower = text.toLowerCase();
    let idx = lower.indexOf(needle);
    while (idx >= 0 && hits.length < 120) {
      hits.push({ page: i, snippet: text.slice(Math.max(0, idx - 40), idx + 80) });
      idx = lower.indexOf(needle, idx + needle.length);
    }
  }
  ui.searchResults.innerHTML = '';
  if (!hits.length) {
    ui.searchResults.innerHTML = '<p class="tb-label">ไม่พบคำนี้ในไฟล์</p>';
    return;
  }
  for (const hit of hits) {
    const btn = document.createElement('button');
    btn.className = 'search-hit';
    btn.innerHTML = `<b>หน้า ${hit.page}</b><br>${escapeHtml(hit.snippet)}`;
    btn.addEventListener('click', () => goToPage(hit.page));
    ui.searchResults.appendChild(btn);
  }
}

/* ------------------------------------------------------------------ */
/* แปลทั้งหน้า                                                         */
/* ------------------------------------------------------------------ */

async function translateCurrentPage() {
  if (!state.doc) return;
  const wasHidden = ui.transPanel.hidden;
  ui.transPanel.hidden = false;
  if (wasHidden) await refitIfAuto();
  ui.transBody.innerHTML = '';
  ui.transStatus.textContent = 'กำลังดึงข้อความ…';
  const page = state.currentPage;
  const text = await getPageText(page).catch(() => '');
  if (!text) {
    ui.transBody.innerHTML = '<p class="tb-label">หน้านี้ไม่มีข้อความ (อาจเป็นภาพสแกน)</p>';
    ui.transStatus.textContent = '';
    return;
  }
  const chunks = chunkText(text, 1300);
  ui.transStatus.textContent = `หน้า ${page} · ${chunks.length} ท่อน`;
  for (let i = 0; i < chunks.length; i++) {
    ui.transStatus.textContent = `กำลังแปล ${i + 1}/${chunks.length}…`;
    try {
      const res = await send({
        type: MSG.TRANSLATE,
        text: chunks[i],
        context: '',
        mode: 'fast',
        sourceType: 'pdf',
        pageTitle: state.title,
        pageUrl: state.fileUrl,
      });
      const p = document.createElement('p');
      p.textContent = res.translation;
      ui.transBody.appendChild(p);
    } catch (err) {
      const p = document.createElement('p');
      p.className = 'src';
      p.textContent = `⚠️ แปลท่อนที่ ${i + 1} ไม่สำเร็จ: ${err.message}`;
      ui.transBody.appendChild(p);
    }
    ui.transBody.scrollTop = ui.transBody.scrollHeight;
  }
  ui.transStatus.textContent = `แปลแล้ว ${chunks.length} ท่อน`;
}

/** แบ่งข้อความยาวเป็นท่อนตามประโยค ไม่ให้ตัดกลางประโยค */
function chunkText(text, maxLen) {
  const sentences = text.split(/(?<=[.!?…])\s+/);
  const chunks = [];
  let cur = '';
  for (const s of sentences) {
    if ((cur + ' ' + s).trim().length > maxLen && cur) {
      chunks.push(cur.trim());
      cur = s;
    } else {
      cur = (cur + ' ' + s).trim();
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.length ? chunks : [text];
}

/* ------------------------------------------------------------------ */
/* เลือกข้อความ → แปล                                                  */
/* ------------------------------------------------------------------ */

function bindSelection() {
  let guard = 0;
  let pillHost = null;

  const hidePill = () => {
    pillHost?.remove();
    pillHost = null;
  };

  const readSelection = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const text = sel.toString();
    if (!text.trim()) return null;
    const range = sel.getRangeAt(0);
    let rect = range.getBoundingClientRect();
    if (!rect.width && range.getClientRects().length) rect = range.getClientRects()[range.getClientRects().length - 1];
    const node = range.startContainer;
    const pageDiv = (node.nodeType === 1 ? node : node.parentElement)?.closest?.('.page');
    const pageNo = Number(pageDiv?.dataset.page || state.currentPage);
    return { text, rect, node, pageNo };
  };

  /** บริบทใน PDF = ข้อความใน "บรรทัดเดียวกัน" ของคำที่เลือก (ไม่ใช่ทั้งหน้า) */
  const contextFor = (info) => {
    const maxChars = state.settings?.lookup?.maxContextChars || 700;
    const startEl = info.node.nodeType === 1 ? info.node : info.node.parentElement;
    const span = startEl?.closest?.('.textLayer > span') || startEl;
    const lineText = collectLineText(span);
    if (lineText && lineText.length > info.text.length) {
      return pickContext(lineText, info.text, maxChars);
    }
    const pageDiv = startEl?.closest?.('.page');
    const full = [...(pageDiv?.querySelectorAll('.textLayer > span') || [])].map((s) => s.textContent).join(' ');
    return pickContext(full.replace(/\s+/g, ' '), info.text, maxChars);
  };

  /** แสดงปุ่มลอย "แปล" ใกล้ข้อความที่เลือก (ใช้ร่วมกันทั้งเมาส์และนิ้ว) */
  const showPill = (info) => {
    const text = info.text.trim();
    if (text.length < 2 || text.length > 2000) return hidePill();
    if (!/\s/.test(text) && text.length <= 24) return hidePill();
    hidePill();
    pillHost = document.createElement('div');
    const touch = isTouch();
    const left = touch
      ? Math.round(Math.min(Math.max(8, info.rect.left), window.innerWidth - 120))
      : Math.round(Math.min(Math.max(8, info.rect.left + info.rect.width / 2 - 46), window.innerWidth - 100));
    const top = touch
      ? Math.round(Math.min(Math.max(56, info.rect.bottom + 10), window.innerHeight - 60))
      : Math.round(Math.min(info.rect.bottom + 8, window.innerHeight - 46));
    pillHost.style.cssText = `position:fixed;z-index:40;left:${left}px;top:${top}px;`;
    const shadow = pillHost.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>
      :host{all:initial}
      button{font-family:"Noto Sans Thai","Sarabun","Segoe UI",system-ui,sans-serif;display:inline-flex;align-items:center;gap:6px;
      padding:${touch ? '10px 18px' : '6px 12px'};border-radius:999px;cursor:pointer;border:1px solid var(--border,#2c323d);background:var(--bg-elev,#22262f);
      color:var(--fg,#e8ecf3);font-size:${touch ? '15px' : '13px'};font-weight:600;line-height:1;box-shadow:0 6px 18px rgba(0,0,0,.3)}
      button:hover{border-color:#2dd4bf;color:#2dd4bf}
    </style><button type="button">🌐 แปล</button>`;
    shadow.querySelector('button').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      hidePill();
      state.card.lookup(text, { context: contextFor(info), sourceType: 'pdf', rect: info.rect });
    });
    // กันไม่ให้การแตะปุ่มไปล้างข้อความที่เลือกไว้ก่อนที่คำสั่งแปลจะทำงาน
    shadow.querySelector('button').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    document.documentElement.appendChild(pillHost);
  };

  ui.viewport.addEventListener('dblclick', (e) => {
    if (state.settings?.lookup?.doubleClick === false) return;
    if (e.target.closest?.('.page') == null) return;
    guard = Date.now();
    setTimeout(() => {
      const info = readSelection();
      if (!info) return;
      const word = cleanWord(info.text);
      if (!word || word.length > 60) return;
      hidePill();
      state.card.lookup(word, { context: contextFor(info), sourceType: 'pdf', rect: info.rect });
    }, 10);
  });

  ui.viewport.addEventListener('mouseup', (e) => {
    if (state.settings?.lookup?.selectionButton === false) return;
    if (Date.now() - guard < 350) return;
    setTimeout(() => {
      const info = readSelection();
      if (!info) return hidePill();
      showPill(info);
    }, 10);
  });

  document.addEventListener('mousedown', (e) => {
    if (e.composedPath?.().includes(pillHost)) return;
    hidePill();
  });
  ui.viewport.addEventListener('scroll', hidePill, { passive: true });

  // บนอุปกรณ์สัมผัส การเลือกข้อความด้วยการกดค้างไม่ทำให้เกิด mouseup
  // จึงต้องดักเหตุการณ์ selectionchange ของเบราว์เซอร์แทน
  if (isTouch()) {
    let selTimer = null;
    document.addEventListener('selectionchange', () => {
      if (state.settings?.lookup?.selectionButton === false) return;
      clearTimeout(selTimer);
      selTimer = setTimeout(() => {
        if (pillHost) return; // มีปุ่มอยู่แล้ว ไม่ต้องสร้างซ้ำ
        const info = readSelection();
        if (!info) return;
        if (info.rect.width === 0 && info.rect.height === 0) return;
        showPill(info);
      }, 220);
    });
  }
}

/* ------------------------------------------------------------------ */
/* ตำแหน่งที่อ่านค้างไว้                                                */
/* ------------------------------------------------------------------ */

function posKey() {
  return `atthai:viewer:${hashKey(state.fileUrl || 'none')}`;
}

let saveTimer = null;
function savePositionDebounced() {
  if (state.settings?.pdf?.rememberPosition === false) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(
        posKey(),
        JSON.stringify({ page: state.currentPage, scale: state.scale, fitMode: state.fitMode, ts: Date.now() })
      );
    } catch {
      /* ไม่มีที่เก็บ */
    }
  }, 700);
}

function loadPosition() {
  if (state.settings?.pdf?.rememberPosition === false) return null;
  try {
    const raw = localStorage.getItem(posKey());
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* UI อื่น ๆ                                                            */
/* ------------------------------------------------------------------ */

/** ปุ่มกลับหน้าหลัก — แสดงเฉพาะเมื่อรันเป็นเว็บแอป (บนมือถือแถบที่อยู่ถูกซ่อน) */
function addWebHomeButton() {
  if (getPlatform().name !== 'web') return;
  const group = document.querySelector('.toolbar .tb-group');
  if (!group) return;
  const home = document.createElement('a');
  home.className = 'tb-btn';
  home.href = '../../index.html';
  home.textContent = '← แปล';
  home.title = 'กลับหน้าหลัก';
  group.insertBefore(home, group.firstChild);
}

function bindToolbar() {
  el('btn-open').addEventListener('click', () => el('file-input').click());  el('dz-open').addEventListener('click', () => el('file-input').click());
  el('err-open-file').addEventListener('click', () => el('file-input').click());
  el('file-input').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) openLocalFile(file);
  });
  el('btn-prev').addEventListener('click', () => goToPage(state.currentPage - 1));
  el('btn-next').addEventListener('click', () => goToPage(state.currentPage + 1));
  ui.pageInput.addEventListener('change', () => goToPage(ui.pageInput.value));
  el('btn-zoom-in').addEventListener('click', () => setScale(state.scale + 0.15));
  el('btn-zoom-out').addEventListener('click', () => setScale(state.scale - 0.15));
  el('btn-fit').addEventListener('click', async () => {
    await computeScale();
    buildPlaceholders();
    await goToPage(state.currentPage, false);
  });
  el('btn-rotate').addEventListener('click', async () => {
    state.rotation = (state.rotation + 90) % 360;
    buildPlaceholders();
    await goToPage(state.currentPage, false);
  });
  el('btn-sidebar').addEventListener('click', () => {
    ui.sidebar.hidden = !ui.sidebar.hidden;
    el('btn-sidebar').classList.toggle('is-active', !ui.sidebar.hidden);
    if (!ui.sidebar.hidden) loadThumbs();
  });
  el('btn-search').addEventListener('click', () => {
    ui.sidebar.hidden = false;
    el('btn-sidebar').classList.add('is-active');
    switchTab('search');
    ui.searchInput.focus();
  });
  el('search-go').addEventListener('click', runSearch);
  ui.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runSearch();
  });
  el('btn-translate-page').addEventListener('click', translateCurrentPage);
  el('trans-close').addEventListener('click', async () => {
    ui.transPanel.hidden = true;
    await refitIfAuto();
  });
  el('btn-original').addEventListener('click', () => {
    if (state.fileUrl) window.open(state.fileUrl, '_blank');
  });
  el('btn-options').addEventListener('click', () => send({ type: MSG.OPEN_PAGE, page: 'options' }).catch(() => {}));
  el('err-original').addEventListener('click', (e) => {
    if (!state.fileUrl) e.preventDefault();
    else e.target.href = state.fileUrl;
  });
  el('err-retry').addEventListener('click', () => {
    if (state.fileUrl) loadDocument(state.fileUrl, state.currentPage);
  });

  ui.sidebar.querySelectorAll('.side-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });
  ui.viewport.addEventListener('scroll', onViewportScroll, { passive: true });
  window.addEventListener('resize', debounceResize);

  // ลากไฟล์มาวาง
  ['dragenter', 'dragover'].forEach((ev) =>
    document.addEventListener(ev, (e) => {
      e.preventDefault();
      ui.dropzone.hidden = false;
    })
  );
  document.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null) ui.dropzone.hidden = true;
  });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    ui.dropzone.hidden = true;
    const file = e.dataTransfer?.files?.[0];
    if (file) openLocalFile(file);
  });
}

function switchTab(name) {
  ui.sidebar.querySelectorAll('.side-tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === name));
  el('tab-outline').hidden = name !== 'outline';
  el('tab-thumbs').hidden = name !== 'thumbs';
  el('tab-search').hidden = name !== 'search';
  if (name === 'thumbs') loadThumbs();
}

function openLocalFile(file) {
  const url = URL.createObjectURL(file);
  state.title = file.name;
  loadDocument(url, null);
}

let resizeTimer = null;
function debounceResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(async () => {
    if (state.fitMode === 'custom') return;
    await computeScale();
    buildPlaceholders();
    await goToPage(state.currentPage, false);
  }, 200);
}

function bindKeys() {
  document.addEventListener('keydown', (e) => {
    const typing = ['INPUT', 'TEXTAREA'].includes(e.target.tagName);
    if (e.key === 'Escape') {
      ui.errorPanel.hidden = true;
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      el('file-input').click();
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      ui.sidebar.hidden = false;
      switchTab('search');
      ui.searchInput.focus();
      return;
    }
    if (typing) return;
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') goToPage(state.currentPage - 1);
    if (e.key === 'ArrowRight' || e.key === 'PageDown') goToPage(state.currentPage + 1);
    if (e.key === '+' || e.key === '=') setScale(state.scale + 0.15);
    if (e.key === '-') setScale(state.scale - 0.15);
  });
}

function showLoading(text) {
  ui.loadingText.textContent = text || 'กำลังโหลด…';
  ui.loading.hidden = false;
}
function hideLoading() {
  ui.loading.hidden = true;
}
function showError(message) {
  ui.errorMessage.textContent = message;
  ui.errorPanel.hidden = false;
  const link = el('err-original');
  if (state.fileUrl) link.href = state.fileUrl;
}
function hideError() {
  ui.errorPanel.hidden = true;
}
function toast(message, ms = 1800) {
  ui.toast.textContent = message;
  ui.toast.hidden = false;
  setTimeout(() => {
    ui.toast.hidden = true;
  }, ms);
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** รวมข้อความของ span ที่อยู่บรรทัดเดียวกันใน text layer (ใช้เป็นบริบทของคำที่เลือก) */
function collectLineText(span) {
  const layer = span?.parentElement;
  if (!layer) return '';
  const all = [...layer.children].filter((n) => n.tagName === 'SPAN');
  if (!all.length) return '';
  const top = span.offsetTop;
  const tol = Math.max(4, (span.offsetHeight || 12) * 0.5);
  const line = all.filter((s) => Math.abs(s.offsetTop - top) <= tol);
  line.sort((a, b) => a.offsetLeft - b.offsetLeft);
  return line
    .map((s) => s.textContent)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function speakText(text, lang) {
  if (state.settings?.tts?.enabled === false || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text).slice(0, 400));
    const isThai = /[\u0E00-\u0E7F]/.test(String(text));
    u.lang = isThai ? 'th-TH' : 'en-US';
    u.rate = state.settings?.tts?.rate || 0.95;
    window.speechSynthesis.speak(u);
  } catch {
    /* ไม่มีเสียง */
  }
}
