const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');

async function loadFlashcardUtilsModule() {
    const modulePath = path.resolve(__dirname, '../src/modules/renderer/app/flashcards/flashcardUtils.js');
    const source = await fs.readFile(modulePath, 'utf8');
    return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
}

test('normalizeFlashcardDeck filters invalid cards and applies fallback refs', async () => {
    const { normalizeFlashcardDeck } = await loadFlashcardUtilsModule();

    const deck = normalizeFlashcardDeck({
        title: '',
        cards: [
            { front: '极限的定义', back: '函数值逼近某常数', sourceDocumentRefs: null },
            { front: '   ', back: 'invalid' },
            null,
        ],
    }, ['doc-1']);

    assert.equal(deck.title, '闪卡集合');
    assert.equal(deck.cards.length, 1);
    assert.equal(deck.cards[0].front, '极限的定义');
    assert.deepEqual(deck.cards[0].sourceDocumentRefs, ['doc-1']);
});

test('parseFlashcardDeckFromResponse accepts fenced json and keeps fallback title', async () => {
    const { parseFlashcardDeckFromResponse } = await loadFlashcardUtilsModule();

    const deck = parseFlashcardDeckFromResponse(
        [
            '```json',
            '{',
            '  "cards": [',
            '    { "id": "card-1", "front": "导数是什么？", "back": "瞬时变化率" }',
            '  ]',
            '}',
            '```',
        ].join('\n'),
        '导数复习',
        ['doc-2'],
    );

    assert.equal(deck.title, '导数复习');
    assert.equal(deck.cards[0].id, 'card-1');
    assert.deepEqual(deck.cards[0].sourceDocumentRefs, ['doc-2']);
});

test('progress helpers update counts and build persist payload', async () => {
    const {
        applyFlashcardResult,
        buildFlashcardPersistPayload,
        createInitialFlashcardProgress,
        normalizeFlashcardDeck,
    } = await loadFlashcardUtilsModule();

    const deck = normalizeFlashcardDeck({
        title: '函数基础',
        cards: [
            { id: 'c1', front: '函数', back: '映射' },
            { id: 'c2', front: '极限', back: '逼近' },
        ],
    });
    const initial = createInitialFlashcardProgress(deck);
    const next = applyFlashcardResult(initial, deck, 'known', 123);

    assert.equal(next.knownCount, 1);
    assert.equal(next.unknownCount, 0);
    assert.equal(next.currentIndex, 1);
    assert.equal(next.cardStates[0].updatedAt, 123);

    const request = buildFlashcardPersistPayload({
        id: 'note-1',
        agentId: 'agent-1',
        topicId: 'topic-1',
        title: '函数基础',
        contentMarkdown: '# 函数基础',
        sourceMessageIds: ['m1'],
        sourceDocumentRefs: ['doc-1'],
        kind: 'flashcards',
        flashcardDeck: deck,
        createdAt: 10,
    }, next);

    assert.equal(request.agentId, 'agent-1');
    assert.equal(request.topicId, 'topic-1');
    assert.equal(request.payload.flashcardProgress.knownCount, 1);
    assert.equal(request.payload.flashcardProgress.cardStates[0].result, 'known');
});

test('navigation clamps within deck bounds and resets flipped state', async () => {
    const {
        createInitialFlashcardProgress,
        navigateFlashcardProgress,
        normalizeFlashcardDeck,
        toggleFlashcardProgressFlipped,
    } = await loadFlashcardUtilsModule();

    const deck = normalizeFlashcardDeck({
        title: '概率论',
        cards: [
            { id: 'c1', front: '随机变量', back: '取值不确定' },
            { id: 'c2', front: '期望', back: '均值' },
        ],
    });

    const flipped = toggleFlashcardProgressFlipped(createInitialFlashcardProgress(deck), deck);
    const next = navigateFlashcardProgress(flipped, deck, 5);
    const previous = navigateFlashcardProgress(next, deck, -10);

    assert.equal(flipped.flipped, true);
    assert.equal(next.currentIndex, 1);
    assert.equal(next.flipped, false);
    assert.equal(previous.currentIndex, 0);
});
