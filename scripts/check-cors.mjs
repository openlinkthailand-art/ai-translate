/**
 * ตรวจว่า endpoint ใดเรียกได้จาก "หน้าเว็บธรรมดา" (ต้องมี CORS header)
 * เพราะเว็บแอป/PWA ข้าม CORS ไม่ได้เหมือนส่วนขยายที่ใช้ host_permissions
 * วิธีใช้: node scripts/check-cors.mjs
 */
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const ORIGIN = 'https://atthai.example';

const GETS = [
  ['Google Translate (gtx)', 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=th&dt=t&q=hello'],
  ['Google Dictionary (clients5)', 'https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=en&tl=th&q=hello'],
  ['MyMemory', 'https://api.mymemory.translated.net/get?q=hello&langpair=en|th'],
  ['Datamuse (คำพ้อง)', 'https://api.datamuse.com/words?rel_syn=resilient&md=f&max=5'],
  ['Tatoeba (ตัวอย่างประโยค)', 'https://tatoeba.org/en/api_v0/search?from=eng&to=tha&query=happy&sort=relevance'],
  ['Wiktionary (นิยาม)', 'https://en.wiktionary.org/api/rest_v1/page/definition/resilient'],
  ['LibreTranslate สาธารณะ (lt.vern.cc)', 'https://lt.vern.cc/languages'],
  ['LibreTranslate (translate.disroot.org)', 'https://translate.disroot.org/languages'],
];

const OPTIONS = [
  ['LibreTranslate /translate (POST json)', 'https://lt.vern.cc/translate', 'content-type'],
  ['LibreTranslate ทางเลือก', 'https://translate.disroot.org/translate', 'content-type'],
  ['OpenAI-compatible /chat/completions', 'https://api.openai.com/v1/chat/completions', 'authorization,content-type'],
  ['OpenRouter /chat/completions', 'https://openrouter.ai/api/v1/chat/completions', 'authorization,content-type'],
  ['Gemini generateContent', 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent', 'content-type'],
  ['Anthropic /messages', 'https://api.anthropic.com/v1/messages', 'x-api-key,anthropic-version,content-type'],
];

const ok = (v) => (v ? '\x1b[32mYES\x1b[0m' : '\x1b[31mno \x1b[0m');

async function probeGet(name, url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Origin: ORIGIN } });
    const acao = res.headers.get('access-control-allow-origin');
    console.log(`  ${ok(acao)} GET  ${name}${acao ? `  →  ACAO: ${acao}` : ''}  (HTTP ${res.status})`);
    return !!acao;
  } catch (err) {
    console.log(`  ${ok(false)} GET  ${name}  →  ${err.message}`);
    return false;
  }
}

async function probeOptions(name, url, headers) {
  try {
    const res = await fetch(url, {
      method: 'OPTIONS',
      headers: {
        'User-Agent': UA,
        Origin: ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': headers,
      },
    });
    const acao = res.headers.get('access-control-allow-origin');
    const acah = res.headers.get('access-control-allow-headers');
    console.log(
      `  ${ok(acao)} POST ${name}${acao ? `  →  ACAO: ${acao}` : ''}${acah ? `  ACAH: ${acah}` : ''}  (HTTP ${res.status})`
    );
    return !!acao;
  } catch (err) {
    console.log(`  ${ok(false)} POST ${name}  →  ${err.message}`);
    return false;
  }
}

console.log('=== คำขอแบบ GET (ต้องมี access-control-allow-origin) ===');
const getResults = {};
for (const [name, url] of GETS) getResults[name] = await probeGet(name, url);

console.log('\n=== คำขอแบบ POST JSON (ต้องผ่าน preflight) ===');
const postResults = {};
for (const [name, url, headers] of OPTIONS) postResults[name] = await probeOptions(name, url, headers);

console.log('\n=== สรุป: ผู้ให้บริการที่เว็บแอปใช้ได้โดยไม่ต้องมี proxy ===');
const usable = Object.entries(getResults).filter(([, v]) => v).map(([k]) => k);
console.log(usable.length ? usable.map((n) => '  ✓ ' + n).join('\n') : '  (ไม่มีเลย)');
const usablePost = Object.entries(postResults).filter(([, v]) => v).map(([k]) => k);
console.log(usablePost.length ? usablePost.map((n) => '  ✓ ' + n).join('\n') : '  (ไม่มีเลย)');
