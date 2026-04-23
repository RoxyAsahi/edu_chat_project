const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');
const { JSDOM } = require('jsdom');

async function loadMessageCitationsModule() {
    const modulePath = path.resolve(__dirname, '../src/modules/renderer/messageCitations.js');
    const source = await fs.readFile(modulePath, 'utf8');
    return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
}

function createDom(markup = '') {
    return new JSDOM(`<!doctype html><html><body>${markup}</body></html>`, {
        pretendToBeVisual: true,
        url: 'http://localhost',
    });
}

test('assignCitationRefsToBlocks matches a single citation to the most relevant paragraph', async () => {
    const { assignCitationRefsToBlocks } = await loadMessageCitationsModule();
    const dom = createDom(`
        <div id="content">
            <p>欧姆定律说明电流和电压成正比，电阻保持不变。</p>
            <p>勾股定理适用于直角三角形。</p>
        </div>
    `);

    try {
        const contentDiv = dom.window.document.getElementById('content');
        const { blockRefs } = assignCitationRefsToBlocks(contentDiv, [
            { snippet: '电流和电压成正比' },
        ]);

        assert.deepEqual(blockRefs, [[0], []]);
    } finally {
        dom.window.close();
    }
});

test('assignCitationRefsToBlocks keeps multiple Chinese citations on the same best-matching block', async () => {
    const { assignCitationRefsToBlocks } = await loadMessageCitationsModule();
    const dom = createDom(`
        <div id="content">
            <p>只要骨架判断清楚，后续的最值、交点、范围题都会更稳定，分类也会更少出错。</p>
            <p>另一个段落在讨论英语阅读定位策略。</p>
        </div>
    `);

    try {
        const contentDiv = dom.window.document.getElementById('content');
        const { blockRefs } = assignCitationRefsToBlocks(contentDiv, [
            { snippet: '骨架判断清楚以后，后续最值和范围题都会更稳定。' },
            { snippet: '分类讨论会更少出错' },
        ]);

        assert.deepEqual(blockRefs, [[0, 1], []]);
    } finally {
        dom.window.close();
    }
});

test('assignCitationRefsToBlocks falls back to the last paragraph when no strong match exists', async () => {
    const { assignCitationRefsToBlocks } = await loadMessageCitationsModule();
    const dom = createDom(`
        <div id="content">
            <p>第一段在讲数学归纳法。</p>
            <p>第二段在讲化学元素周期律。</p>
        </div>
    `);

    try {
        const contentDiv = dom.window.document.getElementById('content');
        const { blockRefs } = assignCitationRefsToBlocks(contentDiv, [
            { snippet: '莎士比亚戏剧的语言风格' },
        ]);

        assert.deepEqual(blockRefs, [[], [0]]);
    } finally {
        dom.window.close();
    }
});

test('renderInlineCitationBadges appends compact chips without duplicating them on repeated renders', async () => {
    const { renderInlineCitationBadges } = await loadMessageCitationsModule();
    const dom = createDom(`
        <article class="message-item assistant" data-message-id="assistant-1">
            <div id="content" class="md-content">
                <p>牛顿第一定律说明，不受外力时物体会保持静止或匀速直线运动。</p>
                <ul>
                    <li>这条规律也帮助我们理解惯性。</li>
                </ul>
            </div>
        </article>
    `);

    try {
        const contentDiv = dom.window.document.getElementById('content');
        const refs = [
            { snippet: '不受外力时物体会保持静止或匀速直线运动。' },
            { snippet: '帮助我们理解惯性。' },
        ];

        renderInlineCitationBadges(contentDiv, refs);
        renderInlineCitationBadges(contentDiv, refs);

        const chips = [...contentDiv.querySelectorAll('.message-citation-chip')].map((element) => element.textContent);
        assert.deepEqual(chips, ['1', '2']);
        assert.equal(contentDiv.querySelectorAll('.message-inline-citations').length, 2);
        assert.equal(contentDiv.querySelector('.message-kb-refs'), null);
    } finally {
        dom.window.close();
    }
});

test('citation popover controller toggles, opens the source, and closes on outside click, Escape, and scroll', async () => {
    const { createCitationPopoverController } = await loadMessageCitationsModule();
    const dom = createDom(`
        <div id="messageCitationPopover" class="hidden" aria-hidden="true"></div>
        <button id="chip" type="button" class="message-citation-chip">1</button>
    `);

    try {
        const documentObj = dom.window.document;
        const popoverEl = documentObj.getElementById('messageCitationPopover');
        const chip = documentObj.getElementById('chip');
        chip.getBoundingClientRect = () => ({
            left: 24,
            right: 52,
            top: 18,
            bottom: 38,
        });

        const openedRefs = [];
        const controller = createCitationPopoverController({
            popoverEl,
            documentObj,
            windowObj: dom.window,
            positionFloatingElement: (element) => {
                element.style.left = '120px';
                element.style.top = '48px';
            },
            onOpenRef: (ref) => {
                openedRefs.push(ref);
            },
        });

        const ref = {
            documentId: 'doc-1',
            documentName: 'physics.pdf',
            pageNumber: 4,
            snippet: '惯性反映了物体保持原有运动状态的趋势。',
        };

        controller.toggle({
            anchorElement: chip,
            messageId: 'assistant-1',
            refIndex: 0,
            ref,
        });

        assert.equal(popoverEl.classList.contains('hidden'), false);
        assert.equal(chip.classList.contains('message-citation-chip--active'), true);
        assert.match(popoverEl.textContent, /physics\.pdf/);
        assert.match(popoverEl.textContent, /打开原文/);

        popoverEl.querySelector('[data-citation-open-original]').dispatchEvent(new dom.window.MouseEvent('click', {
            bubbles: true,
        }));
        assert.deepEqual(openedRefs, [ref]);
        assert.equal(popoverEl.classList.contains('hidden'), true);

        controller.toggle({
            anchorElement: chip,
            messageId: 'assistant-1',
            refIndex: 0,
            ref,
        });
        controller.handleDocumentClick({ target: documentObj.body });
        assert.equal(popoverEl.classList.contains('hidden'), true);

        controller.toggle({
            anchorElement: chip,
            messageId: 'assistant-1',
            refIndex: 0,
            ref,
        });
        controller.handleKeyDown({ key: 'Escape' });
        assert.equal(popoverEl.classList.contains('hidden'), true);

        controller.toggle({
            anchorElement: chip,
            messageId: 'assistant-1',
            refIndex: 0,
            ref,
        });
        controller.handleScroll();
        assert.equal(popoverEl.classList.contains('hidden'), true);

        controller.destroy();
    } finally {
        dom.window.close();
    }
});
