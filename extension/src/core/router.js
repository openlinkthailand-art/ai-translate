/**
 * ตัวจัดการคำสั่งกลาง — ใช้ร่วมกันระหว่าง service worker ของส่วนขยาย และเว็บแอป (PWA)
 * ทั้งสองที่เรียก handleMessage() เหมือนกัน จึงมี logic ชุดเดียว
 */
import { MSG } from '../common/constants.js';
import { getSettings, setSettings, resetSettings } from '../common/settings.js';
import { getPlatform } from '../common/platform.js';
import { translateQuery } from './translate-service.js';
import * as db from './db.js';
import * as cache from './cache.js';

/**
 * @param {object} msg ข้อความจากผู้เรียก
 * @param {object} ctx บริบทของผู้เรียก (url/title ของหน้าเว็บที่กำลังอ่าน)
 */
export async function handleMessage(msg, ctx = {}) {
  switch (msg?.type) {
    case MSG.TRANSLATE: {
      const settings = await getSettings();
      const result = await translateQuery({
        text: msg.text,
        context: msg.context || '',
        settings,
        mode: msg.mode || 'auto',
        forceRefresh: !!msg.forceRefresh,
      });
      if (settings.library?.autoSave && (result.query || '').length > 1) {
        try {
          const { entry, created } = await db.addWord(
            db.makeWordEntry(result, {
              sourceTitle: msg.pageTitle || ctx.title || '',
              sourceUrl: msg.pageUrl || ctx.url || '',
              sourceType: msg.sourceType || 'web',
            })
          );
          result.savedId = entry.id;
          result.savedNow = created;
        } catch {
          /* บันทึกไม่สำเร็จก็ยังแสดงคำแปลได้ */
        }
      }
      return result;
    }

    case MSG.SAVE_WORD: {
      const payload = msg.entry || {};
      const { entry, created } = await db.addWord(
        db.makeWordEntry(payload, {
          sourceTitle: msg.pageTitle || ctx.title || '',
          sourceUrl: msg.pageUrl || ctx.url || '',
          sourceType: msg.sourceType || 'web',
          tags: payload.tags || [],
          starred: !!payload.starred,
        })
      );
      return { id: entry.id, created };
    }

    case MSG.IS_SAVED: {
      const found = await db.findByWord(msg.text, msg.targetLang || '');
      return found ? { saved: true, id: found.id, entry: found } : { saved: false };
    }

    case MSG.GET_SETTINGS:
      return getSettings();

    case MSG.SET_SETTINGS:
      return setSettings(msg.patch || {});

    case 'resetSettings':
      return resetSettings();

    case MSG.OPEN_PAGE:
      await getPlatform().openPage(msg.page || 'home', msg.query);
      return { page: msg.page || 'home' };

    case MSG.STATS: {
      const s = await db.stats();
      const settings = await getSettings();
      return { ...s, cache: await cache.cacheStats(), settings };
    }

    case MSG.TEST_PROVIDER: {
      const settings = await getSettings();
      const started = Date.now();
      if (msg.provider === 'ai') {
        const { testAiConnection } = await import('./ai.js');
        const r = await testAiConnection(settings);
        return { ok: true, ms: r.ms, translation: r.sample, provider: r.provider };
      }
      const { runProvider } = await import('./providers.js');
      const r = await runProvider(msg.provider, {
        text: msg.text || 'resilient',
        from: 'en',
        to: settings.translation.targetLang,
        settings,
        timeoutMs: 15000,
      });
      return { ok: true, ms: Date.now() - started, translation: r.translation, provider: r.provider };
    }

    case MSG.DB_LIST:
      return db.listWords(msg.options || {});
    case MSG.DB_GET:
      return db.getWord(msg.id);
    case MSG.DB_UPDATE:
      return db.updateWord(msg.id, msg.patch || {});
    case MSG.DB_DELETE:
      return msg.ids ? db.deleteMany(msg.ids) : db.deleteWord(msg.id);
    case MSG.DB_EXPORT:
      return db.exportAll();
    case MSG.DB_IMPORT:
      return db.importAll(msg.payload, { merge: msg.merge !== false });
    case MSG.DB_REVIEW:
      return db.applyReview(msg.id, msg.grade);
    case MSG.DB_DUE:
      return db.dueWords(msg.limit || 30);
    case MSG.DB_TAGS:
      return db.allTags();

    case MSG.CLEAR_CACHE:
      return { removed: await cache.clearCache() };

    case MSG.GET_PAGE_INFO:
      return { url: ctx.url || '', title: ctx.title || '' };

    default:
      throw new Error(`ไม่รู้จักคำสั่ง: ${msg?.type}`);
  }
}
