import { send, getSettings, setSettings, applyTheme, toast, escapeHtml, fmtRelative } from '../ui/api.js';

const $ = (id) => document.getElementById(id);
let settings = null;
let activeTab = null;

init();

async function init() {
  $('version').textContent = 'v' + (chrome.runtime.getManifest().version || '1.0.0');
  settings = await getSettings();
  applyTheme(settings);
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  bindUi();
  await refreshStats();
  await refreshRecent();
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function bindUi() {
  const host = hostOf(activeTab?.url || '');
  $('site-host').textContent = host || 'ใช้ได้เฉพาะหน้าเว็บ http/https';
  $('tg-site').disabled = !host;

  $('tg-enabled').checked = settings.general.enabled !== false;
  $('tg-pdf').checked = settings.pdf?.autoOpen !== false;
  $('tg-ai').checked = !!settings.ai?.enabled;
  $('tg-site').checked = host ? !(settings.general.disabledSites || []).includes(host) : true;
  if (settings.ai?.enabled) $('ai-hint').textContent = `${settings.ai.provider} · ${settings.ai.model}`;

  $('tg-enabled').addEventListener('change', async (e) => {
    settings = await setSettings({ general: { enabled: e.target.checked } });
    toast(e.target.checked ? 'เปิดใช้งานแล้ว' : 'ปิดการแปลบนหน้าเว็บ');
  });

  $('tg-pdf').addEventListener('change', async (e) => {
    settings = await setSettings({ pdf: { autoOpen: e.target.checked } });
    toast(e.target.checked ? 'จะเปิด PDF ในโหมดอ่านแปล' : 'ปิดการเปิด PDF อัตโนมัติ');
  });

  $('tg-ai').addEventListener('change', async (e) => {
    settings = await setSettings({ ai: { enabled: e.target.checked } });
    toast(e.target.checked ? 'เปิด AI ช่วยอธิบาย' : 'ปิด AI');
  });

  $('tg-site').addEventListener('change', async (e) => {
    const list = new Set(settings.general.disabledSites || []);
    if (e.target.checked) list.delete(host);
    else list.add(host);
    settings = await setSettings({ general: { disabledSites: [...list] } });
    toast(e.target.checked ? `เปิดบน ${host} แล้ว` : `ปิดบน ${host} แล้ว`);
  });

  $('btn-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('btn-library').addEventListener('click', () => openPage('library'));
  $('btn-all').addEventListener('click', () => openPage('library'));
  $('btn-review').addEventListener('click', () => openPage('review'));
  $('q-go').addEventListener('click', runQuick);
  $('q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runQuick();
  });
}

function openPage(page) {
  send({ type: 'openPage', page }).catch((err) => toast(err.message));
  window.close();
}

async function refreshStats() {
  try {
    const s = await send({ type: 'stats' });
    $('s-total').textContent = s.total;
    $('s-due').textContent = s.due;
    $('s-today').textContent = s.addedToday;
    $('due-badge').textContent = s.due ? `(${s.due})` : '';
  } catch {
    /* ยังไม่มีข้อมูล */
  }
}

async function refreshRecent() {
  try {
    const { items } = await send({ type: 'db:list', options: { sort: 'newest', limit: 5 } });
    const box = $('recent');
    if (!items.length) {
      box.innerHTML = '<p class="small muted center" style="padding:14px 0">ยังไม่มีคำที่บันทึกไว้<br>ลองดับเบิลคลิกคำบนหน้าเว็บดู</p>';
      return;
    }
    box.innerHTML = items
      .map(
        (w) => `<div class="word" data-id="${escapeHtml(w.id)}">
          <div class="w-head"><span class="w-term">${escapeHtml(w.word)}</span><span class="w-tr">${escapeHtml(w.translation)}</span></div>
          <div class="w-ctx">${escapeHtml((w.contextMeaning || w.context || '').slice(0, 90))}</div>
          <div class="w-src">${escapeHtml(fmtRelative(w.createdAt))}</div>
        </div>`
      )
      .join('');
    box.querySelectorAll('.word').forEach((n) =>
      n.addEventListener('click', () => openPage('library'))
    );
  } catch {
    /* ไม่มีข้อมูล */
  }
}

async function runQuick() {
  const text = $('q').value.trim();
  if (!text) return;
  const box = $('q-result');
  box.innerHTML = '<div class="result"><div class="muted small">กำลังแปล…</div></div>';
  $('q-go').disabled = true;
  try {
    const r = await send({
      type: 'translate',
      text,
      context: text,
      mode: 'auto',
      sourceType: 'popup',
      pageTitle: activeTab?.title || '',
      pageUrl: activeTab?.url || '',
    });
    renderResult(r);
  } catch (err) {
    box.innerHTML = `<div class="result"><div style="color:var(--danger)">⚠️ ${escapeHtml(err.message)}</div></div>`;
  } finally {
    $('q-go').disabled = false;
  }
}

function renderResult(r) {
  const syns = (r.synonyms || [])
    .slice(0, 8)
    .map((s) => `<span class="chip">${escapeHtml(s.word)}${s.th ? ` · ${escapeHtml(s.th)}` : ''}</span>`)
    .join('');
  const ex = (r.examples || [])
    .slice(0, 2)
    .map((e) => `<div class="ex">${escapeHtml(e.en)}${e.th ? `<div class="th">${escapeHtml(e.th)}</div>` : ''}</div>`)
    .join('');
  $('q-result').innerHTML = `
    <div class="result">
      <div class="tr">${escapeHtml(r.translation)}</div>
      ${r.partOfSpeech || r.reading ? `<div class="small muted">${escapeHtml([r.partOfSpeech, r.reading ? '/' + r.reading + '/' : ''].filter(Boolean).join(' · '))}</div>` : ''}
      ${r.contextMeaning ? `<div class="small" style="margin-top:6px">${escapeHtml(r.contextMeaning)}</div>` : ''}
      ${syns ? `<div class="sec"><div class="lbl">คำพ้องที่ใช้ง่าย</div><div class="chips">${syns}</div></div>` : ''}
      ${ex ? `<div class="sec"><div class="lbl">ตัวอย่าง</div>${ex}</div>` : ''}
      <div class="row" style="margin-top:9px">
        <button class="btn sm primary" id="q-save">บันทึกเข้าคลังคำ</button>
        <button class="btn sm" id="q-copy">คัดลอก</button>
        <div class="spacer"></div>
        <span class="small muted">${escapeHtml(r.provider || '')}${r.aiUsed ? ' · AI' : ''}</span>
      </div>
    </div>`;
  $('q-save')?.addEventListener('click', async () => {
    try {
      await send({ type: 'saveWord', entry: r, pageTitle: activeTab?.title || '', pageUrl: activeTab?.url || '', sourceType: 'popup' });
      toast('บันทึกแล้ว ✓');
      await refreshStats();
      await refreshRecent();
    } catch (err) {
      toast(err.message);
    }
  });
  $('q-copy')?.addEventListener('click', async () => {
    const text = [
      `${r.query}${r.reading ? ` /${r.reading}/` : ''}`,
      `= ${r.translation}`,
      r.contextMeaning ? `บริบท: ${r.contextMeaning}` : '',
      (r.synonyms || []).length ? `คำพ้อง: ${r.synonyms.map((s) => s.word).join(', ')}` : '',
      ...(r.examples || []).map((e) => `• ${e.en} → ${e.th}`),
    ]
      .filter(Boolean)
      .join('\n');
    await navigator.clipboard.writeText(text).catch(() => {});
    toast('คัดลอกแล้ว');
  });
}
