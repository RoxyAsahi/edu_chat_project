const DEFAULT_SETTINGS = Object.freeze({
    userName: 'User',
    vcpServerUrl: '',
    vcpApiKey: '',
    kbBaseUrl: '',
    kbApiKey: '',
    kbEmbeddingModel: 'BAAI/bge-m3',
    kbUseRerank: true,
    kbRerankModel: 'BAAI/bge-reranker-v2-m3',
    kbTopK: 6,
    kbCandidateTopK: 20,
    kbScoreThreshold: 0.25,
    currentThemeMode: 'system',
    enableAgentBubbleTheme: false,
    enableWideChatLayout: true,
    enableSmoothStreaming: true,
    chatFontPreset: 'system',
    chatCodeFontPreset: 'consolas',
    chatBubbleMaxWidthWideDefault: 92,
    layoutLeftWidth: 410,
    layoutRightWidth: 400,
    layoutLeftTopHeight: 360,
});

const SLICE_NAMES = Object.freeze([
    'settings',
    'layout',
    'session',
    'source',
    'reader',
    'notes',
    'composer',
]);

const FLAT_STATE_PROPERTY_PATHS = Object.freeze({
    settings: ['settings', 'settings'],
    settingsModalSection: ['settings', 'settingsModalSection'],
    promptModule: ['settings', 'promptModule'],

    layoutLeftWidth: ['layout', 'layoutLeftWidth'],
    layoutRightWidth: ['layout', 'layoutRightWidth'],
    layoutLeftTopHeight: ['layout', 'layoutLeftTopHeight'],
    layoutInitialized: ['layout', 'layoutInitialized'],
    activeResizeHandle: ['layout', 'activeResizeHandle'],
    activeVerticalResizeHandle: ['layout', 'activeVerticalResizeHandle'],
    leftSidebarMode: ['layout', 'leftSidebarMode'],
    leftReaderActiveTab: ['layout', 'leftReaderActiveTab'],
    sourceListScrollTop: ['layout', 'sourceListScrollTop'],
    sidePanelTab: ['layout', 'sidePanelTab'],
    rightPanelMode: ['layout', 'rightPanelMode'],

    agents: ['session', 'agents'],
    topics: ['session', 'topics'],
    currentSelectedItem: ['session', 'currentSelectedItem'],
    currentTopicId: ['session', 'currentTopicId'],
    currentChatHistory: ['session', 'currentChatHistory'],
    activeTopicMenu: ['session', 'activeTopicMenu'],

    knowledgeBases: ['source', 'knowledgeBases'],
    knowledgeBaseDocuments: ['source', 'knowledgeBaseDocuments'],
    topicKnowledgeBaseDocuments: ['source', 'topicKnowledgeBaseDocuments'],
    knowledgeBaseDebugResult: ['source', 'knowledgeBaseDebugResult'],
    selectedKnowledgeBaseId: ['source', 'selectedKnowledgeBaseId'],
    activeSourceFileMenu: ['source', 'activeSourceFileMenu'],

    reader: ['reader'],

    topicNotes: ['notes', 'topicNotes'],
    agentNotes: ['notes', 'agentNotes'],
    notesScope: ['notes', 'notesScope'],
    activeNoteId: ['notes', 'activeNoteId'],
    selectedNoteIds: ['notes', 'selectedNoteIds'],
    notesStudioView: ['notes', 'notesStudioView'],
    noteDetailKind: ['notes', 'noteDetailKind'],
    activeNoteMenu: ['notes', 'activeNoteMenu'],
    activeFlashcardNoteId: ['notes', 'activeFlashcardNoteId'],
    pendingFlashcardGeneration: ['notes', 'pendingFlashcardGeneration'],

    pendingAttachments: ['composer', 'pendingAttachments'],
    pendingSelectionContextRefs: ['composer', 'pendingSelectionContextRefs'],
    activeRequestId: ['composer', 'activeRequestId'],
});

function createInitialReaderState() {
    return {
        documentId: null,
        documentName: '',
        contentType: null,
        status: 'idle',
        isIndexed: false,
        view: null,
        activePageNumber: null,
        activeParagraphIndex: null,
        activeSectionTitle: null,
        pendingSelection: null,
        guideStatus: 'idle',
        guideMarkdown: '',
        guideGeneratedAt: null,
        guideError: null,
    };
}

function createInitialAppState() {
    return {
        settings: {
            settings: { ...DEFAULT_SETTINGS },
            settingsModalSection: 'global',
            promptModule: null,
        },
        layout: {
            layoutLeftWidth: DEFAULT_SETTINGS.layoutLeftWidth,
            layoutRightWidth: DEFAULT_SETTINGS.layoutRightWidth,
            layoutLeftTopHeight: DEFAULT_SETTINGS.layoutLeftTopHeight,
            layoutInitialized: false,
            activeResizeHandle: null,
            activeVerticalResizeHandle: null,
            leftSidebarMode: 'source-list',
            leftReaderActiveTab: 'guide',
            sourceListScrollTop: 0,
            sidePanelTab: 'notes',
            rightPanelMode: 'notes',
        },
        session: {
            agents: [],
            topics: [],
            currentSelectedItem: { id: null, type: 'agent', name: null, avatarUrl: null, config: null },
            currentTopicId: null,
            currentChatHistory: [],
            activeTopicMenu: null,
        },
        source: {
            knowledgeBases: [],
            knowledgeBaseDocuments: [],
            topicKnowledgeBaseDocuments: [],
            knowledgeBaseDebugResult: null,
            selectedKnowledgeBaseId: null,
            activeSourceFileMenu: null,
        },
        reader: createInitialReaderState(),
        notes: {
            topicNotes: [],
            agentNotes: [],
            notesScope: 'topic',
            activeNoteId: null,
            selectedNoteIds: [],
            notesStudioView: 'overview',
            noteDetailKind: null,
            activeNoteMenu: null,
            activeFlashcardNoteId: null,
            pendingFlashcardGeneration: null,
        },
        composer: {
            pendingAttachments: [],
            pendingSelectionContextRefs: [],
            activeRequestId: null,
        },
    };
}

function createAppStore(initialState = createInitialAppState()) {
    const state = initialState;
    const sliceListeners = new Map();

    function getState() {
        return state;
    }

    function patchState(slice, patch) {
        if (!Object.prototype.hasOwnProperty.call(state, slice)) {
            throw new Error(`Unknown app store slice: ${slice}`);
        }

        const currentSlice = state[slice];
        const nextSlice = typeof patch === 'function'
            ? patch(currentSlice, state)
            : { ...currentSlice, ...patch };

        state[slice] = nextSlice;
        const listeners = sliceListeners.get(slice);
        if (listeners) {
            listeners.forEach((listener) => listener(nextSlice, state));
        }
        return nextSlice;
    }

    function subscribe(slice, listener) {
        if (!Object.prototype.hasOwnProperty.call(state, slice)) {
            throw new Error(`Unknown app store slice: ${slice}`);
        }

        if (!sliceListeners.has(slice)) {
            sliceListeners.set(slice, new Set());
        }

        const listeners = sliceListeners.get(slice);
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
            if (listeners.size === 0) {
                sliceListeners.delete(slice);
            }
        };
    }

    return {
        getState,
        patchState,
        subscribe,
    };
}

export {
    DEFAULT_SETTINGS,
    FLAT_STATE_PROPERTY_PATHS,
    SLICE_NAMES,
    createInitialAppState,
    createInitialReaderState,
    createAppStore,
};
