const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');

async function loadOverviewModule() {
    const modulePath = path.resolve(__dirname, '..', 'src/modules/renderer/app/workspace/workspaceOverview.js');
    const source = await fs.readFile(modulePath, 'utf8');
    return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
}

test('buildSubjectOverviewMarkup renders the current dashboard cards, recent activity, and subject wall for populated overview', async () => {
    const { buildSubjectOverviewMarkup } = await loadOverviewModule();

    const result = buildSubjectOverviewMarkup({
        agents: [
            { id: 'math', name: '数学' },
            { id: 'english', name: '英语' },
        ],
        statsByAgent: {
            math: { topicCount: 3, unreadCount: 1, lastTopicName: '函数复习' },
            english: { topicCount: 0, unreadCount: 0, lastTopicName: '' },
        },
        selectedAgentId: 'math',
        overviewStats: {
            subjectCount: 2,
            topicCount: 3,
            pendingCount: 1,
        },
    });

    assert.equal(result.headline, '学习首页');
    assert.match(result.highlightsMarkup, /学科仪表盘/);
    assert.match(result.highlightsMarkup, /对话学习/);
    assert.match(result.highlightsMarkup, /来源阅读/);
    assert.match(result.gridMarkup, /overview-dashboard/);
    assert.match(result.gridMarkup, /学科辅导/);
    assert.match(result.gridMarkup, /知识沉淀/);
    assert.match(result.gridMarkup, /训练转化/);
    assert.match(result.gridMarkup, /成长复盘/);
    assert.match(result.gridMarkup, /最近成长动态/);
    assert.match(result.gridMarkup, /全部学科/);
    assert.match(result.gridMarkup, /overview-subject-browser/);
    assert.match(result.gridMarkup, /subject-overview-card--current/);
    assert.match(result.gridMarkup, /函数复习/);
    assert.match(result.gridMarkup, /data-agent-id="math"/);
    assert.match(result.gridMarkup, /data-agent-id="english"/);
    assert.match(result.gridMarkup, /当前学习空间/);
    assert.match(result.gridMarkup, /subjectOverviewCreateCard/);
});

test('buildSubjectOverviewMarkup keeps the current subject visible when it is the only subject card', async () => {
    const { buildSubjectOverviewMarkup } = await loadOverviewModule();

    const result = buildSubjectOverviewMarkup({
        agents: [
            { id: 'solo', name: '单学科' },
        ],
        statsByAgent: {
            solo: { topicCount: 2, unreadCount: 0, lastTopicName: '复习提纲' },
        },
        selectedAgentId: 'solo',
        overviewStats: {
            subjectCount: 1,
            topicCount: 2,
            pendingCount: 0,
        },
    });

    assert.equal(result.headline, '学习首页');
    assert.match(result.gridMarkup, /overview-dashboard/);
    assert.match(result.gridMarkup, /subject-overview-card--current/);
    assert.match(result.gridMarkup, /单学科/);
    assert.match(result.gridMarkup, /data-agent-id="solo"/);
    assert.equal((result.gridMarkup.match(/data-agent-id="solo"/g) || []).length, 1);
    assert.doesNotMatch(result.gridMarkup, /subject-overview-browser-empty/);
    assert.match(result.gridMarkup, /subjectOverviewCreateCard/);
});

test('buildSubjectOverviewMarkup renders the onboarding empty state when there are no agents', async () => {
    const { buildSubjectOverviewMarkup } = await loadOverviewModule();

    const result = buildSubjectOverviewMarkup({
        agents: [],
        statsByAgent: {},
        selectedAgentId: null,
    });

    assert.equal(result.headline, '学习首页');
    assert.match(result.gridMarkup, /overview-dashboard/);
    assert.match(result.gridMarkup, /创建第一个学科/);
    assert.match(result.gridMarkup, /沉淀你的学习过程/);
    assert.match(result.gridMarkup, /继续完成当天任务/);
    assert.match(result.gridMarkup, /subject-overview-empty/);
    assert.match(result.gridMarkup, /Ready/);
    assert.match(result.gridMarkup, /创建你的第一个学科工作台/);
    assert.match(result.gridMarkup, /立即开始/);
    assert.match(result.gridMarkup, /subjectOverviewCreateCard/);
});
