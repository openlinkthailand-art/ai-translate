/**
 * Content script — ทำงานบนหน้าเว็บทุกหน้า
 * จับดับเบิลคลิก (แปลคำเดียว) และการคลุมข้อความ (แสดงปุ่มลอย → กดเพื่อแปล)
 * โค้ดส่วน UI ถูกโหลดเป็นโมดูลจากตัวส่วนขยายเอง (ไม่ปนกับ JS ของเว็บต้นทาง)
 */
(() => {
  if (window.__atthaiInjected) return;
  window.__atthaiInjected = true;

  const MSG = {
    TRANSLATE: 'translate',
    SAVE_WORD: 'saveWord',
    IS_SAVED: 'isSaved',
    GET_SETTINGS: 'getSettings',
    OPEN_PAGE: 'openPage',
    TRANSLATE_SELECTION: 'translateSelection',
    SAVE_SELECTION: 'saveSelection',
  };

  const S = {
    settings: null,
    util: null,
    card: null,
    pillHost: null,
    pillTimer: null,
    lastSelection: '',
    lastRect: null,
    dblclickGuard: 0,
    modulesReady: false,
  };

  boot();

  async function boot() {
    S.settings = await loadSettings();
    if (!isActiveHere()) return;
    const ok = await ensureModules();
    if (!ok) return;
    bindEvents();
    bindRuntimeMessages();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.settings) {
        S.settings = mergeSettings(changes.settings.newValue);
        if (S.card) S.card.applySettings(S.settings);
        if (!isActiveHere()) hideCard();
      }
    });
  }

  /* ---------------------------------------------------------------- */
  /* settings / modules                                                */
  /* ---------------------------------------------------------------- */

  async function loadSettings() {
    try {
      const { settings } = await chrome.storage.local.get('settings');
      return mergeSettings(settings);
    } catch {
      return null;
    }
  }

  function mergeSettings(stored) {
    const base = {
      general: { enabled: true, theme: 'auto', disabledSites: [] },
      lookup: { doubleClick: true, selectionButton: true, maxContextChars: 700, cardWidth: 400, closeOnOutsideClick: true },
      translation: { targetLang: 'th', sourceLang: 'auto', providers: ['google-free', 'google-chrome-dict', 'mymemory'], timeoutMs: 9000 },
      enrichment: { synonyms: true, examples: true, exampleCount: 3, tatoeba: true, datamuse: true, simpleSynonymsOnly: true },
      ai: { enabled: false, mode: 'assist', provider: 'openai', model: 'gpt-4o-mini' },
      tts: { enabled: true, rate: 0.95 },
    };
    const s = stored || {};
    return {
      ...base,
      ...s,
      general: { ...base.general, ...(s.general || {}) },
      lookup: { ...base.lookup, ...(s.lookup || {}) },
      translation: { ...base.translation, ...(s.translation || {}) },
      enrichment: { ...base.enrichment, ...(s.enrichment || {}) },
      ai: { ...base.ai, ...(s.ai || {}) },
      tts: { ...base.tts, ...(s.tts || {}) },
    };
  }

  function isActiveHere() {
    const s = S.settings;
    if (!s) return false;
    if (s.general?.enabled === false) return false;
    const host = location.hostname.replace(/^www\./, '');
    const list = s.general?.disabledSites || [];
    return !list.some((h) => host === h || host.endsWith('.' + h));
  }

  async function ensureModules() {
    if (S.modulesReady) return true;
    try {
      const [cardMod, utilMod] = await Promise.all([
        import(chrome.runtime.getURL('src/ui/card.js')),
        import(chrome.runtime.getURL('src/common/util.js')),
      ]);
      S.cardMod = cardMod;
      S.util = utilMod;
      S.modulesReady = true;
      return true;
    } catch (err) {
      console.warn('[อ่านไทย] โหลดโมดูล UI ไม่สำเร็จ', err);
      return false;
    }
  }

  function getCard() {
    if (S.card) return S.card;
    S.card = new S.cardMod.TranslateCard({ bridge: makeBridge(), settings: S.settings, host: document.documentElement });
    return S.card;
  }

  function hideCard() {
    if (S.card) S.card.hide();
  }

  /* ---------------------------------------------------------------- */
  /* bridge ให้การ์ดคุยกับส่วนขยาย                                      */
  /* ---------------------------------------------------------------- */

  function makeBridge() {
    return {
      async translate({ text, context, mode, sourceType, forceRefresh }) {
        const res = await send({
          type: MSG.TRANSLATE,
          text,
          context,
          mode,
          sourceType: sourceType || 'web',
          forceRefresh,
          pageTitle: document.title,
          pageUrl: location.href,
        });
        return res;
      },
      async save(result, meta) {
        return send({
          type: MSG.SAVE_WORD,
          entry: result,
          pageTitle: meta?.sourceTitle || document.title,
          pageUrl: meta?.sourceUrl || location.href,
          sourceType: meta?.sourceType || 'web',
        });
      },
      async isSaved(text, targetLang) {
        return send({ type: MSG.IS_SAVED, text, targetLang });
      },
      speak(text, lang) {
        speakText(text, lang);
      },
      openPage(page, query) {
        send({ type: MSG.OPEN_PAGE, page, query }).catch(() => {});
      },
    };
  }

  function send(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (res) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!res) {
          reject(new Error('ไม่ได้รับการตอบกลับจากส่วนขยาย'));
          return;
        }
        if (res.ok) resolve(res.data);
        else reject(new Error(res.error || 'เกิดข้อผิดพลาด'));
      });
    });
  }

  /* ---------------------------------------------------------------- */
  /* เหตุการณ์บนหน้าเว็บ                                                */
  /* ---------------------------------------------------------------- */

  function bindEvents() {
    document.addEventListener('dblclick', onDblClick, true);
    document.addEventListener('mouseup', onMouseUp, true);
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('scroll', () => hidePill(), true);
    window.addEventListener('resize', () => hidePill());
  }

  function isOurUi(e) {
    const path = e.composedPath ? e.composedPath() : [];
    return path.some((n) => n?.id === 'atthai-translate-card' || n?.id === 'atthai-pill');
  }

  function onMouseDown(e) {
    if (isOurUi(e)) return;
    hidePill();
  }

  function onDblClick(e) {
    if (!isActiveHere()) return;
    if (S.settings?.lookup?.doubleClick === false) return;
    if (isOurUi(e)) return;
    const target = e.target;
    if (target instanceof HTMLInputElement && target.type === 'password') return;

    S.dblclickGuard = Date.now();
    // รอให้เบราว์เซอร์เลือกคำเสร็จก่อน
    setTimeout(() => {
      const info = readSelection();
      if (!info) return;
      const word = S.util.cleanWord(info.text);
      if (!word || word.length > 60) return;
      const context = extractContext(info.node, word);
      const rect = info.rect;
      getCard().lookup(word, { context, mode: 'auto', sourceType: 'web', rect });
    }, 10);
  }

  function onMouseUp(e) {
    if (!isActiveHere()) return;
    if (isOurUi(e)) return;
    if (S.settings?.lookup?.selectionButton === false) return;
    if (Date.now() - S.dblclickGuard < 350) return; // เพิ่งจัดการดับเบิลคลิกไปแล้ว

    setTimeout(() => {
      const info = readSelection();
      if (!info) {
        hidePill();
        return;
      }
      const text = info.text.trim();
      if (text.length < 2 || text.length > 2000) {
        hidePill();
        return;
      }
      if (S.settings?.lookup?.doubleClick !== false && !/\s/.test(text) && text.length <= 24) {
        // คำเดียวสั้น ๆ: ให้ดับเบิลคลิกเป็นตัวจัดการหลัก ไม่ต้องโชว์ปุ่มซ้ำ
        hidePill();
        return;
      }
      S.lastSelection = text;
      S.lastRect = info.rect;
      showPill(info.rect, text);
    }, 10);
  }

  function readSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const text = sel.toString();
    if (!text || !text.trim()) return null;
    const range = sel.getRangeAt(0);
    let rect = range.getBoundingClientRect();
    if ((!rect || (!rect.width && !rect.height)) && range.getClientRects().length) {
      rect = range.getClientRects()[range.getClientRects().length - 1];
    }
    return { text, rect, node: range.startContainer };
  }

  /** ดึงประโยค/ย่อหน้าที่ยาวพอมาเป็นบริบทให้ AI (หยุดที่บล็อกระดับย่อหน้า ไม่ลากทั้งหน้า) */
  function extractContext(node, needle) {
    const maxChars = S.settings?.lookup?.maxContextChars || 700;
    const BLOCK = /^(P|LI|TD|TH|DD|DT|BLOCKQUOTE|FIGCAPTION|H1|H2|H3|H4|H5|H6|PRE|ARTICLE|SUMMARY|CAPTION)$/;
    let el = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    let best = '';
    for (let depth = 0; depth < 6 && el; depth += 1, el = el.parentElement) {
      const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length > best.length) best = t;
      if (BLOCK.test(el.tagName || '') && t.length >= 30) break;
      if (best.length >= Math.min(maxChars, 160)) break;
    }
    if (!best) best = needle;
    return S.util.pickContext(best, needle, maxChars);
  }

  /* ---------------------------------------------------------------- */
  /* ปุ่มลอย "แปล"                                                      */
  /* ---------------------------------------------------------------- */

  function showPill(rect, text) {
    if (!rect) return;
    hidePill();
    const host = document.createElement('div');
    host.id = 'atthai-pill';
    host.style.cssText = 'position:fixed;z-index:2147483644;top:0;left:0;';
    const shadow = host.attachShadow({ mode: 'open' });
    const dark =
      S.settings?.general?.theme === 'dark' ||
      (S.settings?.general?.theme !== 'light' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        button {
          font-family: "Noto Sans Thai","Sarabun","Leelawadee UI","Segoe UI",system-ui,sans-serif;
          display: inline-flex; align-items: center; gap: 6px;
          padding: 6px 12px; border-radius: 999px; cursor: pointer;
          border: 1px solid ${dark ? '#2c323d' : '#d7dbe3'};
          background: ${dark ? '#171a21' : '#ffffff'};
          color: ${dark ? '#e8ecf3' : '#14181f'};
          font-size: 13px; font-weight: 600; line-height: 1;
          box-shadow: 0 6px 18px rgba(15,23,42,.20);
          animation: pop .12s ease-out;
        }
        button:hover { border-color: #0f766e; color: #0f766e; }
        @keyframes pop { from { opacity: 0; transform: translateY(4px) scale(.96); } to { opacity: 1; transform: none; } }
      </style>
      <button type="button" title="แปลข้อความที่เลือก (Alt+T)">🌐 แปล</button>`;
    const btn = shadow.querySelector('button');
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      hidePill();
      getCard().lookup(text, { context: extractContextFromRect(rect), mode: 'auto', sourceType: 'web', rect });
    });
    document.documentElement.appendChild(host);

    const width = 92;
    const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8);
    const top = rect.bottom + 8 + 30 > window.innerHeight ? Math.max(8, rect.top - 40) : rect.bottom + 8;
    host.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    S.pillHost = host;
  }

  function extractContextFromRect(rect) {
    try {
      const el = document.elementFromPoint(
        Math.min(Math.max(4, rect.left + rect.width / 2), window.innerWidth - 4),
        Math.min(Math.max(4, rect.top + rect.height / 2), window.innerHeight - 4)
      );
      return el ? extractContext(el, S.lastSelection) : S.lastSelection;
    } catch {
      return S.lastSelection;
    }
  }

  function hidePill() {
    if (S.pillHost) {
      S.pillHost.remove();
      S.pillHost = null;
    }
  }

  /* ---------------------------------------------------------------- */
  /* ข้อความจาก service worker (เมนูคลิกขวา / คีย์ลัด)                    */
  /* ---------------------------------------------------------------- */

  function bindRuntimeMessages() {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === MSG.TRANSLATE_SELECTION) {
        translateSelection(msg.text).then(
          () => sendResponse({ ok: true }),
          (err) => sendResponse({ ok: false, error: String(err?.message || err) })
        );
        return true;
      }
      if (msg?.type === MSG.SAVE_SELECTION) {
        saveSelection(msg.text).then(
          () => sendResponse({ ok: true }),
          (err) => sendResponse({ ok: false, error: String(err?.message || err) })
        );
        return true;
      }
      return false;
    });
  }

  async function translateSelection(fallbackText) {
    const info = readSelection();
    const text = (info?.text || fallbackText || S.lastSelection || '').trim();
    if (!text) return;
    const word = S.util.cleanWord(text) || text;
    const context = info ? extractContext(info.node, word) : S.lastSelection;
    const rect = info?.rect || S.lastRect || null;
    hidePill();
    await getCard().lookup(word, { context, mode: 'auto', sourceType: 'web', rect });
  }

  async function saveSelection(fallbackText) {
    const info = readSelection();
    const text = (info?.text || fallbackText || S.lastSelection || '').trim();
    if (!text) return;
    const card = getCard();
    await card.lookup(S.util.cleanWord(text) || text, {
      context: info ? extractContext(info.node, text) : '',
      mode: 'auto',
      sourceType: 'web',
      rect: info?.rect || null,
    });
    await card._save();
  }

  /* ---------------------------------------------------------------- */
  /* ออกเสียง                                                          */
  /* ---------------------------------------------------------------- */

  function speakText(text, lang) {
    if (S.settings?.tts?.enabled === false) return;
    if (!text || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(String(text).slice(0, 400));
      const isThai = /[\u0E00-\u0E7F]/.test(String(text));
      u.lang = isThai ? 'th-TH' : lang === 'th' ? 'th-TH' : 'en-US';
      u.rate = S.settings?.tts?.rate || 0.95;
      const voices = window.speechSynthesis.getVoices();
      const match = voices.find((v) => v.lang?.replace('_', '-').startsWith(u.lang.slice(0, 2)));
      if (match) u.voice = match;
      window.speechSynthesis.speak(u);
    } catch {
      /* บางหน้าเว็บไม่อนุญาตให้ใช้เสียง */
    }
  }
})();
