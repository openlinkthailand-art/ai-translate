/**
 * แปลงข้อความจาก pdf.js (textContent.items) ให้กลับเป็น "ย่อหน้า" สำหรับโหมดอ่าน
 * ไม่เรียก DOM/chrome.* จึงทดสอบใน Node ได้ (scripts/test-paragraphs.mjs)
 */

/**
 * @param {Array<{str:string, transform:number[], width?:number, height?:number, hasEOL?:boolean}>} items
 * @returns {string[]} ย่อหน้าเรียงตามลำดับการอ่าน
 */
export function extractParagraphs(items) {
  const lines = buildLines(Array.isArray(items) ? items : []);
  if (!lines.length) return [];

  const gaps = [];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i - 1].y - lines[i].y;
    if (gap > 0 && gap < lines[i].size * 3) gaps.push(gap);
  }
  const lineGap = median(gaps) || lines[0].size * 1.2;
  const maxWidth = Math.max(...lines.map((l) => l.right - l.x));

  const paragraphs = [];
  let cur = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const line = lines[i];
    const gap = prev.y - line.y;
    const endsSentence = /[.!?:"”')\]]$/.test(prev.text);
    const shortLine = prev.right - prev.x < maxWidth * 0.8;
    const indented = line.x > prev.x + line.size;
    const breakHere =
      gap <= 0 || // ขึ้นคอลัมน์ใหม่/ย้อนขึ้นไปด้านบน
      gap > lineGap * 1.45 || // มีบรรทัดว่างคั่น
      (endsSentence && (shortLine || indented)) ||
      Math.abs(line.size - prev.size) > prev.size * 0.25; // ขนาดตัวอักษรเปลี่ยน (เช่น หัวข้อ)
    if (breakHere) {
      paragraphs.push(joinLines(cur));
      cur = [line];
    } else {
      cur.push(line);
    }
  }
  paragraphs.push(joinLines(cur));
  return paragraphs.filter((p) => p.length > 0);
}

/** รวม item ที่อยู่ระดับเดียวกันเป็นบรรทัด */
function buildLines(items) {
  const lines = [];
  let line = null;
  const flush = () => {
    if (line && line.text.trim()) {
      line.text = line.text.replace(/\s+/g, ' ').trim();
      lines.push(line);
    }
    line = null;
  };
  for (const it of items) {
    const str = typeof it?.str === 'string' ? it.str : '';
    const t = Array.isArray(it?.transform) ? it.transform : [1, 0, 0, 1, 0, 0];
    const x = Number(t[4]) || 0;
    const y = Number(t[5]) || 0;
    const size = Math.abs(Number(it?.height) || Number(t[3]) || Number(t[0]) || 10);
    const width = Number(it?.width) || 0;

    if (str.trim()) {
      if (line && Math.abs(line.y - y) > size * 0.5) flush();
      if (!line) {
        line = { text: str, x, y, size, right: x + width };
      } else {
        const gap = x - line.right;
        const needSpace = !/\s$/.test(line.text) && !/^\s/.test(str) && gap > size * 0.15;
        line.text += (needSpace ? ' ' : '') + str;
        line.right = Math.max(line.right, x + width);
        line.size = Math.max(line.size, size);
      }
    }
    if (it?.hasEOL) flush();
  }
  flush();
  return lines;
}

/** ต่อบรรทัดเป็นย่อหน้า: ตัดยัติภังค์ท้ายบรรทัด (exam-/ple → example) */
function joinLines(lines) {
  let out = '';
  for (const { text } of lines) {
    if (!out) out = text;
    else if (/[A-Za-z]-$/.test(out) && /^[a-z]/.test(text)) out = out.slice(0, -1) + text;
    else out += ' ' + text;
  }
  return out.trim();
}

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * แบ่งย่อหน้าเป็นชิ้นข้อความ + คำที่ "อยู่ในคลัง" เพื่อไฮไลต์
 * @param {string} text ย่อหน้า
 * @param {Set<string>} known คำในคลัง (ตัวพิมพ์เล็ก)
 * @returns {Array<{text:string, known?:string}>}
 */
export function markKnownWords(text, known) {
  const parts = [];
  if (!known || !known.size) return [{ text }];
  const re = /[A-Za-z][A-Za-z'’-]*/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    const hit = knownForm(m[0], known);
    if (!hit) continue;
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ text: m[0], known: hit });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** หา "รูปคำในคลัง" ของคำที่ผันแล้ว (books → book, decided → decide, applying → apply) */
function knownForm(word, known) {
  const w = word.toLowerCase().replace(/[’']s$/, '');
  const candidates = [
    w,
    w.replace(/s$/, ''),
    w.replace(/es$/, ''),
    w.replace(/ies$/, 'y'),
    w.replace(/ed$/, ''),
    w.replace(/d$/, ''),
    w.replace(/ied$/, 'y'),
    w.replace(/ing$/, ''),
    w.replace(/ing$/, 'e'),
    w.replace(/ly$/, ''),
  ];
  return candidates.find((c) => c.length > 1 && known.has(c)) || '';
}
