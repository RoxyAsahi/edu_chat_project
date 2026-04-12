import { positionFloatingElement } from '../dom/positionFloatingElement.js';
import {
    buildBlankNoteTitle,
    buildMessageNoteContent,
    buildNotesSelectionSummary,
    buildNoteSaveRequest,
    deriveDeletedNoteState,
    formatRelativeTime,
    getNormalizedNoteKind,
    normalizeNote as normalizeStoredNote,
    removeDeletedNoteReferencesFromHistory,
} from './notesUtils.js';
import {
    buildQuizSummaryMarkdown,
    hasStructuredQuiz,
    parseQuizSetFromMarkdown,
    parseQuizSetFromResponse,
} from '../quiz/quizUtils.js';

const NOTE_DETAIL_META = Object.freeze({
    note: {
        eyebrow: '手动笔记',
        subtitle: '查看、编辑并继续沉淀当前话题的学习记录。',
    },
    analysis: {
        eyebrow: '深度分析',
        subtitle: '结构化整理关键结论、关系图景与后续学习建议。',
    },
    quiz: {
        eyebrow: '选择题练习',
        subtitle: '围绕当前学习材料生成题目、答案与解析。',
    },
    flashcards: {
        eyebrow: '闪卡练习',
        subtitle: '进入抽认卡模式，持续复习与标记掌握进度。',
    },
});

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

function createNotesController(deps = {}) {
    const state = deps.state;
    const el = deps.el;
    const chatAPI = deps.chatAPI;
    const ui = deps.ui;
    const renderMarkdownFragment = deps.renderMarkdownFragment || ((value) => value);
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

    const HTMLElementCtor = windowObj.HTMLElement || globalThis.HTMLElement;
    const ElementCtor = windowObj.Element || globalThis.Element;
    let noteDetailTrigger = null;

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

        state.quizPractice.currentIndex = Math.max(0, Math.min(Number(state.quizPractice.currentIndex || 0), itemCount - 1));
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
    }

    function buildAnalysisPreviewMeta(note = null) {
        if (!note?.id) {
            return '未保存的草稿预览。';
        }

        const sourceCount = Array.isArray(note.sourceMessageIds) ? note.sourceMessageIds.length : 0;
        const refCount = Array.isArray(note.sourceDocumentRefs) ? note.sourceDocumentRefs.length : 0;
        const topicLabel = note.topicId ? ` · 话题 ${note.topicId}` : '';
        return `更新时间：${formatRelativeTime(note.updatedAt)}${topicLabel} · 来源消息 ${sourceCount} 条 · 来源资料 ${refCount} 条`;
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
        }
        if (el.analysisPreviewMeta) {
            el.analysisPreviewMeta.textContent = buildAnalysisPreviewMeta(normalized);
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
                        data-quiz-option-id="${escapeHtml(option.id)}"
                        ${revealed ? 'disabled' : ''}
                    >
                        <span class="quiz-practice__option-label">${escapeHtml(option.label)}</span>
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
        } else {
            state.noteDetailMode = 'edit';
        }

        syncNoteDetailChrome(note);
        if (state.noteDetailKind === 'quiz' && state.noteDetailMode === 'practice') {
            renderQuizPractice(note);
        }
        if (state.noteDetailKind === 'analysis' && state.noteDetailMode === 'view') {
            renderAnalysisPreview(note);
        }
    }

    function clearNoteEditor() {
        state.activeNoteId = null;
        resetQuizPracticeState(null);
        if (el.noteTitleInput) {
            el.noteTitleInput.value = '';
        }
        if (el.noteContentInput) {
            el.noteContentInput.value = '';
        }
        if (el.noteMetaSummary) {
            el.noteMetaSummary.textContent = '当前没有打开的笔记。';
        }
    }

    function fillNoteEditor(note) {
        if (!note) {
            clearNoteEditor();
            return;
        }

        state.activeFlashcardNoteId = null;
        state.activeNoteId = note.id;
        if (el.noteTitleInput) {
            el.noteTitleInput.value = note.title || '';
        }
        if (el.noteContentInput) {
            el.noteContentInput.value = note.contentMarkdown || '';
        }

        const sourceCount = Array.isArray(note.sourceMessageIds) ? note.sourceMessageIds.length : 0;
        const refCount = Array.isArray(note.sourceDocumentRefs) ? note.sourceDocumentRefs.length : 0;
        const topicLabel = note.topicId ? ` · 话题 ${note.topicId}` : '';
        if (el.noteMetaSummary) {
            el.noteMetaSummary.textContent = `更新时间：${formatRelativeTime(note.updatedAt)}${topicLabel} · 来源消息 ${sourceCount} 条 · 来源资料 ${refCount} 条`;
        }
        if (!state.noteDetailKind || state.noteDetailKind === 'note') {
            state.noteDetailKind = getNormalizedNoteKind(note);
        }
        syncNoteDetailChrome(note);
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

    function buildNoteDetailSubtitle(note, fallback = '') {
        if (!note) {
            return fallback;
        }

        const sourceCount = flashcardsApi.getFlashcardSourceCount(note);
        const updatedLabel = formatRelativeTime(note.updatedAt) || '刚刚';
        const kind = getNormalizedNoteKind(note);
        const kindLabel = kind === 'analysis'
            ? '分析报告'
            : kind === 'quiz'
                ? '选择题'
                : kind === 'flashcards'
                    ? '闪卡'
                    : '笔记';
        return `${kindLabel} · ${sourceCount > 0 ? `${sourceCount} 个来源` : '当前话题'} · ${updatedLabel}`;
    }

    function syncNoteDetailChrome(note = null) {
        const kind = state.noteDetailKind || 'note';
        const meta = NOTE_DETAIL_META[kind] || NOTE_DETAIL_META.note;
        const flashcards = kind === 'flashcards';
        const structuredQuiz = kind === 'quiz' && hasStructuredQuiz(note);
        const analysisPreviewMode = kind === 'analysis' && state.noteDetailMode === 'view';
        if (kind === 'quiz' && !structuredQuiz) {
            state.noteDetailMode = 'edit';
        }
        const practiceMode = kind === 'quiz' && structuredQuiz && state.noteDetailMode === 'practice';
        const editable = !flashcards && !analysisPreviewMode && (!structuredQuiz || state.noteDetailMode === 'edit');
        const noteTitle = flashcards
            ? (note?.flashcardDeck?.title || note?.title || '闪卡练习')
            : structuredQuiz
                ? (note?.quizSet?.title || note?.title || '选择题练习')
                : (note?.title || '新建笔记');
        const subtitle = note
            ? buildNoteDetailSubtitle(note, meta.subtitle)
            : (state.currentTopicId
                ? `当前话题：${getCurrentTopicDisplayName()} · 新建内容会保存到当前话题并自动归档到学科汇总。`
                : meta.subtitle);

        if (el.noteDetailEyebrow) {
            el.noteDetailEyebrow.textContent = meta.eyebrow;
        }
        if (el.noteDetailTitle) {
            el.noteDetailTitle.textContent = noteTitle;
        }
        if (el.noteDetailSubtitle) {
            el.noteDetailSubtitle.textContent = subtitle;
        }
        el.saveNoteBtn?.classList.toggle('hidden', !editable);
        el.analysisEditMarkdownBtn?.classList.toggle('hidden', !(kind === 'analysis' && analysisPreviewMode));
        el.analysisViewReportBtn?.classList.toggle('hidden', !(kind === 'analysis' && !analysisPreviewMode && Boolean(note?.id)));
        el.quizEditSourceBtn?.classList.toggle('hidden', !(kind === 'quiz' && structuredQuiz && practiceMode));
        el.quizViewPracticeBtn?.classList.toggle('hidden', !(kind === 'quiz' && structuredQuiz && !practiceMode));
        el.deleteNoteBtn?.classList.toggle('hidden', !note?.id);
        el.analysisPreviewCard?.classList.toggle('hidden', !analysisPreviewMode);
        el.noteEditorCard?.classList.toggle('hidden', flashcards || practiceMode || analysisPreviewMode);
        el.quizPracticeCard?.classList.toggle('hidden', !practiceMode);
        el.flashcardsPracticeCard?.classList.toggle('hidden', !flashcards);
    }

    function openNoteDetail(note = null, options = {}) {
        const normalized = note ? normalizeNote(note) : null;
        const requestedKind = options.kind || getNormalizedNoteKind(normalized);
        if (options.trigger instanceof HTMLElementCtor) {
            noteDetailTrigger = options.trigger;
        }

        state.notesStudioView = 'detail';
        state.noteDetailKind = requestedKind;
        state.noteDetailMode = requestedKind === 'quiz' && hasStructuredQuiz(normalized)
            ? 'practice'
            : (requestedKind === 'analysis' && normalized?.id ? 'view' : 'edit');
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
            syncNoteDetailChrome(normalized);
            flashcardsApi.renderPractice();
        } else {
            flashcardsApi.resetState({ clearPending: false });
            setRightPanelMode('notes');
            if (normalized) {
                fillNoteEditor(normalized);
            } else {
                clearNoteEditor();
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
            if (requestedKind === 'quiz') {
                renderQuizPractice(normalized);
            }
            syncNoteDetailChrome(normalized);
        }

        el.noteDetailCloseBtn?.focus();
        renderNotesPanel();
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
        closeNoteActionMenu();
    }

    function closeNoteActionMenu() {
        state.activeNoteMenu = null;
        if (!el.noteActionMenu) {
            return;
        }

        el.noteActionMenu.classList.add('hidden');
        el.noteActionMenu.innerHTML = '';
        el.noteActionMenu.style.left = '0px';
        el.noteActionMenu.style.top = '0px';
        el.noteActionMenu.style.visibility = '';
    }

    function renderNoteActionMenu() {
        if (!el.noteActionMenu || !state.activeNoteMenu?.note || !state.activeNoteMenu?.anchorRect) {
            closeNoteActionMenu();
            return;
        }

        const note = normalizeNote(state.activeNoteMenu.note);
        const selected = state.selectedNoteIds.includes(note.id);
        const actions = [
            { key: 'open', label: '打开详情', icon: 'open_in_new' },
            { key: 'toggle-select', label: selected ? '取消选择' : '选择用于生成', icon: selected ? 'check_circle' : 'radio_button_unchecked' },
            { key: 'delete', label: '删除', icon: 'delete', danger: true },
        ];

        el.noteActionMenu.innerHTML = actions.map((action) => `
            <button
                type="button"
                class="topic-action-menu__item ${action.danger ? 'topic-action-menu__item--danger' : ''}"
                data-note-action="${escapeHtml(action.key)}"
            >
                <span class="material-symbols-outlined">${escapeHtml(action.icon)}</span>
                <span>${escapeHtml(action.label)}</span>
            </button>
        `).join('');

        el.noteActionMenu.classList.remove('hidden');
        el.noteActionMenu.style.visibility = 'hidden';
        positionFloatingElement(el.noteActionMenu, state.activeNoteMenu.anchorRect, 'left', windowObj);
        el.noteActionMenu.style.visibility = 'visible';

        el.noteActionMenu.querySelectorAll('[data-note-action]').forEach((button) => {
            button.addEventListener('click', async (event) => {
                event.stopPropagation();
                const action = button.dataset.noteAction;
                if (action === 'open') {
                    openNoteDetail(note, { trigger: state.activeNoteMenu?.anchorElement || null });
                } else if (action === 'toggle-select') {
                    toggleNoteSelection(note.id);
                } else if (action === 'delete') {
                    await deleteNoteRecord(note);
                }
                closeNoteActionMenu();
            });
        });
    }

    function openNoteItemMenu(note, anchorElement) {
        if (!note || !anchorElement) {
            return;
        }

        if (state.activeNoteMenu?.noteId === note.id) {
            closeNoteActionMenu();
            return;
        }

        closeTopicActionMenu();
        closeSourceFileActionMenu();
        state.activeNoteMenu = {
            noteId: note.id,
            note,
            anchorElement,
            anchorRect: anchorElement.getBoundingClientRect(),
        };
        renderNoteActionMenu();
    }

    function revealNote(note) {
        if (!note) {
            return;
        }

        openNoteDetail(note);
        renderNotesPanel();
    }

    function updateNotesSelectionSummary() {
        if (!el.notesSelectionSummary) {
            return;
        }

        el.notesSelectionSummary.textContent = buildNotesSelectionSummary({
            notesScope: state.notesScope,
            selectedCount: state.selectedNoteIds.length,
            visibleCount: getVisibleNotes().length,
        });
    }

    function renderNotesPanel() {
        const notes = getVisibleNotes();
        closeNoteActionMenu();

        el.topicNotesScopeBtn?.classList.toggle('notes-scope-btn--active', state.notesScope === 'topic');
        el.agentNotesScopeBtn?.classList.toggle('notes-scope-btn--active', state.notesScope === 'agent');
        updateNotesSelectionSummary();

        if (!el.notesList) {
            return;
        }

        el.notesList.innerHTML = '';
        const pendingFlashcards = flashcardsApi.getPendingGeneration();

        if (pendingFlashcards) {
            const pendingCard = documentObj.createElement('div');
            pendingCard.className = 'note-card note-card--studio note-card--flashcard-entry note-card--pending note-card--active';
            pendingCard.innerHTML = `
                <div class="note-card__studio-main">
                    <div class="note-card__studio-icon note-card__flashcard-icon note-card__flashcard-icon--pending">
                        <span class="material-symbols-outlined">autorenew</span>
                    </div>
                    <div class="note-card__studio-body">
                        <div class="note-card__studio-heading">
                            <strong class="note-card__flashcard-title">正在生成闪卡...</strong>
                        </div>
                        <div class="note-card__flashcard-meta">${pendingFlashcards.sourceCount > 0 ? `基于 ${pendingFlashcards.sourceCount} 个来源` : '基于当前学习材料'}</div>
                    </div>
                </div>
            `;
            el.notesList.appendChild(pendingCard);
        }

        if (notes.length === 0 && !pendingFlashcards) {
            const empty = documentObj.createElement('div');
            empty.className = 'empty-list-state';
            empty.innerHTML = `
                <strong>还没有笔记</strong>
                <span>收藏聊天气泡、手动新建笔记，或在这里沉淀当前话题的学习成果。</span>
            `;
            el.notesList.appendChild(empty);
            if (!getActiveNote() && state.notesStudioView !== 'detail') {
                clearNoteEditor();
            }
            return;
        }

        notes.forEach((note) => {
            const normalized = normalizeNote(note);
            const card = documentObj.createElement('div');
            card.className = 'note-card note-card--studio';
            const isInteractiveFlashcard = flashcardsApi.hasStructuredFlashcards(normalized);
            const isSelected = state.selectedNoteIds.includes(normalized.id);
            card.classList.toggle('note-card--flashcard-entry', isInteractiveFlashcard);
            card.classList.toggle('note-card--active', normalized.id === getNoteHighlightId());
            card.classList.toggle('note-card--selected', isSelected);

            const preview = escapeHtml(stripMarkdown(normalized.contentMarkdown || '').trim());
            const sourceCount = flashcardsApi.getFlashcardSourceCount(normalized);
            const typeKind = getNormalizedNoteKind(normalized);
            const typeConfig = {
                note: { icon: 'edit_note', label: '笔记', accent: 'note' },
                analysis: { icon: 'analytics', label: '分析', accent: 'analysis' },
                quiz: { icon: 'quiz', label: '测验', accent: 'quiz' },
                flashcards: { icon: 'style', label: '闪卡', accent: 'flashcards' },
            }[typeKind] || { icon: 'description', label: '笔记', accent: 'note' };
            const metaParts = [
                sourceCount > 0 ? `${sourceCount} 个来源` : '当前话题',
                formatRelativeTime(normalized.updatedAt),
            ];
            if (state.notesScope === 'agent' && normalized.topicId) {
                metaParts.push(`话题 ${escapeHtml(normalized.topicId)}`);
            }
            const selectedBadge = isSelected
                ? '<span class="note-card__selection-pill"><span class="material-symbols-outlined">check</span><span>已选</span></span>'
                : '';

            if (isInteractiveFlashcard) {
                const cardCount = Array.isArray(normalized.flashcardDeck?.cards) ? normalized.flashcardDeck.cards.length : 0;
                const flashcardMeta = `${sourceCount > 0 ? `${sourceCount} 个来源` : `${cardCount} 张卡`} · ${formatRelativeTime(normalized.updatedAt)}`;
                card.innerHTML = `
                    <div class="note-card__studio-main">
                        <div class="note-card__studio-icon note-card__flashcard-icon">
                            <span class="material-symbols-outlined">cards_star</span>
                        </div>
                        <div class="note-card__studio-body">
                            <div class="note-card__studio-heading">
                                <strong class="note-card__flashcard-title">${escapeHtml(normalized.flashcardDeck?.title || normalized.title)}</strong>
                                ${selectedBadge}
                            </div>
                            <div class="note-card__flashcard-meta">${flashcardMeta}</div>
                        </div>
                        <button class="note-card__menu-button" type="button" data-note-menu="${escapeHtml(normalized.id)}" aria-label="打开笔记菜单">
                            <span class="material-symbols-outlined">more_vert</span>
                        </button>
                    </div>
                `;
            } else {
                card.innerHTML = `
                    <div class="note-card__studio-main">
                        <div class="note-card__studio-icon note-card__studio-icon--${typeConfig.accent}">
                            <span class="material-symbols-outlined">${escapeHtml(typeConfig.icon)}</span>
                        </div>
                        <div class="note-card__studio-body">
                            <div class="note-card__studio-heading">
                                <strong>${escapeHtml(normalized.title)}</strong>
                                ${selectedBadge}
                            </div>
                            <div class="note-card__studio-preview">${preview || '暂无内容。'}</div>
                            <div class="note-card__studio-meta">
                                <span class="note-card__kind note-card__kind--studio">
                                    <span class="material-symbols-outlined">${escapeHtml(typeConfig.icon)}</span>
                                    <span>${escapeHtml(typeConfig.label)}</span>
                                </span>
                                ${metaParts.map((item) => `<span>${item}</span>`).join('')}
                            </div>
                        </div>
                        <button class="note-card__menu-button" type="button" data-note-menu="${escapeHtml(normalized.id)}" aria-label="打开笔记菜单">
                            <span class="material-symbols-outlined">more_vert</span>
                        </button>
                    </div>
                `;
            }

            card.addEventListener('click', (event) => {
                const target = event.target;
                if (target instanceof ElementCtor && target.closest('[data-note-menu]')) {
                    return;
                }
                if (flashcardsApi.openPractice(normalized, { trigger: card })) {
                    return;
                }
                openNoteDetail(normalized, { trigger: card });
                renderNotesPanel();
            });

            card.querySelector('[data-note-menu]')?.addEventListener('click', (event) => {
                event.stopPropagation();
                openNoteItemMenu(normalized, event.currentTarget);
            });

            el.notesList.appendChild(card);
        });
    }

    async function loadTopicNotes() {
        if (!state.currentSelectedItem.id || !state.currentTopicId) {
            state.topicNotes = [];
            renderNotesPanel();
            return;
        }

        const result = await chatAPI.listTopicNotes(state.currentSelectedItem.id, state.currentTopicId).catch((error) => ({
            success: false,
            error: error.message,
            items: [],
        }));

        if (!result?.success) {
            ui.showToastNotification(`加载话题笔记失败：${result?.error || '未知错误'}`, 'error');
            state.topicNotes = [];
            renderNotesPanel();
            return;
        }

        state.topicNotes = Array.isArray(result.items) ? result.items.map(normalizeNote) : [];
        renderNotesPanel();
        if (state.rightPanelMode === 'flashcards') {
            flashcardsApi.renderPractice();
        }
    }

    async function loadAgentNotes() {
        if (!state.currentSelectedItem.id) {
            state.agentNotes = [];
            renderNotesPanel();
            return;
        }

        const result = await chatAPI.listAgentNotes(state.currentSelectedItem.id).catch((error) => ({
            success: false,
            error: error.message,
            items: [],
        }));

        if (!result?.success) {
            ui.showToastNotification(`加载学科笔记失败：${result?.error || '未知错误'}`, 'error');
            state.agentNotes = [];
            renderNotesPanel();
            return;
        }

        state.agentNotes = Array.isArray(result.items) ? result.items.map(normalizeNote) : [];
        renderNotesPanel();
        if (state.rightPanelMode === 'flashcards') {
            flashcardsApi.renderPractice();
        }
    }

    async function refreshNotesData() {
        await loadTopicNotes();
        await loadAgentNotes();
    }

    function createBlankNote() {
        openNoteDetail(null, {
            kind: 'note',
            trigger: documentObj.activeElement instanceof HTMLElementCtor ? documentObj.activeElement : null,
        });
        renderNotesPanel();
    }

    async function saveActiveNote() {
        if (!state.currentSelectedItem.id || !state.currentTopicId) {
            ui.showToastNotification('请先选择一个智能体和话题，再保存笔记。', 'warning');
            return;
        }

        const currentNote = getActiveNote() ? normalizeNote(getActiveNote()) : null;
        const currentKind = state.noteDetailKind || getNormalizedNoteKind(currentNote);
        const rawTitle = el.noteTitleInput?.value.trim() || '';
        const rawContent = el.noteContentInput?.value || '';
        let nextQuizSet = undefined;
        let nextContentMarkdown = rawContent;
        let nextTitle = rawTitle;

        if (currentKind === 'quiz') {
            nextQuizSet = parseQuizSetFromMarkdown(rawContent, rawTitle || currentNote?.title || '选择题练习');
            if (!nextQuizSet) {
                ui.showToastNotification('选择题格式缺少题干/选项/正确答案/解析，无法同步到练习页。', 'warning');
                return;
            }

            nextContentMarkdown = buildQuizSummaryMarkdown(nextQuizSet);
            nextTitle = rawTitle || nextQuizSet.title || currentNote?.title || '选择题练习';
        }

        const request = buildNoteSaveRequest({
            currentNote,
            currentTopicId: state.currentTopicId,
            title: nextTitle,
            contentMarkdown: nextContentMarkdown,
            quizSet: nextQuizSet,
        });

        if (!request) {
            ui.showToastNotification('请输入笔记标题或内容。', 'warning');
            return;
        }

        const result = await chatAPI.saveTopicNote(
            state.currentSelectedItem.id,
            request.targetTopicId,
            request.payload,
        );

        if (!result?.success) {
            ui.showToastNotification(`保存笔记失败：${result?.error || '未知错误'}`, 'error');
            return;
        }

        state.activeNoteId = result.item?.id || null;
        await refreshNotesData();
        openNoteDetail(normalizeNote(result.item || {}), {
            kind: getNormalizedNoteKind(result.item || {}),
        });
        ui.showToastNotification('笔记已保存。', 'success');
    }

    async function syncDeletedNoteReferences(note) {
        const noteId = String(note?.id || '').trim();
        const agentId = String(note?.agentId || '').trim();
        const topicId = String(note?.topicId || '').trim();
        if (!noteId || !agentId || !topicId) {
            return { success: true, changed: false };
        }

        const isCurrentTopic = agentId === state.currentSelectedItem.id && topicId === state.currentTopicId;
        const history = isCurrentTopic
            ? state.currentChatHistory
            : await chatAPI.getChatHistory(agentId, topicId).catch(() => null);

        if (!Array.isArray(history)) {
            return {
                success: false,
                changed: false,
                error: '无法读取关联会话的历史记录。',
            };
        }

        const { changed, nextHistory } = removeDeletedNoteReferencesFromHistory(history, noteId);
        if (!changed) {
            return { success: true, changed: false };
        }

        const saveResult = await chatAPI.saveChatHistory(agentId, topicId, nextHistory).catch((error) => ({
            error: error.message,
        }));
        if (saveResult?.error) {
            return {
                success: false,
                changed: false,
                error: saveResult.error,
            };
        }

        if (isCurrentTopic) {
            state.currentChatHistory = nextHistory;
            decorateChatMessages();
        }

        return { success: true, changed: true };
    }

    async function deleteNoteRecord(note) {
        const currentNote = note ? normalizeNote(note) : (getCurrentDetailNote() ? normalizeNote(getCurrentDetailNote()) : null);
        if (!currentNote?.id) {
            ui.showToastNotification('请先选择一条笔记。', 'warning');
            return;
        }

        const confirmed = await ui.showConfirmDialog(
            `确定删除笔记“${currentNote.title}”吗？`,
            '删除笔记',
            '删除',
            '取消',
            true,
        );
        if (!confirmed) {
            return;
        }

        const result = await chatAPI.deleteTopicNote(currentNote.agentId, currentNote.topicId, currentNote.id);
        if (!result?.success) {
            ui.showToastNotification(`删除笔记失败：${result?.error || '未知错误'}`, 'error');
            return;
        }

        const syncResult = await syncDeletedNoteReferences(currentNote);
        const nextState = deriveDeletedNoteState({
            selectedNoteIds: state.selectedNoteIds,
            activeNoteId: state.activeNoteId,
            activeFlashcardNoteId: state.activeFlashcardNoteId,
        }, currentNote.id);
        state.selectedNoteIds = nextState.selectedNoteIds;
        state.activeNoteId = nextState.activeNoteId;
        state.activeFlashcardNoteId = nextState.activeFlashcardNoteId;
        if (!state.activeNoteId) {
            clearNoteEditor();
        }
        await refreshNotesData();
        if (state.notesStudioView === 'detail') {
            closeNoteDetail({ restoreFocus: false });
        }
        if (!syncResult?.success) {
            ui.showToastNotification(`笔记已删除，但消息引用清理失败：${syncResult?.error || '未知错误'}`, 'warning', 5000);
            return;
        }
        ui.showToastNotification('笔记已删除。', 'success');
    }

    async function deleteActiveNote() {
        await deleteNoteRecord(null);
    }

    async function createNoteFromMessage(messageId) {
        const message = state.currentChatHistory.find((item) => item.id === messageId);
        if (!message || !state.currentSelectedItem.id || !state.currentTopicId) {
            return null;
        }

        const noteBase = buildMessageNoteContent(message);
        const timestamp = new Date(message.timestamp || Date.now()).toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).replace(/\//g, '-');
        const result = await chatAPI.createNoteFromMessage({
            agentId: state.currentSelectedItem.id,
            topicId: state.currentTopicId,
            title: `${noteBase.title} ${timestamp}`,
            contentMarkdown: noteBase.contentMarkdown,
            sourceMessageIds: [message.id],
            sourceDocumentRefs: Array.isArray(message.kbContextRefs) ? message.kbContextRefs : [],
            kind: 'message-note',
        });

        if (!result?.success) {
            ui.showToastNotification(`生成笔记失败：${result?.error || '未知错误'}`, 'error');
            return null;
        }

        message.favorited = true;
        message.favoriteAt = Date.now();
        message.noteRefs = Array.isArray(message.noteRefs)
            ? [...new Set([...message.noteRefs, result.item.id])]
            : [result.item.id];
        await persistHistory();
        await refreshNotesData();
        revealNote(result.item);
        decorateChatMessages();
        ui.showToastNotification('已从当前气泡生成笔记。', 'success');
        return normalizeNote(result.item);
    }

    async function toggleMessageFavorite(messageId) {
        const message = state.currentChatHistory.find((item) => item.id === messageId);
        if (!message || !state.currentSelectedItem.id || !state.currentTopicId) {
            return null;
        }

        if (message.favorited) {
            message.favorited = false;
            message.favoriteAt = null;
            await persistHistory();
            decorateChatMessages();
            ui.showToastNotification('已取消收藏，已生成的笔记会继续保留。', 'info');
            return null;
        }

        let favoriteNote = null;
        const existingNoteId = Array.isArray(message.noteRefs) ? message.noteRefs[0] : null;
        if (existingNoteId) {
            await refreshNotesData();
            favoriteNote = findNoteById(existingNoteId);
        }

        if (!favoriteNote) {
            favoriteNote = await createNoteFromMessage(messageId);
            if (!favoriteNote) {
                return null;
            }
        } else {
            message.favorited = true;
            message.favoriteAt = Date.now();
            await persistHistory();
            revealNote(favoriteNote);
            decorateChatMessages();
            ui.showToastNotification('已收藏，并已定位到右侧笔记。', 'success');
        }

        return favoriteNote;
    }

    function decorateChatMessages() {
        for (const message of state.currentChatHistory) {
            if (!message?.id || message.isThinking || (message.role !== 'user' && message.role !== 'assistant')) {
                continue;
            }

            const messageItem = el.chatMessages?.querySelector(`.message-item[data-message-id="${message.id}"]`);
            const wrapper = messageItem?.querySelector('.details-and-bubble-wrapper');
            if (!messageItem || !wrapper) {
                continue;
            }

            wrapper.querySelector('.study-message-actions')?.remove();

            const actions = documentObj.createElement('div');
            actions.className = 'study-message-actions';

            const favoriteButton = documentObj.createElement('button');
            favoriteButton.type = 'button';
            favoriteButton.className = `study-message-action${message.favorited ? ' study-message-action--active' : ''}`;
            favoriteButton.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px;">star</span>${message.favorited ? '已收藏' : '收藏'}`;
            favoriteButton.addEventListener('click', (event) => {
                event.stopPropagation();
                void toggleMessageFavorite(message.id);
            });

            const noteButton = documentObj.createElement('button');
            noteButton.type = 'button';
            noteButton.className = 'study-message-action';
            noteButton.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px;">note_add</span>${message.noteRefs?.length > 0 ? '新增笔记' : '记入笔记'}`;
            noteButton.addEventListener('click', (event) => {
                event.stopPropagation();
                void createNoteFromMessage(message.id);
            });

            actions.appendChild(favoriteButton);
            actions.appendChild(noteButton);
            wrapper.appendChild(actions);
        }
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

        renderNotesPanel();
    }

    async function resolveStudyInputText() {
        const selectedNotes = getSelectedNotes();
        if (selectedNotes.length > 0) {
            return {
                sourceLabel: 'selected-notes',
                text: selectedNotes
                    .map((note) => `# ${note.title}\n\n${note.contentMarkdown}`)
                    .join('\n\n---\n\n'),
                sourceMessageIds: [...new Set(selectedNotes.flatMap((note) => note.sourceMessageIds || []))],
                sourceDocumentRefs: selectedNotes.flatMap((note) => note.sourceDocumentRefs || []),
            };
        }

        const currentTopic = getCurrentTopic();
        if (!currentTopic?.knowledgeBaseId) {
            return null;
        }

        const sourceResult = await chatAPI.retrieveKnowledgeBaseContext({
            kbId: currentTopic.knowledgeBaseId,
            query: '请概览当前来源资料的核心知识点、重点概念和常见考点。',
        }).catch(() => null);

        if (!sourceResult?.success || !sourceResult.contextText) {
            return null;
        }

        return {
            sourceLabel: 'topic-source',
            text: sourceResult.contextText,
            sourceMessageIds: [],
            sourceDocumentRefs: Array.isArray(sourceResult.refs) ? sourceResult.refs : [],
        };
    }

    async function runNotesTool(kind) {
        if (!state.currentSelectedItem.id || !state.currentTopicId) {
            ui.showToastNotification('请先选择一个智能体和话题。', 'warning');
            return;
        }

        const studyInput = await resolveStudyInputText();
        if (!studyInput?.text) {
            ui.showToastNotification('请先选择笔记，或为当前话题绑定并导入来源资料。', 'warning');
            return;
        }

        const topicDisplayName = String(getCurrentTopicDisplayName() || '').trim();
        const fallbackQuizTitle = topicDisplayName && topicDisplayName !== '请选择一个话题'
            ? `${topicDisplayName} 测验`
            : '选择题练习';
        const prompts = {
            analysis: {
                title: `深度分析报告 ${new Date().toLocaleString()}`,
                instruction: '请基于以下学习材料生成一份结构化深度分析报告，包含：核心结论、关键知识点、关联关系、疑难点/待补问题、后续学习建议。使用简体中文 Markdown。',
                kind: 'analysis',
            },
            quiz: {
                title: fallbackQuizTitle,
                instruction: [
                    '请基于以下学习材料生成一组结构化选择题练习。',
                    '你必须只返回严格 JSON，不要输出 JSON 之外的任何文字。',
                    '禁止输出寒暄、前言、分隔线、时间戳标题、Markdown 标题或额外说明。',
                    'JSON 结构如下：',
                    '{',
                    '  "title": "测验标题",',
                    '  "items": [',
                    '    {',
                    '      "id": "quiz_1",',
                    '      "stem": "题干",',
                    '      "options": [',
                    '        { "id": "option_a", "label": "A", "text": "选项内容" },',
                    '        { "id": "option_b", "label": "B", "text": "选项内容" },',
                    '        { "id": "option_c", "label": "C", "text": "选项内容" },',
                    '        { "id": "option_d", "label": "D", "text": "选项内容" }',
                    '      ],',
                    '      "correctOptionId": "option_a",',
                    '      "explanation": "简明解析"',
                    '    }',
                    '  ]',
                    '}',
                    '要求：',
                    '1. 生成 8 道题。',
                    '2. 每题必须且只能有 4 个选项，label 必须严格为 A/B/C/D。',
                    '3. correctOptionId 必须严格对应某个 option.id。',
                    '4. 题干、选项、答案、解析全部使用简体中文。',
                    `5. title 采用“${fallbackQuizTitle}”这种简洁命名风格，不要带时间戳。`,
                ].join('\n'),
                kind: 'quiz',
            },
            flashcards: {
                title: `闪卡集合 ${new Date().toLocaleString()}`,
                instruction: [
                    '请基于以下学习材料生成一组适合复习记忆的结构化闪卡。',
                    '你必须返回严格 JSON，不要输出 JSON 之外的说明。',
                    'JSON 结构如下：',
                    '{',
                    '  "title": "卡组标题",',
                    '  "cards": [',
                    '    { "id": "card-1", "front": "问题正面", "back": "答案背面" }',
                    '  ]',
                    '}',
                    '要求：',
                    '1. 生成 12 张卡。',
                    '2. front 与 back 都使用简体中文，可包含少量 Markdown 强调。',
                    '3. 每张卡必须信息准确、去重、适合抽认卡练习。',
                    '4. title 要简洁、像一个可学习的卡组名称。',
                ].join('\n'),
                kind: 'flashcards',
            },
        };

        const prompt = prompts[kind];
        if (!prompt) {
            return;
        }

        if (prompt.kind === 'flashcards') {
            flashcardsApi.beginPendingGeneration({
                title: prompt.title,
                sourceCount: Array.isArray(studyInput.sourceDocumentRefs) ? studyInput.sourceDocumentRefs.length : 0,
            });
        }

        ui.showToastNotification('正在生成内容，请稍候…', 'info', 2500);

        const response = await chatAPI.sendToVCP({
            requestId: createId(`study_${kind}`),
            endpoint: state.settings.vcpServerUrl,
            apiKey: state.settings.vcpApiKey,
            messages: [
                {
                    role: 'system',
                    content: prompt.kind === 'quiz' || prompt.kind === 'flashcards'
                        ? '你是 UniStudy 的学习助手。请严格遵守输出格式要求，不要输出任何额外说明。'
                        : '你是 UniStudy 的学习助手，请输出结构清晰、适合学习沉淀的 Markdown。',
                },
                { role: 'user', content: `${prompt.instruction}\n\n学习材料如下：\n\n${studyInput.text}` },
            ],
            modelConfig: {
                model: state.currentSelectedItem.config?.model || 'gemini-3.1-flash-lite-preview',
                temperature: 0.4,
                max_tokens: Number(state.currentSelectedItem.config?.maxOutputTokens ?? 2400),
                top_p: 0.95,
                stream: false,
            },
            context: buildTopicContext(),
        });

        if (response?.error) {
            if (prompt.kind === 'flashcards') {
                flashcardsApi.clearPendingGeneration();
                setRightPanelMode('notes');
                renderNotesPanel();
            }
            ui.showToastNotification(`生成失败：${response.error}`, 'error');
            return;
        }

        const responseContent = response?.response?.choices?.[0]?.message?.content || '';
        if (!responseContent.trim()) {
            if (prompt.kind === 'flashcards') {
                flashcardsApi.clearPendingGeneration();
                setRightPanelMode('notes');
                renderNotesPanel();
            }
            ui.showToastNotification('模型没有返回可保存的内容。', 'warning');
            return;
        }

        let contentMarkdown = responseContent;
        let quizSet = null;
        let flashcardDeck = null;
        let flashcardProgress = null;

        if (prompt.kind === 'quiz') {
            quizSet = parseQuizSetFromResponse(responseContent, prompt.title);
            if (!quizSet) {
                ui.showToastNotification('选择题生成结果格式无效，请重试。', 'error');
                return;
            }

            contentMarkdown = buildQuizSummaryMarkdown(quizSet);
        } else if (prompt.kind === 'flashcards') {
            const generated = flashcardsApi.buildGeneratedFlashcardContent(
                responseContent,
                prompt.title,
                studyInput.sourceDocumentRefs,
            );

            if (!generated) {
                flashcardsApi.clearPendingGeneration();
                setRightPanelMode('notes');
                renderNotesPanel();
                ui.showToastNotification('闪卡生成结果格式无效，请重试。', 'error');
                return;
            }

            flashcardDeck = generated.flashcardDeck;
            flashcardProgress = generated.flashcardProgress;
            contentMarkdown = generated.contentMarkdown;
        }

        const saveResult = await chatAPI.saveTopicNote(state.currentSelectedItem.id, state.currentTopicId, {
            title: prompt.kind === 'quiz'
                ? (quizSet?.title || prompt.title)
                : (prompt.kind === 'flashcards' ? (flashcardDeck?.title || prompt.title) : prompt.title),
            contentMarkdown,
            sourceMessageIds: studyInput.sourceMessageIds,
            sourceDocumentRefs: studyInput.sourceDocumentRefs,
            kind: prompt.kind,
            quizSet,
            flashcardDeck,
            flashcardProgress,
        });

        if (!saveResult?.success) {
            if (prompt.kind === 'flashcards') {
                flashcardsApi.clearPendingGeneration();
                setRightPanelMode('notes');
                renderNotesPanel();
            }
            ui.showToastNotification(`保存生成结果失败：${saveResult?.error || '未知错误'}`, 'error');
            return;
        }

        await refreshNotesData();
        const savedNote = normalizeNote(saveResult.item);
        if (prompt.kind === 'flashcards' && flashcardsApi.hasStructuredFlashcards(savedNote)) {
            flashcardsApi.clearPendingGeneration();
            flashcardsApi.openPractice(savedNote, { trigger: el.generateFlashcardsBtn || null });
        } else {
            flashcardsApi.clearPendingGeneration();
            openNoteDetail(savedNote, {
                kind: getNormalizedNoteKind(savedNote),
                trigger: prompt.kind === 'analysis'
                    ? el.analyzeNotesBtn
                    : (prompt.kind === 'quiz' ? el.generateQuizBtn : null),
            });
        }

        setSidePanelTab('notes');
        ui.showToastNotification('已生成并保存到当前话题笔记。', 'success');
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
            closeNoteActionMenu();
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
            clearNoteEditor();
        }
        if (clearFlashcards) {
            flashcardsApi.resetState();
        }
        state.noteDetailMode = 'edit';
        resetQuizPracticeState(null);

        renderNotesPanel();
    }

    function setNotesScope(scope) {
        state.notesScope = scope === 'agent' ? 'agent' : 'topic';
        state.selectedNoteIds = [];
        renderNotesPanel();
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
            closeNoteActionMenu();
        });
        documentObj.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') {
                return;
            }
            if (state.activeNoteMenu) {
                closeNoteActionMenu();
            }
            if (el.noteDetailModal && !el.noteDetailModal.classList.contains('hidden')) {
                closeNoteDetail();
            }
        });
        el.notesList?.addEventListener('scroll', closeNoteActionMenu);
        el.topicNotesScopeBtn?.addEventListener('click', () => setNotesScope('topic'));
        el.agentNotesScopeBtn?.addEventListener('click', () => setNotesScope('agent'));
        el.newNoteBtn?.addEventListener('click', createBlankNote);
        el.newNoteFabBtn?.addEventListener('click', createBlankNote);
        el.notesStudioOpenBtn?.addEventListener('click', openNotesStudio);
        el.saveNoteBtn?.addEventListener('click', () => {
            void saveActiveNote();
        });
        el.analysisEditMarkdownBtn?.addEventListener('click', () => {
            setNoteDetailMode('edit');
        });
        el.analysisViewReportBtn?.addEventListener('click', () => {
            setNoteDetailMode('view');
        });
        el.quizEditSourceBtn?.addEventListener('click', () => {
            setNoteDetailMode('edit');
        });
        el.quizViewPracticeBtn?.addEventListener('click', () => {
            setNoteDetailMode('practice');
        });
        el.deleteNoteBtn?.addEventListener('click', () => {
            void deleteActiveNote();
        });
        el.analyzeNotesBtn?.addEventListener('click', () => {
            void runNotesTool('analysis');
        });
        el.generateQuizBtn?.addEventListener('click', () => {
            void runNotesTool('quiz');
        });
        el.generateFlashcardsBtn?.addEventListener('click', () => {
            void runNotesTool('flashcards');
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

    return {
        bindEvents,
        closeNoteActionMenu,
        closeNoteDetail,
        createBlankNote,
        decorateChatMessages,
        findNoteById,
        getActiveNote,
        getCurrentDetailNote,
        loadAgentNotes,
        loadTopicNotes,
        normalizeNote,
        openNoteDetail,
        refreshNotesData,
        renderNotesPanel,
        replaceNoteInCollections,
        resetState,
    };
}

export {
    createNotesController,
};
