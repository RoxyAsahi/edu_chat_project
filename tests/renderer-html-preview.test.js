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

test('messageRenderer wraps raw doctype HTML into a VCPChat-style preview toggle', async (t) => {
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

    await waitFor(() => chatMessages.querySelector('.unistudy-html-preview-container'));
    const previewContainer = chatMessages.querySelector('.unistudy-html-preview-container');
    assert.ok(previewContainer);
    const toggle = previewContainer.querySelector('.unistudy-html-preview-toggle');
    assert.ok(toggle);
    assert.equal(previewContainer.querySelector('.unistudy-html-preview-frame'), null);
    assert.equal(previewContainer.querySelector('pre')?.dataset.richHtmlPreview, 'true');

    toggle.click();
    await waitFor(() => previewContainer.classList.contains('preview-mode') && previewContainer.querySelector('.unistudy-html-preview-frame'));
    assert.match(toggle.textContent, /返回/);
    assert.ok(['loading', 'ready'].includes(previewContainer.dataset.previewStatus));

    const frame = previewContainer.querySelector('.unistudy-html-preview-frame');
    chatMessages.ownerDocument.defaultView.dispatchEvent(new chatMessages.ownerDocument.defaultView.MessageEvent('message', {
        data: {
            type: 'unistudy-preview-status',
            frameId: frame.dataset.frameId,
            status: 'ready',
            message: 'HTML ready',
        },
    }));
    await waitFor(() => previewContainer.dataset.previewStatus === 'ready');
    assert.equal(previewContainer.querySelector('.unistudy-html-preview-status').hidden, true);

    chatMessages.ownerDocument.defaultView.dispatchEvent(new chatMessages.ownerDocument.defaultView.MessageEvent('message', {
        data: {
            type: 'unistudy-preview-status',
            frameId: frame.dataset.frameId,
            status: 'error',
            message: 'HTML boom',
        },
    }));
    await waitFor(() => previewContainer.dataset.previewStatus === 'error');
    assert.match(previewContainer.querySelector('.unistudy-html-preview-status').textContent, /HTML boom/);

    toggle.click();
    await waitFor(() => !previewContainer.classList.contains('preview-mode') && !previewContainer.querySelector('.unistudy-html-preview-frame'));
    assert.match(toggle.textContent, /播放/);
    assert.equal(previewContainer.dataset.previewStatus, 'idle');
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

test('messageRenderer adds a Three.js preview toggle with the local vendor runner', async (t) => {
    const { chatMessages, history, messageRenderer } = await createHarness(t);
    const message = {
        id: 'assistant-three-preview',
        role: 'assistant',
        name: 'Tutor',
        content: [
            '```javascript',
            'const scene = new THREE.Scene();',
            'const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);',
            'const renderer = new THREE.WebGLRenderer({ antialias: true });',
            'renderer.setSize(320, 240);',
            'document.body.appendChild(renderer.domElement);',
            '```',
        ].join('\n'),
        timestamp: Date.UTC(2026, 3, 26, 8, 1),
    };
    history.push(message);

    await messageRenderer.renderMessage(message);

    await waitFor(() => chatMessages.querySelector('.unistudy-three-preview-container'));
    const previewContainer = chatMessages.querySelector('.unistudy-three-preview-container');
    const toggle = previewContainer.querySelector('.unistudy-html-preview-toggle');

    assert.ok(toggle);
    assert.equal(previewContainer.querySelector('.unistudy-three-preview-frame'), null);

    toggle.click();
    await waitFor(() => previewContainer.querySelector('.unistudy-three-preview-frame'));
    const frame = previewContainer.querySelector('.unistudy-three-preview-frame');
    assert.match(frame.srcdoc, /vendor\/three\.min\.js/);
    assert.match(frame.srcdoc, /unistudy-three-mount/);
    assert.match(frame.srcdoc, /THREE\.WebGLRenderer/);
    assert.match(frame.srcdoc, /document\.body\.appendChild/);
    assert.match(frame.srcdoc, /Three\.js preview failed/);
    assert.match(frame.srcdoc, /unistudy-preview-status/);
    assert.match(frame.srcdoc, /WebGL is not available/);
    assert.match(frame.srcdoc, /canvas 已创建，但首帧看起来仍是空白/);

    chatMessages.ownerDocument.defaultView.dispatchEvent(new chatMessages.ownerDocument.defaultView.MessageEvent('message', {
        data: {
            type: 'unistudy-preview-status',
            frameId: frame.dataset.frameId,
            status: 'blank',
            message: 'canvas blank',
        },
    }));
    await waitFor(() => previewContainer.dataset.previewStatus === 'blank');
    assert.match(previewContainer.querySelector('.unistudy-html-preview-status').textContent, /canvas blank/);

    toggle.click();
    await waitFor(() => !previewContainer.querySelector('.unistudy-three-preview-frame'));
    assert.match(toggle.textContent, /预览/);
    assert.equal(previewContainer.dataset.previewStatus, 'idle');
});

test('messageRenderer does not attach HTML preview to tool or DailyNote blocks', async (t) => {
    const { chatMessages, history, messageRenderer } = await createHarness(t);
    const message = {
        id: 'assistant-tool-diary-preview-block',
        role: 'assistant',
        name: 'Tutor',
        content: [
            '```text',
            '<<<[TOOL_REQUEST]>>>',
            'tool_name:「始」DailyNote「末」',
            'content:「始」<html><body>not a preview</body></html>「末」',
            '<<<[END_TOOL_REQUEST]>>>',
            '```',
            '',
            '```text',
            '<<<DailyNoteStart>>>',
            '<html><body>also not a preview</body></html>',
            '<<<DailyNoteEnd>>>',
            '```',
        ].join('\n'),
        timestamp: Date.UTC(2026, 3, 26, 8, 1),
    };
    history.push(message);

    await messageRenderer.renderMessage(message);

    await waitFor(() => Boolean(chatMessages.querySelector('.tool-request-bubble')));
    assert.ok(chatMessages.querySelector('.learning-diary-bubble'));
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

test('messageRenderer does not extract style tags from protected code and tool blocks', async (t) => {
    const { chatMessages, history, messageRenderer } = await createHarness(t);
    const message = {
        id: 'assistant-style-protected-blocks',
        role: 'assistant',
        name: 'Tutor',
        content: [
            '<style>.outer { color: red; }</style>',
            '<div id="protected-style-root">Visible</div>',
            '',
            '```html',
            '<style>.inside-code { color: blue; }</style>',
            '<div>code only</div>',
            '```',
            '',
            '<<<[TOOL_REQUEST]>>>',
            'tool_name:「始」DailyNote「末」',
            'content:「始ESCAPE」<style>.inside-tool { color: green; }</style>「末ESCAPE」',
            '<<<[END_TOOL_REQUEST]>>>',
        ].join('\n'),
        timestamp: Date.UTC(2026, 3, 26, 8, 2),
    };
    history.push(message);

    await messageRenderer.renderMessage(message);

    await waitFor(() => Boolean(chatMessages.querySelector('#protected-style-root')));
    const messageItem = chatMessages.querySelector('.message-item[data-message-id="assistant-style-protected-blocks"]');
    const scopedStyle = chatMessages.ownerDocument.head.querySelector(`style[data-unistudy-scope-id="${messageItem.id}"]`);

    assert.ok(scopedStyle);
    assert.match(scopedStyle.textContent, /\.outer/);
    assert.doesNotMatch(scopedStyle.textContent, /\.inside-code/);
    assert.doesNotMatch(scopedStyle.textContent, /\.inside-tool/);
});

test('messageRenderer keeps raw HTML preview toggle after streamed message finalization', async (t) => {
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

    await waitFor(() => chatMessages.querySelector('.unistudy-html-preview-container'));
    const messageItem = chatMessages.querySelector('.message-item[data-message-id="assistant-html-stream"]');
    const previewContainer = messageItem.querySelector('.unistudy-html-preview-container');

    assert.ok(previewContainer);
    assert.equal(messageItem.classList.contains('streaming'), false);
    assert.equal(messageItem.classList.contains('thinking'), false);
    const toggle = previewContainer.querySelector('.unistudy-html-preview-toggle');
    assert.ok(toggle);
    assert.equal(previewContainer.querySelector('.unistudy-html-preview-frame'), null);
    assert.equal(previewContainer.querySelector('pre')?.dataset.richHtmlPreview, 'true');

    toggle.click();
    await waitFor(() => previewContainer.querySelector('.unistudy-html-preview-frame'));
    assert.match(previewContainer.querySelector('.unistudy-html-preview-frame')?.srcdoc, /vcp-wrapper/);
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

test('messageRenderer cleans live preview resources before updateMessageContent replaces DOM', async (t) => {
    const { chatMessages, history, messageRenderer } = await createHarness(t);
    const message = {
        id: 'assistant-preview-cleanup-update',
        role: 'assistant',
        name: 'Tutor',
        content: '<!DOCTYPE html>\n<html><body><button>Old</button></body></html>',
        timestamp: Date.UTC(2026, 3, 26, 8, 6),
    };
    history.push(message);

    await messageRenderer.renderMessage(message);

    await waitFor(() => chatMessages.querySelector('.unistudy-html-preview-container'));
    const previewContainer = chatMessages.querySelector('.unistudy-html-preview-container');
    const toggle = previewContainer.querySelector('.unistudy-html-preview-toggle');

    toggle.click();
    await waitFor(() => previewContainer.querySelector('.unistudy-html-preview-frame'));

    let cleanupCalled = false;
    previewContainer._previewCleanup = () => {
        cleanupCalled = true;
    };

    message.content = '<div id="updated-inline-html">Updated</div>';
    messageRenderer.updateMessageContent(message.id, message.content);

    await waitFor(() => Boolean(chatMessages.querySelector('#updated-inline-html')));
    assert.equal(cleanupCalled, true);
    assert.equal(chatMessages.querySelector('.unistudy-html-preview-frame'), null);
    assert.equal(chatMessages.querySelector('#updated-inline-html')?.textContent, 'Updated');
});
