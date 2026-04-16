import { normalizeHistory } from '../composer/composerUtils.js';

const TOPIC_TITLE_HISTORY_LOAD_DELAY_MS = 1250;
const PLACEHOLDER_TOPIC_BASE_NAME = '新对话';
const LEGACY_PLACEHOLDER_TOPIC_NAMES = new Set([
    '主要对话',
    'Main Conversation',
]);

function normalizeTopicTitle(name = '') {
    return String(name || '')
        .replace(/\s+/g, ' ')
        .trim();
}

function isPlaceholderTopicName(name = '') {
    const normalized = normalizeTopicTitle(name);
    if (!normalized) {
        return false;
    }

    if (LEGACY_PLACEHOLDER_TOPIC_NAMES.has(normalized)) {
        return true;
    }

    return new RegExp(`^${PLACEHOLDER_TOPIC_BASE_NAME}(?:\\s+\\d+)?$`).test(normalized);
}

function selectVisibleTopicTitleMessages(history = []) {
    return normalizeHistory(Array.isArray(history) ? history : [])
        .filter((message) => (
            message
            && (message.role === 'user' || message.role === 'assistant')
            && message.isThinking !== true
        ));
}

function isInitialTopicTitleTurn(history = [], messageId = '') {
    const visibleMessages = selectVisibleTopicTitleMessages(history);
    if (visibleMessages.length !== 2) {
        return false;
    }

    return visibleMessages[0]?.role === 'user'
        && visibleMessages[1]?.role === 'assistant'
        && (!messageId || visibleMessages[1]?.id === messageId);
}

function createTopicTitleController(deps = {}) {
    const store = deps.store;
    const chatAPI = deps.chatAPI;
    const windowObj = deps.windowObj || (typeof window !== 'undefined' ? window : globalThis);
    const normalizeTopic = deps.normalizeTopic || ((topic) => topic);
    const renderTopics = deps.renderTopics || (() => {});
    const syncWorkspaceContext = deps.syncWorkspaceContext || (() => {});
    const getCurrentSelectedItem = deps.getCurrentSelectedItem || (() => store.getState().session.currentSelectedItem);
    const getCurrentTopicId = deps.getCurrentTopicId || (() => store.getState().session.currentTopicId);
    const getCurrentChatHistory = deps.getCurrentChatHistory || (() => store.getState().session.currentChatHistory);
    const pendingGenerations = new Set();

    function getGlobalSettings() {
        return store.getState().settings?.settings || {};
    }

    function isCurrentView(agentId, topicId) {
        return agentId === getCurrentSelectedItem()?.id && topicId === getCurrentTopicId();
    }

    function wait(ms) {
        return new Promise((resolve) => {
            const timeoutFn = typeof windowObj.setTimeout === 'function'
                ? windowObj.setTimeout.bind(windowObj)
                : setTimeout;
            timeoutFn(resolve, ms);
        });
    }

    async function readHistoryForGeneration(target = {}) {
        if (Array.isArray(target.historySnapshot)) {
            return normalizeHistory(target.historySnapshot);
        }

        if (!isCurrentView(target.agentId, target.topicId)) {
            await wait(TOPIC_TITLE_HISTORY_LOAD_DELAY_MS);
        }

        const history = await chatAPI.getChatHistory(target.agentId, target.topicId).catch(() => []);
        return normalizeHistory(history);
    }

    async function getLatestTopics(agentId = '') {
        const topics = await chatAPI.getAgentTopics(agentId).catch(() => []);
        return Array.isArray(topics) ? topics.map(normalizeTopic) : [];
    }

    async function resolveCurrentTopicName(agentId = '', topicId = '') {
        if (getCurrentSelectedItem()?.id === agentId) {
            const currentTopics = Array.isArray(store.getState().session?.topics)
                ? store.getState().session.topics
                : [];
            const matchedCurrentTopic = currentTopics.find((topic) => topic?.id === topicId);
            if (matchedCurrentTopic?.name) {
                return matchedCurrentTopic.name;
            }
        }

        const latestTopics = await getLatestTopics(agentId);
        return latestTopics.find((topic) => topic?.id === topicId)?.name || '';
    }

    function refreshSessionTopics(agentId = '', topics = []) {
        if (getCurrentSelectedItem()?.id !== agentId || !Array.isArray(topics)) {
            return;
        }

        store.patchState('session', (current) => ({
            ...current,
            topics,
        }));
        renderTopics();
        syncWorkspaceContext();
    }

    async function persistGeneratedTitle({
        agentId,
        topicId,
        title,
    }) {
        const latestTopics = await getLatestTopics(agentId);
        const targetTopic = latestTopics.find((topic) => topic?.id === topicId);
        if (!targetTopic || !isPlaceholderTopicName(targetTopic.name)) {
            return false;
        }

        const saveResult = await chatAPI.saveAgentTopicTitle(agentId, topicId, title).catch((error) => ({
            error: error.message,
        }));
        if (saveResult?.error) {
            return false;
        }

        const nextTopics = Array.isArray(saveResult?.topics)
            ? saveResult.topics.map(normalizeTopic)
            : latestTopics.map((topic) => (
                topic.id === topicId
                    ? { ...topic, name: title }
                    : topic
            ));
        refreshSessionTopics(agentId, nextTopics);
        return true;
    }

    async function generateForAssistantMessage(target = {}) {
        if (getGlobalSettings().enableTopicTitleGeneration === false) {
            return '';
        }

        const agentId = String(target.agentId || '').trim();
        const topicId = String(target.topicId || '').trim();
        const messageId = String(target.messageId || '').trim();
        if (!agentId || !topicId || !messageId) {
            return '';
        }

        const requestKey = `${agentId}:${topicId}:${messageId}`;
        if (pendingGenerations.has(requestKey)) {
            return '';
        }

        pendingGenerations.add(requestKey);
        try {
            const topicName = await resolveCurrentTopicName(agentId, topicId);
            if (!isPlaceholderTopicName(topicName)) {
                return '';
            }

            const history = await readHistoryForGeneration({
                agentId,
                topicId,
                historySnapshot: target.historySnapshot,
            });
            if (!isInitialTopicTitleTurn(history, messageId)) {
                return '';
            }

            const visibleMessages = selectVisibleTopicTitleMessages(history);
            const result = await chatAPI.generateTopicTitle({
                agentId,
                topicId,
                messageId,
                messages: visibleMessages,
                model: target.model || '',
            }).catch((error) => ({
                success: false,
                error: error.message,
                title: '',
            }));

            const title = normalizeTopicTitle(result?.title);
            if (!title) {
                return '';
            }

            const persisted = await persistGeneratedTitle({
                agentId,
                topicId,
                title,
            });
            return persisted ? title : '';
        } finally {
            pendingGenerations.delete(requestKey);
        }
    }

    return {
        generateForAssistantMessage,
        isInitialTopicTitleTurn,
        isPlaceholderTopicName,
        selectVisibleTopicTitleMessages,
    };
}

export {
    createTopicTitleController,
    isInitialTopicTitleTurn,
    isPlaceholderTopicName,
    selectVisibleTopicTitleMessages,
};
