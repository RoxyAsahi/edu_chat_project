import {
    buildBlankNoteTitle,
    getNormalizedNoteKind,
    normalizeNote as normalizeStoredNote,
} from './notesUtils.js';
import { createNotesDom } from './notesDom.js';
import { createNotesOperations } from './notesOperations.js';

function createNotesController(deps = {}) {
    const store = deps.store;
    const el = deps.el;
    const chatAPI = deps.chatAPI;
    const ui = deps.ui;
    const windowObj = deps.windowObj || window;
    const documentObj = deps.documentObj || document;
    const setSidePanelTab = deps.setSidePanelTab || (() => {});
    const setRightPanelMode = deps.setRightPanelMode || (() => {});
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
        getPendingGeneration: () => null,
        hasStructuredFlashcards: () => false,
        openPractice: () => false,
        renderPractice: () => {},
        resetState: () => {},
    };
    const closeTopicActionMenu = deps.closeTopicActionMenu || (() => {});
    const closeSourceFileActionMenu = deps.closeSourceFileActionMenu || (() => {});
    const updateCurrentChatHistory = deps.updateCurrentChatHistory || (() => []);
    const getCurrentSelectedItem = deps.getCurrentSelectedItem || (() => store.getState().session.currentSelectedItem);
    const getCurrentTopicId = deps.getCurrentTopicId || (() => store.getState().session.currentTopicId);
    const getCurrentChatHistory = deps.getCurrentChatHistory || (() => store.getState().session.currentChatHistory);

    const HTMLElementCtor = windowObj.HTMLElement || globalThis.HTMLElement;
    const ElementCtor = windowObj.Element || globalThis.Element;
    let noteDetailTrigger = null;
    let notesDomApi = null;
    let notesOperationsApi = null;

    function getNotesSlice() {
        return store.getState().notes;
    }

    function getSettingsSlice() {
        return store.getState().settings;
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
        noteDetailKind: {
            get: () => getNotesSlice().noteDetailKind,
            set: (value) => patchNotes({ noteDetailKind: value }),
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
        currentSelectedItem: {
            get: () => getCurrentSelectedItem() || { id: null, name: null, config: null },
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

    function getActiveNote() {
        return getVisibleNotes().find((note) => note.id === state.activeNoteId)
            || state.topicNotes.find((note) => note.id === state.activeNoteId)
            || state.agentNotes.find((note) => note.id === state.activeNoteId)
            || null;
    }

    function findNoteById(noteId) {
        if (!noteId) {
            return null;
        }

        return state.topicNotes.find((note) => note.id === noteId)
            || state.agentNotes.find((note) => note.id === noteId)
            || null;
    }

    function getCurrentDetailNote() {
        return state.activeFlashcardNoteId
            ? normalizeNote(findNoteById(state.activeFlashcardNoteId) || {})
            : (getActiveNote() ? normalizeNote(getActiveNote()) : null);
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

        state.notesStudioView = 'detail';
        state.noteDetailKind = requestedKind;
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
            notesDomApi.syncNoteDetailChrome(normalized);
        }

        el.noteDetailCloseBtn?.focus();
        notesDomApi.renderNotesPanel();
    }

    function closeNoteDetail(options = {}) {
        state.notesStudioView = 'overview';
        state.noteDetailKind = null;
        setRightPanelMode('notes');
        el.noteDetailModal?.classList.add('hidden');
        el.noteDetailModal?.classList.remove('note-detail-modal--open');
        el.noteDetailModal?.setAttribute('aria-hidden', 'true');
        documentObj.body?.classList.remove('note-detail-open');
        if (
            options.restoreFocus !== false
            && noteDetailTrigger instanceof HTMLElementCtor
            && documentObj.body?.contains(noteDetailTrigger)
        ) {
            noteDetailTrigger.focus();
        }
        noteDetailTrigger = null;
        notesDomApi.closeNoteActionMenu();
    }

    function revealNote(note) {
        if (!note) {
            return;
        }

        openNoteDetail(note);
        notesDomApi.renderNotesPanel();
    }

    function getSelectedNotes() {
        return getVisibleNotes().filter((note) => state.selectedNoteIds.includes(note.id));
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
    }

    function createBlankNote() {
        openNoteDetail(null, {
            kind: 'note',
            trigger: documentObj.activeElement instanceof HTMLElementCtor ? documentObj.activeElement : null,
        });
        notesDomApi.renderNotesPanel();
    }

    function resetState(options = {}) {
        const clearTopicNotes = options.clearTopicNotes === true;
        const clearAgentNotes = options.clearAgentNotes === true;
        const clearSelection = options.clearSelection !== false;
        const clearActiveNote = options.clearActiveNote !== false;
        const closeDetailView = options.closeDetailView === true;
        const clearFlashcards = options.clearFlashcards !== false;

        if (closeDetailView) {
            closeNoteDetail({ restoreFocus: false });
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
        }
        if (clearActiveNote) {
            notesDomApi.clearNoteEditor();
        }
        if (clearFlashcards) {
            flashcardsApi.resetState();
        }

        notesDomApi.renderNotesPanel();
    }

    function setNotesScope(scope) {
        state.notesScope = scope === 'agent' ? 'agent' : 'topic';
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
            if (el.noteDetailModal && !el.noteDetailModal.classList.contains('hidden')) {
                closeNoteDetail();
            }
        });
        el.notesList?.addEventListener('scroll', notesDomApi.closeNoteActionMenu);
        el.topicNotesScopeBtn?.addEventListener('click', () => setNotesScope('topic'));
        el.agentNotesScopeBtn?.addEventListener('click', () => setNotesScope('agent'));
        el.newNoteBtn?.addEventListener('click', createBlankNote);
        el.newNoteFabBtn?.addEventListener('click', createBlankNote);
        el.notesStudioOpenBtn?.addEventListener('click', openNotesStudio);
        el.saveNoteBtn?.addEventListener('click', () => {
            void notesOperationsApi.saveActiveNote();
        });
        el.deleteNoteBtn?.addEventListener('click', () => {
            void notesOperationsApi.deleteActiveNote();
        });
        el.analyzeNotesBtn?.addEventListener('click', () => {
            void notesOperationsApi.runNotesTool('analysis');
        });
        el.generateQuizBtn?.addEventListener('click', () => {
            void notesOperationsApi.runNotesTool('quiz');
        });
        el.generateFlashcardsBtn?.addEventListener('click', () => {
            void notesOperationsApi.runNotesTool('flashcards');
        });
        el.noteDetailCloseBtn?.addEventListener('click', () => closeNoteDetail());
        el.noteDetailModalBackdrop?.addEventListener('click', () => closeNoteDetail());
    }

    notesDomApi = createNotesDom({
        state,
        el,
        documentObj,
        windowObj,
        flashcardsApi,
        normalizeNote,
        getVisibleNotes,
        getActiveNote,
        getCurrentTopicDisplayName,
        getNoteHighlightId,
        closeTopicActionMenu,
        closeSourceFileActionMenu,
        openNoteDetail,
        toggleNoteSelection,
        deleteNoteRecord: (...args) => notesOperationsApi?.deleteNoteRecord?.(...args),
        createNoteFromMessage: (...args) => notesOperationsApi?.createNoteFromMessage?.(...args),
        toggleMessageFavorite: (...args) => notesOperationsApi?.toggleMessageFavorite?.(...args),
    });

    notesOperationsApi = createNotesOperations({
        state,
        el,
        chatAPI,
        ui,
        flashcardsApi,
        persistHistory,
        buildTopicContext,
        createId,
        getCurrentTopic,
        normalizeNote,
        getActiveNote,
        getCurrentDetailNote,
        findNoteById,
        patchCurrentHistoryMessage,
        updateCurrentChatHistory,
        getSelectedNotes,
        renderNotesPanel: (...args) => notesDomApi.renderNotesPanel(...args),
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
        closeNoteActionMenu: (...args) => notesDomApi.closeNoteActionMenu(...args),
        closeNoteDetail,
        createBlankNote,
        decorateChatMessages: (...args) => notesDomApi.decorateChatMessages(...args),
        findNoteById,
        getActiveNote,
        getCurrentDetailNote,
        loadAgentNotes: (...args) => notesOperationsApi.loadAgentNotes(...args),
        loadTopicNotes: (...args) => notesOperationsApi.loadTopicNotes(...args),
        normalizeNote,
        openNoteDetail,
        refreshNotesData: (...args) => notesOperationsApi.refreshNotesData(...args),
        renderNotesPanel: (...args) => notesDomApi.renderNotesPanel(...args),
        replaceNoteInCollections,
        resetState,
    };
}

export {
    createNotesController,
};
