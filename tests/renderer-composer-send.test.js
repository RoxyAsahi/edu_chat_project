const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');
const { JSDOM } = require('jsdom');

function createStore(initialState) {
    const state = initialState;
    return {
        getState: () => state,
        patchState(slice, patch) {
            const currentSlice = state[slice];
            state[slice] = typeof patch === 'function'
                ? patch(currentSlice, state)
                : { ...currentSlice, ...patch };
            return state[slice];
        },
    };
}

async function loadComposerControllerModule() {
    const modulePath = path.resolve(__dirname, '../src/modules/renderer/app/composer/composerController.js');
    let source = await fs.readFile(modulePath, 'utf8');
    source = source.replace(
        /import\s+\{\s*getReaderLocatorLabel\s*\}\s+from\s+['"]\.\.\/reader\/readerUtils\.js['"];\s*/m,
        `const getReaderLocatorLabel = () => '第 1 页';\n`
    );
    source = source.replace(
        /import\s*\{[\s\S]*?buildSelectionContextTemporaryMessages,[\s\S]*?resolveComposerSendAction,\s*\}\s*from\s*['"]\.\/composerUtils\.js['"];\s*/m,
        `
        const normalizeStoredAttachment = (attachment) => {
            if (!attachment || typeof attachment !== 'object') {
                return null;
            }
            return {
                ...attachment,
                name: attachment.name || 'Attachment',
                type: attachment.type || 'application/octet-stream',
                src: attachment.src || attachment.internalPath || '',
                internalPath: attachment.internalPath || attachment.src || '',
                extractedText: attachment.extractedText ?? null,
                imageFrames: Array.isArray(attachment.imageFrames) ? attachment.imageFrames : null,
            };
        };
        const normalizeAttachmentList = (attachments) => Array.isArray(attachments)
            ? attachments.map(normalizeStoredAttachment).filter(Boolean)
            : [];
        const buildAttachmentTransferPayload = (payload = {}) => payload;
        const buildKnowledgeBaseQuery = (message) => String(message?.content || '').trim();
        const buildSelectionContextTemporaryMessages = () => [];
        const resolveComposerAvailabilityState = ({ hasAgentId = false, hasTopicId = false, activeRequestId = null } = {}) => ({
            hasTopic: Boolean(hasAgentId && hasTopicId),
            interrupting: Boolean(activeRequestId),
            disableInput: !(hasAgentId && hasTopicId),
            disableAttachments: !(hasAgentId && hasTopicId),
            disableEmoticons: !(hasAgentId && hasTopicId),
            disableQuickNewTopic: !(hasAgentId && hasTopicId),
            disableSend: !(hasAgentId && hasTopicId) && !activeRequestId,
            shouldClearDragOver: !(hasAgentId && hasTopicId),
        });
        const resolveComposerSendAction = ({
            hasAgentId = false,
            hasTopicId = false,
            activeRequestId = null,
            text = '',
            pendingAttachmentCount = 0,
        } = {}) => {
            if (activeRequestId) return { kind: 'interrupt' };
            if (!hasAgentId || !hasTopicId) return { kind: 'blocked' };
            if (String(text || '').trim() || pendingAttachmentCount > 0) return { kind: 'send' };
            return { kind: 'noop' };
        };
        `
    );
    return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
}

function createComposerHarness(overrides = {}) {
    const dom = new JSDOM(`
        <body>
          <div id="chatInputCard"></div>
          <textarea id="messageInput"></textarea>
          <button id="sendMessageBtn" type="button">send</button>
          <button id="attachFileBtn" type="button">attach</button>
          <button id="emoticonTriggerBtn" type="button">emoji</button>
          <button id="composerQuickNewTopicBtn" type="button">topic</button>
          <div id="attachmentPreviewArea"></div>
          <div id="selectionContextPreview"></div>
        </body>
    `, { url: 'http://localhost' });

    const state = {
        session: {
            currentSelectedItem: {
                id: 'agent-1',
                name: 'Agent One',
                avatarUrl: '',
                config: {
                    model: 'agent-model',
                    streamOutput: false,
                },
            },
            currentTopicId: 'topic-1',
            currentChatHistory: [],
        },
        settings: {
            settings: {
                chatEndpoint: 'http://example.com/v1/chat/completions',
                chatApiKey: 'secret',
            },
        },
        composer: {
            pendingAttachments: [],
            pendingSelectionContextRefs: [],
            activeRequestId: null,
        },
    };

    return {
        dom,
        state,
        store: createStore(state),
        el: {
            chatInputCard: dom.window.document.getElementById('chatInputCard'),
            messageInput: dom.window.document.getElementById('messageInput'),
            sendMessageBtn: dom.window.document.getElementById('sendMessageBtn'),
            attachFileBtn: dom.window.document.getElementById('attachFileBtn'),
            emoticonTriggerBtn: dom.window.document.getElementById('emoticonTriggerBtn'),
            composerQuickNewTopicBtn: dom.window.document.getElementById('composerQuickNewTopicBtn'),
            attachmentPreviewArea: dom.window.document.getElementById('attachmentPreviewArea'),
            selectionContextPreview: dom.window.document.getElementById('selectionContextPreview'),
        },
        ...overrides,
    };
}

function createIdFactory() {
    let count = 0;
    return (prefix) => `${prefix}_${++count}`;
}

function flushMicrotasks() {
    return new Promise((resolve) => setImmediate(resolve));
}

test('composerController shows user and thinking bubbles before persistence, retrieval, and request send', async (t) => {
    const { createComposerController } = await loadComposerControllerModule();
    const harness = createComposerHarness();
    t.after(() => harness.dom.window.close());

    const events = [];
    let releaseFirstPersist;
    const firstPersistGate = new Promise((resolve) => {
        releaseFirstPersist = resolve;
    });
    let persistCount = 0;
    let requestPayload = null;

    const controller = createComposerController({
        store: harness.store,
        el: harness.el,
        chatAPI: {
            async getActiveSystemPrompt() {
                return { success: false, systemPrompt: '' };
            },
            async retrieveKnowledgeBaseContext() {
                events.push('retrieve');
                return {
                    success: true,
                    refs: [{ sourceId: 'doc-1', chunkId: 'chunk-1', snippet: 'source snippet' }],
                    contextText: 'KB context',
                };
            },
            async sendChatRequest(payload) {
                events.push('send');
                requestPayload = payload;
                return {
                    response: {
                        choices: [{ message: { content: '助手回复' } }],
                    },
                };
            },
        },
        ui: {
            updateAttachmentPreview() {},
            showToastNotification() {},
            scrollToBottom(options) {
                events.push(options?.force ? 'scroll:force' : 'scroll');
            },
        },
        windowObj: harness.dom.window,
        documentObj: harness.dom.window.document,
        interruptRequest: async () => ({ success: true }),
        messageRendererApi: {
            async renderMessage(message) {
                events.push(`render:${message.id}`);
            },
            async startStreamingMessage(message) {
                events.push(`start:${message.id}`);
            },
            async finalizeStreamedMessage(messageId) {
                events.push(`finalize:${messageId}`);
            },
        },
        createId: createIdFactory(),
        getCurrentTopic: () => ({
            id: 'topic-1',
            name: 'Topic One',
            knowledgeBaseId: 'kb-1',
        }),
        loadTopics: async () => {},
        loadAgents: async () => {},
        buildTopicContext: () => ({
            agentId: 'agent-1',
            topicId: 'topic-1',
        }),
        persistHistory: async () => {
            events.push('persist');
            persistCount += 1;
            if (persistCount === 1) {
                await firstPersistGate;
            }
        },
        resolveLivePrompt: async () => '',
        autoResizeTextarea: () => {},
        decorateChatMessages: () => {},
        generateFollowUpsForAssistantMessage: async () => [],
        generateTopicTitleForAssistantMessage: async () => '',
        updateCurrentChatHistory: (updater) => {
            harness.state.session.currentChatHistory = updater(harness.state.session.currentChatHistory);
            return harness.state.session.currentChatHistory;
        },
        getCurrentSelectedItem: () => harness.state.session.currentSelectedItem,
        getCurrentTopicId: () => harness.state.session.currentTopicId,
        getCurrentChatHistory: () => harness.state.session.currentChatHistory,
        getGlobalSettings: () => harness.state.settings.settings,
    });

    harness.el.messageInput.value = '解释二次函数';
    const sendPromise = controller.handleSend();
    await flushMicrotasks();

    assert.deepEqual(
        events.slice(0, 5),
        ['render:user_1', 'scroll:force', 'start:assistant_2', 'scroll:force', 'persist']
    );
    assert.equal(events.includes('retrieve'), false);
    assert.equal(events.includes('send'), false);
    assert.equal(harness.state.composer.activeRequestId, 'assistant_2');

    releaseFirstPersist();
    await sendPromise;

    assert.ok(events.indexOf('start:assistant_2') < events.indexOf('retrieve'));
    assert.ok(events.indexOf('retrieve') < events.indexOf('send'));
    assert.equal(requestPayload?.requestId, 'assistant_2');
    assert.match(requestPayload?.messages?.[0]?.content || '', /KB context/);
    assert.deepEqual(
        harness.state.session.currentChatHistory.find((message) => message.id === 'assistant_2')?.kbContextRefs,
        [{ sourceId: 'doc-1', chunkId: 'chunk-1', snippet: 'source snippet' }]
    );
});

test('composerController cancels a locally prepared request before model send starts', async (t) => {
    const { createComposerController } = await loadComposerControllerModule();
    const harness = createComposerHarness();
    t.after(() => harness.dom.window.close());

    const events = [];
    let releaseRetrieval;
    let retrievalStarted;
    const retrievalStartedPromise = new Promise((resolve) => {
        retrievalStarted = resolve;
    });
    const retrievalGate = new Promise((resolve) => {
        releaseRetrieval = resolve;
    });
    let sendCalls = 0;

    const controller = createComposerController({
        store: harness.store,
        el: harness.el,
        chatAPI: {
            async getActiveSystemPrompt() {
                return { success: false, systemPrompt: '' };
            },
            async retrieveKnowledgeBaseContext() {
                events.push('retrieve:start');
                retrievalStarted();
                await retrievalGate;
                events.push('retrieve:end');
                return { success: true, refs: [], contextText: '' };
            },
            async sendChatRequest() {
                sendCalls += 1;
                events.push('send');
                return {
                    response: {
                        choices: [{ message: { content: 'should not send' } }],
                    },
                };
            },
        },
        ui: {
            updateAttachmentPreview() {},
            showToastNotification() {},
            scrollToBottom() {},
        },
        windowObj: harness.dom.window,
        documentObj: harness.dom.window.document,
        interruptRequest: async () => {
            events.push('remote-interrupt');
            return { success: true };
        },
        messageRendererApi: {
            async renderMessage() {},
            async startStreamingMessage() {},
            async finalizeStreamedMessage(messageId, finishReason, context, payload) {
                events.push(`finalize:${messageId}:${finishReason}:${payload?.fullResponse || payload?.error || ''}`);
            },
        },
        createId: createIdFactory(),
        getCurrentTopic: () => ({
            id: 'topic-1',
            name: 'Topic One',
            knowledgeBaseId: 'kb-1',
        }),
        loadTopics: async () => {},
        loadAgents: async () => {},
        buildTopicContext: () => ({
            agentId: 'agent-1',
            topicId: 'topic-1',
        }),
        persistHistory: async () => {},
        resolveLivePrompt: async () => '',
        autoResizeTextarea: () => {},
        decorateChatMessages: () => {},
        generateFollowUpsForAssistantMessage: async () => [],
        generateTopicTitleForAssistantMessage: async () => '',
        updateCurrentChatHistory: (updater) => {
            harness.state.session.currentChatHistory = updater(harness.state.session.currentChatHistory);
            return harness.state.session.currentChatHistory;
        },
        getCurrentSelectedItem: () => harness.state.session.currentSelectedItem,
        getCurrentTopicId: () => harness.state.session.currentTopicId,
        getCurrentChatHistory: () => harness.state.session.currentChatHistory,
        getGlobalSettings: () => harness.state.settings.settings,
    });

    harness.el.messageInput.value = '先准备但不要发送';
    const firstSend = controller.handleSend();
    await retrievalStartedPromise;

    await controller.handleSend();
    releaseRetrieval();
    await firstSend;

    assert.equal(sendCalls, 0);
    assert.equal(events.includes('remote-interrupt'), false);
    assert.ok(events.includes('finalize:assistant_2:cancelled_by_user:已取消'));
    assert.equal(harness.state.composer.activeRequestId, null);
});
