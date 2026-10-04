/** แคชผลการแปล — เก็บผ่าน platform.storage (ส่วนขยายใช้ chrome.storage, เว็บแอปใช้ IndexedDB) */
import { CACHE_PREFIX } from '../common/constants.js';
import { getPlatform } from '../common/platform.js';

export function cacheKey(parts) {
  return CACHE_PREFIX + parts.filter(Boolean).join('|').slice(0, 300);
}

export async function cacheGet(key) {
  try {
    const obj = await getPlatform().storage.get(key);
    const item = obj?.[key];
    if (!item) return null;
    return item.value ?? null;
  } catch {
    return null;
  }
}

export async function cacheSet(key, value) {
  try {
    await getPlatform().storage.set({ [key]: { ts: Date.now(), value } });
  } catch {
    /* เกินโควตา — ไม่เป็นไร แค่ไม่แคช */
  }
}

export async function clearCache() {
  const all = await getPlatform().storage.get(null);
  const keys = Object.keys(all || {}).filter((k) => k.startsWith(CACHE_PREFIX));
  if (keys.length) await getPlatform().storage.remove(keys);
  return keys.length;
}

export async function pruneCache(days = 30) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const all = await getPlatform().storage.get(null);
  const stale = Object.entries(all || {})
    .filter(([k, v]) => k.startsWith(CACHE_PREFIX) && (!v?.ts || v.ts < cutoff))
    .map(([k]) => k);
  if (stale.length) await getPlatform().storage.remove(stale);
  return stale.length;
}

export async function cacheStats() {
  const all = await getPlatform().storage.get(null);
  const entries = Object.entries(all || {}).filter(([k]) => k.startsWith(CACHE_PREFIX));
  return { count: entries.length, bytes: JSON.stringify(entries).length };
}
