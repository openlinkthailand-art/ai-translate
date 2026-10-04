import { DEFAULT_SETTINGS, SETTINGS_KEY } from './constants.js';
import { getPlatform } from './platform.js';

/** รวม object แบบลึก (หนึ่งระดับพอสำหรับโครง settings) */
export function deepMerge(base, patch) {
  if (patch === undefined || patch === null) return base;
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return patch;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && out[k] !== null && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function getSettings() {
  const stored = await getPlatform().storage.get(SETTINGS_KEY);
  return deepMerge(structuredClone(DEFAULT_SETTINGS), stored?.[SETTINGS_KEY] || {});
}

export async function setSettings(patch) {
  const current = await getSettings();
  const next = deepMerge(current, patch);
  await getPlatform().storage.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function resetSettings() {
  const next = structuredClone(DEFAULT_SETTINGS);
  await getPlatform().storage.set({ [SETTINGS_KEY]: next });
  return next;
}

/** ติดตามการเปลี่ยนแปลง settings (ใช้ได้ทั้งส่วนขยายและเว็บแอป) */
export function onSettingsChanged(cb) {
  return getPlatform().onStorageChanged((all) => {
    if (!(SETTINGS_KEY in all)) return;
    cb(deepMerge(structuredClone(DEFAULT_SETTINGS), all[SETTINGS_KEY] || {}));
  });
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function isSiteDisabled(settings, url) {
  const host = hostOf(url);
  if (!host) return false;
  const list = settings?.general?.disabledSites || [];
  return list.some((h) => host === h || host.endsWith('.' + h));
}

/** ปรับ patch ให้เป็นรูปแบบที่ตั้งค่าได้จากหน้า options */
export async function toggleSiteDisabled(url) {
  const settings = await getSettings();
  const host = hostOf(url);
  const list = new Set(settings.general.disabledSites || []);
  if (list.has(host)) list.delete(host);
  else list.add(host);
  await setSettings({ general: { disabledSites: [...list] } });
  return [...list];
}
