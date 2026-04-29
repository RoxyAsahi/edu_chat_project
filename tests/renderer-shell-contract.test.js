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

test('renderer shell leaves Mermaid on the lazy-load path', async () => {
    const { document } = await loadRendererShell();
    const srcs = [...document.querySelectorAll('script[src]')].map((element) => element.getAttribute('src'));

    assert.equal(srcs.includes('../../vendor/mermaid.min.js'), false);
});

test('renderer shell allows bundled emoji data sources through connect-src', async () => {
    const { document } = await loadRendererShell();
    const policy = document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') || '';

    assert.match(policy, /connect-src[^;]*\bdata:/);
    assert.match(policy, /connect-src[^;]*\bblob:/);
});

test('renderer shell uses the app logo as the subject avatar fallback', async () => {
    const { document } = await loadRendererShell();
    const preview = document.getElementById('agentAvatarPreview');

    assert.equal(preview?.getAttribute('src'), '../assets/brand-logo.png');
});

test('renderer shell keeps the subject settings modal close action and soft backdrop contract', async () => {
    const { html, document } = await loadRendererShell();
    const sidepanelCssPath = path.resolve(__dirname, '../src/renderer/styles/sidepanel.css');
    const css = await fs.readFile(sidepanelCssPath, 'utf8');

    assert.equal(document.getElementById('subjectSettingsPanelCloseBtn')?.hasAttribute('data-subject-settings-close'), true);
    assert.equal(document.getElementById('subjectSettingsPanelCloseBtn')?.getAttribute('onpointerdown'), 'window.__unistudyCloseSubjectSettingsPanel?.(event)');
    assert.equal(document.getElementById('subjectSettingsPanelCloseBtn')?.getAttribute('onclick'), 'window.__unistudyCloseSubjectSettingsPanel?.(event)');
    assert.equal(html.includes('window.__unistudyCloseSubjectSettingsPanel'), true);
    assert.match(css, /\.subject-settings-panel__backdrop\s*\{[\s\S]*background:\s*rgba\(248,\s*250,\s*252,\s*0\.42\);/);
    assert.match(css, /\.subject-settings-panel__backdrop\s*\{[\s\S]*backdrop-filter:\s*blur\(6px\)\s*saturate\(106%\);/);
    assert.match(css, /\.subject-settings-panel__dialog\s*\{[\s\S]*z-index:\s*1;/);
    assert.match(css, /\.subject-settings-panel\s*\{[\s\S]*-webkit-app-region:\s*no-drag;/);
    assert.match(css, /\.subject-settings-panel,\s*\.subject-settings-panel \*\s*\{[\s\S]*-webkit-app-region:\s*no-drag !important;/);
    assert.match(css, /\.subject-settings-panel__close\s*\{[\s\S]*position:\s*absolute;[\s\S]*width:\s*40px;[\s\S]*height:\s*40px;/);
    assert.match(css, /\.subject-settings-panel__close \.material-symbols-outlined\s*\{[\s\S]*pointer-events:\s*none;/);
    assert.match(css, /body\.dark-theme \.subject-settings-panel__backdrop\s*\{[\s\S]*background:\s*rgba\(15,\s*23,\s*42,\s*0\.42\);/);
});

test('renderer shell keeps the critical DOM anchors for controller wiring', async () => {
    const { document } = await loadRendererShell();

    [
        'workspaceOverviewPage',
        'workspaceSubjectPage',
        'workspaceBackToOverviewBtn',
        'workspaceOpenSubjectBtn',
        'manualNotesLibraryBtn',
        'openDiaryWallBtn',
        'subjectOverviewGrid',
        'globalSettingsBtn',
        'themeToggleBtn',
        'topicList',
        'topicKnowledgeBaseFiles',
        'workspaceReaderPanel',
        'chatMessages',
        'messageCitationPopover',
        'messageInput',
        'settingsPanel',
        'noteDetailModal',
        'diaryWallModal',
        'diaryWallEditBtn',
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

test('manual notes page controls stay compact and left aligned', async () => {
    const workspaceCssPath = path.resolve(__dirname, '../src/renderer/styles/workspace.css');
    const sidepanelCssPath = path.resolve(__dirname, '../src/renderer/styles/sidepanel.css');
    const workspaceCss = await fs.readFile(workspaceCssPath, 'utf8');
    const sidepanelCss = await fs.readFile(sidepanelCssPath, 'utf8');

    assert.match(workspaceCss, /\.manual-notes-library-page__header\s*\{[\s\S]*justify-content:\s*flex-start;/);
    assert.match(workspaceCss, /\.manual-notes-library-page__filters\s*\{[\s\S]*order:\s*2;/);
    assert.match(workspaceCss, /\.manual-notes-library-page__subject-tabs\s*\{[\s\S]*display:\s*inline-flex;/);
    assert.match(workspaceCss, /\.manual-notes-library-page__new-note\s*\{[\s\S]*min-height:\s*32px;/);
    assert.match(sidepanelCss, /\.notes-studio-panel-switch\s*\{[\s\S]*justify-self:\s*flex-start;/);
    assert.match(sidepanelCss, /\.notes-studio-panel-switch__btn\s*\{[\s\S]*min-height:\s*32px;/);
});

test('renderer chat header keeps the subject settings action from increasing titlebar height', async () => {
    const chatCssPath = path.resolve(__dirname, '../src/renderer/styles/chat.css');
    const responsiveCssPath = path.resolve(__dirname, '../src/renderer/styles/responsive.css');
    const chatCss = await fs.readFile(chatCssPath, 'utf8');
    const responsiveCss = await fs.readFile(responsiveCssPath, 'utf8');

    assert.match(chatCss, /\.chat-stage__header\s*\{[\s\S]*min-height:\s*34px;[\s\S]*position:\s*relative;/);
    assert.match(chatCss, /\.chat-stage__header \.chat-stage__header-actions\s*\{[\s\S]*position:\s*absolute;[\s\S]*transform:\s*translateY\(-50%\);/);
    assert.match(chatCss, /\.chat-stage__header-actions \.icon-text-btn\s*\{[\s\S]*min-height:\s*0;[\s\S]*height:\s*24px;/);
    assert.match(responsiveCss, /\.chat-stage__header > div:first-child\s*\{[\s\S]*padding-right:\s*50px;/);
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
    assert.equal(css.includes('.message-citation-chip'), true);
    assert.equal(css.includes('.message-citation-popover'), true);
    assert.equal(css.includes('.message-kb-refs'), false);
    assert.equal(css.includes('.context-menu__header'), false);
    assert.equal(css.includes('.context-menu__description'), false);
    assert.equal(css.includes('.context-menu__hint'), false);
    assert.equal(css.includes('.context-menu__item-main'), true);
    assert.equal(css.includes('.context-menu__item--danger'), true);
});
