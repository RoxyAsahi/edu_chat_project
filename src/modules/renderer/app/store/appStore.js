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
    enableRenderingPrompt: true,
    enableAdaptiveBubbleTip: true,
    renderingPrompt: '',
    adaptiveBubbleTip: '',
    dailyNoteGuide: '',
    enableAgentBubbleTheme: false,
    agentBubbleThemePrompt: 'Output formatting requirement: {{VarDivRender}}',
    enableWideChatLayout: true,
    enableSmoothStreaming: true,
    chatFontPreset: 'system',
    chatCodeFontPreset: 'consolas',
    chatBubbleMaxWidthWideDefault: 92,
    layoutLeftWidth: 410,
    layoutRightWidth: 400,
    layoutLeftTopHeight: 360,
    studyProfile: {
        studentName: '',
        city: '',
        studyWorkspace: '',
        workEnvironment: '',
        timezone: 'Asia/Hong_Kong',
    },
    promptVariables: {},
    studyLogPolicy: {
        enabled: true,
        enableDailyNotePromptVariables: true,
        autoInjectDailyNoteProtocol: true,
        maxToolRounds: 3,
        memoryTopK: 4,
        memoryFallbackTopK: 2,
    },
});

const SLICE_NAMES = Object.freeze([
    'settings',
    'layout',
    'session',
    'source',
    'reader',
    'notes',
    'logs',
    'composer',
]);

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
            workspaceViewMode: 'overview',
            activeResizeHandle: null,
            activeVerticalResizeHandle: null,
            leftSidebarMode: 'source-list',
            leftReaderActiveTab: 'guide',
            sourceListScrollTop: 0,
            sidePanelTab: 'notes',
            mobileWorkspaceTab: 'source',
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
        logs: {
            scope: 'topic',
            days: [],
            entries: [],
            activeDiaryId: null,
            activeDateKey: null,
            activeEntryId: null,
            searchQuery: '',
            dateFilter: '',
            detail: null,
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
    const knownSlices = new Set(SLICE_NAMES);

    function getState() {
        return state;
    }

    function patchState(slice, patch) {
        if (!knownSlices.has(slice)) {
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
        if (!knownSlices.has(slice)) {
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
    SLICE_NAMES,
    createInitialAppState,
    createInitialReaderState,
    createAppStore,
};
