const PLACEHOLDER_TOPIC_BASE_NAME = '新对话';

function normalizeTopicName(name = '') {
    return String(name || '').trim();
}

function isPlaceholderTopicName(name = '') {
    const normalized = normalizeTopicName(name);
    if (!normalized) {
        return false;
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
        selectedKnowledgeBaseDocumentIds: null,
        ...overrides,
    };
}

module.exports = {
    PLACEHOLDER_TOPIC_BASE_NAME,
    buildDefaultPlaceholderTopic,
    buildPlaceholderTopicName,
    isPlaceholderTopicName,
};
