'use strict';
/**
 * ซูมหน้าแอปด้วย Ctrl + ล้อเมาส์ และการถ่างนิ้วบน touchpad
 * (Electron ไม่ซูมให้เองแบบเบราว์เซอร์ จึงต้องดักเหตุการณ์ล้อเมาส์แล้วสั่งซูมเอง)
 */
const { webFrame } = require('electron');

const MIN_LEVEL = -3; // ≈ 58%
const MAX_LEVEL = 5; // ≈ 249%
const MAX_STEP = 0.5; // ล้อเมาส์ 1 คลิกซูมไม่เกินครึ่งระดับ (≈ 10%)

window.addEventListener(
  'wheel',
  (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    // ล้อเมาส์ deltaY ≈ ±100 → ครึ่งระดับ; touchpad ส่งค่าเล็ก ๆ ถี่ ๆ → ซูมตามสัดส่วน
    const step = Math.max(-MAX_STEP, Math.min(MAX_STEP, -event.deltaY / 200));
    const next = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, webFrame.getZoomLevel() + step));
    webFrame.setZoomLevel(next);
  },
  { passive: false, capture: true }
);
