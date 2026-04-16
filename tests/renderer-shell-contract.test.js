const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');
const { JSDOM } = require('jsdom');

async function loadRendererShell() {
    const htmlPath = path.resolve(__dirname, '../src/renderer/index.html');
    const html = await fs.readFile(htmlPath, 'utf8');
    const dom = new JSDOM(html);
    return {
        html,
        document: dom.window.document,
    };
}

test('renderer shell html loads the split renderer-local stylesheet stack in order', async () => {
    const { document } = await loadRendererShell();
    const hrefs = [...document.querySelectorAll('link[rel="stylesheet"]')].map((element) => element.getAttribute('href'));

    assert.deepEqual(hrefs, [
        '../../vendor/katex.min.css',
        '../../vendor/atom-one-light.min.css',
        '../styles/messageRenderer.css',
        '../styles/notifications.css',
        '../Promptmodules/prompt-modules.css',
        'styles/tokens.css',
        'styles/shell.css',
        'styles/workspace.css',
        'styles/reader.css',
        'styles/chat.css',
        'styles/sidepanel.css',
        'styles/responsive.css',
    ]);
});

test('renderer shell html no longer references legacy style.css runtime entry', async () => {
    const { html } = await loadRendererShell();
    assert.equal(html.includes('href="style.css"'), false);
});

test('renderer shell keeps the critical DOM anchors for controller wiring', async () => {
    const { document } = await loadRendererShell();

    [
        'workspaceOverviewPage',
        'workspaceSubjectPage',
        'workspaceOverviewCreateAgentBtn',
        'workspaceBackToOverviewBtn',
        'subjectOverviewGrid',
        'globalSettingsBtn',
        'themeToggleBtn',
        'topicList',
        'topicKnowledgeBaseFiles',
        'workspaceReaderPanel',
        'chatMessages',
        'messageInput',
        'settingsPanel',
        'noteDetailModal',
    ].forEach((id) => {
        assert.ok(document.getElementById(id), `expected #${id} to exist`);
    });
});

test('renderer shell tokens reference the shared font assets from the new styles directory', async () => {
    const tokensPath = path.resolve(__dirname, '../src/renderer/styles/tokens.css');
    const css = await fs.readFile(tokensPath, 'utf8');

    assert.equal(css.includes("../../assets/font/MavenPro-ExtraBold.ttf"), true);
    assert.equal(css.includes("../../assets/font/MaterialSymbolsOutlined-latin-wght-normal.woff2"), true);
});

test('renderer chat stylesheet keeps assistant hover timestamps and bubble-only user messages', async () => {
    const chatCssPath = path.resolve(__dirname, '../src/renderer/styles/chat.css');
    const css = await fs.readFile(chatCssPath, 'utf8');

    assert.equal(css.includes('.message-item .name-time-block'), true);
    assert.equal(css.includes('.message-item.user .chat-avatar'), true);
    assert.equal(css.includes('.message-item.assistant:hover .message-timestamp'), true);
    assert.equal(css.includes('background: transparent;'), true);
    assert.equal(css.includes('border-radius: 0;'), true);
    assert.equal(css.includes('padding: 0;'), true);
    assert.equal(css.includes('.context-menu__header'), false);
    assert.equal(css.includes('.context-menu__description'), false);
    assert.equal(css.includes('.context-menu__hint'), false);
    assert.equal(css.includes('.context-menu__item-main'), true);
    assert.equal(css.includes('.context-menu__item--danger'), true);
});
