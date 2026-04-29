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
                chatEndpoint: '',
                chatApiKey: '',
                studyToolDefaultModel: '',
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
            allAgentManualNotes: [],
            notesScope: 'topic',
            activeNoteId: null,
            selectedNoteIds: [],
            notesStudioView: 'overview',
            manualNotesLibraryOpen: false,
            manualNotesLibraryFilter: 'all',
            noteAnalysisWizard: {
                open: false,
                step: 1,
                title: '',
                subjectFilter: 'all',
                selectedNoteIds: [],
                guidance: '',
                generating: false,
                savedNote: null,
                error: '',
            },
            noteDetailKind: null,
            noteDetailMode: 'edit',
            activeNoteMenu: null,
            activeFlashcardNoteId: null,
            pendingFlashcardGeneration: null,
            pendingFlashcardGenerations: [],
            pendingQuizGenerations: [],
            pendingAnalysisGenerations: [],
            flashcardGenerationConfig: {
                countPreset: 'standard',
                cardCount: 12,
                difficulty: 'medium',
                focus: '',
                includeChatContext: false,
            },
            quizGenerationConfig: {
                countPreset: 'standard',
                questionCount: 8,
                difficulty: 'medium',
                focus: '',
                includeChatContext: false,
            },
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

function buildQuizResponse(title = '函数测验') {
    return JSON.stringify({
        title,
        items: [{
            id: 'quiz_1',
            stem: '函数连续性的核心判断是什么？',
            options: [
                { id: 'option_a', label: 'A', text: '函数值与极限一致' },
                { id: 'option_b', label: 'B', text: '函数一定单调递增' },
                { id: 'option_c', label: 'C', text: '函数没有定义域' },
                { id: 'option_d', label: 'D', text: '函数图像必须为直线' },
            ],
            correctOptionId: 'option_a',
            explanation: '连续要求该点函数值等于该点极限。',
        }],
    });
}

function buildFlashcardResponse(title = '函数闪卡') {
    return JSON.stringify({
        title,
        cards: [
            { id: 'card-1', front: '连续', back: '函数值等于极限' },
            { id: 'card-2', front: '导数', back: '瞬时变化率' },
        ],
    });
}

function createNotesDom() {
    const dom = new JSDOM(`
        <body>
            <div id="notesList"></div>
            <div id="notesSelectionSummary"></div>
            <button id="topicNotesScopeBtn"></button>
            <button id="agentNotesScopeBtn"></button>
            <button id="manualNewNoteBtn"></button>
            <button id="notesStudioOpenBtn"></button>
            <button id="manualNotesLibraryBtn"></button>
            <button id="saveNoteBtn"></button>
            <button id="deleteNoteBtn"></button>
            <button id="analyzeNotesBtn"></button>
            <button id="generateQuizBtn"></button>
            <div id="quizConfigModal" class="hidden" aria-hidden="true"></div>
            <div id="quizConfigModalBackdrop"></div>
            <button id="quizConfigCloseBtn"></button>
            <button id="quizConfigCancelBtn"></button>
            <button id="quizConfigGenerateBtn"></button>
            <textarea id="quizFocusInput"></textarea>
            <input id="quizIncludeChatContextInput" type="checkbox" />
            <button data-quiz-count-preset="less" data-question-count="5"></button>
            <button data-quiz-count-preset="standard" data-question-count="8"></button>
            <button data-quiz-count-preset="more" data-question-count="12"></button>
            <button data-quiz-difficulty="easy"></button>
            <button data-quiz-difficulty="medium"></button>
            <button data-quiz-difficulty="hard"></button>
            <button id="generateFlashcardsBtn"></button>
            <div id="flashcardConfigModal" class="hidden" aria-hidden="true"></div>
            <div id="flashcardConfigModalBackdrop"></div>
            <button id="flashcardConfigCloseBtn"></button>
            <button id="flashcardConfigCancelBtn"></button>
            <button id="flashcardConfigGenerateBtn"></button>
            <textarea id="flashcardFocusInput"></textarea>
            <input id="flashcardIncludeChatContextInput" type="checkbox" />
            <button data-flashcard-count-preset="less" data-card-count="8"></button>
            <button data-flashcard-count-preset="standard" data-card-count="12"></button>
            <button data-flashcard-count-preset="more" data-card-count="18"></button>
            <button data-flashcard-difficulty="easy"></button>
            <button data-flashcard-difficulty="medium"></button>
            <button data-flashcard-difficulty="hard"></button>
            <button id="analysisViewReportBtn"></button>
            <button id="analysisEditMarkdownBtn"></button>
            <button id="quizViewPracticeBtn"></button>
            <button id="quizEditSourceBtn"></button>
            <div id="noteDetailModal" class="hidden"></div>
            <button id="flashcardsBackToNotesBtn">返回 Studio</button>
            <button id="noteDetailCloseBtn"></button>
            <div id="noteDetailModalBackdrop"></div>
            <div id="noteActionMenu"></div>
            <div id="noteAnalysisModal" class="hidden" aria-hidden="true"></div>
            <div id="noteAnalysisModalBackdrop"></div>
            <button id="noteAnalysisCloseBtn"></button>
            <div id="noteAnalysisModalTitle"></div>
            <div id="noteAnalysisModalSubtitle"></div>
            <div id="noteAnalysisStepIndicator"></div>
            <div id="noteAnalysisBody"></div>
            <button id="noteAnalysisCancelBtn"></button>
            <button id="noteAnalysisPrevBtn"></button>
            <button id="noteAnalysisNextBtn"></button>
            <button id="noteAnalysisGenerateBtn"></button>
            <button id="noteAnalysisOpenReportBtn"></button>
            <div id="manualNotesLibraryModal" class="hidden"></div>
            <div id="manualNotesLibraryBackdrop"></div>
            <button id="manualNotesLibraryCloseBtn"></button>
            <div id="manualNotesLibraryTitle"></div>
            <div id="manualNotesLibrarySubtitle"></div>
            <button id="manualNotesLibrarySubjectToggle"></button>
            <div id="manualNotesLibrarySubjectTabsWrapper">
                <div id="manualNotesLibrarySubjectTabs"></div>
            </div>
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
            <div id="noteMarkdownPreviewCard"></div>
            <div id="noteMarkdownPreviewTitle"></div>
            <div id="noteMarkdownPreviewContent"></div>
            <div id="noteMarkdownPreviewMeta"></div>
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
            manualNewNoteBtn: window.document.getElementById('manualNewNoteBtn'),
            notesStudioOpenBtn: window.document.getElementById('notesStudioOpenBtn'),
            manualNotesLibraryBtn: window.document.getElementById('manualNotesLibraryBtn'),
            saveNoteBtn: window.document.getElementById('saveNoteBtn'),
            deleteNoteBtn: window.document.getElementById('deleteNoteBtn'),
            analyzeNotesBtn: window.document.getElementById('analyzeNotesBtn'),
            generateQuizBtn: window.document.getElementById('generateQuizBtn'),
            quizConfigModal: window.document.getElementById('quizConfigModal'),
            quizConfigModalBackdrop: window.document.getElementById('quizConfigModalBackdrop'),
            quizConfigCloseBtn: window.document.getElementById('quizConfigCloseBtn'),
            quizConfigCancelBtn: window.document.getElementById('quizConfigCancelBtn'),
            quizConfigGenerateBtn: window.document.getElementById('quizConfigGenerateBtn'),
            quizFocusInput: window.document.getElementById('quizFocusInput'),
            quizIncludeChatContextInput: window.document.getElementById('quizIncludeChatContextInput'),
            quizCountPresetBtns: window.document.querySelectorAll('[data-quiz-count-preset]'),
            quizDifficultyBtns: window.document.querySelectorAll('[data-quiz-difficulty]'),
            generateFlashcardsBtn: window.document.getElementById('generateFlashcardsBtn'),
            flashcardConfigModal: window.document.getElementById('flashcardConfigModal'),
            flashcardConfigModalBackdrop: window.document.getElementById('flashcardConfigModalBackdrop'),
            flashcardConfigCloseBtn: window.document.getElementById('flashcardConfigCloseBtn'),
            flashcardConfigCancelBtn: window.document.getElementById('flashcardConfigCancelBtn'),
            flashcardConfigGenerateBtn: window.document.getElementById('flashcardConfigGenerateBtn'),
            flashcardFocusInput: window.document.getElementById('flashcardFocusInput'),
            flashcardIncludeChatContextInput: window.document.getElementById('flashcardIncludeChatContextInput'),
            flashcardCountPresetBtns: window.document.querySelectorAll('[data-flashcard-count-preset]'),
            flashcardDifficultyBtns: window.document.querySelectorAll('[data-flashcard-difficulty]'),
            analysisViewReportBtn: window.document.getElementById('analysisViewReportBtn'),
            analysisEditMarkdownBtn: window.document.getElementById('analysisEditMarkdownBtn'),
            quizViewPracticeBtn: window.document.getElementById('quizViewPracticeBtn'),
            quizEditSourceBtn: window.document.getElementById('quizEditSourceBtn'),
            noteDetailModal: window.document.getElementById('noteDetailModal'),
            noteDetailBackBtn: window.document.getElementById('flashcardsBackToNotesBtn'),
            flashcardsBackToNotesBtn: window.document.getElementById('flashcardsBackToNotesBtn'),
            noteDetailCloseBtn: window.document.getElementById('noteDetailCloseBtn'),
            noteDetailModalBackdrop: window.document.getElementById('noteDetailModalBackdrop'),
            noteActionMenu: window.document.getElementById('noteActionMenu'),
            noteAnalysisModal: window.document.getElementById('noteAnalysisModal'),
            noteAnalysisModalBackdrop: window.document.getElementById('noteAnalysisModalBackdrop'),
            noteAnalysisCloseBtn: window.document.getElementById('noteAnalysisCloseBtn'),
            noteAnalysisModalTitle: window.document.getElementById('noteAnalysisModalTitle'),
            noteAnalysisModalSubtitle: window.document.getElementById('noteAnalysisModalSubtitle'),
            noteAnalysisStepIndicator: window.document.getElementById('noteAnalysisStepIndicator'),
            noteAnalysisBody: window.document.getElementById('noteAnalysisBody'),
            noteAnalysisCancelBtn: window.document.getElementById('noteAnalysisCancelBtn'),
            noteAnalysisPrevBtn: window.document.getElementById('noteAnalysisPrevBtn'),
            noteAnalysisNextBtn: window.document.getElementById('noteAnalysisNextBtn'),
            noteAnalysisGenerateBtn: window.document.getElementById('noteAnalysisGenerateBtn'),
            noteAnalysisOpenReportBtn: window.document.getElementById('noteAnalysisOpenReportBtn'),
            manualNotesLibraryModal: window.document.getElementById('manualNotesLibraryModal'),
            manualNotesLibraryBackdrop: window.document.getElementById('manualNotesLibraryBackdrop'),
            manualNotesLibraryCloseBtn: window.document.getElementById('manualNotesLibraryCloseBtn'),
            manualNotesLibraryTitle: window.document.getElementById('manualNotesLibraryTitle'),
            manualNotesLibrarySubtitle: window.document.getElementById('manualNotesLibrarySubtitle'),
            manualNotesLibrarySubjectToggle: window.document.getElementById('manualNotesLibrarySubjectToggle'),
            manualNotesLibrarySubjectTabsWrapper: window.document.getElementById('manualNotesLibrarySubjectTabsWrapper'),
            manualNotesLibrarySubjectTabs: window.document.getElementById('manualNotesLibrarySubjectTabs'),
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
            noteMarkdownPreviewCard: window.document.getElementById('noteMarkdownPreviewCard'),
            noteMarkdownPreviewTitle: window.document.getElementById('noteMarkdownPreviewTitle'),
            noteMarkdownPreviewContent: window.document.getElementById('noteMarkdownPreviewContent'),
            noteMarkdownPreviewMeta: window.document.getElementById('noteMarkdownPreviewMeta'),
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
    let idCounter = 0;
    const ui = {
        showToastNotification: (...args) => {
            toasts.push(args);
        },
        showConfirmDialog: async () => true,
    };
    let controller = null;
    const getPendingFlashcardGenerations = () => {
        const pending = store.getState().notes.pendingFlashcardGenerations;
        if (Array.isArray(pending) && pending.length > 0) {
            return pending;
        }
        const legacyPending = store.getState().notes.pendingFlashcardGeneration;
        return legacyPending ? [legacyPending] : [];
    };
    const setPendingFlashcardGenerations = (pending) => {
        store.patchState('notes', (current) => ({
            ...current,
            pendingFlashcardGenerations: pending,
            pendingFlashcardGeneration: pending[0] || null,
        }));
    };
    const flashcardsApi = {
        activateNote: (note) => {
            store.patchState('notes', {
                activeFlashcardNoteId: note?.id || null,
                activeNoteId: null,
            });
            store.patchState('layout', { rightPanelMode: 'flashcards' });
            return note || null;
        },
        beginPendingGeneration: (payload = {}) => {
            const requestId = String(payload.requestId || `flashcards_${Date.now()}`);
            const pending = {
                requestId,
                agentId: String(payload.agentId || ''),
                topicId: String(payload.topicId || ''),
                title: String(payload.title || '闪卡生成中'),
                cardCount: Number(payload.cardCount || 0),
                difficulty: String(payload.difficulty || 'medium'),
                sourceCount: Number(payload.sourceCount || 0),
                focus: String(payload.focus || ''),
                startedAt: Number(payload.startedAt || Date.now()),
            };
            setPendingFlashcardGenerations([
                ...getPendingFlashcardGenerations().filter((item) => item?.requestId !== requestId),
                pending,
            ]);
            store.patchState('layout', { rightPanelMode: 'notes' });
            controller?.renderNotesPanel();
        },
        buildGeneratedFlashcardContent: (responseText, fallbackTitle, fallbackRefs = []) => {
            let payload = null;
            try {
                payload = JSON.parse(String(responseText || ''));
            } catch {
                return null;
            }
            const cards = Array.isArray(payload?.cards)
                ? payload.cards
                    .map((card, index) => ({
                        id: String(card?.id || `card-${index + 1}`),
                        front: String(card?.front || '').trim(),
                        back: String(card?.back || '').trim(),
                        sourceDocumentRefs: Array.isArray(card?.sourceDocumentRefs)
                            ? card.sourceDocumentRefs
                            : fallbackRefs,
                    }))
                    .filter((card) => card.front && card.back)
                : [];
            if (cards.length === 0) {
                return null;
            }
            const flashcardDeck = {
                title: String(payload.title || fallbackTitle || '闪卡集合'),
                cards,
            };
            return {
                flashcardDeck,
                flashcardProgress: {
                    currentIndex: 0,
                    flipped: false,
                    cardStates: cards.map((card) => ({ cardId: card.id, result: null, updatedAt: 0 })),
                    knownCount: 0,
                    unknownCount: 0,
                },
                contentMarkdown: `# ${flashcardDeck.title}`,
            };
        },
        clearPendingGeneration: (requestId = '') => {
            const normalizedRequestId = String(requestId || '');
            const nextPending = normalizedRequestId
                ? getPendingFlashcardGenerations().filter((item) => item?.requestId !== normalizedRequestId)
                : [];
            setPendingFlashcardGenerations(nextPending);
            controller?.renderNotesPanel();
        },
        getFlashcardSourceCount: () => 0,
        getPendingGenerations: () => getPendingFlashcardGenerations(),
        getPendingGeneration: () => getPendingFlashcardGenerations()[0] || null,
        hasStructuredFlashcards: (note) => Array.isArray(note?.flashcardDeck?.cards) && note.flashcardDeck.cards.length > 0,
        openPractice: (note, practiceOptions = {}) => {
            controller?.openNoteDetail(note, { ...practiceOptions, kind: 'flashcards' });
            return true;
        },
        renderPractice: () => {},
        resetState: (resetOptions = {}) => {
            if (resetOptions.clearPending !== false) {
                setPendingFlashcardGenerations([]);
            }
            if (resetOptions.clearActive !== false) {
                store.patchState('notes', { activeFlashcardNoteId: null });
            }
        },
        updatePendingGeneration: (requestId, patch = {}) => {
            const normalizedRequestId = String(requestId || '');
            setPendingFlashcardGenerations(getPendingFlashcardGenerations().map((item) => (
                item?.requestId === normalizedRequestId
                    ? { ...item, ...patch }
                    : item
            )));
            controller?.renderNotesPanel();
        },
        ...(options.flashcardsOverrides || {}),
    };
    const chatAPI = {
        listTopicNotes: async () => ({ success: true, items: [] }),
        listAgentNotes: async () => ({ success: true, items: [] }),
        retrieveKnowledgeBaseContext: async () => ({ success: false }),
        sendChatRequest: async () => ({ response: { choices: [{ message: { content: 'fixture-response' } }] } }),
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
                quizSet: payload.quizSet,
                flashcardDeck: payload.flashcardDeck,
                flashcardProgress: payload.flashcardProgress,
            },
        }),
        ...(options.chatApiOverrides || {}),
    };

    controller = createNotesController({
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
        createId: (prefix) => `${prefix}_${++idCounter}`,
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

test('decorateChatMessages no longer renders inline note actions on chat bubbles', async () => {
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
        el.chatMessages.querySelector('.message-item.assistant .study-message-actions'),
        null
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

test('generated quiz cards use the same compact card shape as flashcards', async () => {
    const { createNotesController } = await loadNotesControllerModule();
    const quizTitle = 'DeepSeek最新模型基础测验';
    const firstStem = 'DeepSeek最新发布的 V3 模型的总参数量是多少？';

    const { controller, el } = createNotesControllerHarness(createNotesController, {
        stateOverrides: {
            notes: {
                topicNotes: [{
                    id: 'quiz-card-1',
                    title: quizTitle,
                    contentMarkdown: [
                        `# ${quizTitle}`,
                        '',
                        `## 1. ${firstStem}`,
                        'A. 671B',
                        'B. 7B',
                        'C. 13B',
                        'D. 70B',
                        '正确答案：A',
                        '解析：材料提到 DeepSeek-V3 为 671B 总参数。',
                    ].join('\n'),
                    kind: 'quiz',
                    topicId: 'topic-1',
                    quizSet: {
                        title: quizTitle,
                        items: [{
                            id: 'quiz_1',
                            stem: firstStem,
                            options: [
                                { id: 'option_a', label: 'A', text: '671B' },
                                { id: 'option_b', label: 'B', text: '7B' },
                                { id: 'option_c', label: 'C', text: '13B' },
                                { id: 'option_d', label: 'D', text: '70B' },
                            ],
                            correctOptionId: 'option_a',
                            explanation: '材料提到 DeepSeek-V3 为 671B 总参数。',
                        }],
                    },
                }],
            },
        },
    });

    controller.renderNotesPanel();

    const card = el.notesList.querySelector('.note-card--studio');
    const preview = card?.querySelector('.note-card__studio-preview');
    const title = card?.querySelector('.note-card__generated-title');
    const meta = card?.querySelector('.note-card__generated-meta');
    const menuButton = card?.querySelector('.note-card__menu-button');
    assert.ok(card);
    assert.equal(card.classList.contains('note-card--generated-entry'), true);
    assert.equal(card.classList.contains('note-card--flashcard-entry'), false);
    assert.equal(preview, null);
    assert.ok(title);
    assert.ok(meta);
    assert.ok(menuButton);
    assert.equal(title.textContent, quizTitle);
    assert.match(meta.textContent, /1 道题/);
    assert.doesNotMatch(card.textContent, new RegExp(firstStem.replace(/[？?]/g, '[？?]')));
    assert.doesNotMatch(card.textContent, /解析/);
    assert.equal(menuButton.parentElement, card.querySelector('.note-card__studio-main'));
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
    assert.match(el.manualNotesLibraryGrid.textContent, /普通内容 A/);
    assert.match(el.manualNotesLibraryGrid.textContent, /普通内容 B/);
    assert.doesNotMatch(el.manualNotesLibraryGrid.textContent, /手写笔记 A/);
    assert.doesNotMatch(el.manualNotesLibraryGrid.textContent, /摘录笔记/);
    assert.doesNotMatch(el.manualNotesLibraryGrid.textContent, /分析报告/);
    assert.match(el.manualNotesLibraryGrid.textContent, /函数/);
    assert.match(el.manualNotesLibraryGrid.textContent, /极限/);
    assert.equal(el.manualNotesLibraryGrid.querySelector('[data-manual-note-select]'), null);
    assert.equal(el.manualNotesLibraryGrid.querySelector('[data-note-menu]'), null);
});

test('manual notes library keeps rich previews mounted during lightweight controls', async () => {
    const { createNotesController } = await loadNotesControllerModule();
    const mountCalls = [];
    const richRenderer = {
        cleanupNotePreviewMount() {},
        mountRichNotePreview(target, note, options) {
            mountCalls.push({
                noteId: note.id,
                forceRemount: options.forceRemount === true,
            });
            target.innerHTML = `<div class="rich-bubble" data-rich-note="${note.id}">${note.contentMarkdown}</div>`;
            target.classList.add('unistudy-note-rich-preview');
        },
    };

    const { controller, el } = createNotesControllerHarness(createNotesController, {
        stateOverrides: {
            notes: {
                agentNotes: [
                    { id: 'note-1', title: '手写笔记 A', contentMarkdown: '普通内容 A', kind: 'note', topicId: 'topic-1' },
                    { id: 'note-2', title: '手写笔记 B', contentMarkdown: '普通内容 B', kind: 'note', topicId: 'topic-2' },
                ],
            },
        },
        depsOverrides: {
            messageRendererApi: richRenderer,
        },
    });

    controller.bindEvents();
    controller.renderManualNotesLibrary({ forcePreviewRemount: true });
    const firstCard = el.manualNotesLibraryGrid.querySelector('.manual-note-card');
    const firstPreviewBubble = firstCard.querySelector('.rich-bubble');

    assert.equal(mountCalls.length, 2);
    assert.equal(mountCalls.every((call) => call.forceRemount), true);

    el.manualNotesLibrarySubjectToggle.click();

    assert.equal(mountCalls.length, 2);
    assert.strictEqual(el.manualNotesLibraryGrid.querySelector('.manual-note-card'), firstCard);
    assert.strictEqual(firstCard.querySelector('.rich-bubble'), firstPreviewBubble);

    controller.renderManualNotesLibrary({ forcePreviewRemount: true });

    assert.equal(mountCalls.length, 4);
});

test('manual notes library exposes a deep analysis tab that only renders analysis notes', async () => {
    const { createNotesController } = await loadNotesControllerModule();

    const { controller, el, store } = createNotesControllerHarness(createNotesController, {
        stateOverrides: {
            session: {
                agents: [
                    { id: 'agent-1', name: '数学' },
                    { id: 'agent-2', name: '物理' },
                ],
                topics: [
                    { id: 'topic-1', name: '函数' },
                    { id: 'topic-2', name: '力学' },
                ],
            },
            notes: {
                allAgentManualNotes: [
                    { id: 'note-1', title: '手写笔记 A', contentMarkdown: '普通内容 A', kind: 'note', agentId: 'agent-1', topicId: 'topic-1' },
                    { id: 'analysis-1', title: '分析报告', contentMarkdown: '分析内容', kind: 'analysis', agentId: 'agent-2', topicId: 'topic-2' },
                ],
            },
        },
    });

    controller.bindEvents();
    controller.renderManualNotesLibrary();

    const subjectTabsText = el.manualNotesLibrarySubjectTabs.textContent;
    assert.match(subjectTabsText, /深度分析/);
    assert.match(subjectTabsText, /数学/);
    assert.doesNotMatch(subjectTabsText, /物理/);
    assert.match(el.manualNotesLibraryGrid.textContent, /普通内容 A/);
    assert.doesNotMatch(el.manualNotesLibraryGrid.textContent, /分析内容/);

    el.manualNotesLibrarySubjectTabs.querySelector('[data-subject-filter="analysis"]').click();

    assert.equal(store.getState().notes.manualNotesLibraryFilter, 'analysis');
    assert.match(el.manualNotesLibraryGrid.textContent, /分析内容/);
    assert.match(el.manualNotesLibraryGrid.textContent, /物理/);
    assert.doesNotMatch(el.manualNotesLibraryGrid.textContent, /普通内容 A/);
});

test('manual notes library resets subject filters that no longer have manual notes', async () => {
    const { createNotesController } = await loadNotesControllerModule();

    const { controller, el, store } = createNotesControllerHarness(createNotesController, {
        stateOverrides: {
            session: {
                agents: [
                    { id: 'agent-1', name: '数学' },
                    { id: 'agent-2', name: '物理' },
                ],
            },
            notes: {
                manualNotesLibraryFilter: 'agent-2',
                allAgentManualNotes: [
                    { id: 'note-1', title: '手写笔记 A', contentMarkdown: '普通内容 A', kind: 'note', agentId: 'agent-1', topicId: 'topic-1' },
                    { id: 'analysis-1', title: '分析报告', contentMarkdown: '分析内容', kind: 'analysis', agentId: 'agent-2', topicId: 'topic-2' },
                ],
            },
        },
    });

    controller.renderManualNotesLibrary();

    assert.equal(store.getState().notes.manualNotesLibraryFilter, 'all');
    assert.match(el.manualNotesLibrarySubjectTabs.textContent, /数学/);
    assert.doesNotMatch(el.manualNotesLibrarySubjectTabs.textContent, /物理/);
    assert.match(el.manualNotesLibraryGrid.textContent, /普通内容 A/);
    assert.doesNotMatch(el.manualNotesLibraryGrid.textContent, /分析内容/);
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

test('note detail opened from manual notes returns to the manual notes library', async () => {
    const { createNotesController } = await loadNotesControllerModule();

    const { controller, el, store, window } = createNotesControllerHarness(createNotesController, {
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
    const card = el.manualNotesLibraryGrid.querySelector('.manual-note-card');
    card.click();

    assert.equal(store.getState().notes.manualNotesLibraryOpen, true);
    assert.equal(el.manualNotesLibraryModal.classList.contains('hidden'), false);
    assert.equal(el.noteDetailModal.classList.contains('hidden'), false);
    assert.match(el.noteDetailBackBtn.textContent, /返回我的笔记/);

    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    assert.equal(el.noteDetailModal.classList.contains('hidden'), true);
    assert.equal(store.getState().notes.manualNotesLibraryOpen, true);
    assert.equal(el.manualNotesLibraryModal.classList.contains('hidden'), false);
    assert.equal(store.getState().layout.workspaceViewMode, 'manual-notes');
});

test('manual notes library can add a note into Studio selection from the right-click menu', async () => {
    const { createNotesController } = await loadNotesControllerModule();

    const { controller, el, store, window } = createNotesControllerHarness(createNotesController, {
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
    const card = el.manualNotesLibraryGrid.querySelector('.manual-note-card');
    card.dispatchEvent(new window.MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 120,
        clientY: 120,
    }));
    el.noteActionMenu.querySelector('[data-note-action="toggle-select"]').click();

    assert.deepEqual(store.getState().notes.selectedNoteIds, ['note-1']);
    assert.match(el.manualNotesLibrarySubtitle.textContent, /已选 1 条/);
});

test('right-side analysis tile now creates a blank note instead of calling the model', async () => {
    const { createNotesController } = await loadNotesControllerModule();
    let sendCallCount = 0;

    const { controller, el } = createNotesControllerHarness(createNotesController, {
        chatApiOverrides: {
            sendChatRequest: async () => {
                sendCallCount += 1;
                return { response: { choices: [{ message: { content: 'should-not-run' } }] } };
            },
        },
    });

    controller.bindEvents();
    el.analyzeNotesBtn.click();

    assert.equal(sendCallCount, 0);
    assert.equal(el.noteDetailModal.classList.contains('hidden'), false);
    assert.match(el.noteTitleInput.value, /函数/);
});

test('notes analysis wizard shows numbered steps and the notes analysis save location', async () => {
    const { createNotesController } = await loadNotesControllerModule();

    const { controller, el } = createNotesControllerHarness(createNotesController, {
        stateOverrides: {
            session: {
                currentSelectedItem: {
                    id: 'agent-1',
                    name: '展示案例',
                },
            },
        },
    });

    controller.bindEvents();
    el.manualNewNoteBtn.click();

    assert.match(el.noteAnalysisStepIndicator.textContent, /1\s*基本设置/);
    assert.match(el.noteAnalysisStepIndicator.textContent, /2\s*选择笔记/);
    assert.match(el.noteAnalysisStepIndicator.textContent, /3\s*设置指引/);
    assert.match(el.noteAnalysisStepIndicator.textContent, /4\s*创建中/);
    assert.match(el.noteAnalysisBody.textContent, /我的笔记\s*\/\s*深度分析/);
    assert.doesNotMatch(el.noteAnalysisBody.textContent, /展示案例\s*\/\s*函数/);
});

test('notes analysis wizard uses rich square note previews in the selection step', async () => {
    const { createNotesController } = await loadNotesControllerModule();
    const mountCalls = [];
    const manualNote = {
        id: 'manual-note-1',
        title: '课堂笔记',
        contentMarkdown: '# 完整预览\n\n这里是需要像笔记页一样展示的内容。',
        kind: 'note',
        agentId: 'agent-1',
        topicId: 'topic-1',
    };
    const secondManualNote = {
        id: 'manual-note-2',
        title: '另一条课堂笔记',
        contentMarkdown: '# 不应重复入场\n\n勾选旁边卡片时，这里不能重新挂载。',
        kind: 'note',
        agentId: 'agent-1',
        topicId: 'topic-1',
    };

    const { controller, el } = createNotesControllerHarness(createNotesController, {
        stateOverrides: {
            notes: {
                agentNotes: [manualNote, secondManualNote],
            },
        },
        depsOverrides: {
            messageRendererApi: {
                cleanupNotePreviewMount() {},
                mountRichNotePreview(target, note, options) {
                    mountCalls.push({
                        noteId: note.id,
                        compact: options.compact === true,
                    });
                    target.innerHTML = `<div class="rich-bubble">${note.contentMarkdown}</div>`;
                    target.classList.add('unistudy-note-rich-preview');
                },
            },
        },
        chatApiOverrides: {
            listAgentNotes: async () => ({ success: true, items: [manualNote, secondManualNote] }),
        },
    });

    controller.bindEvents();
    el.manualNewNoteBtn.click();
    el.noteAnalysisNextBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const card = el.noteAnalysisBody.querySelector('.note-analysis-note-card');
    const preview = el.noteAnalysisBody.querySelector('[data-note-analysis-preview="manual-note-1"]');
    const secondPreview = el.noteAnalysisBody.querySelector('[data-note-analysis-preview="manual-note-2"]');
    const mountCountAfterInitialRender = mountCalls.length;
    assert.ok(card);
    assert.ok(preview);
    assert.ok(secondPreview);
    assert.equal(preview.classList.contains('manual-note-card__preview'), true);
    assert.equal(preview.classList.contains('unistudy-note-rich-preview'), true);
    assert.equal(mountCalls.some((call) => call.noteId === 'manual-note-1' && call.compact), true);
    assert.match(preview.textContent, /完整预览/);

    card.click();

    assert.equal(mountCalls.length, mountCountAfterInitialRender);
    assert.strictEqual(el.noteAnalysisBody.querySelector('[data-note-analysis-preview="manual-note-1"]'), preview);
    assert.strictEqual(el.noteAnalysisBody.querySelector('[data-note-analysis-preview="manual-note-2"]'), secondPreview);
    assert.match(el.noteAnalysisBody.textContent, /选择笔记 \(1 \/ 10\)/);
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
                    chatEndpoint: 'https://study.example.test/v1/chat',
                    chatApiKey: 'fixture-api-key',
                    studyToolDefaultModel: 'settings-study-tool-model',
                },
            },
            notes: {
                agentNotes: [{
                    id: 'selected-note-1',
                    title: '已选笔记',
                    contentMarkdown: '极限与连续',
                    kind: 'note',
                    topicId: 'topic-1',
                    sourceMessageIds: ['msg-1'],
                    sourceDocumentRefs: ['doc-1'],
                }],
                selectedNoteIds: ['selected-note-1'],
            },
        },
        chatApiOverrides: {
            sendChatRequest: async (payload) => {
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
    el.manualNewNoteBtn.click();
    assert.equal(el.noteAnalysisModal.classList.contains('hidden'), false);
    el.noteAnalysisNextBtn.click();
    el.noteAnalysisNextBtn.click();
    const guidanceInput = el.noteAnalysisBody.querySelector('#noteAnalysisGuidanceInput');
    guidanceInput.value = '重点分析可迁移的方法。';
    guidanceInput.dispatchEvent(new el.noteAnalysisBody.ownerDocument.defaultView.Event('input', { bubbles: true }));
    el.noteAnalysisGenerateBtn.click();
    await upstreamCalled;
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(upstreamPayload.endpoint, 'https://study.example.test/v1/chat');
    assert.equal(upstreamPayload.apiKey, 'fixture-api-key');
    assert.equal(upstreamPayload.modelConfig.purpose, 'studyTool');
    assert.equal(upstreamPayload.modelConfig.model, 'settings-study-tool-model');
    assert.match(upstreamPayload.messages[1].content, /重点分析可迁移的方法/);
    assert.match(upstreamPayload.messages[1].content, /## 4\. 跨话题\/跨学科迁移/);
});

test('notes analysis wizard switches to the analysis tab with a pending placeholder until saved', async () => {
    const { createNotesController } = await loadNotesControllerModule();
    const manualNote = {
        id: 'selected-note-1',
        title: '已选笔记',
        contentMarkdown: '极限与连续',
        kind: 'note',
        agentId: 'agent-1',
        topicId: 'topic-1',
    };
    let upstreamPayload = null;
    let resolveUpstreamCall;
    let resolveResponse;
    let savedAnalysis = null;
    const upstreamCalled = new Promise((resolve) => {
        resolveUpstreamCall = resolve;
    });
    const responseReady = new Promise((resolve) => {
        resolveResponse = resolve;
    });

    const { controller, el, store } = createNotesControllerHarness(createNotesController, {
        stateOverrides: {
            notes: {
                agentNotes: [manualNote],
                selectedNoteIds: ['selected-note-1'],
            },
        },
        chatApiOverrides: {
            sendChatRequest: async (payload) => {
                upstreamPayload = payload;
                resolveUpstreamCall();
                return responseReady;
            },
            saveTopicNote: async (_agentId, _topicId, payload) => {
                savedAnalysis = {
                    id: 'saved-analysis',
                    agentId: 'agent-1',
                    topicId: 'topic-1',
                    title: payload.title,
                    contentMarkdown: payload.contentMarkdown,
                    kind: payload.kind,
                };
                return { success: true, item: savedAnalysis };
            },
            listAgentNotes: async () => ({ success: true, items: savedAnalysis ? [manualNote, savedAnalysis] : [manualNote] }),
            listTopicNotes: async () => ({ success: true, items: savedAnalysis ? [manualNote, savedAnalysis] : [manualNote] }),
        },
    });

    controller.bindEvents();
    el.manualNewNoteBtn.click();
    el.noteAnalysisNextBtn.click();
    el.noteAnalysisNextBtn.click();
    el.noteAnalysisGenerateBtn.click();

    assert.equal(store.getState().notes.manualNotesLibraryOpen, true);
    assert.equal(store.getState().notes.manualNotesLibraryFilter, 'analysis');
    assert.equal(el.noteAnalysisModal.classList.contains('hidden'), true);
    assert.match(el.manualNotesLibraryGrid.textContent, /正在生成深度分析/);
    assert.match(el.manualNotesLibraryGrid.textContent, /1 条笔记/);

    await upstreamCalled;
    assert.equal(upstreamPayload.modelConfig.purpose, 'studyTool');
    resolveResponse({ response: { choices: [{ message: { content: '最终深度分析内容' } }] } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(store.getState().notes.pendingAnalysisGenerations.length, 0);
    assert.equal(store.getState().notes.manualNotesLibraryFilter, 'analysis');
    assert.doesNotMatch(el.manualNotesLibraryGrid.textContent, /正在生成深度分析/);
    assert.match(el.manualNotesLibraryGrid.textContent, /最终深度分析内容/);
    assert.equal(el.noteDetailModal.classList.contains('hidden'), true);
});

test('notes analysis wizard clears the analysis placeholder when generation fails', async () => {
    const { createNotesController } = await loadNotesControllerModule();
    let resolveUpstreamCall;
    const upstreamCalled = new Promise((resolve) => {
        resolveUpstreamCall = resolve;
    });

    const { controller, el, store, toasts } = createNotesControllerHarness(createNotesController, {
        stateOverrides: {
            notes: {
                agentNotes: [{
                    id: 'selected-note-1',
                    title: '已选笔记',
                    contentMarkdown: '极限与连续',
                    kind: 'note',
                    agentId: 'agent-1',
                    topicId: 'topic-1',
                }],
                selectedNoteIds: ['selected-note-1'],
            },
        },
        chatApiOverrides: {
            sendChatRequest: async () => {
                resolveUpstreamCall();
                throw new Error('网络失败');
            },
            listAgentNotes: async () => ({ success: true, items: [] }),
        },
    });

    controller.bindEvents();
    el.manualNewNoteBtn.click();
    el.noteAnalysisNextBtn.click();
    el.noteAnalysisNextBtn.click();
    el.noteAnalysisGenerateBtn.click();

    assert.equal(store.getState().notes.manualNotesLibraryFilter, 'analysis');
    assert.match(el.manualNotesLibraryGrid.textContent, /正在生成深度分析/);

    await upstreamCalled;
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(store.getState().notes.pendingAnalysisGenerations.length, 0);
    assert.doesNotMatch(el.manualNotesLibraryGrid.textContent, /正在生成深度分析/);
    assert.equal(toasts.some(([message, level]) => level === 'error' && /网络失败/.test(message)), true);
});

test('notes analysis wizard consumes selected all-agent manual notes even when topic scope is active', async () => {
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
                    chatEndpoint: 'https://study.example.test/v1/chat',
                    chatApiKey: 'fixture-api-key',
                },
            },
            session: {
                agents: [
                    { id: 'agent-1', name: '数学' },
                    { id: 'agent-2', name: '物理' },
                ],
            },
            notes: {
                notesScope: 'topic',
                topicNotes: [],
                allAgentManualNotes: [{
                    id: 'manual-note-1',
                    title: '跨话题手写笔记',
                    contentMarkdown: '这里是跨话题整理的重点内容。',
                    kind: 'note',
                    agentId: 'agent-2',
                    topicId: 'topic-2',
                }],
                selectedNoteIds: ['manual-note-1'],
            },
        },
        chatApiOverrides: {
            sendChatRequest: async (payload) => {
                upstreamPayload = payload;
                resolveUpstreamCall();
                return {
                    response: {
                        choices: [{ message: { content: '这是一份生成后的分析结果。' } }],
                    },
                };
            },
            listTopicNotes: async () => ({ success: true, items: [] }),
            listAgentNotes: async (agentId) => ({
                success: true,
                items: agentId === 'agent-2'
                    ? [{
                        id: 'manual-note-1',
                        title: '跨话题手写笔记',
                        contentMarkdown: '这里是跨话题整理的重点内容。',
                        kind: 'note',
                        agentId: 'agent-2',
                        topicId: 'topic-2',
                    }]
                    : [],
            }),
        },
    });

    controller.bindEvents();
    el.manualNewNoteBtn.click();
    el.noteAnalysisNextBtn.click();
    el.noteAnalysisNextBtn.click();
    el.noteAnalysisGenerateBtn.click();
    await upstreamCalled;
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.match(upstreamPayload.messages[1].content, /跨话题手写笔记/);
    assert.match(upstreamPayload.messages[1].content, /这里是跨话题整理的重点内容/);
    assert.match(upstreamPayload.messages[1].content, /学科：物理/);
});

test('notes analysis wizard blocks generation until at least one note is selected', async () => {
    const { createNotesController } = await loadNotesControllerModule();
    let sendCallCount = 0;

    const { controller, el, store, toasts } = createNotesControllerHarness(createNotesController, {
        stateOverrides: {
            notes: {
                agentNotes: [{
                    id: 'manual-note-1',
                    title: '待选笔记',
                    contentMarkdown: '函数连续性。',
                    kind: 'note',
                    topicId: 'topic-1',
                }],
            },
        },
        chatApiOverrides: {
            sendChatRequest: async () => {
                sendCallCount += 1;
                return { response: { choices: [{ message: { content: 'should-not-run' } }] } };
            },
        },
    });

    controller.bindEvents();
    el.manualNewNoteBtn.click();
    el.noteAnalysisNextBtn.click();
    el.noteAnalysisNextBtn.click();

    assert.equal(sendCallCount, 0);
    assert.equal(store.getState().notes.noteAnalysisWizard.step, 2);
    assert.equal(toasts.some(([message]) => /请先选择至少一条/.test(message)), true);
});

test('quiz config modal opens with defaults and injects custom count difficulty and focus into the prompt', async () => {
    const { createNotesController } = await loadNotesControllerModule();
    let upstreamPayload = null;
    let resolveUpstreamCall;
    const upstreamCalled = new Promise((resolve) => {
        resolveUpstreamCall = resolve;
    });

    const { controller, el } = createNotesControllerHarness(createNotesController, {
        stateOverrides: {
            notes: {
                topicNotes: [{
                    id: 'selected-note-1',
                    title: '已选笔记',
                    contentMarkdown: '极限与连续',
                    sourceMessageIds: ['msg-from-note'],
                }],
                selectedNoteIds: ['selected-note-1'],
            },
        },
        chatApiOverrides: {
            sendChatRequest: async (payload) => {
                upstreamPayload = payload;
                resolveUpstreamCall();
                return {
                    response: {
                        choices: [{ message: { content: buildQuizResponse() } }],
                    },
                };
            },
        },
    });

    controller.bindEvents();
    el.generateQuizBtn.click();

    assert.equal(el.quizConfigModal.classList.contains('hidden'), false);
    assert.equal(el.quizConfigModal.getAttribute('aria-hidden'), 'false');
    assert.equal(el.quizCountPresetBtns[1].getAttribute('aria-pressed'), 'true');
    assert.equal(el.quizDifficultyBtns[1].getAttribute('aria-pressed'), 'true');
    assert.equal(el.quizIncludeChatContextInput.checked, true);

    el.quizCountPresetBtns[2].click();
    el.quizDifficultyBtns[2].click();
    el.quizFocusInput.value = '只考察第三章的关键概念';
    el.quizFocusInput.dispatchEvent(new el.quizFocusInput.ownerDocument.defaultView.Event('input', { bubbles: true }));
    el.quizConfigGenerateBtn.click();
    await upstreamCalled;
    await new Promise((resolve) => setTimeout(resolve, 0));

    const prompt = upstreamPayload.messages[1].content;
    assert.match(prompt, /生成 12 道题/);
    assert.match(prompt, /难度等级：困难/);
    assert.match(prompt, /主题范围：只考察第三章的关键概念/);
    assert.match(prompt, /你必须只返回严格 JSON/);
    assert.match(prompt, /极限与连续/);
    assert.equal(el.quizConfigModal.classList.contains('hidden'), true);
});

test('quiz generation can append the recent chat context and source message ids', async () => {
    const { createNotesController } = await loadNotesControllerModule();
    let upstreamPayload = null;
    let savedPayload = null;
    let resolveUpstreamCall;
    const upstreamCalled = new Promise((resolve) => {
        resolveUpstreamCall = resolve;
    });
    const chatMessages = Array.from({ length: 15 }, (_, index) => ({
        id: `msg-${index + 1}`,
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `对话内容 ${index + 1}`,
        timestamp: index + 1,
    }));

    const { controller, el } = createNotesControllerHarness(createNotesController, {
        stateOverrides: {
            session: {
                currentChatHistory: [
                    ...chatMessages.slice(0, 7),
                    { id: 'thinking-msg', role: 'assistant', content: 'Thinking', isThinking: true },
                    { id: 'empty-msg', role: 'user', content: '   ' },
                    ...chatMessages.slice(7),
                ],
            },
            notes: {
                topicNotes: [{
                    id: 'selected-note-1',
                    title: '已选笔记',
                    contentMarkdown: '课堂笔记内容',
                    sourceMessageIds: ['msg-from-note'],
                }],
                selectedNoteIds: ['selected-note-1'],
            },
        },
        chatApiOverrides: {
            sendChatRequest: async (payload) => {
                upstreamPayload = payload;
                resolveUpstreamCall();
                return {
                    response: {
                        choices: [{ message: { content: buildQuizResponse() } }],
                    },
                };
            },
            saveTopicNote: async (_agentId, _topicId, payload) => {
                savedPayload = payload;
                return {
                    success: true,
                    item: {
                        id: 'saved-quiz',
                        agentId: 'agent-1',
                        topicId: 'topic-1',
                        title: payload.title,
                        contentMarkdown: payload.contentMarkdown,
                        sourceMessageIds: payload.sourceMessageIds,
                        sourceDocumentRefs: payload.sourceDocumentRefs,
                        kind: payload.kind,
                        quizSet: payload.quizSet,
                    },
                };
            },
        },
    });

    controller.bindEvents();
    el.generateQuizBtn.click();
    el.quizIncludeChatContextInput.checked = true;
    el.quizIncludeChatContextInput.dispatchEvent(new el.quizIncludeChatContextInput.ownerDocument.defaultView.Event('change', { bubbles: true }));
    el.quizConfigGenerateBtn.click();
    await upstreamCalled;
    await new Promise((resolve) => setTimeout(resolve, 0));

    const prompt = upstreamPayload.messages[1].content;
    assert.match(prompt, /课堂笔记内容/);
    assert.match(prompt, /当前对话摘录（最近 12 条）/);
    assert.doesNotMatch(prompt, /对话内容 3/);
    assert.match(prompt, /对话内容 4/);
    assert.match(prompt, /对话内容 15/);
    assert.doesNotMatch(prompt, /Thinking/);
    assert.deepEqual(savedPayload.sourceMessageIds, [
        'msg-from-note',
        'msg-4',
        'msg-5',
        'msg-6',
        'msg-7',
        'msg-8',
        'msg-9',
        'msg-10',
        'msg-11',
        'msg-12',
        'msg-13',
        'msg-14',
        'msg-15',
    ]);
});

test('quiz generation can use the recent chat as the only study input', async () => {
    const { createNotesController } = await loadNotesControllerModule();
    let upstreamPayload = null;
    let savedPayload = null;
    let resolveUpstreamCall;
    const upstreamCalled = new Promise((resolve) => {
        resolveUpstreamCall = resolve;
    });
    const chatMessages = Array.from({ length: 14 }, (_, index) => ({
        id: `chat-only-${index + 1}`,
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `纯对话内容 ${index + 1}`,
    }));

    const { controller, el } = createNotesControllerHarness(createNotesController, {
        stateOverrides: {
            session: {
                currentChatHistory: [
                    chatMessages[0],
                    { id: 'thinking-msg', role: 'assistant', content: 'Thinking', isThinking: true },
                    { id: 'empty-msg', role: 'user', content: '   ' },
                    ...chatMessages.slice(1),
                ],
            },
            notes: {
                topicNotes: [],
                agentNotes: [],
                selectedNoteIds: [],
            },
        },
        chatApiOverrides: {
            sendChatRequest: async (payload) => {
                upstreamPayload = payload;
                resolveUpstreamCall();
                return {
                    response: {
                        choices: [{ message: { content: buildQuizResponse('纯对话测验') } }],
                    },
                };
            },
            saveTopicNote: async (_agentId, _topicId, payload) => {
                savedPayload = payload;
                return {
                    success: true,
                    item: {
                        id: 'saved-chat-only-quiz',
                        agentId: 'agent-1',
                        topicId: 'topic-1',
                        title: payload.title,
                        contentMarkdown: payload.contentMarkdown,
                        sourceMessageIds: payload.sourceMessageIds,
                        sourceDocumentRefs: payload.sourceDocumentRefs,
                        kind: payload.kind,
                        quizSet: payload.quizSet,
                    },
                };
            },
        },
    });

    controller.bindEvents();
    el.generateQuizBtn.click();
    el.quizIncludeChatContextInput.checked = true;
    el.quizIncludeChatContextInput.dispatchEvent(new el.quizIncludeChatContextInput.ownerDocument.defaultView.Event('change', { bubbles: true }));
    el.quizConfigGenerateBtn.click();
    await upstreamCalled;
    await new Promise((resolve) => setTimeout(resolve, 0));

    const prompt = upstreamPayload.messages[1].content;
    assert.match(prompt, /当前对话摘录（最近 12 条）/);
    assert.doesNotMatch(prompt, /^纯对话内容 1$/m);
    assert.doesNotMatch(prompt, /^纯对话内容 2$/m);
    assert.match(prompt, /纯对话内容 3/);
    assert.match(prompt, /纯对话内容 14/);
    assert.doesNotMatch(prompt, /Thinking/);
    assert.doesNotMatch(prompt, /已选笔记/);
    assert.doesNotMatch(prompt, /Source 检索内容/);
    assert.deepEqual(savedPayload.sourceMessageIds, [
        'chat-only-3',
        'chat-only-4',
        'chat-only-5',
        'chat-only-6',
        'chat-only-7',
        'chat-only-8',
        'chat-only-9',
        'chat-only-10',
        'chat-only-11',
        'chat-only-12',
        'chat-only-13',
        'chat-only-14',
    ]);
});

test('quiz chat-only generation sends sanitized text instead of rendered HTML', async () => {
    const { createNotesController } = await loadNotesControllerModule();
    let upstreamPayload = null;
    let resolveUpstreamCall;
    const upstreamCalled = new Promise((resolve) => {
        resolveUpstreamCall = resolve;
    });

    const { controller, el } = createNotesControllerHarness(createNotesController, {
        stateOverrides: {
            session: {
                currentChatHistory: [
                    { id: 'deepseek-user', role: 'user', content: '介绍一下 deepseek 最新的模型' },
                    {
                        id: 'deepseek-assistant',
                        role: 'assistant',
                        content: `
                            <div id="response-root" style="color: red">
                                <style>
                                    @keyframes glow { from { opacity: 0; } to { opacity: 1; } }
                                    .card { animation: glow 3s infinite; }
                                </style>
                                <!-- 头部标题区 -->
                                <h1 style="font-size: 28px;">DeepSeek 最新模型</h1>
                                <section>
                                    <h2>DeepSeek-V3</h2>
                                    <div><span>671B 总参数</span><span>128K tokens</span></div>
                                </section>
                                <img src="/表情包/知识点来了.jpg" width="100" style="display:block;">
                            </div>
                        `,
                    },
                ],
            },
            notes: {
                topicNotes: [],
                agentNotes: [],
                selectedNoteIds: [],
            },
        },
        chatApiOverrides: {
            sendChatRequest: async (payload) => {
                upstreamPayload = payload;
                resolveUpstreamCall();
                return { response: { output_text: buildQuizResponse('DeepSeek 测验') } };
            },
        },
    });

    controller.bindEvents();
    el.generateQuizBtn.click();
    el.quizIncludeChatContextInput.checked = true;
    el.quizIncludeChatContextInput.dispatchEvent(new el.quizIncludeChatContextInput.ownerDocument.defaultView.Event('change', { bubbles: true }));
    el.quizConfigGenerateBtn.click();
    await upstreamCalled;
    await new Promise((resolve) => setTimeout(resolve, 0));

    const prompt = upstreamPayload.messages[1].content;
    assert.match(prompt, /当前对话摘录（最近 2 条）/);
    assert.match(prompt, /DeepSeek 最新模型/);
    assert.match(prompt, /DeepSeek-V3/);
    assert.match(prompt, /671B 总参数/);
    assert.doesNotMatch(prompt, /@keyframes/);
    assert.doesNotMatch(prompt, /<style/i);
    assert.doesNotMatch(prompt, /<div/i);
    assert.doesNotMatch(prompt, /style=/i);
    assert.doesNotMatch(prompt, /<img/i);
    assert.doesNotMatch(prompt, /表情包/);
    assert.doesNotMatch(prompt, /response-root/);
});

test('quiz generation still shows the study input hint after manually disabling chat-only input', async () => {
    const { createNotesController } = await loadNotesControllerModule();
    let sendCallCount = 0;

    const { controller, el, store, toasts } = createNotesControllerHarness(createNotesController, {
        stateOverrides: {
            session: {
                currentChatHistory: [{ id: 'user-msg', role: 'user', content: '这条对话没有被勾选使用' }],
            },
            notes: {
                topicNotes: [],
                agentNotes: [],
                selectedNoteIds: [],
            },
        },
        chatApiOverrides: {
            sendChatRequest: async () => {
                sendCallCount += 1;
                return { response: { choices: [{ message: { content: buildQuizResponse() } }] } };
            },
        },
    });

    controller.bindEvents();
    el.generateQuizBtn.click();
    assert.equal(el.quizIncludeChatContextInput.checked, true);
    el.quizIncludeChatContextInput.checked = false;
    el.quizIncludeChatContextInput.dispatchEvent(new el.quizIncludeChatContextInput.ownerDocument.defaultView.Event('change', { bubbles: true }));
    el.quizConfigGenerateBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(sendCallCount, 0);
    assert.deepEqual(store.getState().notes.pendingQuizGenerations, []);
    assert.equal(toasts.some(([message]) => message === '请先选择笔记、导入来源资料，或勾选“包含当前对话”。'), true);
});

test('study tool config modals keep chat context off by default when the current topic has source documents', async () => {
    const { createNotesController } = await loadNotesControllerModule();
    const { controller, el } = createNotesControllerHarness(createNotesController, {
        stateOverrides: {
            source: {
                topicKnowledgeBaseDocuments: [
                    { id: 'source-doc-1', name: '课件.md', status: 'done' },
                ],
            },
        },
        depsOverrides: {
            getCurrentTopic: () => ({
                knowledgeBaseId: 'kb-1',
                selectedKnowledgeBaseDocumentIds: ['source-doc-1'],
            }),
        },
    });

    controller.bindEvents();

    el.generateQuizBtn.click();
    assert.equal(el.quizIncludeChatContextInput.checked, false);
    controller.closeQuizConfigModal({ restoreFocus: false });

    el.generateFlashcardsBtn.click();
    assert.equal(el.flashcardIncludeChatContextInput.checked, false);
});

test('study tool chat-only auto default does not stick after source documents appear', async () => {
    const { createNotesController } = await loadNotesControllerModule();
    let currentTopic = { knowledgeBaseId: 'kb-1' };
    const { controller, el, store } = createNotesControllerHarness(createNotesController, {
        depsOverrides: {
            getCurrentTopic: () => currentTopic,
        },
    });

    controller.bindEvents();

    el.generateQuizBtn.click();
    assert.equal(el.quizIncludeChatContextInput.checked, true);
    controller.closeQuizConfigModal({ restoreFocus: false });

    el.generateFlashcardsBtn.click();
    assert.equal(el.flashcardIncludeChatContextInput.checked, true);
    controller.closeFlashcardConfigModal({ restoreFocus: false });

    currentTopic = {
        knowledgeBaseId: 'kb-1',
        selectedKnowledgeBaseDocumentIds: ['source-doc-1'],
    };
    store.patchState('source', {
        topicKnowledgeBaseDocuments: [
            { id: 'source-doc-1', name: '课件.md', status: 'done' },
        ],
    });

    el.generateQuizBtn.click();
    assert.equal(el.quizIncludeChatContextInput.checked, false);
    controller.closeQuizConfigModal({ restoreFocus: false });

    el.generateFlashcardsBtn.click();
    assert.equal(el.flashcardIncludeChatContextInput.checked, false);
});

test('quiz source fallback passes selected knowledge base document ids into retrieval', async () => {
    const { createNotesController } = await loadNotesControllerModule();
    let retrievalPayload = null;
    let upstreamPayload = null;
    let resolveUpstreamCall;
    const upstreamCalled = new Promise((resolve) => {
        resolveUpstreamCall = resolve;
    });

    const { controller, el } = createNotesControllerHarness(createNotesController, {
        chatApiOverrides: {
            retrieveKnowledgeBaseContext: async (payload) => {
                retrievalPayload = payload;
                return {
                    success: true,
                    contextText: 'Source 检索内容',
                    refs: [{ documentId: 'doc-a', chunkId: 'chunk-a' }],
                };
            },
            sendChatRequest: async (payload) => {
                upstreamPayload = payload;
                resolveUpstreamCall();
                return {
                    response: {
                        choices: [{ message: { content: buildQuizResponse() } }],
                    },
                };
            },
        },
        depsOverrides: {
            getCurrentTopic: () => ({
                knowledgeBaseId: 'kb-1',
                selectedKnowledgeBaseDocumentIds: ['doc-a', 'doc-b'],
            }),
        },
    });

    controller.bindEvents();
    el.generateQuizBtn.click();
    el.quizConfigGenerateBtn.click();
    await upstreamCalled;
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(retrievalPayload.documentIds, ['doc-a', 'doc-b']);
    assert.match(upstreamPayload.messages[1].content, /Source 检索内容/);
});

test('quiz generation saves to the origin topic when the user switches topics before completion', async () => {
    const { createNotesController } = await loadNotesControllerModule();
    let resolveUpstreamCall;
    let releaseResponse;
    let resolveSaveCall;
    const upstreamCalled = new Promise((resolve) => {
        resolveUpstreamCall = resolve;
    });
    const responseReady = new Promise((resolve) => {
        releaseResponse = resolve;
    });
    const saveCalled = new Promise((resolve) => {
        resolveSaveCall = resolve;
    });
    let saveArgs = null;

    const { controller, el, store } = createNotesControllerHarness(createNotesController, {
        stateOverrides: {
            notes: {
                topicNotes: [{
                    id: 'selected-note-1',
                    title: '已选笔记',
                    contentMarkdown: '函数连续性',
                }],
                selectedNoteIds: ['selected-note-1'],
            },
        },
        chatApiOverrides: {
            sendChatRequest: async () => {
                resolveUpstreamCall();
                await responseReady;
                return {
                    response: {
                        choices: [{ message: { content: buildQuizResponse() } }],
                    },
                };
            },
            saveTopicNote: async (agentId, topicId, payload) => {
                saveArgs = { agentId, topicId, payload };
                resolveSaveCall();
                return {
                    success: true,
                    item: {
                        id: 'saved-quiz',
                        agentId,
                        topicId,
                        title: payload.title,
                        contentMarkdown: payload.contentMarkdown,
                        sourceMessageIds: payload.sourceMessageIds,
                        sourceDocumentRefs: payload.sourceDocumentRefs,
                        kind: payload.kind,
                        quizSet: payload.quizSet,
                    },
                };
            },
        },
    });

    controller.bindEvents();
    el.generateQuizBtn.click();
    el.quizConfigGenerateBtn.click();
    await upstreamCalled;

    store.patchState('session', { currentTopicId: 'topic-2' });
    controller.renderNotesPanel();
    releaseResponse();
    await saveCalled;
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(saveArgs.agentId, 'agent-1');
    assert.equal(saveArgs.topicId, 'topic-1');
    assert.equal(store.getState().notes.noteDetailKind, null);
    assert.equal(el.noteDetailModal.classList.contains('hidden'), true);
    assert.deepEqual(store.getState().notes.pendingQuizGenerations, []);
});

test('quiz pending card is scoped to its origin topic and opens practice when still active', async () => {
    const { createNotesController } = await loadNotesControllerModule();
    let releaseResponse;
    let resolveSaveCall;
    const responseReady = new Promise((resolve) => {
        releaseResponse = resolve;
    });
    const saveCalled = new Promise((resolve) => {
        resolveSaveCall = resolve;
    });

    const { controller, el, store } = createNotesControllerHarness(createNotesController, {
        stateOverrides: {
            notes: {
                topicNotes: [{
                    id: 'selected-note-1',
                    title: '已选笔记',
                    contentMarkdown: '导数应用',
                }],
                selectedNoteIds: ['selected-note-1'],
            },
        },
        chatApiOverrides: {
            sendChatRequest: async () => {
                await responseReady;
                return {
                    response: {
                        choices: [{ message: { content: buildQuizResponse() } }],
                    },
                };
            },
            saveTopicNote: async (agentId, topicId, payload) => {
                resolveSaveCall();
                return {
                    success: true,
                    item: {
                        id: 'saved-quiz',
                        agentId,
                        topicId,
                        title: payload.title,
                        contentMarkdown: payload.contentMarkdown,
                        sourceMessageIds: payload.sourceMessageIds,
                        sourceDocumentRefs: payload.sourceDocumentRefs,
                        kind: payload.kind,
                        quizSet: payload.quizSet,
                    },
                };
            },
        },
    });

    controller.bindEvents();
    el.generateQuizBtn.click();
    el.quizConfigGenerateBtn.click();

    assert.equal(store.getState().notes.pendingQuizGenerations.length, 1);
    assert.match(el.notesList.textContent, /正在生成选择题/);
    assert.equal(el.generateQuizBtn.hasAttribute('disabled'), true);

    store.patchState('session', { currentTopicId: 'topic-2' });
    controller.renderNotesPanel();
    assert.doesNotMatch(el.notesList.textContent, /正在生成选择题/);
    assert.equal(el.generateQuizBtn.hasAttribute('disabled'), false);

    store.patchState('session', { currentTopicId: 'topic-1' });
    controller.renderNotesPanel();
    assert.match(el.notesList.textContent, /正在生成选择题/);

    releaseResponse();
    await saveCalled;
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(store.getState().notes.pendingQuizGenerations, []);
    assert.equal(store.getState().notes.noteDetailKind, 'quiz');
    assert.equal(store.getState().notes.noteDetailMode, 'practice');
    assert.equal(el.noteDetailModal.classList.contains('hidden'), false);
});

[
    {
        name: 'upstream error',
        sendResult: { error: 'boom' },
        expectSave: false,
    },
    {
        name: 'empty response',
        sendResult: { response: { choices: [{ message: { content: '   ' } }] } },
        expectSave: false,
    },
    {
        name: 'invalid quiz JSON',
        sendResult: { response: { choices: [{ message: { content: '{"title":"坏格式","items":[]}' } }] } },
        expectSave: false,
    },
    {
        name: 'save failure',
        sendResult: { response: { choices: [{ message: { content: buildQuizResponse() } }] } },
        saveResult: { success: false, error: 'disk full' },
        expectSave: true,
    },
].forEach((scenario) => {
    test(`quiz pending clears after ${scenario.name}`, async () => {
        const { createNotesController } = await loadNotesControllerModule();
        let saveCallCount = 0;
        const { controller, el, store } = createNotesControllerHarness(createNotesController, {
            stateOverrides: {
                notes: {
                    topicNotes: [{
                        id: 'selected-note-1',
                        title: '已选笔记',
                        contentMarkdown: '概率基础',
                    }],
                    selectedNoteIds: ['selected-note-1'],
                },
            },
            chatApiOverrides: {
                sendChatRequest: async () => scenario.sendResult,
                saveTopicNote: async () => {
                    saveCallCount += 1;
                    return scenario.saveResult || { success: true, item: { id: 'saved-quiz' } };
                },
            },
        });

        controller.bindEvents();
        el.generateQuizBtn.click();
        el.quizConfigGenerateBtn.click();
        assert.equal(store.getState().notes.pendingQuizGenerations.length, 1);

        await new Promise((resolve) => setTimeout(resolve, 0));

        assert.deepEqual(store.getState().notes.pendingQuizGenerations, []);
        assert.equal(saveCallCount > 0, scenario.expectSave);
        assert.equal(store.getState().notes.noteDetailKind, null);
        assert.equal(el.noteDetailModal.classList.contains('hidden'), true);
    });
});

test('flashcard config modal opens with defaults and injects custom options into the prompt', async () => {
    const { createNotesController } = await loadNotesControllerModule();
    let upstreamPayload = null;
    let savedPayload = null;
    let resolveUpstreamCall;
    const upstreamCalled = new Promise((resolve) => {
        resolveUpstreamCall = resolve;
    });
    const chatMessages = Array.from({ length: 13 }, (_, index) => ({
        id: `chat-${index + 1}`,
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `对话内容 ${index + 1}`,
    }));

    const { controller, el } = createNotesControllerHarness(createNotesController, {
        stateOverrides: {
            session: {
                currentChatHistory: [
                    ...chatMessages.slice(0, 6),
                    { id: 'thinking-msg', role: 'assistant', content: 'Thinking', isThinking: true },
                    ...chatMessages.slice(6),
                ],
            },
            notes: {
                topicNotes: [{
                    id: 'selected-note-1',
                    title: '已选笔记',
                    contentMarkdown: '连续与导数课堂笔记',
                    sourceMessageIds: ['note-msg'],
                }],
                selectedNoteIds: ['selected-note-1'],
            },
        },
        chatApiOverrides: {
            sendChatRequest: async (payload) => {
                upstreamPayload = payload;
                resolveUpstreamCall();
                return {
                    response: {
                        choices: [{ message: { content: buildFlashcardResponse('自定义函数闪卡') } }],
                    },
                };
            },
            saveTopicNote: async (_agentId, _topicId, payload) => {
                savedPayload = payload;
                return {
                    success: true,
                    item: {
                        id: 'saved-flashcards',
                        agentId: 'agent-1',
                        topicId: 'topic-1',
                        title: payload.title,
                        contentMarkdown: payload.contentMarkdown,
                        sourceMessageIds: payload.sourceMessageIds,
                        sourceDocumentRefs: payload.sourceDocumentRefs,
                        kind: payload.kind,
                        flashcardDeck: payload.flashcardDeck,
                        flashcardProgress: payload.flashcardProgress,
                    },
                };
            },
        },
    });

    controller.bindEvents();
    el.generateFlashcardsBtn.click();

    assert.equal(el.flashcardConfigModal.classList.contains('hidden'), false);
    assert.equal(el.flashcardConfigModal.getAttribute('aria-hidden'), 'false');
    assert.equal(el.flashcardCountPresetBtns[1].getAttribute('aria-pressed'), 'true');
    assert.equal(el.flashcardDifficultyBtns[1].getAttribute('aria-pressed'), 'true');
    assert.equal(el.flashcardFocusInput.value, '');
    assert.equal(el.flashcardIncludeChatContextInput.checked, true);

    el.flashcardCountPresetBtns[2].click();
    el.flashcardDifficultyBtns[2].click();
    el.flashcardFocusInput.value = '只整理极限和连续的易混概念';
    el.flashcardFocusInput.dispatchEvent(new el.flashcardFocusInput.ownerDocument.defaultView.Event('input', { bubbles: true }));
    el.flashcardIncludeChatContextInput.checked = true;
    el.flashcardIncludeChatContextInput.dispatchEvent(new el.flashcardIncludeChatContextInput.ownerDocument.defaultView.Event('change', { bubbles: true }));
    el.flashcardConfigGenerateBtn.click();

    await upstreamCalled;
    await new Promise((resolve) => setTimeout(resolve, 0));

    const prompt = upstreamPayload.messages[1].content;
    assert.match(prompt, /生成 18 张卡/);
    assert.match(prompt, /难度等级：困难/);
    assert.match(prompt, /主题范围：只整理极限和连续的易混概念/);
    assert.match(prompt, /你必须只返回严格 JSON/);
    assert.match(prompt, /连续与导数课堂笔记/);
    assert.match(prompt, /当前对话摘录（最近 12 条）/);
    assert.doesNotMatch(prompt, /^对话内容 1$/m);
    assert.match(prompt, /对话内容 13/);
    assert.equal(savedPayload.title, '自定义函数闪卡');
    assert.deepEqual(savedPayload.sourceMessageIds, [
        'note-msg',
        'chat-2',
        'chat-3',
        'chat-4',
        'chat-5',
        'chat-6',
        'chat-7',
        'chat-8',
        'chat-9',
        'chat-10',
        'chat-11',
        'chat-12',
        'chat-13',
    ]);
    assert.equal(el.flashcardConfigModal.classList.contains('hidden'), true);
});

test('flashcard generation can use the recent chat as the only study input', async () => {
    const { createNotesController } = await loadNotesControllerModule();
    let upstreamPayload = null;
    let savedPayload = null;
    let resolveUpstreamCall;
    const upstreamCalled = new Promise((resolve) => {
        resolveUpstreamCall = resolve;
    });
    const chatMessages = [
        { id: 'flash-chat-1', role: 'user', content: '我们今天复习连续函数。' },
        {
            id: 'flash-chat-2',
            role: 'assistant',
            content: '<div class="answer" style="color:red"><style>.answer{color:red}</style><p>连续要求函数值和极限一致。</p><img src="/表情包/知识点来了.jpg"></div>',
        },
        { id: 'flash-chat-3', role: 'user', content: '再补一下导数。' },
    ];

    const { controller, el, store } = createNotesControllerHarness(createNotesController, {
        stateOverrides: {
            session: {
                currentChatHistory: [
                    { id: 'thinking-msg', role: 'assistant', content: 'Thinking', isThinking: true },
                    ...chatMessages,
                ],
            },
            notes: {
                topicNotes: [],
                agentNotes: [],
                selectedNoteIds: [],
            },
        },
        chatApiOverrides: {
            sendChatRequest: async (payload) => {
                upstreamPayload = payload;
                resolveUpstreamCall();
                return {
                    response: {
                        choices: [{ message: { content: buildFlashcardResponse('纯对话闪卡') } }],
                    },
                };
            },
            saveTopicNote: async (_agentId, _topicId, payload) => {
                savedPayload = payload;
                return {
                    success: true,
                    item: {
                        id: 'saved-chat-only-flashcards',
                        agentId: 'agent-1',
                        topicId: 'topic-1',
                        title: payload.title,
                        contentMarkdown: payload.contentMarkdown,
                        sourceMessageIds: payload.sourceMessageIds,
                        sourceDocumentRefs: payload.sourceDocumentRefs,
                        kind: payload.kind,
                        flashcardDeck: payload.flashcardDeck,
                        flashcardProgress: payload.flashcardProgress,
                    },
                };
            },
        },
    });

    controller.bindEvents();
    el.generateFlashcardsBtn.click();
    el.flashcardIncludeChatContextInput.checked = true;
    el.flashcardIncludeChatContextInput.dispatchEvent(new el.flashcardIncludeChatContextInput.ownerDocument.defaultView.Event('change', { bubbles: true }));
    el.flashcardConfigGenerateBtn.click();
    await upstreamCalled;
    await new Promise((resolve) => setTimeout(resolve, 0));

    const prompt = upstreamPayload.messages[1].content;
    assert.match(prompt, /当前对话摘录（最近 3 条）/);
    assert.match(prompt, /我们今天复习连续函数/);
    assert.match(prompt, /连续要求函数值和极限一致/);
    assert.doesNotMatch(prompt, /<div|<style|style=|<img|表情包|\.answer/i);
    assert.doesNotMatch(prompt, /Thinking/);
    assert.doesNotMatch(prompt, /已选笔记/);
    assert.deepEqual(savedPayload.sourceMessageIds, ['flash-chat-1', 'flash-chat-2', 'flash-chat-3']);
    assert.equal(store.getState().notes.noteDetailKind, 'flashcards');
    assert.equal(el.noteDetailModal.classList.contains('hidden'), false);
});

test('flashcard generation with chat opt-in still stops when the chat has no usable messages', async () => {
    const { createNotesController } = await loadNotesControllerModule();
    let sendCallCount = 0;

    const { controller, el, store, toasts } = createNotesControllerHarness(createNotesController, {
        stateOverrides: {
            session: {
                currentChatHistory: [
                    { id: 'thinking-msg', role: 'assistant', content: 'Thinking', isThinking: true },
                    { id: 'empty-user', role: 'user', content: '   ' },
                ],
            },
            notes: {
                topicNotes: [],
                agentNotes: [],
                selectedNoteIds: [],
            },
        },
        chatApiOverrides: {
            sendChatRequest: async () => {
                sendCallCount += 1;
                return { response: { choices: [{ message: { content: buildFlashcardResponse() } }] } };
            },
        },
    });

    controller.bindEvents();
    el.generateFlashcardsBtn.click();
    el.flashcardIncludeChatContextInput.checked = true;
    el.flashcardIncludeChatContextInput.dispatchEvent(new el.flashcardIncludeChatContextInput.ownerDocument.defaultView.Event('change', { bubbles: true }));
    el.flashcardConfigGenerateBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(sendCallCount, 0);
    assert.deepEqual(store.getState().notes.pendingFlashcardGenerations, []);
    assert.equal(toasts.some(([message]) => message === '请先选择笔记、导入来源资料，或勾选“包含当前对话”。'), true);
});

test('flashcard pending cards allow repeated submissions and are scoped per topic', async () => {
    const { createNotesController } = await loadNotesControllerModule();
    const releases = [];
    let sendCallCount = 0;
    let resolveTwoCalls;
    const twoCalls = new Promise((resolve) => {
        resolveTwoCalls = resolve;
    });

    const { controller, el, store } = createNotesControllerHarness(createNotesController, {
        stateOverrides: {
            notes: {
                topicNotes: [{
                    id: 'selected-note-1',
                    title: '已选笔记',
                    contentMarkdown: '函数图像与导数',
                }],
                selectedNoteIds: ['selected-note-1'],
            },
        },
        chatApiOverrides: {
            sendChatRequest: async () => {
                sendCallCount += 1;
                const callIndex = sendCallCount;
                if (sendCallCount === 2) {
                    resolveTwoCalls();
                }
                await new Promise((resolve) => {
                    releases[callIndex - 1] = resolve;
                });
                return {
                    response: {
                        choices: [{ message: { content: buildFlashcardResponse(`函数闪卡 ${callIndex}`) } }],
                    },
                };
            },
            saveTopicNote: async (agentId, topicId, payload) => ({
                success: true,
                item: {
                    id: `saved-flashcards-${payload.title}`,
                    agentId,
                    topicId,
                    title: payload.title,
                    contentMarkdown: payload.contentMarkdown,
                    sourceMessageIds: payload.sourceMessageIds,
                    sourceDocumentRefs: payload.sourceDocumentRefs,
                    kind: payload.kind,
                    flashcardDeck: payload.flashcardDeck,
                    flashcardProgress: payload.flashcardProgress,
                },
            }),
        },
    });

    controller.bindEvents();
    el.generateFlashcardsBtn.click();
    el.flashcardConfigGenerateBtn.click();
    assert.equal(store.getState().notes.pendingFlashcardGenerations.length, 1);

    el.generateFlashcardsBtn.click();
    el.flashcardConfigGenerateBtn.click();
    await twoCalls;

    assert.equal(store.getState().notes.pendingFlashcardGenerations.length, 2);
    assert.equal((el.notesList.textContent.match(/正在生成闪卡/g) || []).length, 2);
    assert.equal(el.generateFlashcardsBtn.hasAttribute('disabled'), false);
    assert.equal(el.generateFlashcardsBtn.getAttribute('aria-busy'), 'true');

    store.patchState('session', { currentTopicId: 'topic-2' });
    controller.renderNotesPanel();
    assert.doesNotMatch(el.notesList.textContent, /正在生成闪卡/);
    assert.equal(el.generateFlashcardsBtn.getAttribute('aria-busy'), 'false');

    store.patchState('session', { currentTopicId: 'topic-1' });
    controller.renderNotesPanel();
    assert.equal((el.notesList.textContent.match(/正在生成闪卡/g) || []).length, 2);

    releases[0]();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const remainingPending = store.getState().notes.pendingFlashcardGenerations;
    assert.equal(remainingPending.length, 1);
    assert.equal(remainingPending[0].requestId, 'study_flashcards_2');
    assert.equal(store.getState().notes.noteDetailKind, 'flashcards');

    releases[1]();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(store.getState().notes.pendingFlashcardGenerations, []);
});

test('flashcard generation saves to the origin topic without opening detail after a topic switch', async () => {
    const { createNotesController } = await loadNotesControllerModule();
    let resolveUpstreamCall;
    let releaseResponse;
    let resolveSaveCall;
    const upstreamCalled = new Promise((resolve) => {
        resolveUpstreamCall = resolve;
    });
    const responseReady = new Promise((resolve) => {
        releaseResponse = resolve;
    });
    const saveCalled = new Promise((resolve) => {
        resolveSaveCall = resolve;
    });
    let saveArgs = null;

    const { controller, el, store } = createNotesControllerHarness(createNotesController, {
        stateOverrides: {
            notes: {
                topicNotes: [{
                    id: 'selected-note-1',
                    title: '已选笔记',
                    contentMarkdown: '函数连续性',
                }],
                selectedNoteIds: ['selected-note-1'],
            },
        },
        chatApiOverrides: {
            sendChatRequest: async () => {
                resolveUpstreamCall();
                await responseReady;
                return {
                    response: {
                        choices: [{ message: { content: buildFlashcardResponse('跨话题闪卡') } }],
                    },
                };
            },
            saveTopicNote: async (agentId, topicId, payload) => {
                saveArgs = { agentId, topicId, payload };
                resolveSaveCall();
                return {
                    success: true,
                    item: {
                        id: 'saved-flashcards',
                        agentId,
                        topicId,
                        title: payload.title,
                        contentMarkdown: payload.contentMarkdown,
                        sourceMessageIds: payload.sourceMessageIds,
                        sourceDocumentRefs: payload.sourceDocumentRefs,
                        kind: payload.kind,
                        flashcardDeck: payload.flashcardDeck,
                        flashcardProgress: payload.flashcardProgress,
                    },
                };
            },
        },
    });

    controller.bindEvents();
    el.generateFlashcardsBtn.click();
    el.flashcardConfigGenerateBtn.click();
    await upstreamCalled;
    assert.match(el.notesList.textContent, /正在生成闪卡/);

    store.patchState('session', { currentTopicId: 'topic-2' });
    controller.renderNotesPanel();
    releaseResponse();
    await saveCalled;
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(saveArgs.agentId, 'agent-1');
    assert.equal(saveArgs.topicId, 'topic-1');
    assert.equal(store.getState().notes.noteDetailKind, null);
    assert.equal(el.noteDetailModal.classList.contains('hidden'), true);
    assert.deepEqual(store.getState().notes.pendingFlashcardGenerations, []);
});

[
    {
        name: 'upstream error',
        sendResult: { error: 'boom' },
        expectSave: false,
    },
    {
        name: 'empty response',
        sendResult: { response: { choices: [{ message: { content: '   ' } }] } },
        expectSave: false,
    },
    {
        name: 'invalid flashcard JSON',
        sendResult: { response: { choices: [{ message: { content: '{"title":"坏格式","cards":[]}' } }] } },
        expectSave: false,
    },
    {
        name: 'save failure',
        sendResult: { response: { choices: [{ message: { content: buildFlashcardResponse() } }] } },
        saveResult: { success: false, error: 'disk full' },
        expectSave: true,
    },
].forEach((scenario) => {
    test(`flashcard pending clears after ${scenario.name}`, async () => {
        const { createNotesController } = await loadNotesControllerModule();
        let saveCallCount = 0;
        const { controller, el, store } = createNotesControllerHarness(createNotesController, {
            stateOverrides: {
                notes: {
                    topicNotes: [{
                        id: 'selected-note-1',
                        title: '已选笔记',
                        contentMarkdown: '概率基础',
                    }],
                    selectedNoteIds: ['selected-note-1'],
                },
            },
            chatApiOverrides: {
                sendChatRequest: async () => scenario.sendResult,
                saveTopicNote: async () => {
                    saveCallCount += 1;
                    return scenario.saveResult || { success: true, item: { id: 'saved-flashcards' } };
                },
            },
        });

        controller.bindEvents();
        el.generateFlashcardsBtn.click();
        el.flashcardConfigGenerateBtn.click();
        assert.equal(store.getState().notes.pendingFlashcardGenerations.length, 1);

        await new Promise((resolve) => setTimeout(resolve, 0));

        assert.deepEqual(store.getState().notes.pendingFlashcardGenerations, []);
        assert.equal(saveCallCount > 0, scenario.expectSave);
        assert.equal(store.getState().notes.noteDetailKind, null);
        assert.equal(el.noteDetailModal.classList.contains('hidden'), true);
    });
});

test('note normalization preserves valid render snapshots and clears them when body changes', async () => {
    const { buildNoteSaveRequest, normalizeNote } = await loadNotesUtilsModule();
    const snapshot = {
        schemaVersion: 1,
        renderer: 'unistudy-message-renderer',
        sourceMessageId: 'msg-1',
        role: 'assistant',
        contentHtml: '<div class="bubble">富文本气泡</div>',
        styleText: '#scope-1 .bubble { color: red; }',
        scopeId: 'scope-1',
        plainText: '富文本气泡',
        capturedAt: 10,
        ignored: true,
    };

    const normalized = normalizeNote({
        id: 'note-1',
        title: '收藏',
        contentMarkdown: '<div class="bubble">富文本气泡</div>',
        renderSnapshot: snapshot,
    });

    assert.equal(normalized.renderSnapshot.renderer, 'unistudy-message-renderer');
    assert.equal(normalized.renderSnapshot.contentHtml, '<div class="bubble">富文本气泡</div>');
    assert.equal(normalized.renderSnapshot.ignored, undefined);
    assert.equal(normalizeNote({ renderSnapshot: { ...snapshot, renderer: 'other' } }).renderSnapshot, null);

    const titleOnlyRequest = buildNoteSaveRequest({
        currentNote: normalized,
        currentTopicId: 'topic-1',
        title: '新标题',
        contentMarkdown: normalized.contentMarkdown,
    });
    assert.equal(titleOnlyRequest.payload.renderSnapshot.contentHtml, snapshot.contentHtml);

    const editedBodyRequest = buildNoteSaveRequest({
        currentNote: normalized,
        currentTopicId: 'topic-1',
        title: '新标题',
        contentMarkdown: '手动改过的新正文',
    });
    assert.equal(editedBodyRequest.payload.renderSnapshot, null);
});

test('favoriting a chat message sends renderSnapshot through create-note-from-message IPC payload', async () => {
    const { createNotesController } = await loadNotesControllerModule();
    const snapshot = {
        schemaVersion: 1,
        renderer: 'unistudy-message-renderer',
        sourceMessageId: 'assistant-msg',
        role: 'assistant',
        contentHtml: '<div class="bubble">快照气泡</div>',
        styleText: '#scope-1 .bubble { color: red; }',
        scopeId: 'scope-1',
        plainText: '快照气泡',
        capturedAt: 10,
    };
    let createdPayload = null;

    const { controller } = createNotesControllerHarness(createNotesController, {
        stateOverrides: {
            session: {
                currentChatHistory: [{
                    id: 'assistant-msg',
                    role: 'assistant',
                    content: '<div class="bubble">快照气泡</div>',
                    timestamp: Date.UTC(2026, 3, 26, 8, 0),
                    kbContextRefs: ['doc-1'],
                }],
            },
        },
        chatApiOverrides: {
            createNoteFromMessage: async (payload) => {
                createdPayload = payload;
                return {
                    success: true,
                    item: {
                        id: 'note-from-message',
                        agentId: payload.agentId,
                        topicId: payload.topicId,
                        title: payload.title,
                        contentMarkdown: payload.contentMarkdown,
                        sourceMessageIds: payload.sourceMessageIds,
                        sourceDocumentRefs: payload.sourceDocumentRefs,
                        kind: payload.kind,
                        renderSnapshot: payload.renderSnapshot,
                    },
                };
            },
            listTopicNotes: async () => ({ success: true, items: [] }),
            listAgentNotes: async () => ({ success: true, items: [] }),
        },
        depsOverrides: {
            messageRendererApi: {
                createMessageRenderSnapshot: () => snapshot,
            },
        },
    });

    await controller.createNoteFromMessage('assistant-msg');

    assert.equal(createdPayload.renderSnapshot.contentHtml, snapshot.contentHtml);
    assert.deepEqual(createdPayload.sourceMessageIds, ['assistant-msg']);
    assert.deepEqual(createdPayload.sourceDocumentRefs, ['doc-1']);
});

test('note detail and cards use rich preview renderer instead of raw HTML text', async () => {
    const { createNotesController } = await loadNotesControllerModule();
    const mountCalls = [];
    const richRenderer = {
        cleanupNotePreviewMount() {},
        mountRichNotePreview(target, note, options) {
            mountCalls.push({ targetClass: target.className, noteId: note.id, compact: options.compact === true });
            target.innerHTML = '<div class="rich-bubble"><span>富文本气泡</span></div>';
            target.classList.add('unistudy-note-rich-preview');
        },
    };
    const snapshot = {
        schemaVersion: 1,
        renderer: 'unistudy-message-renderer',
        sourceMessageId: 'msg-1',
        role: 'assistant',
        contentHtml: '<div class="rich-bubble">富文本气泡</div>',
        styleText: '',
        scopeId: 'scope-1',
        plainText: '富文本气泡',
        capturedAt: 10,
    };

    const { controller, el } = createNotesControllerHarness(createNotesController, {
        stateOverrides: {
            session: {
                topics: [{ id: 'topic-1', name: '函数' }],
            },
            notes: {
                topicNotes: [{
                    id: 'analysis-1',
                    title: '分析报告',
                    contentMarkdown: '<div style="color:red">富文本气泡</div>',
                    kind: 'analysis',
                    topicId: 'topic-1',
                    renderSnapshot: snapshot,
                }],
                agentNotes: [{
                    id: 'message-note-1',
                    title: 'AI 回答摘录',
                    contentMarkdown: '<div style="color:red">富文本气泡</div>',
                    kind: 'message-note',
                    topicId: 'topic-1',
                    renderSnapshot: snapshot,
                }],
            },
        },
        depsOverrides: {
            messageRendererApi: richRenderer,
        },
    });

    controller.renderNotesPanel();
    assert.ok(el.notesList.querySelector('.note-card__studio-preview .rich-bubble'));
    assert.doesNotMatch(el.notesList.textContent, /<div style=/);

    controller.openManualNotesLibrary();
    assert.ok(el.manualNotesLibraryGrid.querySelector('.manual-note-card__preview .rich-bubble'));
    assert.doesNotMatch(el.manualNotesLibraryGrid.textContent, /<div style=/);

    controller.openNoteDetail({
        id: 'message-note-1',
        title: 'AI 回答摘录',
        contentMarkdown: '<div style="color:red">富文本气泡</div>',
        kind: 'message-note',
        topicId: 'topic-1',
        renderSnapshot: snapshot,
    });
    assert.ok(el.noteMarkdownPreviewContent.querySelector('.rich-bubble'));
    assert.doesNotMatch(el.noteMarkdownPreviewContent.textContent, /<div style=/);
    assert.ok(mountCalls.some((call) => call.compact === true && call.targetClass.includes('note-card__studio-preview')));
    assert.ok(mountCalls.some((call) => call.compact === true && call.targetClass.includes('manual-note-card__preview')));
    assert.ok(mountCalls.some((call) => call.compact === false));
});
