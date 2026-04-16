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

async function loadTopicTitleControllerModule() {
    const modulePath = path.resolve(__dirname, '../src/modules/renderer/app/topicTitles/topicTitleController.js');
    let source = await fs.readFile(modulePath, 'utf8');
    source = source.replace(
        /import\s*\{\s*normalizeHistory\s*\}\s*from\s*['"]\.\.\/composer\/composerUtils\.js['"];\s*/m,
        `
        const normalizeHistory = (history) => Array.isArray(history)
            ? history.map((message) => ({
                ...message,
                attachments: Array.isArray(message.attachments) ? message.attachments : [],
                followUps: Array.isArray(message.followUps) ? message.followUps : [],
            }))
            : [];
        `
    );
    return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
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
        const resolveComposerSendAction = ({ activeRequestId = null, hasAgentId = false, hasTopicId = false, text = '', pendingAttachmentCount = 0 } = {}) => {
            if (activeRequestId) {
                return { kind: 'interrupt' };
            }
            if (!hasAgentId || !hasTopicId) {
                return { kind: 'blocked', reason: 'missing-topic' };
            }
            if (!String(text || '').trim() && Number(pendingAttachmentCount || 0) <= 0) {
                return { kind: 'noop', reason: 'empty' };
            }
            return { kind: 'send' };
        };
        `
    );
    return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
}

test('topicTitleController updates the current topic title when the first assistant reply completes', async () => {
    const { createTopicTitleController } = await loadTopicTitleControllerModule();
    const state = {
        settings: {
            settings: {
                enableTopicTitleGeneration: true,
            },
        },
        session: {
            currentSelectedItem: { id: 'agent-1' },
            currentTopicId: 'topic-1',
            currentChatHistory: [],
            topics: [{ id: 'topic-1', name: '新对话 1' }],
        },
    };
    const store = createStore(state);
    let generatedPayload = null;
    let renderTopicsCalls = 0;
    let syncWorkspaceCalls = 0;

    const controller = createTopicTitleController({
        store,
        chatAPI: {
            async generateTopicTitle(payload) {
                generatedPayload = payload;
                return { success: true, title: '📘 一次函数复习' };
            },
            async getAgentTopics() {
                return [{ id: 'topic-1', name: '新对话 1' }];
            },
            async saveAgentTopicTitle() {
                return {
                    success: true,
                    topics: [{ id: 'topic-1', name: '📘 一次函数复习' }],
                };
            },
        },
        renderTopics() {
            renderTopicsCalls += 1;
        },
        syncWorkspaceContext() {
            syncWorkspaceCalls += 1;
        },
        getCurrentSelectedItem: () => state.session.currentSelectedItem,
        getCurrentTopicId: () => state.session.currentTopicId,
        getCurrentChatHistory: () => state.session.currentChatHistory,
    });

    const result = await controller.generateForAssistantMessage({
        agentId: 'agent-1',
        topicId: 'topic-1',
        messageId: 'assistant-1',
        historySnapshot: [
            { id: 'user-1', role: 'user', content: '帮我讲一次函数' },
            { id: 'assistant-1', role: 'assistant', content: '当然，我们先看斜率。' },
        ],
    });

    assert.equal(result, '📘 一次函数复习');
    assert.deepEqual(
        generatedPayload.messages.map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
        })),
        [
            { id: 'user-1', role: 'user', content: '帮我讲一次函数' },
            { id: 'assistant-1', role: 'assistant', content: '当然，我们先看斜率。' },
        ]
    );
    assert.equal(state.session.topics[0].name, '📘 一次函数复习');
    assert.equal(renderTopicsCalls, 1);
    assert.equal(syncWorkspaceCalls, 1);
});

test('topicTitleController persists the original topic title even after the user switches to another topic', async () => {
    const { createTopicTitleController } = await loadTopicTitleControllerModule();
    const state = {
        settings: {
            settings: {
                enableTopicTitleGeneration: true,
            },
        },
        session: {
            currentSelectedItem: { id: 'agent-1' },
            currentTopicId: 'topic-other',
            currentChatHistory: [],
            topics: [
                { id: 'topic-1', name: '新对话 1' },
                { id: 'topic-other', name: '已切换的话题' },
            ],
        },
    };
    const store = createStore(state);
    let saveCalls = 0;

    const controller = createTopicTitleController({
        store,
        chatAPI: {
            async getChatHistory(agentId, topicId) {
                assert.equal(agentId, 'agent-1');
                assert.equal(topicId, 'topic-1');
                return [
                    { id: 'user-1', role: 'user', content: '讲一下二次函数' },
                    { id: 'assistant-1', role: 'assistant', content: '我们先看开口方向。' },
                ];
            },
            async getAgentTopics() {
                return [
                    { id: 'topic-1', name: '新对话 1' },
                    { id: 'topic-other', name: '已切换的话题' },
                ];
            },
            async generateTopicTitle() {
                return { success: true, title: '📐 二次函数开口' };
            },
            async saveAgentTopicTitle() {
                saveCalls += 1;
                return {
                    success: true,
                    topics: [
                        { id: 'topic-1', name: '📐 二次函数开口' },
                        { id: 'topic-other', name: '已切换的话题' },
                    ],
                };
            },
        },
        windowObj: {
            setTimeout(callback) {
                callback();
                return 0;
            },
        },
        renderTopics() {},
        syncWorkspaceContext() {},
        getCurrentSelectedItem: () => state.session.currentSelectedItem,
        getCurrentTopicId: () => state.session.currentTopicId,
        getCurrentChatHistory: () => state.session.currentChatHistory,
    });

    const result = await controller.generateForAssistantMessage({
        agentId: 'agent-1',
        topicId: 'topic-1',
        messageId: 'assistant-1',
    });

    assert.equal(result, '📐 二次函数开口');
    assert.equal(saveCalls, 1);
    assert.equal(state.session.currentTopicId, 'topic-other');
    assert.equal(state.session.topics.find((topic) => topic.id === 'topic-1')?.name, '📐 二次函数开口');
});

test('topicTitleController does not overwrite a topic that was manually renamed during generation', async () => {
    const { createTopicTitleController } = await loadTopicTitleControllerModule();
    const state = {
        settings: {
            settings: {
                enableTopicTitleGeneration: true,
            },
        },
        session: {
            currentSelectedItem: { id: 'other-agent' },
            currentTopicId: 'topic-other',
            currentChatHistory: [],
            topics: [{ id: 'topic-other', name: '别的话题' }],
        },
    };
    const store = createStore(state);
    let topicReads = 0;
    let saveCalls = 0;

    const controller = createTopicTitleController({
        store,
        chatAPI: {
            async getChatHistory() {
                return [
                    { id: 'user-1', role: 'user', content: '请解释牛顿第二定律' },
                    { id: 'assistant-1', role: 'assistant', content: '力等于质量乘加速度。' },
                ];
            },
            async generateTopicTitle() {
                return { success: true, title: '📗 自动标题' };
            },
            async getAgentTopics() {
                topicReads += 1;
                if (topicReads === 1) {
                    return [{ id: 'topic-1', name: '新对话 1' }];
                }
                return [{ id: 'topic-1', name: '用户手动改名' }];
            },
            async saveAgentTopicTitle() {
                saveCalls += 1;
                return { success: true, topics: [] };
            },
        },
        windowObj: {
            setTimeout(callback) {
                callback();
                return 0;
            },
        },
        renderTopics() {},
        syncWorkspaceContext() {},
        getCurrentSelectedItem: () => state.session.currentSelectedItem,
        getCurrentTopicId: () => state.session.currentTopicId,
        getCurrentChatHistory: () => state.session.currentChatHistory,
    });

    const result = await controller.generateForAssistantMessage({
        agentId: 'agent-1',
        topicId: 'topic-1',
        messageId: 'assistant-1',
    });

    assert.equal(result, '');
    assert.equal(topicReads, 2);
    assert.equal(saveCalls, 0);
});

test('composerController only triggers topic title generation for the first successful assistant reply', async (t) => {
    const { createComposerController } = await loadComposerControllerModule();
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
    t.after(() => dom.window.close());

    const state = {
        session: {
            currentSelectedItem: {
                id: 'agent-1',
                name: 'Agent One',
                avatarUrl: '',
                config: {
                    model: 'agent-model',
                    temperature: 0.7,
                    maxOutputTokens: 1000,
                    streamOutput: false,
                },
            },
            currentTopicId: 'topic-1',
            currentChatHistory: [],
        },
        settings: {
            settings: {
                vcpServerUrl: 'http://example.com/v1/chat/completions',
                vcpApiKey: 'secret',
                enableTopicTitleGeneration: true,
            },
        },
        composer: {
            pendingAttachments: [],
            pendingSelectionContextRefs: [],
            activeRequestId: null,
        },
    };
    const store = createStore(state);
    const titleCalls = [];
    const followUpCalls = [];
    let responseCount = 0;

    const controller = createComposerController({
        store,
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
        chatAPI: {
            async getActiveSystemPrompt() {
                return { success: false, systemPrompt: '' };
            },
            async sendToVCP() {
                responseCount += 1;
                return {
                    response: {
                        choices: [{
                            message: {
                                content: responseCount === 1 ? '首轮回答' : '第二轮回答',
                            },
                        }],
                    },
                };
            },
        },
        ui: {
            updateAttachmentPreview() {},
            showToastNotification() {},
            autoResizeTextarea() {},
        },
        windowObj: dom.window,
        documentObj: dom.window.document,
        interruptRequest: async () => ({ success: true }),
        messageRendererApi: {
            async renderMessage() {},
            startStreamingMessage() {},
            async finalizeStreamedMessage() {},
        },
        createId: (() => {
            let count = 0;
            return (prefix) => `${prefix}_${++count}`;
        })(),
        getCurrentTopic: () => ({
            id: 'topic-1',
            name: '新对话 1',
            knowledgeBaseId: '',
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
        generateFollowUpsForAssistantMessage: async (payload) => {
            followUpCalls.push(payload);
            return [];
        },
        generateTopicTitleForAssistantMessage: async (payload) => {
            titleCalls.push(payload);
            return '📘 首轮标题';
        },
        updateCurrentChatHistory: (updater) => {
            state.session.currentChatHistory = updater(state.session.currentChatHistory);
            return state.session.currentChatHistory;
        },
        getCurrentSelectedItem: () => state.session.currentSelectedItem,
        getCurrentTopicId: () => state.session.currentTopicId,
        getCurrentChatHistory: () => state.session.currentChatHistory,
        getGlobalSettings: () => state.settings.settings,
    });

    dom.window.document.getElementById('messageInput').value = '第一问';
    await controller.handleSend();

    assert.equal(followUpCalls.length, 1);
    assert.equal(titleCalls.length, 1);
    assert.equal(titleCalls[0].historySnapshot.length, 2);
    assert.equal(titleCalls[0].historySnapshot[0].role, 'user');
    assert.equal(titleCalls[0].historySnapshot[1].role, 'assistant');

    dom.window.document.getElementById('messageInput').value = '第二问';
    await controller.handleSend();

    assert.equal(followUpCalls.length, 2);
    assert.equal(titleCalls.length, 1);
});
