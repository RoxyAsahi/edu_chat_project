const SUBJECT_CARD_EMOJIS = ['🎓', '📚', '🧠', '✏️', '🔬', '🌍', '📐', '📝'];

const SUBJECT_CARD_KEYWORD_EMOJIS = [
    ['数学', '📐'],
    ['英语', '🔤'],
    ['语文', '✒️'],
    ['写作', '✒️'],
    ['物理', '🧲'],
    ['化学', '🧪'],
    ['生物', '🧬'],
    ['历史', '🏛️'],
    ['地理', '🌍'],
    ['编程', '💻'],
    ['论文', '📄'],
];

function sliceGraphemes(value, limit = 2) {
    const source = String(value || '').replace(/\s+/g, '').trim();
    if (!source) {
        return '';
    }

    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
        const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
        return Array.from(segmenter.segment(source), (segment) => segment.segment).slice(0, limit).join('');
    }

    return Array.from(source).slice(0, limit).join('');
}

function normalizeSubjectCardEmoji(value) {
    return sliceGraphemes(value, 2);
}

function resolveSubjectCardEmoji({ agent, index = 0 } = {}) {
    const hasOwnCardEmoji = Object.prototype.hasOwnProperty.call(agent || {}, 'cardEmoji');
    const configuredEmoji = normalizeSubjectCardEmoji(hasOwnCardEmoji ? agent?.cardEmoji : agent?.config?.cardEmoji);
    if (configuredEmoji) {
        return configuredEmoji;
    }

    const agentName = String(agent?.name || agent?.config?.name || agent?.id || '');
    const keywordMatch = SUBJECT_CARD_KEYWORD_EMOJIS.find(([keyword]) => agentName.includes(keyword));
    if (keywordMatch) {
        return keywordMatch[1];
    }

    const safeIndex = Number.isInteger(index) && index >= 0 ? index : 0;
    return SUBJECT_CARD_EMOJIS[safeIndex % SUBJECT_CARD_EMOJIS.length];
}

export {
    normalizeSubjectCardEmoji,
    resolveSubjectCardEmoji,
};
