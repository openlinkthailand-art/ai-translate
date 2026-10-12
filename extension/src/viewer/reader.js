/**
 * โหมดอ่านของตัวอ่าน PDF — แสดงข้อความของหน้าปัจจุบันเป็นย่อหน้าที่ไหลตามจอ
 * ช่วยอ่านยาว: ปรับขนาดตัวอักษร/ระยะบรรทัด/ความกว้าง, แถบไล่บรรทัด,
 * แปลคู่ทีละย่อหน้า, ไฮไลต์คำที่อยู่ในคลัง, AI สรุป + คำถามเช็กความเข้าใจ
 */
import { MSG, DEFAULT_SETTINGS } from '../common/constants.js';
import { setSettings } from '../common/settings.js';
import { extractParagraphs, markKnownWords } from './paragraphs.js';

const WIDTHS = { narrow: '32em', medium: '38em', wide: '46em' };
const TRANSLATE_CONCURRENCY = 2;

export class Reader {
  /**
   * @param {object} ctx
   * @param {object} ctx.state      state ของ viewer (doc, numPages, currentPage, settings)
   * @param {HTMLElement} ctx.viewport พื้นที่เลื่อนอ่าน
   * @param {(msg:object)=>Promise<any>} ctx.send
   * @param {(word:string, context:string, rect:DOMRect)=>void} ctx.lookup เปิดการ์ดแปลคำ
   * @param {(n:number)=>void} ctx.goToPage
   * @param {(open:boolean)=>void} ctx.onToggle เรียกเมื่อเปิด/ปิดโหมดอ่าน
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.el = (id) => document.getElementById(id);
    this.root = this.el('reader');
    this.content = this.el('rd-content');
    this.article = this.el('rd-article');
    this.band = this.el('rd-ruler-band');
    this.digestBox = this.el('rd-digest-box');
    this.paragraphs = new Map(); // เลขหน้า → string[]
    this.known = new Map(); // คำในคลัง (ตัวเล็ก) → คำแปล
    this.shownPage = 0;
    this.queue = [];
    this.running = 0;
    this.observer = null;
    this.bind();
  }

  get prefs() {
    return { ...DEFAULT_SETTINGS.reader, ...(this.ctx.state.settings?.reader || {}) };
  }

  get isOpen() {
    return !this.root.hidden;
  }

  /** เริ่มเอกสารใหม่: ล้างข้อมูลของไฟล์เก่า */
  reset() {
    this.paragraphs.clear();
    this.shownPage = 0;
  }

  async open() {
    this.root.hidden = false;
    document.body.classList.add('is-reading');
    this.applyPrefs();
    this.ctx.onToggle(true);
    await this.loadKnownWords();
    this.shownPage = 0;
    await this.show(this.ctx.state.currentPage);
  }

  close() {
    this.root.hidden = true;
    document.body.classList.remove('is-reading');
    this.observer?.disconnect();
    this.queue = [];
    this.ctx.onToggle(false);
  }

  async toggle() {
    const next = !this.isOpen;
    this.savePrefs({ active: next });
    if (next) await this.open();
    else this.close();
  }

  /* ------------------------------------------------------------------ */
  /* แสดงหน้า                                                           */
  /* ------------------------------------------------------------------ */

  async show(pageNo) {
    const { state } = this.ctx;
    if (!this.isOpen || !state.doc) return;
    const page = Math.max(1, Math.min(Number(pageNo) || 1, state.numPages || 1));
    if (page === this.shownPage) return;
    this.shownPage = page;
    this.el('rd-page').textContent = `หน้า ${page} / ${state.numPages}`;
    this.el('rd-prev').disabled = page <= 1;
    this.el('rd-next').disabled = page >= state.numPages;
    this.digestBox.hidden = true;
    this.digestBox.innerHTML = '';
    this.observer?.disconnect();
    this.queue = [];
    this.content.innerHTML = '<p class="rd-status">กำลังเตรียมข้อความ…</p>';

    let paras = [];
    try {
      paras = await this.getParagraphs(page);
    } catch (err) {
      if (this.shownPage !== page) return;
      this.content.innerHTML = '';
      this.content.append(status(`อ่านข้อความหน้านี้ไม่สำเร็จ (${err?.message || err}) — กด ▶ เพื่อไปหน้าถัดไป หรือปิดโหมดอ่านเพื่อดูหน้าแบบต้นฉบับ`));
      return;
    }
    if (this.shownPage !== page) return; // ผู้ใช้เปลี่ยนหน้าไประหว่างรอ

    this.content.innerHTML = '';
    if (!paras.length) {
      this.content.append(status('หน้านี้ไม่มีข้อความให้อ่าน (อาจเป็นภาพสแกนหรือรูปภาพ) — ปิดโหมดอ่านเพื่อดูหน้าแบบต้นฉบับ หรือไปหน้าถัดไป'));
    }
    const frag = document.createDocumentFragment();
    paras.forEach((text, i) => frag.append(this.renderBlock(text, i)));
    this.content.append(frag);
    this.ctx.viewport.scrollTo({ top: 0, behavior: 'auto' });
    this.resetBand();
    if (this.prefs.bilingual) this.startBilingual();
  }

  async getParagraphs(page) {
    if (this.paragraphs.has(page)) return this.paragraphs.get(page);
    const pdfPage = await this.ctx.state.doc.getPage(page);
    const content = await pdfPage.getTextContent();
    const paras = extractParagraphs(content.items);
    this.paragraphs.set(page, paras);
    return paras;
  }

  renderBlock(text, index) {
    const block = document.createElement('div');
    block.className = 'rd-block';
    block.dataset.index = String(index);
    const p = document.createElement('p');
    p.className = 'rd-para';
    p.lang = 'en';
    const knownSet = this.prefs.highlightSaved ? new Set(this.known.keys()) : null;
    for (const part of markKnownWords(text, knownSet)) {
      if (!part.known) {
        p.append(document.createTextNode(part.text));
        continue;
      }
      const mark = document.createElement('mark');
      mark.className = 'rd-known';
      mark.textContent = part.text;
      mark.title = this.known.get(part.known) || 'อยู่ในคลังคำศัพท์';
      p.append(mark);
    }
    const th = document.createElement('p');
    th.className = 'rd-th';
    th.lang = 'th';
    th.hidden = !this.prefs.bilingual;
    block.append(p, th);
    return block;
  }

  /* ------------------------------------------------------------------ */
  /* คำในคลัง                                                           */
  /* ------------------------------------------------------------------ */

  async loadKnownWords() {
    if (!this.prefs.highlightSaved) return;
    try {
      const res = await this.ctx.send({ type: MSG.DB_LIST, options: {} });
      this.known.clear();
      for (const e of res?.items || []) {
        const w = String(e?.word || '').trim().toLowerCase();
        // ไฮไลต์เฉพาะคำเดี่ยว — วลีหลายคำจับคู่ในย่อหน้าได้ไม่แม่นพอ
        if (/^[a-z][a-z'’-]*$/.test(w)) this.known.set(w, e.translation || '');
      }
    } catch {
      this.known.clear(); // อ่านคลังไม่ได้ก็ยังอ่านได้ตามปกติ แค่ไม่มีไฮไลต์
    }
  }

  /* ------------------------------------------------------------------ */
  /* แปลคู่ทีละย่อหน้า (แปลเฉพาะย่อหน้าที่กำลังจะเห็น)                       */
  /* ------------------------------------------------------------------ */

  startBilingual() {
    this.observer?.disconnect();
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          this.observer.unobserve(entry.target);
          this.enqueue(entry.target);
        }
      },
      { root: this.ctx.viewport, rootMargin: '400px 0px' }
    );
    this.content.querySelectorAll('.rd-block').forEach((b) => {
      const th = b.querySelector('.rd-th');
      th.hidden = false;
      if (!th.dataset.done) this.observer.observe(b);
    });
  }

  stopBilingual() {
    this.observer?.disconnect();
    this.queue = [];
    this.content.querySelectorAll('.rd-th').forEach((th) => (th.hidden = true));
  }

  enqueue(block) {
    const th = block.querySelector('.rd-th');
    if (th.dataset.done || th.dataset.pending) return;
    th.dataset.pending = '1';
    th.classList.remove('is-error');
    th.textContent = 'กำลังแปล…';
    th.classList.add('is-pending');
    this.queue.push(block);
    this.pump();
  }

  pump() {
    while (this.running < TRANSLATE_CONCURRENCY && this.queue.length) {
      const block = this.queue.shift();
      const page = this.shownPage;
      this.running++;
      this.translateBlock(block, page).finally(() => {
        this.running--;
        this.pump();
      });
    }
  }

  async translateBlock(block, page) {
    const th = block.querySelector('.rd-th');
    const text = block.querySelector('.rd-para').textContent;
    try {
      const res = await this.ctx.send({
        type: MSG.TRANSLATE,
        text,
        context: '',
        mode: 'fast',
        noSave: true,
        sourceType: 'pdf',
        pageTitle: this.ctx.state.title,
        pageUrl: this.ctx.state.fileUrl,
      });
      if (page !== this.shownPage) return;
      th.textContent = res?.translation || '—';
      th.dataset.done = '1';
    } catch (err) {
      if (page !== this.shownPage) return;
      th.textContent = `แปลย่อหน้านี้ไม่สำเร็จ — แตะเพื่อลองใหม่ (${err?.message || err})`;
      th.classList.add('is-error');
    } finally {
      th.classList.remove('is-pending');
      delete th.dataset.pending;
    }
  }

  /* ------------------------------------------------------------------ */
  /* AI สรุป + คำถาม                                                     */
  /* ------------------------------------------------------------------ */

  async digest() {
    const box = this.digestBox;
    const btn = this.el('rd-digest');
    box.hidden = false;
    box.innerHTML = '';
    if (!this.ctx.state.settings?.ai?.enabled) {
      box.append(status('การสรุปและตั้งคำถามใช้ AI — เปิด "AI ช่วยอธิบาย" และใส่ API key ในหน้าตั้งค่าก่อน'));
      const go = button('เปิดหน้าตั้งค่า', 'tb-btn');
      go.addEventListener('click', () => this.ctx.send({ type: MSG.OPEN_PAGE, page: 'options' }).catch(() => {}));
      box.append(go);
      box.scrollIntoView({ block: 'nearest' });
      return;
    }
    const page = this.shownPage;
    const text = (this.paragraphs.get(page) || []).join('\n\n');
    btn.disabled = true;
    btn.textContent = 'กำลังสรุป…';
    box.append(status('AI กำลังอ่านหน้านี้และเตรียมคำถาม (อาจใช้เวลา 10–30 วินาที)…'));
    box.scrollIntoView({ block: 'nearest' });
    try {
      const res = await this.ctx.send({ type: MSG.AI_DIGEST, text });
      if (page !== this.shownPage) return;
      this.renderDigest(res);
    } catch (err) {
      if (page !== this.shownPage) return;
      box.innerHTML = '';
      box.append(status(`สรุปไม่สำเร็จ: ${err?.message || err} — ตรวจการตั้งค่า AI แล้วลองใหม่`));
      const retry = button('ลองใหม่', 'tb-btn');
      retry.addEventListener('click', () => this.digest());
      box.append(retry);
    } finally {
      btn.disabled = false;
      btn.textContent = '🧠 สรุป + คำถาม';
    }
  }

  renderDigest(res) {
    const box = this.digestBox;
    box.innerHTML = '';
    const head = document.createElement('h3');
    head.textContent = 'สรุปหน้านี้';
    const ul = document.createElement('ul');
    for (const s of res?.summary || []) {
      const li = document.createElement('li');
      li.textContent = s;
      ul.append(li);
    }
    box.append(head, ul);

    const quiz = res?.quiz || [];
    if (quiz.length) {
      const qh = document.createElement('h3');
      qh.textContent = 'เช็กความเข้าใจ';
      const ol = document.createElement('ol');
      ol.className = 'rd-quiz';
      quiz.forEach((q) => ol.append(this.renderQuestion(q)));
      box.append(qh, ol);
    }
  }

  renderQuestion(q) {
    const li = document.createElement('li');
    const qp = document.createElement('p');
    qp.className = 'rd-q';
    qp.textContent = q.question;
    const choices = document.createElement('div');
    choices.className = 'rd-choices';
    const explain = document.createElement('p');
    explain.className = 'rd-explain';
    explain.hidden = true;
    q.choices.forEach((c, i) => {
      const b = button(c, 'rd-choice');
      b.addEventListener('click', () => {
        choices.querySelectorAll('button').forEach((x, j) => {
          x.disabled = true;
          if (j === q.answer) x.classList.add('is-correct');
        });
        if (i !== q.answer) b.classList.add('is-wrong');
        explain.textContent = `${i === q.answer ? '✓ ถูกต้อง' : '✗ ยังไม่ใช่'}${q.explain ? ` — ${q.explain}` : ''}`;
        explain.hidden = false;
      });
      choices.append(b);
    });
    li.append(qp, choices, explain);
    return li;
  }

  /* ------------------------------------------------------------------ */
  /* การตั้งค่าการแสดงผล                                                  */
  /* ------------------------------------------------------------------ */

  applyPrefs() {
    const p = this.prefs;
    this.root.style.setProperty('--rd-size', `${Number(p.fontSize) || 18}px`);
    this.root.style.setProperty('--rd-lh', String(Number(p.lineHeight) || 1.8));
    this.root.style.setProperty('--rd-width', WIDTHS[p.width] || WIDTHS.medium);
    this.root.querySelectorAll('.rd-seg button').forEach((b) => {
      b.classList.toggle('is-active', String(p[b.dataset.key]) === b.dataset.value);
    });
    this.el('rd-highlight').checked = !!p.highlightSaved;
    setPressed(this.el('rd-bilingual'), p.bilingual);
    setPressed(this.el('rd-ruler'), p.ruler);
    this.band.hidden = !p.ruler;
    this.band.style.height = `${(Number(p.fontSize) || 18) * (Number(p.lineHeight) || 1.8)}px`;
  }

  savePrefs(patch) {
    const state = this.ctx.state;
    state.settings.reader = { ...this.prefs, ...patch };
    this.applyPrefs();
    setSettings({ reader: patch }).catch(() => {});
  }

  /** วางแถบบรรทัดทับบรรทัดแรกของย่อหน้าแรก (ตอนเปิดแถบหรือเปลี่ยนหน้า) */
  resetBand() {
    if (this.band.hidden) return;
    const first = this.content.querySelector('.rd-para');
    if (!first) return;
    const r = first.getBoundingClientRect();
    const lineH = parseFloat(getComputedStyle(first).lineHeight) || this.band.offsetHeight;
    this.moveBand(r.top + lineH / 2);
  }

  /** ย้ายแถบบรรทัดไปที่ตำแหน่ง y (พิกัดหน้าจอ) */
  moveBand(clientY) {
    if (this.band.hidden) return;
    const rect = this.article.getBoundingClientRect();
    const h = this.band.offsetHeight;
    const top = Math.max(0, Math.min(clientY - rect.top - h / 2, rect.height - h));
    this.band.style.transform = `translateY(${top}px)`;
  }

  bind() {
    const settingsBtn = this.el('rd-settings-btn');
    settingsBtn.addEventListener('click', () => {
      const panel = this.el('rd-settings');
      panel.hidden = !panel.hidden;
      settingsBtn.setAttribute('aria-expanded', String(!panel.hidden));
      settingsBtn.classList.toggle('is-active', !panel.hidden);
    });
    this.root.querySelectorAll('.rd-seg button').forEach((b) => {
      b.addEventListener('click', () => {
        const raw = b.dataset.value;
        const value = Number.isNaN(Number(raw)) ? raw : Number(raw);
        this.savePrefs({ [b.dataset.key]: value });
      });
    });
    this.el('rd-highlight').addEventListener('change', async (e) => {
      this.savePrefs({ highlightSaved: e.target.checked });
      await this.loadKnownWords();
      const page = this.shownPage;
      this.shownPage = 0;
      await this.show(page);
    });
    this.el('rd-bilingual').addEventListener('click', () => {
      const next = !this.prefs.bilingual;
      this.savePrefs({ bilingual: next });
      if (next) this.startBilingual();
      else this.stopBilingual();
    });
    this.el('rd-ruler').addEventListener('click', () => {
      this.savePrefs({ ruler: !this.prefs.ruler });
      if (this.prefs.ruler) this.resetBand();
    });
    this.el('rd-digest').addEventListener('click', () => this.digest());
    this.el('rd-prev').addEventListener('click', () => this.ctx.goToPage(this.shownPage - 1));
    this.el('rd-next').addEventListener('click', () => this.ctx.goToPage(this.shownPage + 1));

    this.article.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') this.moveBand(e.clientY);
    });
    this.article.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') this.moveBand(e.clientY);
    });

    this.content.addEventListener('click', (e) => {
      const th = e.target.closest?.('.rd-th.is-error');
      if (th) {
        delete th.dataset.done;
        this.enqueue(th.closest('.rd-block'));
        return;
      }
      const mark = e.target.closest?.('.rd-known');
      if (mark) {
        this.ctx.lookup(mark.textContent, mark.closest('.rd-para').textContent, mark.getBoundingClientRect());
        return;
      }
      // จอสัมผัส: แตะคำเดียวเพื่อแปลได้เลย (ไม่ต้องกดค้างเพื่อเลือกคำ)
      if (globalThis.matchMedia?.('(pointer: coarse)').matches) this.lookupAtPoint(e);
    });
  }

  lookupAtPoint(e) {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const para = e.target.closest?.('.rd-para');
    const range = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    const node = range?.startContainer;
    if (!para || !node || node.nodeType !== 3 || !para.contains(node)) return;
    const text = node.textContent;
    let start = range.startOffset;
    let end = range.startOffset;
    while (start > 0 && /[A-Za-z'’-]/.test(text[start - 1])) start--;
    while (end < text.length && /[A-Za-z'’-]/.test(text[end])) end++;
    const word = text.slice(start, end).replace(/^[-'’]+|[-'’]+$/g, '');
    if (word.length < 2) return;
    const wordRange = document.createRange();
    wordRange.setStart(node, start);
    wordRange.setEnd(node, end);
    this.ctx.lookup(word, para.textContent, wordRange.getBoundingClientRect());
  }
}

function status(text) {
  const p = document.createElement('p');
  p.className = 'rd-status';
  p.textContent = text;
  return p;
}

function button(text, className) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = text;
  return b;
}

function setPressed(btn, on) {
  btn.setAttribute('aria-pressed', String(!!on));
  btn.classList.toggle('is-active', !!on);
}
