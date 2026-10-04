import { send, getSettings, setSettings, applyTheme, toast, el, escapeHtml, download, toCsv , addWebNav} from '../ui/api.js';
import { LANGS } from '../common/constants.js';
import { appVersion, isExtension, envLabel } from '../common/platform.js';

const AI_PROVIDERS = {
  openai: { label: 'OpenAI / OpenAI-compatible (OpenRouter, LM Studio ฯลฯ)', defaultBase: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' },
  gemini: { label: 'Google Gemini', defaultBase: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-2.0-flash' },
  anthropic: { label: 'Anthropic Claude', defaultBase: 'https://api.anthropic.com/v1', defaultModel: 'claude-3-5-haiku-latest' },
  ollama: { label: 'Ollama / LM Studio ในเครื่อง (ฟรี ไม่ต้องใช้คีย์)', defaultBase: 'http://localhost:11434/v1', defaultModel: 'llama3.1' },
};

const PROVIDERS = [
  { id: 'google-free', label: 'Google Translate', note: 'ไม่ต้องใช้คีย์ · ได้ข้อมูลพจนานุกรมและตัวอย่างประโยคมาด้วย' },
  { id: 'google-chrome-dict', label: 'Google Dictionary', note: 'ไม่ต้องใช้คีย์ · เร็วมาก แต่ได้คำแปลสั้น' },
  { id: 'mymemory', label: 'MyMemory', note: 'ไม่ต้องใช้คีย์ · ใช้เป็นตัวสำรองเมื่อเจ้าอื่นล่ม' },
  { id: 'libre', label: 'LibreTranslate', note: 'ตั้งค่า endpoint เองได้ เหมาะกับการรันเซิร์ฟเวอร์ในเครื่อง' },
  { id: 'deepl', label: 'DeepL', note: 'คุณภาพสูงสุดสำหรับประโยคยาว ต้องมี API key', extOnly: true },
];

const SCHEMA = {
  general: [
    { path: 'general.enabled', type: 'bool', title: 'เปิดใช้งานส่วนขยาย', hint: 'ปิดได้เมื่ออยากอ่านแบบไม่ถูกรบกวน', extOnly: true },
    { path: 'general.theme', type: 'select', title: 'ธีม', options: [['auto', 'ตามระบบ'], ['light', 'สว่าง'], ['dark', 'มืด']] },
    { path: 'lookup.doubleClick', type: 'bool', title: 'ดับเบิลคลิกเพื่อแปลคำ', hint: 'วิธีที่เร็วที่สุดสำหรับอ่านหนังสือ', extOnly: true },
    { path: 'lookup.selectionButton', type: 'bool', title: 'แสดงปุ่มลอยเมื่อคลุมข้อความ', hint: 'คลุมประโยคแล้วกดปุ่ม 🌐 แปล', extOnly: true },
    { path: 'lookup.closeOnOutsideClick', type: 'bool', title: 'ปิดการ์ดเมื่อคลิกที่อื่น', extOnly: true },
    { path: 'lookup.maxContextChars', type: 'number', title: 'ความยาวบริบทสูงสุด (ตัวอักษร)', min: 200, max: 2000, hint: 'ยิ่งมาก AI ยิ่งเข้าใจบริบท แต่จะช้าลงเล็กน้อย' },
    { path: 'lookup.cardWidth', type: 'number', title: 'ความกว้างการ์ด (พิกเซล)', min: 300, max: 620, extOnly: true },
    { path: 'tts.enabled', type: 'bool', title: 'ออกเสียงคำด้วยเสียงสังเคราะห์' },
    { path: 'tts.rate', type: 'number', title: 'ความเร็วเสียง', min: 0.5, max: 1.6, step: 0.05 },
    { path: 'general.disabledSites', type: 'list', title: 'เว็บที่ไม่ต้องทำงาน', hint: 'ใส่ชื่อโดเมนคั่นด้วยจุลภาค เช่น facebook.com, mail.google.com', extOnly: true },
  ],
  translation: [
    { path: 'translation.sourceLang', type: 'select', title: 'ภาษาต้นทาง', options: [['auto', 'ตรวจจับอัตโนมัติ'], ...LANGS.map((l) => [l.code, l.label])] },
    { path: 'translation.targetLang', type: 'select', title: 'ภาษาเป้าหมาย (ภาษาที่คุณต้องการอ่าน)', options: LANGS.map((l) => [l.code, l.label]) },
    { path: 'translation.timeoutMs', type: 'number', title: 'หมดเวลาแต่ละผู้ให้บริการ (มิลลิวินาที)', min: 2000, max: 30000, step: 500 },
    { path: 'translation.cacheDays', type: 'number', title: 'เก็บแคชการแปลกี่วัน', min: 1, max: 365 },
    { path: 'providers.libre.endpoint', type: 'text', title: 'LibreTranslate endpoint', hint: 'เช่น https://libretranslate.com หรือเซิร์ฟเวอร์ของคุณเอง (ต้องเปิด CORS)' },
    { path: 'providers.libre.apiKey', type: 'password', title: 'LibreTranslate API key (ถ้ามี)' },
    { path: 'providers.deepl.apiKey', type: 'password', title: 'DeepL API key', extOnly: true },
    { path: 'providers.deepl.pro', type: 'bool', title: 'ใช้ DeepL แบบ Pro (api.deepl.com)', extOnly: true },
  ],
  ai: [
    { path: 'ai.enabled', type: 'bool', title: 'เปิดใช้ AI ช่วยอธิบาย', hint: 'ได้ตัวอย่างเหตุการณ์จริง ตัวช่วยจำ และคำพ้องที่ใช้ง่าย' },
    { path: 'ai.mode', type: 'select', title: 'โหมดการทำงาน', options: [['assist', 'ใช้ตัวแปลทั่วไปก่อน แล้วให้ AI เสริม (ประหยัดกว่า)'], ['first', 'ให้ AI แปลเป็นตัวหลัก (ละเอียดที่สุด)']] },
    { path: 'ai.provider', type: 'select', title: 'เจ้า AI', options: Object.entries(AI_PROVIDERS).map(([k, v]) => [k, v.label]) },
    { path: 'ai.model', type: 'text', title: 'โมเดล', hint: 'เช่น gpt-4o-mini, gemini-2.0-flash, claude-3-5-haiku-latest, llama3.1' },
    { path: 'ai.baseUrl', type: 'text', title: 'Base URL ของ API', hint: 'เว้นว่างได้ ระบบจะใช้ค่ามาตรฐานของเจ้าที่เลือก' },
    { path: 'ai.apiKey', type: 'password', title: 'API key', hint: 'เก็บไว้ในเครื่องนี้เท่านั้น ไม่มีการส่งไปที่อื่น' },
    { path: 'ai.temperature', type: 'number', title: 'อุณหภูมิ (ความสร้างสรรค์)', min: 0, max: 1, step: 0.1, hint: 'แนะนำ 0.2 ให้คำตอบนิ่งและแม่นยำ' },
    { path: 'ai.maxTokens', type: 'number', title: 'ความยาวคำตอบสูงสุด (โทเคน)', min: 300, max: 4000, step: 100 },
    { path: 'ai.timeoutMs', type: 'number', title: 'หมดเวลา AI (มิลลิวินาที)', min: 5000, max: 120000, step: 1000 },
  ],
  enrich: [
    { path: 'enrichment.synonyms', type: 'bool', title: 'แสดงคำพ้องความหมาย', hint: 'เน้นคำง่ายที่ใช้ในชีวิตประจำวัน' },
    { path: 'enrichment.simpleSynonymsOnly', type: 'bool', title: 'กรองเฉพาะคำที่ใช้ง่าย/พบบ่อย', hint: 'อ้างอิงความถี่การใช้คำจริง' },
    { path: 'enrichment.definitions', type: 'bool', title: 'แสดงความหมาย/นิยาม' },
    { path: 'enrichment.examples', type: 'bool', title: 'แสดงตัวอย่างประโยค', hint: 'ยกเหตุการณ์จริงเพื่อให้เข้าใจและจำได้' },
    { path: 'enrichment.exampleCount', type: 'number', title: 'จำนวนตัวอย่างสูงสุด', min: 1, max: 6 },
    { path: 'enrichment.memoryHook', type: 'bool', title: 'แสดงตัวช่วยจำ (ต้องเปิด AI)' },
    { path: 'enrichment.collocations', type: 'bool', title: 'แสดงคำที่มักใช้คู่กัน (ต้องเปิด AI)' },
    { path: 'enrichment.tatoeba', type: 'bool', title: 'ดึงตัวอย่างประโยคจริงจาก Tatoeba', hint: 'ประโยคจากหนังสือ/ชีวิตจริงพร้อมคำแปลไทยของอาสาสมัคร' },
    { path: 'enrichment.datamuse', type: 'bool', title: 'ดึงคำพ้อง/นิยามจาก Datamuse', hint: 'ไม่ต้องใช้คีย์ และไม่ต้องใช้ AI' },
  ],
  pdf: [
    { path: 'pdf.autoOpen', type: 'bool', title: 'เปิดไฟล์ PDF ในโหมดอ่านแปลอัตโนมัติ', hint: 'เมื่อเปิดลิงก์ .pdf จะเปลี่ยนไปใช้ตัวอ่านที่แปลได้ทันที', extOnly: true },
    { path: 'pdf.defaultZoom', type: 'select', title: 'ระดับซูมเริ่มต้น', options: [['page-width', 'พอดีความกว้าง'], ['page-fit', 'พอดีทั้งหน้า']] },
    { path: 'pdf.rememberPosition', type: 'bool', title: 'จำหน้าที่อ่านค้างไว้', hint: 'เปิดไฟล์เดิมอีกครั้งจะกลับไปหน้าล่าสุด' },
    { path: 'pdf.skipHosts', type: 'list', title: 'เว็บที่ไม่ต้องเปิด PDF อัตโนมัติ', hint: 'คั่นด้วยจุลภาค', extOnly: true },
  ],
  library: [
    { path: 'library.autoSave', type: 'bool', title: 'บันทึกคำที่แปลเข้าคลังคำศัพท์อัตโนมัติ', hint: 'เปิดไว้จะได้ไม่พลาดคำใหม่ ๆ (ปิดได้ถ้าไม่อยากให้คลังรก)' },
    { path: 'library.reviewMaxPerDay', type: 'number', title: 'จำนวนคำสูงสุดต่อรอบทบทวน', min: 5, max: 300 },
  ],
};

let settings = null;

init();

async function init() {
  addWebNav();
  document.getElementById('version').textContent = appVersion();
  settings = await getSettings();
  applyTheme(settings);
  // ซ่อนตัวเลือกที่เป็นของส่วนขยายโดยเฉพาะเมื่อรันเป็นเว็บแอปบนมือถือ
  if (!isExtension()) {
    document.documentElement.setAttribute('data-env', 'web');
    document.querySelectorAll('.ext-only').forEach((n) => n.classList.add('hidden'));
    document.getElementById('web-install')?.classList.remove('hidden');
    const prefix = document.getElementById('sub-prefix');
    if (prefix) prefix.textContent = `ตั้งค่าการแปล คลังคำศัพท์ และโหมดอ่าน PDF · ${envLabel()}`;
  }
  if (new URLSearchParams(location.search).get('welcome')) {
    document.getElementById('welcome').classList.remove('hidden');
  }
  renderAll();
  bindTabs();
  bindActions();
}

/* ------------------------------------------------------------------ */
/* วาดฟอร์ม                                                            */
/* ------------------------------------------------------------------ */

function renderAll() {
  const onlyExt = (f) => f.extOnly && !isExtension();
  renderFields('pane-general', SCHEMA.general.filter((f) => !onlyExt(f)));
  renderFields('pane-translation', SCHEMA.translation.filter((f) => !onlyExt(f)), 'translation-fields');
  renderFields('pane-ai', SCHEMA.ai.filter((f) => !onlyExt(f)), 'ai-fields');
  renderFields('pane-enrich', SCHEMA.enrich.filter((f) => !onlyExt(f)));
  renderFields('pane-pdf', SCHEMA.pdf.filter((f) => !onlyExt(f)));
  renderFields('pane-library', SCHEMA.library.filter((f) => !onlyExt(f)));
  renderProviders();
  refreshCacheStat();
}

function renderFields(paneId, fields, containerId) {
  const pane = document.getElementById(paneId);
  const card = el('div', { class: 'card' });
  const container = containerId ? el('div', { id: containerId }) : card;
  if (containerId) pane.appendChild(container);
  for (const f of fields) container.appendChild(renderField(f));
  if (!containerId) pane.appendChild(card);
}

function renderField(f) {
  const value = getPath(settings, f.path);
  if (f.type === 'bool') {
    const input = el('input', { type: 'checkbox' });
    input.checked = !!value;
    input.addEventListener('change', () => save(f.path, input.checked));
    return el('div', { class: 'switch' }, [
      input,
      el('div', { class: 'sw-body' }, [
        el('div', { class: 'sw-title', text: f.title }),
        f.hint ? el('div', { class: 'sw-hint', text: f.hint }) : null,
      ]),
    ]);
  }
  let input;
  if (f.type === 'select') {
    input = el('select');
    for (const [v, label] of f.options) {
      const opt = el('option', { value: v, text: label });
      if (String(value) === String(v)) opt.selected = true;
      input.appendChild(opt);
    }
    input.addEventListener('change', () => save(f.path, input.value));
  } else if (f.type === 'list') {
    input = el('input', { type: 'text', value: Array.isArray(value) ? value.join(', ') : String(value ?? '') });
    input.addEventListener('change', () =>
      save(
        f.path,
        input.value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      )
    );
  } else if (f.type === 'number') {
    input = el('input', { type: 'number', value: value ?? '', min: f.min, max: f.max, step: f.step || 1 });
    input.addEventListener('change', () => save(f.path, Number(input.value)));
  } else {
    input = el('input', { type: f.type === 'password' ? 'password' : 'text', value: value ?? '', autocomplete: 'off', spellcheck: 'false' });
    input.addEventListener('change', () => save(f.path, input.value.trim()));
  }
  return el('label', { class: 'field' }, [
    el('span', { class: 'lab', text: f.title }),
    input,
    f.hint ? el('span', { class: 'hint', text: f.hint }) : null,
  ]);
}

function renderProviders() {
  const box = document.getElementById('provider-list');
  box.innerHTML = '';
  const chosen = settings.translation.providers || [];
  const list = PROVIDERS.filter((p) => !(p.extOnly && !isExtension()));
  for (const p of list) {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = chosen.includes(p.id);
    cb.addEventListener('change', async () => {
      const next = list.map((x) => x.id).filter((id) =>
        id === p.id ? cb.checked : (settings.translation.providers || []).includes(id)
      );
      if (!next.length) {
        cb.checked = true;
        toast('ต้องเลือกอย่างน้อย 1 ผู้ให้บริการ');
        return;
      }
      await save('translation.providers', next);
    });
    const status = el('span', { class: 'status' });
    const testBtn = el('button', { class: 'btn sm', text: 'ทดสอบ' });
    testBtn.addEventListener('click', async () => {
      status.className = 'status';
      status.textContent = 'กำลังทดสอบ…';
      try {
        const r = await send({ type: 'testProvider', provider: p.id });
        status.className = 'status ok';
        status.textContent = `✓ "${r.translation}" (${r.ms} ms)`;
      } catch (err) {
        status.className = 'status err';
        status.textContent = `✗ ${err.message}`;
      }
    });
    box.appendChild(
      el('div', { class: 'prov' }, [
        cb,
        el('div', { class: 'p-body' }, [
          el('div', { class: 'p-title', text: p.label }),
          el('div', { class: 'p-note', text: p.note }),
        ]),
        testBtn,
        status,
      ])
    );
  }
}

/* ------------------------------------------------------------------ */
/* อ่าน/บันทึกค่า                                                       */
/* ------------------------------------------------------------------ */

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof cur[keys[i]] !== 'object' || cur[keys[i]] === null) cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}

async function save(path, value) {
  const patch = {};
  setPath(patch, path, value);
  settings = await setSettings(patch);
  applyTheme(settings);
  if (path === 'ai.provider') {
    const meta = AI_PROVIDERS[value];
    if (meta) {
      settings = await setSettings({ ai: { baseUrl: meta.defaultBase, model: meta.defaultModel } });
      renderAll();
    }
  }
  toast('บันทึกแล้ว ✓', 1100);
}

/* ------------------------------------------------------------------ */
/* แท็บและปุ่มต่าง ๆ                                                    */
/* ------------------------------------------------------------------ */

function bindTabs() {
  document.querySelectorAll('#tabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#tabs .tab').forEach((t) => t.classList.toggle('is-active', t === tab));
      document.querySelectorAll('.pane').forEach((p) => p.classList.add('hidden'));
      document.getElementById(`pane-${tab.dataset.tab}`).classList.remove('hidden');
      location.hash = tab.dataset.tab;
    });
  });
  const hash = location.hash.replace('#', '');
  if (hash) document.querySelector(`#tabs .tab[data-tab="${hash}"]`)?.click();
}

function bindActions() {
  document.getElementById('btn-open-library').addEventListener('click', () => send({ type: 'openPage', page: 'library' }));
  document.getElementById('btn-open-review').addEventListener('click', () => send({ type: 'openPage', page: 'review' }));

  document.getElementById('btn-test-ai').addEventListener('click', async () => {
    const status = document.getElementById('ai-status');
    status.className = 'status';
    status.textContent = 'กำลังทดสอบ… (อาจใช้เวลา 5-20 วินาที)';
    try {
      const r = await send({ type: 'testProvider', provider: 'ai', text: 'resilient' });
      status.className = 'status ok';
      status.textContent = `✓ ตอบกลับใน ${r.ms} ms — "${r.translation}"`;
    } catch (err) {
      status.className = 'status err';
      status.textContent = `✗ ${err.message}`;
    }
  });

  document.getElementById('btn-export-json').addEventListener('click', async () => {
    const data = await send({ type: 'db:export' });
    download(`atthai-vocab-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2));
    toast(`ส่งออก ${data.count} คำ`);
  });

  document.getElementById('btn-export-csv').addEventListener('click', async () => {
    const data = await send({ type: 'db:export' });
    const headers = [
      { label: 'คำ', get: (w) => w.word },
      { label: 'คำแปล', get: (w) => w.translation },
      { label: 'ชนิดคำ', get: (w) => w.partOfSpeech },
      { label: 'คำอ่าน', get: (w) => w.reading },
      { label: 'ความหมายในบริบท', get: (w) => w.contextMeaning },
      { label: 'บริบท', get: (w) => w.context },
      { label: 'คำพ้อง', get: (w) => (w.synonyms || []).map((s) => s.word).join('; ') },
      { label: 'ตัวอย่าง', get: (w) => (w.examples || []).map((e) => `${e.en} = ${e.th}`).join(' | ') },
      { label: 'ตัวช่วยจำ', get: (w) => w.memoryHook },
      { label: 'แท็ก', get: (w) => (w.tags || []).join('; ') },
      { label: 'บันทึกเมื่อ', get: (w) => new Date(w.createdAt).toISOString().slice(0, 10) },
      { label: 'แหล่งที่มา', get: (w) => w.sourceUrl || w.sourceTitle },
    ];
    download(`atthai-vocab-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(data.words, headers), 'text/csv');
    toast(`ส่งออก ${data.count} คำ`);
  });

  document.getElementById('btn-import').addEventListener('click', () => document.getElementById('import-file').click());
  document.getElementById('import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const res = await send({ type: 'db:import', payload, merge: true });
      toast(`นำเข้าสำเร็จ: ใหม่ ${res.added} คำ, รวมกับของเดิม ${res.merged} คำ`);
    } catch (err) {
      toast(`นำเข้าไม่สำเร็จ: ${err.message}`, 3200);
    } finally {
      e.target.value = '';
    }
  });

  document.getElementById('btn-clear-cache').addEventListener('click', async () => {
    const r = await send({ type: 'clearCache' });
    toast(`ล้างแคช ${r.removed} รายการ`);
    refreshCacheStat();
  });

  document.getElementById('btn-reset-settings').addEventListener('click', async () => {
    if (!confirm('คืนค่าตั้งต้นทั้งหมด? (คลังคำศัพท์จะไม่ถูกลบ)')) return;
    settings = await send({ type: 'resetSettings' });
    renderAll();
    toast('คืนค่าตั้งต้นแล้ว');
  });

  document.getElementById('btn-clear-library').addEventListener('click', async () => {
    if (!confirm('ลบคำศัพท์ทั้งหมดในคลัง? การกระทำนี้ย้อนกลับไม่ได้')) return;
    const { items } = await send({ type: 'db:list', options: {} });
    await send({ type: 'db:delete', ids: items.map((w) => w.id) });
    toast(`ลบแล้ว ${items.length} คำ`);
  });
}

async function refreshCacheStat() {
  try {
    const s = await send({ type: 'stats' });
    const kb = Math.round((s.cache?.bytes || 0) / 1024);
    document.getElementById('cache-stat').textContent = `${s.cache?.count || 0} รายการ · ~${kb} KB`;
  } catch {
    document.getElementById('cache-stat').textContent = '—';
  }
}
