const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');
const { JSDOM } = require('jsdom');

async function loadStreamManagerModule() {
    const modulePath = path.resolve(__dirname, '../src/modules/renderer/streamManager.js');
    let source = await fs.readFile(modulePath, 'utf8');
    source = source.replace(
        /^import\s+\{\s*formatMessageTimestamp\s*\}\s+from\s+['"]\.\/domBuilder\.js['"];\s*/m,
        `const formatMessageTimestamp = () => '12:34';\n`
    );
    source = source.replace(
        /^import\s+\{\s*createContentPipeline,\s*PIPELINE_MODES\s*\}\s+from\s+['"]\.\/contentPipeline\.js['"];\s*/m,
        `
        const PIPELINE_MODES = { STREAM_FAST: 'stream-fast' };
        const createContentPipeline = () => ({
            process: (text) => ({ text }),
        });
        `
    );
    return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
}

function cloneHistory(history = []) {
    return history.map((message) => ({ ...message }));
}

test('streamManager finalizes current-view messages from in-memory history before disk flush', async (t) => {
    const dom = new JSDOM(`
        <body>
          <div id="chatMessages">
            <article class="message-item thinking" data-message-id="assistant-1">
              <div class="name-time-block"></div>
              <div class="md-content"></div>
            </article>
          </div>
        </body>
    `, { url: 'http://localhost' });
    t.after(() => dom.window.close());

    const originalWindow = global.window;
    const originalDocument = global.document;
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalPerformance = global.performance;
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;

    global.window = dom.window;
    global.document = dom.window.document;
    global.requestAnimationFrame = () => 1;
    global.performance = { now: () => Date.now() };
    global.setTimeout = () => 1;
    global.clearTimeout = () => {};

    t.after(() => {
        global.window = originalWindow;
        global.document = originalDocument;
        global.requestAnimationFrame = originalRequestAnimationFrame;
        global.performance = originalPerformance;
        global.setTimeout = originalSetTimeout;
        global.clearTimeout = originalClearTimeout;
    });

    const { initStreamManager, startStreamingMessage, finalizeStreamedMessage } = await loadStreamManagerModule();

    let currentHistory = cloneHistory([
        {
            id: 'user-1',
            role: 'user',
            content: '原始问题',
            timestamp: 1,
        },
    ]);
    const diskHistory = cloneHistory(currentHistory);
    let getHistoryCalls = 0;

    initStreamManager({
        currentSelectedItemRef: {
            get: () => ({ id: 'agent-1' }),
        },
        currentTopicIdRef: {
            get: () => 'topic-1',
        },
        currentChatHistoryRef: {
            get: () => currentHistory,
            set: (value) => {
                currentHistory = cloneHistory(value);
            },
        },
        globalSettingsRef: {
            get: () => ({ enableSmoothStreaming: false }),
        },
        chatMessagesDiv: dom.window.document.getElementById('chatMessages'),
        electronAPI: {
            async getChatHistory(agentId, topicId) {
                getHistoryCalls += 1;
                assert.equal(agentId, 'agent-1');
                assert.equal(topicId, 'topic-1');
                return cloneHistory(diskHistory);
            },
            async saveChatHistory() {
                return { success: true };
            },
        },
        uiHelper: {
            scrollToBottom() {},
        },
        markedInstance: {
            parse: (text) => text,
        },
        preprocessFullContent: (text) => text,
        setContentAndProcessImages(contentDiv, rawHtml) {
            contentDiv.textContent = rawHtml;
        },
        processRenderedContent() {},
        runTextHighlights() {},
        processAnimationsInContent() {},
        prependNativeReasoningBubble: (rawHtml) => rawHtml,
        renderMessage(message) {
            const messageItem = dom.window.document.createElement('article');
            messageItem.className = 'message-item';
            messageItem.dataset.messageId = message.id;

            const nameTimeBlock = dom.window.document.createElement('div');
            nameTimeBlock.className = 'name-time-block';
            messageItem.appendChild(nameTimeBlock);

            const contentDiv = dom.window.document.createElement('div');
            contentDiv.className = 'md-content';
            messageItem.appendChild(contentDiv);

            dom.window.document.getElementById('chatMessages').appendChild(messageItem);
            return messageItem;
        },
    });

    const messageItem = dom.window.document.querySelector('.message-item[data-message-id="assistant-1"]');
    await startStreamingMessage({
        id: 'assistant-1',
        role: 'assistant',
        name: 'Agent One',
        agentId: 'agent-1',
        topicId: 'topic-1',
        content: 'Thinking',
        isThinking: true,
        timestamp: 2,
    }, messageItem);

    assert.equal(currentHistory.some((message) => message.id === 'assistant-1'), true);

    await finalizeStreamedMessage('assistant-1', 'completed', {
        agentId: 'agent-1',
        topicId: 'topic-1',
    }, {
        fullResponse: '最终回答',
    });

    const finalizedMessage = currentHistory.find((message) => message.id === 'assistant-1');
    assert.ok(finalizedMessage);
    assert.equal(finalizedMessage.content, '最终回答');
    assert.equal(finalizedMessage.finishReason, 'completed');
    assert.equal(finalizedMessage.isThinking, false);
    assert.equal(getHistoryCalls, 0);
    assert.equal(
        dom.window.document.querySelector('.message-item[data-message-id="assistant-1"] .md-content')?.textContent,
        '最终回答'
    );
    assert.equal(messageItem.classList.contains('streaming'), false);
    assert.equal(messageItem.classList.contains('thinking'), false);
});

test('streamManager recovers the active assistant message after current-view history is reloaded mid-stream', async (t) => {
    const dom = new JSDOM(`
        <body>
          <div id="chatMessages">
            <article class="message-item thinking" data-message-id="assistant-2">
              <div class="name-time-block"></div>
              <div class="md-content"></div>
            </article>
          </div>
        </body>
    `, { url: 'http://localhost' });
    t.after(() => dom.window.close());

    const originalWindow = global.window;
    const originalDocument = global.document;
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalPerformance = global.performance;
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;

    global.window = dom.window;
    global.document = dom.window.document;
    global.requestAnimationFrame = () => 1;
    global.performance = { now: () => Date.now() };
    global.setTimeout = () => 1;
    global.clearTimeout = () => {};

    t.after(() => {
        global.window = originalWindow;
        global.document = originalDocument;
        global.requestAnimationFrame = originalRequestAnimationFrame;
        global.performance = originalPerformance;
        global.setTimeout = originalSetTimeout;
        global.clearTimeout = originalClearTimeout;
    });

    const { initStreamManager, startStreamingMessage, finalizeStreamedMessage } = await loadStreamManagerModule();

    const baseHistory = cloneHistory([
        {
            id: 'user-1',
            role: 'user',
            content: '原始问题',
            timestamp: 1,
        },
    ]);
    let currentHistory = cloneHistory(baseHistory);

    initStreamManager({
        currentSelectedItemRef: {
            get: () => ({ id: 'agent-1' }),
        },
        currentTopicIdRef: {
            get: () => 'topic-1',
        },
        currentChatHistoryRef: {
            get: () => currentHistory,
            set: (value) => {
                currentHistory = cloneHistory(value);
            },
        },
        globalSettingsRef: {
            get: () => ({ enableSmoothStreaming: false }),
        },
        chatMessagesDiv: dom.window.document.getElementById('chatMessages'),
        electronAPI: {
            async getChatHistory() {
                return cloneHistory(baseHistory);
            },
            async saveChatHistory() {
                return { success: true };
            },
        },
        uiHelper: {
            scrollToBottom() {},
        },
        markedInstance: {
            parse: (text) => text,
        },
        preprocessFullContent: (text) => text,
        setContentAndProcessImages(contentDiv, rawHtml) {
            contentDiv.textContent = rawHtml;
        },
        processRenderedContent() {},
        runTextHighlights() {},
        processAnimationsInContent() {},
        prependNativeReasoningBubble: (rawHtml) => rawHtml,
        renderMessage(message) {
            const messageItem = dom.window.document.createElement('article');
            messageItem.className = 'message-item';
            messageItem.dataset.messageId = message.id;

            const nameTimeBlock = dom.window.document.createElement('div');
            nameTimeBlock.className = 'name-time-block';
            messageItem.appendChild(nameTimeBlock);

            const contentDiv = dom.window.document.createElement('div');
            contentDiv.className = 'md-content';
            messageItem.appendChild(contentDiv);

            dom.window.document.getElementById('chatMessages').appendChild(messageItem);
            return messageItem;
        },
    });

    const messageItem = dom.window.document.querySelector('.message-item[data-message-id="assistant-2"]');
    await startStreamingMessage({
        id: 'assistant-2',
        role: 'assistant',
        name: 'Agent One',
        agentId: 'agent-1',
        topicId: 'topic-1',
        content: 'Thinking',
        isThinking: true,
        timestamp: 2,
        kbContextRefs: [{
            documentId: 'doc-1',
            documentName: 'physics.pdf',
        }],
    }, messageItem);

    // Simulate a watcher refresh that reloads stale topic history before the stream finishes.
    currentHistory = cloneHistory(baseHistory);

    await finalizeStreamedMessage('assistant-2', 'completed', {
        agentId: 'agent-1',
        topicId: 'topic-1',
    }, {
        fullResponse: '恢复后的回答',
    });

    const finalizedMessage = currentHistory.find((message) => message.id === 'assistant-2');
    assert.ok(finalizedMessage);
    assert.equal(finalizedMessage.content, '恢复后的回答');
    assert.equal(finalizedMessage.finishReason, 'completed');
    assert.equal(finalizedMessage.isThinking, false);
    assert.deepEqual(finalizedMessage.kbContextRefs, [{
        documentId: 'doc-1',
        documentName: 'physics.pdf',
    }]);
    assert.equal(
        dom.window.document.querySelector('.message-item[data-message-id="assistant-2"] .md-content')?.textContent,
        '恢复后的回答'
    );
});

test('streamManager preserves fallbackMeta on the finalized assistant history entry', async (t) => {
    const dom = new JSDOM(`
        <body>
          <div id="chatMessages">
            <article class="message-item thinking" data-message-id="assistant-3">
              <div class="name-time-block"></div>
              <div class="md-content"></div>
            </article>
          </div>
        </body>
    `, { url: 'http://localhost' });
    t.after(() => dom.window.close());

    const originalWindow = global.window;
    const originalDocument = global.document;
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalPerformance = global.performance;
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;

    global.window = dom.window;
    global.document = dom.window.document;
    global.requestAnimationFrame = () => 1;
    global.performance = { now: () => Date.now() };
    global.setTimeout = () => 1;
    global.clearTimeout = () => {};

    t.after(() => {
        global.window = originalWindow;
        global.document = originalDocument;
        global.requestAnimationFrame = originalRequestAnimationFrame;
        global.performance = originalPerformance;
        global.setTimeout = originalSetTimeout;
        global.clearTimeout = originalClearTimeout;
    });

    const { initStreamManager, startStreamingMessage, finalizeStreamedMessage } = await loadStreamManagerModule();

    let currentHistory = cloneHistory([{
        id: 'user-1',
        role: 'user',
        content: '原始问题',
        timestamp: 1,
    }]);

    initStreamManager({
        currentSelectedItemRef: {
            get: () => ({ id: 'agent-1' }),
        },
        currentTopicIdRef: {
            get: () => 'topic-1',
        },
        currentChatHistoryRef: {
            get: () => currentHistory,
            set: (value) => {
                currentHistory = cloneHistory(value);
            },
        },
        globalSettingsRef: {
            get: () => ({ enableSmoothStreaming: false }),
        },
        chatMessagesDiv: dom.window.document.getElementById('chatMessages'),
        electronAPI: {
            async getChatHistory() {
                return cloneHistory(currentHistory);
            },
            async saveChatHistory() {
                return { success: true };
            },
        },
        uiHelper: {
            scrollToBottom() {},
        },
        markedInstance: {
            parse: (text) => text,
        },
        preprocessFullContent: (text) => text,
        setContentAndProcessImages(contentDiv, rawHtml) {
            contentDiv.textContent = rawHtml;
        },
        processRenderedContent() {},
        runTextHighlights() {},
        processAnimationsInContent() {},
        prependNativeReasoningBubble: (rawHtml) => rawHtml,
        renderMessage(message) {
            const messageItem = dom.window.document.createElement('article');
            messageItem.className = 'message-item';
            messageItem.dataset.messageId = message.id;

            const nameTimeBlock = dom.window.document.createElement('div');
            nameTimeBlock.className = 'name-time-block';
            messageItem.appendChild(nameTimeBlock);

            const contentDiv = dom.window.document.createElement('div');
            contentDiv.className = 'md-content';
            messageItem.appendChild(contentDiv);

            dom.window.document.getElementById('chatMessages').appendChild(messageItem);
            return messageItem;
        },
    });

    const messageItem = dom.window.document.querySelector('.message-item[data-message-id="assistant-3"]');
    await startStreamingMessage({
        id: 'assistant-3',
        role: 'assistant',
        name: 'Agent One',
        agentId: 'agent-1',
        topicId: 'topic-1',
        content: 'Thinking',
        isThinking: true,
        timestamp: 2,
    }, messageItem);

    const fallbackMeta = {
        attempted: true,
        used: true,
        skippedReason: '',
        trigger: {
            type: 'http_error',
            statusCode: 503,
            error: 'primary unavailable',
        },
        primary: {
            providerId: 'primary-provider',
            modelId: 'primary-model',
            endpoint: 'https://primary.example.com/v1/chat/completions',
        },
        fallback: {
            providerId: 'fallback-provider',
            modelId: 'fallback-model',
            endpoint: 'https://fallback.example.com/v1/chat/completions',
        },
    };

    await finalizeStreamedMessage('assistant-3', 'completed', {
        agentId: 'agent-1',
        topicId: 'topic-1',
    }, {
        fullResponse: '最终回答',
        fallbackMeta,
    });

    const finalizedMessage = currentHistory.find((message) => message.id === 'assistant-3');
    assert.ok(finalizedMessage);
    assert.deepEqual(finalizedMessage.fallbackMeta, fallbackMeta);
});

test('streamManager renders native reasoning deltas before stream finalization', async (t) => {
    const dom = new JSDOM(`
        <body>
          <div id="chatMessages">
            <article class="message-item thinking" data-message-id="assistant-reasoning-live">
              <div class="name-time-block"></div>
              <div class="md-content"><div class="thinking-indicator"></div></div>
            </article>
          </div>
        </body>
    `, { url: 'http://localhost' });
    t.after(() => dom.window.close());

    const originalWindow = global.window;
    const originalDocument = global.document;
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalPerformance = global.performance;

    global.window = dom.window;
    global.document = dom.window.document;
    global.requestAnimationFrame = () => 1;
    global.performance = { now: () => Date.now() };

    t.after(() => {
        global.window = originalWindow;
        global.document = originalDocument;
        global.requestAnimationFrame = originalRequestAnimationFrame;
        global.performance = originalPerformance;
    });

    const { initStreamManager, startStreamingMessage, appendStreamChunk } = await loadStreamManagerModule();

    let currentHistory = cloneHistory([{
        id: 'user-1',
        role: 'user',
        content: 'question',
        timestamp: 1,
    }]);

    initStreamManager({
        currentSelectedItemRef: {
            get: () => ({ id: 'agent-1' }),
        },
        currentTopicIdRef: {
            get: () => 'topic-1',
        },
        currentChatHistoryRef: {
            get: () => currentHistory,
            set: (value) => {
                currentHistory = cloneHistory(value);
            },
        },
        globalSettingsRef: {
            get: () => ({ enableSmoothStreaming: false }),
        },
        chatMessagesDiv: dom.window.document.getElementById('chatMessages'),
        electronAPI: {
            async getChatHistory() {
                return cloneHistory(currentHistory);
            },
            async saveChatHistory() {
                return { success: true };
            },
        },
        uiHelper: {
            scrollToBottom() {},
        },
        markedInstance: {
            parse: (text) => `<p>${text}</p>`,
        },
        preprocessFullContent: (text) => text,
        setContentAndProcessImages(contentDiv, rawHtml) {
            contentDiv.innerHTML = rawHtml;
        },
        processRenderedContent() {},
        runTextHighlights() {},
        processAnimationsInContent() {},
        prependNativeReasoningBubble: (rawHtml) => rawHtml,
        renderMessage() {
            throw new Error('existing DOM node should be reused');
        },
    });

    const messageItem = dom.window.document.querySelector('.message-item[data-message-id="assistant-reasoning-live"]');
    await startStreamingMessage({
        id: 'assistant-reasoning-live',
        role: 'assistant',
        name: 'Agent One',
        agentId: 'agent-1',
        topicId: 'topic-1',
        content: 'Thinking',
        isThinking: true,
        timestamp: 2,
    }, messageItem);

    appendStreamChunk('assistant-reasoning-live', {
        reasoningDelta: 'live reasoning ',
        chunk: { choices: [{ delta: { reasoning_content: 'live reasoning ' } }] },
    }, {
        agentId: 'agent-1',
        topicId: 'topic-1',
    });

    const contentDiv = dom.window.document.querySelector('.message-item[data-message-id="assistant-reasoning-live"] .md-content');
    assert.match(contentDiv.innerHTML, /native-reasoning-bubble/);
    assert.match(contentDiv.textContent, /live reasoning/);

    const bubble = contentDiv.querySelector('.native-reasoning-bubble');
    const header = contentDiv.querySelector('.unistudy-live-reasoning-header');
    assert.ok(header);
    header.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.ok(contentDiv.querySelector('.native-reasoning-bubble.expanded'));

    appendStreamChunk('assistant-reasoning-live', {
        reasoningDelta: 'keeps expanding ',
        chunk: { choices: [{ delta: { reasoning_content: 'keeps expanding ' } }] },
    }, {
        agentId: 'agent-1',
        topicId: 'topic-1',
    });

    assert.ok(contentDiv.querySelector('.native-reasoning-bubble.expanded'));
    assert.equal(contentDiv.querySelector('.unistudy-live-reasoning-header'), header);
    assert.match(contentDiv.textContent, /keeps expanding/);
});

test('streamManager renders a completed tool request block before stream finalization', async (t) => {
    const dom = new JSDOM(`
        <body>
          <div id="chatMessages">
            <article class="message-item thinking" data-message-id="assistant-tool-live">
              <div class="name-time-block"></div>
              <div class="md-content"><div class="thinking-indicator"></div></div>
            </article>
          </div>
        </body>
    `, { url: 'http://localhost' });
    t.after(() => dom.window.close());

    const originalWindow = global.window;
    const originalDocument = global.document;
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalPerformance = global.performance;

    global.window = dom.window;
    global.document = dom.window.document;
    global.requestAnimationFrame = () => 1;
    global.performance = { now: () => Date.now() };

    t.after(() => {
        global.window = originalWindow;
        global.document = originalDocument;
        global.requestAnimationFrame = originalRequestAnimationFrame;
        global.performance = originalPerformance;
    });

    const { initStreamManager, startStreamingMessage, appendStreamChunk } = await loadStreamManagerModule();

    let currentHistory = cloneHistory([{
        id: 'user-tool-live',
        role: 'user',
        content: 'write a note',
        timestamp: 1,
    }]);

    initStreamManager({
        currentSelectedItemRef: {
            get: () => ({ id: 'agent-1' }),
        },
        currentTopicIdRef: {
            get: () => 'topic-1',
        },
        currentChatHistoryRef: {
            get: () => currentHistory,
            set: (value) => {
                currentHistory = cloneHistory(value);
            },
        },
        globalSettingsRef: {
            get: () => ({ enableSmoothStreaming: false }),
        },
        chatMessagesDiv: dom.window.document.getElementById('chatMessages'),
        electronAPI: {
            async getChatHistory() {
                return cloneHistory(currentHistory);
            },
            async saveChatHistory() {
                return { success: true };
            },
        },
        uiHelper: {
            scrollToBottom() {},
        },
        markedInstance: {
            parse: (text) => {
                if (text.includes('<<<[TOOL_REQUEST]>>>') && text.includes('<<<[END_TOOL_REQUEST]>>>')) {
                    return '<p>回答</p><div class="learning-diary-bubble">学习日志已渲染</div>';
                }
                return `<p>${text}</p>`;
            },
        },
        preprocessFullContent: (text) => text,
        setContentAndProcessImages(contentDiv, rawHtml) {
            contentDiv.innerHTML = rawHtml;
        },
        processRenderedContent() {},
        runTextHighlights() {},
        processAnimationsInContent() {},
        prependNativeReasoningBubble: (rawHtml) => rawHtml,
        renderMessage() {
            throw new Error('existing DOM node should be reused');
        },
    });

    const messageItem = dom.window.document.querySelector('.message-item[data-message-id="assistant-tool-live"]');
    await startStreamingMessage({
        id: 'assistant-tool-live',
        role: 'assistant',
        name: 'Agent One',
        agentId: 'agent-1',
        topicId: 'topic-1',
        content: 'Thinking',
        isThinking: true,
        timestamp: 2,
    }, messageItem);

    appendStreamChunk('assistant-tool-live', {
        content: '回答\n<<<[TOOL_REQUEST]>>>\ntool_name:「始」DailyNote「末」\n',
    }, {
        agentId: 'agent-1',
        topicId: 'topic-1',
    });

    const contentDiv = dom.window.document.querySelector('.message-item[data-message-id="assistant-tool-live"] .md-content');
    assert.doesNotMatch(contentDiv.innerHTML, /learning-diary-bubble/);

    appendStreamChunk('assistant-tool-live', {
        content: 'command:「始」create「末」\nContent:「始」[12:00] 流式工具块闭合后即时渲染。\nTag: 流式「末」\n<<<[END_TOOL_REQUEST]>>>',
    }, {
        agentId: 'agent-1',
        topicId: 'topic-1',
    });

    assert.match(contentDiv.innerHTML, /learning-diary-bubble/);
    assert.match(contentDiv.textContent, /学习日志已渲染/);
});

test('streamManager post-processes completed HTML code blocks after the fence closes', async (t) => {
    const dom = new JSDOM(`
        <body>
          <div id="chatMessages">
            <article class="message-item thinking" data-message-id="assistant-html-live">
              <div class="name-time-block"></div>
              <div class="md-content"><div class="thinking-indicator"></div></div>
            </article>
          </div>
        </body>
    `, { url: 'http://localhost' });
    t.after(() => dom.window.close());

    const originalWindow = global.window;
    const originalDocument = global.document;
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalPerformance = global.performance;

    global.window = dom.window;
    global.document = dom.window.document;
    global.requestAnimationFrame = () => 1;
    global.performance = { now: () => Date.now() };

    t.after(() => {
        global.window = originalWindow;
        global.document = originalDocument;
        global.requestAnimationFrame = originalRequestAnimationFrame;
        global.performance = originalPerformance;
    });

    const { initStreamManager, startStreamingMessage, appendStreamChunk } = await loadStreamManagerModule();

    let currentHistory = cloneHistory([{
        id: 'user-html-live',
        role: 'user',
        content: 'render html',
        timestamp: 1,
    }]);

    initStreamManager({
        currentSelectedItemRef: {
            get: () => ({ id: 'agent-1' }),
        },
        currentTopicIdRef: {
            get: () => 'topic-1',
        },
        currentChatHistoryRef: {
            get: () => currentHistory,
            set: (value) => {
                currentHistory = cloneHistory(value);
            },
        },
        globalSettingsRef: {
            get: () => ({ enableSmoothStreaming: false }),
        },
        chatMessagesDiv: dom.window.document.getElementById('chatMessages'),
        electronAPI: {
            async getChatHistory() {
                return cloneHistory(currentHistory);
            },
            async saveChatHistory() {
                return { success: true };
            },
        },
        uiHelper: {
            scrollToBottom() {},
        },
        markedInstance: {
            parse: (text) => text.replace(/```html\n([\s\S]*?)```/g, (_match, code) => {
                return `<pre><code class="language-html">${code}</code></pre>`;
            }),
        },
        preprocessFullContent: (text) => text,
        setContentAndProcessImages(contentDiv, rawHtml) {
            contentDiv.innerHTML = rawHtml;
        },
        processRenderedContent(contentDiv) {
            const pre = contentDiv.querySelector('pre');
            if (!pre) return;
            const preview = dom.window.document.createElement('div');
            preview.className = 'unistudy-html-preview-container preview-mode';
            preview.textContent = 'HTML 已预览';
            pre.replaceWith(preview);
        },
        runTextHighlights() {},
        processAnimationsInContent() {},
        prependNativeReasoningBubble: (rawHtml) => rawHtml,
        renderMessage() {
            throw new Error('existing DOM node should be reused');
        },
    });

    const messageItem = dom.window.document.querySelector('.message-item[data-message-id="assistant-html-live"]');
    await startStreamingMessage({
        id: 'assistant-html-live',
        role: 'assistant',
        name: 'Agent One',
        agentId: 'agent-1',
        topicId: 'topic-1',
        content: 'Thinking',
        isThinking: true,
        timestamp: 2,
    }, messageItem);

    appendStreamChunk('assistant-html-live', {
        content: '```html\n<div class="demo">',
    }, {
        agentId: 'agent-1',
        topicId: 'topic-1',
    });

    const contentDiv = dom.window.document.querySelector('.message-item[data-message-id="assistant-html-live"] .md-content');
    assert.doesNotMatch(contentDiv.innerHTML, /unistudy-live-html-preview/);
    assert.doesNotMatch(contentDiv.innerHTML, /unistudy-html-preview-container/);
    assert.match(contentDiv.textContent, /```html/);

    appendStreamChunk('assistant-html-live', {
        content: '<button>Start</button></div>\n```',
    }, {
        agentId: 'agent-1',
        topicId: 'topic-1',
    });

    assert.match(contentDiv.innerHTML, /unistudy-html-preview-container/);
    assert.match(contentDiv.textContent, /HTML 已预览/);
});

test('streamManager streams bare HTML fragments through marked into the message DOM', async (t) => {
    const dom = new JSDOM(`
        <body>
          <div id="chatMessages">
            <article class="message-item thinking" data-message-id="assistant-raw-html-live">
              <div class="name-time-block"></div>
              <div class="md-content"><div class="thinking-indicator"></div></div>
            </article>
          </div>
        </body>
    `, { url: 'http://localhost' });
    t.after(() => dom.window.close());

    const originalWindow = global.window;
    const originalDocument = global.document;
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalPerformance = global.performance;

    global.window = dom.window;
    global.document = dom.window.document;
    global.requestAnimationFrame = () => 1;
    global.performance = { now: () => Date.now() };

    t.after(() => {
        global.window = originalWindow;
        global.document = originalDocument;
        global.requestAnimationFrame = originalRequestAnimationFrame;
        global.performance = originalPerformance;
    });

    const { initStreamManager, startStreamingMessage, appendStreamChunk } = await loadStreamManagerModule();

    let currentHistory = cloneHistory([{
        id: 'user-raw-html-live',
        role: 'user',
        content: 'render raw html',
        timestamp: 1,
    }]);

    initStreamManager({
        currentSelectedItemRef: {
            get: () => ({ id: 'agent-1' }),
        },
        currentTopicIdRef: {
            get: () => 'topic-1',
        },
        currentChatHistoryRef: {
            get: () => currentHistory,
            set: (value) => {
                currentHistory = cloneHistory(value);
            },
        },
        globalSettingsRef: {
            get: () => ({ enableSmoothStreaming: false }),
        },
        chatMessagesDiv: dom.window.document.getElementById('chatMessages'),
        electronAPI: {
            async getChatHistory() {
                return cloneHistory(currentHistory);
            },
            async saveChatHistory() {
                return { success: true };
            },
        },
        uiHelper: {
            scrollToBottom() {},
        },
        markedInstance: {
            parse: (text) => text,
        },
        preprocessFullContent: (text) => text,
        setContentAndProcessImages(contentDiv, rawHtml) {
            contentDiv.innerHTML = rawHtml;
        },
        processRenderedContent() {},
        runTextHighlights() {},
        processAnimationsInContent() {},
        prependNativeReasoningBubble: (rawHtml) => rawHtml,
        renderMessage() {
            throw new Error('existing DOM node should be reused');
        },
    });

    const messageItem = dom.window.document.querySelector('.message-item[data-message-id="assistant-raw-html-live"]');
    await startStreamingMessage({
        id: 'assistant-raw-html-live',
        role: 'assistant',
        name: 'Agent One',
        agentId: 'agent-1',
        topicId: 'topic-1',
        content: 'Thinking',
        isThinking: true,
        timestamp: 2,
    }, messageItem);

    appendStreamChunk('assistant-raw-html-live', {
        content: '<div id="response-root" class="demo"><button>Go</button>',
    }, {
        agentId: 'agent-1',
        topicId: 'topic-1',
    });

    const contentDiv = dom.window.document.querySelector('.message-item[data-message-id="assistant-raw-html-live"] .md-content');
    assert.ok(contentDiv.querySelector('#response-root.demo'));
    assert.ok(contentDiv.querySelector('button'));
    assert.equal(contentDiv.querySelector('button')?.textContent, 'Go');
    assert.doesNotMatch(contentDiv.innerHTML, /unistudy-live-html-preview/);
    assert.doesNotMatch(contentDiv.innerHTML, /<pre>/);

    appendStreamChunk('assistant-raw-html-live', {
        content: '<span>More</span></div>',
    }, {
        agentId: 'agent-1',
        topicId: 'topic-1',
    });

    assert.ok(contentDiv.querySelector('#response-root.demo span'));
    assert.equal(contentDiv.querySelector('#response-root.demo span')?.textContent, 'More');
});
