const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');
const { JSDOM } = require('jsdom');

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

async function loadNotesUtilsModule() {
    const notesPath = path.resolve(__dirname, '../src/modules/renderer/app/notes/notesUtils.js');
    return import(await buildModuleDataUrl(notesPath));
}

async function loadNotesControllerModule() {
    const controllerPath = path.resolve(__dirname, '../src/modules/renderer/app/notes/notesController.js');
    return import(await buildModuleDataUrl(controllerPath));
}

function createBaseState(overrides = {}) {
    const base = {
        settings: {
            settings: {
                vcpServerUrl: '',
                vcpApiKey: '',
            },
            settingsModalSection: 'global',
            promptModule: null,
        },
        layout: {
            rightPanelMode: 'notes',
        },
        session: {
            currentSelectedItem: {
                id: 'agent-1',
                name: '数学',
                config: {
                    model: 'fixture-model',
                    maxOutputTokens: 1200,
                },
            },
            currentTopicId: 'topic-1',
            currentChatHistory: [],
        },
        source: {},
        reader: {},
        notes: {
            topicNotes: [],
            agentNotes: [],
            notesScope: 'topic',
            activeNoteId: null,
            selectedNoteIds: [],
            notesStudioView: 'overview',
            manualNotesLibraryOpen: false,
            noteDetailKind: null,
            noteDetailMode: 'edit',
            activeNoteMenu: null,
            activeFlashcardNoteId: null,
            pendingFlashcardGeneration: null,
            quizPractice: {
                noteId: null,
                currentIndex: 0,
                selectedOptionId: null,
                revealed: false,
            },
        },
        composer: {},
    };

    return {
        ...base,
        ...overrides,
        settings: {
            ...base.settings,
            ...(overrides.settings || {}),
            settings: {
                ...base.settings.settings,
                ...(overrides.settings?.settings || {}),
            },
        },
        layout: {
            ...base.layout,
            ...(overrides.layout || {}),
        },
        session: {
            ...base.session,
            ...(overrides.session || {}),
            currentSelectedItem: {
                ...base.session.currentSelectedItem,
                ...(overrides.session?.currentSelectedItem || {}),
                config: {
                    ...base.session.currentSelectedItem.config,
                    ...(overrides.session?.currentSelectedItem?.config || {}),
                },
            },
        },
        notes: {
            ...base.notes,
            ...(overrides.notes || {}),
        },
    };
}

function createStore(initialState) {
    const state = initialState;
    return {
        getState() {
            return state;
        },
        patchState(slice, patch) {
            const currentSlice = state[slice] || {};
            const nextSlice = typeof patch === 'function'
                ? patch(currentSlice, state)
                : { ...currentSlice, ...patch };
            state[slice] = nextSlice;
            return nextSlice;
        },
    };
}

function createNotesDom() {
    const dom = new JSDOM(`
        <body>
            <div id="notesList"></div>
            <div id="notesSelectionSummary"></div>
            <button id="topicNotesScopeBtn"></button>
            <button id="agentNotesScopeBtn"></button>
            <button id="newNoteBtn"></button>
            <button id="newNoteFabBtn"></button>
            <button id="notesStudioOpenBtn"></button>
            <button id="manualNotesLibraryBtn"></button>
            <button id="saveNoteBtn"></button>
            <button id="deleteNoteBtn"></button>
            <button id="analyzeNotesBtn"></button>
            <button id="generateQuizBtn"></button>
            <button id="generateFlashcardsBtn"></button>
            <button id="analysisViewReportBtn"></button>
            <button id="analysisEditMarkdownBtn"></button>
            <button id="quizViewPracticeBtn"></button>
            <button id="quizEditSourceBtn"></button>
            <div id="noteDetailModal" class="hidden"></div>
            <button id="noteDetailCloseBtn"></button>
            <div id="noteDetailModalBackdrop"></div>
            <div id="noteActionMenu"></div>
            <div id="manualNotesLibraryModal" class="hidden"></div>
            <div id="manualNotesLibraryBackdrop"></div>
            <button id="manualNotesLibraryCloseBtn"></button>
            <div id="manualNotesLibraryTitle"></div>
            <div id="manualNotesLibrarySubtitle"></div>
            <div id="manualNotesLibraryGrid"></div>
            <input id="noteTitleInput" />
            <textarea id="noteContentInput"></textarea>
            <div id="noteMetaSummary"></div>
            <div id="noteDetailEyebrow"></div>
            <div id="noteDetailTitle"></div>
            <div id="noteDetailSubtitle"></div>
            <div id="analysisPreviewCard"></div>
            <div id="analysisPreviewTitle"></div>
            <div id="analysisPreviewContent"></div>
            <div id="analysisPreviewMeta"></div>
            <div id="noteEditorCard"></div>
            <div id="flashcardsPracticeCard"></div>
            <div id="quizPracticeCard"></div>
            <div id="quizPracticeTitle"></div>
            <div id="quizPracticeSummary"></div>
            <div id="quizPracticeProgress"></div>
            <div id="quizPracticeQuestionIndex"></div>
            <div id="quizPracticeStem"></div>
            <div id="quizPracticeOptions"></div>
            <div id="quizPracticeFeedback"></div>
            <div id="quizPracticeResult"></div>
            <div id="quizPracticeAnswer"></div>
            <div id="quizPracticeExplanation"></div>
            <button id="quizPracticePrevBtn"></button>
            <button id="quizPracticeNextBtn"></button>
            <div id="chatMessages"></div>
        </body>
    `, { pretendToBeVisual: true });

    const { window } = dom;
    global.Element = window.Element;
    global.HTMLElement = window.HTMLElement;

    return {
        window,
        document: window.document,
        el: {
            notesList: window.document.getElementById('notesList'),
            notesSelectionSummary: window.document.getElementById('notesSelectionSummary'),
            topicNotesScopeBtn: window.document.getElementById('topicNotesScopeBtn'),
            agentNotesScopeBtn: window.document.getElementById('agentNotesScopeBtn'),
            newNoteBtn: window.document.getElementById('newNoteBtn'),
            newNoteFabBtn: window.document.getElementById('newNoteFabBtn'),
            notesStudioOpenBtn: window.document.getElementById('notesStudioOpenBtn'),
            manualNotesLibraryBtn: window.document.getElementById('manualNotesLibraryBtn'),
            saveNoteBtn: window.document.getElementById('saveNoteBtn'),
            deleteNoteBtn: window.document.getElementById('deleteNoteBtn'),
            analyzeNotesBtn: window.document.getElementById('analyzeNotesBtn'),
            generateQuizBtn: window.document.getElementById('generateQuizBtn'),
            generateFlashcardsBtn: window.document.getElementById('generateFlashcardsBtn'),
            analysisViewReportBtn: window.document.getElementById('analysisViewReportBtn'),
            analysisEditMarkdownBtn: window.document.getElementById('analysisEditMarkdownBtn'),
            quizViewPracticeBtn: window.document.getElementById('quizViewPracticeBtn'),
            quizEditSourceBtn: window.document.getElementById('quizEditSourceBtn'),
            noteDetailModal: window.document.getElementById('noteDetailModal'),
            noteDetailCloseBtn: window.document.getElementById('noteDetailCloseBtn'),
            noteDetailModalBackdrop: window.document.getElementById('noteDetailModalBackdrop'),
            noteActionMenu: window.document.getElementById('noteActionMenu'),
            manualNotesLibraryModal: window.document.getElementById('manualNotesLibraryModal'),
            manualNotesLibraryBackdrop: window.document.getElementById('manualNotesLibraryBackdrop'),
            manualNotesLibraryCloseBtn: window.document.getElementById('manualNotesLibraryCloseBtn'),
            manualNotesLibraryTitle: window.document.getElementById('manualNotesLibraryTitle'),
            manualNotesLibrarySubtitle: window.document.getElementById('manualNotesLibrarySubtitle'),
            manualNotesLibraryGrid: window.document.getElementById('manualNotesLibraryGrid'),
            noteTitleInput: window.document.getElementById('noteTitleInput'),
            noteContentInput: window.document.getElementById('noteContentInput'),
            noteMetaSummary: window.document.getElementById('noteMetaSummary'),
            noteDetailEyebrow: window.document.getElementById('noteDetailEyebrow'),
            noteDetailTitle: window.document.getElementById('noteDetailTitle'),
            noteDetailSubtitle: window.document.getElementById('noteDetailSubtitle'),
            analysisPreviewCard: window.document.getElementById('analysisPreviewCard'),
            analysisPreviewTitle: window.document.getElementById('analysisPreviewTitle'),
            analysisPreviewContent: window.document.getElementById('analysisPreviewContent'),
            analysisPreviewMeta: window.document.getElementById('analysisPreviewMeta'),
            noteEditorCard: window.document.getElementById('noteEditorCard'),
            flashcardsPracticeCard: window.document.getElementById('flashcardsPracticeCard'),
            quizPracticeCard: window.document.getElementById('quizPracticeCard'),
            quizPracticeTitle: window.document.getElementById('quizPracticeTitle'),
            quizPracticeSummary: window.document.getElementById('quizPracticeSummary'),
            quizPracticeProgress: window.document.getElementById('quizPracticeProgress'),
            quizPracticeQuestionIndex: window.document.getElementById('quizPracticeQuestionIndex'),
            quizPracticeStem: window.document.getElementById('quizPracticeStem'),
            quizPracticeOptions: window.document.getElementById('quizPracticeOptions'),
            quizPracticeFeedback: window.document.getElementById('quizPracticeFeedback'),
            quizPracticeResult: window.document.getElementById('quizPracticeResult'),
            quizPracticeAnswer: window.document.getElementById('quizPracticeAnswer'),
            quizPracticeExplanation: window.document.getElementById('quizPracticeExplanation'),
            quizPracticePrevBtn: window.document.getElementById('quizPracticePrevBtn'),
            quizPracticeNextBtn: window.document.getElementById('quizPracticeNextBtn'),
            chatMessages: window.document.getElementById('chatMessages'),
        },
    };
}

function createNotesControllerHarness(createNotesController, options = {}) {
    const { window, document, el } = createNotesDom();
    const store = createStore(createBaseState(options.stateOverrides));
    const toasts = [];
    const ui = {
        showToastNotification: (...args) => {
            toasts.push(args);
        },
        showConfirmDialog: async () => true,
    };
    const flashcardsApi = {
        activateNote: () => null,
        beginPendingGeneration: () => {},
        buildGeneratedFlashcardContent: () => null,
        clearPendingGeneration: () => {},
        getFlashcardSourceCount: () => 0,
        getPendingGeneration: () => null,
        hasStructuredFlashcards: () => false,
        openPractice: () => false,
        renderPractice: () => {},
        resetState: () => {},
        ...(options.flashcardsOverrides || {}),
    };
    const chatAPI = {
        listTopicNotes: async () => ({ success: true, items: [] }),
        listAgentNotes: async () => ({ success: true, items: [] }),
        retrieveKnowledgeBaseContext: async () => ({ success: false }),
        sendToVCP: async () => ({ response: { choices: [{ message: { content: 'fixture-response' } }] } }),
        saveTopicNote: async (_agentId, _topicId, payload) => ({
            success: true,
            item: {
                id: 'saved-note',
                agentId: 'agent-1',
                topicId: 'topic-1',
                title: payload.title,
                contentMarkdown: payload.contentMarkdown,
                sourceMessageIds: payload.sourceMessageIds,
                sourceDocumentRefs: payload.sourceDocumentRefs,
                kind: payload.kind,
            },
        }),
        ...(options.chatApiOverrides || {}),
    };

    const controller = createNotesController({
        store,
        el,
        chatAPI,
        ui,
        windowObj: window,
        documentObj: document,
        setSidePanelTab: () => {},
        setRightPanelMode: (mode) => {
            store.patchState('layout', { rightPanelMode: mode });
        },
        getCurrentTopic: () => ({ knowledgeBaseId: 'kb-1' }),
        getCurrentTopicDisplayName: () => '函数',
        persistHistory: async () => {},
        buildTopicContext: () => ({ topicId: store.getState().session.currentTopicId }),
        flashcardsApi,
        ...(options.depsOverrides || {}),
    });

    return {
        controller,
        store,
        chatAPI,
        ui,
        flashcardsApi,
        toasts,
        window,
        document,
        el,
    };
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
        '已选 2 条笔记 · 生成时优先使用这些内容'
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

test('manual and generated note filters split note kinds correctly', async () => {
    const {
        filterGeneratedNotes,
        filterManualNotes,
    } = await loadNotesUtilsModule();

    const notes = [
        { id: 'note-1', kind: 'note' },
        { id: 'note-2', kind: 'message-note' },
        { id: 'analysis-1', kind: 'analysis' },
        { id: 'quiz-1', kind: 'quiz' },
        { id: 'flash-1', kind: 'flashcards', flashcardDeck: { cards: [{ front: 'Q', back: 'A' }] } },
    ];

    assert.deepEqual(filterManualNotes(notes).map((note) => note.id), ['note-1', 'note-2']);
    assert.deepEqual(filterGeneratedNotes(notes).map((note) => note.id), ['analysis-1', 'quiz-1', 'flash-1']);
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
        },
        currentTopicId: 'topic-1',
        title: '函数测验',
        contentMarkdown: [
            '# 函数测验',
            '',
            '1. 导数的几何意义是什么？',
            'A. 曲线在该点的切线斜率',
            'B. 曲线与坐标轴围成的面积',
            'C. 函数的定义域',
            'D. 函数的最小值',
            '正确答案：A',
            '解析：导数描述函数在某点的瞬时变化率，对应切线斜率。',
        ].join('\n'),
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

test('notes refresh re-renders flashcard practice when the flashcards panel is active', async () => {
    const { createNotesController } = await loadNotesControllerModule();
    let renderPracticeCalls = 0;

    const { controller } = createNotesControllerHarness(createNotesController, {
        stateOverrides: {
            layout: {
                rightPanelMode: 'flashcards',
            },
        },
        chatApiOverrides: {
            listTopicNotes: async () => ({
                success: true,
                items: [{ id: 'topic-note-1', title: '话题笔记', contentMarkdown: '牛顿第二定律' }],
            }),
            listAgentNotes: async () => ({
                success: true,
                items: [{ id: 'agent-note-1', title: '学科笔记', contentMarkdown: '匀加速直线运动' }],
            }),
        },
        flashcardsOverrides: {
            renderPractice: () => {
                renderPracticeCalls += 1;
            },
        },
    });

    await controller.loadTopicNotes();
    await controller.loadAgentNotes();

    assert.equal(renderPracticeCalls, 2);
});

test('decorateChatMessages only shows favorite and note actions for assistant messages', async () => {
    const { createNotesController } = await loadNotesControllerModule();

    const { controller, el } = createNotesControllerHarness(createNotesController, {
        stateOverrides: {
            session: {
                currentChatHistory: [
                    { id: 'assistant-msg', role: 'assistant', content: '助手回复', favorited: false, noteRefs: [] },
                    { id: 'user-msg', role: 'user', content: '用户消息', favorited: false, noteRefs: [] },
                ],
            },
        },
    });

    el.chatMessages.innerHTML = `
        <div class="message-item assistant" data-message-id="assistant-msg">
            <div class="details-and-bubble-wrapper">
                <div class="md-content">助手回复</div>
            </div>
        </div>
        <div class="message-item user" data-message-id="user-msg">
            <div class="details-and-bubble-wrapper">
                <div class="md-content">用户消息</div>
            </div>
        </div>
    `;

    controller.decorateChatMessages();

    assert.equal(
        el.chatMessages.querySelector('.message-item.assistant .study-message-actions')?.children.length,
        2
    );
    assert.equal(
        el.chatMessages.querySelector('.message-item.user .study-message-actions'),
        null
    );
});

test('right-side notes panel only renders generated content kinds', async () => {
    const { createNotesController } = await loadNotesControllerModule();

    const { controller, el } = createNotesControllerHarness(createNotesController, {
        stateOverrides: {
            notes: {
                notesScope: 'agent',
                agentNotes: [
                    { id: 'note-1', title: '手写笔记', contentMarkdown: '普通内容', kind: 'note', topicId: 'topic-1' },
                    { id: 'analysis-1', title: '分析报告', contentMarkdown: '分析内容', kind: 'analysis', topicId: 'topic-1' },
                    { id: 'quiz-1', title: '选择题', contentMarkdown: '题目', kind: 'quiz', topicId: 'topic-1' },
                    {
                        id: 'flash-1',
                        title: '闪卡',
                        contentMarkdown: '卡片',
                        kind: 'flashcards',
                        topicId: 'topic-2',
                        flashcardDeck: { title: '闪卡', cards: [{ id: 'card-1', front: 'Q', back: 'A' }] },
                    },
                ],
            },
        },
    });

    controller.renderNotesPanel();

    const notesText = el.notesList.textContent;
    assert.match(notesText, /分析报告/);
    assert.match(notesText, /选择题/);
    assert.match(notesText, /闪卡/);
    assert.doesNotMatch(notesText, /手写笔记/);
});

test('manual notes library opens from the top button and only renders manual notes', async () => {
    const { createNotesController } = await loadNotesControllerModule();

    const { controller, el, store } = createNotesControllerHarness(createNotesController, {
        stateOverrides: {
            session: {
                topics: [
                    { id: 'topic-1', name: '函数' },
                    { id: 'topic-2', name: '极限' },
                ],
            },
            notes: {
                notesScope: 'agent',
                agentNotes: [
                    { id: 'note-1', title: '手写笔记 A', contentMarkdown: '普通内容 A', kind: 'note', topicId: 'topic-1' },
                    { id: 'message-note-1', title: '摘录笔记', contentMarkdown: '普通内容 B', kind: 'message-note', topicId: 'topic-2' },
                    { id: 'analysis-1', title: '分析报告', contentMarkdown: '分析内容', kind: 'analysis', topicId: 'topic-1' },
                ],
            },
        },
    });

    controller.bindEvents();
    el.manualNotesLibraryBtn.click();

    assert.equal(store.getState().notes.manualNotesLibraryOpen, true);
    assert.equal(el.manualNotesLibraryModal.classList.contains('hidden'), false);
    assert.match(el.manualNotesLibraryGrid.textContent, /手写笔记 A/);
    assert.match(el.manualNotesLibraryGrid.textContent, /摘录笔记/);
    assert.doesNotMatch(el.manualNotesLibraryGrid.textContent, /分析报告/);
    assert.match(el.manualNotesLibraryGrid.textContent, /函数/);
    assert.match(el.manualNotesLibraryGrid.textContent, /极限/);
});

test('manual notes library close button hides the modal and clears the open state', async () => {
    const { createNotesController } = await loadNotesControllerModule();

    const { controller, el, store } = createNotesControllerHarness(createNotesController, {
        stateOverrides: {
            notes: {
                agentNotes: [
                    { id: 'note-1', title: '手写笔记 A', contentMarkdown: '普通内容 A', kind: 'note', topicId: 'topic-1' },
                ],
            },
        },
    });

    controller.bindEvents();
    el.manualNotesLibraryBtn.click();
    el.manualNotesLibraryCloseBtn.click();

    assert.equal(store.getState().notes.manualNotesLibraryOpen, false);
    assert.equal(el.manualNotesLibraryModal.classList.contains('hidden'), true);
    assert.equal(el.manualNotesLibraryModal.getAttribute('aria-hidden'), 'true');
});

test('manual notes library can add a note into Studio selection directly from the card', async () => {
    const { createNotesController } = await loadNotesControllerModule();

    const { controller, el, store } = createNotesControllerHarness(createNotesController, {
        stateOverrides: {
            notes: {
                notesScope: 'topic',
                agentNotes: [
                    { id: 'note-1', title: '手写笔记 A', contentMarkdown: '普通内容 A', kind: 'note', topicId: 'topic-2' },
                ],
            },
        },
    });

    controller.bindEvents();
    el.manualNotesLibraryBtn.click();
    el.manualNotesLibraryGrid.querySelector('[data-manual-note-select="note-1"]').click();

    assert.deepEqual(store.getState().notes.selectedNoteIds, ['note-1']);
    assert.match(el.manualNotesLibrarySubtitle.textContent, /已选 1 条可直接用于 Studio/);
});

test('notes tool actions read endpoint settings from the settings slice before calling the upstream client', async () => {
    const { createNotesController } = await loadNotesControllerModule();
    let upstreamPayload = null;
    let resolveUpstreamCall;
    const upstreamCalled = new Promise((resolve) => {
        resolveUpstreamCall = resolve;
    });

    const { controller, el } = createNotesControllerHarness(createNotesController, {
        stateOverrides: {
            settings: {
                settings: {
                    vcpServerUrl: 'https://study.example.test/v1/chat',
                    vcpApiKey: 'fixture-api-key',
                },
            },
            notes: {
                topicNotes: [{
                    id: 'selected-note-1',
                    title: '已选笔记',
                    contentMarkdown: '极限与连续',
                    sourceMessageIds: ['msg-1'],
                    sourceDocumentRefs: ['doc-1'],
                }],
                selectedNoteIds: ['selected-note-1'],
            },
        },
        chatApiOverrides: {
            sendToVCP: async (payload) => {
                upstreamPayload = payload;
                resolveUpstreamCall();
                return {
                    response: {
                        choices: [{ message: { content: '这是一份生成后的分析结果。' } }],
                    },
                };
            },
            listTopicNotes: async () => ({
                success: true,
                items: [{
                    id: 'saved-note',
                    title: '分析报告',
                    contentMarkdown: '这是一份生成后的分析结果。',
                    kind: 'analysis',
                }],
            }),
            listAgentNotes: async () => ({ success: true, items: [] }),
        },
    });

    controller.bindEvents();
    el.analyzeNotesBtn.click();
    await upstreamCalled;
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(upstreamPayload.endpoint, 'https://study.example.test/v1/chat');
    assert.equal(upstreamPayload.apiKey, 'fixture-api-key');
});

test('notes tool actions can consume selected manual notes from the agent library even when topic scope is active', async () => {
    const { createNotesController } = await loadNotesControllerModule();
    let upstreamPayload = null;
    let resolveUpstreamCall;
    const upstreamCalled = new Promise((resolve) => {
        resolveUpstreamCall = resolve;
    });

    const { controller, el } = createNotesControllerHarness(createNotesController, {
        stateOverrides: {
            settings: {
                settings: {
                    vcpServerUrl: 'https://study.example.test/v1/chat',
                    vcpApiKey: 'fixture-api-key',
                },
            },
            notes: {
                notesScope: 'topic',
                topicNotes: [],
                agentNotes: [{
                    id: 'manual-note-1',
                    title: '跨话题手写笔记',
                    contentMarkdown: '这里是跨话题整理的重点内容。',
                    kind: 'note',
                    topicId: 'topic-2',
                }],
                selectedNoteIds: ['manual-note-1'],
            },
        },
        chatApiOverrides: {
            sendToVCP: async (payload) => {
                upstreamPayload = payload;
                resolveUpstreamCall();
                return {
                    response: {
                        choices: [{ message: { content: '这是一份生成后的分析结果。' } }],
                    },
                };
            },
            listTopicNotes: async () => ({ success: true, items: [] }),
            listAgentNotes: async () => ({
                success: true,
                items: [{
                    id: 'manual-note-1',
                    title: '跨话题手写笔记',
                    contentMarkdown: '这里是跨话题整理的重点内容。',
                    kind: 'note',
                    topicId: 'topic-2',
                }],
            }),
        },
    });

    controller.bindEvents();
    el.analyzeNotesBtn.click();
    await upstreamCalled;
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.match(upstreamPayload.messages[1].content, /跨话题手写笔记/);
    assert.match(upstreamPayload.messages[1].content, /这里是跨话题整理的重点内容/);
});
