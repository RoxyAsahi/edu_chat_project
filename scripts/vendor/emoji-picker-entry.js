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
const databaseCache = new Map();
const irregularEmoticons = new Set([
    ':D', 'XD', ":'D", 'O:)', ':X', ':P', ';P', 'XP', ':L', ':Z', ':j', '8D',
    'XO', '8)', ':B', ':O', ':S', ":'o", 'Dx', 'X(', 'D:', ':C', '>0)', ':3',
    '</3', '<3', '\\M/', ':E', '8#',
]);

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
        const source = URL.createObjectURL(new Blob([JSON.stringify(data)], {
            type: 'application/json',
        }));
        dataSourceCache.set(locale, source);
    }
    return dataSourceCache.get(locale);
}

function extractTokens(value) {
    return String(value || '')
        .split(/[\s_]+/)
        .map((word) => {
            if (!word.match(/\w/) || irregularEmoticons.has(word)) {
                return word.toLowerCase();
            }
            return word
                .replace(/[)(:,]/g, '')
                .replace(/’/g, "'")
                .toLowerCase();
        })
        .filter(Boolean);
}

function normalizeTokens(values) {
    return values
        .filter(Boolean)
        .map((value) => value.toLowerCase())
        .filter((value) => value.length >= 2);
}

function toStoredEmoji({ annotation, emoticon, group, order, shortcodes, skins, tags, emoji, version }) {
    const tokens = [...new Set(normalizeTokens([
        ...(shortcodes || []).flatMap(extractTokens),
        ...(tags || []).flatMap(extractTokens),
        ...extractTokens(annotation),
        emoticon,
    ]))].sort();
    return {
        annotation,
        group,
        order,
        tags,
        tokens,
        unicode: emoji,
        version,
        ...(emoticon ? { emoticon } : {}),
        ...(shortcodes ? { shortcodes } : {}),
        ...(skins ? {
            skins: skins.map((skin) => ({
                tone: skin.tone,
                unicode: skin.emoji,
                version: skin.version,
            })),
            skinUnicodes: skins.map((skin) => skin.emoji),
        } : {}),
    };
}

function cloneEmoji(emoji) {
    if (!emoji) {
        return emoji;
    }
    return {
        ...emoji,
        ...(emoji.tags ? { tags: [...emoji.tags] } : {}),
        ...(emoji.shortcodes ? { shortcodes: [...emoji.shortcodes] } : {}),
        ...(emoji.skins ? { skins: emoji.skins.map((skin) => ({ ...skin })) } : {}),
    };
}

function findCommonMembers(arrays, getKey) {
    if (!arrays.length || arrays.some((array) => !array.length)) {
        return [];
    }
    const [shortest] = [...arrays].sort((a, b) => a.length - b.length);
    return shortest.filter((item) => arrays.every((array) => array.some((candidate) => getKey(candidate) === getKey(item))));
}

class UniStudyEmojiMemoryDatabase {
    constructor({ locale, dataSource, data }) {
        this.locale = locale;
        this.dataSource = dataSource;
        this._preferredSkinTone = 0;
        this._favorites = new Map();
        this._customEmoji = [];
        this._emojis = data.map(toStoredEmoji).sort((a, b) => a.order - b.order);
        this._byUnicode = new Map();
        this._bySkinUnicode = new Map();
        for (const emoji of this._emojis) {
            this._byUnicode.set(emoji.unicode, emoji);
            for (const skinUnicode of emoji.skinUnicodes || []) {
                this._bySkinUnicode.set(skinUnicode, emoji);
            }
        }
    }

    async ready() {}

    async getEmojiByGroup(group) {
        return this._emojis
            .filter((emoji) => emoji.group === group)
            .map(cloneEmoji);
    }

    async getEmojiBySearchQuery(query) {
        const tokens = normalizeTokens(extractTokens(query));
        if (!tokens.length) {
            return [];
        }
        const matchesByToken = tokens.map((token, index) => this._emojis.filter((emoji) => {
            if (index === tokens.length - 1) {
                return emoji.tokens.some((candidate) => candidate.startsWith(token));
            }
            return emoji.tokens.includes(token);
        }));
        return findCommonMembers(matchesByToken, (emoji) => emoji.unicode)
            .sort((a, b) => a.order - b.order)
            .map(cloneEmoji);
    }

    async getEmojiByShortcode(shortcode) {
        const value = String(shortcode || '').toLowerCase();
        return cloneEmoji(this._emojis.find((emoji) => (emoji.shortcodes || []).some((item) => item.toLowerCase() === value)));
    }

    async getEmojiByUnicodeOrName(unicodeOrName) {
        const value = String(unicodeOrName || '');
        const customEmoji = this._customEmoji.find((emoji) => emoji.name?.toLowerCase() === value.toLowerCase());
        if (customEmoji) {
            return { ...customEmoji };
        }
        return cloneEmoji(this._byUnicode.get(value) || this._bySkinUnicode.get(value));
    }

    async getPreferredSkinTone() {
        return this._preferredSkinTone;
    }

    async setPreferredSkinTone(skinTone) {
        this._preferredSkinTone = skinTone;
    }

    async incrementFavoriteEmojiCount(unicodeOrName) {
        const key = String(unicodeOrName || '');
        this._favorites.set(key, (this._favorites.get(key) || 0) + 1);
    }

    async getTopFavoriteEmoji(limit) {
        return [...this._favorites.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit)
            .map(([unicodeOrName]) => this._byUnicode.get(unicodeOrName) || this._customEmoji.find((emoji) => emoji.name === unicodeOrName))
            .filter(Boolean)
            .map(cloneEmoji);
    }

    set customEmoji(customEmoji) {
        this._customEmoji = Array.isArray(customEmoji) ? customEmoji : [];
    }

    get customEmoji() {
        return this._customEmoji;
    }

    async close() {}

    async delete() {}
}

function getDatabase(locale) {
    const dataSource = getDataSource(locale);
    const cacheKey = `${locale}:${dataSource}`;
    if (!databaseCache.has(cacheKey)) {
        databaseCache.set(cacheKey, new UniStudyEmojiMemoryDatabase({
            locale,
            dataSource,
            data: DATA_BY_LOCALE[locale] || DATA_BY_LOCALE.en,
        }));
    }
    return databaseCache.get(cacheKey);
}

function setPickerDatabase(picker, database) {
    if (typeof picker._set === 'function') {
        picker._set('database', database);
        return;
    }
    if (picker._ctx) {
        picker._ctx.database = database;
    }
}

function configurePicker(picker, options = {}) {
    if (!picker) {
        return;
    }
    const locale = normalizeLocale(options.locale || navigator.language || 'zh-CN');
    const dataSource = getDataSource(locale);
    picker.i18n = I18N_BY_LOCALE[locale] || en;
    picker.locale = locale;
    picker.dataSource = dataSource;
    setPickerDatabase(picker, getDatabase(locale));
}

function configureExistingPickers() {
    document.querySelectorAll('emoji-picker').forEach((picker) => configurePicker(picker));
}

window.UniStudyEmojiPicker = {
    configure(picker, options = {}) {
        configurePicker(picker, options);
    },
};

configureExistingPickers();
