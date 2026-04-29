const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');

async function buildModuleDataUrl(filePath, moduleCache = new Map()) {
    const normalizedPath = path.resolve(filePath);
    if (moduleCache.has(normalizedPath)) {
        return moduleCache.get(normalizedPath);
    }

    let source = await fs.readFile(normalizedPath, 'utf8');
    const importMatches = [...source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)];
    for (const match of importMatches) {
        const specifier = match[1];
        const dependencyPath = path.resolve(path.dirname(normalizedPath), specifier);
        const dependencyUrl = await buildModuleDataUrl(dependencyPath, moduleCache);
        source = source.replace(`from '${specifier}'`, `from '${dependencyUrl}'`);
        source = source.replace(`from "${specifier}"`, `from "${dependencyUrl}"`);
    }

    const dataUrl = `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
    moduleCache.set(normalizedPath, dataUrl);
    return dataUrl;
}

async function loadFlashcardUtilsModule() {
    const modulePath = path.resolve(__dirname, '../src/modules/renderer/app/flashcards/flashcardUtils.js');
    const source = await fs.readFile(modulePath, 'utf8');
    return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
}

async function loadFlashcardControllerModule() {
    const modulePath = path.resolve(__dirname, '../src/modules/renderer/app/flashcards/flashcardController.js');
    return import(await buildModuleDataUrl(modulePath));
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

test('pending generation array APIs clear only the requested flashcard job', async () => {
    const { createFlashcardController } = await loadFlashcardControllerModule();
    const state = {
        notes: {
            activeNoteId: 'note-1',
            activeFlashcardNoteId: 'flashcard-note',
            pendingFlashcardGeneration: null,
            pendingFlashcardGenerations: [],
        },
    };
    const store = {
        getState: () => state,
        patchState(slice, patch) {
            const current = state[slice] || {};
            state[slice] = typeof patch === 'function'
                ? patch(current, state)
                : { ...current, ...patch };
            return state[slice];
        },
    };
    let rightPanelMode = null;
    let renderCount = 0;

    const controller = createFlashcardController({
        store,
        el: {},
        chatAPI: {},
        ui: {},
        setRightPanelMode: (mode) => {
            rightPanelMode = mode;
        },
        renderNotesPanel: () => {
            renderCount += 1;
        },
    });

    controller.beginPendingGeneration({
        requestId: 'request-1',
        agentId: 'agent-1',
        topicId: 'topic-1',
        title: '第一组闪卡',
        cardCount: 8,
    });
    controller.beginPendingGeneration({
        requestId: 'request-2',
        agentId: 'agent-1',
        topicId: 'topic-1',
        title: '第二组闪卡',
        cardCount: 18,
    });

    assert.equal(rightPanelMode, 'notes');
    assert.equal(state.notes.activeFlashcardNoteId, null);
    assert.deepEqual(controller.getPendingGenerations().map((pending) => pending.requestId), ['request-1', 'request-2']);
    assert.equal(controller.getPendingGeneration().requestId, 'request-1');
    assert.equal(state.notes.pendingFlashcardGeneration.requestId, 'request-1');

    controller.updatePendingGeneration('request-1', { sourceCount: 3 });
    assert.equal(controller.getPendingGenerations()[0].sourceCount, 3);

    controller.clearPendingGeneration('request-1');
    assert.deepEqual(controller.getPendingGenerations().map((pending) => pending.requestId), ['request-2']);
    assert.equal(state.notes.pendingFlashcardGeneration.requestId, 'request-2');

    controller.clearPendingGeneration('missing-request');
    assert.deepEqual(controller.getPendingGenerations().map((pending) => pending.requestId), ['request-2']);

    controller.clearPendingGeneration();
    assert.deepEqual(controller.getPendingGenerations(), []);
    assert.equal(state.notes.pendingFlashcardGeneration, null);
    assert.ok(renderCount >= 4);
});
