import {
    normalizeFollowUpList,
    normalizeHistory,
} from '../composer/composerUtils.js';

const FOLLOW_UP_HISTORY_LOAD_DELAY_MS = 1250;

function createFollowUpController(deps = {}) {
    const store = deps.store;
    const el = deps.el;
    const chatAPI = deps.chatAPI;
    const windowObj = deps.windowObj || window;
    const documentObj = deps.documentObj || document;
    const sendFollowUp = deps.sendFollowUp || (async () => {});
    const updateCurrentChatHistory = deps.updateCurrentChatHistory || (() => []);
    const getCurrentSelectedItem = deps.getCurrentSelectedItem || (() => store.getState().session.currentSelectedItem);
    const getCurrentTopicId = deps.getCurrentTopicId || (() => store.getState().session.currentTopicId);
    const getCurrentChatHistory = deps.getCurrentChatHistory || (() => store.getState().session.currentChatHistory);
    const pendingGenerations = new Set();

    function getCurrentHistorySafe() {
        const history = getCurrentChatHistory();
        return normalizeHistory(Array.isArray(history) ? history : []);
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

    function resolveVisibleFollowUpMessageId(history = []) {
        const visibleMessages = (Array.isArray(history) ? history : [])
            .filter((message) => message && message.role !== 'system');
        const lastVisibleMessage = visibleMessages.at(-1);

        if (!lastVisibleMessage || lastVisibleMessage.role !== 'assistant' || lastVisibleMessage.isThinking === true) {
            return null;
        }

        return lastVisibleMessage.id || null;
    }

    function buildFollowUpBlock(message = {}) {
        const followUps = normalizeFollowUpList(message.followUps);
        if (followUps.length === 0) {
            return null;
        }

        const container = documentObj.createElement('div');
        container.className = 'message-follow-ups';

        const list = documentObj.createElement('div');
        list.className = 'message-follow-ups__list';

        followUps.forEach((prompt) => {
            const button = documentObj.createElement('div');
            button.className = 'message-follow-ups__button';
            button.setAttribute('role', 'button');
            button.setAttribute('tabindex', '0');

            const surface = documentObj.createElement('div');
            surface.className = 'message-follow-ups__button-surface';

            const label = documentObj.createElement('span');
            label.className = 'message-follow-ups__button-label';
            label.textContent = prompt;
            surface.appendChild(label);

            const arrow = documentObj.createElement('span');
            arrow.className = 'message-follow-ups__button-arrow';
            arrow.textContent = '→';
            arrow.setAttribute('aria-hidden', 'true');
            surface.appendChild(arrow);

            button.appendChild(surface);

            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                void sendFollowUp(prompt);
            });
            button.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') {
                    return;
                }

                event.preventDefault();
                event.stopPropagation();
                void sendFollowUp(prompt);
            });
            list.appendChild(button);
        });

        container.appendChild(list);
        return container;
    }

    function decorateChatMessages() {
        const history = getCurrentHistorySafe();
        const visibleMessageId = resolveVisibleFollowUpMessageId(history);

        history.forEach((message) => {
            if (!message?.id || message.role !== 'assistant') {
                return;
            }

            const messageItem = el.chatMessages?.querySelector(`.message-item[data-message-id="${message.id}"]`);
            const wrapper = messageItem?.querySelector('.details-and-bubble-wrapper');
            if (!messageItem || !wrapper) {
                return;
            }

            wrapper.querySelector('.message-follow-ups')?.remove();

            if (message.id !== visibleMessageId) {
                return;
            }

            const followUpBlock = buildFollowUpBlock(message);
            if (!followUpBlock) {
                return;
            }

            const actions = wrapper.querySelector('.study-message-actions');
            if (actions) {
                wrapper.insertBefore(followUpBlock, actions);
            } else {
                wrapper.appendChild(followUpBlock);
            }
        });
    }

    async function readHistoryForGeneration(target = {}) {
        if (Array.isArray(target.historySnapshot)) {
            return normalizeHistory(target.historySnapshot);
        }

        if (!isCurrentView(target.agentId, target.topicId)) {
            await wait(FOLLOW_UP_HISTORY_LOAD_DELAY_MS);
        }

        const history = await chatAPI.getChatHistory(target.agentId, target.topicId).catch(() => []);
        return normalizeHistory(history);
    }

    async function persistFollowUps({
        agentId,
        topicId,
        messageId,
        followUps,
        historySnapshot = null,
    }) {
        const baseHistory = Array.isArray(historySnapshot)
            ? normalizeHistory(historySnapshot)
            : normalizeHistory(await chatAPI.getChatHistory(agentId, topicId).catch(() => []));
        let matched = false;
        const nextHistory = baseHistory.map((message) => {
            if (message?.id !== messageId) {
                return message;
            }

            matched = true;
            return {
                ...message,
                followUps: normalizeFollowUpList(followUps),
            };
        });

        if (!matched) {
            return false;
        }

        const saveResult = await chatAPI.saveChatHistory(agentId, topicId, nextHistory).catch((error) => ({
            success: false,
            error: error.message,
        }));
        if (saveResult?.success === false) {
            return false;
        }

        if (isCurrentView(agentId, topicId)) {
            updateCurrentChatHistory(() => normalizeHistory(nextHistory));
            decorateChatMessages();
        }

        return true;
    }

    async function generateForAssistantMessage(target = {}) {
        const agentId = String(target.agentId || '').trim();
        const topicId = String(target.topicId || '').trim();
        const messageId = String(target.messageId || '').trim();
        if (!agentId || !topicId || !messageId) {
            return [];
        }

        const requestKey = `${agentId}:${topicId}:${messageId}`;
        if (pendingGenerations.has(requestKey)) {
            return [];
        }

        pendingGenerations.add(requestKey);
        try {
            const history = await readHistoryForGeneration({
                agentId,
                topicId,
                historySnapshot: target.historySnapshot,
            });
            const assistantMessage = history.find((message) => message?.id === messageId);
            if (!assistantMessage || assistantMessage.role !== 'assistant' || assistantMessage.isThinking === true) {
                return [];
            }

            const visibleMessages = history.filter((message) => (
                message
                && (message.role === 'user' || message.role === 'assistant')
                && message.isThinking !== true
            ));
            if (visibleMessages.length === 0) {
                return [];
            }

            const result = await chatAPI.generateFollowUps({
                agentId,
                topicId,
                messageId,
                messages: visibleMessages,
                model: target.model || '',
            }).catch((error) => ({
                success: false,
                error: error.message,
                followUps: [],
            }));
            if (!result?.success) {
                if (result?.error) {
                    console.warn(`[FollowUpController] Failed to generate follow-ups for ${requestKey}:`, result.error);
                }
                return [];
            }

            const followUps = normalizeFollowUpList(result.followUps);
            await persistFollowUps({
                agentId,
                topicId,
                messageId,
                followUps,
                historySnapshot: history,
            });
            return followUps;
        } catch (error) {
            console.warn(`[FollowUpController] Failed to persist follow-ups for ${requestKey}:`, error);
            return [];
        } finally {
            pendingGenerations.delete(requestKey);
        }
    }

    return {
        decorateChatMessages,
        generateForAssistantMessage,
        persistFollowUps,
        resolveVisibleFollowUpMessageId,
    };
}

export {
    createFollowUpController,
};
