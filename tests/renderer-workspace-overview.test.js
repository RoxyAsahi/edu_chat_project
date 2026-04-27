const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');

async function loadOverviewModule() {
    const modulePath = path.resolve(__dirname, '..', 'src/modules/renderer/app/workspace/workspaceOverview.js');
    const source = await fs.readFile(modulePath, 'utf8');
    return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
}

test('buildSubjectOverviewMarkup renders the learning home flow, status, and subject wall for populated overview', async () => {
    const { buildSubjectOverviewMarkup } = await loadOverviewModule();

    const result = buildSubjectOverviewMarkup({
        agents: [
            { id: 'math', name: '数学', cardEmoji: '📐' },
            { id: 'english', name: '英语' },
        ],
        statsByAgent: {
            math: { topicCount: 3, unreadCount: 1, lastTopicName: '函数复习' },
            english: { topicCount: 0, unreadCount: 0, lastTopicName: '' },
        },
        selectedAgentId: 'math',
        learningMetrics: {
            streakDays: 2,
            activeDaysLast7: 3,
            totalLearningDays: 9,
            trendDays: [
                { dateKey: '2026-04-21', label: '4/21', value: 0, active: false },
                { dateKey: '2026-04-22', label: '4/22', value: 2, active: true },
                { dateKey: '2026-04-23', label: '4/23', value: 0, active: false },
                { dateKey: '2026-04-24', label: '4/24', value: 1, active: true },
                { dateKey: '2026-04-25', label: '4/25', value: 0, active: false },
                { dateKey: '2026-04-26', label: '4/26', value: 3, active: true },
                { dateKey: '2026-04-27', label: '4/27', value: 0, active: false },
            ],
        },
        overviewStats: {
            subjectCount: 2,
            topicCount: 3,
            pendingCount: 1,
        },
    });

    assert.equal(result.headline, '学习工作台');
    assert.equal(result.highlightsMarkup, '');
    assert.match(result.gridMarkup, /app-home--learning/);
    assert.match(result.gridMarkup, /功能怎么用/);
    assert.match(result.gridMarkup, /放入资料/);
    assert.match(result.gridMarkup, /提问理解/);
    assert.match(result.gridMarkup, /整理笔记/);
    assert.match(result.gridMarkup, /复盘巩固/);
    assert.match(result.gridMarkup, /学习状态/);
    assert.match(result.gridMarkup, /最近学习/);
    assert.match(result.gridMarkup, /查看更多/);
    assert.match(result.gridMarkup, /学习空间/);
    assert.match(result.gridMarkup, /把每个学科当作一个长期学习空间/);
    assert.match(result.gridMarkup, /home-subjects/);
    assert.match(result.gridMarkup, /subject-overview-card--current/);
    assert.match(result.gridMarkup, /subject-overview-card__emoji/);
    assert.match(result.gridMarkup, /📐/);
    assert.match(result.gridMarkup, /3 个话题/);
    assert.match(result.gridMarkup, /0 个话题/);
    assert.match(result.gridMarkup, /函数复习/);
    assert.doesNotMatch(result.gridMarkup, /subject-overview-card__badge/);
    assert.doesNotMatch(result.gridMarkup, /subject-overview-card__body/);
    assert.doesNotMatch(result.gridMarkup, /subject-overview-card__meta/);
    assert.equal((result.gridMarkup.match(/\bdata-subject-card\b/g) || []).length, 2);
    assert.match(result.gridMarkup, /data-agent-id="math"/);
    assert.match(result.gridMarkup, /data-agent-id="english"/);
    assert.match(result.gridMarkup, /subjectOverviewCreateCard/);
    assert.match(result.gridMarkup, /学习结晶/);
    assert.match(result.gridMarkup, /home-diary/);
    assert.match(result.gridMarkup, /home-status-trend/);
    assert.match(result.gridMarkup, /home-status-trend__chart/);
    assert.match(result.gridMarkup, /活跃度 3/);
    assert.doesNotMatch(result.gridMarkup, /近 7 天活跃 3 天，总学习 9 天/);
    assert.doesNotMatch(result.gridMarkup, /home-status__score/);
    assert.doesNotMatch(result.gridMarkup, /学习力/);
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

    assert.equal(result.headline, '学习工作台');
    assert.match(result.gridMarkup, /app-home--learning/);
    assert.match(result.gridMarkup, /subject-overview-card--current/);
    assert.match(result.gridMarkup, /subject-overview-card__emoji/);
    assert.match(result.gridMarkup, /单学科/);
    assert.match(result.gridMarkup, /2 个话题/);
    assert.match(result.gridMarkup, /data-agent-id="solo"/);
    assert.equal((result.gridMarkup.match(/\bdata-subject-card\b/g) || []).length, 1);
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

    assert.equal(result.headline, '学习工作台');
    assert.match(result.gridMarkup, /app-home--learning/);
    assert.match(result.gridMarkup, /个人 AI 学习中心/);
    assert.match(result.gridMarkup, /data-home-action="create-subject"/);
    assert.match(result.gridMarkup, /新建学科/);
    assert.match(result.gridMarkup, /创建第一个学科工作台/);
    assert.match(result.gridMarkup, /例如：数学、英语、论文阅读、考研复习/);
    assert.match(result.gridMarkup, /subjectOverviewCreateCard/);
});
