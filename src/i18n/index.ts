// i18n loader. Replaces the reference plugin's single ~7,600-line i18n.js with
// per-language data modules under ./locales, assembled here. The public API
// (resolveLocale / L / LANG_OPTIONS / LANG_ORDER) matches the reference so the
// rest of the codebase and the ported tests consume it unchanged.
import type { Strings } from './strings';
import { en } from './locales/en';
import { zh } from './locales/zh';
import { zh_TW } from './locales/zh-TW';
import { es } from './locales/es';
import { fr } from './locales/fr';
import { ar } from './locales/ar';
import { pt } from './locales/pt';
import { ru } from './locales/ru';
import { de } from './locales/de';
import { ja } from './locales/ja';
import { ko } from './locales/ko';
import { it } from './locales/it';
import { tr } from './locales/tr';
import { id } from './locales/id';
import { vi } from './locales/vi';
import { th } from './locales/th';
import { hi } from './locales/hi';
import { bn } from './locales/bn';
import { fa } from './locales/fa';
import { ms } from './locales/ms';
import { pl } from './locales/pl';

export type { Strings, LocaleFn } from './strings';

type RawTable = Record<string, unknown>;

const STRINGS: Record<string, RawTable> = {
    en,
    zh,
    'zh-TW': zh_TW,
    es,
    fr,
    ar,
    pt,
    ru,
    de,
    ja,
    ko,
    it,
    tr,
    id,
    vi,
    th,
    hi,
    bn,
    fa,
    ms,
    pl,
};

export const LANG_OPTIONS: Record<string, string> = {
    en: 'English',
    zh: '简体中文',
    'zh-TW': '繁體中文',
    es: 'Español',
    fr: 'Français',
    ar: 'العربية',
    pt: 'Português',
    ru: 'Русский',
    de: 'Deutsch',
    ja: '日本語',
    ko: '한국어',
    it: 'Italiano',
    tr: 'Türkçe',
    id: 'Bahasa Indonesia',
    vi: 'Tiếng Việt',
    th: 'ไทย',
    hi: 'हिन्दी',
    bn: 'বাংলা',
    fa: 'فارسی',
    ms: 'Bahasa Melayu',
    pl: 'Polski',
};

export const LANG_ORDER: string[] = [
    'en', 'zh', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'ar', 'pt', 'ru',
    'de', 'it', 'tr', 'id', 'vi', 'th', 'hi', 'bn', 'fa', 'ms', 'pl',
];

// The currently resolved locale table. Consumers read `L` after resolveLocale()
// has run at plugin load; it defaults to English so it is always usable.
export let L: Strings = en as unknown as Strings;

function detectLanguage(): string {
    if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') {
        return navigator.language;
    }
    return '';
}

export function resolveLocale(override?: string): Strings {
    const lang = override && override !== 'auto' ? override : detectLanguage();
    let key = lang.slice(0, 2);
    if (key === 'zh') {
        key = /TW|HK|Hant/i.test(lang) ? 'zh-TW' : 'zh';
    }
    const table = STRINGS[key] || STRINGS.en;
    // Fill any keys missing from the chosen locale with the English master, so
    // partial translations never leave gaps.
    if (table !== STRINGS.en) {
        for (const enKey of Object.keys(STRINGS.en)) {
            if (table[enKey] === undefined) table[enKey] = STRINGS.en[enKey];
        }
    }
    L = table as unknown as Strings;
    return L;
}
