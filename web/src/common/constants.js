/**
 * ค่าคงที่และค่าตั้งต้นของทั้งส่วนขยาย
 * ไฟล์นี้ต้องไม่ import อะไรเลย เพื่อให้ใช้ได้ทั้ง content script, service worker และหน้าเว็บต่าง ๆ
 */

export const APP_NAME = 'อ่านไทย Translate Reader';
export const APP_SHORT = 'อ่านไทย';
export const VIEWER_PATH = 'src/viewer/viewer.html';
export const CACHE_PREFIX = 'tcache:';
export const SETTINGS_KEY = 'settings';

export const MSG = {
  TRANSLATE: 'translate',
  SAVE_WORD: 'saveWord',
  IS_SAVED: 'isSaved',
  GET_SETTINGS: 'getSettings',
  SET_SETTINGS: 'setSettings',
  OPEN_PAGE: 'openPage',
  STATS: 'stats',
  TEST_PROVIDER: 'testProvider',
  DB_LIST: 'db:list',
  DB_GET: 'db:get',
  DB_UPDATE: 'db:update',
  DB_DELETE: 'db:delete',
  DB_EXPORT: 'db:export',
  DB_IMPORT: 'db:import',
  DB_REVIEW: 'db:review',
  DB_DUE: 'db:due',
  DB_TAGS: 'db:tags',
  TRANSLATE_SELECTION: 'translateSelection',
  SAVE_SELECTION: 'saveSelection',
  CLEAR_CACHE: 'clearCache',
  PDF_REDIRECT: 'pdfRedirect',
  GET_PAGE_INFO: 'getPageInfo',
};

export const DEFAULT_SETTINGS = {
  version: 1,
  general: {
    enabled: true,
    theme: 'auto',
    disabledSites: [],
  },
  lookup: {
    doubleClick: true,
    selectionButton: true,
    ignoreSites: [],
    maxContextChars: 700,
    cardWidth: 400,
    cardPinnedByDefault: false,
    closeOnOutsideClick: true,
  },
  translation: {
    targetLang: 'th',
    sourceLang: 'auto',
    providers: ['google-free', 'google-chrome-dict', 'mymemory'],
    timeoutMs: 9000,
    cacheDays: 30,
  },
  providers: {
    libre: { endpoint: 'https://libretranslate.com', apiKey: '' },
    deepl: { apiKey: '', pro: false },
  },
  ai: {
    enabled: false,
    mode: 'assist',
    provider: 'openai',
    model: 'gpt-4o-mini',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    temperature: 0.2,
    maxTokens: 1500,
    timeoutMs: 30000,
  },
  enrichment: {
    synonyms: true,
    simpleSynonymsOnly: true,
    definitions: true,
    examples: true,
    exampleCount: 3,
    collocations: true,
    memoryHook: true,
    tatoeba: true,
    datamuse: true,
  },
  pdf: {
    autoOpen: true,
    skipHosts: [],
    defaultZoom: 'page-width',
    rememberPosition: true,
  },
  library: {
    autoSave: false,
    reviewMaxPerDay: 100,
  },
  tts: {
    enabled: true,
    rate: 0.95,
  },
};

export const LANGS = [
  { code: 'th', label: 'ไทย' },
  { code: 'en', label: 'อังกฤษ' },
  { code: 'zh-CN', label: 'จีน (ตัวย่อ)' },
  { code: 'ja', label: 'ญี่ปุ่น' },
  { code: 'ko', label: 'เกาหลี' },
  { code: 'fr', label: 'ฝรั่งเศส' },
  { code: 'de', label: 'เยอรมัน' },
  { code: 'es', label: 'สเปน' },
  { code: 'vi', label: 'เวียดนาม' },
  { code: 'ru', label: 'รัสเซีย' },
  { code: 'hi', label: 'ฮินดี' },
  { code: 'ar', label: 'อาหรับ' },
];

/** ระดับความยากของคำพ้องความหมาย ใช้จัดกลุ่มใน UI */
export const LEVEL_LABEL = {
  easy: 'ง่าย/ใช้บ่อย',
  normal: 'ทั่วไป',
  advanced: 'ทางการ',
};
