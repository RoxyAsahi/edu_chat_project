const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');
const { JSDOM } = require('jsdom');

async function loadUiHelpers(dom) {
    const modulePath = path.resolve(__dirname, '../src/modules/renderer/ui-helpers.js');
    const source = await fs.readFile(modulePath, 'utf8');
    dom.window.requestAnimationFrame = (callback) => {
        callback();
        return 1;
    };
    dom.window.eval(source);
    return dom.window.uiHelperFunctions;
}

function configureScrollMetrics(parent, chatMessages, {
    scrollHeight = 1000,
    clientHeight = 300,
    scrollTop = 0,
} = {}) {
    Object.defineProperty(parent, 'scrollHeight', { value: scrollHeight, configurable: true });
    Object.defineProperty(parent, 'clientHeight', { value: clientHeight, configurable: true });
    parent.scrollTop = scrollTop;
    Object.defineProperty(chatMessages, 'scrollHeight', { value: scrollHeight, configurable: true });
    chatMessages.scrollTop = 0;
}

test('scrollToBottom keeps guarded default behavior and supports forced send-time scroll', async (t) => {
    const dom = new JSDOM(`
        <body>
          <div class="chat-messages-container">
            <div id="chatMessages"></div>
          </div>
        </body>
    `, {
        url: 'http://localhost',
        runScripts: 'outside-only',
        pretendToBeVisual: true,
    });
    t.after(() => dom.window.close());

    const ui = await loadUiHelpers(dom);
    const parent = dom.window.document.querySelector('.chat-messages-container');
    const chatMessages = dom.window.document.getElementById('chatMessages');

    configureScrollMetrics(parent, chatMessages, { scrollTop: 100 });
    ui.scrollToBottom();
    assert.equal(parent.scrollTop, 100);

    ui.scrollToBottom({ force: true });
    assert.equal(parent.scrollTop, 1000);
    assert.equal(chatMessages.scrollTop, 1000);

    configureScrollMetrics(parent, chatMessages, { scrollTop: 660 });
    ui.scrollToBottom();
    assert.equal(parent.scrollTop, 1000);
});
