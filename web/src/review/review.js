import { send, getSettings, applyTheme, toast, escapeHtml, dueLabel , addWebNav} from '../ui/api.js';
import { scheduleNext } from '../core/db.js';

const $ = (id) => document.getElementById(id);
const GRADE_LABEL = ['อีกครั้ง', 'ยาก', 'ดี', 'ง่าย'];

const state = {
  settings: null,
  queue: [],
  index: 0,
  revealed: false,
  counts: [0, 0, 0, 0],
  skipped: 0,
};

init();

async function init() {
  addWebNav();
  state.settings = await getSettings();
  applyTheme(state.settings);
  await refreshStats();
  bind();
}

async function refreshStats() {
  const s = await send({ type: 'stats' });
  $('st-due').textContent = s.due;
  $('st-total').textContent = s.total;
  $('st-mature').textContent = s.mature;
  $('st-star').textContent = s.starred;
  if (!s.total) {
    $('empty-hint').innerHTML =
      '<div class="empty"><div class="big">📖</div><p>ยังไม่มีคำศัพท์ในคลัง</p><p class="small">ไปอ่านหนังสือแล้วดับเบิลคลิกคำที่อยากจำ กด "บันทึกเข้าคลังคำ" แล้วกลับมาทบทวนที่นี่</p></div>';
  } else if (!s.due) {
    $('empty-hint').innerHTML = '<p class="small muted center" style="margin-top:14px">วันนี้ไม่มีคำที่ถึงกำหนดแล้ว 🎉 แต่จะทบทวนเพิ่มก็ได้</p>';
  }
}

function bind() {
  $('btn-due').addEventListener('click', () => start('due'));
  $('btn-all').addEventListener('click', () => start('all'));
  $('btn-star').addEventListener('click', () => start('star'));
  $('btn-reveal').addEventListener('click', reveal);
  $('btn-quit').addEventListener('click', finish);
  $('btn-again').addEventListener('click', () => show('start'));
  $('btn-library').addEventListener('click', () => send({ type: 'openPage', page: 'library' }));
  document.querySelectorAll('.grade').forEach((b) => b.addEventListener('click', () => grade(Number(b.dataset.g))));
  document.addEventListener('keydown', onKey);
}

async function start(mode) {
  let items = [];
  if (mode === 'due') items = await send({ type: 'db:due', limit: state.settings?.library?.reviewMaxPerDay || 100 });
  else {
    const res = await send({ type: 'db:list', options: { sort: mode === 'star' ? 'newest' : 'due', starredOnly: mode === 'star' } });
    items = res.items.slice(0, state.settings?.library?.reviewMaxPerDay || 100);
  }
  if (!items.length) {
    toast('ไม่มีคำให้ทบทวนในโหมดนี้');
    return;
  }
  state.queue = items;
  state.index = 0;
  state.counts = [0, 0, 0, 0];
  state.skipped = 0;
  show('session');
  renderCard();
}

function show(screen) {
  for (const s of ['start', 'session', 'done']) $(`screen-${s}`).classList.toggle('hidden', s !== screen);
  if (screen === 'start') refreshStats();
}

function renderCard() {
  const w = state.queue[state.index];
  if (!w) return finish();
  state.revealed = false;
  $('counter').textContent = `${state.index + 1} / ${state.queue.length}`;
  $('bar').style.width = `${(state.index / state.queue.length) * 100}%`;
  $('f-word').textContent = w.word;
  $('f-meta').textContent = [w.partOfSpeech, w.reading ? `/${w.reading}/` : '', w.sourceTitle ? `จาก: ${w.sourceTitle.slice(0, 40)}` : '']
    .filter(Boolean)
    .join(' · ');
  const masked = w.context && w.word ? escapeHtml(w.context).replace(new RegExp(escapeRe(escapeHtml(w.word)), 'gi'), '<b>▁▁▁▁</b>') : '';
  // ถ้าซ่อนคำแล้วเหลือบริบทน้อยมาก (เช่นบันทึกมาเป็นประโยคทั้งประโยค) ไม่ต้องแสดงบรรทัดนี้
  const maskedBare = masked.replace(/<[^>]+>/g, '').replace(/▁/g, '').trim();
  $('f-ctx').innerHTML = maskedBare.length >= 12 ? masked : '';
  $('answer').classList.add('hidden');
  $('answer').innerHTML = '';
  $('reveal-box').classList.remove('hidden');
  $('grades').classList.add('hidden');
}

function reveal() {
  const w = state.queue[state.index];
  if (!w || state.revealed) return;
  state.revealed = true;
  $('reveal-box').classList.add('hidden');
  $('grades').classList.remove('hidden');
  $('answer').innerHTML = `
    <div class="tr">${escapeHtml(w.translation)}</div>
    ${w.literal ? `<div class="center small muted" style="margin-top:4px">ตรงตัว: ${escapeHtml(w.literal)}</div>` : ''}
    ${w.contextMeaning ? `<div class="sec"><div class="lbl">ในบริบทนี้</div><div>${escapeHtml(w.contextMeaning)}</div></div>` : ''}
    ${w.memoryHook ? `<div class="sec"><div class="lbl">🧠 ตัวช่วยจำ</div><div class="hook">${escapeHtml(w.memoryHook)}</div></div>` : ''}
    ${w.synonyms?.length ? `<div class="sec"><div class="lbl">คำพ้อง</div><div class="row wrap-row">${w.synonyms.slice(0, 8).map((s) => `<span class="chip">${escapeHtml(s.word)}${s.th ? ' · ' + escapeHtml(s.th) : ''}</span>`).join('')}</div></div>` : ''}
    ${w.examples?.length ? `<div class="sec"><div class="lbl">ตัวอย่าง</div>${w.examples.slice(0, 3).map((e) => `<div class="ex">${escapeHtml(e.en)}${e.th ? `<div class="th">${escapeHtml(e.th)}</div>` : ''}</div>`).join('')}</div>` : ''}
    ${w.notes ? `<div class="sec"><div class="lbl">โน้ตของฉัน</div><div class="small muted">${escapeHtml(w.notes)}</div></div>` : ''}`;
  $('answer').classList.remove('hidden');
  $('answer').scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  for (let g = 0; g < 4; g++) {
    const next = scheduleNext(w.srs, g);
    const days = next.interval;
    $(`i${g}`).textContent = days ? `อีก ${days} วัน` : 'อีก 10 นาที';
  }
  speak(w.word);
}

async function grade(g) {
  const w = state.queue[state.index];
  if (!w || !state.revealed) return;
  try {
    const updated = await send({ type: 'db:review', id: w.id, grade: g });
    w.srs = updated.srs;
  } catch (err) {
    toast(err.message);
  }
  state.counts[g] += 1;
  state.index += 1;
  if (state.index >= state.queue.length) finish();
  else renderCard();
}

function finish() {
  const total = state.counts.reduce((a, b) => a + b, 0);
  if (!total) {
    show('start');
    return;
  }
  $('done-summary').innerHTML = `ทบทวน ${total} คำ · ${state.counts
    .map((c, i) => `${GRADE_LABEL[i]} ${c}`)
    .join(' · ')}`;
  show('done');
  send({ type: 'stats' }).catch(() => {});
}

function onKey(e) {
  if ($('screen-session').classList.contains('hidden')) return;
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
  if (e.code === 'Space' || e.key === 'Enter') {
    e.preventDefault();
    if (!state.revealed) reveal();
    return;
  }
  if (state.revealed && ['1', '2', '3', '4'].includes(e.key)) {
    e.preventDefault();
    grade(Number(e.key) - 1);
    return;
  }
  if (e.key.toLowerCase() === 's') {
    state.skipped += 1;
    state.index += 1;
    if (state.index >= state.queue.length) finish();
    else renderCard();
  }
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function speak(text) {
  if (state.settings?.tts?.enabled === false || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = /[\u0E00-\u0E7F]/.test(text) ? 'th-TH' : 'en-US';
    u.rate = state.settings?.tts?.rate || 0.95;
    window.speechSynthesis.speak(u);
  } catch {
    /* ไม่มีเสียง */
  }
}
