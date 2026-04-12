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

function createInitialAppState() {
    return {
        settings: { ...DEFAULT_SETTINGS },
        agents: [],
        topics: [],
        knowledgeBases: [],
        knowledgeBaseDocuments: [],
        topicKnowledgeBaseDocuments: [],
        knowledgeBaseDebugResult: null,
        selectedKnowledgeBaseId: null,
        topicNotes: [],
        agentNotes: [],
        notesScope: 'topic',
        activeNoteId: null,
        selectedNoteIds: [],
        notesStudioView: 'overview',
        noteDetailKind: null,
        noteDetailMode: 'edit',
        layoutLeftWidth: DEFAULT_SETTINGS.layoutLeftWidth,
        layoutRightWidth: DEFAULT_SETTINGS.layoutRightWidth,
        layoutLeftTopHeight: DEFAULT_SETTINGS.layoutLeftTopHeight,
        layoutInitialized: false,
        activeResizeHandle: null,
        activeVerticalResizeHandle: null,
        activeTopicMenu: null,
        activeSourceFileMenu: null,
        activeNoteMenu: null,
        sidePanelTab: 'notes',
        rightPanelMode: 'notes',
        settingsModalSection: 'global',
        activeFlashcardNoteId: null,
        pendingFlashcardGeneration: null,
        quizPractice: {
            noteId: null,
            currentIndex: 0,
            selectedOptionId: null,
            revealed: false,
        },
        leftSidebarMode: 'source-list',
        leftReaderActiveTab: 'guide',
        sourceListScrollTop: 0,
        currentSelectedItem: { id: null, type: 'agent', name: null, avatarUrl: null, config: null },
        currentTopicId: null,
        currentChatHistory: [],
        pendingAttachments: [],
        pendingSelectionContextRefs: [],
        reader: {
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
        },
        promptModule: null,
        activeRequestId: null,
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
    createInitialAppState,
    createAppStore,
};
