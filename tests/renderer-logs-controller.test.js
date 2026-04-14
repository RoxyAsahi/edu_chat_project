const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');
const { JSDOM } = require('jsdom');

async function loadLogsControllerModule() {
    const modulePath = path.resolve(__dirname, '../src/modules/renderer/app/logs/logsController.js');
    const source = await fs.readFile(modulePath, 'utf8');
    return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
}

function createStore() {
    const state = {
        logs: {
            scope: 'topic',
            days: [],
            entries: [],
            activeDateKey: null,
            activeEntryId: null,
            searchQuery: '',
            dateFilter: '',
            detail: null,
        },
        session: {
            currentSelectedItem: { id: 'agent_1', name: 'Math Agent' },
            currentTopicId: 'topic_1',
        },
    };

    return {
        getState() {
            return state;
        },
        patchState(slice, patch) {
            const current = state[slice];
            state[slice] = typeof patch === 'function'
                ? patch(current, state)
                : { ...current, ...patch };
            return state[slice];
        },
    };
}

function createDom() {
    return new JSDOM(`
        <body>
          <button id="topicLogsScopeBtn" type="button"></button>
          <button id="agentLogsScopeBtn" type="button"></button>
          <input id="logsSearchInput" />
          <input id="logsDateInput" />
          <div id="logsRangeSummary"></div>
          <div id="logsStateSummary"></div>
          <button id="logsOpenDiaryWallBtn" type="button">open-wall</button>
          <button id="logsOpenDiaryManagerBtn" type="button">open-diary</button>
          <div id="logsSummaryText"></div>
          <div id="logsEntrySummary"></div>
          <div id="logsDetailMeta"></div>
          <div id="logsDaysList"></div>
          <div id="logsEntriesList"></div>
          <div id="logsDetailView"></div>
        </body>
    `, { url: 'http://localhost' });
}

test('logsController degrades quietly when VCP Lite is unavailable', async (t) => {
    const { createLogsController } = await loadLogsControllerModule();
    const dom = createDom();
    const previousWindow = global.window;
    const previousDocument = global.document;
    const previousElement = global.Element;
    global.window = dom.window;
    global.document = dom.window.document;
    global.Element = dom.window.Element;

    t.after(() => {
        global.window = previousWindow;
        global.document = previousDocument;
        global.Element = previousElement;
        dom.window.close();
    });

    const toasts = [];
    const documentObj = dom.window.document;
    const controller = createLogsController({
        store: createStore(),
        el: {
            topicLogsScopeBtn: documentObj.getElementById('topicLogsScopeBtn'),
            agentLogsScopeBtn: documentObj.getElementById('agentLogsScopeBtn'),
            logsSearchInput: documentObj.getElementById('logsSearchInput'),
            logsDateInput: documentObj.getElementById('logsDateInput'),
            logsRangeSummary: documentObj.getElementById('logsRangeSummary'),
            logsStateSummary: documentObj.getElementById('logsStateSummary'),
            logsOpenDiaryWallBtn: documentObj.getElementById('logsOpenDiaryWallBtn'),
            logsOpenDiaryManagerBtn: documentObj.getElementById('logsOpenDiaryManagerBtn'),
            logsSummaryText: documentObj.getElementById('logsSummaryText'),
            logsEntrySummary: documentObj.getElementById('logsEntrySummary'),
            logsDetailMeta: documentObj.getElementById('logsDetailMeta'),
            logsDaysList: documentObj.getElementById('logsDaysList'),
            logsEntriesList: documentObj.getElementById('logsEntriesList'),
            logsDetailView: documentObj.getElementById('logsDetailView'),
        },
        chatAPI: {
            async getVcpLiteMaintenanceSummary() {
                return {
                    success: false,
                    available: false,
                    unavailable: true,
                    error: 'Missing dependency @dqbd/tiktoken',
                };
            },
            async listStudyLogDays() {
                return {
                    success: true,
                    available: false,
                    unavailable: true,
                    reason: 'Missing dependency @dqbd/tiktoken',
                    items: [],
                };
            },
            async listStudyLogEntries() {
                return {
                    success: true,
                    available: false,
                    unavailable: true,
                    reason: 'Missing dependency @dqbd/tiktoken',
                    items: [],
                };
            },
            async getStudyLogEntry() {
                return {
                    success: true,
                    available: false,
                    unavailable: true,
                    reason: 'Missing dependency @dqbd/tiktoken',
                    item: null,
                };
            },
            async getStudyDiaryDay() {
                return {
                    success: true,
                    available: false,
                    unavailable: true,
                    reason: 'Missing dependency @dqbd/tiktoken',
                    item: null,
                };
            },
        },
        ui: {
            showToastNotification(message, type) {
                toasts.push({ message, type });
            },
        },
    });

    await controller.refreshLogs();

    assert.deepEqual(toasts, []);
    assert.match(documentObj.getElementById('logsDaysList').textContent, /Logs 暂不可用/);
    assert.match(documentObj.getElementById('logsDetailView').textContent, /Missing dependency @dqbd\/tiktoken/);
    assert.match(documentObj.getElementById('logsStateSummary').textContent, /Missing dependency @dqbd\/tiktoken/);
});

test('logsController renders overview, entry details, tag filters, and diary shortcuts', async (t) => {
    const { createLogsController } = await loadLogsControllerModule();
    const dom = createDom();
    const previousWindow = global.window;
    const previousDocument = global.document;
    const previousElement = global.Element;
    global.window = dom.window;
    global.document = dom.window.document;
    global.Element = dom.window.Element;

    t.after(() => {
        global.window = previousWindow;
        global.document = previousDocument;
        global.Element = previousElement;
        dom.window.close();
    });

    let diaryManagerOpenCount = 0;
    let diaryWallOpenCount = 0;
    const documentObj = dom.window.document;
    const controller = createLogsController({
        store: createStore(),
        el: {
            topicLogsScopeBtn: documentObj.getElementById('topicLogsScopeBtn'),
            agentLogsScopeBtn: documentObj.getElementById('agentLogsScopeBtn'),
            logsSearchInput: documentObj.getElementById('logsSearchInput'),
            logsDateInput: documentObj.getElementById('logsDateInput'),
            logsRangeSummary: documentObj.getElementById('logsRangeSummary'),
            logsStateSummary: documentObj.getElementById('logsStateSummary'),
            logsOpenDiaryWallBtn: documentObj.getElementById('logsOpenDiaryWallBtn'),
            logsOpenDiaryManagerBtn: documentObj.getElementById('logsOpenDiaryManagerBtn'),
            logsSummaryText: documentObj.getElementById('logsSummaryText'),
            logsEntrySummary: documentObj.getElementById('logsEntrySummary'),
            logsDetailMeta: documentObj.getElementById('logsDetailMeta'),
            logsDaysList: documentObj.getElementById('logsDaysList'),
            logsEntriesList: documentObj.getElementById('logsEntriesList'),
            logsDetailView: documentObj.getElementById('logsDetailView'),
        },
        chatAPI: {
            async getVcpLiteMaintenanceSummary() {
                return {
                    success: true,
                    summary: {
                        entryCount: 1,
                        dayCount: 1,
                        recallCount: 2,
                        latestEntryPreview: '刚复盘了二次函数顶点式。',
                    },
                };
            },
            async listStudyLogDays() {
                return {
                    success: true,
                    items: [{
                        dateKey: '2026-04-14',
                        entryCount: 1,
                        viewContentMarkdown: '# Study Diary\n刚复盘了二次函数顶点式。',
                    }],
                };
            },
            async listStudyLogEntries() {
                return {
                    success: true,
                    items: [{
                        id: 'entry-1',
                        topicId: 'topic_1',
                        topicNameSnapshot: '初中数学_二次函数',
                        createdAt: Date.UTC(2026, 3, 14, 9, 30, 0),
                        contentMarkdown: '刚复盘了二次函数顶点式。',
                        toolRequest: {
                            toolName: 'DailyNote',
                            command: 'create',
                        },
                        modelSnapshot: 'qwen3.5-plus',
                        recallCount: 2,
                        status: 'written',
                        tags: ['数学', 'UniStudyTopic:topic_1'],
                    }],
                };
            },
            async getStudyLogEntry() {
                return {
                    success: true,
                    item: {
                        id: 'entry-1',
                        dateKey: '2026-04-14',
                        topicId: 'topic_1',
                        topicNameSnapshot: '初中数学_二次函数',
                        createdAt: Date.UTC(2026, 3, 14, 9, 30, 0),
                        contentMarkdown: '刚复盘了二次函数顶点式。',
                        sourceMessageIds: ['msg-1'],
                        toolRequest: {
                            toolName: 'DailyNote',
                            command: 'create',
                        },
                        filePath: 'Nova\\2026-04-14-09_30_00.txt',
                        modelSnapshot: 'qwen3.5-plus',
                        recallCount: 2,
                        lastRecalledAt: Date.UTC(2026, 3, 14, 9, 40, 0),
                        status: 'written',
                        tags: ['数学', 'UniStudyTopic:topic_1'],
                        topicTag: 'UniStudyTopic:topic_1',
                        agentTag: 'UniStudyAgent:agent_1',
                    },
                };
            },
            async getStudyDiaryDay() {
                return {
                    success: true,
                    item: {
                        dateKey: '2026-04-14',
                        recallCount: 2,
                        updatedAt: Date.UTC(2026, 3, 14, 9, 35, 0),
                        viewContentMarkdown: '# Study Diary\n刚复盘了二次函数顶点式。',
                    },
                };
            },
        },
        ui: {
            showToastNotification() {},
        },
        getCurrentTopicName: () => '初中数学_二次函数',
        openDiaryWall: async () => {
            diaryWallOpenCount += 1;
        },
        openDiaryManager: async () => {
            diaryManagerOpenCount += 1;
        },
    });

    controller.bindEvents();
    await controller.refreshLogs();

    assert.match(documentObj.getElementById('logsRangeSummary').textContent, /Math Agent \/ 初中数学_二次函数/);
    assert.match(documentObj.getElementById('logsStateSummary').textContent, /条目 1 条/);
    assert.match(documentObj.getElementById('logsStateSummary').textContent, /日记 1 本日记卡/);
    assert.match(documentObj.getElementById('logsStateSummary').textContent, /召回 2 次/);
    assert.match(documentObj.getElementById('logsEntriesList').textContent, /二次函数/);
    assert.match(documentObj.getElementById('logsDetailView').textContent, /工具请求/);

    const tagButton = documentObj.querySelector('[data-log-tag="数学"]');
    assert.ok(tagButton);
    tagButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 260));
    assert.equal(documentObj.getElementById('logsSearchInput').value, '数学');

    documentObj.getElementById('logsOpenDiaryManagerBtn').click();
    assert.equal(diaryManagerOpenCount, 1);

    documentObj.getElementById('logsOpenDiaryWallBtn').click();
    assert.equal(diaryWallOpenCount, 1);
});
