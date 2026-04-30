import {
    buildBlankNoteTitle,
    filterGeneratedNotes,
    filterManualNotes,
    getNormalizedNoteKind,
    normalizeNote as normalizeStoredNote,
} from './notesUtils.js';
import { createNotesDom } from './notesDom.js';
import { createNotesOperations } from './notesOperations.js';
import { hasStructuredQuiz } from '../quiz/quizUtils.js';

const QUIZ_COUNT_PRESETS = {
    less: 5,
    standard: 8,
    more: 12,
};

const FLASHCARD_COUNT_PRESETS = {
    less: 8,
    standard: 12,
    more: 18,
};

const DEFAULT_QUIZ_GENERATION_CONFIG = {
    countPreset: 'standard',
    questionCount: QUIZ_COUNT_PRESETS.standard,
    difficulty: 'medium',
    focus: '',
    includeChatContext: false,
};

const DEFAULT_FLASHCARD_GENERATION_CONFIG = {
    countPreset: 'standard',
    cardCount: FLASHCARD_COUNT_PRESETS.standard,
    difficulty: 'medium',
    focus: '',
    includeChatContext: false,
};

const QUIZ_DIFFICULTIES = new Set(['easy', 'medium', 'hard']);
const NOTE_ANALYSIS_MAX_SELECTION = 10;
const NOTE_ANALYSIS_STEPS = [
    { id: 1, label: '基本设置', icon: 'settings' },
    { id: 2, label: '选择笔记', icon: 'library_books' },
    { id: 3, label: '设置指引', icon: 'edit_note' },
    { id: 4, label: '创建中', icon: 'auto_awesome' },
];
const NOTE_ANALYSIS_GUIDANCE_TEMPLATES = [
    '总结这些笔记的共性主题、关键知识点和后续复习重点。',
    '重点分析跨话题/跨学科之间可以迁移的方法、模型和思维方式。',
    '找出我当前理解中的薄弱点、矛盾点和需要追问的问题。',
];

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function stripMarkdown(text) {
    return String(text || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/[*_~>-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function createDefaultNoteAnalysisWizardState() {
    return {
        open: false,
        step: 1,
        title: '',
        subjectFilter: 'all',
        selectedNoteIds: [],
        guidance: '',
        generating: false,
        savedNote: null,
        error: '',
    };
}

function normalizeNoteAnalysisWizardState(value = {}) {
    const base = createDefaultNoteAnalysisWizardState();
    const step = Number(value.step);
    return {
        ...base,
        ...value,
        open: value.open === true,
        step: Number.isFinite(step) ? Math.max(1, Math.min(4, Math.round(step))) : base.step,
        title: String(value.title || ''),
        subjectFilter: String(value.subjectFilter || 'all'),
        selectedNoteIds: Array.isArray(value.selectedNoteIds)
            ? [...new Set(value.selectedNoteIds.map((id) => String(id || '').trim()).filter(Boolean))]
            : [],
        guidance: String(value.guidance || ''),
        generating: value.generating === true,
        savedNote: value.savedNote || null,
        error: String(value.error || ''),
    };
}

function clampPomodoroMinutes(value, fallback = 25) {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue)) {
        return fallback;
    }
    return Math.min(180, Math.max(1, Math.round(nextValue)));
}

function parsePomodoroDisplayMinutes(value, fallback = 25) {
    const text = String(value || '').trim();
    if (!text) {
        return fallback;
    }
    const [minutesPart] = text.split(':');
    return clampPomodoroMinutes(minutesPart, fallback);
}

function formatPomodoroRemaining(ms = 0) {
    const totalSeconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function normalizeQuizGenerationConfig(config = {}) {
    const requestedPreset = String(config.countPreset || '').trim();
    const countPreset = Object.prototype.hasOwnProperty.call(QUIZ_COUNT_PRESETS, requestedPreset)
        ? requestedPreset
        : DEFAULT_QUIZ_GENERATION_CONFIG.countPreset;
    const questionCount = Number.isFinite(Number(config.questionCount))
        ? Math.max(1, Math.min(30, Math.round(Number(config.questionCount))))
        : QUIZ_COUNT_PRESETS[countPreset];
    const difficulty = QUIZ_DIFFICULTIES.has(String(config.difficulty || '').trim())
        ? String(config.difficulty).trim()
        : DEFAULT_QUIZ_GENERATION_CONFIG.difficulty;

    return {
        countPreset,
        questionCount,
        difficulty,
        focus: String(config.focus || '').trim(),
        includeChatContext: config.includeChatContext === true,
    };
}

function normalizeFlashcardGenerationConfig(config = {}) {
    const requestedPreset = String(config.countPreset || '').trim();
    const countPreset = Object.prototype.hasOwnProperty.call(FLASHCARD_COUNT_PRESETS, requestedPreset)
        ? requestedPreset
        : DEFAULT_FLASHCARD_GENERATION_CONFIG.countPreset;
    const cardCount = Number.isFinite(Number(config.cardCount))
        ? Math.max(1, Math.min(60, Math.round(Number(config.cardCount))))
        : FLASHCARD_COUNT_PRESETS[countPreset];
    const difficulty = QUIZ_DIFFICULTIES.has(String(config.difficulty || '').trim())
        ? String(config.difficulty).trim()
        : DEFAULT_FLASHCARD_GENERATION_CONFIG.difficulty;

    return {
        countPreset,
        cardCount,
        difficulty,
        focus: String(config.focus || '').trim(),
        includeChatContext: config.includeChatContext === true,
    };
}

function createNotesController(deps = {}) {
    const store = deps.store;
    const el = deps.el;
    const chatAPI = deps.chatAPI;
    const ui = deps.ui;
    const renderMarkdownFragment = deps.renderMarkdownFragment || ((value) => value);
    const messageRendererApi = deps.messageRendererApi || {};
    const windowObj = deps.windowObj || window;
    const documentObj = deps.documentObj || document;
    const setSidePanelTab = deps.setSidePanelTab || (() => {});
    const setRightPanelMode = deps.setRightPanelMode || (() => {});
    const showManualNotesLibraryPage = deps.showManualNotesLibraryPage || (() => {});
    const syncWorkspaceView = deps.syncWorkspaceView || (() => {});
    const getCurrentTopic = deps.getCurrentTopic || (() => null);
    const getCurrentTopicDisplayName = deps.getCurrentTopicDisplayName || (() => '请选择一个话题');
    const persistHistory = deps.persistHistory || (async () => {});
    const buildTopicContext = deps.buildTopicContext || (() => ({}));
    const createId = deps.createId || ((prefix) => `${prefix}_${Date.now()}`);
    const flashcardsApi = deps.flashcardsApi || {
        activateNote: () => null,
        beginPendingGeneration: () => {},
        buildGeneratedFlashcardContent: () => null,
        clearPendingGeneration: () => {},
        getFlashcardSourceCount: () => 0,
        getPendingGenerations: () => [],
        getPendingGeneration: () => null,
        hasStructuredFlashcards: () => false,
        openPractice: () => false,
        renderPractice: () => {},
        resetState: () => {},
        updatePendingGeneration: () => {},
    };
    const closeTopicActionMenu = deps.closeTopicActionMenu || (() => {});
    const closeSourceFileActionMenu = deps.closeSourceFileActionMenu || (() => {});
    const updateCurrentChatHistory = deps.updateCurrentChatHistory || (() => []);
    const onManualNotesLibraryFilterChange = deps.onManualNotesLibraryFilterChange || (() => {});
    const getDiaryWallTabs = deps.getDiaryWallTabs || (() => []);
    const getDiaryWallActiveFilter = deps.getDiaryWallActiveFilter || (() => 'all');
    const setDiaryWallAgentFilter = deps.setDiaryWallAgentFilter || (() => {});
    const getCurrentSelectedItem = deps.getCurrentSelectedItem || (() => store.getState().session.currentSelectedItem);
    const getCurrentTopicId = deps.getCurrentTopicId || (() => store.getState().session.currentTopicId);
    const getCurrentChatHistory = deps.getCurrentChatHistory || (() => store.getState().session.currentChatHistory);
    const HTMLElementCtor = windowObj.HTMLElement || globalThis.HTMLElement;
    const ElementCtor = windowObj.Element || globalThis.Element;
    let noteDetailTrigger = null;
    let noteDetailReturnTarget = 'studio';
    let quizConfigTrigger = null;
    let flashcardConfigTrigger = null;
    let quizIncludeChatContextAutoDefaulted = false;
    let flashcardIncludeChatContextAutoDefaulted = false;
    let manualNotesLibraryTrigger = null;
    let noteAnalysisTrigger = null;
    let studioPomodoroTickTimerId = null;
    let notesDomApi = null;
    let notesOperationsApi = null;

    function getNotesSlice() {
        return store.getState().notes;
    }

    function getSettingsSlice() {
        return store.getState().settings;
    }

    function getSessionSlice() {
        return store.getState().session;
    }

    function getLayoutSlice() {
        return store.getState().layout;
    }

    function patchNotes(patch) {
        return store.patchState('notes', (current, rootState) => ({
            ...current,
            ...(typeof patch === 'function' ? patch(current, rootState) : patch),
        }));
    }

    function patchLayout(patch) {
        return store.patchState('layout', (current, rootState) => ({
            ...current,
            ...(typeof patch === 'function' ? patch(current, rootState) : patch),
        }));
    }

    function getPomodoroRemainingMs(layout = getLayoutSlice(), currentTime = new Date()) {
        if (layout.pomodoroStatus === 'running' && Number.isFinite(layout.pomodoroEndsAt)) {
            return Math.max(0, Number(layout.pomodoroEndsAt) - currentTime.getTime());
        }
        if (Number.isFinite(layout.pomodoroRemainingMs)) {
            return Math.max(0, Number(layout.pomodoroRemainingMs));
        }
        return clampPomodoroMinutes(layout.pomodoroDurationMinutes, 25) * 60 * 1000;
    }

    function renderStudioPomodoroControls() {
        const layout = getLayoutSlice();
        const remainingMs = getPomodoroRemainingMs(layout);
        if (el.studioPomodoroDisplayInput && documentObj.activeElement !== el.studioPomodoroDisplayInput) {
            el.studioPomodoroDisplayInput.value = layout.pomodoroStatus === 'idle'
                ? `${clampPomodoroMinutes(layout.pomodoroDurationMinutes, 25)}:00`
                : formatPomodoroRemaining(remainingMs);
        }
        if (el.studioPomodoroSummaryText) {
            el.studioPomodoroSummaryText.textContent = layout.pomodoroStatus === 'idle'
                ? `${clampPomodoroMinutes(layout.pomodoroDurationMinutes, 25)} 分钟`
                : formatPomodoroRemaining(remainingMs);
        }
        el.studioPomodoroStartBtn?.classList.toggle('hidden', layout.pomodoroStatus === 'running' || layout.pomodoroStatus === 'paused');
        el.studioPomodoroPauseBtn?.classList.toggle('hidden', layout.pomodoroStatus !== 'running');
        el.studioPomodoroResumeBtn?.classList.toggle('hidden', layout.pomodoroStatus !== 'paused');
        if (el.studioPomodoroResetBtn) {
            el.studioPomodoroResetBtn.disabled = layout.pomodoroStatus === 'idle'
                && remainingMs === clampPomodoroMinutes(layout.pomodoroDurationMinutes, 25) * 60 * 1000;
        }
    }

    function ensureStudioPomodoroTicker() {
        if (studioPomodoroTickTimerId != null) {
            return;
        }
        studioPomodoroTickTimerId = windowObj.setInterval(() => {
            const layout = getLayoutSlice();
            if (layout.pomodoroStatus !== 'running') {
                renderStudioPomodoroControls();
                return;
            }
            const remainingMs = getPomodoroRemainingMs(layout);
            if (remainingMs <= 0) {
                patchLayout({
                    pomodoroStatus: 'idle',
                    pomodoroRemainingMs: clampPomodoroMinutes(layout.pomodoroDurationMinutes, 25) * 60 * 1000,
                    pomodoroEndsAt: null,
                });
            } else if (remainingMs !== layout.pomodoroRemainingMs) {
                patchLayout({ pomodoroRemainingMs: remainingMs });
            }
            renderStudioPomodoroControls();
        }, 1000);
    }

    function syncStudioPomodoroDuration() {
        const layout = getLayoutSlice();
        const minutes = parsePomodoroDisplayMinutes(
            el.studioPomodoroDisplayInput?.value,
            layout.pomodoroDurationMinutes || 25,
        );
        patchLayout((current) => ({
            pomodoroDurationMinutes: minutes,
            ...(current.pomodoroStatus !== 'running'
                ? {
                    pomodoroRemainingMs: minutes * 60 * 1000,
                    pomodoroEndsAt: null,
                }
                : {}),
        }));
        return minutes;
    }

    function startStudioPomodoro() {
        const durationMinutes = syncStudioPomodoroDuration();
        const durationMs = durationMinutes * 60 * 1000;
        patchLayout({
            pomodoroStatus: 'running',
            pomodoroDurationMinutes: durationMinutes,
            pomodoroRemainingMs: durationMs,
            pomodoroEndsAt: Date.now() + durationMs,
        });
        ensureStudioPomodoroTicker();
        renderStudioPomodoroControls();
    }

    function pauseStudioPomodoro() {
        patchLayout({
            pomodoroStatus: 'paused',
            pomodoroRemainingMs: getPomodoroRemainingMs(),
            pomodoroEndsAt: null,
        });
        renderStudioPomodoroControls();
    }

    function resumeStudioPomodoro() {
        const remainingMs = getPomodoroRemainingMs();
        patchLayout({
            pomodoroStatus: 'running',
            pomodoroRemainingMs: remainingMs,
            pomodoroEndsAt: Date.now() + remainingMs,
        });
        ensureStudioPomodoroTicker();
        renderStudioPomodoroControls();
    }

    function resetStudioPomodoro() {
        const durationMs = clampPomodoroMinutes(getLayoutSlice().pomodoroDurationMinutes, 25) * 60 * 1000;
        patchLayout({
            pomodoroStatus: 'idle',
            pomodoroRemainingMs: durationMs,
            pomodoroEndsAt: null,
        });
        renderStudioPomodoroControls();
    }

    const state = {};
    Object.defineProperties(state, {
        topicNotes: {
            get: () => getNotesSlice().topicNotes,
            set: (value) => patchNotes({ topicNotes: value }),
        },
        agentNotes: {
            get: () => getNotesSlice().agentNotes,
            set: (value) => patchNotes({ agentNotes: value }),
        },
        allAgentManualNotes: {
            get: () => getNotesSlice().allAgentManualNotes || [],
            set: (value) => patchNotes({ allAgentManualNotes: Array.isArray(value) ? value : [] }),
        },
        notesScope: {
            get: () => getNotesSlice().notesScope,
            set: (value) => patchNotes({ notesScope: value }),
        },
        activeNoteId: {
            get: () => getNotesSlice().activeNoteId,
            set: (value) => patchNotes({ activeNoteId: value }),
        },
        selectedNoteIds: {
            get: () => getNotesSlice().selectedNoteIds,
            set: (value) => patchNotes({ selectedNoteIds: value }),
        },
        notesStudioView: {
            get: () => getNotesSlice().notesStudioView,
            set: (value) => patchNotes({ notesStudioView: value }),
        },
        manualNotesLibraryOpen: {
            get: () => getNotesSlice().manualNotesLibraryOpen === true,
            set: (value) => patchNotes({ manualNotesLibraryOpen: value === true }),
        },
        manualNotesLibraryFilter: {
            get: () => getNotesSlice().manualNotesLibraryFilter || 'all',
            set: (value) => patchNotes({ manualNotesLibraryFilter: String(value || 'all') }),
        },
        manualNotesLibraryTabsCollapsed: {
            get: () => getNotesSlice().manualNotesLibraryTabsCollapsed === true,
            set: (value) => patchNotes({ manualNotesLibraryTabsCollapsed: value === true }),
        },
        manualNotesLibraryActivePanel: {
            get: () => getNotesSlice().manualNotesLibraryActivePanel || 'notes',
            set: (value) => patchNotes({ manualNotesLibraryActivePanel: String(value || 'notes') }),
        },
        noteAnalysisWizard: {
            get: () => normalizeNoteAnalysisWizardState(getNotesSlice().noteAnalysisWizard),
            set: (value) => patchNotes({ noteAnalysisWizard: normalizeNoteAnalysisWizardState(value) }),
        },
        noteDetailKind: {
            get: () => getNotesSlice().noteDetailKind,
            set: (value) => patchNotes({ noteDetailKind: value }),
        },
        noteDetailMode: {
            get: () => getNotesSlice().noteDetailMode || 'edit',
            set: (value) => patchNotes({ noteDetailMode: value }),
        },
        activeNoteMenu: {
            get: () => getNotesSlice().activeNoteMenu,
            set: (value) => patchNotes({ activeNoteMenu: value }),
        },
        activeFlashcardNoteId: {
            get: () => getNotesSlice().activeFlashcardNoteId,
            set: (value) => patchNotes({ activeFlashcardNoteId: value }),
        },
        pendingFlashcardGeneration: {
            get: () => getNotesSlice().pendingFlashcardGeneration,
            set: (value) => patchNotes({ pendingFlashcardGeneration: value }),
        },
        pendingFlashcardGenerations: {
            get: () => {
                const pending = getNotesSlice().pendingFlashcardGenerations;
                return Array.isArray(pending) ? pending : [];
            },
            set: (value) => patchNotes({ pendingFlashcardGenerations: Array.isArray(value) ? value : [] }),
        },
        pendingQuizGenerations: {
            get: () => {
                const pending = getNotesSlice().pendingQuizGenerations;
                return Array.isArray(pending) ? pending : [];
            },
            set: (value) => patchNotes({ pendingQuizGenerations: Array.isArray(value) ? value : [] }),
        },
        pendingAnalysisGenerations: {
            get: () => {
                const pending = getNotesSlice().pendingAnalysisGenerations;
                return Array.isArray(pending) ? pending : [];
            },
            set: (value) => patchNotes({ pendingAnalysisGenerations: Array.isArray(value) ? value : [] }),
        },
        studioPomodoroVisible: {
            get: () => getNotesSlice().studioPomodoroVisible === true,
            set: (value) => patchNotes({ studioPomodoroVisible: value === true }),
        },
        studioPomodoroExpanded: {
            get: () => getNotesSlice().studioPomodoroExpanded !== false,
            set: (value) => patchNotes({ studioPomodoroExpanded: value !== false }),
        },
        quizGenerationConfig: {
            get: () => normalizeQuizGenerationConfig(getNotesSlice().quizGenerationConfig),
            set: (value) => patchNotes({ quizGenerationConfig: normalizeQuizGenerationConfig(value) }),
        },
        flashcardGenerationConfig: {
            get: () => normalizeFlashcardGenerationConfig(getNotesSlice().flashcardGenerationConfig),
            set: (value) => patchNotes({ flashcardGenerationConfig: normalizeFlashcardGenerationConfig(value) }),
        },
        quizPractice: {
            get: () => getNotesSlice().quizPractice || {
                noteId: null,
                currentIndex: 0,
                selectedOptionId: null,
                revealed: false,
            },
            set: (value) => patchNotes({ quizPractice: value }),
        },
        currentSelectedItem: {
            get: () => getCurrentSelectedItem() || { id: null, name: null, config: null },
        },
        agents: {
            get: () => getSessionSlice().agents || [],
        },
        topics: {
            get: () => getSessionSlice().topics || [],
        },
        currentTopicId: {
            get: () => getCurrentTopicId(),
        },
        currentChatHistory: {
            get: () => {
                const history = getCurrentChatHistory();
                return Array.isArray(history) ? history : [];
            },
        },
        settings: {
            get: () => getSettingsSlice().settings,
        },
        rightPanelMode: {
            get: () => getLayoutSlice().rightPanelMode,
        },
    });

    function normalizeNote(note = {}) {
        return normalizeStoredNote(note, {
            defaultAgentId: state.currentSelectedItem.id,
            defaultTopicId: state.currentTopicId,
        });
    }

    function getVisibleNotes() {
        return state.notesScope === 'agent' ? state.agentNotes : state.topicNotes;
    }

    function getGeneratedVisibleNotes() {
        return filterGeneratedNotes(getVisibleNotes());
    }

    function getManualLibrarySourceNotes() {
        const seenNoteIds = new Set();
        const sourceNotes = [
            ...(Array.isArray(state.allAgentManualNotes) ? state.allAgentManualNotes : []),
            ...(Array.isArray(state.agentNotes) ? state.agentNotes : []),
            ...(Array.isArray(state.topicNotes) ? state.topicNotes : []),
        ];

        return sourceNotes
            .map((note) => normalizeNote(note))
            .filter((note) => {
                const noteId = String(note?.id || '').trim();
                if (!noteId || seenNoteIds.has(noteId)) {
                    return false;
                }
                seenNoteIds.add(noteId);
                return true;
            });
    }

    function getManualLibraryAgentIdsWithNotes() {
        return new Set(
            filterManualNotes(getManualLibrarySourceNotes())
                .map((note) => String(note.agentId || '').trim())
                .filter(Boolean),
        );
    }

    function getManualLibrarySubjectFilters() {
        const agentIdsWithNotes = getManualLibraryAgentIdsWithNotes();
        const filters = (Array.isArray(state.agents) ? state.agents : [])
            .map((agent) => {
                const agentId = String(agent?.id || '').trim();
                if (!agentId || !agentIdsWithNotes.has(agentId)) {
                    return null;
                }
                return { id: agentId, label: agent?.name || agentId };
            })
            .filter(Boolean);
        const representedAgentIds = new Set(filters.map((filterItem) => filterItem.id));
        agentIdsWithNotes.forEach((agentId) => {
            if (!representedAgentIds.has(agentId)) {
                filters.push({ id: agentId, label: getAgentDisplayLabel(agentId) });
            }
        });
        return filters;
    }

    function resolveManualNotesLibraryFilter(filter = 'all') {
        const normalizedFilter = String(filter || 'all').trim() || 'all';
        if (normalizedFilter === 'all' || normalizedFilter === 'analysis') {
            return normalizedFilter;
        }
        return getManualLibraryAgentIdsWithNotes().has(normalizedFilter) ? normalizedFilter : 'all';
    }

    function getManualLibraryNotes(filterOverride = state.manualNotesLibraryFilter) {
        const filter = resolveManualNotesLibraryFilter(filterOverride);
        const notes = getManualLibrarySourceNotes();
        if (filter === 'analysis') {
            return notes.filter((note) => getNormalizedNoteKind(note) === 'analysis');
        }

        return filterManualNotes(filter === 'all'
            ? notes
            : notes.filter((note) => String(note.agentId || '') === filter));
    }

    function getActiveNote() {
        return getVisibleNotes().find((note) => note.id === state.activeNoteId)
            || state.topicNotes.find((note) => note.id === state.activeNoteId)
            || state.agentNotes.find((note) => note.id === state.activeNoteId)
            || state.allAgentManualNotes.find((note) => note.id === state.activeNoteId)
            || null;
    }

    function getAgentDisplayLabel(agentId) {
        const normalizedAgentId = String(agentId || '').trim();
        if (!normalizedAgentId) {
            return '未归类学科';
        }

        const agent = state.agents.find((item) => String(item?.id || '') === normalizedAgentId);
        if (agent?.name) {
            return agent.name;
        }
        if (String(state.currentSelectedItem?.id || '') === normalizedAgentId && state.currentSelectedItem?.name) {
            return state.currentSelectedItem.name;
        }
        return normalizedAgentId;
    }

    function getTopicDisplayLabel(topicId) {
        const normalizedTopicId = String(topicId || '').trim();
        if (!normalizedTopicId) {
            return '未归类话题';
        }

        const topic = state.topics.find((item) => item.id === normalizedTopicId);
        return topic?.name || normalizedTopicId;
    }

    function findNoteById(noteId) {
        if (!noteId) {
            return null;
        }

        return state.topicNotes.find((note) => note.id === noteId)
            || state.agentNotes.find((note) => note.id === noteId)
            || state.allAgentManualNotes.find((note) => note.id === noteId)
            || null;
    }

    function getAnalysisWizardSourceNotes() {
        const seenNoteIds = new Set();
        return filterManualNotes(getManualLibrarySourceNotes())
            .map((note) => normalizeNote(note))
            .filter((note) => {
                if (!note?.id || seenNoteIds.has(note.id)) {
                    return false;
                }
                seenNoteIds.add(note.id);
                return true;
            });
    }

    function getAnalysisWizardVisibleNotes() {
        const wizard = state.noteAnalysisWizard;
        const filter = String(wizard.subjectFilter || 'all');
        const notes = getAnalysisWizardSourceNotes();
        return filter === 'all'
            ? notes
            : notes.filter((note) => String(note.agentId || '') === filter);
    }

    function buildDefaultAnalysisTitle() {
        return `深度分析报告 ${new Date().toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).replace(/\//g, '-')}`;
    }

    function getCurrentDetailNote() {
        return state.activeFlashcardNoteId
            ? normalizeNote(findNoteById(state.activeFlashcardNoteId) || {})
            : (getActiveNote() ? normalizeNote(getActiveNote()) : null);
    }

    function resetQuizPracticeState(noteId = null) {
        state.quizPractice = {
            noteId: noteId || null,
            currentIndex: 0,
            selectedOptionId: null,
            revealed: false,
        };
    }

    function ensureQuizPracticeState(note) {
        if (!hasStructuredQuiz(note)) {
            resetQuizPracticeState(null);
            return null;
        }

        const itemCount = note.quizSet.items.length;
        const noteId = note.id || null;
        if (state.quizPractice.noteId !== noteId) {
            resetQuizPracticeState(noteId);
        }

        state.quizPractice = {
            ...state.quizPractice,
            currentIndex: Math.max(0, Math.min(Number(state.quizPractice.currentIndex || 0), itemCount - 1)),
        };
        return {
            currentIndex: state.quizPractice.currentIndex,
            selectedOptionId: state.quizPractice.selectedOptionId || null,
            revealed: state.quizPractice.revealed === true,
        };
    }

    function renderQuizMarkdown(target, markdown) {
        if (!target) {
            return;
        }

        target.innerHTML = renderMarkdownFragment(markdown);
        if (typeof windowObj.renderMathInElement === 'function') {
            windowObj.renderMathInElement(target, {
                delimiters: [
                    { left: '$$', right: '$$', display: true },
                    { left: '\\[', right: '\\]', display: true },
                    { left: '$', right: '$', display: false },
                    { left: '\\(', right: '\\)', display: false },
                ],
                throwOnError: false,
            });
        }
    }

    function renderRichNotePreview(target, normalized, markdown, emptyText) {
        if (!target) {
            return;
        }

        const contentMarkdown = String(markdown || '');
        const useSavedSnapshot = Boolean(
            normalized?.renderSnapshot
            && contentMarkdown === String(normalized.contentMarkdown || '')
        );
        const previewNote = {
            ...(normalized || {}),
            contentMarkdown,
            renderSnapshot: useSavedSnapshot ? normalized.renderSnapshot : null,
        };

        if (contentMarkdown.trim() && typeof messageRendererApi.mountRichNotePreview === 'function') {
            messageRendererApi.mountRichNotePreview(target, previewNote, {
                compact: false,
                emptyText,
            });
            return;
        }

        if (typeof messageRendererApi.cleanupNotePreviewMount === 'function') {
            messageRendererApi.cleanupNotePreviewMount(target);
        }
        target.innerHTML = contentMarkdown.trim()
            ? renderMarkdownFragment(contentMarkdown)
            : `<p>${emptyText}</p>`;
        if (contentMarkdown.trim() && typeof windowObj.renderMathInElement === 'function') {
            windowObj.renderMathInElement(target, {
                delimiters: [
                    { left: '$$', right: '$$', display: true },
                    { left: '\\[', right: '\\]', display: true },
                    { left: '$', right: '$', display: false },
                    { left: '\\(', right: '\\)', display: false },
                ],
                throwOnError: false,
            });
        }
    }

    function cleanupRichNotePreviews(root) {
        if (!root || typeof messageRendererApi.cleanupNotePreviewMount !== 'function') {
            return;
        }
        root.querySelectorAll?.('.unistudy-note-rich-preview, [data-note-analysis-preview]').forEach((node) => {
            messageRendererApi.cleanupNotePreviewMount(node);
        });
    }

    function renderCompactRichNotePreview(target, note) {
        if (!target) {
            return;
        }

        const normalized = normalizeNote(note);
        const contentMarkdown = String(normalized.contentMarkdown || '');
        const useSavedSnapshot = Boolean(
            normalized.renderSnapshot
            && contentMarkdown === String(normalized.contentMarkdown || '')
        );
        const previewNote = {
            ...normalized,
            renderSnapshot: useSavedSnapshot ? normalized.renderSnapshot : null,
        };

        if (contentMarkdown.trim() && typeof messageRendererApi.mountRichNotePreview === 'function') {
            messageRendererApi.mountRichNotePreview(target, previewNote, {
                compact: true,
                emptyText: '暂无内容。',
            });
            return;
        }

        if (typeof messageRendererApi.cleanupNotePreviewMount === 'function') {
            messageRendererApi.cleanupNotePreviewMount(target);
        }
        target.innerHTML = contentMarkdown.trim()
            ? renderMarkdownFragment(contentMarkdown)
            : '<p>暂无内容。</p>';
        if (contentMarkdown.trim() && typeof windowObj.renderMathInElement === 'function') {
            windowObj.renderMathInElement(target, {
                delimiters: [
                    { left: '$$', right: '$$', display: true },
                    { left: '\\[', right: '\\]', display: true },
                    { left: '$', right: '$', display: false },
                    { left: '\\(', right: '\\)', display: false },
                ],
                throwOnError: false,
            });
        }
    }

    function buildAnalysisPreviewMeta(note = null) {
        if (!note?.id) {
            return '未保存的草稿预览。';
        }

        const sourceCount = Array.isArray(note.sourceMessageIds) ? note.sourceMessageIds.length : 0;
        const refCount = Array.isArray(note.sourceDocumentRefs) ? note.sourceDocumentRefs.length : 0;
        const topicLabel = note.topicId ? ` · 话题 ${note.topicId}` : '';
        return `更新时间：${new Date(note.updatedAt || Date.now()).toLocaleString()}${topicLabel} · 来源消息 ${sourceCount} 条 · 来源资料 ${refCount} 条`;
    }

    function renderAnalysisPreview(note = getCurrentDetailNote()) {
        const normalized = note ? normalizeNote(note) : null;
        const draftTitle = String(el.noteTitleInput?.value || '').trim();
        const draftMarkdown = String(el.noteContentInput?.value || '');
        const title = draftTitle || normalized?.title || '深度分析报告';
        const markdown = draftMarkdown || normalized?.contentMarkdown || '';

        if (el.analysisPreviewTitle) {
            el.analysisPreviewTitle.textContent = title;
        }
        if (el.analysisPreviewContent) {
            renderRichNotePreview(el.analysisPreviewContent, normalized, markdown, '当前报告暂无内容。');
        }
        if (el.analysisPreviewMeta) {
            el.analysisPreviewMeta.textContent = buildAnalysisPreviewMeta(normalized);
        }
    }

    function renderNoteMarkdownPreview(note = getCurrentDetailNote()) {
        const normalized = note ? normalizeNote(note) : null;
        const draftTitle = String(el.noteTitleInput?.value || '').trim();
        const draftMarkdown = String(el.noteContentInput?.value || '');
        const title = draftTitle || normalized?.title || 'Markdown 渲染预览';
        const markdown = draftMarkdown || normalized?.contentMarkdown || '';

        if (el.noteMarkdownPreviewTitle) {
            el.noteMarkdownPreviewTitle.textContent = title;
        }
        if (el.noteMarkdownPreviewContent) {
            renderRichNotePreview(el.noteMarkdownPreviewContent, normalized, markdown, '当前笔记暂无内容。');
        }
        if (el.noteMarkdownPreviewMeta) {
            el.noteMarkdownPreviewMeta.textContent = buildAnalysisPreviewMeta(normalized);
        }
    }

    function isWrongQuizAnswerState({ revealed = false, selectedOptionId = null, correctOptionId = '' } = {}) {
        return revealed === true && Boolean(selectedOptionId) && selectedOptionId !== correctOptionId;
    }

    function renderQuizPractice(note = getCurrentDetailNote()) {
        const normalized = note ? normalizeNote(note) : null;
        const practiceState = ensureQuizPracticeState(normalized);

        if (!hasStructuredQuiz(normalized) || !practiceState) {
            el.quizPracticeTitle && (el.quizPracticeTitle.textContent = '选择题练习');
            el.quizPracticeSummary && (el.quizPracticeSummary.textContent = '当前题目暂时无法解析，请切换到编辑原文。');
            el.quizPracticeProgress && (el.quizPracticeProgress.textContent = '0 / 0');
            el.quizPracticeQuestionIndex && (el.quizPracticeQuestionIndex.textContent = '第 0 题');
            if (el.quizPracticeStem) {
                el.quizPracticeStem.innerHTML = '<p>当前题目暂时无法解析，请切换到“编辑原文”检查格式。</p>';
            }
            if (el.quizPracticeOptions) {
                el.quizPracticeOptions.innerHTML = '';
            }
            el.quizPracticeFeedback?.classList.add('hidden');
            el.quizPracticePrevBtn?.toggleAttribute('disabled', true);
            el.quizPracticeNextBtn?.toggleAttribute('disabled', true);
            return;
        }

        const quizSet = normalized.quizSet;
        const currentIndex = practiceState.currentIndex;
        const item = quizSet.items[currentIndex];
        const selectedOptionId = practiceState.selectedOptionId;
        const revealed = practiceState.revealed;
        const correctOption = item.options.find((option) => option.id === item.correctOptionId) || null;
        const sourceCount = flashcardsApi.getFlashcardSourceCount(normalized);
        const selectedOption = item.options.find((option) => option.id === selectedOptionId) || null;
        const answeredCorrectly = revealed && selectedOptionId === item.correctOptionId;
        const wrongAnswerRevealed = isWrongQuizAnswerState({
            revealed,
            selectedOptionId,
            correctOptionId: item.correctOptionId,
        });

        if (el.quizPracticeTitle) {
            el.quizPracticeTitle.textContent = quizSet.title || normalized.title || '选择题练习';
        }
        if (el.quizPracticeSummary) {
            el.quizPracticeSummary.textContent = `${sourceCount > 0 ? `${sourceCount} 个来源` : '当前话题'} · 共 ${quizSet.items.length} 题`;
        }
        if (el.quizPracticeProgress) {
            el.quizPracticeProgress.textContent = `${currentIndex + 1} / ${quizSet.items.length}`;
        }
        if (el.quizPracticeQuestionIndex) {
            el.quizPracticeQuestionIndex.textContent = `第 ${currentIndex + 1} 题`;
        }
        renderQuizMarkdown(el.quizPracticeStem, item.stem);

        if (el.quizPracticeOptions) {
            el.quizPracticeOptions.innerHTML = item.options.map((option) => {
                const classes = ['quiz-practice__option'];
                if (selectedOptionId === option.id) {
                    classes.push('quiz-practice__option--selected');
                }
                if (revealed && option.id === item.correctOptionId) {
                    classes.push('quiz-practice__option--correct');
                } else if (revealed && selectedOptionId === option.id && option.id !== item.correctOptionId) {
                    classes.push('quiz-practice__option--incorrect');
                }

                const statusIcon = revealed
                    ? (
                        option.id === item.correctOptionId
                            ? 'check_circle'
                            : (selectedOptionId === option.id ? 'cancel' : 'radio_button_unchecked')
                    )
                    : 'radio_button_unchecked';

                return `
                    <button
                        type="button"
                        class="${classes.join(' ')}"
                        data-quiz-option-id="${option.id}"
                        ${revealed ? 'disabled' : ''}
                    >
                        <span class="quiz-practice__option-label">${option.label}</span>
                        <div class="quiz-practice__option-text">${renderMarkdownFragment(option.text)}</div>
                        <span class="quiz-practice__option-status material-symbols-outlined" aria-hidden="true">${statusIcon}</span>
                    </button>
                `;
            }).join('');
        }

        if (el.quizPracticeFeedback) {
            el.quizPracticeFeedback.classList.toggle('hidden', !revealed);
            el.quizPracticeFeedback.classList.toggle('quiz-practice__feedback--correct', answeredCorrectly);
            el.quizPracticeFeedback.classList.toggle('quiz-practice__feedback--incorrect', revealed && !answeredCorrectly);
        }
        if (el.quizPracticeResult) {
            el.quizPracticeResult.textContent = !revealed
                ? '请选择答案'
                : (answeredCorrectly ? '回答正确' : '回答错误');
        }
        if (el.quizPracticeAnswer) {
            el.quizPracticeAnswer.textContent = revealed
                ? `正确答案：${correctOption?.label || ''}${selectedOption && !answeredCorrectly ? ` · 你选择了 ${selectedOption.label}` : ''}`
                : '';
        }
        renderQuizMarkdown(el.quizPracticeExplanation, revealed ? item.explanation : '');
        if (el.quizPracticePrevBtn) {
            el.quizPracticePrevBtn.innerHTML = wrongAnswerRevealed
                ? '<span class="material-symbols-outlined">replay</span> 重新答题'
                : '<span class="material-symbols-outlined">arrow_back</span> 上一题';
        }
        el.quizPracticePrevBtn?.toggleAttribute('disabled', wrongAnswerRevealed ? false : currentIndex <= 0);
        el.quizPracticeNextBtn?.toggleAttribute('disabled', currentIndex >= quizSet.items.length - 1 || !answeredCorrectly);
    }

    function setQuizPracticeIndex(nextIndex) {
        const note = getCurrentDetailNote();
        if (!hasStructuredQuiz(note)) {
            return;
        }

        const maxIndex = note.quizSet.items.length - 1;
        state.quizPractice = {
            noteId: note.id,
            currentIndex: Math.max(0, Math.min(Number(nextIndex || 0), maxIndex)),
            selectedOptionId: null,
            revealed: false,
        };
        renderQuizPractice(note);
    }

    function resetCurrentQuizAttempt() {
        const note = getCurrentDetailNote();
        if (!hasStructuredQuiz(note)) {
            return;
        }

        state.quizPractice = {
            ...state.quizPractice,
            noteId: note.id,
            selectedOptionId: null,
            revealed: false,
        };
        renderQuizPractice(note);
    }

    function revealQuizOption(optionId) {
        const note = getCurrentDetailNote();
        if (!hasStructuredQuiz(note) || state.noteDetailMode !== 'practice' || state.quizPractice.revealed) {
            return;
        }

        state.quizPractice = {
            ...state.quizPractice,
            noteId: note.id,
            selectedOptionId: String(optionId || ''),
            revealed: true,
        };
        renderQuizPractice(note);
    }

    function setNoteDetailMode(mode) {
        const note = getCurrentDetailNote();
        if (state.noteDetailKind === 'quiz') {
            if (mode === 'practice' && !hasStructuredQuiz(note)) {
                state.noteDetailMode = 'edit';
            } else {
                state.noteDetailMode = mode === 'practice' ? 'practice' : 'edit';
            }
        } else if (state.noteDetailKind === 'analysis') {
            state.noteDetailMode = mode === 'view' ? 'view' : 'edit';
        } else if (state.noteDetailKind === 'note') {
            state.noteDetailMode = mode === 'view' ? 'view' : 'edit';
        } else {
            state.noteDetailMode = 'edit';
        }

        notesDomApi.syncNoteDetailChrome(note);
        if (state.noteDetailKind === 'quiz' && state.noteDetailMode === 'practice') {
            renderQuizPractice(note);
        }
        if (state.noteDetailKind === 'analysis' && state.noteDetailMode === 'view') {
            renderAnalysisPreview(note);
        }
        if (state.noteDetailKind === 'note' && state.noteDetailMode === 'view') {
            renderNoteMarkdownPreview(note);
        }
    }

    function patchCurrentHistoryMessage(messageId, updater) {
        let nextMessage = null;
        updateCurrentChatHistory((history = []) => history.map((item) => {
            if (item?.id !== messageId) {
                return item;
            }

            nextMessage = updater({ ...item });
            return nextMessage;
        }));
        return nextMessage;
    }

    function getNoteHighlightId() {
        return state.activeFlashcardNoteId || state.activeNoteId;
    }

    function replaceNoteInCollections(note) {
        if (!note) {
            return null;
        }

        const normalized = normalizeNote(note);
        const replaceInList = (list) => {
            const nextList = list.map((item) => (item.id === normalized.id ? normalized : item));
            if (!nextList.some((item) => item.id === normalized.id)) {
                nextList.unshift(normalized);
            }
            return nextList;
        };

        state.topicNotes = replaceInList(state.topicNotes);
        state.agentNotes = replaceInList(state.agentNotes);
        return normalized;
    }

    function openNoteDetail(note = null, options = {}) {
        const normalized = note ? normalizeNote(note) : null;
        const requestedKind = options.kind || getNormalizedNoteKind(normalized);
        if (options.trigger instanceof HTMLElementCtor) {
            noteDetailTrigger = options.trigger;
        }

        const openedFromManualNotes = options.returnTo === 'manual-notes'
            || state.manualNotesLibraryOpen === true
            || (
                options.trigger instanceof ElementCtor
                && Boolean(options.trigger.closest?.('.manual-note-card'))
            );
        noteDetailReturnTarget = openedFromManualNotes ? 'manual-notes' : 'studio';

        if (state.manualNotesLibraryOpen && !openedFromManualNotes) {
            closeManualNotesLibrary({ restoreFocus: false });
        }

        state.notesStudioView = 'detail';
        state.noteDetailKind = requestedKind;
        state.noteDetailMode = requestedKind === 'quiz' && hasStructuredQuiz(normalized)
            ? 'practice'
            : (
                requestedKind === 'analysis' && normalized?.id
                    ? 'view'
                    : (requestedKind === 'note' && normalized?.id ? 'view' : 'edit')
            );
        resetQuizPracticeState(normalized?.id || null);
        el.noteDetailModal?.classList.remove('hidden');
        el.noteDetailModal?.classList.add('note-detail-modal--open');
        el.noteDetailModal?.setAttribute('aria-hidden', 'false');
        documentObj.body?.classList.add('note-detail-open');

        if (requestedKind === 'flashcards') {
            if (normalized?.id) {
                replaceNoteInCollections(normalized);
                flashcardsApi.activateNote(normalized);
            } else {
                flashcardsApi.resetState({ clearPending: false });
            }
            notesDomApi.syncNoteDetailChrome(normalized);
            flashcardsApi.renderPractice();
        } else {
            flashcardsApi.resetState({ clearPending: false });
            setRightPanelMode('notes');
            if (normalized) {
                notesDomApi.fillNoteEditor(normalized);
            } else {
                notesDomApi.clearNoteEditor();
                if (el.noteTitleInput) {
                    el.noteTitleInput.value = buildBlankNoteTitle({
                        currentTopicName: getCurrentTopicDisplayName(),
                        hasCurrentTopic: Boolean(state.currentTopicId),
                    });
                }
                if (el.noteMetaSummary) {
                    el.noteMetaSummary.textContent = '新建笔记将保存到当前话题，并自动归档到当前学科汇总。';
                }
            }
            if (requestedKind === 'analysis') {
                renderAnalysisPreview(normalized);
            }
            if (requestedKind === 'note' && state.noteDetailMode === 'view') {
                renderNoteMarkdownPreview(normalized);
            }
            if (requestedKind === 'quiz') {
                renderQuizPractice(normalized);
            }
            notesDomApi.syncNoteDetailChrome(normalized);
        }

        el.noteDetailCloseBtn?.focus();
        notesDomApi.renderNotesPanel();
    }

    function closeNoteDetail(options = {}) {
        const returnTarget = options.returnTarget || noteDetailReturnTarget;
        state.notesStudioView = 'overview';
        state.noteDetailKind = null;
        state.noteDetailMode = 'edit';
        resetQuizPracticeState(null);
        setRightPanelMode('notes');
        el.noteDetailModal?.classList.add('hidden');
        el.noteDetailModal?.classList.remove('note-detail-modal--open');
        el.noteDetailModal?.setAttribute('aria-hidden', 'true');
        documentObj.body?.classList.remove('note-detail-open');
        if (
            options.restoreFocus !== false
            && returnTarget !== 'manual-notes'
            && noteDetailTrigger instanceof HTMLElementCtor
            && documentObj.body?.contains(noteDetailTrigger)
        ) {
            noteDetailTrigger.focus();
        }
        noteDetailTrigger = null;
        noteDetailReturnTarget = 'studio';
        notesDomApi.closeNoteActionMenu();
        if (options.restoreReturnTarget !== false && returnTarget === 'manual-notes') {
            void openManualNotesLibrary({ restoreFocus: false, skipDetailClose: true });
        }
    }

    function revealNote(note) {
        if (!note) {
            return;
        }

        openNoteDetail(note);
        notesDomApi.renderNotesPanel();
    }

    function getSelectedNotes(noteIds = null) {
        const requestedIds = Array.isArray(noteIds)
            ? noteIds
            : (Array.isArray(state.selectedNoteIds) ? state.selectedNoteIds : []);
        const normalizedIds = requestedIds
            .map((id) => String(id || '').trim())
            .filter(Boolean);
        if (normalizedIds.length === 0) {
            return [];
        }

        const noteMap = new Map();
        const allNotes = [
            ...state.topicNotes,
            ...state.agentNotes,
            ...state.allAgentManualNotes,
        ];
        allNotes.forEach((note) => {
            const noteId = String(note?.id || '').trim();
            if (!noteId || noteMap.has(noteId)) {
                return;
            }
            noteMap.set(noteId, normalizeNote(note));
        });

        const seenNoteIds = new Set();
        return normalizedIds
            .map((id) => noteMap.get(id))
            .filter((note) => {
                if (!note?.id || seenNoteIds.has(note.id)) {
                    return false;
                }
                seenNoteIds.add(note.id);
                return true;
            });
    }

    function toggleNoteSelection(noteId) {
        const normalizedId = String(noteId || '').trim();
        if (!normalizedId) {
            return;
        }

        if (state.selectedNoteIds.includes(normalizedId)) {
            state.selectedNoteIds = state.selectedNoteIds.filter((id) => id !== normalizedId);
        } else {
            state.selectedNoteIds = [...state.selectedNoteIds, normalizedId];
        }

        notesDomApi.renderNotesPanel();
        if (state.manualNotesLibraryOpen) {
            notesDomApi.renderManualNotesLibrary();
        }
    }

    function setManualNotesLibraryFilter(filter = 'all') {
        const nextFilter = resolveManualNotesLibraryFilter(filter);
        state.manualNotesLibraryFilter = nextFilter;
        notesDomApi.renderManualNotesLibrary();
        onManualNotesLibraryFilterChange(nextFilter);
    }

    function getPendingAnalysisGenerations() {
        return Array.isArray(state.pendingAnalysisGenerations)
            ? state.pendingAnalysisGenerations
            : [];
    }

    function beginPendingAnalysisGeneration(payload = {}) {
        const requestId = String(payload.requestId || '').trim();
        if (!requestId) {
            return;
        }

        state.pendingAnalysisGenerations = [
            ...getPendingAnalysisGenerations().filter((pending) => pending?.requestId !== requestId),
            {
                requestId,
                title: String(payload.title || '深度分析报告'),
                agentId: String(payload.agentId || ''),
                topicId: String(payload.topicId || ''),
                selectedNoteCount: Number(payload.selectedNoteCount || 0),
                startedAt: Number(payload.startedAt || Date.now()),
            },
        ];
        if (state.manualNotesLibraryOpen) {
            notesDomApi.renderManualNotesLibrary();
        }
    }

    function clearPendingAnalysisGeneration(requestId) {
        const normalizedRequestId = String(requestId || '').trim();
        const currentPending = getPendingAnalysisGenerations();
        const nextPending = normalizedRequestId
            ? currentPending.filter((pending) => pending?.requestId !== normalizedRequestId)
            : [];
        if (nextPending.length === currentPending.length) {
            return;
        }
        state.pendingAnalysisGenerations = nextPending;
        if (state.manualNotesLibraryOpen) {
            notesDomApi.renderManualNotesLibrary();
        }
    }

    async function openManualNotesLibrary(options = {}) {
        if (options.trigger instanceof HTMLElementCtor) {
            manualNotesLibraryTrigger = options.trigger;
        }
        if (!el.manualNotesLibraryPage && !el.manualNotesLibraryModal) {
            return;
        }

        if (
            options.skipDetailClose !== true
            && el.noteDetailModal
            && !el.noteDetailModal.classList.contains('hidden')
        ) {
            closeNoteDetail({ restoreFocus: false });
        }

        const wasManualNotesLibraryOpen = state.manualNotesLibraryOpen;
        state.manualNotesLibraryOpen = true;
        notesDomApi.renderManualNotesLibrary({ forcePreviewRemount: !wasManualNotesLibraryOpen });
        patchLayout({ workspaceViewMode: 'manual-notes' });
        showManualNotesLibraryPage();
        el.manualNotesLibraryModal?.classList.remove('hidden');
        el.manualNotesLibraryModal?.setAttribute('aria-hidden', 'false');
        documentObj.body?.classList.add('manual-notes-library-open');
        el.manualNotesLibrarySubjectTabs?.querySelector('.manual-notes-library-page__subject-tab--active')?.focus();

        // Re-read persisted notes so externally added notes appear without a full app reload.
        void notesOperationsApi.loadAllAgentManualNotes();
        void notesOperationsApi.loadAgentNotes();
        void notesOperationsApi.loadTopicNotes();
    }

    function closeManualNotesLibrary(options = {}) {
        state.manualNotesLibraryOpen = false;
        patchLayout({ workspaceViewMode: state.currentSelectedItem?.id ? 'subject' : 'overview' });
        syncWorkspaceView();
        el.manualNotesLibraryModal?.classList.add('hidden');
        el.manualNotesLibraryModal?.setAttribute('aria-hidden', 'true');
        documentObj.body?.classList.remove('manual-notes-library-open');
        if (
            options.restoreFocus !== false
            && manualNotesLibraryTrigger instanceof HTMLElementCtor
            && documentObj.body?.contains(manualNotesLibraryTrigger)
        ) {
            manualNotesLibraryTrigger.focus();
        }
        manualNotesLibraryTrigger = null;
    }

    function createBlankNote() {
        openNoteDetail(null, {
            kind: 'note',
            trigger: documentObj.activeElement instanceof HTMLElementCtor ? documentObj.activeElement : null,
        });
        notesDomApi.renderNotesPanel();
    }

    function patchNoteAnalysisWizard(patch) {
        const current = state.noteAnalysisWizard;
        state.noteAnalysisWizard = {
            ...current,
            ...(typeof patch === 'function' ? patch(current) : patch),
        };
    }

    function getNoteAnalysisSelectedNotes(wizard = state.noteAnalysisWizard) {
        return getSelectedNotes(wizard.selectedNoteIds);
    }

    function renderNoteAnalysisStepIndicator(wizard) {
        if (!el.noteAnalysisStepIndicator) {
            return;
        }

        el.noteAnalysisStepIndicator.innerHTML = NOTE_ANALYSIS_STEPS.map((step) => {
            const active = step.id === wizard.step;
            const complete = step.id < wizard.step || (step.id === 4 && Boolean(wizard.savedNote));
            return `
                <div class="note-analysis-step${active ? ' note-analysis-step--active' : ''}${complete ? ' note-analysis-step--complete' : ''}" aria-current="${active ? 'step' : 'false'}">
                    <span class="note-analysis-step__number" aria-hidden="true">${escapeHtml(step.id)}</span>
                    <span class="note-analysis-step__label">${escapeHtml(step.label)}</span>
                </div>
            `;
        }).join('');
    }

    function renderNoteAnalysisBasicStep(wizard) {
        return `
            <section class="note-analysis-panel">
                <div class="note-analysis-panel__heading">
                    <span class="material-symbols-outlined">settings</span>
                    <div>
                        <h3>基本设置</h3>
                        <p class="settings-caption">分析报告会保存到“我的笔记”的深度分析分类中。</p>
                    </div>
                </div>
                <label class="note-analysis-field" for="noteAnalysisTitleInput">
                    <span>报告名称</span>
                    <input id="noteAnalysisTitleInput" type="text" value="${escapeHtml(wizard.title || buildDefaultAnalysisTitle())}" placeholder="输入本次深度分析的名称" />
                </label>
                <div class="note-analysis-target">
                    <span class="material-symbols-outlined">drive_file_move</span>
                    <div>
                        <strong>保存位置</strong>
                        <p>我的笔记 / 深度分析</p>
                        <small>生成开始后会自动切换到这里，并在列表中显示生成进度。</small>
                    </div>
                </div>
            </section>
        `;
    }

    function renderNoteAnalysisSubjectFilters(wizard) {
        const notes = getAnalysisWizardSourceNotes();
        const agentIds = [...new Set(notes.map((note) => String(note.agentId || '').trim()).filter(Boolean))];
        const tabs = [
            { id: 'all', label: '全部' },
            ...agentIds.map((agentId) => ({ id: agentId, label: getAgentDisplayLabel(agentId) })),
        ];
        return `
            <div class="note-analysis-filter" role="tablist" aria-label="按学科筛选分析笔记">
                ${tabs.map((tab) => {
                    const active = String(wizard.subjectFilter || 'all') === tab.id;
                    return `
                        <button
                            type="button"
                            class="note-analysis-filter__btn${active ? ' note-analysis-filter__btn--active' : ''}"
                            data-note-analysis-filter="${escapeHtml(tab.id)}"
                            aria-selected="${active ? 'true' : 'false'}"
                            role="tab"
                        >${escapeHtml(tab.label)}</button>
                    `;
                }).join('')}
            </div>
        `;
    }

    function renderNoteAnalysisSelectStep(wizard) {
        const visibleNotes = getAnalysisWizardVisibleNotes();
        const selectedIds = new Set(wizard.selectedNoteIds);
        const selectedCount = wizard.selectedNoteIds.length;
        const cards = visibleNotes.map((note) => {
            const selected = selectedIds.has(note.id);
            const disabled = !selected && selectedCount >= NOTE_ANALYSIS_MAX_SELECTION;
            const topicLabel = getTopicDisplayLabel(note.topicId);
            return `
                <article
                    class="note-analysis-note-card${selected ? ' note-analysis-note-card--selected' : ''}${disabled ? ' note-analysis-note-card--disabled' : ''}"
                    data-note-analysis-note-id="${escapeHtml(note.id)}"
                    role="button"
                    tabindex="0"
                    aria-pressed="${selected ? 'true' : 'false'}"
                    aria-label="${escapeHtml(`${selected ? '取消选择' : '选择'} ${note.title}`)}"
                >
                    <div class="note-analysis-note-card__header">
                        <span class="note-analysis-note-card__check material-symbols-outlined" aria-hidden="true">${selected ? 'check_box' : 'check_box_outline_blank'}</span>
                        <span class="note-analysis-note-card__body">
                            <strong>${escapeHtml(note.title)}</strong>
                        </span>
                    </div>
                    <div class="manual-note-card__preview note-analysis-note-card__preview" data-note-analysis-preview="${escapeHtml(note.id)}"></div>
                    <div class="note-analysis-note-card__meta">
                        <span>${escapeHtml(getAgentDisplayLabel(note.agentId))}</span>
                        <span>${escapeHtml(topicLabel)}</span>
                    </div>
                </article>
            `;
        }).join('');

        return `
            <section class="note-analysis-panel">
                <div class="note-analysis-panel__heading">
                    <span class="material-symbols-outlined">library_books</span>
                    <div>
                        <h3>选择笔记 (<span data-note-analysis-selected-count>${selectedCount}</span> / ${NOTE_ANALYSIS_MAX_SELECTION})</h3>
                        <p class="settings-caption">勾选需要一起分析的笔记，可以跨话题、跨学科选择。</p>
                    </div>
                </div>
                ${renderNoteAnalysisSubjectFilters(wizard)}
                ${visibleNotes.length > 0
                    ? `<div class="note-analysis-note-grid">${cards}</div>`
                    : `
                        <div class="empty-list-state note-analysis-empty">
                            <strong>还没有可分析的笔记</strong>
                            <span>先在对话页面对想沉淀的消息右键，选择“记入笔记”，再回到这里进行综合分析。</span>
                        </div>
                    `}
            </section>
        `;
    }

    function renderNoteAnalysisSelectPreviews() {
        if (!el.noteAnalysisBody) {
            return;
        }

        const noteMap = new Map(getAnalysisWizardVisibleNotes().map((note) => [note.id, note]));
        el.noteAnalysisBody.querySelectorAll('[data-note-analysis-preview]').forEach((target) => {
            const noteId = target.getAttribute('data-note-analysis-preview');
            const note = noteMap.get(noteId);
            if (note) {
                renderCompactRichNotePreview(target, note);
            }
        });
    }

    function syncNoteAnalysisSelectState(wizard = state.noteAnalysisWizard) {
        if (!el.noteAnalysisBody || wizard.step !== 2) {
            return;
        }

        const selectedIds = new Set(wizard.selectedNoteIds);
        const selectedCount = wizard.selectedNoteIds.length;
        const countNode = el.noteAnalysisBody.querySelector('[data-note-analysis-selected-count]');
        if (countNode) {
            countNode.textContent = String(selectedCount);
        }

        el.noteAnalysisBody.querySelectorAll('[data-note-analysis-note-id]').forEach((card) => {
            const noteId = String(card.getAttribute('data-note-analysis-note-id') || '').trim();
            const selected = selectedIds.has(noteId);
            const disabled = !selected && selectedCount >= NOTE_ANALYSIS_MAX_SELECTION;
            const title = card.querySelector('.note-analysis-note-card__body strong')?.textContent || '笔记';

            card.classList.toggle('note-analysis-note-card--selected', selected);
            card.classList.toggle('note-analysis-note-card--disabled', disabled);
            card.setAttribute('aria-pressed', selected ? 'true' : 'false');
            card.setAttribute('aria-disabled', disabled ? 'true' : 'false');
            card.setAttribute('aria-label', `${selected ? '取消选择' : '选择'} ${title}`);

            const check = card.querySelector('.note-analysis-note-card__check');
            if (check) {
                check.textContent = selected ? 'check_box' : 'check_box_outline_blank';
            }
        });
    }

    function renderNoteAnalysisGuidanceStep(wizard) {
        const selectedNotes = getNoteAnalysisSelectedNotes(wizard);
        return `
            <section class="note-analysis-panel">
                <div class="note-analysis-panel__heading">
                    <span class="material-symbols-outlined">edit_note</span>
                    <div>
                        <h3>设置指引</h3>
                        <p class="settings-caption">告诉 AI 本次分析应该更关注什么。</p>
                    </div>
                </div>
                <div class="note-analysis-template-row">
                    ${NOTE_ANALYSIS_GUIDANCE_TEMPLATES.map((template) => `
                        <button type="button" class="note-analysis-template" data-note-analysis-template="${escapeHtml(template)}">${escapeHtml(template)}</button>
                    `).join('')}
                </div>
                <label class="note-analysis-field" for="noteAnalysisGuidanceInput">
                    <span>分析指引</span>
                    <textarea id="noteAnalysisGuidanceInput" rows="7" placeholder="例如：帮我找出这些笔记之间可以迁移的学习方法，并指出接下来最该补的三个问题。">${escapeHtml(wizard.guidance)}</textarea>
                </label>
                <div class="note-analysis-selected-preview">
                    <strong>已选笔记 (${selectedNotes.length})</strong>
                    <div class="note-analysis-selected-list">
                        ${selectedNotes.map((note, index) => `
                            <span>
                                <b>${index + 1}</b>
                                ${escapeHtml(note.title)}
                                <small>${escapeHtml(getAgentDisplayLabel(note.agentId))} / ${escapeHtml(getTopicDisplayLabel(note.topicId))}</small>
                            </span>
                        `).join('')}
                    </div>
                </div>
            </section>
        `;
    }

    function renderNoteAnalysisResultStep(wizard) {
        if (wizard.generating) {
            return `
                <section class="note-analysis-panel note-analysis-generating">
                    <span class="material-symbols-outlined note-analysis-generating__icon">hourglass_top</span>
                    <h3>AI 正在分析中...</h3>
                    <p class="settings-caption">正在综合 ${wizard.selectedNoteIds.length} 条笔记，请稍候。</p>
                </section>
            `;
        }

        if (wizard.savedNote) {
            return `
                <section class="note-analysis-panel note-analysis-result">
                    <div class="note-analysis-result__header">
                        <span class="material-symbols-outlined">check_circle</span>
                        <div>
                            <h3>${escapeHtml(wizard.savedNote.title || wizard.title || '深度分析报告')}</h3>
                            <p class="settings-caption">已生成并保存到当前话题笔记。</p>
                        </div>
                    </div>
                    <article id="noteAnalysisResultContent" class="analysis-preview__content note-analysis-result__content"></article>
                </section>
            `;
        }

        return `
            <section class="note-analysis-panel note-analysis-error">
                <span class="material-symbols-outlined">error</span>
                <h3>分析生成失败</h3>
                <p>${escapeHtml(wizard.error || '请返回上一步检查选择和指引后重试。')}</p>
            </section>
        `;
    }

    function syncNoteAnalysisWizardActions(wizard) {
        const generating = wizard.generating === true;
        el.noteAnalysisCloseBtn?.toggleAttribute('disabled', generating);
        el.noteAnalysisCancelBtn?.toggleAttribute('disabled', generating);
        el.noteAnalysisPrevBtn?.toggleAttribute('disabled', generating);
        el.noteAnalysisNextBtn?.toggleAttribute('disabled', generating);
        el.noteAnalysisGenerateBtn?.toggleAttribute('disabled', generating);

        el.noteAnalysisPrevBtn?.classList.toggle('hidden', wizard.step <= 1 || generating || Boolean(wizard.savedNote));
        el.noteAnalysisNextBtn?.classList.toggle('hidden', wizard.step >= 3 || generating || Boolean(wizard.savedNote));
        el.noteAnalysisGenerateBtn?.classList.toggle('hidden', wizard.step !== 3 || generating || Boolean(wizard.savedNote));
        el.noteAnalysisOpenReportBtn?.classList.toggle('hidden', !(wizard.step === 4 && wizard.savedNote));
        if (el.noteAnalysisGenerateBtn) {
            el.noteAnalysisGenerateBtn.innerHTML = generating
                ? '<span class="material-symbols-outlined">hourglass_top</span> 创建中'
                : '<span class="material-symbols-outlined">auto_awesome</span> 创建分析';
        }
    }

    function renderNoteAnalysisWizard() {
        const wizard = state.noteAnalysisWizard;
        if (!el.noteAnalysisModal) {
            return;
        }

        if (!wizard.open) {
            el.noteAnalysisModal.classList.add('hidden');
            el.noteAnalysisModal.setAttribute('aria-hidden', 'true');
            documentObj.body?.classList.remove('note-analysis-open');
            return;
        }

        el.noteAnalysisModal.classList.remove('hidden');
        el.noteAnalysisModal.setAttribute('aria-hidden', 'false');
        documentObj.body?.classList.add('note-analysis-open');
        renderNoteAnalysisStepIndicator(wizard);

        if (el.noteAnalysisBody) {
            cleanupRichNotePreviews(el.noteAnalysisBody);
            if (wizard.step === 1) {
                el.noteAnalysisBody.innerHTML = renderNoteAnalysisBasicStep(wizard);
            } else if (wizard.step === 2) {
                el.noteAnalysisBody.innerHTML = renderNoteAnalysisSelectStep(wizard);
                renderNoteAnalysisSelectPreviews();
            } else if (wizard.step === 3) {
                el.noteAnalysisBody.innerHTML = renderNoteAnalysisGuidanceStep(wizard);
            } else {
                el.noteAnalysisBody.innerHTML = renderNoteAnalysisResultStep(wizard);
                const resultContent = el.noteAnalysisBody.querySelector('#noteAnalysisResultContent');
                if (resultContent && wizard.savedNote) {
                    renderRichNotePreview(resultContent, wizard.savedNote, wizard.savedNote.contentMarkdown, '暂无报告内容。');
                }
            }
        }

        syncNoteAnalysisWizardActions(wizard);
    }

    async function openNoteAnalysisWizard(options = {}) {
        if (!state.currentSelectedItem.id || !state.currentTopicId) {
            ui.showToastNotification('请先选择一个智能体和话题。', 'warning');
            return;
        }
        if (!el.noteAnalysisModal) {
            return;
        }

        if (options.trigger instanceof HTMLElementCtor) {
            noteAnalysisTrigger = options.trigger;
        }

        closeTopicActionMenu();
        closeSourceFileActionMenu();
        notesDomApi.closeNoteActionMenu();
        if (el.noteDetailModal && !el.noteDetailModal.classList.contains('hidden')) {
            closeNoteDetail({ restoreFocus: false, restoreReturnTarget: false });
        }

        const selectedNoteIds = getSelectedNotes()
            .filter((note) => getNormalizedNoteKind(note) === 'note' || getNormalizedNoteKind(note) === 'message-note')
            .map((note) => note.id);
        state.noteAnalysisWizard = {
            ...createDefaultNoteAnalysisWizardState(),
            open: true,
            step: 1,
            title: buildDefaultAnalysisTitle(),
            selectedNoteIds,
        };
        renderNoteAnalysisWizard();
        el.noteAnalysisBody?.querySelector('#noteAnalysisTitleInput')?.focus?.();

        try {
            await notesOperationsApi.loadAllAgentManualNotes();
        } finally {
            if (state.noteAnalysisWizard.open) {
                renderNoteAnalysisWizard();
            }
        }
    }

    function closeNoteAnalysisWizard(options = {}) {
        const wizard = state.noteAnalysisWizard;
        if (wizard.generating && options.force !== true) {
            ui.showToastNotification('深度分析正在生成中，请稍候。', 'info');
            return;
        }

        state.noteAnalysisWizard = createDefaultNoteAnalysisWizardState();
        renderNoteAnalysisWizard();
        if (
            options.restoreFocus !== false
            && noteAnalysisTrigger instanceof HTMLElementCtor
            && documentObj.body?.contains(noteAnalysisTrigger)
        ) {
            noteAnalysisTrigger.focus();
        }
        noteAnalysisTrigger = null;
    }

    function readNoteAnalysisWizardFromControls() {
        const wizard = state.noteAnalysisWizard;
        return normalizeNoteAnalysisWizardState({
            ...wizard,
            title: el.noteAnalysisBody?.querySelector('#noteAnalysisTitleInput')?.value ?? wizard.title,
            guidance: el.noteAnalysisBody?.querySelector('#noteAnalysisGuidanceInput')?.value ?? wizard.guidance,
        });
    }

    function setNoteAnalysisWizardStep(step) {
        const current = readNoteAnalysisWizardFromControls();
        const nextStep = Math.max(1, Math.min(4, Number(step || 1)));
        if (nextStep > current.step && current.step <= 2 && current.selectedNoteIds.length === 0 && nextStep >= 3) {
            ui.showToastNotification('请先选择至少一条需要深度分析的笔记。', 'warning');
            renderNoteAnalysisWizard();
            return;
        }

        state.noteAnalysisWizard = {
            ...current,
            step: nextStep,
            title: current.title.trim() || buildDefaultAnalysisTitle(),
        };
        renderNoteAnalysisWizard();
        const focusTarget = nextStep === 1
            ? el.noteAnalysisBody?.querySelector('#noteAnalysisTitleInput')
            : (nextStep === 3 ? el.noteAnalysisBody?.querySelector('#noteAnalysisGuidanceInput') : null);
        focusTarget?.focus?.();
    }

    function toggleNoteAnalysisWizardNote(noteId) {
        const normalizedId = String(noteId || '').trim();
        if (!normalizedId) {
            return;
        }

        const wizard = readNoteAnalysisWizardFromControls();
        const selectedIds = wizard.selectedNoteIds;
        const selected = selectedIds.includes(normalizedId);
        if (!selected && selectedIds.length >= NOTE_ANALYSIS_MAX_SELECTION) {
            ui.showToastNotification(`最多只能选择 ${NOTE_ANALYSIS_MAX_SELECTION} 条笔记进行深度分析。`, 'warning');
            return;
        }

        state.noteAnalysisWizard = {
            ...wizard,
            selectedNoteIds: selected
                ? selectedIds.filter((id) => id !== normalizedId)
                : [...selectedIds, normalizedId],
        };
        if (state.noteAnalysisWizard.step === 2) {
            syncNoteAnalysisSelectState(state.noteAnalysisWizard);
            syncNoteAnalysisWizardActions(state.noteAnalysisWizard);
            return;
        }
        renderNoteAnalysisWizard();
    }

    function handleNoteAnalysisWizardBodyClick(event) {
        const target = event.target;
        if (!(target instanceof ElementCtor)) {
            return;
        }

        const filterButton = target.closest('[data-note-analysis-filter]');
        if (filterButton) {
            const wizard = readNoteAnalysisWizardFromControls();
            state.noteAnalysisWizard = {
                ...wizard,
                subjectFilter: filterButton.getAttribute('data-note-analysis-filter') || 'all',
            };
            renderNoteAnalysisWizard();
            return;
        }

        const templateButton = target.closest('[data-note-analysis-template]');
        if (templateButton) {
            const wizard = readNoteAnalysisWizardFromControls();
            state.noteAnalysisWizard = {
                ...wizard,
                guidance: templateButton.getAttribute('data-note-analysis-template') || '',
            };
            renderNoteAnalysisWizard();
            el.noteAnalysisBody?.querySelector('#noteAnalysisGuidanceInput')?.focus?.();
            return;
        }

        const noteCard = target.closest('[data-note-analysis-note-id]');
        if (noteCard) {
            toggleNoteAnalysisWizardNote(noteCard.getAttribute('data-note-analysis-note-id'));
        }
    }

    function handleNoteAnalysisWizardBodyKeydown(event) {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }
        const target = event.target;
        if (!(target instanceof ElementCtor)) {
            return;
        }
        const noteCard = target.closest('[data-note-analysis-note-id]');
        if (!noteCard) {
            return;
        }
        event.preventDefault();
        toggleNoteAnalysisWizardNote(noteCard.getAttribute('data-note-analysis-note-id'));
    }

    function handleNoteAnalysisWizardBodyInput(event) {
        const target = event.target;
        if (!(target instanceof ElementCtor)) {
            return;
        }

        const wizard = state.noteAnalysisWizard;
        if (target.id === 'noteAnalysisTitleInput') {
            patchNoteAnalysisWizard({ title: target.value });
        } else if (target.id === 'noteAnalysisGuidanceInput') {
            patchNoteAnalysisWizard({ guidance: target.value });
        }
    }

    async function submitNoteAnalysisWizard() {
        const wizard = readNoteAnalysisWizardFromControls();
        if (wizard.selectedNoteIds.length === 0) {
            ui.showToastNotification('请先选择至少一条需要深度分析的笔记。', 'warning');
            setNoteAnalysisWizardStep(2);
            return;
        }

        const title = wizard.title.trim() || buildDefaultAnalysisTitle();
        const requestId = createId('analysis_pending');
        const selectedNoteCount = wizard.selectedNoteIds.length;
        state.manualNotesLibraryFilter = 'analysis';
        beginPendingAnalysisGeneration({
            requestId,
            title,
            agentId: state.currentSelectedItem?.id,
            topicId: state.currentTopicId,
            selectedNoteCount,
            startedAt: Date.now(),
        });
        closeNoteAnalysisWizard({ force: true, restoreFocus: false });
        await openManualNotesLibrary({ trigger: el.manualNewNoteBtn || null, skipDetailClose: true });
        notesDomApi.renderManualNotesLibrary();

        try {
            const savedNote = await notesOperationsApi.runNotesTool('analysis', {
                selectedNoteIds: wizard.selectedNoteIds,
                requireSelectedNotes: true,
                guidance: wizard.guidance,
                title,
                openAfterSave: false,
                returnSavedNote: true,
                trigger: el.manualNewNoteBtn || null,
            });
            if (!savedNote || savedNote === true) {
                ui.showToastNotification('分析没有返回可保存的报告，请稍后重试。', 'warning');
                return;
            }

            state.manualNotesLibraryFilter = 'analysis';
            if (state.manualNotesLibraryOpen) {
                await notesOperationsApi.loadAllAgentManualNotes();
                notesDomApi.renderManualNotesLibrary();
            }
        } catch (error) {
            ui.showToastNotification(`生成失败：${error?.message || String(error)}`, 'error');
        } finally {
            clearPendingAnalysisGeneration(requestId);
        }
    }

    function openGeneratedAnalysisReport() {
        const savedNote = state.noteAnalysisWizard.savedNote;
        if (!savedNote) {
            return;
        }

        const trigger = el.noteAnalysisOpenReportBtn || null;
        closeNoteAnalysisWizard({ force: true, restoreFocus: false });
        openNoteDetail(savedNote, {
            kind: 'analysis',
            trigger,
            returnTo: 'manual-notes',
        });
    }

    function resetState(options = {}) {
        const clearTopicNotes = options.clearTopicNotes === true;
        const clearAgentNotes = options.clearAgentNotes === true;
        const clearSelection = options.clearSelection !== false;
        const clearActiveNote = options.clearActiveNote !== false;
        const closeDetailView = options.closeDetailView === true;
        const clearFlashcards = options.clearFlashcards !== false;

        if (closeDetailView) {
            closeNoteDetail({ restoreFocus: false, restoreReturnTarget: false });
        } else {
            notesDomApi.closeNoteActionMenu();
        }

        if (clearSelection) {
            state.selectedNoteIds = [];
        }
        if (clearTopicNotes) {
            state.topicNotes = [];
        }
        if (clearAgentNotes) {
            state.agentNotes = [];
            state.allAgentManualNotes = [];
        }
        if (clearActiveNote) {
            notesDomApi.clearNoteEditor();
        }
        if (clearFlashcards) {
            flashcardsApi.resetState();
        }
        if (state.manualNotesLibraryOpen) {
            closeManualNotesLibrary({ restoreFocus: false });
        }
        if (state.noteAnalysisWizard.open) {
            closeNoteAnalysisWizard({ force: true, restoreFocus: false });
        }
        if (el.quizConfigModal && !el.quizConfigModal.classList.contains('hidden')) {
            closeQuizConfigModal({ restoreFocus: false });
        }
        if (el.flashcardConfigModal && !el.flashcardConfigModal.classList.contains('hidden')) {
            closeFlashcardConfigModal({ restoreFocus: false });
        }
        state.noteDetailMode = 'edit';
        resetQuizPracticeState(null);

        notesDomApi.renderNotesPanel();
    }

    function setNotesScope(scope) {
        state.notesScope = 'topic';
        state.selectedNoteIds = [];
        notesDomApi.renderNotesPanel();
    }

    function openNotesStudio() {
        const note = getCurrentDetailNote();
        if (note) {
            openNoteDetail(note, { trigger: el.notesStudioOpenBtn });
        } else {
            openNoteDetail(null, { kind: 'note', trigger: el.notesStudioOpenBtn });
        }
    }

    function hasCurrentTopicSourceDocuments() {
        const currentTopic = getCurrentTopic();
        if (!currentTopic?.knowledgeBaseId) {
            return false;
        }

        const sourceSlice = store.getState().source || {};
        const topicDocuments = Array.isArray(sourceSlice.topicKnowledgeBaseDocuments)
            ? sourceSlice.topicKnowledgeBaseDocuments
            : [];
        const documentIds = topicDocuments
            .map((documentItem) => String(documentItem?.id || '').trim())
            .filter(Boolean);
        if (documentIds.length === 0) {
            return false;
        }

        const selectedIds = Array.isArray(currentTopic.selectedKnowledgeBaseDocumentIds)
            ? currentTopic.selectedKnowledgeBaseDocumentIds
                .map((id) => String(id || '').trim())
                .filter(Boolean)
            : null;
        return selectedIds === null
            ? true
            : selectedIds.some((id) => documentIds.includes(id));
    }

    function shouldDefaultIncludeChatContext() {
        return !hasCurrentTopicSourceDocuments();
    }

    function resolveIncludeChatContextForModalOpen(config, wasAutoDefaulted) {
        const shouldAutoDefault = shouldDefaultIncludeChatContext();
        if (shouldAutoDefault) {
            return {
                includeChatContext: true,
                autoDefaulted: config.includeChatContext !== true || wasAutoDefaulted,
            };
        }

        if (wasAutoDefaulted) {
            return {
                includeChatContext: false,
                autoDefaulted: false,
            };
        }

        return {
            includeChatContext: config.includeChatContext === true,
            autoDefaulted: false,
        };
    }

    function syncQuizConfigControls() {
        const config = state.quizGenerationConfig;
        Array.from(el.quizCountPresetBtns || []).forEach((button) => {
            const preset = button.getAttribute('data-quiz-count-preset');
            const active = preset === config.countPreset;
            button.classList.toggle('quiz-config-segment__btn--active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        Array.from(el.quizDifficultyBtns || []).forEach((button) => {
            const difficulty = button.getAttribute('data-quiz-difficulty');
            const active = difficulty === config.difficulty;
            button.classList.toggle('quiz-config-segment__btn--active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        if (el.quizFocusInput && el.quizFocusInput.value !== config.focus) {
            el.quizFocusInput.value = config.focus;
        }
        if (el.quizIncludeChatContextInput) {
            el.quizIncludeChatContextInput.checked = config.includeChatContext === true;
        }
    }

    function setQuizConfigGenerating(isGenerating) {
        const generating = isGenerating === true;
        el.quizConfigModal?.classList.toggle('quiz-config-modal--generating', generating);
        [
            el.quizConfigCloseBtn,
            el.quizConfigCancelBtn,
            el.quizConfigGenerateBtn,
            el.quizFocusInput,
            el.quizIncludeChatContextInput,
            ...Array.from(el.quizCountPresetBtns || []),
            ...Array.from(el.quizDifficultyBtns || []),
        ].forEach((control) => {
            control?.toggleAttribute('disabled', generating);
        });
        if (el.quizConfigGenerateBtn) {
            el.quizConfigGenerateBtn.innerHTML = generating
                ? '<span class="material-symbols-outlined">hourglass_top</span> 生成中'
                : '<span class="material-symbols-outlined">auto_awesome</span> 生成';
        }
    }

    function readQuizConfigFromControls() {
        return normalizeQuizGenerationConfig({
            ...state.quizGenerationConfig,
            focus: el.quizFocusInput?.value || '',
            includeChatContext: el.quizIncludeChatContextInput?.checked === true,
        });
    }

    function hasPendingQuizGenerationForCurrentTopic() {
        const agentId = String(state.currentSelectedItem?.id || '').trim();
        const topicId = String(state.currentTopicId || '').trim();
        if (!agentId || !topicId || !Array.isArray(state.pendingQuizGenerations)) {
            return false;
        }

        return state.pendingQuizGenerations.some((pending) => (
            pending
            && String(pending.agentId || '') === agentId
            && String(pending.topicId || '') === topicId
        ));
    }

    function openQuizConfigModal(options = {}) {
        if (hasPendingQuizGenerationForCurrentTopic()) {
            ui.showToastNotification('当前话题已有选择题正在生成，请稍候。', 'info');
            notesDomApi.renderNotesPanel();
            return;
        }

        if (options.trigger instanceof HTMLElementCtor) {
            quizConfigTrigger = options.trigger;
        }
        const normalizedConfig = normalizeQuizGenerationConfig(state.quizGenerationConfig);
        const includeChatContext = resolveIncludeChatContextForModalOpen(
            normalizedConfig,
            quizIncludeChatContextAutoDefaulted
        );
        quizIncludeChatContextAutoDefaulted = includeChatContext.autoDefaulted;
        state.quizGenerationConfig = normalizeQuizGenerationConfig({
            ...normalizedConfig,
            includeChatContext: includeChatContext.includeChatContext,
        });
        syncQuizConfigControls();
        closeTopicActionMenu();
        closeSourceFileActionMenu();
        notesDomApi.closeNoteActionMenu();
        el.quizConfigModal?.classList.remove('hidden');
        el.quizConfigModal?.setAttribute('aria-hidden', 'false');
        documentObj.body?.classList.add('quiz-config-open');
        setQuizConfigGenerating(false);
        (el.quizFocusInput || el.quizConfigGenerateBtn || el.quizConfigCloseBtn)?.focus?.();
    }

    function closeQuizConfigModal(options = {}) {
        el.quizConfigModal?.classList.add('hidden');
        el.quizConfigModal?.classList.remove('quiz-config-modal--generating');
        el.quizConfigModal?.setAttribute('aria-hidden', 'true');
        documentObj.body?.classList.remove('quiz-config-open');
        setQuizConfigGenerating(false);
        if (
            options.restoreFocus !== false
            && quizConfigTrigger instanceof HTMLElementCtor
            && documentObj.body?.contains(quizConfigTrigger)
        ) {
            quizConfigTrigger.focus();
        }
        quizConfigTrigger = null;
    }

    function updateQuizCountPreset(preset) {
        if (!Object.prototype.hasOwnProperty.call(QUIZ_COUNT_PRESETS, preset)) {
            return;
        }
        state.quizGenerationConfig = normalizeQuizGenerationConfig({
            ...state.quizGenerationConfig,
            countPreset: preset,
            questionCount: QUIZ_COUNT_PRESETS[preset],
        });
        syncQuizConfigControls();
    }

    function updateQuizDifficulty(difficulty) {
        if (!QUIZ_DIFFICULTIES.has(String(difficulty || ''))) {
            return;
        }
        state.quizGenerationConfig = normalizeQuizGenerationConfig({
            ...state.quizGenerationConfig,
            difficulty,
        });
        syncQuizConfigControls();
    }

    async function submitQuizConfigModal() {
        const config = readQuizConfigFromControls();
        state.quizGenerationConfig = config;
        syncQuizConfigControls();
        setQuizConfigGenerating(true);
        try {
            const generationPromise = notesOperationsApi.runNotesTool('quiz', config);
            closeQuizConfigModal({ restoreFocus: false });
            await generationPromise;
        } catch (error) {
            ui.showToastNotification(`生成失败：${error?.message || String(error)}`, 'error');
        } finally {
            setQuizConfigGenerating(false);
        }
    }

    function syncFlashcardConfigControls() {
        const config = state.flashcardGenerationConfig;
        Array.from(el.flashcardCountPresetBtns || []).forEach((button) => {
            const preset = button.getAttribute('data-flashcard-count-preset');
            const active = preset === config.countPreset;
            button.classList.toggle('quiz-config-segment__btn--active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        Array.from(el.flashcardDifficultyBtns || []).forEach((button) => {
            const difficulty = button.getAttribute('data-flashcard-difficulty');
            const active = difficulty === config.difficulty;
            button.classList.toggle('quiz-config-segment__btn--active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        if (el.flashcardFocusInput && el.flashcardFocusInput.value !== config.focus) {
            el.flashcardFocusInput.value = config.focus;
        }
        if (el.flashcardIncludeChatContextInput) {
            el.flashcardIncludeChatContextInput.checked = config.includeChatContext === true;
        }
    }

    function setFlashcardConfigGenerating(isGenerating) {
        const generating = isGenerating === true;
        el.flashcardConfigModal?.classList.toggle('quiz-config-modal--generating', generating);
        [
            el.flashcardConfigCloseBtn,
            el.flashcardConfigCancelBtn,
            el.flashcardConfigGenerateBtn,
            el.flashcardFocusInput,
            el.flashcardIncludeChatContextInput,
            ...Array.from(el.flashcardCountPresetBtns || []),
            ...Array.from(el.flashcardDifficultyBtns || []),
        ].forEach((control) => {
            control?.toggleAttribute('disabled', generating);
        });
        if (el.flashcardConfigGenerateBtn) {
            el.flashcardConfigGenerateBtn.innerHTML = generating
                ? '<span class="material-symbols-outlined">hourglass_top</span> 生成中'
                : '<span class="material-symbols-outlined">auto_awesome</span> 生成';
        }
    }

    function readFlashcardConfigFromControls() {
        return normalizeFlashcardGenerationConfig({
            ...state.flashcardGenerationConfig,
            focus: el.flashcardFocusInput?.value || '',
            includeChatContext: el.flashcardIncludeChatContextInput?.checked === true,
        });
    }

    function openFlashcardConfigModal(options = {}) {
        if (options.trigger instanceof HTMLElementCtor) {
            flashcardConfigTrigger = options.trigger;
        }
        const normalizedConfig = normalizeFlashcardGenerationConfig(state.flashcardGenerationConfig);
        const includeChatContext = resolveIncludeChatContextForModalOpen(
            normalizedConfig,
            flashcardIncludeChatContextAutoDefaulted
        );
        flashcardIncludeChatContextAutoDefaulted = includeChatContext.autoDefaulted;
        state.flashcardGenerationConfig = normalizeFlashcardGenerationConfig({
            ...normalizedConfig,
            includeChatContext: includeChatContext.includeChatContext,
        });
        syncFlashcardConfigControls();
        closeTopicActionMenu();
        closeSourceFileActionMenu();
        notesDomApi.closeNoteActionMenu();
        el.flashcardConfigModal?.classList.remove('hidden');
        el.flashcardConfigModal?.setAttribute('aria-hidden', 'false');
        documentObj.body?.classList.add('flashcard-config-open');
        setFlashcardConfigGenerating(false);
        (el.flashcardFocusInput || el.flashcardConfigGenerateBtn || el.flashcardConfigCloseBtn)?.focus?.();
    }

    function closeFlashcardConfigModal(options = {}) {
        el.flashcardConfigModal?.classList.add('hidden');
        el.flashcardConfigModal?.classList.remove('quiz-config-modal--generating');
        el.flashcardConfigModal?.setAttribute('aria-hidden', 'true');
        documentObj.body?.classList.remove('flashcard-config-open');
        setFlashcardConfigGenerating(false);
        if (
            options.restoreFocus !== false
            && flashcardConfigTrigger instanceof HTMLElementCtor
            && documentObj.body?.contains(flashcardConfigTrigger)
        ) {
            flashcardConfigTrigger.focus();
        }
        flashcardConfigTrigger = null;
    }

    function updateFlashcardCountPreset(preset) {
        if (!Object.prototype.hasOwnProperty.call(FLASHCARD_COUNT_PRESETS, preset)) {
            return;
        }
        state.flashcardGenerationConfig = normalizeFlashcardGenerationConfig({
            ...state.flashcardGenerationConfig,
            countPreset: preset,
            cardCount: FLASHCARD_COUNT_PRESETS[preset],
        });
        syncFlashcardConfigControls();
    }

    function updateFlashcardDifficulty(difficulty) {
        if (!QUIZ_DIFFICULTIES.has(String(difficulty || ''))) {
            return;
        }
        state.flashcardGenerationConfig = normalizeFlashcardGenerationConfig({
            ...state.flashcardGenerationConfig,
            difficulty,
        });
        syncFlashcardConfigControls();
    }

    async function submitFlashcardConfigModal() {
        const config = readFlashcardConfigFromControls();
        state.flashcardGenerationConfig = config;
        syncFlashcardConfigControls();
        setFlashcardConfigGenerating(true);
        try {
            const generationPromise = notesOperationsApi.runNotesTool('flashcards', config);
            closeFlashcardConfigModal({ restoreFocus: false });
            await generationPromise;
        } catch (error) {
            ui.showToastNotification(`生成失败：${error?.message || String(error)}`, 'error');
        } finally {
            setFlashcardConfigGenerating(false);
        }
    }

    function bindEvents() {
        documentObj.addEventListener('click', (event) => {
            const target = event.target;
            if (!state.activeNoteMenu) {
                return;
            }

            if (target instanceof ElementCtor && (target.closest('#noteActionMenu') || target.closest('[data-note-menu]'))) {
                return;
            }
            notesDomApi.closeNoteActionMenu();
        });
        documentObj.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') {
                return;
            }
            if (state.activeNoteMenu) {
                notesDomApi.closeNoteActionMenu();
            }
            if (el.quizConfigModal && !el.quizConfigModal.classList.contains('hidden')) {
                closeQuizConfigModal();
                return;
            }
            if (el.flashcardConfigModal && !el.flashcardConfigModal.classList.contains('hidden')) {
                closeFlashcardConfigModal();
                return;
            }
            if (state.noteAnalysisWizard.open) {
                closeNoteAnalysisWizard();
                return;
            }
            if (el.noteDetailModal && !el.noteDetailModal.classList.contains('hidden')) {
                closeNoteDetail();
                return;
            }
            if (state.manualNotesLibraryOpen) {
                closeManualNotesLibrary();
                return;
            }
        });
        el.notesList?.addEventListener('scroll', notesDomApi.closeNoteActionMenu);
        el.topicNotesScopeBtn?.addEventListener('click', () => setNotesScope('topic'));
        el.agentNotesScopeBtn?.addEventListener('click', () => setNotesScope('agent'));
        el.manualNewNoteBtn?.addEventListener('click', (event) => {
            void openNoteAnalysisWizard({ trigger: event.currentTarget });
        });
        el.notesStudioOpenBtn?.addEventListener('click', openNotesStudio);
        el.manualNotesLibraryBtn?.addEventListener('click', (event) => {
            void openManualNotesLibrary({ trigger: event.currentTarget });
        });
        el.manualNotesLibrarySubjectTabs?.addEventListener('click', (event) => {
            const tab = event.target.closest('[data-subject-filter]');
            if (tab) {
                const filter = tab.getAttribute('data-subject-filter') || 'all';
                if (state.manualNotesLibraryActivePanel === 'diary') {
                    setDiaryWallAgentFilter(filter);
                } else {
                    setManualNotesLibraryFilter(filter);
                }
            }
        });
        el.manualNotesLibrarySubjectToggle?.addEventListener('click', () => {
            state.manualNotesLibraryTabsCollapsed = !state.manualNotesLibraryTabsCollapsed;
            notesDomApi.renderManualNotesLibrary();
        });
        el.manualNotesLibraryCloseBtn?.addEventListener('click', () => {
            closeManualNotesLibrary();
        });
        el.saveNoteBtn?.addEventListener('click', () => {
            void notesOperationsApi.saveActiveNote();
        });
        el.analysisEditMarkdownBtn?.addEventListener('click', () => {
            setNoteDetailMode('edit');
        });
        el.analysisViewReportBtn?.addEventListener('click', () => {
            setNoteDetailMode('view');
        });
        el.noteEditMarkdownBtn?.addEventListener('click', () => {
            setNoteDetailMode('edit');
        });
        el.noteViewPreviewBtn?.addEventListener('click', () => {
            setNoteDetailMode('view');
        });
        el.quizEditSourceBtn?.addEventListener('click', () => {
            setNoteDetailMode('edit');
        });
        el.quizViewPracticeBtn?.addEventListener('click', () => {
            setNoteDetailMode('practice');
        });
        el.deleteNoteBtn?.addEventListener('click', () => {
            void notesOperationsApi.deleteActiveNote();
        });
        el.analyzeNotesBtn?.addEventListener('click', createBlankNote);
        el.noteAnalysisCloseBtn?.addEventListener('click', () => closeNoteAnalysisWizard());
        el.noteAnalysisCancelBtn?.addEventListener('click', () => closeNoteAnalysisWizard());
        el.noteAnalysisModalBackdrop?.addEventListener('click', () => closeNoteAnalysisWizard());
        el.noteAnalysisPrevBtn?.addEventListener('click', () => {
            setNoteAnalysisWizardStep(state.noteAnalysisWizard.step - 1);
        });
        el.noteAnalysisNextBtn?.addEventListener('click', () => {
            setNoteAnalysisWizardStep(state.noteAnalysisWizard.step + 1);
        });
        el.noteAnalysisGenerateBtn?.addEventListener('click', () => {
            void submitNoteAnalysisWizard();
        });
        el.noteAnalysisOpenReportBtn?.addEventListener('click', openGeneratedAnalysisReport);
        el.noteAnalysisBody?.addEventListener('click', handleNoteAnalysisWizardBodyClick);
        el.noteAnalysisBody?.addEventListener('keydown', handleNoteAnalysisWizardBodyKeydown);
        el.noteAnalysisBody?.addEventListener('input', handleNoteAnalysisWizardBodyInput);
        el.generateQuizBtn?.addEventListener('click', (event) => {
            openQuizConfigModal({ trigger: event.currentTarget });
        });
        el.quizConfigCloseBtn?.addEventListener('click', () => closeQuizConfigModal());
        el.quizConfigCancelBtn?.addEventListener('click', () => closeQuizConfigModal());
        el.quizConfigModalBackdrop?.addEventListener('click', () => closeQuizConfigModal());
        el.quizConfigGenerateBtn?.addEventListener('click', () => {
            void submitQuizConfigModal();
        });
        el.quizFocusInput?.addEventListener('input', () => {
            state.quizGenerationConfig = readQuizConfigFromControls();
        });
        el.quizIncludeChatContextInput?.addEventListener('change', () => {
            quizIncludeChatContextAutoDefaulted = false;
            state.quizGenerationConfig = readQuizConfigFromControls();
        });
        Array.from(el.quizCountPresetBtns || []).forEach((button) => {
            button.addEventListener('click', () => {
                updateQuizCountPreset(button.getAttribute('data-quiz-count-preset'));
            });
        });
        Array.from(el.quizDifficultyBtns || []).forEach((button) => {
            button.addEventListener('click', () => {
                updateQuizDifficulty(button.getAttribute('data-quiz-difficulty'));
            });
        });
        el.generateFlashcardsBtn?.addEventListener('click', (event) => {
            openFlashcardConfigModal({ trigger: event.currentTarget });
        });
        el.flashcardConfigCloseBtn?.addEventListener('click', () => closeFlashcardConfigModal());
        el.flashcardConfigCancelBtn?.addEventListener('click', () => closeFlashcardConfigModal());
        el.flashcardConfigModalBackdrop?.addEventListener('click', () => closeFlashcardConfigModal());
        el.flashcardConfigGenerateBtn?.addEventListener('click', () => {
            void submitFlashcardConfigModal();
        });
        el.flashcardFocusInput?.addEventListener('input', () => {
            state.flashcardGenerationConfig = readFlashcardConfigFromControls();
        });
        el.flashcardIncludeChatContextInput?.addEventListener('change', () => {
            flashcardIncludeChatContextAutoDefaulted = false;
            state.flashcardGenerationConfig = readFlashcardConfigFromControls();
        });
        Array.from(el.flashcardCountPresetBtns || []).forEach((button) => {
            button.addEventListener('click', () => {
                updateFlashcardCountPreset(button.getAttribute('data-flashcard-count-preset'));
            });
        });
        Array.from(el.flashcardDifficultyBtns || []).forEach((button) => {
            button.addEventListener('click', () => {
                updateFlashcardDifficulty(button.getAttribute('data-flashcard-difficulty'));
            });
        });
        el.openPomodoroBtn?.addEventListener('click', () => {
            const nextVisible = !state.studioPomodoroVisible;
            state.studioPomodoroVisible = nextVisible;
            if (nextVisible) {
                state.studioPomodoroExpanded = true;
            }
            el.openPomodoroBtn?.classList.toggle('notes-tool-tile--active', nextVisible);
            const pomodoroArrow = el.openPomodoroBtn?.querySelector('.notes-tool-tile__arrow');
            if (pomodoroArrow) {
                pomodoroArrow.textContent = nextVisible ? 'expand_more' : 'chevron_right';
            }
            notesDomApi?.renderNotesPanel?.();
            if (nextVisible) {
                el.studioPomodoroPanel?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });
        el.studioPomodoroToggleBtn?.addEventListener('click', () => {
            state.studioPomodoroExpanded = !state.studioPomodoroExpanded;
            notesDomApi?.renderNotesPanel?.();
        });
        el.studioPomodoroStartBtn?.addEventListener('click', (event) => {
            event.stopPropagation();
            startStudioPomodoro();
        });
        el.studioPomodoroPauseBtn?.addEventListener('click', (event) => {
            event.stopPropagation();
            pauseStudioPomodoro();
        });
        el.studioPomodoroResumeBtn?.addEventListener('click', (event) => {
            event.stopPropagation();
            resumeStudioPomodoro();
        });
        el.studioPomodoroResetBtn?.addEventListener('click', (event) => {
            event.stopPropagation();
            resetStudioPomodoro();
        });
        el.quizPracticeOptions?.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof ElementCtor)) {
                return;
            }

            const optionButton = target.closest('[data-quiz-option-id]');
            if (!(optionButton instanceof ElementCtor)) {
                return;
            }

            revealQuizOption(optionButton.getAttribute('data-quiz-option-id'));
        });
        el.quizPracticePrevBtn?.addEventListener('click', () => {
            const note = getCurrentDetailNote();
            const currentItem = hasStructuredQuiz(note)
                ? note.quizSet.items[state.quizPractice.currentIndex || 0]
                : null;
            if (currentItem && isWrongQuizAnswerState({
                revealed: state.quizPractice.revealed,
                selectedOptionId: state.quizPractice.selectedOptionId,
                correctOptionId: currentItem.correctOptionId,
            })) {
                resetCurrentQuizAttempt();
                return;
            }
            setQuizPracticeIndex((state.quizPractice.currentIndex || 0) - 1);
        });
        el.quizPracticeNextBtn?.addEventListener('click', () => {
            const note = getCurrentDetailNote();
            const currentItem = hasStructuredQuiz(note)
                ? note.quizSet.items[state.quizPractice.currentIndex || 0]
                : null;
            const answeredCorrectly = Boolean(
                currentItem
                && state.quizPractice.revealed === true
                && state.quizPractice.selectedOptionId
                && state.quizPractice.selectedOptionId === currentItem.correctOptionId
            );
            if (!answeredCorrectly) {
                return;
            }
            setQuizPracticeIndex((state.quizPractice.currentIndex || 0) + 1);
        });
        el.noteDetailCloseBtn?.addEventListener('click', () => closeNoteDetail());
        el.noteDetailModalBackdrop?.addEventListener('click', () => closeNoteDetail());
    }

    notesDomApi = createNotesDom({
        state,
        el,
        documentObj,
        windowObj,
        messageRendererApi,
        flashcardsApi,
        normalizeNote,
        getVisibleNotes,
        getGeneratedVisibleNotes,
        getManualLibraryNotes,
        getManualLibrarySubjectFilters,
        getDiaryWallTabs,
        getDiaryWallActiveFilter,
        resolveManualNotesLibraryFilter,
        getActiveNote,
        getCurrentTopicDisplayName,
        getTopicDisplayLabel,
        getNoteHighlightId,
        getNoteDetailReturnTarget: () => noteDetailReturnTarget,
        closeTopicActionMenu,
        closeSourceFileActionMenu,
        openNoteDetail,
        toggleNoteSelection,
        deleteNoteRecord: (...args) => notesOperationsApi?.deleteNoteRecord?.(...args),
    });

    notesOperationsApi = createNotesOperations({
        state,
        el,
        chatAPI,
        ui,
        messageRendererApi,
        flashcardsApi,
        persistHistory,
        buildTopicContext,
        createId,
        getCurrentTopic,
        normalizeNote,
        getActiveNote,
        getCurrentDetailNote,
        getAgentDisplayLabel,
        getTopicDisplayLabel,
        findNoteById,
        patchCurrentHistoryMessage,
        updateCurrentChatHistory,
        getSelectedNotes,
        renderNotesPanel: (...args) => notesDomApi.renderNotesPanel(...args),
        renderManualNotesLibrary: (...args) => notesDomApi.renderManualNotesLibrary(...args),
        clearNoteEditor: (...args) => notesDomApi.clearNoteEditor(...args),
        openNoteDetail,
        closeNoteDetail,
        decorateChatMessages: (...args) => notesDomApi.decorateChatMessages(...args),
        revealNote,
        setRightPanelMode,
        setSidePanelTab,
    });

    return {
        bindEvents,
        closeManualNotesLibrary,
        closeNoteActionMenu: (...args) => notesDomApi.closeNoteActionMenu(...args),
        closeNoteDetail,
        createBlankNote,
        createNoteFromMessage: (...args) => notesOperationsApi?.createNoteFromMessage?.(...args),
        decorateChatMessages: (...args) => notesDomApi.decorateChatMessages(...args),
        findNoteById,
        getActiveNote,
        getCurrentDetailNote,
        loadAllAgentManualNotes: (...args) => notesOperationsApi.loadAllAgentManualNotes(...args),
        loadAgentNotes: (...args) => notesOperationsApi.loadAgentNotes(...args),
        loadTopicNotes: (...args) => notesOperationsApi.loadTopicNotes(...args),
        normalizeNote,
        openManualNotesLibrary,
        openNoteAnalysisWizard,
        closeNoteAnalysisWizard,
        openNoteDetail,
        openFlashcardConfigModal,
        closeFlashcardConfigModal,
        openQuizConfigModal,
        closeQuizConfigModal,
        refreshNotesData: (...args) => notesOperationsApi.refreshNotesData(...args),
        renderManualNotesLibrary: (...args) => notesDomApi.renderManualNotesLibrary(...args),
        renderNotesPanel: (...args) => notesDomApi.renderNotesPanel(...args),
        replaceNoteInCollections,
        resetState,
        setManualNotesLibraryActivePanel: (panel) => {
            state.manualNotesLibraryActivePanel = panel;
            notesDomApi.renderManualNotesLibrary();
        },
    };
}

export {
    createNotesController,
};
