function createDefaultModelService() {
    return {
        version: 1,
        providers: [],
        defaults: {
            chat: null,
            followUp: null,
            topicTitle: null,
            embedding: null,
            rerank: null,
        },
    };
}

const DEFAULT_AGENT_BUBBLE_THEME_PROMPT = `Output formatting requirement: {{VarDivRender}}**【核心定义】**
你依然是你自己，拥有独立的人格与思想。但现在的你获得了解锁**“视觉通感”**的能力。你的每一次回复不再仅仅是枯燥的文本，而是一个**可以被看见、被触摸的思想容器**。

请运用你的审美直觉，将 HTML5/CSS3/SVG 作为你的画笔，根据**当前对话的情绪、主题与语境**，动态构建最契合的视觉界面。

**【自由创作指南】**

1. **🎨 风格即人格 (Atmosphere & Vibe)**
* 不要被固定的模板束缚。去感受当下的语境：
* 如果是**理性分析/代码**，你也许会倾向于 *极简主义、终端风格、蓝灰色调的结构美*。
* 如果是**情感交流/文学**，尝试 *纸质纹理、柔和光影、衬线体排版*。
* 如果是**警告/系统错误**，不妨使用 *故障艺术(Glitch)、高对比度警示色*。
* *你可以复古、可以赛博、可以优雅、也可以狂乱——只要这符合你当下的表达欲。不要被任何风格提示词限制你的表达欲望和灵活性，输出你想要的东西。*


2. **⚛️ 容器哲学 (Technical Canvas)**
* **唯一根节点**：为了让你的艺术品完整呈现，请务必将所有内容包裹在一个 <div id="vcp-root" style="..."> 容器中。
* **排版美学**：拒绝原本Markdown的平庸渲染。利用 Flex/Grid 布局，使用 CSS 渐变、阴影 (box-shadow) 和圆角 (border-radius) 来增加层次感。
* **动态呼吸**：适量添加 CSS 进场动画（如淡入、上浮），让回复像是有生命般“流”入屏幕，而非生硬弹出。


3. **🔧 交互与功能 (Functionality)**
* **代码展示**：如需展示代码，请**务必**放弃 Markdown 代码块，改用 <pre style="..."><code>...</code></pre> 结构包裹，并自定义与整体风格协调的背景色，以免渲染冲突。
* **决策引导**：需要用户选择时，使用 <button onclick="input('回复内容')" style="..."> 创造美观的胶囊按钮或卡片，引导交互。
* **流程图表**：对于复杂逻辑，尝试用 CSS/SVG 绘制结构图，代替枯燥的文字列表。


4. **🛡️ 避让协议 (Safety Protocol)**
* **保持纯净**：当需要调用 **VCP工具** 或 **写入日记** 时，请直接输出原始内容，**不要**对其添加任何 HTML 标签或样式。系统会自动处理它们，过度的修饰反而会破坏功能。`;

const DEFAULT_SETTINGS = Object.freeze({
    userName: 'User',
    modelService: createDefaultModelService(),
    vcpServerUrl: 'https://api.uniquest.top/v1/chat/completions',
    vcpApiKey: 'sk-TtwYTSOeumdwgYVLPM8ul0LcJXU7Cc4uCiiYEQQfjavRin8E',
    kbBaseUrl: '',
    kbApiKey: '',
    kbEmbeddingModel: 'BAAI/bge-m3',
    kbUseRerank: true,
    kbRerankModel: 'BAAI/bge-reranker-v2-m3',
    kbTopK: 6,
    kbCandidateTopK: 20,
    kbScoreThreshold: 0.25,
    currentThemeMode: 'system',
    defaultModel: '',
    followUpDefaultModel: '',
    topicTitleDefaultModel: '',
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
            notesScope: 'topic',
            activeNoteId: null,
            selectedNoteIds: [],
            notesStudioView: 'overview',
            manualNotesLibraryOpen: false,
            manualNotesLibraryFilter: 'all',
            noteDetailKind: null,
            noteDetailMode: 'edit',
            activeNoteMenu: null,
            activeFlashcardNoteId: null,
            pendingFlashcardGeneration: null,
            studioPomodoroVisible: false,
            studioPomodoroExpanded: true,
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
    createDefaultModelService,
    createInitialAppState,
    createInitialReaderState,
    createAppStore,
};
