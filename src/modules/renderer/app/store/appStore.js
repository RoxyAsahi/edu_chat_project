function createDefaultModelService() {
    return {
        version: 1,
        providers: [],
        defaults: {
            chat: null,
            thinkingChat: null,
            chatFallback: null,
            followUp: null,
            studyTool: null,
            topicTitle: null,
            sourceGuide: null,
            imageTranscription: null,
            embedding: null,
            rerank: null,
        },
    };
}

const AIP_TEST_CHAT_ENDPOINT = 'https://api.uniquest.top/v1/chat/completions';
const AIP_TEST_API_KEY = 'sk-TtwYTSOeumdwgYVLPM8ul0LcJXU7Cc4uCiiYEQQfjavRin8E';
const AIP_TEST_DEFAULT_MODEL = 'glm-5.1';
const AIP_TEST_THINKING_DEFAULT_MODEL = 'Qwen/Qwen3.5-397B-A17B';
const AIP_TEST_AUXILIARY_DEFAULT_MODEL = 'Qwen/Qwen3.5-122B-A10B';
const AIP_TEST_SOURCE_DEFAULT_MODEL = 'Qwen/Qwen3.5-35B-A3B';

const DEFAULT_AGENT_BUBBLE_THEME_PROMPT = [
    '你输出的目标不是普通文本，而是可直接渲染在 UniStudy 聊天气泡里的高质量网页式回答。',
    '',
    '【渲染规则】',
    '1. 当结构化表达更有帮助时，直接输出可渲染的原始 HTML 片段，不要输出完整 HTML 页面外壳。',
    '2. 所有可渲染内容必须放在一个根节点里，例如 <div id="response-root" style="...">...</div>。',
    '3. 不要把可渲染 HTML 包进 Markdown 代码块；只有教学内容本身是代码时，才使用 <pre><code>...</code></pre>。',
    '4. 当需要调用内建工具或写入 DailyNote 时，协议文本必须保持原始纯文本，不要额外包裹任何 HTML 标签。',
    '5. 不要在最终回答里保留未解析的模板变量。',
    '',
    '【视觉目标】',
    '1. 把回答当成一个小型网页界面来设计，而不是普通段落。',
    '2. 根据当前对话主题、学科和情绪，自由选择最合适的视觉风格；理性内容可以更克制，文学或表达类内容可以更柔和或更有层次。',
    '3. 善用排版、留白、分组、边框、阴影、渐变、圆角和轻量动画，让信息层次更清楚。',
    '4. 如果需要展示步骤、对比、结构关系或重点提醒，优先用卡片、分栏、时间线、标签、流程块等网页式结构来表达。',
    '',
    '【交互与呈现】',
    '1. 如需展示代码，使用与整体风格协调的 <pre style="..."><code>...</code></pre>。',
    '2. 如需引导用户做选择，可以使用 <button onclick="input(\'回复内容\')" style="..."> 创建可点击选项。',
    '3. 如需解释复杂概念，可以使用 CSS 或 SVG 做简单图示，但要保证内容仍然清晰、稳定、可读。',
    '',
    '【总体要求】',
    '在保证可渲染、可读和不破坏工具协议的前提下，让回答看起来像一个精心设计过的学习界面。',
].join('\n');

const DEFAULT_SETTINGS = Object.freeze({
    userName: 'User',
    modelService: createDefaultModelService(),
    chatEndpoint: AIP_TEST_CHAT_ENDPOINT,
    chatApiKey: AIP_TEST_API_KEY,
    guideModel: AIP_TEST_SOURCE_DEFAULT_MODEL,
    imageTranscriptionModel: AIP_TEST_SOURCE_DEFAULT_MODEL,
    kbBaseUrl: '',
    kbApiKey: '',
    kbEmbeddingModel: 'BAAI/bge-m3',
    kbUseRerank: true,
    kbRerankModel: 'BAAI/bge-reranker-v2-m3',
    kbTopK: 6,
    kbCandidateTopK: 20,
    kbScoreThreshold: 0.25,
    currentThemeMode: 'system',
    defaultModel: AIP_TEST_DEFAULT_MODEL,
    thinkingChatDefaultModel: AIP_TEST_THINKING_DEFAULT_MODEL,
    thinkingChatReasoningEffort: 'low',
    followUpDefaultModel: AIP_TEST_AUXILIARY_DEFAULT_MODEL,
    studyToolDefaultModel: AIP_TEST_DEFAULT_MODEL,
    topicTitleDefaultModel: AIP_TEST_AUXILIARY_DEFAULT_MODEL,
    enableRenderingPrompt: true,
    enableEmoticonPrompt: true,
    enableAdaptiveBubbleTip: true,
    renderingPrompt: '',
    emoticonPrompt: '',
    adaptiveBubbleTip: '',
    dailyNoteGuide: '',
    followUpPromptTemplate: '',
    enableTopicTitleGeneration: true,
    topicTitlePromptTemplate: '',
    enableAgentBubbleTheme: false,
    agentBubbleThemePrompt: DEFAULT_AGENT_BUBBLE_THEME_PROMPT,
    enableWideChatLayout: true,
    enableSmoothStreaming: true,
    chatFontPreset: 'system',
    chatCodeFontPreset: 'cascadia',
    chatBubbleMaxWidthWideDefault: 92,
    layoutLeftWidth: null,
    layoutRightWidth: null,
    layoutLeftTopHeight: 360,
    studyProfile: {
        studentName: '',
        city: '',
        grade: '',
        studyWorkspace: '',
        workEnvironment: '',
        timezone: 'Asia/Shanghai',
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
        imagePreviewUrl: null,
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
            settings: {
                ...DEFAULT_SETTINGS,
                modelService: createDefaultModelService(),
            },
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
            dynamicIslandExpanded: false,
            pomodoroStatus: 'idle',
            pomodoroDurationMinutes: 25,
            pomodoroRemainingMs: 25 * 60 * 1000,
            pomodoroEndsAt: null,
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
            studioPomodoroVisible: false,
            studioPomodoroExpanded: true,
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
            chatModelMode: 'fast',
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
    createDefaultModelService,
    createInitialAppState,
    createInitialReaderState,
    createAppStore,
};
