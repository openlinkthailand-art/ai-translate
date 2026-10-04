/**
 * การ์ดแปล — ใช้ร่วมกันทั้งหน้าเว็บทั่วไปและโหมดอ่าน PDF
 * ไม่ผูกกับ chrome.* โดยตรง แต่รับ "bridge" เข้ามา เพื่อให้ทดสอบ/ใช้ซ้ำได้
 */
import { CARD_CSS } from './card-style.js';
import { escapeHtml, truncate } from '../common/util.js';
import { LEVEL_LABEL } from '../common/constants.js';

const LEVEL_ORDER = ['easy', 'normal', 'advanced'];

export class TranslateCard {
  /**
   * @param {object} opts
   * @param {object} opts.bridge   { translate, save, isSaved, speak, openPage, getSettings }
   * @param {object} opts.settings settings ปัจจุบัน
   * @param {Element} [opts.host]  element แม่ที่จะแปะการ์ด (ปกติคือ documentElement)
   * @param {'floating'|'inline'} [opts.variant] ลอยเหนือหน้าเว็บ หรือวางในเนื้อหา (ใช้บนมือถือ)
   */
  constructor({ bridge, settings, host, variant = 'floating' }) {
    this.bridge = bridge;
    this.settings = settings || {};
    this.parentHost = host || document.documentElement;
    this.variant = variant;
    this.inline = variant === 'inline';
    this.result = null;
    this.query = '';
    this.context = '';
    this.mode = 'auto';
    this.sourceType = 'web';
    this.pinned = !!this.settings?.lookup?.cardPinnedByDefault;
    this.visible = false;
    this.savedId = null;
    this._seq = 0;
    this._build();
  }

  /* ---------------------------------------------------------------- */
  /* โครงสร้าง DOM                                                     */
  /* ---------------------------------------------------------------- */

  _build() {
    this.hostEl = document.createElement('div');
    this.hostEl.id = 'atthai-translate-card';
    this.hostEl.setAttribute('data-atthai', '1');
    this.hostEl.style.cssText = this.inline
      ? 'position:relative;z-index:1;display:none;'
      : 'position:fixed;top:0;left:0;z-index:2147483645;display:none;';
    this.shadow = this.hostEl.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CARD_CSS;
    this.shadow.appendChild(style);

    this.card = document.createElement('div');
    this.card.className = 'at-card';
    this.card.setAttribute('data-variant', this.inline ? 'inline' : 'floating');
    this.card.style.setProperty('--at-width', `${this.settings?.lookup?.cardWidth || 400}px`);
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-label', 'ผลการแปล');
    this.shadow.appendChild(this.card);

    // กันเหตุการณ์ไหลออกไปกระทบเว็บต้นทาง (บางเว็บปิด overlay เมื่อคลิก)
    for (const evt of ['mousedown', 'mouseup', 'click', 'dblclick', 'pointerdown', 'keydown', 'wheel']) {
      this.hostEl.addEventListener(evt, (e) => e.stopPropagation(), { passive: false });
    }
    this.hostEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hide();
    });

    this._onDocPointerDown = (e) => {
      if (this.inline || !this.visible || this.pinned) return;
      if (this.settings?.lookup?.closeOnOutsideClick === false) return;
      const path = e.composedPath ? e.composedPath() : [];
      if (path.includes(this.hostEl)) return;
      this.hide();
    };
    this._onDocKey = (e) => {
      if (e.key === 'Escape' && this.visible) this.hide();
    };
    this._applyTheme();
  }

  _applyTheme() {
    const pref = this.settings?.general?.theme || 'auto';
    const dark = pref === 'dark' || (pref === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    this.card.setAttribute('data-theme', dark ? 'dark' : 'light');
  }

  applySettings(settings) {
    this.settings = settings;
    this.card.style.setProperty('--at-width', `${settings?.lookup?.cardWidth || 400}px`);
    this._applyTheme();
  }

  attach() {
    if (!this.hostEl.isConnected) this.parentHost.appendChild(this.hostEl);
    document.addEventListener('pointerdown', this._onDocPointerDown, true);
    document.addEventListener('keydown', this._onDocKey, true);
  }

  destroy() {
    document.removeEventListener('pointerdown', this._onDocPointerDown, true);
    document.removeEventListener('keydown', this._onDocKey, true);
    this.hostEl.remove();
  }

  get isOpen() {
    return this.visible;
  }

  show() {
    this.attach();
    this.hostEl.style.display = 'block';
    this.visible = true;
    if (!this.inline && !this._placed) this.placeCentered();
  }

  hide() {
    this.visible = false;
    this.hostEl.style.display = 'none';
  }

  toggle() {
    if (this.visible) this.hide();
    else this.show();
  }

  /* ---------------------------------------------------------------- */
  /* ตำแหน่ง (ใช้เฉพาะแบบลอย)                                            */
  /* ---------------------------------------------------------------- */

  placeNear(rect) {
    if (this.inline) return;
    if (!rect) return this.placeCentered();
    const width = this.card.offsetWidth || this.settings?.lookup?.cardWidth || 400;
    const height = Math.min(this.card.offsetHeight || 320, window.innerHeight * 0.78);
    let left = rect.left + rect.width / 2 - width / 2;
    let top = rect.bottom + 10;
    if (top + height > window.innerHeight - 8) {
      const above = rect.top - height - 10;
      top = above > 8 ? above : Math.max(8, window.innerHeight - height - 8);
    }
    left = Math.min(Math.max(8, left), window.innerWidth - width - 8);
    this.setPosition(left, Math.max(8, top));
  }

  placeCentered() {
    if (this.inline) return;
    const width = this.card.offsetWidth || 400;
    const height = Math.min(this.card.offsetHeight || 320, window.innerHeight * 0.78);
    this.setPosition(
      Math.max(8, (window.innerWidth - width) / 2),
      Math.max(8, (window.innerHeight - height) / 2)
    );
  }

  setPosition(x, y) {
    if (this.inline) return;
    this._placed = true;
    this.hostEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  /* ---------------------------------------------------------------- */
  /* การทำงานหลัก                                                       */
  /* ---------------------------------------------------------------- */

  /**
   * ค้นหาและแสดงผล
   * @param {string} text
   * @param {object} [opts] { context, mode, sourceType, rect, forceRefresh }
   */
  async lookup(text, opts = {}) {
    const query = String(text || '').trim();
    if (!query) return;
    this.query = query;
    this.context = opts.context || '';
    this.mode = opts.mode || 'auto';
    this.sourceType = opts.sourceType || 'web';
    this.result = null;
    this.savedId = null;

    this.show();
    this.renderLoading();
    if (opts.rect) this.placeNear(opts.rect);

    const seq = ++this._seq;
    try {
      const result = await this.bridge.translate({
        text: query,
        context: this.context,
        mode: this.mode,
        sourceType: this.sourceType,
        forceRefresh: !!opts.forceRefresh,
      });
      if (seq !== this._seq) return; // มีคำใหม่กว่ามาแทนแล้ว
      this.result = result;
      this.render();
      if (opts.rect) this.placeNear(opts.rect);
    } catch (err) {
      if (seq !== this._seq) return;
      this.renderError(err?.message || String(err));
    }
  }

  async retry() {
    return this.lookup(this.query, { context: this.context, mode: this.mode, sourceType: this.sourceType, forceRefresh: true, rect: null });
  }

  /* ---------------------------------------------------------------- */
  /* การแสดงผล                                                          */
  /* ---------------------------------------------------------------- */

  renderLoading() {
    this.card.innerHTML = `
      ${this._headHtml({ loading: true })}
      <div class="at-body">
        <div class="at-skel"><div></div><div></div><div></div></div>
        <div class="at-hint">กำลังแปล…</div>
      </div>`;
    this._wireHead();
  }

  renderError(message) {
    this.card.innerHTML = `
      ${this._headHtml({})}
      <div class="at-body">
        <div class="at-error">⚠️ ${escapeHtml(message)}</div>
        <div class="at-hint">ลองใหม่อีกครั้ง หรือเปลี่ยนผู้ให้บริการในหน้าตั้งค่า</div>
      </div>
      <div class="at-foot">
        <button class="at-btn at-primary" data-act="retry">ลองใหม่</button>
        <button class="at-btn" data-act="options">เปิดตั้งค่า</button>
        <span class="at-spacer"></span>
        <button class="at-btn" data-act="close">ปิด</button>
      </div>`;
    this._wireHead();
    this._wireCommon();
  }

  render() {
    const r = this.result;
    if (!r) return;
    const isLong = r.query.length > 40;
    this.card.innerHTML = `
      ${this._headHtml({})}
      <div class="at-body">
        <div class="at-translation">${escapeHtml(r.translation || '—')}</div>
        ${r.literal ? `<div class="at-literal">ความหมายตรงตัว: ${escapeHtml(r.literal)}</div>` : ''}
        ${r.contextMeaning ? this._section('ความหมายในบริบทนี้', `<div class="at-note">${escapeHtml(r.contextMeaning)}</div>`) : ''}
        ${r.memoryHook ? this._section('🧠 ตัวช่วยจำ', `<div class="at-hook">${escapeHtml(r.memoryHook)}</div>`) : ''}
        ${this._alternativesHtml(r)}
        ${this._definitionsHtml(r)}
        ${this._synonymsHtml(r)}
        ${this._examplesHtml(r)}
        ${this._collocationsHtml(r)}
        ${r.notes ? this._section('ข้อควรรู้', `<div class="at-note">${escapeHtml(r.notes)}</div>`) : ''}
        ${!r.aiUsed && this.settings?.ai?.enabled ? `<div class="at-hint">กด "AI อธิบาย" เพื่อดูตัวอย่างเหตุการณ์และตัวช่วยจำ</div>` : ''}
        ${!(r.examples || []).length && !this.settings?.ai?.enabled ? '<div class="at-hint">ยังไม่พบตัวอย่างประโยคจากแหล่งข้อมูลฟรี — เปิด AI ในหน้าตั้งค่าจะได้ตัวอย่างแบบเหตุการณ์จริง 2-4 ประโยค</div>' : ''}
        ${this._warningsHtml(r)}
      </div>
      <div class="at-foot">
        <button class="at-btn at-primary" data-act="save">${this.savedId ? 'บันทึกแล้ว ✓' : 'บันทึกเข้าคลังคำ'}</button>
        <button class="at-btn" data-act="speak" title="ออกเสียง">🔊</button>
        <button class="at-btn" data-act="copy" title="คัดลอกทั้งหมด">📋</button>
        ${this.settings?.ai?.enabled ? `<button class="at-btn" data-act="ai">${r.aiUsed ? 'AI แล้ว ✓' : 'AI อธิบาย'}</button>` : ''}
        <span class="at-spacer"></span>
        <span class="at-meta">${escapeHtml(this._metaText(r))}</span>
        <button class="at-btn" data-act="library" title="เปิดคลังคำศัพท์">📚</button>
      </div>`;
    this._wireHead();
    this._wireCommon();
    this._checkSaved();
  }

  _metaText(r) {
    const bits = [];
    if (r.provider) bits.push(String(r.provider).replace('ai:', 'AI/'));
    if (r.cached) bits.push('แคช');
    if (typeof r.elapsedMs === 'number' && r.elapsedMs > 0) bits.push(`${(r.elapsedMs / 1000).toFixed(1)}s`);
    return bits.join(' · ');
  }

  _headHtml({ loading = false } = {}) {
    const r = this.result;
    const q = this.query || r?.query || '';
    const long = q.length > 46;
    const chips = [];
    if (r?.partOfSpeech) chips.push(`<span class="at-chip at-pos">${escapeHtml(r.partOfSpeech)}</span>`);
    if (r?.register) chips.push(`<span class="at-chip">${escapeHtml(r.register)}</span>`);
    if (r?.reading) chips.push(`<span class="at-chip">/${escapeHtml(r.reading)}/</span>`);
    if (r?.aiUsed) chips.push('<span class="at-chip at-ai">AI</span>');
    if (r?.cached) chips.push('<span class="at-chip at-cache">แคช</span>');
    return `
      <div class="at-head" data-drag="1">
        <div class="at-head-main">
          <div class="at-query ${long ? 'at-query-sm' : ''}" title="${escapeHtml(q)}">${escapeHtml(truncate(q, 220))}</div>
          ${loading || !chips.length ? '' : `<div class="at-sub">${chips.join('')}</div>`}
        </div>
        <div class="at-tools">
          <button class="at-iconbtn ${this.pinned ? 'at-on' : ''}" data-act="pin" title="ปักหมุดไว้">📌</button>
          <button class="at-iconbtn" data-act="close" title="ปิด (Esc)">✕</button>
        </div>
      </div>`;
  }

  _section(label, inner) {
    return `<div class="at-section"><div class="at-label">${escapeHtml(label)}</div>${inner}</div>`;
  }

  _alternativesHtml(r) {
    const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
    const main = norm(r.translation);
    const alts = (r.alternatives || []).filter((a) => a.translation && norm(a.translation) !== main);
    if (!alts.length) return '';
    const items = alts
      .map(
        (a) =>
          `<div class="at-item"><span class="at-item-en">${escapeHtml(a.translation)}</span>${
            a.when ? ` <span class="at-item-note">— ${escapeHtml(a.when)}</span>` : ''
          }</div>`
      )
      .join('');
    return this._section('คำแปลอื่นที่ใช้ได้', `<div class="at-list">${items}</div>`);
  }

  _definitionsHtml(r) {
    const defs = (r.definitions || []).filter((d) => d.meaning || d.th);
    if (!defs.length) return '';
    // จัดกลุ่มตามชนิดคำ เพื่อไม่ให้ป้ายชนิดคำซ้ำ ๆ ทุกบรรทัด
    const groups = [];
    for (const d of defs) {
      const key = d.pos || '';
      let g = groups.find((x) => x.pos === key);
      if (!g) {
        g = { pos: key, items: [] };
        groups.push(g);
      }
      g.items.push(d);
    }
    const html = groups
      .map(
        (g) => `<div class="at-defgroup">
          ${g.pos ? `<span class="at-chip at-pos">${escapeHtml(g.pos)}</span>` : ''}
          <div class="at-defitems">
            ${g.items
              .map(
                (d) =>
                  `<div class="at-item">${d.th ? `<div class="at-item-th">${escapeHtml(d.th)}</div>` : ''}${
                    d.meaning ? `<div class="${d.th ? 'at-item-note' : 'at-item-en'}">${escapeHtml(d.meaning)}</div>` : ''
                  }</div>`
              )
              .join('')}
          </div>
        </div>`
      )
      .join('');
    return this._section('ความหมาย', `<div class="at-list">${html}</div>`);
  }

  _synonymsHtml(r) {
    const syns = r.synonyms || [];
    if (!syns.length) return '';
    const groups = LEVEL_ORDER.map((lvl) => ({ lvl, items: syns.filter((s) => (s.level || 'normal') === lvl) })).filter(
      (g) => g.items.length
    );
    const html = groups
      .map((g) => {
        const chips = g.items
          .map(
            (s) =>
              `<button class="at-syn" data-syn="${escapeHtml(s.word)}" data-level="${escapeHtml(s.level || 'normal')}" title="${
                s.note ? escapeHtml(s.note) : 'คลิกเพื่อแปลคำนี้'
              }">${escapeHtml(s.word)}${s.th ? `<span class="at-syn-th">${escapeHtml(s.th)}</span>` : ''}</button>`
          )
          .join('');
        return `<div class="at-section"><div class="at-label">คำพ้อง · ${escapeHtml(LEVEL_LABEL[g.lvl] || g.lvl)}</div><div class="at-chips">${chips}</div></div>`;
      })
      .join('');
    return html;
  }

  _examplesHtml(r) {
    const ex = r.examples || [];
    if (!ex.length) return '';
    const items = ex
      .map(
        (e) => `<div class="at-ex">
          ${e.source ? `<span class="at-ex-src">${escapeHtml(e.source)}</span>` : ''}
          <div class="at-ex-en">${escapeHtml(e.en)}</div>
          ${e.th ? `<div class="at-ex-th">${escapeHtml(e.th)}</div>` : ''}
        </div>`
      )
      .join('');
    return this._section('ตัวอย่างการใช้ (เหตุการณ์จริง)', `<div class="at-list">${items}</div>`);
  }

  _collocationsHtml(r) {
    const c = r.collocations || [];
    if (!c.length) return '';
    return this._section(
      'คำที่ใช้คู่กันบ่อย',
      `<div class="at-chips">${c.map((x) => `<span class="at-chip">${escapeHtml(x)}</span>`).join('')}</div>`
    );
  }

  _warningsHtml(r) {
    const w = r.warnings || [];
    if (!w.length) return '';
    const text = w.map((x) => `${x.provider || x.stage}: ${x.error}`).join(' • ');
    return `<div class="at-warn">ℹ️ บางแหล่งข้อมูลใช้ไม่ได้: ${escapeHtml(truncate(text, 220))}</div>`;
  }

  /* ---------------------------------------------------------------- */
  /* เหตุการณ์                                                          */
  /* ---------------------------------------------------------------- */

  _wireHead() {
    if (this.inline) return; // การ์ดแบบวางในเนื้อหาไม่ต้องลาก
    const head = this.card.querySelector('.at-head');
    if (head) {
      head.addEventListener('pointerdown', (e) => {
        if (e.target.closest?.('[data-act]')) return;
        this._startDrag(e);
      });
    }
  }

  _wireCommon() {
    this.card.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._onAction(btn.dataset.act, btn);
      });
    });
    this.card.querySelectorAll('[data-syn]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const word = el.dataset.syn;
        this.lookup(word, { context: '', mode: this.mode, sourceType: this.sourceType, rect: null });
      });
    });
  }

  async _onAction(act, btn) {
    switch (act) {
      case 'close':
        this.hide();
        break;
      case 'pin':
        this.pinned = !this.pinned;
        btn.classList.toggle('at-on', this.pinned);
        break;
      case 'retry':
        this.renderLoading();
        this.retry();
        break;
      case 'speak':
        this.bridge.speak?.(this.result?.query || this.query, this.result?.sourceLang || 'en');
        break;
      case 'copy':
        await copyText(formatForCopy(this.result));
        flash(btn, 'คัดลอกแล้ว ✓');
        break;
      case 'save':
        await this._save();
        break;
      case 'ai':
        this.lookup(this.query, { context: this.context, mode: 'ai', sourceType: this.sourceType, rect: null });
        break;
      case 'library':
        this.bridge.openPage?.('library');
        break;
      case 'options':
        this.bridge.openPage?.('options');
        break;
      default:
        break;
    }
  }

  async _save() {
    if (!this.result) return;
    try {
      const { id, created } = await this.bridge.save(this.result, {
        sourceTitle: this.pageTitle || '',
        sourceUrl: this.pageUrl || '',
        sourceType: this.sourceType,
      });
      this.savedId = id;
      const btn = this.card.querySelector('[data-act="save"]');
      if (btn) {
        btn.textContent = created ? 'บันทึกแล้ว ✓' : 'มีอยู่แล้ว (อัปเดต)';
        btn.disabled = true;
      }
    } catch (err) {
      const btn = this.card.querySelector('[data-act="save"]');
      if (btn) btn.textContent = 'บันทึกไม่สำเร็จ';
      console.warn('[อ่านไทย] บันทึกคำไม่สำเร็จ', err);
    }
  }

  async _checkSaved() {
    try {
      const res = await this.bridge.isSaved?.(this.result?.query || this.query, this.result?.targetLang);
      if (res?.saved) {
        this.savedId = res.id;
        const btn = this.card.querySelector('[data-act="save"]');
        if (btn) {
          btn.textContent = 'บันทึกแล้ว ✓';
          btn.disabled = true;
        }
      }
    } catch {
      /* ไม่เป็นไร */
    }
  }

  _startDrag(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const base = this._currentXY();
    const head = e.currentTarget;
    head.classList.add('at-dragging');
    const move = (ev) => {
      const x = Math.min(Math.max(0, base.x + ev.clientX - startX), window.innerWidth - 60);
      const y = Math.min(Math.max(0, base.y + ev.clientY - startY), window.innerHeight - 40);
      this.setPosition(x, y);
    };
    const up = () => {
      head.classList.remove('at-dragging');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  }

  _currentXY() {
    const t = this.hostEl.style.transform || '';
    const m = t.match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/);
    return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : { x: 0, y: 0 };
  }
}

/* ------------------------------------------------------------------ */
/* ตัวช่วย                                                             */
/* ------------------------------------------------------------------ */

export function formatForCopy(r) {
  if (!r) return '';
  const lines = [`${r.query}${r.reading ? ` /${r.reading}/` : ''}`];
  if (r.partOfSpeech) lines.push(`(${r.partOfSpeech}${r.register ? ', ' + r.register : ''})`);
  lines.push(`= ${r.translation}`);
  if (r.literal) lines.push(`ตรงตัว: ${r.literal}`);
  if (r.contextMeaning) lines.push(`บริบท: ${r.contextMeaning}`);
  if (r.alternatives?.length) lines.push(`อื่น ๆ: ${r.alternatives.map((a) => a.translation).join(', ')}`);
  if (r.synonyms?.length) lines.push(`คำพ้อง: ${r.synonyms.map((s) => s.word).join(', ')}`);
  if (r.examples?.length) {
    lines.push('ตัวอย่าง:');
    for (const e of r.examples) lines.push(`  • ${e.en}${e.th ? ` → ${e.th}` : ''}`);
  }
  if (r.memoryHook) lines.push(`ตัวช่วยจำ: ${r.memoryHook}`);
  return lines.join('\n');
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      return true;
    } catch {
      return false;
    }
  }
}

function flash(btn, message) {
  if (!btn) return;
  const original = btn.textContent;
  btn.textContent = message;
  setTimeout(() => {
    btn.textContent = original;
  }, 1400);
}
