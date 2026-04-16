const PLACEHOLDER_TOPIC_BASE_NAME = '新对话';
const LEGACY_PLACEHOLDER_TOPIC_NAMES = Object.freeze([
    '主要对话',
    'Main Conversation',
]);

function normalizeTopicName(name = '') {
    return String(name || '').trim();
}

function isPlaceholderTopicName(name = '') {
    const normalized = normalizeTopicName(name);
    if (!normalized) {
        return false;
    }

    if (LEGACY_PLACEHOLDER_TOPIC_NAMES.includes(normalized)) {
        return true;
    }

    return new RegExp(`^${PLACEHOLDER_TOPIC_BASE_NAME}(?:\\s+\\d+)?$`).test(normalized);
}

function buildPlaceholderTopicName(existingTopics = []) {
    const topicCount = Array.isArray(existingTopics) ? existingTopics.length : 0;
    return `${PLACEHOLDER_TOPIC_BASE_NAME} ${Math.max(1, topicCount + 1)}`;
}

function buildDefaultPlaceholderTopic(overrides = {}, existingTopics = []) {
    return {
        id: 'default',
        name: buildPlaceholderTopicName(existingTopics),
        createdAt: Date.now(),
        locked: true,
        unread: false,
        creatorSource: 'system',
        knowledgeBaseId: null,
        ...overrides,
    };
}

module.exports = {
    PLACEHOLDER_TOPIC_BASE_NAME,
    LEGACY_PLACEHOLDER_TOPIC_NAMES,
    buildDefaultPlaceholderTopic,
    buildPlaceholderTopicName,
    isPlaceholderTopicName,
};
