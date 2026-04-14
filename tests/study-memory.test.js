const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

const { createStudyLogStore } = require('../src/modules/main/study/studyLogStore');
const { createStudyDiaryProjector } = require('../src/modules/main/study/studyDiaryProjector');
const { createStudyMemoryService } = require('../src/modules/main/study/studyMemoryService');

test('study memory search recalls diary content and marks recall counts', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-study-memory-'));
    t.after(() => fs.remove(tempRoot));

    const store = createStudyLogStore({ dataRoot: tempRoot });
    const projector = createStudyDiaryProjector({ dataRoot: tempRoot, studyLogStore: store });
    const memoryService = createStudyMemoryService({
        settingsManager: {
            async readSettings() {
                return {};
            },
        },
        studyLogStore: store,
        diaryProjector: projector,
    });

    const entry = await store.writeEntry({
        agentId: 'agent_math',
        topicId: 'topic_derivative',
        topicNameSnapshot: '导数复习',
        dateKey: '2026-04-13',
        studentNameSnapshot: 'Alice',
        workspaceSnapshot: 'Dorm A-301',
        environmentSnapshot: 'Laptop',
        sourceMessageIds: ['user_1'],
        contentMarkdown: '今天完成了导数定义、导数公式和 3 道练习题。',
        tags: ['高数', '导数'],
        status: 'written',
    });
    await projector.projectEntry(entry);

    const result = await memoryService.searchStudyMemory({
        agentId: 'agent_math',
        topicId: 'topic_derivative',
        query: '导数 练习题 总结',
        topK: 2,
        fallbackTopK: 1,
    });

    assert.equal(result.itemCount, 1);
    assert.match(result.contextText, /Study memory recall/);
    assert.equal(result.refs[0].dateKey, '2026-04-13');

    const recalledEntry = await store.getEntry({
        agentId: 'agent_math',
        topicId: 'topic_derivative',
        entryId: entry.id,
    });
    assert.equal(recalledEntry.recallCount, 1);

    const diary = await projector.getDiaryDay({
        agentId: 'agent_math',
        dateKey: '2026-04-13',
        topicId: 'topic_derivative',
    });
    assert.equal(diary.recallCount, 1);
    assert.equal(diary.notebookName, '默认');
});

test('study log store can mark mixed diary recall refs via entry ownership', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-study-memory-'));
    t.after(() => fs.remove(tempRoot));

    const store = createStudyLogStore({ dataRoot: tempRoot });

    const currentEntry = await store.writeEntry({
        agentId: 'agent_math',
        topicId: 'topic_derivative',
        topicNameSnapshot: '导数复习',
        dateKey: '2026-04-13',
        notebookId: 'public',
        notebookName: '公共',
        contentMarkdown: '当前话题练习了导数定义。',
        tags: ['高数'],
        status: 'written',
    });
    const publicEntry = await store.writeEntry({
        agentId: 'agent_physics',
        topicId: 'topic_force',
        topicNameSnapshot: '受力分析',
        dateKey: '2026-04-13',
        notebookId: 'public',
        notebookName: '公共',
        contentMarkdown: '公共笔记里整理了受力分析和摩擦力例题。',
        tags: ['物理', '受力分析'],
        status: 'written',
    });

    await store.markEntriesRecalled([{
        diaryId: 'study_diary_public_2026-04-13',
        notebookId: 'public',
        dateKey: '2026-04-13',
        agentId: '',
        topicId: '',
        entryIds: [currentEntry.id, publicEntry.id],
        entryRefs: [
            {
                agentId: currentEntry.agentId,
                topicId: currentEntry.topicId,
                entryId: currentEntry.id,
            },
            {
                agentId: publicEntry.agentId,
                topicId: publicEntry.topicId,
                entryId: publicEntry.id,
            },
        ],
    }]);

    const recalledCurrentEntry = await store.getEntry({
        agentId: 'agent_math',
        topicId: 'topic_derivative',
        entryId: currentEntry.id,
    });
    const recalledPublicEntry = await store.getEntry({
        agentId: 'agent_physics',
        topicId: 'topic_force',
        entryId: publicEntry.id,
    });

    assert.equal(recalledCurrentEntry.recallCount, 1);
    assert.equal(recalledPublicEntry.recallCount, 1);
});
