const test = require('node:test');
const assert = require('assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

async function loadNotesUtilsModule() {
    const notesPath = path.resolve(__dirname, '../src/modules/renderer/app/notes/notesUtils.js');
    return import(pathToFileURL(notesPath).href);
}

test('normalizeNote fills default ids and normalizes embedded flashcards', async () => {
    const { normalizeNote } = await loadNotesUtilsModule();

    const note = normalizeNote({
        title: '',
        kind: 'flashcards',
        sourceDocumentRefs: ['doc-1'],
        flashcardDeck: {
            cards: [
                { front: '定积分', back: '面积累积' },
            ],
        },
        flashcardProgress: {
            currentIndex: 4,
            cardStates: [{ cardId: 'missing', result: 'known', updatedAt: 1 }],
        },
    }, {
        defaultAgentId: 'agent-1',
        defaultTopicId: 'topic-1',
    });

    assert.equal(note.agentId, 'agent-1');
    assert.equal(note.topicId, 'topic-1');
    assert.equal(note.title, '未命名笔记');
    assert.equal(note.flashcardDeck.cards.length, 1);
    assert.equal(note.flashcardProgress.currentIndex, 0);
    assert.equal(note.flashcardProgress.cardStates[0].cardId, note.flashcardDeck.cards[0].id);
});

test('buildNotesSelectionSummary matches topic and agent scope wording', async () => {
    const { buildNotesSelectionSummary } = await loadNotesUtilsModule();

    assert.equal(
        buildNotesSelectionSummary({ notesScope: 'topic', selectedCount: 2, visibleCount: 8 }),
        '当前话题 · 已选 2 条，生成时优先使用这些笔记'
    );
    assert.equal(
        buildNotesSelectionSummary({ notesScope: 'agent', selectedCount: 0, visibleCount: 3 }),
        '学科汇总 · 3 条笔记，未选择时回退到当前 Source'
    );
    assert.equal(
        buildNotesSelectionSummary({ notesScope: 'topic', selectedCount: 0, visibleCount: 0 }),
        '当前话题 · 暂无笔记，可直接从当前来源开始生成'
    );
});

test('normalizeNote derives structured quiz data from legacy markdown content', async () => {
    const { normalizeNote } = await loadNotesUtilsModule();

    const note = normalizeNote({
        kind: 'quiz',
        title: '函数测验',
        contentMarkdown: [
            '# 函数测验',
            '',
            '## 1. 导数的几何意义是什么？',
            'A. 曲线在该点的切线斜率',
            'B. 曲线与坐标轴围成的面积',
            'C. 函数的定义域',
            'D. 函数的最小值',
            '正确答案：A',
            '解析：导数描述函数在某点的瞬时变化率，对应切线斜率。',
        ].join('\n'),
    });

    assert.equal(note.quizSet.title, '函数测验');
    assert.equal(note.quizSet.items.length, 1);
    assert.equal(note.quizSet.items[0].correctOptionId, 'option_a');
});

test('removeDeletedNoteReferencesFromHistory clears favorite state only when the last ref is removed', async () => {
    const { removeDeletedNoteReferencesFromHistory } = await loadNotesUtilsModule();

    const { changed, nextHistory } = removeDeletedNoteReferencesFromHistory([
        {
            id: 'm1',
            favorited: true,
            favoriteAt: 123,
            noteRefs: ['note-1'],
        },
        {
            id: 'm2',
            favorited: true,
            favoriteAt: 456,
            noteRefs: ['note-1', 'note-2'],
        },
    ], 'note-1');

    assert.equal(changed, true);
    assert.deepEqual(nextHistory[0].noteRefs, []);
    assert.equal(nextHistory[0].favorited, false);
    assert.equal(nextHistory[0].favoriteAt, null);
    assert.deepEqual(nextHistory[1].noteRefs, ['note-2']);
    assert.equal(nextHistory[1].favorited, true);
    assert.equal(nextHistory[1].favoriteAt, 456);
});

test('note save and delete helpers cover blank drafts, save payloads, and deleted state cleanup', async () => {
    const {
        buildBlankNoteTitle,
        buildNoteSaveRequest,
        deriveDeletedNoteState,
    } = await loadNotesUtilsModule();

    assert.equal(
        buildBlankNoteTitle({ currentTopicName: '函数', hasCurrentTopic: true }),
        '函数 学习笔记'
    );
    assert.equal(
        buildNoteSaveRequest({ currentTopicId: 'topic-1', title: '', contentMarkdown: '   ' }),
        null
    );

    const request = buildNoteSaveRequest({
        currentNote: {
            id: 'note-1',
            title: '旧标题',
            topicId: 'topic-old',
            sourceMessageIds: ['m1'],
            sourceDocumentRefs: ['doc-1'],
            kind: 'note',
            createdAt: 10,
        },
        currentTopicId: 'topic-new',
        title: '',
        contentMarkdown: '新的内容',
    });

    assert.equal(request.targetTopicId, 'topic-old');
    assert.equal(request.payload.title, '旧标题');
    assert.equal(request.payload.contentMarkdown, '新的内容');

    const quizRequest = buildNoteSaveRequest({
        currentNote: {
            id: 'quiz-1',
            title: '函数测验',
            topicId: 'topic-1',
            kind: 'quiz',
            quizSet: {
                title: '函数测验',
                items: [
                    {
                        id: 'quiz_1',
                        stem: '题干',
                        options: [
                            { id: 'option_a', label: 'A', text: '甲' },
                            { id: 'option_b', label: 'B', text: '乙' },
                            { id: 'option_c', label: 'C', text: '丙' },
                            { id: 'option_d', label: 'D', text: '丁' },
                        ],
                        correctOptionId: 'option_a',
                        explanation: '解析',
                    },
                ],
            },
        },
        currentTopicId: 'topic-1',
        title: '函数测验',
        contentMarkdown: '# 函数测验',
    });

    assert.equal(quizRequest.payload.kind, 'quiz');
    assert.equal(quizRequest.payload.quizSet.title, '函数测验');
    assert.deepEqual(
        deriveDeletedNoteState({
            selectedNoteIds: ['note-1', 'note-2'],
            activeNoteId: 'note-1',
            activeFlashcardNoteId: 'note-3',
        }, 'note-1'),
        {
            selectedNoteIds: ['note-2'],
            activeNoteId: null,
            activeFlashcardNoteId: 'note-3',
        }
    );
});
