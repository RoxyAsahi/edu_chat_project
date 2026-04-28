import 'emoji-picker-element/picker.js';
import en from 'emoji-picker-element/i18n/en.js';
import zhCN from 'emoji-picker-element/i18n/zh_CN.js';
import emojiDataEN from 'emoji-picker-element-data/en/cldr/data.json';
import emojiDataZH from 'emoji-picker-element-data/zh/cldr/data.json';

const I18N_BY_LOCALE = {
    en,
    zh: zhCN,
    'zh-cn': zhCN,
};

const DATA_BY_LOCALE = {
    en: emojiDataEN,
    zh: emojiDataZH,
    'zh-cn': emojiDataZH,
};

const dataSourceCache = new Map();

function normalizeLocale(locale) {
    const value = String(locale || '').toLowerCase();
    if (value.startsWith('zh')) {
        return 'zh';
    }
    return 'en';
}

function getDataSource(locale) {
    if (!dataSourceCache.has(locale)) {
        const data = DATA_BY_LOCALE[locale] || DATA_BY_LOCALE.en;
        const source = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(data))}`;
        dataSourceCache.set(locale, source);
    }
    return dataSourceCache.get(locale);
}

window.UniStudyEmojiPicker = {
    configure(picker, options = {}) {
        if (!picker) {
            return;
        }
        const locale = normalizeLocale(options.locale || navigator.language || 'zh-CN');
        picker.i18n = I18N_BY_LOCALE[locale] || en;
        picker.locale = locale;
        picker.dataSource = getDataSource(locale);
    },
};
