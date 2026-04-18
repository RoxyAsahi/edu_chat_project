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

function createNotesController(deps = {}) {
    const store = deps.store;
    const el = deps.el;
    const chatAPI = deps.chatAPI;
    const ui = deps.ui;
    const renderMarkdownFragment = deps.renderMarkdownFragment || ((value) => value);
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
    let manualNotesLibraryTrigger = null;
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
        manualNotesLibraryOpen: {
            get: () => getNotesSlice().manualNotesLibraryOpen === true,
            set: (value) => patchNotes({ manualNotesLibraryOpen: value === true }),
        },
        manualNotesLibraryFilter: {
            get: () => getNotesSlice().manualNotesLibraryFilter || 'all',
            set: (value) => patchNotes({ manualNotesLibraryFilter: value === 'selected' ? 'selected' : 'all' }),
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
        studioPomodoroVisible: {
            get: () => getNotesSlice().studioPomodoroVisible === true,
            set: (value) => patchNotes({ studioPomodoroVisible: value === true }),
        },
        studioPomodoroExpanded: {
            get: () => getNotesSlice().studioPomodoroExpanded !== false,
            set: (value) => patchNotes({ studioPomodoroExpanded: value !== false }),
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

    function getManualLibraryNotes() {
        return filterManualNotes(state.agentNotes);
    }

    function getActiveNote() {
        return getVisibleNotes().find((note) => note.id === state.activeNoteId)
            || state.topicNotes.find((note) => note.id === state.activeNoteId)
            || state.agentNotes.find((note) => note.id === state.activeNoteId)
            || null;
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
            || null;
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
            el.analysisPreviewContent.innerHTML = markdown.trim()
                ? renderMarkdownFragment(markdown)
                : '<p>当前报告暂无内容。</p>';
            if (markdown.trim() && typeof windowObj.renderMathInElement === 'function') {
                windowObj.renderMathInElement(el.analysisPreviewContent, {
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
            el.noteMarkdownPreviewContent.innerHTML = markdown.trim()
                ? renderMarkdownFragment(markdown)
                : '<p>当前笔记暂无内容。</p>';
            if (markdown.trim() && typeof windowObj.renderMathInElement === 'function') {
                windowObj.renderMathInElement(el.noteMarkdownPreviewContent, {
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

        if (state.manualNotesLibraryOpen) {
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
        const selectedIds = new Set(
            Array.isArray(state.selectedNoteIds)
                ? state.selectedNoteIds.filter(Boolean)
                : [],
        );
        if (selectedIds.size === 0) {
            return [];
        }

        const selectedNotes = [];
        const seenNoteIds = new Set();
        const allNotes = [...state.topicNotes, ...state.agentNotes];
        allNotes.forEach((note) => {
            if (!selectedIds.has(note?.id) || seenNoteIds.has(note?.id)) {
                return;
            }
            seenNoteIds.add(note.id);
            selectedNotes.push(note);
        });
        return selectedNotes;
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
        state.manualNotesLibraryFilter = filter;
        notesDomApi.renderManualNotesLibrary();
    }

    async function openManualNotesLibrary(options = {}) {
        if (options.trigger instanceof HTMLElementCtor) {
            manualNotesLibraryTrigger = options.trigger;
        }
        if (!el.manualNotesLibraryPage && !el.manualNotesLibraryModal) {
            return;
        }

        if (el.noteDetailModal && !el.noteDetailModal.classList.contains('hidden')) {
            closeNoteDetail({ restoreFocus: false });
        }

        state.manualNotesLibraryOpen = true;
        notesDomApi.renderManualNotesLibrary();
        patchLayout({ workspaceViewMode: 'manual-notes' });
        showManualNotesLibraryPage();
        el.manualNotesLibraryModal?.classList.remove('hidden');
        el.manualNotesLibraryModal?.setAttribute('aria-hidden', 'false');
        documentObj.body?.classList.add('manual-notes-library-open');
        el.manualNotesLibraryFilterAllBtn?.focus();

        // Re-read persisted notes so externally added notes appear without a full app reload.
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
        if (state.manualNotesLibraryOpen) {
            closeManualNotesLibrary({ restoreFocus: false });
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
            if (state.manualNotesLibraryOpen) {
                closeManualNotesLibrary();
                return;
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
        el.manualNotesLibraryBtn?.addEventListener('click', (event) => {
            void openManualNotesLibrary({ trigger: event.currentTarget });
        });
        el.manualNotesLibraryFilterAllBtn?.addEventListener('click', () => {
            setManualNotesLibraryFilter('all');
        });
        el.manualNotesLibraryFilterSelectedBtn?.addEventListener('click', () => {
            setManualNotesLibraryFilter('selected');
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
        el.analyzeNotesBtn?.addEventListener('click', () => {
            void notesOperationsApi.runNotesTool('analysis');
        });
        el.generateQuizBtn?.addEventListener('click', () => {
            void notesOperationsApi.runNotesTool('quiz');
        });
        el.generateFlashcardsBtn?.addEventListener('click', () => {
            void notesOperationsApi.runNotesTool('flashcards');
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
        flashcardsApi,
        normalizeNote,
        getVisibleNotes,
        getGeneratedVisibleNotes,
        getManualLibraryNotes,
        getActiveNote,
        getCurrentTopicDisplayName,
        getTopicDisplayLabel,
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
        decorateChatMessages: (...args) => notesDomApi.decorateChatMessages(...args),
        findNoteById,
        getActiveNote,
        getCurrentDetailNote,
        loadAgentNotes: (...args) => notesOperationsApi.loadAgentNotes(...args),
        loadTopicNotes: (...args) => notesOperationsApi.loadTopicNotes(...args),
        normalizeNote,
        openManualNotesLibrary,
        openNoteDetail,
        refreshNotesData: (...args) => notesOperationsApi.refreshNotesData(...args),
        renderManualNotesLibrary: (...args) => notesDomApi.renderManualNotesLibrary(...args),
        renderNotesPanel: (...args) => notesDomApi.renderNotesPanel(...args),
        replaceNoteInCollections,
        resetState,
    };
}

export {
    createNotesController,
};
