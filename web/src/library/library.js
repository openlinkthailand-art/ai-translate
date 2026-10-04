import { send, getSettings, applyTheme, toast, el, escapeHtml, fmtDate, fmtRelative, dueLabel, download, toCsv , addWebNav} from '../ui/api.js';

const $ = (id) => document.getElementById(id);
const state = {
  settings: null,
  query: '',
  sort: 'newest',
  tag: '',
  starredOnly: false,
  dueOnly: false,
  expanded: new Set(),
  words: [],
};

init();

async function init() {
  addWebNav();
  state.settings = await getSettings();
  applyTheme(state.settings);
  bind();
  await refreshTags();
  await load();
}

function bind() {
  let timer = null;
  $('q').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.query = e.target.value.trim();
      load();
    }, 180);
  });
  $('sort').addEventListener('change', (e) => {
    state.sort = e.target.value;
    load();
  });
  $('tag').addEventListener('change', (e) => {
    state.tag = e.target.value;
    load();
  });
  $('only-star').addEventListener('click', (e) => {
    state.starredOnly = !state.starredOnly;
    e.currentTarget.classList.toggle('primary', state.starredOnly);
    load();
  });
  $('only-due').addEventListener('click', (e) => {
    state.dueOnly = !state.dueOnly;
    e.currentTarget.classList.toggle('primary', state.dueOnly);
    load();
  });
  $('btn-review').addEventListener('click', () => send({ type: 'openPage', page: 'review' }));
  $('btn-options').addEventListener('click', () => send({ type: 'openPage', page: 'options' }));
  $('btn-export-json').addEventListener('click', exportJson);
  $('btn-export-csv').addEventListener('click', exportCsv);
  $('btn-import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', importFile);
}

async function load() {
  const res = await send({
    type: 'db:list',
    options: { query: state.query, tag: state.tag, sort: state.sort, starredOnly: state.starredOnly, dueOnly: state.dueOnly },
  });
  state.words = res.items;
  render(res.total);
}

async function refreshTags() {
  const tags = await send({ type: 'db:tags' }).catch(() => []);
  const sel = $('tag');
  sel.innerHTML = '<option value="">ทุกแท็ก</option>' + tags.map((t) => `<option value="${escapeHtml(t.tag)}">${escapeHtml(t.tag)} (${t.count})</option>`).join('');
  sel.value = state.tag;
}

function render(total) {
  const stats = $('summary');
  stats.textContent = `ทั้งหมด ${total} คำ · แสดง ${state.words.length} คำ`;
  const box = $('list');
  if (!state.words.length) {
    box.innerHTML = `<div class="empty"><div class="big">📖</div><p>ยังไม่มีคำศัพท์ที่ตรงเงื่อนไข</p>
      <p class="small">ลองดับเบิลคลิกคำบนหน้าเว็บหรือใน PDF แล้วกด "บันทึกเข้าคลังคำ"</p></div>`;
    return;
  }
  box.innerHTML = '';
  for (const w of state.words) box.appendChild(wordCard(w));
}

function wordCard(w) {
  const isOpen = state.expanded.has(w.id);
  const card = el('div', { class: 'word', 'data-id': w.id });
  card.innerHTML = `
    <div class="w-head">
      ${w.starred ? '<span class="star">★</span>' : ''}
      <span class="w-term">${escapeHtml(w.word)}</span>
      <span class="w-tr">${escapeHtml(w.translation)}</span>
      ${w.partOfSpeech ? `<span class="chip">${escapeHtml(w.partOfSpeech)}</span>` : ''}
      ${w.aiUsed ? '<span class="chip on">AI</span>' : ''}
      <div class="spacer"></div>
      <span class="chip">${escapeHtml(dueLabel(w.srs?.due))}</span>
    </div>
    ${w.contextMeaning ? `<div class="w-ctx">${escapeHtml(w.contextMeaning.slice(0, 150))}</div>` : ''}
    <div class="w-meta">
      ${(w.synonyms || []).slice(0, 5).map((s) => `<span class="chip">${escapeHtml(s.word)}</span>`).join('')}
      ${(w.tags || []).map((t) => `<span class="chip">#${escapeHtml(t)}</span>`).join('')}
    </div>
    <div class="w-src">${escapeHtml(fmtRelative(w.createdAt))}${w.sourceTitle ? ' · ' + escapeHtml(w.sourceTitle.slice(0, 60)) : ''}</div>
    <div class="detail ${isOpen ? '' : 'hidden'}"></div>`;

  card.addEventListener('click', (e) => {
    if (e.target.closest('button, input, textarea, a')) return;
    if (state.expanded.has(w.id)) state.expanded.delete(w.id);
    else state.expanded.add(w.id);
    card.querySelector('.detail').classList.toggle('hidden');
    if (state.expanded.has(w.id) && !card.querySelector('.detail').dataset.built) {
      buildDetail(card.querySelector('.detail'), w);
    }
  });
  if (isOpen) {
    const d = card.querySelector('.detail');
    buildDetail(d, w);
  }
  return card;
}

function buildDetail(box, w) {
  box.dataset.built = '1';
  const sec = (label, inner) => `<div class="sec"><div class="lbl">${escapeHtml(label)}</div>${inner}</div>`;
  box.innerHTML = `
    ${w.literal ? sec('ความหมายตรงตัว', `<div>${escapeHtml(w.literal)}</div>`) : ''}
    ${w.definitions?.length ? sec('ความหมาย', w.definitions.map((d) => `<div>${d.pos ? `<span class="chip">${escapeHtml(d.pos)}</span> ` : ''}${escapeHtml(d.th || d.meaning)}</div>`).join('')) : ''}
    ${w.context ? sec('บริบทที่เจอ', `<div class="small muted">${escapeHtml(w.context)}</div>`) : ''}
    ${w.synonyms?.length ? sec('คำพ้อง', `<div class="tagrow">${w.synonyms.map((s) => `<span class="chip">${escapeHtml(s.word)}${s.th ? ' · ' + escapeHtml(s.th) : ''}</span>`).join('')}</div>`) : ''}
    ${w.examples?.length ? sec('ตัวอย่าง', w.examples.map((e) => `<div class="ex">${escapeHtml(e.en)}${e.th ? `<div class="th">${escapeHtml(e.th)}</div>` : ''}</div>`).join('')) : ''}
    ${w.collocations?.length ? sec('คำที่ใช้คู่กัน', `<div class="tagrow">${w.collocations.map((c) => `<span class="chip">${escapeHtml(c)}</span>`).join('')}</div>`) : ''}
    ${w.memoryHook ? sec('ตัวช่วยจำ', `<div>${escapeHtml(w.memoryHook)}</div>`) : ''}
    ${sec('โน้ตของฉัน', `<textarea class="notes" rows="2" placeholder="จดสิ่งที่อยากจำ…">${escapeHtml(w.notes || '')}</textarea>`)}
    ${sec('แท็ก', `<div class="tagrow"><input class="tags" type="text" value="${escapeHtml((w.tags || []).join(', '))}" placeholder="เช่น business, toeic" /></div>`)}
    <div class="srs">ทบทวนแล้ว ${w.reviewCount || 0} ครั้ง · รอบถัดไป ${escapeHtml(dueLabel(w.srs?.due))} · ช่วงห่าง ${w.srs?.interval || 0} วัน · ความง่าย ${w.srs?.ease || 2.5}</div>
    <div class="actions">
      <button class="btn sm" data-act="speak">🔊 ออกเสียง</button>
      <button class="btn sm" data-act="star">${w.starred ? '★ เลิกปักดาว' : '☆ ปักดาว'}</button>
      <button class="btn sm" data-act="copy">📋 คัดลอก</button>
      ${w.sourceUrl ? `<a class="btn sm" href="${escapeHtml(w.sourceUrl)}" target="_blank" rel="noreferrer">↗ เปิดแหล่งที่มา</a>` : ''}
      <div class="spacer"></div>
      <button class="btn sm danger" data-act="delete">🗑 ลบ</button>
    </div>`;

  box.querySelector('.notes').addEventListener('change', async (e) => {
    await send({ type: 'db:update', id: w.id, patch: { notes: e.target.value } });
    w.notes = e.target.value;
    toast('บันทึกโน้ตแล้ว');
  });
  box.querySelector('.tags').addEventListener('change', async (e) => {
    const tags = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
    await send({ type: 'db:update', id: w.id, patch: { tags } });
    w.tags = tags;
    await refreshTags();
    toast('บันทึกแท็กแล้ว');
    render(state.words.length);
  });
  box.querySelectorAll('[data-act]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const act = btn.dataset.act;
      if (act === 'speak') speak(w.word);
      if (act === 'copy') {
        await navigator.clipboard.writeText(`${w.word} = ${w.translation}`).catch(() => {});
        toast('คัดลอกแล้ว');
      }
      if (act === 'star') {
        await send({ type: 'db:update', id: w.id, patch: { starred: !w.starred } });
        w.starred = !w.starred;
        render(state.words.length);
      }
      if (act === 'delete') {
        if (!confirm(`ลบ "${w.word}" ออกจากคลัง?`)) return;
        await send({ type: 'db:delete', id: w.id });
        state.words = state.words.filter((x) => x.id !== w.id);
        render(state.words.length);
        toast('ลบแล้ว');
      }
    })
  );
}

function speak(text) {
  if (state.settings?.tts?.enabled === false || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const isThai = /[\u0E00-\u0E7F]/.test(text);
  u.lang = isThai ? 'th-TH' : 'en-US';
  u.rate = state.settings?.tts?.rate || 0.95;
  window.speechSynthesis.speak(u);
}

async function exportJson() {
  const data = await send({ type: 'db:export' });
  download(`atthai-vocab-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2));
  toast(`ส่งออก ${data.count} คำ`);
}

async function exportCsv() {
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
}

async function importFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const res = await send({ type: 'db:import', payload, merge: true });
    toast(`นำเข้าสำเร็จ: ใหม่ ${res.added} คำ, รวมกับของเดิม ${res.merged} คำ`);
    await refreshTags();
    await load();
  } catch (err) {
    toast(`นำเข้าไม่สำเร็จ: ${err.message}`, 3200);
  } finally {
    e.target.value = '';
  }
}
