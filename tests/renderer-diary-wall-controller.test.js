const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');
const { JSDOM } = require('jsdom');

async function loadDiaryWallControllerModule() {
    const modulePath = path.resolve(__dirname, '../src/modules/renderer/app/diaryWall/diaryWallController.js');
    const source = await fs.readFile(modulePath, 'utf8');
    return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
}

function createDom() {
    return new JSDOM(`
        <body>
          <button id="openDiaryWallBtn" type="button">open</button>
          <div id="diaryWallModal" class="diary-wall-modal hidden" aria-hidden="true">
            <div id="diaryWallModalBackdrop"></div>
            <button id="diaryWallCloseBtn" type="button">close</button>
            <select id="diaryWallScopeSelect">
              <option value="global">global</option>
              <option value="agent">agent</option>
              <option value="topic">topic</option>
              <option value="public">public</option>
            </select>
            <input id="diaryWallSearchInput" />
            <input id="diaryWallNotebookInput" />
            <input id="diaryWallTagInput" />
            <input id="diaryWallDateInput" />
            <button id="diaryWallRefreshBtn" type="button">refresh</button>
            <div id="diaryWallAgentNav"></div>
            <div id="diaryWallSummary"></div>
            <div id="diaryWallCards"></div>
            <div id="diaryWallDetail"></div>
          </div>
          <div class="message-item" data-message-id="msg-1"></div>
        </body>
    `, { url: 'http://localhost' });
}

function createElementMap(documentObj) {
    return {
        openDiaryWallBtn: documentObj.getElementById('openDiaryWallBtn'),
        diaryWallModal: documentObj.getElementById('diaryWallModal'),
        diaryWallModalBackdrop: documentObj.getElementById('diaryWallModalBackdrop'),
        diaryWallCloseBtn: documentObj.getElementById('diaryWallCloseBtn'),
        diaryWallScopeSelect: documentObj.getElementById('diaryWallScopeSelect'),
        diaryWallSearchInput: documentObj.getElementById('diaryWallSearchInput'),
        diaryWallNotebookInput: documentObj.getElementById('diaryWallNotebookInput'),
        diaryWallTagInput: documentObj.getElementById('diaryWallTagInput'),
        diaryWallDateInput: documentObj.getElementById('diaryWallDateInput'),
        diaryWallRefreshBtn: documentObj.getElementById('diaryWallRefreshBtn'),
        diaryWallOpenLogsBtn: documentObj.getElementById('diaryWallOpenLogsBtn'),
        diaryWallAgentNav: documentObj.getElementById('diaryWallAgentNav'),
        diaryWallSummary: documentObj.getElementById('diaryWallSummary'),
        diaryWallCards: documentObj.getElementById('diaryWallCards'),
        diaryWallDetail: documentObj.getElementById('diaryWallDetail'),
    };
}

test('diaryWallController opens a dedicated wall, renders cards/details, and filters by tag', async (t) => {
    const { createDiaryWallController } = await loadDiaryWallControllerModule();
    const dom = createDom();
    const previousWindow = global.window;
    const previousDocument = global.document;
    const previousElement = global.Element;
    global.window = dom.window;
    global.document = dom.window.document;
    global.Element = dom.window.Element;

    const originalScrollIntoView = dom.window.HTMLElement.prototype.scrollIntoView;
    dom.window.HTMLElement.prototype.scrollIntoView = function scrollIntoViewStub() {};

    t.after(() => {
        dom.window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
        global.window = previousWindow;
        global.document = previousDocument;
        global.Element = previousElement;
        dom.window.close();
    });

    const listPayloads = [];
    const detailPayloads = [];
    const documentObj = dom.window.document;
    const cardItems = [
        {
            id: 'study_diary_nova_2026-04-14',
            diaryId: 'study_diary_nova_2026-04-14',
            notebookId: 'nova',
            notebookName: 'Nova',
            dateKey: '2026-04-14',
            updatedAt: Date.UTC(2026, 3, 14, 12, 0, 0),
            entryCount: 2,
            recallCount: 3,
            tags: ['二次函数', '错因复盘'],
            maidSignatures: ['Nova'],
            agentNames: ['Nova'],
            topics: {
                junior_math_quadratic: {
                    topicId: 'junior_math_quadratic',
                    topicName: '初中数学_二次函数',
                },
            },
            previewMarkdown: '# DailyNote\n复盘了顶点式与对称轴。',
        },
        {
            id: 'study_diary_public_2026-04-13',
            diaryId: 'study_diary_public_2026-04-13',
            notebookId: '公共',
            notebookName: '公共',
            dateKey: '2026-04-13',
            updatedAt: Date.UTC(2026, 3, 13, 9, 0, 0),
            entryCount: 1,
            recallCount: 1,
            tags: ['共享记忆'],
            maidSignatures: ['Nova'],
            agentNames: ['Nova'],
            topics: {},
            previewMarkdown: '# DailyNote\n公共日记本。',
            isPublicNotebook: true,
        },
        {
            id: 'study_diary_hornet_2026-04-12',
            diaryId: 'study_diary_hornet_2026-04-12',
            notebookId: 'hornet',
            notebookName: 'Hornet',
            dateKey: '2026-04-12',
            updatedAt: Date.UTC(2026, 3, 12, 8, 0, 0),
            entryCount: 1,
            recallCount: 2,
            tags: ['英语语法'],
            maidSignatures: ['Hornet'],
            agentNames: ['Hornet'],
            topics: {
                senior_english_clause: {
                    topicId: 'senior_english_clause',
                    topicName: '高中英语_定语从句',
                },
            },
            previewMarkdown: '# DailyNote\n复盘了定语从句里的先行词判断。',
        },
    ];
    const detailItem = {
        diaryId: 'study_diary_nova_2026-04-14',
        notebookId: 'nova',
        notebookName: 'Nova',
        dateKey: '2026-04-14',
        entryCount: 2,
        recallCount: 3,
        contentMarkdown: '# DailyNote 2026-04-14\n复盘了顶点式与对称轴。',
        maidSignatures: ['Nova'],
        entries: [
            {
                id: 'entry-1',
                createdAt: Date.UTC(2026, 3, 14, 11, 30, 0),
                notebookName: 'Nova',
                maidSignature: 'Nova',
                topicId: 'junior_math_quadratic',
                topicNameSnapshot: '初中数学_二次函数',
                contentMarkdown: '[19:30] 复盘了顶点式与对称轴。\nTag: 二次函数, 错因复盘',
                tags: ['二次函数', '错因复盘'],
                sourceMessageIds: ['msg-1'],
                toolRequest: {
                    toolName: 'DailyNote',
                    command: 'create',
                    args: {
                        maid: '[Nova]Nova',
                    },
                },
                requestedToolName: 'DailyNote',
                requestedCommand: 'create',
            },
        ],
    };
    const hornetDetailItem = {
        diaryId: 'study_diary_hornet_2026-04-12',
        notebookId: 'hornet',
        notebookName: 'Hornet',
        dateKey: '2026-04-12',
        entryCount: 1,
        recallCount: 2,
        contentMarkdown: '# DailyNote 2026-04-12\n复盘了定语从句里的先行词判断。',
        maidSignatures: ['Hornet'],
        entries: [
            {
                id: 'entry-2',
                createdAt: Date.UTC(2026, 3, 12, 8, 0, 0),
                notebookName: 'Hornet',
                maidSignature: 'Hornet',
                topicId: 'senior_english_clause',
                topicNameSnapshot: '高中英语_定语从句',
                contentMarkdown: '[18:40] 复盘了定语从句里的先行词判断。\nTag: 英语语法',
                tags: ['英语语法'],
                sourceMessageIds: ['msg-1'],
                toolRequest: {
                    toolName: 'DailyNote',
                    command: 'create',
                    args: {
                        maid: '[Hornet]Hornet',
                    },
                },
                requestedToolName: 'DailyNote',
                requestedCommand: 'create',
            },
        ],
    };

    const controller = createDiaryWallController({
        el: createElementMap(documentObj),
        chatAPI: {
            async listStudyDiaryWallCards(payload) {
                listPayloads.push({ ...payload });
                return {
                    success: true,
                    items: payload.tag === '二次函数' ? [cardItems[0]] : cardItems,
                };
            },
            async getStudyDiaryWallDetail(payload) {
                detailPayloads.push({ ...payload });
                return {
                    success: true,
                    item: payload.diaryId === 'study_diary_hornet_2026-04-12'
                        ? hornetDetailItem
                        : detailItem,
                };
            },
        },
        ui: {
            showToastNotification() {},
        },
        documentObj,
        renderMarkdownFragment: (value) => `<article class="markdown">${String(value)}</article>`,
        getCurrentSelectedItem: () => ({ id: 'nova_acceptance', name: 'Nova_验收' }),
        getCurrentTopicId: () => 'junior_math_quadratic',
        getCurrentTopicName: () => '初中数学_二次函数',
        openLogsPanel: async () => {},
        selectTopic: async () => {},
    });

    controller.bindEvents();
    documentObj.getElementById('openDiaryWallBtn').click();
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.equal(documentObj.getElementById('diaryWallModal').classList.contains('hidden'), false);
    assert.match(documentObj.getElementById('diaryWallSummary').textContent, /全局所有日记/);
    assert.match(documentObj.getElementById('diaryWallSummary').textContent, /Agent 分组/);
    assert.match(documentObj.getElementById('diaryWallAgentNav').textContent, /全部/);
    assert.match(documentObj.getElementById('diaryWallAgentNav').textContent, /Nova/);
    assert.match(documentObj.getElementById('diaryWallAgentNav').textContent, /Hornet/);
    assert.match(documentObj.getElementById('diaryWallCards').textContent, /Nova\s*2 张日记卡/);
    assert.match(documentObj.getElementById('diaryWallCards').textContent, /Hornet\s*1 张日记卡/);
    assert.match(documentObj.getElementById('diaryWallCards').textContent, /\[Nova\]/);
    assert.match(documentObj.getElementById('diaryWallDetail').textContent, /原始 DailyNote 请求/);
    assert.equal(listPayloads[0].scope, 'global');
    assert.equal(detailPayloads[0].diaryId, 'study_diary_nova_2026-04-14');
    assert.equal(detailPayloads[0].agentId, '');
    assert.equal(detailPayloads[0].topicId, '');

    const hornetTab = documentObj.querySelector('[data-diary-wall-agent-filter="Hornet"]');
    assert.ok(hornetTab);
    hornetTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.doesNotMatch(documentObj.getElementById('diaryWallCards').textContent, /Nova\s*2 张日记卡/);
    assert.match(documentObj.getElementById('diaryWallCards').textContent, /Hornet\s*1 张日记卡/);
    assert.match(documentObj.getElementById('diaryWallSummary').textContent, /当前 Agent：Hornet/);
    assert.match(documentObj.getElementById('diaryWallDetail').textContent, /Hornet/);

    const novaTab = documentObj.querySelector('[data-diary-wall-agent-filter="Nova"]');
    assert.ok(novaTab);
    novaTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 30));

    const tagButton = documentObj.querySelector('[data-diary-wall-tag="二次函数"]');
    assert.ok(tagButton);
    tagButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.equal(documentObj.getElementById('diaryWallTagInput').value, '二次函数');
    assert.equal(listPayloads.at(-1).tag, '二次函数');
    assert.match(documentObj.getElementById('diaryWallCards').textContent, /二次函数/);

    documentObj.getElementById('diaryWallScopeSelect').value = 'topic';
    documentObj.getElementById('diaryWallScopeSelect').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.equal(listPayloads.at(-1).scope, 'topic');
    assert.equal(detailPayloads.at(-1).agentId, 'nova_acceptance');
    assert.equal(detailPayloads.at(-1).topicId, 'junior_math_quadratic');
});

test('diaryWallController can jump back to source messages without handing off to a logs panel', async (t) => {
    const { createDiaryWallController } = await loadDiaryWallControllerModule();
    const dom = createDom();
    const previousWindow = global.window;
    const previousDocument = global.document;
    const previousElement = global.Element;
    global.window = dom.window;
    global.document = dom.window.document;
    global.Element = dom.window.Element;

    const originalScrollIntoView = dom.window.HTMLElement.prototype.scrollIntoView;
    let scrollCount = 0;
    dom.window.HTMLElement.prototype.scrollIntoView = function scrollIntoViewStub() {
        scrollCount += 1;
    };

    t.after(() => {
        dom.window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
        global.window = previousWindow;
        global.document = previousDocument;
        global.Element = previousElement;
        dom.window.close();
    });

    let logsOpenCount = 0;
    const documentObj = dom.window.document;
    const controller = createDiaryWallController({
        el: createElementMap(documentObj),
        chatAPI: {
            async listStudyDiaryWallCards() {
                return {
                    success: true,
                    items: [{
                        id: 'study_diary_nova_2026-04-14',
                        diaryId: 'study_diary_nova_2026-04-14',
                        notebookId: 'nova',
                        notebookName: 'Nova',
                        dateKey: '2026-04-14',
                        updatedAt: Date.UTC(2026, 3, 14, 12, 0, 0),
                        entryCount: 1,
                        recallCount: 0,
                        tags: ['验收'],
                        maidSignatures: ['Nova'],
                        agentNames: ['Nova'],
                        topics: {},
                        previewMarkdown: '# DailyNote\n一次验收。',
                    }],
                };
            },
            async getStudyDiaryWallDetail() {
                return {
                    success: true,
                    item: {
                        diaryId: 'study_diary_nova_2026-04-14',
                        notebookId: 'nova',
                        notebookName: 'Nova',
                        dateKey: '2026-04-14',
                        entryCount: 1,
                        recallCount: 0,
                        contentMarkdown: '# DailyNote 2026-04-14\n一次验收。',
                        maidSignatures: ['Nova'],
                        entries: [{
                            id: 'entry-1',
                            createdAt: Date.UTC(2026, 3, 14, 11, 30, 0),
                            notebookName: 'Nova',
                            maidSignature: 'Nova',
                            topicId: 'junior_math_quadratic',
                            topicNameSnapshot: '初中数学_二次函数',
                            contentMarkdown: '[20:18] 记录今日与主人的互动测试。',
                            tags: ['验收'],
                            sourceMessageIds: ['msg-1'],
                            toolRequest: {
                                toolName: 'DailyNote',
                                command: 'create',
                            },
                            requestedToolName: 'DailyNote',
                            requestedCommand: 'create',
                        }],
                    },
                };
            },
        },
        ui: {
            showToastNotification() {},
        },
        documentObj,
        renderMarkdownFragment: (value) => `<article>${String(value)}</article>`,
        getCurrentSelectedItem: () => ({ id: 'nova_acceptance', name: 'Nova_验收' }),
        getCurrentTopicId: () => 'junior_math_quadratic',
        getCurrentTopicName: () => '初中数学_二次函数',
        openLogsPanel: async () => {
            logsOpenCount += 1;
        },
        selectTopic: async () => {},
    });

    controller.bindEvents();
    controller.open();
    await new Promise((resolve) => setTimeout(resolve, 30));

    const jumpButton = documentObj.querySelector('[data-diary-wall-jump="msg-1"]');
    assert.ok(jumpButton);
    jumpButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(scrollCount, 1);
    assert.equal(documentObj.getElementById('diaryWallModal').classList.contains('hidden'), true);
    assert.equal(documentObj.querySelector('[data-message-id="msg-1"]').classList.contains('message-item--logs-highlight'), true);

    assert.equal(logsOpenCount, 0);
});
