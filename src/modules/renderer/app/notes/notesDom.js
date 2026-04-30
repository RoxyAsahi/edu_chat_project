import { positionFloatingElement } from '../dom/positionFloatingElement.js';
import {
    buildNotesSelectionSummary,
    formatRelativeTime,
    getNormalizedNoteKind,
} from './notesUtils.js';
import { hasStructuredQuiz } from '../quiz/quizUtils.js';

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

const QUIZ_DIFFICULTY_LABELS = Object.freeze({
    easy: '简单',
    medium: '中等',
    hard: '困难',
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

function createNotesDom(deps = {}) {
    const state = deps.state || {};
    const el = deps.el;
    const documentObj = deps.documentObj || document;
    const windowObj = deps.windowObj || window;
    const messageRendererApi = deps.messageRendererApi || {};
    const flashcardsApi = deps.flashcardsApi || {
        getFlashcardSourceCount: () => 0,
        getPendingGenerations: () => [],
        getPendingGeneration: () => null,
        hasStructuredFlashcards: () => false,
        openPractice: () => false,
    };
    const normalizeNote = deps.normalizeNote || ((note) => note);
    const getVisibleNotes = deps.getVisibleNotes || (() => []);
    const getGeneratedVisibleNotes = deps.getGeneratedVisibleNotes || (() => []);
    const getManualLibraryNotes = deps.getManualLibraryNotes || (() => []);
    const getManualLibrarySubjectFilters = deps.getManualLibrarySubjectFilters || (() => []);
    const getDiaryWallTabs = deps.getDiaryWallTabs || (() => []);
    const getDiaryWallActiveFilter = deps.getDiaryWallActiveFilter || (() => 'all');
    const resolveManualNotesLibraryFilter = deps.resolveManualNotesLibraryFilter || ((filter) => String(filter || 'all'));
    const getActiveNote = deps.getActiveNote || (() => null);
    const getCurrentTopicDisplayName = deps.getCurrentTopicDisplayName || (() => '请选择一个话题');
    const getTopicDisplayLabel = deps.getTopicDisplayLabel || ((topicId) => topicId || '未归类话题');
    const getNoteHighlightId = deps.getNoteHighlightId || (() => null);
    const getNoteDetailReturnTarget = deps.getNoteDetailReturnTarget || (() => 'studio');
    const openNoteDetail = deps.openNoteDetail || (() => {});
    const toggleNoteSelection = deps.toggleNoteSelection || (() => {});
    const deleteNoteRecord = deps.deleteNoteRecord || (async () => {});
    const closeTopicActionMenu = deps.closeTopicActionMenu || (() => {});
    const closeSourceFileActionMenu = deps.closeSourceFileActionMenu || (() => {});

    const ElementCtor = windowObj.Element || globalThis.Element;

    function clearNoteEditor() {
        state.activeNoteId = null;
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
        const notePreviewMode = kind === 'note' && state.noteDetailMode === 'view';
        if (kind === 'quiz' && !structuredQuiz) {
            state.noteDetailMode = 'edit';
        }
        const practiceMode = kind === 'quiz' && structuredQuiz && state.noteDetailMode === 'practice';
        const editable = !flashcards
            && !analysisPreviewMode
            && !notePreviewMode
            && (!structuredQuiz || state.noteDetailMode === 'edit');
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
        const backButton = el.noteDetailBackBtn || el.flashcardsBackToNotesBtn || null;
        if (backButton) {
            const fromManualNotes = getNoteDetailReturnTarget() === 'manual-notes';
            backButton.innerHTML = `
                <span class="material-symbols-outlined">arrow_back</span> ${fromManualNotes ? '返回我的笔记' : '返回 Studio'}
            `;
            backButton.setAttribute('aria-label', fromManualNotes ? '返回我的笔记' : '返回 Studio');
        }
        el.saveNoteBtn?.classList.toggle('hidden', !editable);
        el.analysisEditMarkdownBtn?.classList.toggle('hidden', !(kind === 'analysis' && analysisPreviewMode));
        el.analysisViewReportBtn?.classList.toggle('hidden', !(kind === 'analysis' && !analysisPreviewMode && Boolean(note?.id)));
        el.noteEditMarkdownBtn?.classList.toggle('hidden', !(kind === 'note' && notePreviewMode));
        el.noteViewPreviewBtn?.classList.toggle('hidden', !(kind === 'note' && !notePreviewMode));
        el.quizEditSourceBtn?.classList.toggle('hidden', !(kind === 'quiz' && structuredQuiz && practiceMode));
        el.quizViewPracticeBtn?.classList.toggle('hidden', !(kind === 'quiz' && structuredQuiz && !practiceMode));
        el.deleteNoteBtn?.classList.toggle('hidden', !note?.id);
        el.analysisPreviewCard?.classList.toggle('hidden', !analysisPreviewMode);
        el.noteMarkdownPreviewCard?.classList.toggle('hidden', !notePreviewMode);
        el.noteEditorCard?.classList.toggle('hidden', flashcards || practiceMode || analysisPreviewMode || notePreviewMode);
        el.quizPracticeCard?.classList.toggle('hidden', !practiceMode);
        el.flashcardsPracticeCard?.classList.toggle('hidden', !flashcards);
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
        const topicLabel = note.topicId ? ` · ${getTopicDisplayLabel(note.topicId)}` : '';
        if (el.noteMetaSummary) {
            el.noteMetaSummary.textContent = `更新时间：${formatRelativeTime(note.updatedAt)}${topicLabel} · 来源消息 ${sourceCount} 条 · 来源资料 ${refCount} 条`;
        }
        if (!state.noteDetailKind || state.noteDetailKind === 'note') {
            state.noteDetailKind = getNormalizedNoteKind(note);
        }
        syncNoteDetailChrome(note);
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
        positionFloatingElement(
            el.noteActionMenu,
            state.activeNoteMenu.anchorRect,
            state.activeNoteMenu.placement || 'left',
            windowObj,
        );
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

    function openNoteItemMenu(note, anchorElement, options = {}) {
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
            anchorRect: options.anchorRect || anchorElement.getBoundingClientRect(),
            placement: options.placement || 'left',
        };
        renderNoteActionMenu();
    }

    function updateNotesSelectionSummary() {
        if (!el.notesSelectionSummary) {
            return;
        }

        const selectedCount = state.selectedNoteIds.length;
        const scopeLabel = state.notesScope === 'agent' ? '学科汇总' : '当前话题';
        const generatedCount = getGeneratedVisibleNotes().length;

        if (selectedCount > 0) {
            el.notesSelectionSummary.textContent = buildNotesSelectionSummary({
                notesScope: state.notesScope,
                selectedCount,
                visibleCount: getVisibleNotes().length,
            });
            return;
        }

        if (generatedCount > 0) {
            el.notesSelectionSummary.textContent = `${scopeLabel} · 最近生成 ${generatedCount} 条内容`;
            return;
        }

        el.notesSelectionSummary.textContent = `${scopeLabel} · 暂无生成内容，普通笔记请到顶部“我的笔记”查看`;
    }

    function cleanupRichPreviews(root) {
        if (!root || typeof messageRendererApi.cleanupNotePreviewMount !== 'function') {
            return;
        }
        root.querySelectorAll?.('.unistudy-note-rich-preview').forEach((node) => {
            messageRendererApi.cleanupNotePreviewMount(node);
        });
    }

    function buildCompactPreviewSignature(note = {}) {
        const snapshot = note?.renderSnapshot && typeof note.renderSnapshot === 'object'
            ? {
                schemaVersion: note.renderSnapshot.schemaVersion,
                renderer: note.renderSnapshot.renderer,
                role: note.renderSnapshot.role,
                sourceMessageId: note.renderSnapshot.sourceMessageId,
                contentHtml: note.renderSnapshot.contentHtml,
                styleText: note.renderSnapshot.styleText,
                scopeId: note.renderSnapshot.scopeId,
            }
            : null;

        return JSON.stringify({
            id: String(note?.id || ''),
            contentMarkdown: String(note?.contentMarkdown || ''),
            snapshot,
        });
    }

    function renderCompactNotePreview(target, note, options = {}) {
        if (!target) {
            return;
        }
        const previewSignature = buildCompactPreviewSignature(note);
        if (
            options.forceRemount !== true
            && target.dataset?.unistudyCompactPreviewSignature === previewSignature
        ) {
            return;
        }

        if (typeof messageRendererApi.mountRichNotePreview === 'function') {
            messageRendererApi.mountRichNotePreview(target, note, {
                compact: true,
                emptyText: '暂无内容。',
                forceRemount: options.forceRemount === true,
            });
            if (target.dataset) {
                target.dataset.unistudyCompactPreviewSignature = previewSignature;
            }
            return;
        }
        target.textContent = stripMarkdown(note?.contentMarkdown || '').trim() || '暂无内容。';
        if (target.dataset) {
            target.dataset.unistudyCompactPreviewSignature = previewSignature;
        }
    }

    function getPendingQuizGenerationsForCurrentTopic() {
        const agentId = String(state.currentSelectedItem?.id || '').trim();
        const topicId = String(state.currentTopicId || '').trim();
        if (!agentId || !topicId || !Array.isArray(state.pendingQuizGenerations)) {
            return [];
        }

        return state.pendingQuizGenerations.filter((pending) => (
            pending
            && String(pending.agentId || '') === agentId
            && String(pending.topicId || '') === topicId
        ));
    }

    function getPendingFlashcardGenerationsForCurrentTopic() {
        const agentId = String(state.currentSelectedItem?.id || '').trim();
        const topicId = String(state.currentTopicId || '').trim();
        if (!agentId || !topicId) {
            return [];
        }

        const pendingItems = typeof flashcardsApi.getPendingGenerations === 'function'
            ? flashcardsApi.getPendingGenerations()
            : [];
        const pendingFlashcards = Array.isArray(pendingItems) && pendingItems.length > 0
            ? pendingItems
            : (flashcardsApi.getPendingGeneration?.() ? [flashcardsApi.getPendingGeneration()] : []);

        return pendingFlashcards.filter((pending) => (
            pending
            && String(pending.agentId || '') === agentId
            && String(pending.topicId || '') === topicId
        ));
    }

    function renderPendingQuizCard(pending) {
        const pendingCard = documentObj.createElement('div');
        const questionCount = Number(pending?.questionCount || 0);
        const difficultyLabel = QUIZ_DIFFICULTY_LABELS[pending?.difficulty] || '中等';
        const sourceCount = Number(pending?.sourceCount || 0);
        const focus = String(pending?.focus || '').trim();
        const metaParts = [
            questionCount > 0 ? `${questionCount} 题` : '选择题',
            difficultyLabel,
            sourceCount > 0 ? `${sourceCount} 个来源` : '当前学习材料',
        ];
        pendingCard.className = 'note-card note-card--studio note-card--pending note-card--quiz-pending note-card--active';
        pendingCard.innerHTML = `
            <div class="note-card__studio-main">
                <div class="note-card__studio-icon note-card__quiz-icon note-card__quiz-icon--pending">
                    <span class="material-symbols-outlined">hourglass_top</span>
                </div>
                <div class="note-card__studio-body">
                    <div class="note-card__studio-heading">
                        <strong>正在生成选择题...</strong>
                    </div>
                    <div class="note-card__studio-preview">${escapeHtml(focus ? `主题：${focus}` : '正在整理题目、选项和解析')}</div>
                    <div class="note-card__studio-meta">
                        ${metaParts.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}
                    </div>
                </div>
            </div>
        `;
        return pendingCard;
    }

    function renderPendingFlashcardCard(pending) {
        const pendingCard = documentObj.createElement('div');
        const cardCount = Number(pending?.cardCount || 0);
        const difficultyLabel = QUIZ_DIFFICULTY_LABELS[pending?.difficulty] || '中等';
        const sourceCount = Number(pending?.sourceCount || 0);
        const focus = String(pending?.focus || '').trim();
        const metaParts = [
            cardCount > 0 ? `${cardCount} 张` : '闪卡',
            difficultyLabel,
            sourceCount > 0 ? `${sourceCount} 个来源` : '当前学习材料',
        ];
        pendingCard.className = 'note-card note-card--studio note-card--flashcard-entry note-card--pending note-card--active';
        pendingCard.innerHTML = `
            <div class="note-card__studio-main">
                <div class="note-card__studio-icon note-card__flashcard-icon note-card__flashcard-icon--pending">
                    <span class="material-symbols-outlined">hourglass_top</span>
                </div>
                <div class="note-card__studio-body">
                    <div class="note-card__studio-heading">
                        <strong class="note-card__flashcard-title">正在生成闪卡...</strong>
                    </div>
                    <div class="note-card__studio-preview">${escapeHtml(focus ? `主题：${focus}` : '正在整理卡片正面和答案')}</div>
                    <div class="note-card__studio-meta">
                        ${metaParts.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}
                    </div>
                </div>
            </div>
        `;
        return pendingCard;
    }

    function getManualLibraryAgentLabel(agentId) {
        const normalizedAgentId = String(agentId || '').trim();
        if (!normalizedAgentId) {
            return '未归类学科';
        }

        const agent = (Array.isArray(state.agents) ? state.agents : [])
            .find((item) => String(item?.id || '') === normalizedAgentId);
        if (agent?.name) {
            return agent.name;
        }
        if (String(state.currentSelectedItem?.id || '') === normalizedAgentId && state.currentSelectedItem?.name) {
            return state.currentSelectedItem.name;
        }
        return normalizedAgentId;
    }

    function renderPendingAnalysisCard(pending) {
        const pendingCard = documentObj.createElement('article');
        const selectedNoteCount = Number(pending?.selectedNoteCount || 0);
        const metaParts = [
            selectedNoteCount > 0 ? `${selectedNoteCount} 条笔记` : '深度分析',
            getManualLibraryAgentLabel(pending?.agentId),
            getTopicDisplayLabel(pending?.topicId),
        ].filter(Boolean);

        pendingCard.className = 'manual-note-card manual-note-card--pending manual-note-card--analysis-pending';
        pendingCard.setAttribute('aria-busy', 'true');
        pendingCard.innerHTML = `
            <div class="manual-note-card__pending-icon">
                <span class="material-symbols-outlined" aria-hidden="true">hourglass_top</span>
            </div>
            <div class="manual-note-card__pending-body">
                <strong>正在生成深度分析...</strong>
                <span>${escapeHtml(pending?.title || '深度分析报告')}</span>
            </div>
            <div class="manual-note-card__meta">
                ${metaParts.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}
            </div>
        `;
        return pendingCard;
    }

    function buildPendingAnalysisKey(pending) {
        const fallback = [
            pending?.title,
            pending?.agentId,
            pending?.topicId,
            pending?.selectedNoteCount,
        ].map((value) => String(value || '')).join(':');
        return `pending-analysis:${String(pending?.requestId || fallback || 'pending')}`;
    }

    function buildPendingAnalysisSignature(pending) {
        return JSON.stringify({
            requestId: String(pending?.requestId || ''),
            title: String(pending?.title || ''),
            selectedNoteCount: Number(pending?.selectedNoteCount || 0),
            agentId: String(pending?.agentId || ''),
            topicId: String(pending?.topicId || ''),
        });
    }

    function updatePendingAnalysisCard(card, pending) {
        const signature = buildPendingAnalysisSignature(pending);
        if (card.dataset?.manualGridItemSignature === signature) {
            return;
        }
        const freshCard = renderPendingAnalysisCard(pending);
        card.className = freshCard.className;
        card.setAttribute('aria-busy', 'true');
        card.innerHTML = freshCard.innerHTML;
        card.dataset.manualGridItemSignature = signature;
    }

    function createManualNoteCard() {
        const card = documentObj.createElement('article');
        card.addEventListener('click', (event) => {
            const target = event.target;
            if (target instanceof ElementCtor && target.closest('[data-note-menu]')) {
                return;
            }
            if (card.__unistudyManualNote) {
                openNoteDetail(card.__unistudyManualNote, { trigger: card });
            }
        });
        card.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!card.__unistudyManualNote) {
                return;
            }
            openNoteItemMenu(card.__unistudyManualNote, card, {
                anchorRect: {
                    left: event.clientX,
                    right: event.clientX,
                    top: event.clientY,
                    bottom: event.clientY,
                    width: 0,
                    height: 0,
                },
                placement: 'right',
            });
        });
        return card;
    }

    function ensureManualNoteCardSkeleton(card, noteId) {
        if (
            card.querySelector('.manual-note-card__preview')
            && card.querySelector('.manual-note-card__meta')
        ) {
            return;
        }

        card.innerHTML = `
            <div class="manual-note-card__preview" data-note-preview="${escapeHtml(noteId)}"></div>
            <div class="manual-note-card__meta"></div>
        `;
    }

    function buildManualNoteMetaHtml(normalized, options = {}) {
        const topicLabel = escapeHtml(getTopicDisplayLabel(normalized.topicId));
        const agentLabel = escapeHtml(getManualLibraryAgentLabel(normalized.agentId));
        const updatedLabel = escapeHtml(formatRelativeTime(normalized.updatedAt) || '');
        const isSelected = options.isSelected === true;
        const isAnalysisFilter = options.isAnalysisFilter === true;

        return [
            isAnalysisFilter ? `<span>${agentLabel}</span>` : '',
            `<span>${topicLabel}</span>`,
            `<span>${updatedLabel}</span>`,
            isSelected ? '<span class="manual-note-card__selection">已选用于生成</span>' : '',
        ].filter(Boolean).join('');
    }

    function updateManualNoteCard(card, normalized, options = {}) {
        const noteId = String(normalized.id || '');
        const isSelected = options.isSelected === true;
        card.__unistudyManualNote = normalized;
        card.className = 'manual-note-card';
        card.classList.toggle('manual-note-card--selected', isSelected);
        card.setAttribute('aria-label', `${normalized.title || '未命名笔记'}，右键打开菜单`);
        ensureManualNoteCardSkeleton(card, noteId);

        const preview = card.querySelector('.manual-note-card__preview');
        if (preview) {
            preview.setAttribute('data-note-preview', noteId);
            renderCompactNotePreview(preview, normalized, {
                forceRemount: options.forcePreviewRemount === true,
            });
        }

        const meta = card.querySelector('.manual-note-card__meta');
        const metaHtml = buildManualNoteMetaHtml(normalized, {
            isSelected,
            isAnalysisFilter: options.isAnalysisFilter === true,
        });
        if (meta && card.dataset.manualNoteMetaHtml !== metaHtml) {
            meta.innerHTML = metaHtml;
            card.dataset.manualNoteMetaHtml = metaHtml;
        }
    }

    function removeManualGridItem(node) {
        cleanupRichPreviews(node);
        node.remove();
    }

    function reconcileManualNotesGrid(items = []) {
        if (!el.manualNotesLibraryGrid) {
            return;
        }

        const desiredKeys = new Set(items.map((item) => item.key));
        Array.from(el.manualNotesLibraryGrid.children).forEach((child) => {
            const key = child.dataset?.manualGridItemKey || '';
            if (!desiredKeys.has(key)) {
                removeManualGridItem(child);
            }
        });

        const existingByKey = new Map();
        Array.from(el.manualNotesLibraryGrid.children).forEach((child) => {
            const key = child.dataset?.manualGridItemKey || '';
            if (key) {
                existingByKey.set(key, child);
            }
        });

        let cursor = el.manualNotesLibraryGrid.firstElementChild;
        items.forEach((item) => {
            let node = existingByKey.get(item.key);
            if (!node) {
                node = item.create();
                node.dataset.manualGridItemKey = item.key;
            }
            item.update(node);

            if (node.parentElement !== el.manualNotesLibraryGrid) {
                el.manualNotesLibraryGrid.insertBefore(node, cursor || null);
            } else if (node !== cursor) {
                el.manualNotesLibraryGrid.insertBefore(node, cursor || null);
            }
            cursor = node.nextElementSibling;
        });
    }

    function renderNotesPanel() {
        if (state.notesScope !== 'topic') {
            state.notesScope = 'topic';
        }

        const notes = getGeneratedVisibleNotes();
        const pendingQuizzes = getPendingQuizGenerationsForCurrentTopic();
        const pendingFlashcards = getPendingFlashcardGenerationsForCurrentTopic();
        const hasPendingQuiz = pendingQuizzes.length > 0;
        const hasPendingFlashcards = pendingFlashcards.length > 0;
        closeNoteActionMenu();

        el.topicNotesScopeBtn?.classList.toggle('notes-scope-btn--active', state.notesScope === 'topic');
        el.agentNotesScopeBtn?.classList.toggle('notes-scope-btn--active', state.notesScope === 'agent');
        if (el.openPomodoroBtn) {
            el.openPomodoroBtn.classList.toggle('notes-tool-tile--active', state.studioPomodoroVisible === true);
            const pomodoroArrow = el.openPomodoroBtn.querySelector('.notes-tool-tile__arrow');
            if (pomodoroArrow) {
                pomodoroArrow.textContent = state.studioPomodoroVisible === true ? 'expand_more' : 'chevron_right';
            }
        }
        if (el.generateQuizBtn) {
            el.generateQuizBtn.classList.toggle('notes-tool-tile--active', hasPendingQuiz);
            el.generateQuizBtn.toggleAttribute('disabled', hasPendingQuiz);
            el.generateQuizBtn.setAttribute('aria-busy', hasPendingQuiz ? 'true' : 'false');
            const quizArrow = el.generateQuizBtn.querySelector('.notes-tool-tile__arrow');
            if (quizArrow) {
                quizArrow.textContent = hasPendingQuiz ? 'hourglass_top' : 'chevron_right';
            }
        }
        if (el.generateFlashcardsBtn) {
            el.generateFlashcardsBtn.classList.toggle('notes-tool-tile--active', hasPendingFlashcards);
            el.generateFlashcardsBtn.setAttribute('aria-busy', hasPendingFlashcards ? 'true' : 'false');
            el.generateFlashcardsBtn.removeAttribute('disabled');
            const flashcardArrow = el.generateFlashcardsBtn.querySelector('.notes-tool-tile__arrow');
            if (flashcardArrow) {
                flashcardArrow.textContent = hasPendingFlashcards ? 'hourglass_top' : 'chevron_right';
            }
        }
        updateNotesSelectionSummary();

        if (!el.notesList) {
            return;
        }

        cleanupRichPreviews(el.notesList);
        el.notesList.innerHTML = '';

        if (el.studioPomodoroPanel && state.studioPomodoroVisible) {
            el.studioPomodoroPanel.classList.remove('hidden');
            el.studioPomodoroPanel.classList.toggle('notes-pomodoro-panel--collapsed', state.studioPomodoroExpanded === false);
            el.studioPomodoroBody?.classList.toggle('hidden', state.studioPomodoroExpanded === false);
            el.studioPomodoroToggleBtn?.setAttribute('aria-expanded', state.studioPomodoroExpanded === false ? 'false' : 'true');
            el.notesList.appendChild(el.studioPomodoroPanel);
        }

        pendingQuizzes.forEach((pending) => {
            el.notesList.appendChild(renderPendingQuizCard(pending));
        });

        pendingFlashcards.forEach((pending) => {
            el.notesList.appendChild(renderPendingFlashcardCard(pending));
        });

        if (notes.length === 0 && !hasPendingFlashcards && !hasPendingQuiz) {
            const empty = documentObj.createElement('div');
            empty.className = 'empty-list-state';
            empty.innerHTML = `
                <strong>还没有生成内容</strong>
                <span>右侧这里会显示分析报告、选择题和闪卡；你手写的普通笔记会收纳到顶部“我的笔记”。</span>
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
            const isStructuredQuiz = hasStructuredQuiz(normalized);
            const isGeneratedPracticeCard = isInteractiveFlashcard || isStructuredQuiz;
            const isSelected = state.selectedNoteIds.includes(normalized.id);
            card.classList.toggle('note-card--flashcard-entry', isInteractiveFlashcard);
            card.classList.toggle('note-card--generated-entry', isGeneratedPracticeCard);
            card.classList.toggle('note-card--active', normalized.id === getNoteHighlightId());
            card.classList.toggle('note-card--selected', isSelected);

            const sourceCount = flashcardsApi.getFlashcardSourceCount(normalized);
            const typeKind = getNormalizedNoteKind(normalized);
            const typeConfig = {
                analysis: { icon: 'analytics', label: '分析', accent: 'analysis' },
                quiz: { icon: 'quiz', label: '测验', accent: 'quiz' },
                flashcards: { icon: 'style', label: '闪卡', accent: 'flashcards' },
            }[typeKind] || { icon: 'description', label: '内容', accent: 'note' };
            const metaParts = [
                sourceCount > 0 ? `${sourceCount} 个来源` : '当前话题',
                formatRelativeTime(normalized.updatedAt),
            ];
            if (state.notesScope === 'agent' && normalized.topicId) {
                metaParts.push(getTopicDisplayLabel(normalized.topicId));
            }
            const selectedBadge = isSelected
                ? '<span class="note-card__selection-pill"><span class="material-symbols-outlined">check</span><span>已选</span></span>'
                : '';

            if (isGeneratedPracticeCard) {
                const isQuizCard = isStructuredQuiz && !isInteractiveFlashcard;
                const cardCount = Array.isArray(normalized.flashcardDeck?.cards) ? normalized.flashcardDeck.cards.length : 0;
                const questionCount = Array.isArray(normalized.quizSet?.items) ? normalized.quizSet.items.length : 0;
                const generatedTitle = isQuizCard
                    ? (normalized.quizSet?.title || normalized.title || '选择题练习')
                    : (normalized.flashcardDeck?.title || normalized.title || '闪卡练习');
                const generatedMetaFallback = isQuizCard
                    ? (questionCount > 0 ? `${questionCount} 道题` : '选择题')
                    : (cardCount > 0 ? `${cardCount} 张卡` : '闪卡');
                const generatedMeta = `${sourceCount > 0 ? `${sourceCount} 个来源` : generatedMetaFallback} · ${formatRelativeTime(normalized.updatedAt)}`;
                const generatedIconClass = isQuizCard ? 'note-card__quiz-icon' : 'note-card__flashcard-icon';
                const generatedIcon = isQuizCard ? 'quiz' : 'cards_star';
                card.innerHTML = `
                    <div class="note-card__studio-main">
                        <div class="note-card__studio-icon ${generatedIconClass}">
                            <span class="material-symbols-outlined">${escapeHtml(generatedIcon)}</span>
                        </div>
                        <div class="note-card__studio-body">
                            <div class="note-card__studio-heading">
                                <strong class="note-card__generated-title">${escapeHtml(generatedTitle)}</strong>
                                ${selectedBadge}
                            </div>
                            <div class="note-card__generated-meta">${escapeHtml(generatedMeta)}</div>
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
                            <div class="note-card__studio-preview" data-note-preview="${escapeHtml(normalized.id)}"></div>
                            <div class="note-card__studio-meta">
                                <span class="note-card__kind note-card__kind--studio">
                                    <span class="material-symbols-outlined">${escapeHtml(typeConfig.icon)}</span>
                                    <span>${escapeHtml(typeConfig.label)}</span>
                                </span>
                                ${metaParts.map((item) => `<span>${escapeHtml(item || '')}</span>`).join('')}
                            </div>
                        </div>
                        <button class="note-card__menu-button" type="button" data-note-menu="${escapeHtml(normalized.id)}" aria-label="打开笔记菜单">
                            <span class="material-symbols-outlined">more_vert</span>
                        </button>
                    </div>
                `;
                renderCompactNotePreview(card.querySelector('.note-card__studio-preview'), normalized);
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

    function renderManualNotesLibrary(options = {}) {
        if (!el.manualNotesLibraryGrid) {
            return;
        }

        const isDiaryPanel = state.manualNotesLibraryActivePanel === 'diary';
        const agents = Array.isArray(state.agents) ? state.agents : [];
        let currentFilter = isDiaryPanel
            ? String(getDiaryWallActiveFilter() || 'all')
            : resolveManualNotesLibraryFilter(state.manualNotesLibraryFilter || 'all') || 'all';
        if (!isDiaryPanel) {
            const requestedFilter = String(state.manualNotesLibraryFilter || 'all');
            if (currentFilter !== requestedFilter) {
                state.manualNotesLibraryFilter = currentFilter;
            }
        }
        const isAnalysisFilter = !isDiaryPanel && currentFilter === 'analysis';
        const libraryNotes = getManualLibraryNotes(currentFilter);
        const pendingAnalysisGenerations = isAnalysisFilter && Array.isArray(state.pendingAnalysisGenerations)
            ? state.pendingAnalysisGenerations
            : [];
        const subjectFilters = getManualLibrarySubjectFilters();
        const currentAgent = currentFilter === 'all' || isAnalysisFilter
            ? null
            : agents.find((agent) => String(agent?.id || '') === currentFilter);
        const currentSubjectFilter = subjectFilters.find((tab) => String(tab?.id || '') === currentFilter);
        const currentAgentName = currentAgent?.name || currentSubjectFilter?.label || state.currentSelectedItem?.name || '当前学科';
        const setGridEmptyState = (empty) => {
            el.manualNotesLibraryGrid.classList.toggle('manual-notes-library-grid--empty', empty);
        };

        const tabsCollapsed = Boolean(state.manualNotesLibraryTabsCollapsed);
        if (el.manualNotesLibrarySubjectTabsWrapper) {
            el.manualNotesLibrarySubjectTabsWrapper.classList.toggle('manual-notes-library-page__subject-tabs-wrapper--collapsed', tabsCollapsed);
        }
        if (el.manualNotesLibrarySubjectToggle) {
            el.manualNotesLibrarySubjectToggle.setAttribute('aria-expanded', String(!tabsCollapsed));
        }
        if (el.manualNotesLibrarySubjectTabs) {
            const isDiaryPanel = state.manualNotesLibraryActivePanel === 'diary';
            let tabs;
            if (isDiaryPanel) {
                const diaryTabs = getDiaryWallTabs();
                if (diaryTabs.length > 0 && diaryTabs[0].id === 'all') {
                    diaryTabs[0] = { ...diaryTabs[0], label: '筛选' };
                }
                tabs = diaryTabs.filter(Boolean);
            } else {
                tabs = [
                    { id: 'all', label: '筛选' },
                    { id: 'analysis', label: '深度分析' },
                    ...subjectFilters,
                ].filter(Boolean);
            }
            el.manualNotesLibrarySubjectTabs.innerHTML = tabs.map((tab) => {
                const isActive = String(tab.id) === currentFilter;
                return `<button type="button" class="manual-notes-library-page__subject-tab${isActive ? ' manual-notes-library-page__subject-tab--active' : ''}" data-subject-filter="${escapeHtml(tab.id)}" role="tab" aria-selected="${isActive ? 'true' : 'false'}">${escapeHtml(tab.label)}</button>`;
            }).join('');
        }

        if (el.manualNotesLibraryTitle) {
            const titlePrefix = isAnalysisFilter
                ? '深度分析'
                : (currentFilter === 'all' ? '全部学科' : currentAgentName);
            el.manualNotesLibraryTitle.textContent = `${titlePrefix} · 我的笔记`;
        }
        if (el.manualNotesLibrarySubtitle) {
            if (isAnalysisFilter) {
                const pendingText = pendingAnalysisGenerations.length > 0
                    ? `，${pendingAnalysisGenerations.length} 份正在生成`
                    : '';
                el.manualNotesLibrarySubtitle.textContent = `这里收纳已生成的 ${libraryNotes.length} 份深度分析报告${pendingText}。`;
            } else {
                const selectedCount = libraryNotes.filter((note) => state.selectedNoteIds.includes(note.id)).length;
                el.manualNotesLibrarySubtitle.textContent = currentFilter === 'all'
                    ? `这里收纳全部学科收藏的 ${libraryNotes.length} 条手写笔记，已选 ${selectedCount} 条。`
                    : `这里收纳 ${currentAgentName} 的 ${libraryNotes.length} 条手写笔记，已选 ${selectedCount} 条。`;
            }
        }

        const replaceGridWithEmptyState = (title, description) => {
            cleanupRichPreviews(el.manualNotesLibraryGrid);
            el.manualNotesLibraryGrid.innerHTML = '';
            const empty = documentObj.createElement('div');
            empty.className = 'empty-list-state manual-notes-library-empty manual-notes-library-grid__empty';
            empty.innerHTML = `
                <img class="manual-notes-library-empty__image" src="../assets/写作业.webp" alt="" />
                <div class="manual-notes-library-empty__copy">
                    <strong>${escapeHtml(title)}</strong>
                    <span>${escapeHtml(description)}</span>
                </div>
            `;
            el.manualNotesLibraryGrid.appendChild(empty);
        };

        if (!state.currentSelectedItem?.id && currentFilter !== 'all' && !isAnalysisFilter) {
            setGridEmptyState(true);
            replaceGridWithEmptyState('还没有选中学科', '请选择一个学科后，再查看当前学科下的手写笔记总览。');
            return;
        }

        if (libraryNotes.length === 0 && pendingAnalysisGenerations.length === 0) {
            setGridEmptyState(true);
            const emptyTitle = isAnalysisFilter
                ? '还没有深度分析报告'
                : (currentFilter === 'all' ? '还没有收藏的手写笔记' : '当前学科还没有手写笔记');
            const emptyDescription = isAnalysisFilter
                ? '点击“深度分析”，选择多条笔记后生成的报告会直接出现在这里。'
                : '在对话页面对想沉淀的消息右键，选择“记入笔记”，内容会自动收纳到这里。';
            replaceGridWithEmptyState(emptyTitle, emptyDescription);
            return;
        }

        setGridEmptyState(false);

        const gridItems = [];
        pendingAnalysisGenerations.forEach((pending) => {
            gridItems.push({
                key: buildPendingAnalysisKey(pending),
                create: () => documentObj.createElement('article'),
                update: (node) => updatePendingAnalysisCard(node, pending),
            });
        });

        libraryNotes.forEach((note) => {
            const normalized = normalizeNote(note);
            gridItems.push({
                key: `note:${normalized.id}`,
                create: createManualNoteCard,
                update: (node) => updateManualNoteCard(node, normalized, {
                    isAnalysisFilter,
                    isSelected: state.selectedNoteIds.includes(normalized.id),
                    forcePreviewRemount: options.forcePreviewRemount === true,
                }),
            });
        });

        reconcileManualNotesGrid(gridItems);
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
        }
    }

    return {
        clearNoteEditor,
        closeNoteActionMenu,
        fillNoteEditor,
        openNoteItemMenu,
        renderManualNotesLibrary,
        renderNoteActionMenu,
        renderNotesPanel,
        decorateChatMessages,
        syncNoteDetailChrome,
    };
}

export {
    createNotesDom,
};
