const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');
const { JSDOM } = require('jsdom');

async function loadDomBuilderModule() {
    const modulePath = path.resolve(__dirname, '../src/modules/renderer/domBuilder.js');
    const source = await fs.readFile(modulePath, 'utf8');
    return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
}

test('createMessageSkeleton renders assistant meta with name and timestamp', async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const previousWindow = global.window;
    const previousDocument = global.document;

    global.window = dom.window;
    global.document = dom.window.document;

    try {
        const { createMessageSkeleton } = await loadDomBuilderModule();
        const { messageItem, avatarImg, senderNameDiv, nameTimeDiv } = createMessageSkeleton(
            {
                id: 'assistant-1',
                role: 'assistant',
                name: '数学老师',
                timestamp: Date.UTC(2026, 3, 16, 8, 30),
            },
            {},
            {
                name: '默认助手',
                avatarUrl: '../assets/default_avatar.png',
            },
        );

        assert.equal(messageItem.classList.contains('assistant'), true);
        assert.equal(Boolean(avatarImg), true);
        assert.equal(senderNameDiv?.textContent, '数学老师');
        assert.equal(nameTimeDiv?.querySelector('.message-timestamp')?.textContent, '2026-04-16 16:30');
    } finally {
        global.window = previousWindow;
        global.document = previousDocument;
        dom.window.close();
    }
});

test('createMessageSkeleton keeps user messages as bubble-only layout', async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const previousWindow = global.window;
    const previousDocument = global.document;

    global.window = dom.window;
    global.document = dom.window.document;

    try {
        const { createMessageSkeleton } = await loadDomBuilderModule();
        const { messageItem, contentDiv, avatarImg, senderNameDiv, nameTimeDiv, detailsAndBubbleWrapper } = createMessageSkeleton(
            {
                id: 'user-1',
                role: 'user',
                name: '我',
                timestamp: Date.UTC(2026, 3, 16, 8, 30),
            },
            {},
            null,
        );

        assert.equal(messageItem.classList.contains('user'), true);
        assert.equal(avatarImg, null);
        assert.equal(senderNameDiv, null);
        assert.equal(nameTimeDiv, null);
        assert.equal(detailsAndBubbleWrapper?.contains(contentDiv), true);
        assert.equal(messageItem.querySelector('.chat-avatar'), null);
        assert.equal(messageItem.querySelector('.name-time-block'), null);
    } finally {
        global.window = previousWindow;
        global.document = previousDocument;
        dom.window.close();
    }
});
