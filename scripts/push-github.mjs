/**
 * push โปรเจกต์ขึ้น GitHub ด้วยโทเคนที่ผู้ใช้ให้มา (ไม่เก็บโทเคนลงดิสก์)
 *
 * วิธีใช้:
 *   GITHUB_TOKEN=ghp_xxx node scripts/push-github.mjs
 *   GITHUB_TOKEN=ghp_xxx node scripts/push-github.mjs openlinkthailand-art/ai-translate
 *
 * สคริปต์จะ
 *   1) ตรวจว่าโทเคนเป็นของบัญชีใด
 *   2) สร้าง repo ให้ถ้ายังไม่มี (สาธารณะ)
 *   3) push สาขาปัจจุบันขึ้น main โดยไม่บันทึกโทเคนไว้ใน git config
 *   4) บอก URL ของแอปมือถือหลังเปิด GitHub Pages
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const target = process.argv[2] || 'openlinkthailand-art/ai-translate';

/** ใช้ throw แทน process.exit เพื่อให้ event loop ปิดตัวเองสะอาด */
class Stop extends Error {}
function fail(message, hint = '') {
  console.error(`\n✗ ${message}`);
  if (hint) console.error(`  ${hint}`);
  // ใช้ throw แทน process.exit เพื่อให้ Node ปิดตัวเองสะอาด (ไม่เกิด assertion ของ libuv บน Windows)
  throw new Stop();
}

function git(args, options = {}) {
  return execFileSync('git', args, { cwd: root, stdio: 'pipe', encoding: 'utf8', ...options });
}

async function api(pathname, init = {}) {
  const res = await fetch(`https://api.github.com${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'atthai-push-script',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* ไม่ใช่ JSON */
  }
  return { ok: res.ok, status: res.status, json, text };
}

async function main() {
  if (!token) {
    fail('ยังไม่ได้ใส่โทเคน', 'ตัวอย่าง: GITHUB_TOKEN=ghp_xxx node scripts/push-github.mjs');
  }

  const [owner, repo] = target.split('/');
  if (!owner || !repo) fail(`รูปแบบ repo ไม่ถูกต้อง: ${target}`, 'ต้องเป็น owner/repo เช่น openlinkthailand-art/ai-translate');

  if (!fs.existsSync(path.join(root, '.git'))) fail('ยังไม่ได้ git init ในโปรเจกต์นี้');

  /* 1) โทเคนเป็นของใคร */
  const me = await api('/user');
  if (!me.ok) {
    fail(
      `โทเคนใช้ไม่ได้ (HTTP ${me.status})`,
      me.status === 401 ? 'โทเคนผิด/หมดอายุ หรือพิมพ์ไม่ครบ' : me.text.slice(0, 160)
    );
  }
  const login = me.json.login;
  console.log(`โทเคนเป็นของบัญชี: ${login}`);
  if (login.toLowerCase() !== owner.toLowerCase()) {
    console.warn(`  ⚠ บัญชีไม่ตรงกับเจ้าของ repo (${owner}) — จะลองต่อไป แต่ถ้าไม่มีสิทธิ์จะ push ไม่ได้`);
  }

  /* 2) repo มีอยู่หรือยัง */
  const existing = await api(`/repos/${owner}/${repo}`);
  if (!existing.ok && existing.status === 404) {
    console.log(`ยังไม่มี repo ${owner}/${repo} — กำลังสร้างให้…`);
    const created = await api('/user/repos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: repo,
        description: 'อ่านไทย Translate Reader — แปลคำพร้อมบริบท ตัวอย่างประโยค คำพ้อง และคลังคำศัพท์สำหรับคนไทยอ่านหนังสืออังกฤษ (Chrome extension + PWA มือถือ)',
        private: false,
        has_issues: true,
        has_wiki: false,
        auto_init: false,
      }),
    });
    if (!created.ok) {
      fail(
        `สร้าง repo ไม่สำเร็จ (HTTP ${created.status})`,
        created.json?.message || created.text.slice(0, 200)
      );
    }
    console.log(`  ✓ สร้าง repo แล้ว: ${created.json.html_url}`);
  } else if (existing.ok) {
    console.log(`repo มีอยู่แล้ว: ${existing.json.html_url} (${existing.json.visibility})`);
    if (!existing.json.permissions?.push) {
      fail('โทเคนนี้ไม่มีสิทธิ์เขียนใน repo นี้', 'ต้องเป็นเจ้าของ repo หรือได้รับสิทธิ์ write');
    }
  } else {
    fail(`ตรวจ repo ไม่ได้ (HTTP ${existing.status})`, existing.json?.message || existing.text.slice(0, 160));
  }

  /* 3) push (โทเคนอยู่ใน URL ชั่วคราว ไม่ถูกบันทึกลง git config) */
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  const commitCount = git(['rev-list', '--count', 'HEAD']).trim();
  console.log(`กำลัง push สาขา ${branch} (${commitCount} commit) ขึ้น ${owner}/${repo} …`);

  const pushUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  const runPush = (extra = []) => git(['push', pushUrl, `${branch}:main`, ...extra], { env });

  try {
    const out = runPush();
    console.log(out.trim() || '  ✓ push สำเร็จ');
  } catch (err) {
    const first = `${err.stderr || ''}${err.stdout || ''}`;
    // repo ที่มีประวัติอยู่ก่อน (เช่นสร้างพร้อม README) จะถูกปฏิเสธ — ลองทับด้วย --force-with-lease
    if (/rejected|non-fast-forward|fetch first/i.test(first)) {
      console.log('  ! ปลายทางมีประวัติอยู่ก่อน กำลัง push ทับด้วย --force-with-lease …');
      try {
        const out = runPush(['--force-with-lease']);
        console.log(out.trim() || '  ✓ push สำเร็จ');
      } catch (err2) {
        const msg = `${err2.stderr || ''}${err2.stdout || ''}`.replace(token, '***');
        fail('push ไม่สำเร็จ', msg.split('\n').slice(0, 6).join('\n  '));
      }
    } else {
      fail('push ไม่สำเร็จ', first.replace(token, '***').split('\n').slice(0, 6).join('\n  '));
    }
  }

  /* 4) ตั้ง remote ให้เป็น URL ปกติ (ไม่มีโทเคน) */
  try {
    const remotes = git(['remote']).split('\n').map((s) => s.trim());
    if (remotes.includes('origin')) git(['remote', 'set-url', 'origin', `https://github.com/${owner}/${repo}.git`]);
    else git(['remote', 'add', 'origin', `https://github.com/${owner}/${repo}.git`]);
  } catch {
    /* ไม่สำคัญ */
  }

  console.log('\n✓ push สำเร็จ');
  console.log(`  โค้ด: https://github.com/${owner}/${repo}`);

  /* 5) เปิด GitHub Pages ให้ และสั่งรัน workflow เพื่อให้แอปมือถือออนไลน์ทันที */
  const siteUrl = `https://${owner.toLowerCase()}.github.io/${repo}/`;
  let pagesReady = false;
  try {
    const pages = await api(`/repos/${owner}/${repo}/pages`);
    if (pages.ok) {
      pagesReady = true;
      console.log(`  ✓ GitHub Pages เปิดอยู่แล้ว: ${pages.json.html_url || siteUrl}`);
    } else if (pages.status === 404) {
      const created = await api(`/repos/${owner}/${repo}/pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ build_type: 'workflow' }),
      });
      if (created.ok || created.status === 409) {
        pagesReady = true;
        console.log('  ✓ เปิด GitHub Pages (โหมด GitHub Actions) แล้ว');
      } else {
        console.log(`  ! เปิด Pages อัตโนมัติไม่ได้ (HTTP ${created.status}) — เปิดเองที่ Settings → Pages`);
      }
    } else {
      console.log(`  ! ตรวจสถานะ Pages ไม่ได้ (HTTP ${pages.status})`);
    }
  } catch (err) {
    console.log(`  ! เปิด Pages อัตโนมัติไม่สำเร็จ: ${err.message}`);
  }

  if (pagesReady) {
    try {
      const dispatched = await api(`/repos/${owner}/${repo}/actions/workflows/pages.yml/dispatches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: 'main' }),
      });
      if (dispatched.status === 204) {
        console.log('  ✓ สั่งรัน workflow ประกอบและเผยแพร่แอปมือถือแล้ว (ใช้เวลาประมาณ 1 นาที)');
      } else {
        console.log(`  ! สั่งรัน workflow ไม่ได้ (HTTP ${dispatched.status}) — กด Run workflow เองในแท็บ Actions`);
      }
    } catch (err) {
      console.log(`  ! สั่งรัน workflow ไม่สำเร็จ: ${err.message}`);
    }
  }

  console.log('\nเสร็จแล้ว — ขั้นต่อไป:');
  console.log(`  1. เปิดแอปมือถือที่ ${siteUrl} ด้วย Chrome on Android`);
  console.log('  2. เมนู ⋮ → "ติดตั้งแอป" (หรือ "เพิ่มลงในหน้าจอหลัก")');
  console.log('  3. ทดสอบ: เลือกข้อความในแอปใดก็ได้ → แชร์ → อ่านไทย');
  if (!pagesReady) {
    console.log(`\n  (ถ้ายังไม่เห็นแอป ให้เปิด Pages เองที่ https://github.com/${owner}/${repo}/settings/pages → Source: GitHub Actions)`);
  }
}

main().catch((err) => {
  if (!(err instanceof Stop)) {
    console.error(err?.stack || String(err));
  }
  process.exitCode = 1;
});
