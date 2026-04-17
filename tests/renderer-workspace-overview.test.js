const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');

async function loadOverviewModule() {
    const modulePath = path.resolve(__dirname, '..', 'src/modules/renderer/app/workspace/workspaceOverview.js');
    const source = await fs.readFile(modulePath, 'utf8');
    return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
}

test('buildSubjectOverviewMarkup renders clock, hero cards, stats, and subject wall for populated overview', async () => {
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

    assert.equal(result.headline, '学科总视图');
    assert.match(result.clockMarkup, /overviewClockTime/);
    assert.match(result.clockMarkup, /overviewClockDate/);
    assert.match(result.clockMarkup, /当前时间/);
    assert.match(result.statsRowMarkup, /overview-stat-card__label/);
    assert.match(result.statsRowMarkup, /学科/);
    assert.match(result.statsRowMarkup, /话题/);
    assert.match(result.statsRowMarkup, /待处理/);
    assert.match(result.gridMarkup, /overview-hero-grid/);
    assert.match(result.gridMarkup, /overview-hero-card--summary/);
    assert.match(result.gridMarkup, /overview-hero-card--current/);
    assert.match(result.gridMarkup, /当前学科/);
    assert.match(result.gridMarkup, /当前有 1 个待处理话题/);
    assert.match(result.gridMarkup, /最近话题：函数复习/);
    assert.doesNotMatch(result.gridMarkup, /subject-overview-card__badge">当前</);
    assert.equal((result.gridMarkup.match(/data-subject-card data-agent-id="math"/g) || []).length, 1);
    assert.match(result.gridMarkup, /subject-overview-card__chip">0 个话题</);
    assert.match(result.gridMarkup, /data-subject-card data-agent-id="english"/);
    assert.match(result.gridMarkup, /新建学科/);
    assert.match(result.gridMarkup, /overview-subject-wall/);
    assert.match(result.gridMarkup, /subjectOverviewCreateCard/);
});

test('buildSubjectOverviewMarkup omits the focused agent from the wall and shows helper empty state when it is the only subject', async () => {
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

    assert.match(result.gridMarkup, /overview-hero-card--current/);
    assert.match(result.gridMarkup, /单学科/);
    assert.match(result.gridMarkup, /当前没有其他学科/);
    assert.doesNotMatch(result.gridMarkup, /data-subject-card data-agent-id="solo"[\s\S]*data-subject-card data-agent-id="solo"/);
});

test('buildSubjectOverviewMarkup renders empty state when there are no agents', async () => {
    const { buildSubjectOverviewMarkup } = await loadOverviewModule();

    const result = buildSubjectOverviewMarkup({
        agents: [],
        statsByAgent: {},
        selectedAgentId: null,
    });

    assert.equal(result.headline, '创建你的第一个学科');
    assert.match(result.clockMarkup, /overviewClockTime/);
    assert.match(result.statsRowMarkup, /待处理/);
    assert.match(result.gridMarkup, /overview-hero-card--summary/);
    assert.match(result.gridMarkup, /overview-hero-card--current/);
    assert.match(result.gridMarkup, /subject-overview-empty/);
    assert.match(result.gridMarkup, /Ready to start/);
    assert.match(result.gridMarkup, /subjectOverviewCreateCard/);
});
