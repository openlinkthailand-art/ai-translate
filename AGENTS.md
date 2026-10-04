# AGENTS.md — กติกาของโปรเจกต์นี้

คำแนะนำนี้ใช้กับทุก session ที่ทำงานในโปรเจกต์นี้ (ZCode โหลดไฟล์นี้เป็น instruction ของ workspace)

## ข้อมูลโปรเจกต์

- **ชื่อ:** อ่านไทย Translate Reader (AtThai Translate Reader)
- **คืออะไร:** เครื่องมือช่วยอ่านภาษาอังกฤษสำหรับคนไทย — แปลคำ/ประโยคพร้อมบริบท ตัวอย่างเหตุการณ์จริง
  คำพ้องที่ใช้ง่าย และคลังคำศัพท์ที่มีระบบทบทวน (spaced repetition)
- **สองแอปจากโค้ดชุดเดียว:**
  - `extension/` — ส่วนขยาย Chrome/Edge (ดับเบิลคลิกคำบนหน้าเว็บ, เปิด PDF ในโหมดอ่านแปล)
  - `web/` — เว็บแอป/PWA สำหรับ Android (ติดตั้งลงหน้าจอโฮม + รับข้อความผ่าน Share Sheet)
- **Remote:** https://github.com/ohojames/ai-translate (บัญชี GitHub: `ohojames`, อีเมล `ohojames@gmail.com`)
- **สาขาหลัก:** `main`
- **เวอร์ชันปัจจุบัน:** ดูที่ `extension/manifest.json` (เป็นแหล่งความจริงเดียวของเวอร์ชัน)

## กติกาสำคัญ (ห้ามละเมิด)

1. **ต้นฉบับเดียว สองแอป** — โค้ดทั้งหมดอยู่ใน `extension/src/**`
   **ห้ามแก้ `web/src/**` ด้วยมือ** เพราะถูกสร้างโดย `npm run build:web` (แก้แล้วจะถูกทับ)
   ไฟล์ที่เป็นของเว็บเองมีแค่ `web/index.html`, `web/sw.js`, `web/manifest.webmanifest`,
   `web/src/config.js` (สร้างโดย build), `web/src/app/**`
2. **`src/core/*` ต้องไม่เรียก `chrome.*`** — ใช้ `common/platform.js` เท่านั้น
   เพื่อให้รันได้ทั้งส่วนขยาย, เว็บแอป และ Node (การทดสอบ)
3. **ห้ามเพิ่ม dependency ตอนรัน** — โปรเจกต์นี้ใช้ vanilla JS + ES modules ไม่มี build step สำหรับส่วนขยาย
   (`playwright` เป็น dev dependency สำหรับการทดสอบเท่านั้น)
4. **ทุกการเรียกเครือข่ายต้องมี timeout + fallback** และต้องใช้ endpoint ที่ **มี CORS** ถ้าจะใช้ในเว็บแอป
   (ตรวจด้วย `npm run cors` — DeepL ใช้ได้เฉพาะส่วนขยาย)
5. **ผลลัพธ์จากภายนอกไม่เคยถูกเชื่อถือ** — ทุก parser ต้องกัน null/โครงสร้างเปลี่ยน/ฟิลด์หาย
   และทุกข้อความที่แสดงต้องผ่าน `escapeHtml`
6. **UI ของการ์ดใช้ Shadow DOM** เพื่อไม่ให้ CSS ชนกับเว็บต้นทาง
7. **ภาษา:** คอมเมนต์ เอกสาร และข้อความบนหน้าจอเป็น **ภาษาไทย** (ผู้ใช้เป็นคนไทย)
   โค้ด/ชื่อตัวแปรเป็นภาษาอังกฤษ
8. **ห้าม commit ความลับ** — API key ของผู้ใช้อยู่ใน IndexedDB/chrome.storage ของเครื่องเท่านั้น
   (`node_modules/`, `dist/`, `.tmp/` ถูก ignore ไว้แล้ว)

## คำสั่งที่ต้องใช้ (และต้องผ่านก่อน commit)

```bash
npm run check       # ตรวจ syntax ทุกไฟล์ + manifest (ส่วนขยาย + PWA) + web/src ต้องตรงกับต้นฉบับ
npm run build:web   # ประกอบ web/ จาก extension/src — ต้องรันทุกครั้งหลังแก้โค้ดที่ใช้ร่วมกัน
npm run smoke       # ยิง API จริง 43 การทดสอบ (ต้องมีเน็ต)
npm run e2e         # โหลดส่วนขยายเข้า Chromium จริง 31 การทดสอบ
npm run e2e:web     # ทดสอบเว็บแอปโหมดมือถือ (Pixel 5) 43 การทดสอบ
npm run verify      # รันทั้งหมดตามลำดับ (117 การทดสอบ)
npm run package     # แพ็ก dist/atthai-translate-reader-*.zip และ dist/atthai-web-*.zip
```

- ต้องมี `npx playwright install chromium` ก่อนรัน e2e ครั้งแรก
- **ก่อน commit ทุกครั้ง:** รัน `npm run build:web` แล้วตามด้วย `npm run check` ให้ผ่าน
- ถ้าแก้โค้ดที่กระทบพฤติกรรม ให้รัน `npm run verify` ทั้งชุด

## สถาปัตยกรรมโดยย่อ

```
common/platform.js   ← จุดเดียวที่โค้ดรู้ว่ากำลังรันเป็น extension / web / headless
core/router.js       ← handleMessage() ที่ service worker และเว็บแอปเรียกใช้ร่วมกัน
core/translate-service.js  ← ท่อการแปล: ผู้ให้บริการ → ข้อมูลเสริม → AI → รวมผล → แคช
core/db.js           ← IndexedDB คลังคำศัพท์ + SM-2
ui/card.js           ← การ์ดแปล (variant: floating สำหรับหน้าเว็บ, inline สำหรับมือถือ)
viewer/viewer.js     ← ตัวอ่าน PDF (pdf.js) ใช้ร่วมกันทั้งสองแอป
```

รายละเอียดเต็มอยู่ใน `docs/ARCHITECTURE.md`, แผนงานใน `docs/PLAN.md`, คู่มือมือถือใน `docs/MOBILE.md`

## การ deploy แอปมือถือ

`web/` เป็นไฟล์นิ่งทั้งหมด วางบนโฮสต์ที่มี HTTPS ได้เลย
- **แนะนำ:** GitHub Pages ผ่าน workflow `.github/workflows/pages.yml` (build จาก source แล้ว deploy โฟลเดอร์ `web/`)
  ต้องเปิดใน Settings → Pages → Source: **GitHub Actions** ครั้งเดียว
- ทางเลือก: Netlify Drop / Cloudflare Pages (ลากโฟลเดอร์ `web/` ขึ้นไป)

## หลักการทำงานที่ผ่านมาได้ผล (ควรทำต่อ)

- **ทดสอบกับของจริงเท่านั้น** — endpoint จริง, Chromium จริง, ไฟล์ PDF จริง
  บั๊กสำคัญทุกตัวในโปรเจกต์นี้ (overlay บังคลิก, parser Google ผิด, ไอคอนไม่ใช่ PNG, ตัวอย่างประโยคหาย) เจอเพราะทดสอบจริง
- **เมื่อทดสอบเจอบั๊ก ให้เพิ่มการตรวจสอบนั้นเข้าไปในชุดทดสอบ** เพื่อไม่ให้กลับมาอีก
- **อธิบายสั้น ๆ ก่อนลงมือ** แล้วรายงานผลด้วยหลักฐาน (ตัวเลขผลทดสอบ)
