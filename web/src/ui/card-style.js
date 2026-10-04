/** CSS ของการ์ดแปล (อยู่ใน Shadow DOM จึงไม่ชนกับ CSS ของเว็บต้นทาง) */
export const CARD_CSS = `
:host {
  all: initial;
  position: fixed;
  z-index: 2147483645;
  top: 0; left: 0;
  font-family: "Noto Sans Thai", "Sarabun", "Leelawadee UI", "Segoe UI", system-ui, -apple-system, sans-serif;
}
* { box-sizing: border-box; margin: 0; padding: 0; }

.at-card {
  --at-bg: #ffffff;
  --at-bg-soft: #f6f7f9;
  --at-bg-chip: #eef1f5;
  --at-fg: #14181f;
  --at-fg-muted: #5c6675;
  --at-border: #e3e7ee;
  --at-accent: #0f766e;
  --at-accent-soft: #e6f4f2;
  --at-warn: #b45309;
  --at-danger: #b91c1c;
  width: var(--at-width, 400px);
  max-width: min(94vw, 560px);
  max-height: min(78vh, 760px);
  display: flex;
  flex-direction: column;
  background: var(--at-bg);
  color: var(--at-fg);
  border: 1px solid var(--at-border);
  border-radius: 14px;
  box-shadow: 0 18px 50px rgba(15, 23, 42, .22), 0 2px 8px rgba(15, 23, 42, .10);
  overflow: hidden;
  font-size: 14px;
  line-height: 1.55;
  animation: at-in .14s ease-out;
}
.at-card[data-theme="dark"] {
  --at-bg: #171a21;
  --at-bg-soft: #1e222b;
  --at-bg-chip: #262b36;
  --at-fg: #e8ecf3;
  --at-fg-muted: #9aa5b6;
  --at-border: #2c323d;
  --at-accent: #4fd1c5;
  --at-accent-soft: #1d3b39;
  --at-warn: #fbbf24;
  --at-danger: #f87171;
}
@keyframes at-in { from { opacity: 0; transform: translateY(-6px) scale(.985); } to { opacity: 1; transform: none; } }

/* ---------- header ---------- */
.at-head {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 10px 12px;
  background: var(--at-bg-soft);
  border-bottom: 1px solid var(--at-border);
  cursor: grab;
  user-select: none;
}
.at-head.at-dragging { cursor: grabbing; }
.at-head-main { flex: 1; min-width: 0; }
.at-query {
  font-size: 17px; font-weight: 700; letter-spacing: -.01em;
  word-break: break-word; line-height: 1.3;
}
.at-query-sm { font-size: 14px; font-weight: 600; }
.at-sub { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 4px; }
.at-chip {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 1px 7px; border-radius: 999px;
  background: var(--at-bg-chip); color: var(--at-fg-muted);
  font-size: 11px; white-space: nowrap;
}
.at-chip.at-pos { background: var(--at-accent-soft); color: var(--at-accent); font-weight: 600; }
.at-chip.at-ai { background: #ede9fe; color: #6d28d9; font-weight: 600; }
.at-chip.at-cache { background: #ecfdf5; color: #047857; }
.at-card[data-theme="dark"] .at-chip.at-ai { background: #2e1065; color: #c4b5fd; }
.at-card[data-theme="dark"] .at-chip.at-cache { background: #052e26; color: #6ee7b7; }
.at-tools { display: flex; gap: 2px; flex-shrink: 0; }
.at-iconbtn {
  width: 26px; height: 26px; display: grid; place-items: center;
  border: 0; border-radius: 7px; background: transparent; color: var(--at-fg-muted);
  cursor: pointer; font-size: 14px; line-height: 1;
}
.at-iconbtn:hover { background: var(--at-bg-chip); color: var(--at-fg); }
.at-iconbtn.at-on { background: var(--at-accent-soft); color: var(--at-accent); }

/* ---------- body ---------- */
.at-body { overflow-y: auto; overscroll-behavior: contain; padding: 11px 12px 4px; }
.at-body::-webkit-scrollbar { width: 9px; }
.at-body::-webkit-scrollbar-thumb { background: var(--at-border); border-radius: 9px; }

.at-translation {
  font-size: 20px; font-weight: 700; color: var(--at-accent);
  line-height: 1.45; word-break: break-word;
}
.at-literal { margin-top: 3px; font-size: 12.5px; color: var(--at-fg-muted); }
.at-section { margin-top: 12px; }
.at-label {
  display: flex; align-items: center; gap: 5px;
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em;
  color: var(--at-fg-muted); margin-bottom: 5px;
}
.at-note {
  background: var(--at-bg-soft); border-left: 3px solid var(--at-accent);
  padding: 7px 10px; border-radius: 0 8px 8px 0; font-size: 13px;
}
.at-hook {
  background: linear-gradient(180deg, #fffbeb, #fef3c7);
  color: #78350f; padding: 8px 10px; border-radius: 9px; font-size: 13px;
}
.at-card[data-theme="dark"] .at-hook { background: #3b2a06; color: #fde68a; }

.at-list { display: flex; flex-direction: column; gap: 6px; }
.at-item { font-size: 13px; }
.at-item .at-item-en { font-weight: 600; }
.at-item .at-item-th { color: var(--at-fg-muted); }
.at-item .at-item-note { color: var(--at-fg-muted); font-size: 12px; font-style: italic; }
.at-defgroup { display: flex; gap: 7px; align-items: flex-start; }
.at-defgroup > .at-chip { flex: none; margin-top: 2px; }
.at-defitems { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }

.at-ex {
  border: 1px solid var(--at-border); border-radius: 9px;
  padding: 7px 9px; font-size: 13px; background: var(--at-bg-soft);
}
.at-ex .at-ex-src {
  display: block; text-align: right; font-size: 10px;
  color: var(--at-fg-muted); opacity: .85; margin-bottom: 2px; letter-spacing: .02em;
}
.at-ex .at-ex-en { font-weight: 500; }
.at-ex .at-ex-th { color: var(--at-fg-muted); margin-top: 2px; }

.at-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.at-syn {
  display: inline-flex; align-items: baseline; gap: 4px;
  border: 1px solid var(--at-border); background: var(--at-bg-soft);
  border-radius: 999px; padding: 3px 9px; font-size: 12.5px;
  cursor: pointer; color: var(--at-fg); font-family: inherit;
}
.at-syn:hover { border-color: var(--at-accent); background: var(--at-accent-soft); }
.at-syn .at-syn-th { color: var(--at-fg-muted); font-size: 11.5px; }
.at-syn[data-level="easy"] { border-color: #86efac; }
.at-card[data-theme="dark"] .at-syn[data-level="easy"] { border-color: #14532d; }
.at-syn[data-level="advanced"] { opacity: .75; }

/* ---------- footer ---------- */
.at-foot {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  padding: 8px 12px; border-top: 1px solid var(--at-border); background: var(--at-bg-soft);
}
.at-btn {
  display: inline-flex; align-items: center; gap: 5px;
  border: 1px solid var(--at-border); background: var(--at-bg);
  color: var(--at-fg); border-radius: 8px; padding: 5px 10px;
  font-size: 12.5px; cursor: pointer; font-family: inherit; white-space: nowrap;
}
.at-btn:hover { border-color: var(--at-accent); color: var(--at-accent); }
.at-btn.at-primary { background: var(--at-accent); border-color: var(--at-accent); color: #fff; font-weight: 600; }
.at-btn.at-primary:hover { filter: brightness(1.08); color: #fff; }
.at-btn[disabled] { opacity: .55; cursor: default; }
.at-spacer { flex: 1; }
.at-meta { font-size: 11px; color: var(--at-fg-muted); }

/* ---------- states ---------- */
.at-skel { display: flex; flex-direction: column; gap: 8px; padding: 4px 0 8px; }
.at-skel div { height: 12px; border-radius: 6px; background: linear-gradient(90deg, var(--at-bg-chip) 25%, var(--at-bg-soft) 37%, var(--at-bg-chip) 63%); background-size: 400% 100%; animation: at-sh 1.2s ease-in-out infinite; }
.at-skel div:nth-child(1) { height: 20px; width: 62%; }
.at-skel div:nth-child(2) { width: 92%; }
.at-skel div:nth-child(3) { width: 78%; }
@keyframes at-sh { 0% { background-position: 100% 0; } 100% { background-position: 0 0; } }

.at-error { color: var(--at-danger); font-size: 13px; }
.at-warn { margin-top: 8px; font-size: 11.5px; color: var(--at-warn); word-break: break-word; }
.at-hint { font-size: 12px; color: var(--at-fg-muted); margin-top: 6px; }
.at-hidden { display: none !important; }

/* ---------- โหมดวางในเนื้อหา (ใช้บนหน้าจอมือถือ) ---------- */
:host([data-variant]) .at-card[data-variant="inline"],
.at-card[data-variant="inline"] {
  width: 100%;
  max-width: 100%;
  max-height: none;
  box-shadow: none;
  border-radius: 14px;
  animation: none;
}
.at-card[data-variant="inline"] .at-head { cursor: default; }
.at-card[data-variant="inline"] .at-body { overflow: visible; }
.at-card[data-variant="inline"] .at-translation { font-size: 22px; }
`;
