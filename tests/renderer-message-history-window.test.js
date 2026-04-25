const test = require('node:test');
const assert = require('assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const { JSDOM } = require('jsdom');

function makeHistory(count) {
    return Array.from({ length: count }, (_value, index) => ({
        id: `message-${index}`,
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${index}`,
        timestamp: Date.UTC(2026, 0, 1, 8, 0, index),
    }));
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
    const scrollContainer = dom.window.document.querySelector('.chat-messages-container');
    Object.defineProperty(scrollContainer, 'scrollHeight', {
        configurable: true,
        get() {
            return chatMessages.querySelectorAll('.message-item').length * 20;
        },
    });

    const modulePath = path.resolve(__dirname, '../src/modules/renderer/messageRenderer.js');
    const messageRenderer = await import(`${pathToFileURL(modulePath).href}?historyWindowTest=${Date.now()}${Math.random()}`);
    const history = makeHistory(120);

    messageRenderer.initializeMessageRenderer({
        chatMessagesDiv: chatMessages,
        currentChatHistoryRef: {
            get: () => history,
            set: () => {},
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
            openImageViewer() {},
            saveAvatarColor: async () => ({ success: true }),
            showImageContextMenu() {},
        },
        markedInstance: {
            parse(markdown) {
                return `<p>${String(markdown || '')}</p>`;
            },
        },
        messageCitationPopover: dom.window.document.getElementById('messageCitationPopover'),
        uiHelper: {
            scrollToBottom() {
                scrollContainer.scrollTop = scrollContainer.scrollHeight;
            },
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

    return {
        chatMessages,
        history,
        messageRenderer,
        scrollContainer,
    };
}

test('renderHistory mounts only the latest window for long histories', async (t) => {
    const {
        chatMessages,
        history,
        messageRenderer,
    } = await createHarness(t);

    await messageRenderer.renderHistory(history, {
        autoLoadOnScroll: false,
        prependBatchSize: 40,
        windowSize: 50,
    });

    const renderedMessages = [...chatMessages.querySelectorAll('.message-item')];
    assert.equal(renderedMessages.length, 50);
    assert.equal(renderedMessages[0].dataset.messageId, 'message-70');
    assert.equal(renderedMessages.at(-1).dataset.messageId, 'message-119');
    assert.match(chatMessages.querySelector('[data-history-window-loader]')?.textContent || '', /加载更早消息（70）/);
    assert.equal(history.length, 120, 'full currentChatHistory should stay intact');

    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(chatMessages.querySelectorAll('.message-item').length, 50, 'older messages should not render in the background');
});

test('history loader prepends older windows in order and preserves scroll offset', async (t) => {
    const {
        chatMessages,
        history,
        messageRenderer,
        scrollContainer,
    } = await createHarness(t);

    await messageRenderer.renderHistory(history, {
        autoLoadOnScroll: false,
        prependBatchSize: 40,
        windowSize: 50,
    });

    scrollContainer.scrollTop = 120;
    chatMessages.querySelector('.history-window-loader__button').click();
    await waitFor(() => chatMessages.querySelectorAll('.message-item').length === 90);

    let renderedMessages = [...chatMessages.querySelectorAll('.message-item')];
    assert.equal(renderedMessages[0].dataset.messageId, 'message-30');
    assert.equal(renderedMessages.at(-1).dataset.messageId, 'message-119');
    assert.match(chatMessages.querySelector('[data-history-window-loader]')?.textContent || '', /加载更早消息（30）/);
    assert.equal(scrollContainer.scrollTop, 920);

    chatMessages.querySelector('.history-window-loader__button').click();
    await waitFor(() => chatMessages.querySelectorAll('.message-item').length === 120);

    renderedMessages = [...chatMessages.querySelectorAll('.message-item')];
    assert.equal(renderedMessages[0].dataset.messageId, 'message-0');
    assert.equal(renderedMessages.at(-1).dataset.messageId, 'message-119');
    assert.equal(chatMessages.querySelector('[data-history-window-loader]'), null);
    assert.equal(scrollContainer.scrollTop, 1520);
});
