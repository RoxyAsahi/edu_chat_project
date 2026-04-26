const test = require('node:test');
const assert = require('assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const { JSDOM } = require('jsdom');

function escapeHtml(text = '') {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function parseMarkdownForPreview(markdown = '') {
    const source = String(markdown || '');
    const rendered = source.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
        const languageClass = lang ? ` class="language-${escapeHtml(lang)}"` : '';
        return `<pre><code${languageClass}>${escapeHtml(code)}</code></pre>`;
    });

    if (rendered !== source) {
        return rendered;
    }

    if (/^\s*</.test(source)) {
        return source;
    }

    return `<p>${escapeHtml(source).replace(/\n/g, '<br>')}</p>`;
}

async function waitFor(predicate, timeoutMs = 500) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (predicate()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(predicate(), true, 'condition did not become true before timeout');
}

async function createHarness(t) {
    const dom = new JSDOM(`<!doctype html><html><body class="light-theme">
        <div class="chat-messages-container">
            <div id="chatMessages"></div>
        </div>
        <div id="messageCitationPopover" class="hidden"></div>
    </body></html>`, {
        pretendToBeVisual: true,
        url: 'http://localhost',
    });

    const previousGlobals = {
        cancelAnimationFrame: global.cancelAnimationFrame,
        CustomEvent: global.CustomEvent,
        document: global.document,
        Element: global.Element,
        HTMLElement: global.HTMLElement,
        IntersectionObserver: global.IntersectionObserver,
        MutationObserver: global.MutationObserver,
        Node: global.Node,
        NodeFilter: global.NodeFilter,
        requestAnimationFrame: global.requestAnimationFrame,
        SVGElement: global.SVGElement,
        window: global.window,
    };
    const previousElementGetAnimations = dom.window.Element.prototype.getAnimations;

    global.window = dom.window;
    global.document = dom.window.document;
    global.Element = dom.window.Element;
    global.HTMLElement = dom.window.HTMLElement;
    global.Node = dom.window.Node;
    global.NodeFilter = dom.window.NodeFilter;
    global.SVGElement = dom.window.SVGElement;
    global.CustomEvent = dom.window.CustomEvent;
    global.MutationObserver = dom.window.MutationObserver;
    global.IntersectionObserver = class IntersectionObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
    global.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
    global.cancelAnimationFrame = (id) => clearTimeout(id);
    dom.window.IntersectionObserver = global.IntersectionObserver;
    dom.window.requestAnimationFrame = global.requestAnimationFrame;
    dom.window.cancelAnimationFrame = global.cancelAnimationFrame;
    dom.window.morphdom = () => {};
    dom.window.Element.prototype.getAnimations = () => [];
    dom.window.pretextBridge = {
        clearAll() {},
        isReady: () => false,
    };

    const chatMessages = dom.window.document.getElementById('chatMessages');
    const history = [];
    const modulePath = path.resolve(__dirname, '../src/modules/renderer/messageRenderer.js');
    const messageRenderer = await import(`${pathToFileURL(modulePath).href}?htmlPreviewTest=${Date.now()}${Math.random()}`);

    messageRenderer.initializeMessageRenderer({
        chatMessagesDiv: chatMessages,
        currentChatHistoryRef: {
            get: () => history,
            set: (value) => {
                history.splice(0, history.length, ...value);
            },
        },
        currentSelectedItemRef: {
            get: () => ({
                id: 'agent-1',
                type: 'agent',
                name: 'Tutor',
                avatarUrl: '../assets/default_avatar.png',
                config: {},
            }),
            set: () => {},
        },
        currentTopicIdRef: {
            get: () => 'topic-1',
            set: () => {},
        },
        globalSettingsRef: {
            get: () => ({
                userName: 'User',
                userAvatarUrl: '../assets/default_user_avatar.png',
                userAvatarCalculatedColor: null,
                enableUserChatBubbleUi: true,
                showUserMetaInChatBubbleUi: true,
            }),
            set: () => {},
        },
        electronAPI: {
            getEmoticonLibrary: async () => [],
            getChatHistory: async () => history.map((message) => ({ ...message })),
            openImageViewer() {},
            saveChatHistory: async () => ({ success: true }),
            saveAvatarColor: async () => ({ success: true }),
            showImageContextMenu() {},
        },
        markedInstance: {
            parse: parseMarkdownForPreview,
        },
        messageCitationPopover: dom.window.document.getElementById('messageCitationPopover'),
        uiHelper: {
            scrollToBottom() {},
        },
    });

    t.after(() => {
        messageRenderer.clearChat({ preserveHistory: true });
        if (previousElementGetAnimations === undefined) {
            delete dom.window.Element.prototype.getAnimations;
        } else {
            dom.window.Element.prototype.getAnimations = previousElementGetAnimations;
        }
        dom.window.close();
        Object.entries(previousGlobals).forEach(([key, value]) => {
            if (value === undefined) {
                delete global[key];
            } else {
                global[key] = value;
            }
        });
    });

    return { chatMessages, history, messageRenderer };
}

test('messageRenderer wraps raw doctype HTML into an interactive preview block', async (t) => {
    const { chatMessages, history, messageRenderer } = await createHarness(t);
    const message = {
        id: 'assistant-html-doctype',
        role: 'assistant',
        name: 'Tutor',
        content: '<!DOCTYPE html>\n<html><body><button>Start</button></body></html>',
        timestamp: Date.UTC(2026, 3, 26, 8, 0),
    };
    history.push(message);

    await messageRenderer.renderMessage(message);

    await waitFor(() => chatMessages.querySelector('.unistudy-html-preview-container.preview-mode'));
    const previewContainer = chatMessages.querySelector('.unistudy-html-preview-container');
    assert.ok(previewContainer);
    assert.ok(previewContainer.querySelector('.unistudy-html-preview-toggle'));
    assert.ok(previewContainer.querySelector('.unistudy-html-preview-frame'));
    assert.equal(previewContainer.querySelector('pre')?.dataset.richHtmlPreview, 'true');
});

test('messageRenderer keeps raw html fragments without a doctype as inline DOM', async (t) => {
    const { chatMessages, history, messageRenderer } = await createHarness(t);
    const message = {
        id: 'assistant-html-plain',
        role: 'assistant',
        name: 'Tutor',
        content: '<div id="response-root"><h1>Plain HTML</h1><button>Start</button></div>',
        timestamp: Date.UTC(2026, 3, 26, 8, 1),
    };
    history.push(message);

    await messageRenderer.renderMessage(message);

    await waitFor(() => Boolean(chatMessages.querySelector('#response-root h1')));
    assert.equal(chatMessages.querySelector('#response-root h1')?.textContent, 'Plain HTML');
    assert.equal(chatMessages.querySelector('#response-root button')?.textContent, 'Start');
    assert.equal(chatMessages.querySelector('.unistudy-html-preview-container'), null);
});

test('messageRenderer scopes assistant style tags to the message bubble', async (t) => {
    const { chatMessages, history, messageRenderer } = await createHarness(t);
    const globalButton = chatMessages.ownerDocument.createElement('button');
    globalButton.id = 'global-toolbar-button';
    globalButton.textContent = 'Global';
    chatMessages.ownerDocument.body.appendChild(globalButton);

    const message = {
        id: 'assistant-html-style-scope',
        role: 'assistant',
        name: 'Tutor',
        content: [
            '<style>',
            'button { background: #38bdf8; }',
            'button:hover { transform: translateY(-2px); }',
            'pre, code { color: #a5b4fc; }',
            '</style>',
            '<div id="response-root"><button>Inside</button><pre><code>x</code></pre></div>',
        ].join(''),
        timestamp: Date.UTC(2026, 3, 26, 8, 1),
    };
    history.push(message);

    await messageRenderer.renderMessage(message);

    await waitFor(() => Boolean(chatMessages.querySelector('#response-root button')));
    const messageItem = chatMessages.querySelector('.message-item[data-message-id="assistant-html-style-scope"]');
    const scopedStyle = chatMessages.ownerDocument.head.querySelector(`style[data-unistudy-scope-id="${messageItem.id}"]`);

    assert.ok(scopedStyle);
    assert.match(scopedStyle.textContent, new RegExp(`#${messageItem.id} button\\s*\\{`));
    assert.match(scopedStyle.textContent, new RegExp(`#${messageItem.id} button:hover\\s*\\{`));
    assert.equal(scopedStyle.textContent.trim().startsWith('button {'), false);
    assert.equal(messageItem.querySelector('style'), null);
    assert.equal(chatMessages.ownerDocument.getElementById('global-toolbar-button')?.textContent, 'Global');
});

test('messageRenderer keeps raw HTML preview after streamed message finalization', async (t) => {
    const { chatMessages, history, messageRenderer } = await createHarness(t);
    const html = '<!DOCTYPE html>\n<html><body><button>Play</button></body></html>';

    history.push({
        id: 'user-html-stream',
        role: 'user',
        content: '生成一个按钮网页',
        timestamp: Date.UTC(2026, 3, 26, 8, 2),
    });

    await messageRenderer.startStreamingMessage({
        id: 'assistant-html-stream',
        role: 'assistant',
        name: 'Tutor',
        agentId: 'agent-1',
        topicId: 'topic-1',
        content: 'Thinking',
        isThinking: true,
        timestamp: Date.UTC(2026, 3, 26, 8, 3),
    });

    await messageRenderer.finalizeStreamedMessage('assistant-html-stream', 'completed', {
        agentId: 'agent-1',
        topicId: 'topic-1',
    }, {
        fullResponse: html,
    });

    await waitFor(() => chatMessages.querySelector('.unistudy-html-preview-container.preview-mode'));
    const messageItem = chatMessages.querySelector('.message-item[data-message-id="assistant-html-stream"]');
    const previewContainer = messageItem.querySelector('.unistudy-html-preview-container');

    assert.ok(previewContainer);
    assert.equal(messageItem.classList.contains('streaming'), false);
    assert.equal(messageItem.classList.contains('thinking'), false);
    assert.ok(previewContainer.querySelector('.unistudy-html-preview-toggle'));
    assert.ok(previewContainer.querySelector('.unistudy-html-preview-frame'));
    assert.equal(previewContainer.querySelector('pre')?.dataset.richHtmlPreview, 'true');
});

test('messageRenderer scopes style tags after streamed finalization', async (t) => {
    const { chatMessages, history, messageRenderer } = await createHarness(t);
    const html = '<style>button { background: #38bdf8; }</style><div id="streamed-response-root"><button>Inside</button></div>';

    history.push({
        id: 'user-html-style-stream',
        role: 'user',
        content: '生成一个带按钮的 HTML 片段',
        timestamp: Date.UTC(2026, 3, 26, 8, 4),
    });

    await messageRenderer.startStreamingMessage({
        id: 'assistant-html-style-stream',
        role: 'assistant',
        name: 'Tutor',
        agentId: 'agent-1',
        topicId: 'topic-1',
        content: 'Thinking',
        isThinking: true,
        timestamp: Date.UTC(2026, 3, 26, 8, 5),
    });

    await messageRenderer.finalizeStreamedMessage('assistant-html-style-stream', 'completed', {
        agentId: 'agent-1',
        topicId: 'topic-1',
    }, {
        fullResponse: html,
    });

    await waitFor(() => Boolean(chatMessages.querySelector('#streamed-response-root button')));
    const messageItem = chatMessages.querySelector('.message-item[data-message-id="assistant-html-style-stream"]');
    const scopedStyle = chatMessages.ownerDocument.head.querySelector(`style[data-unistudy-scope-id="${messageItem.id}"]`);

    assert.ok(scopedStyle);
    assert.match(scopedStyle.textContent, new RegExp(`#${messageItem.id} button\\s*\\{`));
    assert.equal(messageItem.querySelector('style'), null);
});
