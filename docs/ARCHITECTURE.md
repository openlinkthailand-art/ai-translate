# สถาปัตยกรรม — อ่านไทย Translate Reader

## ภาพรวม

```
┌──────────────────────────── เบราว์เซอร์ ────────────────────────────┐
│                                                                     │
│  ┌─── หน้าเว็บ (http/https) ────┐   ┌─── ตัวอ่าน PDF (ของเรา) ────┐  │
│  │ content.js (isolated world)  │   │ viewer.js (extension page)  │  │
│  │  · ดัก dblclick / mouseup     │   │  · pdf.js render + textLayer│  │
│  │  · ปุ่มลอย 🌐 แปล             │   │  · สารบัญ/ภาพย่อ/ค้นหา      │  │
│  │  · เก็บบริบทจากย่อหน้า        │   │  · แปลทั้งหน้า              │  │
│  └──────────┬───────────────────┘   └──────────┬──────────────────┘  │
│             │  import() โมดูล UI                │  import             │
│             └──────────► src/ui/card.js ◄───────┘                    │
│                    (การ์ดแปล Shadow DOM — ใช้ร่วมกัน)                  │
│                              │ chrome.runtime.sendMessage            │
│  ┌───────────────────────────▼───────────────────────────────────┐   │
│  │ service worker (src/background/service-worker.js)             │   │
│  │  · message router   · เมนูคลิกขวา   · คีย์ลัด                   │   │
│  │  · เปลี่ยนเส้นทาง .pdf → ตัวอ่าน   · badge จำนวนคำที่ถึงกำหนด   │   │
│  │  · prune cache รายชั่วโมง (chrome.alarms)                      │   │
│  └───────┬───────────────────────────────────┬───────────────────┘   │
│          │                                   │                       │
│   src/core/translate-service.js        src/core/db.js                │
│   (ท่อการแปล + แคช + รวมผล)              (IndexedDB + SRS)             │
│          │                                                           │
└──────────┼───────────────────────────────────────────────────────────┘
           │ fetch (ไม่ติด CORS เพราะมี host_permissions)
           ▼
   Google Translate · Google Dictionary · MyMemory · LibreTranslate · DeepL
   Datamuse · Tatoeba · Wiktionary · AI (OpenAI/Gemini/Claude/Ollama)
```

## แผนผังไฟล์

```
extension/                        ← ต้นฉบับเดียวของทุกอย่าง (ใช้ทั้งส่วนขยายและแอปมือถือ)
├── manifest.json                 MV3: permissions, content_scripts, commands, WAR
├── assets/icon{16,32,48,128}.png สร้างด้วย scripts/make-icons.mjs
├── vendor/pdfjs/                 pdf.min.js, pdf.worker.min.js, cmaps/, standard_fonts/, pdf_viewer.css
└── src/
    ├── config.js                 ค่าประจำสภาพแวดล้อมของส่วนขยาย (เวอร์ชัน + ที่อยู่ไฟล์ pdf.js)
    ├── common/
    │   ├── constants.js          DEFAULT_SETTINGS, MSG (ชื่อข้อความ), LANGS
    │   ├── platform.js           ★ ชั้นแยกสภาพแวดล้อม — จุดเดียวที่โค้ดรู้ว่ากำลังรันที่ไหน
    │   ├── util.js               detectLang, cleanWord, pickContext, pickSentenceWith, parseJsonLoose, fetchJson…
    │   └── settings.js           getSettings/setSettings (ผ่าน platform.storage) + onSettingsChanged
    ├── core/                     ← "สมอง" ทั้งหมด ไม่ผูกกับ chrome.* เลย
    │   ├── router.js             ★ ตัวจัดการคำสั่งกลาง — service worker และเว็บแอปเรียกตัวเดียวกัน
    │   ├── providers.js          ผู้ให้บริการแปล + parseGoogleDict
    │   ├── dictionary.js         datamuseLookup, tatoebaExamples (API ใหม่ที่มี CORS), wiktionaryLookup
    │   ├── ai.js                 prompt + เรียก OpenAI/Gemini/Claude/Ollama + normalizeAiResult
    │   ├── translate-service.js  translateQuery() — ท่อหลัก
    │   ├── cache.js              แคชการแปล (ผ่าน platform.storage)
    │   └── db.js                 IndexedDB คลังคำศัพท์ + scheduleNext (SM-2)
    ├── background/service-worker.js  เฉพาะที่เป็นของเบราว์เซอร์: เมนู, คีย์ลัด, PDF redirect, badge
    ├── content/content.js        ฉีดทุกหน้า (classic script, โหลด UI ด้วย dynamic import)
    ├── ui/
    │   ├── card.js               TranslateCard + formatForCopy (โหมด floating/inline)
    │   ├── card-style.js         CSS ของการ์ด (อยู่ใน Shadow DOM)
    │   ├── api.js                send(), toast(), el(), download(), toCsv(), addWebNav()
    │   └── pages.css             สไตล์ร่วมของทุกหน้า + media query สำหรับจอมือถือ
    ├── viewer/                   ตัวอ่าน PDF (html/css/js) — ใช้ได้ทั้งสองแอป
    ├── library/  review/  options/
    └── popup/                    (ส่วนขยายเท่านั้น ไม่ถูกคัดลอกไปเว็บ)

web/                              ← เว็บแอป/PWA (ประกอบขึ้นจาก extension/src ด้วยสคริปต์ build)
├── index.html                    หน้าหลัก: วาง/แชร์/แตะคำในข้อความ
├── sw.js                         service worker: แคชเปลือกแอป + รับ share target
├── manifest.webmanifest          PWA manifest (share_target แบบ POST multipart)
├── icons/                        ไอคอน 192/512 + maskable + apple-touch (สร้างโดย build)
├── precache-manifest.json        รายการไฟล์สำหรับแคชล่วงหน้า (สร้างโดย build)
├── build-info.json               แฮชไฟล์สำหรับตรวจว่า build ค้างเก่าหรือไม่ (สร้างโดย build)
├── vendor/pdfjs/                 คัดลอกจาก extension/vendor/pdfjs
└── src/                          คัดลอกจาก extension/src + ไฟล์ที่เป็นของเว็บเอง
    ├── config.js                 (ของเว็บเอง) env=web + ที่อยู่ pdf.js + เวอร์ชัน
    └── app/                      (ของเว็บเอง) หน้าหลัก + สไตล์มือถือ

scripts/                          เครื่องมือพัฒนา/ทดสอบ (build-web, serve-web, e2e, package, icons, cors…)
desktop/                          ตัวช่วย Windows (global hotkey สำหรับโปรแกรมอ่าน PDF)
docs/                             PLAN.md, ARCHITECTURE.md, MOBILE.md
```

## ชั้นแยกสภาพแวดล้อม (platform) — หัวใจของการใช้โค้ดชุดเดียว

```
        ┌──────────────────────────────────────────────┐
        │        common/platform.js  (จุดเดียว)         │
        │  ตรวจสภาพแวดล้อมแล้วให้บริการ 4 อย่าง          │
        │    storage   อ่าน/เขียนที่เก็บข้อมูล           │
        │    send      ส่งคำสั่งไปยัง router             │
        │    url       แปลงที่อยู่ไฟล์                   │
        │    openPage  เปิดหน้าจอภายในแอป                │
        └───────┬──────────────────┬───────────────────┘
                │                  │
    extension   │                  │   web / headless
    (chrome.storage.local,         │   (IndexedDB, เรียก router ตรง ๆ,
     chrome.runtime.sendMessage)   │    นำทางด้วย location)
                │                  │
        ┌───────▼──────────────────▼───────┐
        │      core/router.js              │
        │  handleMessage(msg, ctx)         │
        │  translate / saveWord / db:* /   │
        │  stats / testProvider / …        │
        └──────────────────────────────────┘
```

ผลลัพธ์: `translate-service`, `db`, `providers`, `ai`, `card`, หน้าคลังคำ/ทบทวน/ตั้งค่า/ตัวอ่าน PDF
ถูกเขียนครั้งเดียว แล้วทำงานได้ทั้งสองที่ — แก้ที่เดียวมีผลทั้งคู่ และมี `npm run check` คอยเตือนถ้าลืมรัน build

## การรับข้อความที่แชร์เข้ามา (Android Share Sheet)

```
ผู้ใช้เลือกข้อความในแอปอื่น → กดแชร์ → เลือก "อ่านไทย"
        │
        ▼
ระบบส่ง POST multipart/form-data ไปที่ <scope>/share  (ชื่อฟิลด์: title, text, url)
        │
        ▼
web/sw.js  ดักคำขอ → อ่าน formData → เก็บลง Cache Storage (คีย์ ./share-data)
        │
        ▼
ตอบ 303 redirect → index.html?share=1
        │
        ▼
web/src/app/app.js  อ่านข้อมูลที่เก็บไว้ → ใส่ในช่องข้อความ → แปลทันที
        │                                   (ล้าง query string ด้วย history.replaceState)
        ▼
แสดงการ์ดแปล + ปุ่ม "บันทึกเข้าคลังคำ" + รายการ "คำในข้อความนี้" ให้แตะดูต่อ
```

ข้อกำหนดที่ทำให้วิธีนี้ทำงาน: ต้องติดตั้งแอป (PWA) แล้ว service worker ต้องลงทะเบียนสำเร็จ
และหน้าเว็บต้องเป็น secure context (HTTPS หรือ localhost) เท่านั้น

## เส้นทางการแปล (translateQuery)

```
translateQuery({ text, context, settings, mode })
  │
  ├─ normalizeQuery / detectLang / pickContext (ตัดข้อความบริบทให้พอดี)
  ├─ ถ้าภาษาต้นทาง == ภาษาเป้าหมาย และไม่ได้เปิด AI → คืนข้อความเดิม + คำอธิบาย
  ├─ cache.cacheGet(key)  →  เจอ = คืนทันที (cached: true)
  │
  ├─ โหมด AI-first (settings.ai.mode === 'first') → aiAnalyze() ก่อน
  │     ล้มเหลว → ตกไปใช้ผู้ให้บริการแปลปกติ
  ├─ runMtChain(providers) — ไล่ทีละเจ้าจนได้ผล, เก็บ error ลง warnings
  ├─ โหมด assist → aiAnalyze({ baseTranslation }) เพื่อยกระดับผลลัพธ์
  │
  ├─ ข้อมูลเสริมพร้อมกัน (Promise.allSettled — พังได้โดยไม่กระทบ):
  │     Datamuse (คำพ้อง+ความถี่+นิยาม) | Tatoeba (ตัวอย่าง+ไทย) | Wiktionary (ชนิดคำ+นิยาม)
  │
  ├─ buildContextExample(): ประโยคที่ผู้ใช้อ่าน + แปลไทย → ตัวอย่างลำดับแรก
  ├─ merge: alternatives / definitions / synonyms / examples (dedupe + จัดอันดับ + กรอง)
  ├─ glossSynonyms(): แปลคำพ้องง่าย ๆ เป็นไทย (เฉพาะเมื่อไม่ใช้ AI, จำกัด 4 คำ)
  └─ cache.cacheSet(key, result) → คืนผลลัพธ์
```

### รูปแบบผลลัพธ์ (TranslationResult)

```js
{
  query, context, sourceLang, targetLang,
  translation,            // คำแปลหลัก (ไทย)
  literal, reading, partOfSpeech, register,
  contextMeaning,         // อธิบายว่าคำนี้ในบริบทนี้หมายถึงอะไร (AI)
  memoryHook, notes, collocations,
  alternatives: [{ translation, when }],
  definitions:  [{ pos, meaning, th }],
  synonyms:     [{ word, th, level: 'easy'|'normal'|'advanced', note, from }],
  examples:     [{ en, th, source }],
  provider, aiUsed, aiModel,
  warnings: [{ stage, provider?, error }],
  elapsedMs, cached, createdAt
}
```

## โปรโตคอลข้อความ (service worker)

ทุกคำขอตอบกลับเป็น `{ ok: true, data }` หรือ `{ ok: false, error }`

| type | ส่งไป | ได้กลับ |
| --- | --- | --- |
| `translate` | text, context, mode, sourceType | TranslationResult (+ `savedId` ถ้าบันทึกอัตโนมัติ) |
| `saveWord` | entry | `{ id, created }` |
| `isSaved` | text, targetLang | `{ saved, id?, entry? }` |
| `getSettings` / `setSettings` | patch? | settings ก้อนเต็ม |
| `openPage` | page: options\|library\|review, query? | url ที่เปิด |
| `stats` | — | จำนวนคำ/ถึงกำหนด/วันนี้ + สถานะแคช |
| `testProvider` | provider, text? | `{ ok, ms, translation }` |
| `db:list` / `db:get` / `db:update` / `db:delete` / `db:export` / `db:import` / `db:review` / `db:due` / `db:tags` | ตามชื่อ | ผลจาก IndexedDB |
| `clearCache` | — | `{ removed }` |
| `translateSelection` / `saveSelection` | (ส่งจาก SW → content script) | — |

## ฐานข้อมูลคลังคำศัพท์ (IndexedDB `atthai_library`)

```
words  (keyPath: id)
  index: word, createdAt, srs.due, starred
  { id, word, translation, reading, partOfSpeech, register, contextMeaning, context, literal,
    memoryHook, notes, alternatives[], definitions[], synonyms[], examples[], collocations[],
    sourceLang, targetLang, provider, aiUsed, sourceTitle, sourceUrl, sourceType,
    tags[], starred, createdAt, updatedAt, lastReviewedAt, reviewCount,
    srs: { ease, interval, reps, lapses, due, lastGrade } }
meta   (keyPath: k)   ← เผื่อใช้ในอนาคต
```

### การจัดตารางทบทวน (`scheduleNext`)

| คะแนน | ผล |
| --- | --- |
| 0 อีกครั้ง | ease −0.2, reps = 0, กลับมาอีก 10 นาที, lapses +1 |
| 1 ยาก | ease −0.15, interval × 1.2 (อย่างน้อย 1 วัน) |
| 2 ดี | interval × ease |
| 3 ง่าย | ease +0.15, interval × ease × 1.3 (เริ่มที่ 3 วัน) |

`ease` ถูกจำกัดในช่วง 1.3–3.0 และ `interval` ไม่เกิน 365 วัน

## การเปลี่ยนเส้นทาง PDF

```
เปิด http://…/book.pdf
  │
  ├─ chrome.webRequest.onHeadersReceived (main_frame) → content-type: application/pdf ?
  │     → ตรวจ: เปิดอัตโนมัติหรือยัง / โดเมนอยู่ในรายการยกเว้น / เพิ่งเปลี่ยนแท็บนี้ไปแล้วหรือไม่
  │     → chrome.tabs.update(tabId, viewer.html?file=…)
  ├─ chrome.webNavigation.onCommitted → เผื่อเซิร์ฟเวอร์ไม่ส่ง content-type ที่ถูกต้อง (ดูจากนามสกุล .pdf)
  └─ เมนูคลิกขวา "เปิดลิงก์นี้ในโหมดอ่านแปล" สำหรับกรณีพิเศษ (PDF ที่ฝังใน iframe)

viewer.html?file=…
  → pdfjsLib.getDocument({ url, cMapUrl, standardFontDataUrl, withCredentials: true })
  → ถ้าล้มเหลว ลองใหม่แบบ withCredentials: false → ถ้ายังไม่ได้ แสดงกล่องข้อเสนอทางเลือก
    (เลือกไฟล์จากเครื่อง / เปิดแบบปกติ)
```

ตัวอ่านเรนเดอร์แบบ virtualize: สร้าง placeholder ทุกหน้าตามขนาดจริง แต่เรนเดอร์เฉพาะหน้า
ที่มองเห็น ±2 หน้า และคืนหน่วยความจำเมื่อห่างเกิน 5 หน้า จึงเปิดหนังสือ 500 หน้าได้โดยไม่กินแรม

## หน้าจอและ UI

| หน้า | ไฟล์ | หน้าที่ |
| --- | --- | --- |
| การ์ดแปล | `ui/card.js` + `card-style.js` | แสดงผลการแปล ใช้ร่วมกันทั้งหน้าเว็บและตัวอ่าน PDF (Shadow DOM กัน CSS ชน) |
| ปุ่มลอย | อยู่ใน `content.js` / `viewer.js` | โผล่เมื่อคลุมข้อความ กดแล้วแปล |
| ป๊อปอัป | `popup/` | สถิติ, แปลเร็ว, สวิตช์เปิด/ปิด, คำล่าสุด |
| ตั้งค่า | `options/` | 7 แท็บ (ทั่วไป/การแปล/AI/ตัวอย่าง-คำพ้อง/PDF/คลังคำ/ข้อมูล) สร้างจาก schema ใน `options.js` |
| คลังคำศัพท์ | `library/` | ค้นหา กรอง แก้ไขโน้ต/แท็ก ปักดาว ส่งออก/นำเข้า |
| ทบทวน | `review/` | บัตรคำ + คะแนน 4 ระดับ + คีย์ลัด |

## กลยุทธ์การทดสอบ

| ระดับ | สคริปต์ | ตรวจอะไร |
| --- | --- | --- |
| Syntax/Manifest | `scripts/check-js.mjs` | `node --check` ทุกไฟล์ (ส่วนขยาย + เว็บ + สคริปต์) · ไฟล์ที่ manifest อ้างถึง · WAR ครอบคลุมโมดูลที่ dynamic import · PWA manifest (standalone/share_target/ไอคอนมีจริง) · **web/src ไม่ค้างเก่ากับต้นฉบับ** |
| CORS | `scripts/check-cors.mjs` | endpoint ใดเรียกได้จากหน้าเว็บจริง (ผลตัดสินว่าฝั่งเว็บใช้ผู้ให้บริการตัวใดได้) |
| หน่วย+รวม (ยิง API จริง) | `scripts/smoke-test.mjs` | util, parser, normalize, providers, Datamuse/Tatoeba/Wiktionary, ท่อการแปลเต็ม (43 ข้อ) |
| E2E ส่วนขยาย | `scripts/e2e-test.mjs` | โหลดส่วนขยายเข้า Chromium, ดับเบิลคลิก, ปุ่มลอย, บันทึกคำ, PDF, หน้าจอทั้งหมด (31 ข้อ) |
| E2E เว็บแอปมือถือ | `scripts/web-e2e.mjs` | service worker, share target จริง, คลิปบอร์ด/เมนูวาง, คลังคำ, ทบทวน, ตั้งค่า, PDF, ออฟไลน์, การจัดวางบนจอ (43 ข้อ) |
| เครื่องมือประกอบ | `make-test-pdf.mjs`, `make-icons.mjs`, `build-web.mjs`, `serve-web.mjs`, `package*.mjs`, `check-ps1.ps1` | ไฟล์ทดสอบ/ไอคอน/ประกอบเว็บ/เซิร์ฟเวอร์/แพ็กเกจ/ตรวจ PowerShell |

## หลักการเขียนโค้ดที่ใช้ในโปรเจกต์นี้

1. **`src/core/*` ต้องไม่เรียก `chrome.*` เลย** — ใช้ `common/platform.js` เท่านั้น จึงรันได้ทั้งส่วนขยาย เว็บแอป และ Node
2. **ทุกการเรียกเครือข่ายต้องมี timeout และ fallback** — ไม่มีจุดไหนที่ล้มเหลวแล้วทำให้ทั้งคำขอล้มเหลว
3. **ทุกข้อมูลจากภายนอกต้องผ่าน escapeHtml ก่อนแสดง** และผ่านการตรวจรูปแบบก่อนใช้
4. **ผลลัพธ์จากภายนอกไม่เคยถูกเชื่อถือ** — parser ทุกตัวกันพลาด (null, โครงสร้างเปลี่ยน, ฟิลด์หาย)
5. **UI ใช้ Shadow DOM** เพื่อไม่ให้ CSS ของเว็บต้นทางและของเรารบกวนกัน
6. **ไม่มี dependency ตอนรัน** — มีแต่ dev dependency สำหรับการทดสอบ
7. **ต้นฉบับเดียว สองแอป** — ห้ามคัดลอกโค้ดไปแก้สองที่ ให้เพิ่มไฟล์ที่ต่างกันเฉพาะจุด (config/app) แล้วใช้ build ประกอบ
8. **ทดสอบกับของจริงเท่านั้น** — endpoint จริง, เบราว์เซอร์จริง, ไฟล์ PDF จริง (บั๊กสำคัญทุกตัวในโปรเจกต์นี้เจอด้วยวิธีนี้)
