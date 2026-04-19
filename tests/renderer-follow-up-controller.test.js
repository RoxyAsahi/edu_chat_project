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

async function loadFollowUpControllerModule() {
    const modulePath = path.resolve(__dirname, '../src/modules/renderer/app/followUps/followUpController.js');
    let source = await fs.readFile(modulePath, 'utf8');
    source = source.replace(
        /import\s*\{\s*normalizeFollowUpList,\s*normalizeHistory,\s*\}\s*from\s*['"]\.\.\/composer\/composerUtils\.js['"];\s*/m,
        `
        const normalizeFollowUpList = (followUps) => Array.isArray(followUps)
            ? [...new Set(followUps.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 3)
            : [];
        const normalizeHistory = (history) => Array.isArray(history)
            ? history.map((message) => ({
                ...message,
                followUps: normalizeFollowUpList(message.followUps),
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
        const resolveComposerSendAction = () => ({ kind: 'send' });
        `
    );
    return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
}

test('followUpController decorates only the last visible assistant message and removes stale blocks', async (t) => {
    const { createFollowUpController } = await loadFollowUpControllerModule();
    const dom = new JSDOM(`
        <body>
          <div id="chatMessages">
            <article class="message-item" data-message-id="assistant-1">
              <div class="details-and-bubble-wrapper">
                <div class="md-content">A1</div>
                <div class="study-message-actions"></div>
              </div>
            </article>
            <article class="message-item" data-message-id="assistant-2">
              <div class="details-and-bubble-wrapper">
                <div class="md-content">A2</div>
                <div class="study-message-actions"></div>
              </div>
            </article>
          </div>
        </body>
    `, { url: 'http://localhost' });
    t.after(() => dom.window.close());

    const state = {
        session: {
            currentSelectedItem: { id: 'agent-1' },
            currentTopicId: 'topic-1',
            currentChatHistory: [
                { id: 'assistant-1', role: 'assistant', content: '回答 1', followUps: ['旧追问'] },
                { id: 'user-1', role: 'user', content: '继续' },
                {
                    id: 'assistant-2',
                    role: 'assistant',
                    content: '回答 2',
                    followUps: ['最新追问 1', '最新追问 2', '最新追问 3', '最新追问 4'],
                },
            ],
        },
    };
    const store = createStore(state);
    const sentPrompts = [];
    const controller = createFollowUpController({
        store,
        el: {
            chatMessages: dom.window.document.getElementById('chatMessages'),
        },
        documentObj: dom.window.document,
        windowObj: dom.window,
        sendFollowUp: async (prompt) => {
            sentPrompts.push(prompt);
        },
        getCurrentSelectedItem: () => state.session.currentSelectedItem,
        getCurrentTopicId: () => state.session.currentTopicId,
        getCurrentChatHistory: () => state.session.currentChatHistory,
        updateCurrentChatHistory: (updater) => {
            state.session.currentChatHistory = updater(state.session.currentChatHistory);
            return state.session.currentChatHistory;
        },
    });

    controller.decorateChatMessages();

    assert.equal(dom.window.document.querySelectorAll('.message-follow-ups').length, 1);
    assert.equal(
        dom.window.document.querySelector('.message-item[data-message-id="assistant-1"] .message-follow-ups'),
        null
    );
    assert.equal(
        dom.window.document.querySelectorAll('.message-item[data-message-id="assistant-2"] .message-follow-ups__button').length,
        3
    );
    assert.equal(
        dom.window.document.querySelector('.message-item[data-message-id="assistant-2"] .message-follow-ups__button-arrow')?.textContent,
        '→'
    );

    dom.window.document.querySelector('.message-item[data-message-id="assistant-2"] .message-follow-ups__button')?.click();
    assert.deepEqual(sentPrompts, ['最新追问 1']);

    const keyboardTarget = dom.window.document.querySelector('.message-item[data-message-id="assistant-2"] .message-follow-ups__button');
    keyboardTarget?.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
    }));
    assert.deepEqual(sentPrompts, ['最新追问 1', '最新追问 1']);

    state.session.currentChatHistory = [
        ...state.session.currentChatHistory,
        { id: 'user-2', role: 'user', content: '新问题' },
    ];
    controller.decorateChatMessages();
    assert.equal(dom.window.document.querySelectorAll('.message-follow-ups').length, 0);

    state.session.currentChatHistory = [
        { id: 'assistant-1', role: 'assistant', content: '回答 1', followUps: ['旧追问'] },
        { id: 'user-1', role: 'user', content: '继续' },
        { id: 'assistant-2', role: 'assistant', content: '回答 2', followUps: ['最新追问 1'] },
        { id: 'assistant-thinking', role: 'assistant', content: 'Thinking', isThinking: true },
    ];
    controller.decorateChatMessages();
    assert.equal(dom.window.document.querySelectorAll('.message-follow-ups').length, 0);
});

test('followUpController writes follow-ups back to the original topic history after the user switches views', async (t) => {
    const { createFollowUpController } = await loadFollowUpControllerModule();
    const dom = new JSDOM('<body><div id="chatMessages"></div></body>', { url: 'http://localhost' });
    t.after(() => dom.window.close());

    const state = {
        session: {
            currentSelectedItem: { id: 'other-agent' },
            currentTopicId: 'other-topic',
            currentChatHistory: [],
        },
    };
    const store = createStore(state);
    const targetHistory = [
        { id: 'user-1', role: 'user', content: '原问题' },
        { id: 'assistant-1', role: 'assistant', content: '原回答' },
    ];
    let generatedPayload = null;
    let savedHistory = null;
    let currentHistoryUpdates = 0;

    const controller = createFollowUpController({
        store,
        el: {
            chatMessages: dom.window.document.getElementById('chatMessages'),
        },
        chatAPI: {
            async getChatHistory(agentId, topicId) {
                assert.equal(agentId, 'agent-1');
                assert.equal(topicId, 'topic-1');
                return targetHistory;
            },
            async generateFollowUps(payload) {
                generatedPayload = payload;
                return {
                    success: true,
                    followUps: ['追问 1', '追问 2'],
                };
            },
            async saveChatHistory(agentId, topicId, history) {
                savedHistory = { agentId, topicId, history };
                return { success: true };
            },
        },
        documentObj: dom.window.document,
        windowObj: {
            setTimeout(callback) {
                callback();
                return 0;
            },
        },
        getCurrentSelectedItem: () => state.session.currentSelectedItem,
        getCurrentTopicId: () => state.session.currentTopicId,
        getCurrentChatHistory: () => state.session.currentChatHistory,
        updateCurrentChatHistory: () => {
            currentHistoryUpdates += 1;
        },
    });

    const result = await controller.generateForAssistantMessage({
        agentId: 'agent-1',
        topicId: 'topic-1',
        messageId: 'assistant-1',
    });

    assert.deepEqual(result, ['追问 1', '追问 2']);
    assert.deepEqual(
        generatedPayload.messages.map(({ id, role, content, followUps }) => ({
            id,
            role,
            content,
            followUps,
        })),
        [
            { id: 'user-1', role: 'user', content: '原问题', followUps: [] },
            { id: 'assistant-1', role: 'assistant', content: '原回答', followUps: [] },
        ]
    );
    assert.equal(savedHistory.agentId, 'agent-1');
    assert.equal(savedHistory.topicId, 'topic-1');
    assert.deepEqual(
        savedHistory.history.find((message) => message.id === 'assistant-1')?.followUps,
        ['追问 1', '追问 2']
    );
    assert.equal(currentHistoryUpdates, 0);
});

test('composerController sendFollowUp sends only the clicked prompt and preserves the current draft state', async (t) => {
    const { createComposerController } = await loadComposerControllerModule();
    const dom = new JSDOM(`
        <body>
          <div id="chatInputCard"></div>
          <textarea id="messageInput">draft composer text</textarea>
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
            },
        },
        composer: {
            pendingAttachments: [{
                name: 'draft.pdf',
                type: 'application/pdf',
                src: 'file:///draft.pdf',
                internalPath: 'file:///draft.pdf',
                extractedText: 'draft attachment text',
            }],
            pendingSelectionContextRefs: [{
                documentId: 'doc-1',
                documentName: 'reader.pdf',
                selectionText: 'draft selection',
            }],
            activeRequestId: null,
        },
    };
    const store = createStore(state);
    let requestPayload = null;

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
            async sendToVCP(payload) {
                requestPayload = payload;
                return {
                    response: {
                        choices: [{
                            message: {
                                content: '助手回复',
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
            name: 'Topic One',
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
        generateFollowUpsForAssistantMessage: async () => [],
        updateCurrentChatHistory: (updater) => {
            state.session.currentChatHistory = updater(state.session.currentChatHistory);
            return state.session.currentChatHistory;
        },
        getCurrentSelectedItem: () => state.session.currentSelectedItem,
        getCurrentTopicId: () => state.session.currentTopicId,
        getCurrentChatHistory: () => state.session.currentChatHistory,
        getGlobalSettings: () => state.settings.settings,
    });

    await controller.sendFollowUp('点击后的追问');

    assert.deepEqual(requestPayload.messages, [
        { role: 'user', content: '点击后的追问' },
    ]);
    assert.equal(dom.window.document.getElementById('messageInput').value, 'draft composer text');
    assert.equal(store.getState().composer.pendingAttachments.length, 1);
    assert.equal(store.getState().composer.pendingSelectionContextRefs.length, 1);
    assert.deepEqual(
        state.session.currentChatHistory.find((message) => message.role === 'user'),
        {
            id: 'user_1',
            role: 'user',
            content: '点击后的追问',
            timestamp: state.session.currentChatHistory.find((message) => message.role === 'user').timestamp,
            attachments: [],
            selectionContextRefs: [],
        }
    );
});

test('composerController adds selected emoticons into the shared attachment preview flow', async (t) => {
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
                config: {},
            },
            currentTopicId: 'topic-1',
            currentChatHistory: [],
        },
        settings: {
            settings: {},
        },
        composer: {
            pendingAttachments: [],
            pendingSelectionContextRefs: [],
            activeRequestId: null,
        },
    };
    const store = createStore(state);
    const previewCalls = [];

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
        chatAPI: {},
        ui: {
            updateAttachmentPreview(attachments) {
                previewCalls.push(attachments.map((item) => ({
                    name: item.name,
                    type: item.type,
                    src: item.src,
                    internalPath: item.internalPath,
                    renderPath: item.renderPath,
                })));
            },
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
            name: 'Topic One',
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
        generateFollowUpsForAssistantMessage: async () => [],
        updateCurrentChatHistory: (updater) => {
            state.session.currentChatHistory = updater(state.session.currentChatHistory);
            return state.session.currentChatHistory;
        },
        getCurrentSelectedItem: () => state.session.currentSelectedItem,
        getCurrentTopicId: () => state.session.currentTopicId,
        getCurrentChatHistory: () => state.session.currentChatHistory,
        getGlobalSettings: () => state.settings.settings,
    });

    const result = await controller.addEmoticonAttachment({
        id: 'bundled:通用表情包:不要优化我.jpg',
        filename: '不要优化我.jpg',
        name: '不要优化我',
        category: '通用表情包',
        url: 'file:///C:/packs/%E4%B8%8D%E8%A6%81%E4%BC%98%E5%8C%96%E6%88%91.jpg',
        renderPath: '/通用表情包/不要优化我.jpg',
        source: 'bundled',
    });

    assert.equal(result.success, true);
    assert.equal(store.getState().composer.pendingAttachments.length, 1);
    assert.equal(store.getState().composer.pendingAttachments[0].name, '不要优化我.jpg');
    assert.equal(store.getState().composer.pendingAttachments[0].type, 'image/jpeg');
    assert.equal(store.getState().composer.pendingAttachments[0].src, 'file:///C:/packs/%E4%B8%8D%E8%A6%81%E4%BC%98%E5%8C%96%E6%88%91.jpg');
    assert.equal(store.getState().composer.pendingAttachments[0].internalPath, 'file:///C:/packs/%E4%B8%8D%E8%A6%81%E4%BC%98%E5%8C%96%E6%88%91.jpg');
    assert.equal(store.getState().composer.pendingAttachments[0].attachmentKind, 'emoticon');
    assert.equal(store.getState().composer.pendingAttachments[0].renderPath, '/通用表情包/不要优化我.jpg');
    assert.equal(previewCalls.length, 1);
    assert.deepEqual(previewCalls[0], [{
        name: '不要优化我.jpg',
        type: 'image/jpeg',
        src: 'file:///C:/packs/%E4%B8%8D%E8%A6%81%E4%BC%98%E5%8C%96%E6%88%91.jpg',
        internalPath: 'file:///C:/packs/%E4%B8%8D%E8%A6%81%E4%BC%98%E5%8C%96%E6%88%91.jpg',
        renderPath: '/通用表情包/不要优化我.jpg',
    }]);
});

test('composerController serializes emoticon attachments back into pseudo-path img tags for upstream messages', async (t) => {
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
                config: {},
            },
            currentTopicId: 'topic-1',
            currentChatHistory: [],
        },
        settings: {
            settings: {},
        },
        composer: {
            pendingAttachments: [],
            pendingSelectionContextRefs: [],
            activeRequestId: null,
        },
    };
    const store = createStore(state);
    let base64Reads = 0;

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
            async getFileAsBase64() {
                base64Reads += 1;
                return { success: true, base64Frames: ['abc'] };
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
            name: 'Topic One',
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
        generateFollowUpsForAssistantMessage: async () => [],
        updateCurrentChatHistory: (updater) => {
            state.session.currentChatHistory = updater(state.session.currentChatHistory);
            return state.session.currentChatHistory;
        },
        getCurrentSelectedItem: () => state.session.currentSelectedItem,
        getCurrentTopicId: () => state.session.currentTopicId,
        getCurrentChatHistory: () => state.session.currentChatHistory,
        getGlobalSettings: () => state.settings.settings,
    });

    const messages = await controller.buildApiMessages({
        historyOverride: [{
            id: 'user-1',
            role: 'user',
            content: '',
            attachments: [{
                name: '不要优化我.jpg',
                type: 'image/jpeg',
                src: 'file:///C:/packs/%E4%B8%8D%E8%A6%81%E4%BC%98%E5%8C%96%E6%88%91.jpg',
                internalPath: 'file:///C:/packs/%E4%B8%8D%E8%A6%81%E4%BC%98%E5%8C%96%E6%88%91.jpg',
                renderPath: '/通用表情包/不要优化我.jpg',
                attachmentKind: 'emoticon',
                emoticonId: 'bundled:通用表情包:不要优化我.jpg',
                emoticonCategory: '通用表情包',
                source: 'bundled',
            }],
        }],
    });

    assert.deepEqual(messages, [{
        role: 'user',
        content: '<img src="/通用表情包/不要优化我.jpg" width="80">',
    }]);
    assert.equal(base64Reads, 0);
});
