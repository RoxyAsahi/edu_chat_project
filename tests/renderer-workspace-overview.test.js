const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');

async function loadOverviewModule() {
    const modulePath = path.resolve(__dirname, '..', 'src/modules/renderer/app/workspace/workspaceOverview.js');
    const source = await fs.readFile(modulePath, 'utf8');
    return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
}

test('buildSubjectOverviewMarkup renders hero, cards, and create card for populated overview', async () => {
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
    });

    assert.equal(result.headline, '学科总视图');
    assert.match(result.heroMarkup, /overview-hero-card/);
    assert.match(result.heroMarkup, /overview-stat-pill__label/);
    assert.match(result.gridMarkup, /subject-overview-card--active/);
    assert.match(result.gridMarkup, /subject-overview-card__chip--attention/);
    assert.match(result.gridMarkup, /最近话题：函数复习/);
    assert.match(result.gridMarkup, /subjectOverviewCreateCard/);
});

test('buildSubjectOverviewMarkup renders empty state when there are no agents', async () => {
    const { buildSubjectOverviewMarkup } = await loadOverviewModule();

    const result = buildSubjectOverviewMarkup({
        agents: [],
        statsByAgent: {},
        selectedAgentId: null,
    });

    assert.equal(result.headline, '创建你的第一个学科');
    assert.match(result.gridMarkup, /subject-overview-empty/);
    assert.match(result.gridMarkup, /Ready to start/);
    assert.match(result.gridMarkup, /subjectOverviewCreateCard/);
});
