
import { initialize as initializeInterruptHandler, interrupt as interruptRequest } from '../modules/renderer/interruptHandler.js';
import { initializeInputEnhancer } from '../modules/renderer/inputEnhancerLite.js';
import * as messageRenderer from '../modules/renderer/messageRenderer.js';
import { renderMarkdownToSafeHtml } from '../modules/renderer/safeHtml.js';
import { createAppStore, createInitialAppState } from '../modules/renderer/app/store/appStore.js';
import { collectRootElements } from '../modules/renderer/app/dom/collectRootElements.js';
import { createLayoutController } from '../modules/renderer/app/layout/layoutController.js';
import { createSettingsController } from '../modules/renderer/app/settings/settingsController.js';

const chatAPI = window.chatAPI || window.electronAPI;
const ui = window.uiHelperFunctions;
const appStore = createAppStore(createInitialAppState());
const state = appStore.getState();

const TOPIC_SOURCE_FILE_LIMIT = 50;
const el = collectRootElements(document);
const layoutController = createLayoutController({
    state,
    el,
    chatAPI,
    ui,
    windowObj: window,
    documentObj: document,
});
const {
    normalizeStoredLayoutWidth,
    normalizeStoredLayoutHeight,
    applyLayoutWidths,
    applyLeftSidebarHeights,
    scheduleLayoutRefresh,
    initializeResizableLayout,
    beginLayoutResize,
    updateLayoutResize,
    endLayoutResize,
    beginVerticalLayoutResize,
    updateVerticalLayoutResize,
    endVerticalLayoutResize,
} = layoutController;
const settingsController = createSettingsController({
    state,
    el,
    chatAPI,
    windowObj: window,
    documentObj: document,
    messageRendererApi: messageRenderer,
    normalizeStoredLayoutWidth,
    normalizeStoredLayoutHeight,
    applyLayoutWidths,
    applyLeftSidebarHeights,
});
const {
    applyTheme,
    applyRendererSettings,
    syncGlobalSettingsForm,
    loadSettings,
    switchSettingsModalSection,
    openSettingsModal,
    closeSettingsModal,
} = settingsController;

let markedInstance;
let knowledgeBasePollTimer = null;
let knowledgeBasePollInFlight = false;
let noteDetailTrigger = null;
const DEFAULT_SEND_BUTTON_HTML = el.sendMessageBtn?.innerHTML || '';
const INTERRUPT_SEND_BUTTON_HTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="none" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor"></rect>
    </svg>
`;

function makeId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

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

function renderMarkdownFragment(text) {
    const markdown = String(text || '').trim();
    if (!markdown) {
        return '';
    }

    return renderMarkdownToSafeHtml(
        markdown,
        markedInstance || {
            parse(value) {
                return `<p>${escapeHtml(value)}</p>`;
            },
        },
    );
}

function extractStructuredJsonPayload(text) {
    const raw = String(text || '').trim();
    if (!raw) {
        return null;
    }

    const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fencedMatch?.[1]?.trim() || raw;

    try {
        return JSON.parse(candidate);
    } catch {
        return null;
    }
}

function normalizeFlashcardSourceRefs(refs, fallback = []) {
    return Array.isArray(refs) ? refs.filter(Boolean) : fallback;
}

function normalizeFlashcardDeck(deck, fallbackRefs = []) {
    if (!deck || typeof deck !== 'object') {
        return null;
    }

    const cards = Array.isArray(deck.cards)
        ? deck.cards.map((card, index) => {
            if (!card || typeof card !== 'object') {
                return null;
            }

            const front = String(card.front || '').trim();
            const back = String(card.back || '').trim();
            if (!front || !back) {
                return null;
            }

            return {
                id: String(card.id || makeId(`flashcard_${index + 1}`)),
                front,
                back,
                sourceDocumentRefs: normalizeFlashcardSourceRefs(card.sourceDocumentRefs, fallbackRefs),
            };
        }).filter(Boolean)
        : [];

    if (cards.length === 0) {
        return null;
    }

    return {
        title: String(deck.title || '闪卡集合').trim() || '闪卡集合',
        cards,
    };
}

function normalizeFlashcardProgress(progress, deck) {
    if (!deck || !Array.isArray(deck.cards) || deck.cards.length === 0) {
        return null;
    }

    const rawStates = Array.isArray(progress?.cardStates) ? progress.cardStates : [];
    const cardStates = deck.cards.map((card) => {
        const existing = rawStates.find((item) => item && String(item.cardId || '') === card.id);
        const result = existing?.result === 'known' || existing?.result === 'unknown'
            ? existing.result
            : null;

        return {
            cardId: card.id,
            result,
            updatedAt: Number(existing?.updatedAt || 0),
        };
    });

    return {
        currentIndex: clamp(Number(progress?.currentIndex ?? 0), 0, deck.cards.length - 1),
        flipped: progress?.flipped === true,
        knownCount: cardStates.filter((item) => item.result === 'known').length,
        unknownCount: cardStates.filter((item) => item.result === 'unknown').length,
        cardStates,
    };
}

function hasStructuredFlashcards(note) {
    return Boolean(note?.kind === 'flashcards' && note?.flashcardDeck && Array.isArray(note.flashcardDeck.cards) && note.flashcardDeck.cards.length > 0);
}

function buildFlashcardSummaryMarkdown(deck) {
    if (!deck || !Array.isArray(deck.cards) || deck.cards.length === 0) {
        return '';
    }

    return [
        `# ${deck.title || '闪卡集合'}`,
        '',
        ...deck.cards.map((card, index) => [
            `## 卡片 ${index + 1}`,
            `- 正面：${stripMarkdown(card.front) || card.front}`,
            `- 背面：${stripMarkdown(card.back) || card.back}`,
        ].join('\n')),
    ].join('\n\n');
}

function parseFlashcardDeckFromResponse(text, fallbackTitle, fallbackRefs = []) {
    const payload = extractStructuredJsonPayload(text);
    const candidateDeck = payload?.flashcardDeck && typeof payload.flashcardDeck === 'object'
        ? payload.flashcardDeck
        : payload;

    const normalizedDeck = normalizeFlashcardDeck(
        {
            title: candidateDeck?.title || fallbackTitle,
            cards: candidateDeck?.cards,
        },
        fallbackRefs
    );

    return normalizedDeck;
}

function clamp(value, min, max) {
    if (!Number.isFinite(value)) {
        return min;
    }
    return Math.min(Math.max(value, min), max);
}

function initMarked() {
    if (window.marked && typeof window.marked.Marked === 'function') {
        markedInstance = new window.marked.Marked({
            gfm: true,
            tables: true,
            breaks: true,
            pedantic: false,
            sanitize: false,
            smartLists: true,
            smartypants: false,
            highlight(code, lang) {
                if (window.hljs) {
                    const language = window.hljs.getLanguage(lang) ? lang : 'plaintext';
                    return window.hljs.highlight(code, { language }).value;
                }
                return code;
            },
        });
        return;
    }

    markedInstance = {
        parse(text) {
            return `<p>${String(text || '').replace(/\n/g, '<br>')}</p>`;
        },
    };
}

function getCurrentTopic() {
    return state.topics.find((topic) => topic.id === state.currentTopicId) || null;
}

function getCurrentTopicDisplayName() {
    return getCurrentTopic()?.name || '请选择一个话题';
}

function getCurrentAgentDisplayName() {
    return state.currentSelectedItem.name || '未选择学科';
}

function setSidePanelTab(tab) {
    state.sidePanelTab = 'notes';
    el.notesPanelTab?.classList.remove('hidden');
    el.notesPanelTab?.classList.add('side-panel-pane--active');
}

function setRightPanelMode(mode) {
    const nextMode = mode === 'flashcards' ? 'flashcards' : 'notes';

    state.rightPanelMode = nextMode;
    setSidePanelTab('notes');
    el.noteEditorCard?.classList.toggle('hidden', nextMode !== 'notes');
    el.flashcardsPracticeCard?.classList.toggle('hidden', nextMode !== 'flashcards');
}

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

function getCurrentDetailNote() {
    return getActiveFlashcardNote() || getActiveNote() || null;
}

function getNormalizedNoteKind(note) {
    if (hasStructuredFlashcards(note)) {
        return 'flashcards';
    }
    const kind = String(note?.kind || 'note');
    if (kind === 'analysis' || kind === 'quiz' || kind === 'flashcards') {
        return kind;
    }
    return 'note';
}

function buildNoteDetailSubtitle(note, fallback = '') {
    if (!note) {
        return fallback;
    }
    const sourceCount = getFlashcardSourceCount(note);
    const updatedLabel = formatRelativeTime(note.updatedAt) || '刚刚';
    const kindLabel = note.kind === 'analysis'
        ? '分析报告'
        : note.kind === 'quiz'
            ? '选择题'
            : note.kind === 'flashcards'
                ? '闪卡'
                : '笔记';
    return `${kindLabel} · ${sourceCount > 0 ? `${sourceCount} 个来源` : '当前话题'} · ${updatedLabel}`;
}

function syncNoteDetailChrome(note = null) {
    const kind = state.noteDetailKind || 'note';
    const meta = NOTE_DETAIL_META[kind] || NOTE_DETAIL_META.note;
    const flashcards = kind === 'flashcards';
    const editable = !flashcards;
    const noteTitle = flashcards
        ? (note?.flashcardDeck?.title || note?.title || '闪卡练习')
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
    el.deleteNoteBtn?.classList.toggle('hidden', !note?.id);
    el.noteEditorCard?.classList.toggle('hidden', !editable);
    el.flashcardsPracticeCard?.classList.toggle('hidden', !flashcards);
}

function openNoteDetail(note = null, options = {}) {
    const normalized = note ? normalizeNote(note) : null;
    const requestedKind = options.kind || getNormalizedNoteKind(normalized);
    if (options.trigger instanceof HTMLElement) {
        noteDetailTrigger = options.trigger;
    }

    state.notesStudioView = 'detail';
    state.noteDetailKind = requestedKind;
    el.noteDetailModal?.classList.remove('hidden');
    el.noteDetailModal?.classList.add('note-detail-modal--open');
    el.noteDetailModal?.setAttribute('aria-hidden', 'false');
    document.body.classList.add('note-detail-open');

    if (requestedKind === 'flashcards') {
        if (normalized?.id) {
            replaceNoteInCollections(normalized);
            state.activeNoteId = null;
            state.activeFlashcardNoteId = normalized.id;
        } else {
            state.activeFlashcardNoteId = null;
        }
        setRightPanelMode('flashcards');
        syncNoteDetailChrome(normalized);
        renderFlashcardsPractice();
    } else {
        state.activeFlashcardNoteId = null;
        setRightPanelMode('notes');
        if (normalized) {
            fillNoteEditor(normalized);
        } else {
            clearNoteEditor();
            if (el.noteTitleInput) {
                el.noteTitleInput.value = state.currentTopicId ? `${getCurrentTopicDisplayName()} 学习笔记` : '';
            }
            if (el.noteMetaSummary) {
                el.noteMetaSummary.textContent = '新建笔记将保存到当前话题，并自动归档到当前学科汇总。';
            }
        }
        syncNoteDetailChrome(normalized);
    }

    el.noteDetailCloseBtn?.focus();
    renderNotesPanel();
}

function closeNoteDetail(options = {}) {
    state.notesStudioView = 'overview';
    state.noteDetailKind = null;
    setRightPanelMode('notes');
    el.noteDetailModal?.classList.add('hidden');
    el.noteDetailModal?.classList.remove('note-detail-modal--open');
    el.noteDetailModal?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('note-detail-open');
    if (options.restoreFocus !== false && noteDetailTrigger instanceof HTMLElement && document.body.contains(noteDetailTrigger)) {
        noteDetailTrigger.focus();
    }
    noteDetailTrigger = null;
    closeNoteActionMenu();
}

function rememberSourceListScrollPosition() {
    if (el.topicKnowledgeBaseFiles) {
        state.sourceListScrollTop = el.topicKnowledgeBaseFiles.scrollTop;
    }
}

function restoreSourceListScrollPosition() {
    if (!el.topicKnowledgeBaseFiles) {
        return;
    }
    requestAnimationFrame(() => {
        if (el.topicKnowledgeBaseFiles) {
            el.topicKnowledgeBaseFiles.scrollTop = state.sourceListScrollTop || 0;
        }
    });
}

function setLeftReaderTab(tab) {
    const nextTab = tab === 'content' ? 'content' : 'guide';
    state.leftReaderActiveTab = nextTab;

    el.leftReaderGuideTabBtn?.classList.toggle('workspace-reader-tab--active', nextTab === 'guide');
    el.leftReaderContentTabBtn?.classList.toggle('workspace-reader-tab--active', nextTab === 'content');
    el.readerGuidePane?.classList.toggle('hidden', nextTab !== 'guide');
    el.readerGuidePane?.classList.toggle('workspace-reader-pane--active', nextTab === 'guide');
    el.readerContentPane?.classList.toggle('hidden', nextTab !== 'content');
    el.readerContentPane?.classList.toggle('workspace-reader-pane--active', nextTab === 'content');
    el.readerSelectionBar?.classList.toggle('hidden', nextTab !== 'content' || !state.reader.pendingSelection);
}

function setLeftSidebarMode(mode) {
    const nextMode = mode === 'reader' ? 'reader' : 'source-list';
    if (nextMode === 'reader') {
        rememberSourceListScrollPosition();
    }

    state.leftSidebarMode = nextMode;
    el.workspaceSidebar?.classList.toggle('workspace-sidebar--reader', nextMode === 'reader');
    el.workspaceTopicCard?.classList.toggle('hidden', nextMode !== 'source-list');
    el.sourceSidebarCard?.classList.toggle('hidden', nextMode !== 'source-list');
    el.workspaceReaderPanel?.classList.toggle('hidden', nextMode !== 'reader');
    el.workspaceVerticalResizeHandle?.classList.toggle('hidden', nextMode !== 'source-list');

    if (nextMode === 'source-list') {
        restoreSourceListScrollPosition();
    }
}

function syncWorkspaceContext() {
    const agentName = getCurrentAgentDisplayName();
    const topicName = getCurrentTopicDisplayName();

    if (el.titlebarCurrentAgent) {
        el.titlebarCurrentAgent.textContent = agentName;
    }
    if (el.titlebarCurrentTopic) {
        el.titlebarCurrentTopic.textContent = topicName;
    }
    if (el.workspaceCurrentAgent) {
        el.workspaceCurrentAgent.textContent = agentName;
    }
    if (el.workspaceCurrentTopic) {
        el.workspaceCurrentTopic.textContent = topicName;
    }
    if (el.currentChatTopicName) {
        el.currentChatTopicName.textContent = topicName;
    }
    if (el.currentChatAgentName) {
        el.currentChatAgentName.textContent = `当前学科：${agentName}`;
    }
}

function getCurrentTopicKnowledgeBaseId() {
    return getCurrentTopic()?.knowledgeBaseId || null;
}

function getKnowledgeBaseName(kbId) {
    if (!kbId) {
        return '准备中';
    }

    return state.knowledgeBases.find((item) => item.id === kbId)?.name || '准备中';
}

function isReaderSupportedDocument(documentItem) {
    const contentType = String(documentItem?.contentType || '').trim();
    if (['pdf-text', 'docx-text', 'plain', 'markdown', 'html'].includes(contentType)) {
        return true;
    }

    const mimeType = String(documentItem?.mimeType || '').trim().toLowerCase();
    if (mimeType.startsWith('text/')) {
        return true;
    }

    return mimeType === 'application/pdf'
        || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        || mimeType === 'application/xml';
}

function getReaderLocatorLabel(ref = {}) {
    if (ref.pageNumber !== null && ref.pageNumber !== undefined && Number.isFinite(Number(ref.pageNumber))) {
        return `第 ${Number(ref.pageNumber)} 页`;
    }
    if (ref.paragraphIndex !== null && ref.paragraphIndex !== undefined && Number.isFinite(Number(ref.paragraphIndex))) {
        return `第 ${Number(ref.paragraphIndex)} 段`;
    }
    if (ref.sectionTitle) {
        return String(ref.sectionTitle);
    }
    return '未定位';
}

function resetReaderState() {
    state.reader = {
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

function clearPendingSelectionContext() {
    state.pendingSelectionContextRefs = [];
    renderSelectionContextPreview();
}

function renderSelectionContextPreview() {
    if (!el.selectionContextPreview) {
        return;
    }

    const current = state.pendingSelectionContextRefs[0] || null;
    if (!current) {
        el.selectionContextPreview.innerHTML = '';
        el.selectionContextPreview.classList.add('hidden');
        return;
    }

    el.selectionContextPreview.classList.remove('hidden');
    el.selectionContextPreview.innerHTML = `
        <div>
            <strong>本轮已注入 1 段资料上下文</strong>
            <div>${escapeHtml(current.documentName || '未知文档')} · ${escapeHtml(getReaderLocatorLabel(current))}</div>
            <div>${escapeHtml(current.selectionText || current.snippet || '')}</div>
        </div>
        <button type="button" class="ghost-button icon-text-btn" data-selection-context-action="clear">
            <span class="material-symbols-outlined">close</span> 清空
        </button>
    `;

    el.selectionContextPreview.querySelector('[data-selection-context-action="clear"]')
        ?.addEventListener('click', () => clearPendingSelectionContext());
}

function renderReaderPanel() {
    if (!el.readerContent || !el.readerGuideContent) {
        return;
    }

    const reader = state.reader;
    const guideStatusLabels = {
        idle: '指南未生成',
        pending: '指南排队中',
        processing: '指南生成中',
        done: '指南已生成',
        failed: '指南生成失败',
    };

    if (el.readerDocumentTitle) {
        el.readerDocumentTitle.textContent = reader.documentName || '选择一份资料开始阅读';
    }
    if (el.readerDocumentMeta) {
        el.readerDocumentMeta.textContent = reader.documentId
            ? `${reader.contentType === 'pdf-text'
                ? 'PDF 分页阅读'
                : (reader.contentType === 'docx-text' ? 'DOCX 结构化阅读' : '文本阅读模式')}`
            : '支持 PDF、DOCX 与文本类资料，选中片段后可直接注入当前对话。';
    }
    if (el.readerLocationBadge) {
        el.readerLocationBadge.textContent = reader.documentId
            ? getReaderLocatorLabel({
                pageNumber: reader.activePageNumber,
                paragraphIndex: reader.activeParagraphIndex,
                sectionTitle: reader.activeSectionTitle,
            })
            : '未打开文档';
    }
    if (el.readerIndexStatusBadge) {
        el.readerIndexStatusBadge.textContent = reader.documentId
            ? (reader.isIndexed ? '已入库' : '未入库')
            : '尚未入库';
    }
    if (el.readerProcessingStatusBadge) {
        const statusLabels = {
            idle: '等待中',
            pending: '排队中',
            processing: '处理中',
            done: '已完成',
            failed: '失败',
        };
        el.readerProcessingStatusBadge.textContent = statusLabels[reader.status] || reader.status || '等待中';
    }
    if (el.readerGuideStatusBadge) {
        el.readerGuideStatusBadge.textContent = guideStatusLabels[reader.guideStatus] || reader.guideStatus || '指南未生成';
    }
    if (el.readerSelectionBar) {
        el.readerSelectionBar.classList.toggle('hidden', state.leftReaderActiveTab !== 'content' || !reader.pendingSelection);
    }
    if (el.readerSelectionSummary) {
        el.readerSelectionSummary.textContent = reader.pendingSelection
            ? `${getReaderLocatorLabel(reader.pendingSelection)} · ${String(reader.pendingSelection.selectionText || '').slice(0, 160)}`
            : '当前没有选中内容。';
    }
    if (el.readerPrevBtn) {
        el.readerPrevBtn.disabled = !reader.documentId;
    }
    if (el.readerNextBtn) {
        el.readerNextBtn.disabled = !reader.documentId;
    }
    if (el.injectReaderSelectionBtn) {
        el.injectReaderSelectionBtn.disabled = !reader.pendingSelection;
    }
    if (el.clearReaderSelectionBtn) {
        el.clearReaderSelectionBtn.disabled = !reader.pendingSelection;
    }
    if (el.refreshReaderGuideBtn) {
        el.refreshReaderGuideBtn.disabled = !reader.documentId || reader.guideStatus === 'processing';
    }

    setLeftReaderTab(state.leftReaderActiveTab);

    if (!reader.documentId) {
        el.readerGuideContent.innerHTML = `
            <div class="empty-list-state">
                <strong>来源指南会显示在这里</strong>
                <span>从左侧“学习来源”打开资料后，系统会先生成一份学习导向的阅读指南。</span>
            </div>
        `;
    } else if (reader.guideStatus === 'processing' || reader.guideStatus === 'pending') {
        el.readerGuideContent.innerHTML = `
            <div class="reader-guide-skeleton">
                <div class="reader-guide-skeleton__pill"></div>
                <div class="reader-guide-skeleton__line"></div>
                <div class="reader-guide-skeleton__line reader-guide-skeleton__line--wide"></div>
                <div class="reader-guide-skeleton__line"></div>
                <div class="reader-guide-skeleton__card"></div>
            </div>
        `;
    } else if (reader.guideStatus === 'failed') {
        el.readerGuideContent.innerHTML = `
            <div class="empty-list-state reader-guide-empty">
                <strong>来源指南生成失败</strong>
                <span>${escapeHtml(reader.guideError || '暂时无法生成来源指南。')}</span>
            </div>
        `;
    } else if (reader.guideMarkdown) {
        const sanitized = renderMarkdownToSafeHtml(
            reader.guideMarkdown,
            markedInstance || {
                parse(value) {
                    return `<pre>${escapeHtml(value)}</pre>`;
                },
            },
        );
        el.readerGuideContent.innerHTML = `
            <article class="reader-guide-card">
                ${sanitized}
            </article>
        `;
    } else {
        el.readerGuideContent.innerHTML = `
            <div class="empty-list-state reader-guide-empty">
                <strong>来源指南尚未生成</strong>
                <span>系统会在你首次打开资料时异步生成一份学习指南；你也可以手动刷新重新生成。</span>
            </div>
        `;
    }

    if (!reader.documentId || !reader.view) {
        el.readerContent.innerHTML = `
            <div class="empty-list-state">
                <strong>原文阅读区已就绪</strong>
                <span>从左侧“学习来源”打开 PDF、DOCX 或文本资料后，这里会显示可定位的原文内容。</span>
            </div>
        `;
        return;
    }

    if (reader.view.type === 'pdf') {
        const pages = Array.isArray(reader.view.pages) ? reader.view.pages : [];
        el.readerContent.className = 'reader-content reader-content--pdf';
        el.readerContent.innerHTML = pages.map((page) => `
            <article class="reader-page ${Number(page.pageNumber) === Number(reader.activePageNumber) ? 'reader-page--active' : ''}" data-reader-page="${page.pageNumber}">
                <header class="reader-page__header">
                    <strong class="reader-page__title">第 ${page.pageNumber} 页</strong>
                    <span>${Array.isArray(page.paragraphs) ? page.paragraphs.length : 0} 段</span>
                </header>
                <div class="reader-page__paragraphs">
                    ${(Array.isArray(page.paragraphs) ? page.paragraphs : []).map((paragraph) => `
                        <p class="reader-paragraph ${Number(paragraph.index) === Number(reader.activeParagraphIndex) ? 'reader-paragraph--active' : ''}" data-reader-page="${page.pageNumber}" data-reader-paragraph-index="${paragraph.index}">${escapeHtml(paragraph.text || '')}</p>
                    `).join('')}
                </div>
            </article>
        `).join('');
        return;
    }

    const paragraphs = Array.isArray(reader.view.paragraphs) ? reader.view.paragraphs : [];
    const grouped = [];
    let currentGroup = null;
    paragraphs.forEach((paragraph) => {
        const sectionTitle = paragraph.sectionTitle || '正文';
        if (!currentGroup || currentGroup.sectionTitle !== sectionTitle) {
            currentGroup = {
                key: `${grouped.length}_${sectionTitle}`,
                sectionTitle,
                paragraphs: [],
            };
            grouped.push(currentGroup);
        }
        currentGroup.paragraphs.push(paragraph);
    });

    el.readerContent.className = 'reader-content reader-content--docx';
    el.readerContent.innerHTML = grouped.map((group) => `
        <article class="reader-docx-block ${group.paragraphs.some((paragraph) => Number(paragraph.index) === Number(reader.activeParagraphIndex)) ? 'reader-docx-block--active' : ''}" data-reader-section-title="${escapeHtml(group.sectionTitle)}">
            <header class="reader-docx-block__header">
                <strong class="reader-docx-block__title">${escapeHtml(group.sectionTitle)}</strong>
                <span>${group.paragraphs.length} 段</span>
            </header>
            <div class="reader-docx-block__body">
                ${group.paragraphs.map((paragraph) => `
                    <p class="reader-paragraph ${Number(paragraph.index) === Number(reader.activeParagraphIndex) ? 'reader-paragraph--active' : ''}" data-reader-paragraph-index="${paragraph.index}" data-reader-section-title="${escapeHtml(group.sectionTitle)}">${escapeHtml(paragraph.text || '')}</p>
                `).join('')}
            </div>
        </article>
    `).join('');
}

function syncReaderSelectionFromDom() {
    if (!el.readerContent) {
        return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        state.reader.pendingSelection = null;
        renderReaderPanel();
        return;
    }

    const range = selection.getRangeAt(0);
    const anchorNode = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
        ? range.commonAncestorContainer.parentElement
        : range.commonAncestorContainer;

    const target = anchorNode?.closest?.('[data-reader-page], [data-reader-paragraph-index]');
    if (!target || !el.readerContent.contains(target)) {
        state.reader.pendingSelection = null;
        renderReaderPanel();
        return;
    }

    const selectionText = String(selection.toString() || '').replace(/\s+/g, ' ').trim();
    if (!selectionText) {
        state.reader.pendingSelection = null;
        renderReaderPanel();
        return;
    }

    state.reader.pendingSelection = {
        documentId: state.reader.documentId,
        documentName: state.reader.documentName,
        contentType: state.reader.contentType,
        selectionText,
        snippet: selectionText.slice(0, 180),
        pageNumber: Number(target.dataset.readerPage || target.closest('[data-reader-page]')?.dataset.readerPage || 0) || null,
        paragraphIndex: Number(target.dataset.readerParagraphIndex || 0) || null,
        sectionTitle: target.dataset.readerSectionTitle || target.closest('[data-reader-section-title]')?.dataset.readerSectionTitle || null,
    };
    renderReaderPanel();
}

function scrollReaderToLocator(locator = {}) {
    if (!el.readerContent) {
        return;
    }

    const pageNumber = Number(locator.pageNumber || 0) || null;
    const paragraphIndex = Number(locator.paragraphIndex || 0) || null;
    if (paragraphIndex) {
        state.reader.activeParagraphIndex = paragraphIndex;
    }
    if (pageNumber) {
        state.reader.activePageNumber = pageNumber;
    }
    if (locator.sectionTitle) {
        state.reader.activeSectionTitle = locator.sectionTitle || null;
    }

    renderReaderPanel();

    let target = null;
    if (paragraphIndex) {
        target = el.readerContent.querySelector(`[data-reader-paragraph-index="${paragraphIndex}"]`);
    }
    if (!target && pageNumber) {
        target = el.readerContent.querySelector(`[data-reader-page="${pageNumber}"]`);
    }
    if (!target && locator.sectionTitle) {
        const allSectionNodes = Array.from(el.readerContent.querySelectorAll('[data-reader-section-title]'));
        target = allSectionNodes.find((node) => node.dataset.readerSectionTitle === locator.sectionTitle) || null;
    }

    if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

function syncReaderGuideFromDocument(documentItem = {}) {
    if (!documentItem || documentItem.id !== state.reader.documentId) {
        return;
    }

    state.reader.guideStatus = documentItem.guideStatus || state.reader.guideStatus || 'idle';
    state.reader.guideMarkdown = documentItem.guideMarkdown || '';
    state.reader.guideGeneratedAt = documentItem.guideGeneratedAt || null;
    state.reader.guideError = documentItem.guideError || null;
}

function patchDocumentGuideState(documentId, patch = {}) {
    const applyPatch = (items = []) => items.map((item) => (
        item.id === documentId
            ? { ...item, ...patch }
            : item
    ));

    state.knowledgeBaseDocuments = applyPatch(state.knowledgeBaseDocuments);
    state.topicKnowledgeBaseDocuments = applyPatch(state.topicKnowledgeBaseDocuments);
}

async function ensureReaderGuide(documentId, options = {}) {
    if (!documentId) {
        return null;
    }

    const current = await chatAPI.getKnowledgeBaseDocumentGuide(documentId).catch((error) => ({
        success: false,
        error: error.message,
    }));

    if (current?.success) {
        patchDocumentGuideState(documentId, {
            guideStatus: current.guideStatus || 'idle',
            guideMarkdown: current.guideMarkdown || '',
            guideGeneratedAt: current.guideGeneratedAt || null,
            guideError: current.guideError || null,
        });
        state.reader.guideStatus = current.guideStatus || 'idle';
        state.reader.guideMarkdown = current.guideMarkdown || '';
        state.reader.guideGeneratedAt = current.guideGeneratedAt || null;
        state.reader.guideError = current.guideError || null;
        renderReaderPanel();
    }

    const shouldGenerate = options.forceRefresh === true
        || !current?.success
        || (!current.guideMarkdown && !['processing', 'pending'].includes(current.guideStatus));

    if (!shouldGenerate) {
        return current;
    }

    const result = await chatAPI.generateKnowledgeBaseDocumentGuide(documentId, {
        forceRefresh: options.forceRefresh === true,
    }).catch((error) => ({
        success: false,
        error: error.message,
    }));

    if (result?.success) {
        patchDocumentGuideState(documentId, {
            guideStatus: result.guideStatus || 'processing',
            guideMarkdown: result.guideMarkdown || '',
            guideGeneratedAt: result.guideGeneratedAt || null,
            guideError: result.guideError || null,
        });
    }

    if (result?.success && state.reader.documentId === documentId) {
        state.reader.guideStatus = result.guideStatus || 'processing';
        state.reader.guideMarkdown = result.guideMarkdown || '';
        state.reader.guideGeneratedAt = result.guideGeneratedAt || null;
        state.reader.guideError = result.guideError || null;
        renderReaderPanel();
    } else if (!result?.success && state.reader.documentId === documentId) {
        patchDocumentGuideState(documentId, {
            guideStatus: 'failed',
            guideError: result?.error || '来源指南生成失败。',
        });
        state.reader.guideStatus = 'failed';
        state.reader.guideError = result?.error || '来源指南生成失败。';
        renderReaderPanel();
    }

    renderTopicKnowledgeBaseFiles();
    syncKnowledgeBasePolling();
    return result;
}

async function openReaderDocument(documentId, locator = {}) {
    hideSourceFileTooltip();
    if (!documentId) {
        resetReaderState();
        setLeftSidebarMode('source-list');
        setLeftReaderTab('guide');
        renderReaderPanel();
        renderTopicKnowledgeBaseFiles();
        return;
    }

    const result = await chatAPI.getKnowledgeBaseDocumentViewData(documentId);
    if (!result?.success) {
        ui.showToastNotification(`打开阅读区失败：${result?.error || '未知错误'}`, 'error');
        return;
    }

    const view = result.view || {};
    const documentItem = result.document || {};
    state.reader = {
        documentId,
        documentName: documentItem.name || '未命名文档',
        contentType: documentItem.contentType || view.contentType || null,
        status: documentItem.status || 'done',
        isIndexed: documentItem.isIndexed === true,
        view,
        activePageNumber: Number(locator.pageNumber || view.pages?.[0]?.pageNumber || 0) || null,
        activeParagraphIndex: Number(locator.paragraphIndex || view.paragraphs?.[0]?.index || view.pages?.[0]?.paragraphs?.[0]?.index || 0) || null,
        activeSectionTitle: locator.sectionTitle || view.paragraphs?.[0]?.sectionTitle || null,
        pendingSelection: null,
        guideStatus: documentItem.guideStatus || 'idle',
        guideMarkdown: documentItem.guideMarkdown || '',
        guideGeneratedAt: documentItem.guideGeneratedAt || null,
        guideError: documentItem.guideError || null,
    };

    setLeftSidebarMode('reader');
    setLeftReaderTab(locator.preferTab === 'content' || locator.pageNumber || locator.paragraphIndex || locator.sectionTitle ? 'content' : 'guide');
    renderReaderPanel();
    renderTopicKnowledgeBaseFiles();
    requestAnimationFrame(() => {
        scrollReaderToLocator(locator);
    });
    void ensureReaderGuide(documentId);
}

async function openReaderFromRef(ref = {}) {
    if (!ref?.documentId) {
        return;
    }
    await openReaderDocument(ref.documentId, {
        ...ref,
        preferTab: 'content',
    });
}

function injectReaderSelectionIntoComposer() {
    const selection = state.reader.pendingSelection;
    if (!selection) {
        return;
    }

    state.pendingSelectionContextRefs = [{
        ...selection,
        sourceType: 'reader-selection',
    }];
    renderSelectionContextPreview();
    ui.showToastNotification('已将当前选段注入本轮对话上下文。', 'success');
}

function navigateReader(step) {
    const reader = state.reader;
    if (!reader.documentId || !reader.view) {
        return;
    }

    if (reader.view.type === 'pdf') {
        const pages = Array.isArray(reader.view.pages) ? reader.view.pages : [];
        const currentIndex = Math.max(0, pages.findIndex((page) => Number(page.pageNumber) === Number(reader.activePageNumber)));
        const nextPage = pages[Math.min(Math.max(currentIndex + step, 0), Math.max(pages.length - 1, 0))];
        if (nextPage) {
            state.reader.activePageNumber = nextPage.pageNumber;
            state.reader.activeParagraphIndex = nextPage.paragraphs?.[0]?.index || state.reader.activeParagraphIndex;
            scrollReaderToLocator({ pageNumber: nextPage.pageNumber });
        }
        return;
    }

    const paragraphs = Array.isArray(reader.view.paragraphs) ? reader.view.paragraphs : [];
    const currentIndex = Math.max(0, paragraphs.findIndex((paragraph) => Number(paragraph.index) === Number(reader.activeParagraphIndex)));
    const nextParagraph = paragraphs[Math.min(Math.max(currentIndex + step, 0), Math.max(paragraphs.length - 1, 0))];
    if (nextParagraph) {
        state.reader.activeParagraphIndex = nextParagraph.index;
        state.reader.activeSectionTitle = nextParagraph.sectionTitle || null;
        scrollReaderToLocator({ paragraphIndex: nextParagraph.index, sectionTitle: nextParagraph.sectionTitle || null });
    }
}

function normalizeTopic(topic = {}) {
    return {
        ...topic,
        knowledgeBaseId: topic.knowledgeBaseId || null,
    };
}

function buildTopicSourceName(topic = getCurrentTopic()) {
    const topicLabel = String(topic?.name || topic?.id || '未命名话题').trim();
    const agentLabel = String(getCurrentAgentDisplayName() || '当前学科').trim();
    return `${agentLabel} · ${topicLabel}`;
}

async function ensureTopicSource(options = {}) {
    if (!state.currentSelectedItem.id || !state.currentTopicId) {
        return null;
    }

    const currentTopic = getCurrentTopic();
    if (!currentTopic) {
        return null;
    }

    if (currentTopic.knowledgeBaseId) {
        return currentTopic.knowledgeBaseId;
    }

    const createResult = await chatAPI.createKnowledgeBase({
        name: buildTopicSourceName(currentTopic),
    }).catch((error) => ({
        success: false,
        error: error.message,
    }));

    if (!createResult?.success || !createResult.item?.id) {
        if (options.silent !== true) {
            ui.showToastNotification(`创建当前话题 Source 失败：${createResult?.error || '未知错误'}`, 'error');
        }
        return null;
    }

    const nextKbId = createResult.item.id;
    const bindResult = await chatAPI.setTopicKnowledgeBase(
        state.currentSelectedItem.id,
        state.currentTopicId,
        nextKbId
    ).catch((error) => ({
        success: false,
        error: error.message,
    }));

    if (!bindResult?.success) {
        if (options.silent !== true) {
            ui.showToastNotification(`准备当前话题 Source 失败：${bindResult?.error || '未知错误'}`, 'error');
        }
        return null;
    }

    state.topics = state.topics.map((topic) => (
        topic.id === state.currentTopicId
            ? { ...topic, knowledgeBaseId: nextKbId }
            : topic
    ));
    state.selectedKnowledgeBaseId = nextKbId;
    await loadKnowledgeBases({ silent: true });
    syncCurrentTopicKnowledgeBaseControls();

    if (options.silent !== true) {
        ui.showToastNotification('已为当前话题自动准备独立 Source。', 'success');
    }

    return nextKbId;
}

async function refreshKnowledgeBaseSummaries(options = {}) {
    const result = await chatAPI.listKnowledgeBases().catch((error) => ({
        success: false,
        error: error.message,
        items: [],
    }));

    if (!result?.success) {
        if (options.silent !== true) {
            ui.showToastNotification(`加载 Source 失败：${result?.error || '未知错误'}`, 'error');
        }
        state.knowledgeBases = [];
        state.knowledgeBaseDocuments = [];
        state.topicKnowledgeBaseDocuments = [];
        state.knowledgeBaseDebugResult = null;
        state.selectedKnowledgeBaseId = null;
        renderKnowledgeBaseManager();
        renderTopicKnowledgeBaseFiles();
        syncCurrentTopicKnowledgeBaseControls();
        return false;
    }

    state.knowledgeBases = Array.isArray(result.items) ? result.items : [];

    if (!state.knowledgeBases.some((item) => item.id === state.selectedKnowledgeBaseId)) {
        state.knowledgeBaseDebugResult = null;
        state.selectedKnowledgeBaseId = state.knowledgeBases[0]?.id || null;
    }

    return true;
}

async function loadKnowledgeBases(options = {}) {
    const loaded = await refreshKnowledgeBaseSummaries(options);
    if (!loaded) {
        return;
    }

    await loadKnowledgeBaseDocuments(state.selectedKnowledgeBaseId, { silent: true });
    await loadCurrentTopicKnowledgeBaseDocuments({ silent: true });
    renderKnowledgeBaseManager();
    renderTopicKnowledgeBaseFiles();
    syncCurrentTopicKnowledgeBaseControls();
    renderTopics();
}

async function refreshKnowledgeBasePollingTargets() {
    const loaded = await refreshKnowledgeBaseSummaries({ silent: true });
    if (!loaded) {
        return;
    }

    const selectedKbId = state.selectedKnowledgeBaseId || null;
    const topicKbId = getCurrentTopicKnowledgeBaseId();

    if (selectedKbId && selectedKbId === topicKbId) {
        const documents = await loadKnowledgeBaseDocuments(selectedKbId, { silent: true });
        state.topicKnowledgeBaseDocuments = Array.isArray(documents) ? [...documents] : [];
        renderTopicKnowledgeBaseFiles();
    } else {
        await Promise.all([
            loadKnowledgeBaseDocuments(selectedKbId, { silent: true }),
            loadCurrentTopicKnowledgeBaseDocuments({ silent: true }),
        ]);
    }

    renderKnowledgeBaseManager();
    renderTopicKnowledgeBaseFiles();
    syncCurrentTopicKnowledgeBaseControls();
    renderTopics();
}

async function loadKnowledgeBaseDocuments(kbId, options = {}) {
    const isTopicTarget = options.target === 'topic';
    const target = isTopicTarget ? 'topicKnowledgeBaseDocuments' : 'knowledgeBaseDocuments';

    if (!kbId) {
        state[target] = [];
        if (isTopicTarget) {
            renderTopicKnowledgeBaseFiles();
        } else {
            renderKnowledgeBaseManager();
        }
        return [];
    }

    const result = await chatAPI.listKnowledgeBaseDocuments(kbId).catch((error) => ({
        success: false,
        error: error.message,
        items: [],
    }));

    if (!result?.success) {
        state[target] = [];
        if (options.silent !== true) {
            ui.showToastNotification(`加载 Source 文档失败：${result?.error || '未知错误'}`, 'error');
        }
        if (isTopicTarget) {
            renderTopicKnowledgeBaseFiles();
        } else {
            renderKnowledgeBaseManager();
        }
        return [];
    }

    state[target] = Array.isArray(result.items) ? result.items : [];
    const activeReaderDoc = state[target].find((item) => item.id === state.reader.documentId) || null;
    if (activeReaderDoc) {
        state.reader.status = activeReaderDoc.status || state.reader.status;
        state.reader.isIndexed = activeReaderDoc.status === 'done';
        state.reader.contentType = activeReaderDoc.contentType || state.reader.contentType;
        syncReaderGuideFromDocument(activeReaderDoc);
        renderReaderPanel();
    } else if (isTopicTarget && state.reader.documentId) {
        resetReaderState();
        setLeftSidebarMode('source-list');
        setLeftReaderTab('guide');
        renderReaderPanel();
    }
    if (isTopicTarget) {
        renderTopicKnowledgeBaseFiles();
    } else {
        renderKnowledgeBaseManager();
    }
    return state[target];
}

async function loadCurrentTopicKnowledgeBaseDocuments(options = {}) {
    const kbId = getCurrentTopicKnowledgeBaseId();
    if (!kbId) {
        state.topicKnowledgeBaseDocuments = [];
        renderTopicKnowledgeBaseFiles();
        return [];
    }

    if (kbId === state.selectedKnowledgeBaseId && options.reuseSelected !== false) {
        state.topicKnowledgeBaseDocuments = [...state.knowledgeBaseDocuments];
        renderTopicKnowledgeBaseFiles();
        return state.topicKnowledgeBaseDocuments;
    }

    return loadKnowledgeBaseDocuments(kbId, { ...options, target: 'topic' });
}

async function focusTopicKnowledgeBaseBinding() {
    if (!state.currentSelectedItem.id || !state.currentTopicId) {
        ui.showToastNotification('请先选择一个智能体和话题。', 'warning');
        return;
    }

    const kbId = await ensureTopicSource();
    if (kbId) {
        await loadCurrentTopicKnowledgeBaseDocuments({ silent: true, reuseSelected: false });
        setRightPanelMode('notes');
    }
}

async function openKnowledgeBaseManager() {
    const currentKbId = getCurrentTopicKnowledgeBaseId() || await ensureTopicSource({ silent: true });
    if (currentKbId) {
        state.selectedKnowledgeBaseId = currentKbId;
        await loadKnowledgeBaseDocuments(currentKbId, { silent: true });
    } else if (state.selectedKnowledgeBaseId) {
        await loadKnowledgeBaseDocuments(state.selectedKnowledgeBaseId, { silent: true });
    }

    renderKnowledgeBaseManager();
    openSettingsModal('knowledge-base', el.openKnowledgeBaseManagerBtn);
}

async function importKnowledgeBaseFilesForKb(kbId, files, options = {}) {
    const fileEntries = Array.from(files || []);
    if (!kbId || fileEntries.length === 0) {
        return;
    }

    const payloads = (await Promise.all(fileEntries.map(async (file) => ({
        name: file.name,
        path: await getNativePathForFile(file),
        type: file.type,
        size: file.size,
    })))).filter((item) => item.path);

    if (payloads.length === 0) {
        ui.showToastNotification('当前文件未能解析到本地路径，无法导入 Source 文档。请重新选择文件后再试。', 'warning');
        return;
    }

    if (kbId === getCurrentTopicKnowledgeBaseId()) {
        const currentCount = state.topicKnowledgeBaseDocuments.length;
        if (currentCount >= TOPIC_SOURCE_FILE_LIMIT) {
            ui.showToastNotification(`当前话题最多绑定 ${TOPIC_SOURCE_FILE_LIMIT} 个资料文件。`, 'warning');
            return;
        }

        if (currentCount + payloads.length > TOPIC_SOURCE_FILE_LIMIT) {
            payloads.splice(TOPIC_SOURCE_FILE_LIMIT - currentCount);
            ui.showToastNotification(`当前话题资料上限为 ${TOPIC_SOURCE_FILE_LIMIT} 个，已自动截断本次上传。`, 'warning', 4000);
        }
    }

    const result = await chatAPI.importKnowledgeBaseFiles(kbId, payloads);
    if (!result?.success) {
        ui.showToastNotification(`导入 Source 文件失败：${result?.error || '未知错误'}`, 'error');
        return;
    }

    if (kbId === state.selectedKnowledgeBaseId) {
        await loadKnowledgeBaseDocuments(kbId, { silent: true });
    }

    if (kbId === getCurrentTopicKnowledgeBaseId()) {
        await loadCurrentTopicKnowledgeBaseDocuments({ silent: true, reuseSelected: false });
    }

    await loadKnowledgeBases({ silent: true });

    if (options.toastSuccess !== false) {
        ui.showToastNotification(`已开始导入 ${payloads.length} 个资料文件。`, 'success');
    }
}

function renderTopicKnowledgeBaseFiles() {
    if (!el.topicKnowledgeBaseFiles) {
        return;
    }

    const hasTopic = Boolean(state.currentSelectedItem.id && state.currentTopicId);
    const kbId = getCurrentTopicKnowledgeBaseId();

    if (!hasTopic) {
        el.topicKnowledgeBaseFiles.innerHTML = '';
        syncKnowledgeBasePolling();
        return;
    }

    el.topicKnowledgeBaseFiles.innerHTML = '';
    if (el.importTopicKnowledgeBaseFilesBtn) {
        el.importTopicKnowledgeBaseFilesBtn.classList.add('workspace-card__cta--list-item');
        el.topicKnowledgeBaseFiles.appendChild(el.importTopicKnowledgeBaseFilesBtn);
    }

    if (!kbId) {
        syncKnowledgeBasePolling();
        return;
    }

    if (state.topicKnowledgeBaseDocuments.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'empty-list-state empty-list-state--compact';
        emptyState.innerHTML = `
                <span style="font-size: 12px; color: var(--muted); text-align: center;">暂无资料文件，点击上方按钮添加。</span>
        `;
        el.topicKnowledgeBaseFiles.appendChild(emptyState);
        syncKnowledgeBasePolling();
        return;
    }

    state.topicKnowledgeBaseDocuments.forEach((documentItem) => {
        const row = renderKnowledgeBaseDocumentRow(documentItem);
        el.topicKnowledgeBaseFiles.appendChild(row);
    });

    if (state.activeSourceFileMenu && !state.topicKnowledgeBaseDocuments.some((item) => item.id === state.activeSourceFileMenu.documentId)) {
        closeSourceFileActionMenu();
    }

    syncKnowledgeBasePolling();
}

function syncCurrentTopicKnowledgeBaseControls() {
    const hasTopic = Boolean(state.currentSelectedItem.id && state.currentTopicId);
    const currentTopic = getCurrentTopic();
    const currentKbId = currentTopic?.knowledgeBaseId || '';

    if (el.currentTopicKnowledgeBaseStatus) {
        el.currentTopicKnowledgeBaseStatus.textContent = hasTopic
            ? (currentKbId ? `当前 Source：${getKnowledgeBaseName(currentKbId)}` : '当前 Source 正在自动准备')
            : '选择话题后会自动准备独立 Source';
    }

    if (el.sourcePanelBindingStatus) {
        el.sourcePanelBindingStatus.textContent = hasTopic
            ? (currentKbId ? `当前 Source：${getKnowledgeBaseName(currentKbId)}` : '当前话题 Source 准备中')
            : '选择话题后会自动切换到它自己的 Source';
    }

    renderTopicKnowledgeBaseFiles();
}

function syncKnowledgeBasePolling() {
    const shouldPoll = [...state.knowledgeBaseDocuments, ...state.topicKnowledgeBaseDocuments]
        .some((item) => (
            item.status === 'pending'
            || item.status === 'processing'
            || item.guideStatus === 'pending'
            || item.guideStatus === 'processing'
        ));
    if (shouldPoll && !knowledgeBasePollTimer) {
        knowledgeBasePollTimer = setInterval(async () => {
            if (knowledgeBasePollInFlight) {
                return;
            }

            knowledgeBasePollInFlight = true;
            try {
                await refreshKnowledgeBasePollingTargets();
            } finally {
                knowledgeBasePollInFlight = false;
            }
        }, 2000);
        return;
    }

    if (!shouldPoll && knowledgeBasePollTimer) {
        clearInterval(knowledgeBasePollTimer);
        knowledgeBasePollTimer = null;
        knowledgeBasePollInFlight = false;
    }
}

function formatDocumentStatus(documentItem) {
    const statusLabels = {
        pending: '排队中',
        processing: '处理中',
        paused: '已暂停',
        done: '已完成',
        failed: '失败',
    };
    const contentTypeLabels = {
        plain: 'plain',
        markdown: 'markdown',
        html: 'html',
        'pdf-text': 'pdf-text',
        'docx-text': 'docx-text',
    };

    const detailParts = [`${statusLabels[documentItem.status] || documentItem.status}`];
    detailParts.push(`${documentItem.chunkCount || 0} chunks`);

    if (documentItem.contentType) {
        detailParts.push(contentTypeLabels[documentItem.contentType] || documentItem.contentType);
    }

    if (documentItem.attemptCount) {
        detailParts.push(`尝试 ${documentItem.attemptCount}`);
    }

    return detailParts.join(' · ');
}

function getKnowledgeBaseDocumentVisual(documentItem = {}) {
    const name = String(documentItem.name || '').toLowerCase();
    const contentType = String(documentItem.contentType || '').toLowerCase();
    const mimeType = String(documentItem.mimeType || '').toLowerCase();

    if (contentType === 'pdf-text' || mimeType === 'application/pdf' || name.endsWith('.pdf')) {
        return {
            icon: 'picture_as_pdf',
            tone: 'pdf',
        };
    }

    if (
        contentType === 'docx-text'
        || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        || name.endsWith('.docx')
        || name.endsWith('.doc')
    ) {
        return {
            icon: 'description',
            tone: 'doc',
        };
    }

    if (contentType === 'markdown' || name.endsWith('.md')) {
        return {
            icon: 'article',
            tone: 'text',
        };
    }

    if (
        contentType === 'plain'
        || contentType === 'html'
        || mimeType.startsWith('text/')
        || name.endsWith('.txt')
        || name.endsWith('.html')
        || name.endsWith('.htm')
    ) {
        return {
            icon: 'article',
            tone: 'text',
        };
    }

    return {
        icon: 'draft',
        tone: 'neutral',
    };
}

function formatRelativeTime(timestamp) {
    if (!timestamp) {
        return '';
    }

    try {
        return new Date(timestamp).toLocaleString();
    } catch (_error) {
        return '';
    }
}

function formatMessageTimestamp(timestamp) {
    if (!timestamp) {
        return '';
    }

    try {
        const date = new Date(timestamp);
        if (Number.isNaN(date.getTime())) {
            return '';
        }

        return date.toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).replace(/\//g, '-');
    } catch (_error) {
        return '';
    }
}

function getSourceFileActions(documentItem) {
    const readable = isReaderSupportedDocument(documentItem) && documentItem.status === 'done';
    const actions = [];

    if (readable) {
        actions.push({
            key: 'open',
            label: '打开阅读区',
            icon: 'menu_book',
            disabled: false,
        });
    }

    if (documentItem.status === 'failed') {
        actions.push({
            key: 'retry',
            label: '重试导入',
            icon: 'refresh',
            disabled: false,
        });
    }

    if (actions.length === 0) {
        actions.push({
            key: 'empty',
            label: '暂无可用操作',
            icon: 'hourglass_top',
            disabled: true,
        });
    }

    return actions;
}

function hideSourceFileTooltip() {
    if (!el.sourceFileTooltip) {
        return;
    }
    el.sourceFileTooltip.classList.add('hidden');
    el.sourceFileTooltip.innerHTML = '';
    el.sourceFileTooltip.style.left = '0px';
    el.sourceFileTooltip.style.top = '0px';
    el.sourceFileTooltip.style.visibility = '';
}

function positionFloatingElement(element, rect, preferred = 'right') {
    if (!element || !rect) {
        return;
    }

    const viewportPadding = 12;
    const gap = 10;
    const { innerWidth, innerHeight } = window;
    const elementWidth = element.offsetWidth || 0;
    const elementHeight = element.offsetHeight || 0;

    let left = preferred === 'left'
        ? rect.left - elementWidth - gap
        : rect.right + gap;
    let top = rect.top;

    if (preferred === 'right' && left + elementWidth > innerWidth - viewportPadding) {
        left = Math.max(viewportPadding, rect.left - elementWidth - gap);
        top = Math.max(viewportPadding, rect.top - 4);
    } else if (preferred === 'left' && left < viewportPadding) {
        left = Math.min(innerWidth - elementWidth - viewportPadding, rect.right + gap);
    }

    if (top + elementHeight > innerHeight - viewportPadding) {
        top = Math.max(viewportPadding, rect.bottom - elementHeight);
    }

    top = Math.max(viewportPadding, Math.min(top, innerHeight - elementHeight - viewportPadding));
    left = Math.max(viewportPadding, Math.min(left, innerWidth - elementWidth - viewportPadding));

    element.style.left = `${Math.round(left)}px`;
    element.style.top = `${Math.round(top)}px`;
}

function showSourceFileTooltip(documentItem, anchorElement) {
    if (!el.sourceFileTooltip || !anchorElement) {
        return;
    }

    const meta = [];
    meta.push(formatDocumentStatus(documentItem));
    meta.push(`时间：${formatRelativeTime(documentItem.updatedAt || documentItem.createdAt) || '未知'}`);

    el.sourceFileTooltip.innerHTML = `
        <div class="source-file-tooltip__meta">
            ${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}
        </div>
    `;
    el.sourceFileTooltip.classList.remove('hidden');
    el.sourceFileTooltip.style.visibility = 'hidden';
    const rect = anchorElement.getBoundingClientRect();
    const viewportPadding = 12;
    const gap = 10;
    const width = el.sourceFileTooltip.offsetWidth || 280;
    const height = el.sourceFileTooltip.offsetHeight || 120;
    let left = rect.right + gap;
    let top = rect.top;

    if (left + width > window.innerWidth - viewportPadding) {
        left = Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - width - viewportPadding));
        top = Math.max(viewportPadding, rect.top - height - gap);
    }

    if (top + height > window.innerHeight - viewportPadding) {
        top = Math.max(viewportPadding, window.innerHeight - height - viewportPadding);
    }

    el.sourceFileTooltip.style.left = `${Math.round(left)}px`;
    el.sourceFileTooltip.style.top = `${Math.round(top)}px`;
    el.sourceFileTooltip.style.visibility = 'visible';
}

function closeSourceFileActionMenu() {
    state.activeSourceFileMenu = null;
    if (!el.sourceFileActionMenu) {
        return;
    }
    el.sourceFileActionMenu.classList.add('hidden');
    el.sourceFileActionMenu.innerHTML = '';
    el.sourceFileActionMenu.style.left = '0px';
    el.sourceFileActionMenu.style.top = '0px';
    el.sourceFileActionMenu.style.visibility = '';
}

function closeTopicActionMenu() {
    state.activeTopicMenu = null;
    if (!el.topicActionMenu) {
        return;
    }
    el.topicActionMenu.classList.add('hidden');
    el.topicActionMenu.innerHTML = '';
    el.topicActionMenu.style.left = '0px';
    el.topicActionMenu.style.top = '0px';
    el.topicActionMenu.style.visibility = '';
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
    positionFloatingElement(el.noteActionMenu, state.activeNoteMenu.anchorRect, 'left');
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

function renderTopicActionMenu() {
    if (!el.topicActionMenu || !state.activeTopicMenu?.topic || !state.activeTopicMenu?.anchorRect) {
        closeTopicActionMenu();
        return;
    }

    const topic = state.activeTopicMenu.topic;
    const actions = [
        { key: 'rename', label: '重命名', icon: 'edit' },
        { key: 'toggle-unread', label: topic.unread ? '标为已读' : '标为未读', icon: topic.unread ? 'drafts' : 'mark_chat_unread' },
        { key: 'toggle-lock', label: topic.locked === false ? '锁定' : '解锁', icon: topic.locked === false ? 'lock_open' : 'lock' },
        { key: 'delete', label: '删除', icon: 'delete', danger: true },
    ];

    el.topicActionMenu.innerHTML = actions.map((action) => `
        <button
            type="button"
            class="topic-action-menu__item ${action.danger ? 'topic-action-menu__item--danger' : ''}"
            data-topic-action="${escapeHtml(action.key)}"
        >
            <span class="material-symbols-outlined">${escapeHtml(action.icon)}</span>
            <span>${escapeHtml(action.label)}</span>
        </button>
    `).join('');

    el.topicActionMenu.classList.remove('hidden');
    el.topicActionMenu.style.visibility = 'hidden';
    positionFloatingElement(el.topicActionMenu, state.activeTopicMenu.anchorRect, 'left');
    el.topicActionMenu.style.visibility = 'visible';

    el.topicActionMenu.querySelectorAll('[data-topic-action]').forEach((button) => {
        button.addEventListener('click', async (event) => {
            event.stopPropagation();
            const action = button.dataset.topicAction;
            if (action === 'rename') {
                await renameTopic(topic);
            } else if (action === 'toggle-unread') {
                await setTopicUnreadState(topic, !topic.unread);
            } else if (action === 'toggle-lock') {
                await toggleTopicLockState(topic);
            } else if (action === 'delete') {
                await deleteTopicFromList(topic);
            }
            closeTopicActionMenu();
        });
    });
}

function toggleTopicActionMenu(topic, anchorElement) {
    if (!topic || !anchorElement) {
        return;
    }

    if (state.activeTopicMenu?.topicId === topic.id) {
        closeTopicActionMenu();
        return;
    }

    closeSourceFileActionMenu();
    hideSourceFileTooltip();
    state.activeTopicMenu = {
        topicId: topic.id,
        topic,
        anchorRect: anchorElement.getBoundingClientRect(),
    };
    renderTopicActionMenu();
}

function renderSourceFileActionMenu() {
    if (!el.sourceFileActionMenu) {
        return;
    }

    const activeMenu = state.activeSourceFileMenu;
    if (!activeMenu?.documentItem || !activeMenu?.anchorRect) {
        closeSourceFileActionMenu();
        return;
    }

    const actions = getSourceFileActions(activeMenu.documentItem);
    el.sourceFileActionMenu.innerHTML = actions.map((action) => `
        <button
            type="button"
            class="source-file-action-menu__item"
            data-source-file-action="${escapeHtml(action.key)}"
            ${action.disabled ? 'disabled' : ''}
        >
            <span class="material-symbols-outlined">${escapeHtml(action.icon)}</span>
            <span>${escapeHtml(action.label)}</span>
        </button>
    `).join('');

    el.sourceFileActionMenu.classList.remove('hidden');
    el.sourceFileActionMenu.style.visibility = 'hidden';
    positionFloatingElement(el.sourceFileActionMenu, activeMenu.anchorRect, 'left');
    el.sourceFileActionMenu.style.visibility = 'visible';

    el.sourceFileActionMenu.querySelectorAll('[data-source-file-action]').forEach((button) => {
        button.addEventListener('click', async (event) => {
            event.stopPropagation();
            const action = button.dataset.sourceFileAction;
            if (!action || button.disabled) {
                return;
            }

            if (action === 'open') {
                await openReaderDocument(activeMenu.documentItem.id);
            } else if (action === 'retry') {
                const result = await chatAPI.retryKnowledgeBaseDocument(activeMenu.documentItem.id);
                if (!result?.success) {
                    ui.showToastNotification(`重试文档失败：${result?.error || '未知错误'}`, 'error');
                    return;
                }

                state.knowledgeBaseDebugResult = null;
                await loadKnowledgeBaseDocuments(state.selectedKnowledgeBaseId, { silent: true });
                await loadCurrentTopicKnowledgeBaseDocuments({ silent: true, reuseSelected: false });
                await loadKnowledgeBases({ silent: true });
            }

            closeSourceFileActionMenu();
        });
    });
}

function toggleSourceFileActionMenu(documentItem, anchorElement) {
    if (!documentItem || !anchorElement) {
        return;
    }

    if (state.activeSourceFileMenu?.documentId === documentItem.id) {
        closeSourceFileActionMenu();
        return;
    }

    hideSourceFileTooltip();
    state.activeSourceFileMenu = {
        documentId: documentItem.id,
        documentItem,
        anchorRect: anchorElement.getBoundingClientRect(),
    };
    renderSourceFileActionMenu();
}

function renderKnowledgeBaseDocumentRow(documentItem, options = {}) {
    const row = document.createElement('div');
    row.className = 'kb-document-row';
    const readable = isReaderSupportedDocument(documentItem) && documentItem.status === 'done';
    const visual = getKnowledgeBaseDocumentVisual(documentItem);
    const menuOpen = state.activeSourceFileMenu?.documentId === documentItem.id;
    row.classList.toggle('kb-document-row--clickable', readable);
    row.classList.toggle('kb-document-row--active', documentItem.id === state.reader.documentId);
    row.classList.toggle('kb-document-row--menu-open', menuOpen);

    row.innerHTML = `
        <div class="kb-document-row__leading">
            <button
                class="kb-document-row__menu-btn"
                type="button"
                data-doc-menu-button
                title="更多操作"
                aria-label="更多操作"
            >
                <span class="material-symbols-outlined kb-document-row__file-icon kb-document-row__file-icon--${escapeHtml(visual.tone)}">${escapeHtml(visual.icon)}</span>
                <span class="material-symbols-outlined kb-document-row__menu-icon">more_vert</span>
            </button>
        </div>
        <div class="kb-document-row__body ${readable ? 'kb-document-row__body--readable' : ''}">
            <strong>${escapeHtml(documentItem.name)}</strong>
        </div>
    `;

    row.addEventListener('mouseenter', () => {
        showSourceFileTooltip(documentItem, row);
    });
    row.addEventListener('mouseleave', () => {
        hideSourceFileTooltip();
    });

    if (readable) {
        row.addEventListener('click', () => {
            hideSourceFileTooltip();
            void openReaderDocument(documentItem.id);
        });
    }

    row.querySelector('[data-doc-menu-button]')?.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleSourceFileActionMenu(documentItem, event.currentTarget);
    });

    return row;
}

function renderKnowledgeBaseDebugResults() {
    if (!el.knowledgeBaseDebugResults) {
        return;
    }

    const result = state.knowledgeBaseDebugResult;
    if (!result) {
        el.knowledgeBaseDebugResults.innerHTML = '<div class="empty-list-state"><strong>还没有调试结果</strong><span>选择一个 Source 并输入 query 后，这里会显示搜索或调试信息。</span></div>';
        return;
    }

    if (result.mode === 'search') {
        const items = Array.isArray(result.items) ? result.items : [];
        el.knowledgeBaseDebugResults.innerHTML = `
            <div class="kb-debug-summary">
                <strong>Search</strong>
                <span>${escapeHtml(result.query || '')}</span>
                <span>${items.length} hits${result.rerankApplied ? ' · rerank' : ''}${result.rerankFallbackReason ? ` · fallback: ${escapeHtml(result.rerankFallbackReason)}` : ''}</span>
            </div>
        `;

        if (items.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-list-state';
            empty.innerHTML = '<strong>没有命中结果</strong><span>当前 query 没有检索到满足阈值的 chunk。</span>';
            el.knowledgeBaseDebugResults.appendChild(empty);
            return;
        }

        items.forEach((item) => {
            const card = document.createElement('div');
            card.className = 'kb-debug-card';
            card.innerHTML = `
                <strong>${escapeHtml(item.documentName)}</strong>
                <span>score ${item.score}${typeof item.vectorScore === 'number' ? ` · vec ${item.vectorScore}` : ''}${typeof item.rerankScore === 'number' ? ` · rerank ${item.rerankScore}` : ''}</span>
                ${item.sectionTitle ? `<span>${escapeHtml(item.sectionTitle)}</span>` : ''}
                <pre>${escapeHtml(item.content || '')}</pre>
            `;
            el.knowledgeBaseDebugResults.appendChild(card);
        });
        return;
    }

    const vectorCandidates = Array.isArray(result.vectorCandidates) ? result.vectorCandidates : [];
    const finalItems = Array.isArray(result.finalItems) ? result.finalItems : [];
    el.knowledgeBaseDebugResults.innerHTML = `
        <div class="kb-debug-summary">
            <strong>Debug</strong>
            <span>${escapeHtml(result.query || '')}</span>
            <span>threshold ${result.threshold} · topK ${result.topK} · candidate ${result.candidateTopK}</span>
            <span>${result.rerankApplied ? `rerank ${escapeHtml(result.rerankModel || '')}` : 'vector only'}${result.rerankFallbackReason ? ` · fallback: ${escapeHtml(result.rerankFallbackReason)}` : ''}</span>
        </div>
    `;

    if (finalItems.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-list-state';
        empty.innerHTML = '<strong>没有调试结果</strong><span>当前 query 没有命中满足条件的 chunk。</span>';
        el.knowledgeBaseDebugResults.appendChild(empty);
        return;
    }

    if (result.contextText) {
        const contextCard = document.createElement('div');
        contextCard.className = 'kb-debug-card kb-debug-card--context';
        contextCard.innerHTML = `
            <strong>最终注入上下文</strong>
            <pre>${escapeHtml(result.contextText)}</pre>
        `;
        el.knowledgeBaseDebugResults.appendChild(contextCard);
    }

    const finalCard = document.createElement('div');
    finalCard.className = 'kb-debug-card';
    finalCard.innerHTML = '<strong>最终命中</strong>';
    finalItems.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'kb-debug-hit';
        row.innerHTML = `
            <span>${escapeHtml(item.documentName)}${item.sectionTitle ? ` · ${escapeHtml(item.sectionTitle)}` : ''}</span>
            <span>score ${item.score}${typeof item.vectorScore === 'number' ? ` · vec ${item.vectorScore}` : ''}${typeof item.rerankScore === 'number' ? ` · rerank ${item.rerankScore}` : ''}</span>
            <pre>${escapeHtml(item.content || '')}</pre>
        `;
        finalCard.appendChild(row);
    });
    el.knowledgeBaseDebugResults.appendChild(finalCard);

    const candidateCard = document.createElement('div');
    candidateCard.className = 'kb-debug-card';
    candidateCard.innerHTML = '<strong>向量候选</strong>';
    vectorCandidates.slice(0, 12).forEach((item) => {
        const row = document.createElement('div');
        row.className = 'kb-debug-hit';
        row.innerHTML = `
            <span>${escapeHtml(item.documentName)}${item.sectionTitle ? ` · ${escapeHtml(item.sectionTitle)}` : ''}</span>
            <span>vec ${item.vectorScore}</span>
            <pre>${escapeHtml(item.content || '')}</pre>
        `;
        candidateCard.appendChild(row);
    });
    el.knowledgeBaseDebugResults.appendChild(candidateCard);
}

function renderKnowledgeBaseManager() {
    if (!el.knowledgeBaseList || !el.knowledgeBaseDocuments) {
        return;
    }

    const selectedKb = state.knowledgeBases.find((item) => item.id === state.selectedKnowledgeBaseId) || null;
    el.knowledgeBaseNameInput.value = selectedKb?.name || '';
    if (el.runKnowledgeBaseSearchBtn) {
        el.runKnowledgeBaseSearchBtn.disabled = !selectedKb;
    }
    if (el.runKnowledgeBaseDebugBtn) {
        el.runKnowledgeBaseDebugBtn.disabled = !selectedKb;
    }
    if (el.knowledgeBaseSelectionSummary) {
        el.knowledgeBaseSelectionSummary.textContent = selectedKb
            ? `已选中：${selectedKb.name} · ${selectedKb.documentCount || 0} docs · ${selectedKb.failedCount || 0} failed`
            : '先创建一个 Source，再导入文档并绑定到话题。';
    }

    el.knowledgeBaseList.innerHTML = '';
    if (state.knowledgeBases.length === 0) {
        el.knowledgeBaseList.innerHTML = '<div class="empty-list-state"><strong>暂无 Source</strong><span>创建一个来源后，这里会显示文档和状态。</span></div>';
    } else {
        state.knowledgeBases.forEach((kb) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `knowledge-base-item ${kb.id === state.selectedKnowledgeBaseId ? 'knowledge-base-item--active' : ''}`;
            button.innerHTML = `
                <span class="knowledge-base-item__name">${escapeHtml(kb.name)}</span>
                <span class="knowledge-base-item__meta">${kb.documentCount || 0} docs · ${kb.failedCount || 0} failed · ${kb.pendingCount || 0} pending</span>
            `;
            button.addEventListener('click', async () => {
                state.selectedKnowledgeBaseId = kb.id;
                state.knowledgeBaseDebugResult = null;
                await loadKnowledgeBaseDocuments(kb.id, { silent: true });
                renderKnowledgeBaseManager();
            });
            el.knowledgeBaseList.appendChild(button);
        });
    }

    el.renameKnowledgeBaseBtn.disabled = !selectedKb;
    el.deleteKnowledgeBaseBtn.disabled = !selectedKb;
    el.importKnowledgeBaseFilesBtn.disabled = !selectedKb;

    el.knowledgeBaseDocuments.innerHTML = '';
    if (!selectedKb) {
        el.knowledgeBaseDocuments.innerHTML = '<div class="empty-list-state"><strong>未选择 Source</strong><span>选择一个来源后即可查看文档任务状态。</span></div>';
        renderKnowledgeBaseDebugResults();
        syncKnowledgeBasePolling();
        return;
    }

    if (state.knowledgeBaseDocuments.length === 0) {
        el.knowledgeBaseDocuments.innerHTML = '<div class="empty-list-state"><strong>暂无文档</strong><span>导入文本、PDF 或 DOCX 以开始检索。</span></div>';
        renderKnowledgeBaseDebugResults();
        syncKnowledgeBasePolling();
        return;
    }

    state.knowledgeBaseDocuments.forEach((documentItem) => {
        const row = renderKnowledgeBaseDocumentRow(documentItem);
        el.knowledgeBaseDocuments.appendChild(row);
    });

    renderKnowledgeBaseDebugResults();
    syncKnowledgeBasePolling();
}

async function saveGlobalSettings() {
    const themeMode = document.querySelector('input[name="themeMode"]:checked')?.value || 'system';
    const patch = {
        userName: el.userNameInput.value.trim() || 'User',
        vcpServerUrl: el.vcpServerUrl.value.trim(),
        vcpApiKey: el.vcpApiKey.value.trim(),
        kbBaseUrl: el.kbBaseUrl.value.trim(),
        kbApiKey: el.kbApiKey.value.trim(),
        kbEmbeddingModel: el.kbEmbeddingModel.value.trim(),
        kbUseRerank: el.kbUseRerank.checked,
        kbRerankModel: el.kbRerankModel.value.trim(),
        kbTopK: Number(el.kbTopK.value || 6),
        kbCandidateTopK: Number(el.kbCandidateTopK.value || 20),
        kbScoreThreshold: Number(el.kbScoreThreshold.value || 0.25),
        chatFontPreset: el.chatFontPreset.value,
        chatCodeFontPreset: el.chatCodeFontPreset.value,
        chatBubbleMaxWidthWideDefault: Number(el.chatBubbleMaxWidthWideDefault.value || 92),
        enableAgentBubbleTheme: el.enableAgentBubbleTheme.checked,
        enableWideChatLayout: el.enableWideChatLayout.checked,
        enableSmoothStreaming: el.enableSmoothStreaming.checked,
        currentThemeMode: themeMode,
    };
    const result = await chatAPI.saveSettings(patch);
    if (!result?.success) {
        ui.showToastNotification(`保存设置失败：${result?.error || '未知错误'}`, 'error');
        return;
    }

    state.settings = { ...state.settings, ...patch };
    window.globalSettings = state.settings;
    applyRendererSettings();
    chatAPI.setThemeMode(themeMode);
    window.emoticonManager?.reload?.();
    ui.showToastNotification('全局设置已保存。', 'success');
}

function setPromptVisible(visible) {
    el.selectAgentPromptForSettings.classList.toggle('hidden', visible);
    el.agentSettingsContainer.classList.toggle('hidden', !visible);
}

function normalizeStoredAttachment(rawAttachment) {
    if (!rawAttachment || typeof rawAttachment !== 'object') {
        return null;
    }

    const src = rawAttachment.src || rawAttachment.internalPath || '';
    const internalPath = rawAttachment.internalPath || (src.startsWith('file://') ? src : '');

    return {
        ...rawAttachment,
        name: rawAttachment.name || rawAttachment.originalName || 'Attachment',
        type: rawAttachment.type || 'application/octet-stream',
        src,
        internalPath,
        extractedText: rawAttachment.extractedText ?? null,
        imageFrames: Array.isArray(rawAttachment.imageFrames) ? rawAttachment.imageFrames : null,
    };
}

function normalizeAttachmentList(attachments) {
    return Array.isArray(attachments)
        ? attachments.map(normalizeStoredAttachment).filter(Boolean)
        : [];
}

function normalizeHistory(history) {
    return Array.isArray(history)
        ? history.map((message) => ({
            ...message,
            attachments: normalizeAttachmentList(message.attachments),
            favorited: message.favorited === true,
            favoriteAt: message.favoriteAt || null,
            noteRefs: Array.isArray(message.noteRefs) ? message.noteRefs : [],
            selectionContextRefs: Array.isArray(message.selectionContextRefs) ? message.selectionContextRefs : [],
        }))
        : [];
}

function removeDeletedNoteReferencesFromHistory(history, noteId) {
    let changed = false;
    const nextHistory = normalizeHistory(history).map((message) => {
        const existingNoteRefs = Array.isArray(message.noteRefs) ? message.noteRefs : [];
        if (!existingNoteRefs.includes(noteId)) {
            return message;
        }

        changed = true;
        const nextNoteRefs = existingNoteRefs.filter((id) => id !== noteId);
        return {
            ...message,
            noteRefs: nextNoteRefs,
            favorited: nextNoteRefs.length > 0 ? message.favorited === true : false,
            favoriteAt: nextNoteRefs.length > 0 ? (message.favoriteAt || null) : null,
        };
    });

    return {
        changed,
        nextHistory,
    };
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

function normalizeNote(note = {}) {
    const sourceDocumentRefs = Array.isArray(note.sourceDocumentRefs) ? note.sourceDocumentRefs : [];
    const flashcardDeck = normalizeFlashcardDeck(note.flashcardDeck, sourceDocumentRefs);

    return {
        ...note,
        id: String(note.id || ''),
        agentId: String(note.agentId || state.currentSelectedItem.id || ''),
        topicId: String(note.topicId || state.currentTopicId || ''),
        title: String(note.title || '未命名笔记').trim() || '未命名笔记',
        contentMarkdown: String(note.contentMarkdown || ''),
        sourceMessageIds: Array.isArray(note.sourceMessageIds) ? note.sourceMessageIds : [],
        sourceDocumentRefs,
        kind: String(note.kind || 'note'),
        flashcardDeck,
        flashcardProgress: normalizeFlashcardProgress(note.flashcardProgress, flashcardDeck),
        createdAt: Number(note.createdAt || Date.now()),
        updatedAt: Number(note.updatedAt || note.createdAt || Date.now()),
    };
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

function clearNoteEditor() {
    state.activeNoteId = null;
    if (el.noteTitleInput) el.noteTitleInput.value = '';
    if (el.noteContentInput) el.noteContentInput.value = '';
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
    if (el.noteTitleInput) el.noteTitleInput.value = note.title || '';
    if (el.noteContentInput) el.noteContentInput.value = note.contentMarkdown || '';

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

function getActiveFlashcardNote() {
    const note = findNoteById(state.activeFlashcardNoteId);
    return note ? normalizeNote(note) : null;
}

function getPendingFlashcardGeneration() {
    return state.pendingFlashcardGeneration || null;
}

function getFlashcardSourceCount(note) {
    if (!note) {
        return 0;
    }
    const documentCount = Array.isArray(note.sourceDocumentRefs) ? note.sourceDocumentRefs.length : 0;
    if (documentCount > 0) {
        return documentCount;
    }
    return Array.isArray(note.sourceMessageIds) ? note.sourceMessageIds.length : 0;
}

function beginPendingFlashcardGeneration(payload = {}) {
    state.activeFlashcardNoteId = null;
    state.pendingFlashcardGeneration = {
        title: String(payload.title || '闪卡生成中').trim() || '闪卡生成中',
        sourceCount: Number(payload.sourceCount || 0),
        startedAt: Date.now(),
    };
    setRightPanelMode('notes');
    renderNotesPanel();
}

function clearPendingFlashcardGeneration() {
    state.pendingFlashcardGeneration = null;
}

function replaceNoteInCollections(note) {
    if (!note) {
        return null;
    }
    const normalized = normalizeNote(note);
    const replaceInList = (list) => {
        const nextList = list.map((item) => item.id === normalized.id ? normalized : item);
        if (!nextList.some((item) => item.id === normalized.id)) {
            nextList.unshift(normalized);
        }
        return nextList;
    };
    state.topicNotes = replaceInList(state.topicNotes);
    state.agentNotes = replaceInList(state.agentNotes);
    return normalized;
}

function renderFlashcardContent(target, markdown) {
    if (!target) {
        return;
    }
    target.innerHTML = renderMarkdownFragment(markdown);
}

function renderFlashcardsPractice() {
    const pending = getPendingFlashcardGeneration();
    if (pending && !state.activeFlashcardNoteId) {
        if (el.flashcardsDeckTitle) {
            el.flashcardsDeckTitle.textContent = pending.title;
        }
        if (el.flashcardsDeckMeta) {
            el.flashcardsDeckMeta.textContent = `${pending.sourceCount > 0 ? `${pending.sourceCount} 个来源` : '正在整理学习材料'} · 正在生成闪卡`;
        }
        if (el.flashcardsDeckProgress) {
            el.flashcardsDeckProgress.textContent = '生成中';
        }
        if (el.flashcardsKnownCount) {
            el.flashcardsKnownCount.lastElementChild.textContent = '—';
        }
        if (el.flashcardsUnknownCount) {
            el.flashcardsUnknownCount.lastElementChild.textContent = '—';
        }
        if (el.flashcardFrontContent) {
            el.flashcardFrontContent.innerHTML = `
                <div class="flashcards-skeleton">
                    <div class="flashcards-skeleton__pill"></div>
                    <div class="flashcards-skeleton__line flashcards-skeleton__line--short"></div>
                    <div class="flashcards-skeleton__line"></div>
                    <div class="flashcards-skeleton__line flashcards-skeleton__line--wide"></div>
                    <div class="flashcards-skeleton__card"></div>
                </div>
            `;
        }
        if (el.flashcardBackContent) {
            el.flashcardBackContent.innerHTML = '';
        }
        el.flashcardCardButton?.classList.remove('flashcard-card--flipped');
        el.flashcardCardButton?.classList.add('flashcard-card--pending');
        el.flashcardsPrevBtn?.toggleAttribute('disabled', true);
        el.flashcardsNextBtn?.toggleAttribute('disabled', true);
        el.flashcardsMarkKnownBtn?.toggleAttribute('disabled', true);
        el.flashcardsMarkUnknownBtn?.toggleAttribute('disabled', true);
        el.flashcardsMarkKnownBtn?.classList.remove('flashcards-practice__result-btn--active');
        el.flashcardsMarkUnknownBtn?.classList.remove('flashcards-practice__result-btn--active');
        return;
    }

    const note = getActiveFlashcardNote();
    if (!hasStructuredFlashcards(note)) {
        setRightPanelMode('notes');
        state.activeFlashcardNoteId = null;
        return;
    }

    const deck = note.flashcardDeck;
    const progress = note.flashcardProgress || normalizeFlashcardProgress(null, deck);
    const currentIndex = clamp(progress?.currentIndex ?? 0, 0, deck.cards.length - 1);
    const currentCard = deck.cards[currentIndex];
    const currentState = progress?.cardStates?.find((item) => item.cardId === currentCard.id)?.result || null;

    if (el.flashcardsDeckTitle) {
        el.flashcardsDeckTitle.textContent = deck.title || note.title || '闪卡练习';
    }
    if (el.flashcardsDeckMeta) {
        el.flashcardsDeckMeta.textContent = `基于 ${getFlashcardSourceCount(note)} 个来源 · 共 ${deck.cards.length} 张卡`;
    }
    if (el.flashcardsDeckProgress) {
        el.flashcardsDeckProgress.textContent = `${currentIndex + 1} / ${deck.cards.length}`;
    }
    if (el.flashcardsKnownCount) {
        el.flashcardsKnownCount.lastElementChild.textContent = String(progress?.knownCount ?? 0);
    }
    if (el.flashcardsUnknownCount) {
        el.flashcardsUnknownCount.lastElementChild.textContent = String(progress?.unknownCount ?? 0);
    }

    renderFlashcardContent(el.flashcardFrontContent, currentCard.front);
    renderFlashcardContent(el.flashcardBackContent, currentCard.back);

    el.flashcardCardButton?.classList.remove('flashcard-card--pending');
    el.flashcardCardButton?.classList.toggle('flashcard-card--flipped', progress?.flipped === true);
    el.flashcardsPrevBtn?.toggleAttribute('disabled', currentIndex <= 0);
    el.flashcardsNextBtn?.toggleAttribute('disabled', currentIndex >= deck.cards.length - 1);
    el.flashcardsMarkKnownBtn?.toggleAttribute('disabled', false);
    el.flashcardsMarkUnknownBtn?.toggleAttribute('disabled', false);
    el.flashcardsMarkKnownBtn?.classList.toggle('flashcards-practice__result-btn--active', currentState === 'known');
    el.flashcardsMarkUnknownBtn?.classList.toggle('flashcards-practice__result-btn--active', currentState === 'unknown');
}

async function persistFlashcardProgress(note, nextProgress) {
    if (!note?.id || !note?.agentId || !note?.topicId) {
        return false;
    }

    const payload = {
        id: note.id,
        title: note.title,
        contentMarkdown: note.contentMarkdown,
        sourceMessageIds: note.sourceMessageIds,
        sourceDocumentRefs: note.sourceDocumentRefs,
        kind: note.kind,
        flashcardDeck: note.flashcardDeck,
        flashcardProgress: nextProgress,
        createdAt: note.createdAt,
    };

    const result = await chatAPI.saveTopicNote(note.agentId, note.topicId, payload).catch((error) => ({
        success: false,
        error: error.message,
    }));

    if (!result?.success) {
        ui.showToastNotification(`保存闪卡进度失败：${result?.error || '未知错误'}`, 'error');
        return false;
    }

    replaceNoteInCollections(result.item || payload);
    renderNotesPanel();
    renderFlashcardsPractice();
    return true;
}

async function updateFlashcardProgress(mutator) {
    const note = getActiveFlashcardNote();
    if (!hasStructuredFlashcards(note)) {
        return;
    }

    const currentProgress = note.flashcardProgress || normalizeFlashcardProgress(null, note.flashcardDeck);
    const nextProgress = mutator({
        ...currentProgress,
        cardStates: Array.isArray(currentProgress.cardStates)
            ? currentProgress.cardStates.map((item) => ({ ...item }))
            : [],
    }, note.flashcardDeck);

    if (!nextProgress) {
        return;
    }

    await persistFlashcardProgress(note, normalizeFlashcardProgress(nextProgress, note.flashcardDeck));
}

function openFlashcardPractice(note) {
    const normalized = normalizeNote(note);
    if (!hasStructuredFlashcards(normalized)) {
        return false;
    }

    openNoteDetail(normalized, { kind: 'flashcards' });
    renderNotesPanel();
    return true;
}

function returnToNotesPanel() {
    closeNoteDetail();
    renderNotesPanel();
}

async function navigateFlashcards(direction) {
    await updateFlashcardProgress((progress, deck) => ({
        ...progress,
        currentIndex: clamp((progress.currentIndex || 0) + direction, 0, deck.cards.length - 1),
        flipped: false,
    }));
}

async function setFlashcardResult(result) {
    await updateFlashcardProgress((progress, deck) => {
        const currentIndex = clamp(progress.currentIndex || 0, 0, deck.cards.length - 1);
        const currentCard = deck.cards[currentIndex];
        const nextStates = progress.cardStates.map((item) => (
            item.cardId === currentCard.id
                ? { ...item, result, updatedAt: Date.now() }
                : item
        ));

        return {
            ...progress,
            currentIndex: Math.min(currentIndex + 1, deck.cards.length - 1),
            flipped: false,
            cardStates: nextStates,
        };
    });
}

function revealNote(note) {
    if (!note) {
        return;
    }
    openNoteDetail(note);
    renderNotesPanel();
}

function updateNotesSelectionSummary() {
    const selectedCount = state.selectedNoteIds.length;
    const visibleCount = getVisibleNotes().length;
    if (!el.notesSelectionSummary) {
        return;
    }

    const scopeLabel = state.notesScope === 'agent' ? '学科汇总' : '当前话题';
    if (selectedCount > 0) {
        el.notesSelectionSummary.textContent = `${scopeLabel} · 已选 ${selectedCount} 条，生成时优先使用这些笔记`;
        return;
    }

    if (visibleCount > 0) {
        el.notesSelectionSummary.textContent = `${scopeLabel} · ${visibleCount} 条笔记，未选择时回退到当前 Source`;
        return;
    }

    el.notesSelectionSummary.textContent = `${scopeLabel} · 暂无笔记，可直接从当前来源开始生成`;
}

function renderNotesPanel() {
    const notes = getVisibleNotes();
    closeNoteActionMenu();

    if (el.topicNotesScopeBtn) {
        el.topicNotesScopeBtn.classList.toggle('notes-scope-btn--active', state.notesScope === 'topic');
    }
    if (el.agentNotesScopeBtn) {
        el.agentNotesScopeBtn.classList.toggle('notes-scope-btn--active', state.notesScope === 'agent');
    }

    updateNotesSelectionSummary();

    if (!el.notesList) {
        return;
    }

    el.notesList.innerHTML = '';
    const pendingFlashcards = getPendingFlashcardGeneration();

    if (pendingFlashcards) {
        const pendingCard = document.createElement('div');
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
        const empty = document.createElement('div');
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
        const card = document.createElement('div');
        card.className = 'note-card note-card--studio';
        const isInteractiveFlashcard = hasStructuredFlashcards(normalized);
        const isSelected = state.selectedNoteIds.includes(normalized.id);
        card.classList.toggle('note-card--flashcard-entry', isInteractiveFlashcard);
        card.classList.toggle('note-card--active', normalized.id === getNoteHighlightId());
        card.classList.toggle('note-card--selected', isSelected);

        const preview = escapeHtml(stripMarkdown(normalized.contentMarkdown || '').trim());
        const sourceCount = getFlashcardSourceCount(normalized);
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
            if (event.target.closest('[data-note-menu]')) {
                return;
            }
            if (openFlashcardPractice(normalized)) {
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
        renderFlashcardsPractice();
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
        renderFlashcardsPractice();
    }
}

async function refreshNotesData() {
    await loadTopicNotes();
    await loadAgentNotes();
}

function createBlankNote() {
    openNoteDetail(null, {
        kind: 'note',
        trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    });
    renderNotesPanel();
}

async function saveActiveNote() {
    if (!state.currentSelectedItem.id || !state.currentTopicId) {
        ui.showToastNotification('请先选择一个智能体和话题，再保存笔记。', 'warning');
        return;
    }

    const currentNote = getActiveNote();
    const title = el.noteTitleInput?.value.trim() || '';
    const contentMarkdown = el.noteContentInput?.value || '';

    if (!title && !contentMarkdown.trim()) {
        ui.showToastNotification('请输入笔记标题或内容。', 'warning');
        return;
    }

    const targetTopicId = currentNote?.topicId || state.currentTopicId;
    const result = await chatAPI.saveTopicNote(state.currentSelectedItem.id, targetTopicId, {
        id: currentNote?.id,
        title: title || currentNote?.title || '未命名笔记',
        contentMarkdown,
        sourceMessageIds: currentNote?.sourceMessageIds || [],
        sourceDocumentRefs: currentNote?.sourceDocumentRefs || [],
        kind: currentNote?.kind || 'note',
        createdAt: currentNote?.createdAt,
    });

    if (!result?.success) {
        ui.showToastNotification(`保存笔记失败：${result?.error || '未知错误'}`, 'error');
        return;
    }

    state.activeNoteId = result.item?.id || null;
    await refreshNotesData();
    const savedNote = normalizeNote(result.item || {});
    openNoteDetail(savedNote);
    ui.showToastNotification('笔记已保存。', 'success');
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
        true
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
    state.selectedNoteIds = state.selectedNoteIds.filter((id) => id !== currentNote.id);
    if (state.activeNoteId === currentNote.id) {
        clearNoteEditor();
    }
    if (state.activeFlashcardNoteId === currentNote.id) {
        state.activeFlashcardNoteId = null;
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

function buildMessageNoteContent(message) {
    const titleMap = {
        user: '我的提问摘录',
        assistant: 'AI 回答摘录',
    };
    const textContent = typeof message.content === 'string'
        ? message.content
        : (message.content?.text || JSON.stringify(message.content || '', null, 2));
    const attachmentSection = Array.isArray(message.attachments) && message.attachments.length > 0
        ? `\n\n## 附件\n\n${message.attachments.map((item) => `- ${item.name}`).join('\n')}`
        : '';

    return {
        title: titleMap[message.role] || '聊天摘录',
        contentMarkdown: `${textContent}${attachmentSection}`.trim(),
    };
}

async function createNoteFromMessage(messageId) {
    const message = state.currentChatHistory.find((item) => item.id === messageId);
    if (!message || !state.currentSelectedItem.id || !state.currentTopicId) {
        return null;
    }

    const noteBase = buildMessageNoteContent(message);
    const result = await chatAPI.createNoteFromMessage({
        agentId: state.currentSelectedItem.id,
        topicId: state.currentTopicId,
        title: `${noteBase.title} ${formatMessageTimestamp(message.timestamp || Date.now())}`,
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
    message.noteRefs = Array.isArray(message.noteRefs) ? [...new Set([...message.noteRefs, result.item.id])] : [result.item.id];
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

        const actions = document.createElement('div');
        actions.className = 'study-message-actions';

        const favoriteButton = document.createElement('button');
        favoriteButton.type = 'button';
        favoriteButton.className = `study-message-action${message.favorited ? ' study-message-action--active' : ''}`;
        favoriteButton.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px;">star</span>${message.favorited ? '已收藏' : '收藏'}`;
        favoriteButton.addEventListener('click', (event) => {
            event.stopPropagation();
            void toggleMessageFavorite(message.id);
        });

        const noteButton = document.createElement('button');
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
    const visibleNotes = getVisibleNotes();
    return visibleNotes.filter((note) => state.selectedNoteIds.includes(note.id));
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
        const text = selectedNotes
            .map((note) => `# ${note.title}\n\n${note.contentMarkdown}`)
            .join('\n\n---\n\n');

        return {
            sourceLabel: 'selected-notes',
            text,
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

    const prompts = {
        analysis: {
            title: `深度分析报告 ${new Date().toLocaleString()}`,
            instruction: '请基于以下学习材料生成一份结构化深度分析报告，包含：核心结论、关键知识点、关联关系、疑难点/待补问题、后续学习建议。使用简体中文 Markdown。',
            kind: 'analysis',
        },
        quiz: {
            title: `选择题练习 ${new Date().toLocaleString()}`,
            instruction: '请基于以下学习材料生成 8 道选择题。每题包含题干、4 个选项、正确答案、简短解析。使用简体中文 Markdown。',
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
        beginPendingFlashcardGeneration({
            title: prompt.title,
            sourceCount: Array.isArray(studyInput.sourceDocumentRefs) ? studyInput.sourceDocumentRefs.length : 0,
        });
    }

    ui.showToastNotification('正在生成内容，请稍候…', 'info', 2500);

    const response = await chatAPI.sendToVCP({
        requestId: makeId(`study_${kind}`),
        endpoint: state.settings.vcpServerUrl,
        apiKey: state.settings.vcpApiKey,
        messages: [
            { role: 'system', content: '你是 UniStudy 的学习助手，请输出结构清晰、适合学习沉淀的 Markdown。' },
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
            clearPendingFlashcardGeneration();
            setRightPanelMode('notes');
            renderNotesPanel();
        }
        ui.showToastNotification(`生成失败：${response.error}`, 'error');
        return;
    }

    const responseContent = response?.response?.choices?.[0]?.message?.content || '';
    if (!responseContent.trim()) {
        if (prompt.kind === 'flashcards') {
            clearPendingFlashcardGeneration();
            setRightPanelMode('notes');
            renderNotesPanel();
        }
        ui.showToastNotification('模型没有返回可保存的内容。', 'warning');
        return;
    }

    let contentMarkdown = responseContent;
    let flashcardDeck = null;
    let flashcardProgress = null;

    if (prompt.kind === 'flashcards') {
        flashcardDeck = parseFlashcardDeckFromResponse(
            responseContent,
            prompt.title,
            studyInput.sourceDocumentRefs
        );

        if (!flashcardDeck) {
            clearPendingFlashcardGeneration();
            setRightPanelMode('notes');
            renderNotesPanel();
            ui.showToastNotification('闪卡生成结果格式无效，请重试。', 'error');
            return;
        }

        flashcardProgress = normalizeFlashcardProgress({
            currentIndex: 0,
            flipped: false,
            cardStates: flashcardDeck.cards.map((card) => ({
                cardId: card.id,
                result: null,
                updatedAt: 0,
            })),
        }, flashcardDeck);
        contentMarkdown = buildFlashcardSummaryMarkdown(flashcardDeck);
    }

    const saveResult = await chatAPI.saveTopicNote(state.currentSelectedItem.id, state.currentTopicId, {
        title: prompt.title,
        contentMarkdown,
        sourceMessageIds: studyInput.sourceMessageIds,
        sourceDocumentRefs: studyInput.sourceDocumentRefs,
        kind: prompt.kind,
        flashcardDeck,
        flashcardProgress,
    });

    if (!saveResult?.success) {
        if (prompt.kind === 'flashcards') {
            clearPendingFlashcardGeneration();
            setRightPanelMode('notes');
            renderNotesPanel();
        }
        ui.showToastNotification(`保存生成结果失败：${saveResult?.error || '未知错误'}`, 'error');
        return;
    }

    await refreshNotesData();
    const savedNote = normalizeNote(saveResult.item);
    if (prompt.kind === 'flashcards' && hasStructuredFlashcards(savedNote)) {
        clearPendingFlashcardGeneration();
        openFlashcardPractice(savedNote);
    } else {
        clearPendingFlashcardGeneration();
        openNoteDetail(savedNote, {
            kind: getNormalizedNoteKind(savedNote),
            trigger: prompt.kind === 'analysis' ? el.analyzeNotesBtn : (prompt.kind === 'quiz' ? el.generateQuizBtn : null),
        });
    }
    setSidePanelTab('notes');
    ui.showToastNotification('已生成并保存到当前话题笔记。', 'success');
}

function extractPromptTextFromLegacyConfig(config = {}) {
    if (typeof config.originalSystemPrompt === 'string' && config.originalSystemPrompt.trim()) {
        return config.originalSystemPrompt;
    }

    if (typeof config.systemPrompt === 'string' && config.systemPrompt.trim()) {
        return config.systemPrompt;
    }

    if (config.promptMode === 'modular') {
        const advancedPrompt = config.advancedSystemPrompt;
        if (typeof advancedPrompt === 'string' && advancedPrompt.trim()) {
            return advancedPrompt;
        }
        if (advancedPrompt && typeof advancedPrompt === 'object' && Array.isArray(advancedPrompt.blocks)) {
            return advancedPrompt.blocks
                .filter((block) => block && block.disabled !== true)
                .map((block) => {
                    if (block.type === 'newline') {
                        return '\n';
                    }
                    if (Array.isArray(block.variants) && block.variants.length > 0) {
                        return block.variants[block.selectedVariant || 0] || block.content || '';
                    }
                    return block.content || '';
                })
                .join('');
        }
    }

    if (config.promptMode === 'preset' && typeof config.presetSystemPrompt === 'string') {
        return config.presetSystemPrompt;
    }

    return '';
}

async function ensurePromptModule() {
    if (state.promptModule || !window.OriginalPromptModule) return;
    state.promptModule = new window.OriginalPromptModule({
        electronAPI: chatAPI,
    });
}

async function syncPromptModule(agentId, config) {
    await ensurePromptModule();

    const activePrompt = await chatAPI.getActiveSystemPrompt(agentId).catch(() => null);
    const resolvedPrompt = activePrompt?.success
        ? (activePrompt.systemPrompt || '')
        : extractPromptTextFromLegacyConfig(config);

    if (!state.promptModule) {
        el.systemPromptContainer.innerHTML = `
            <p class="prompt-text-mode-note">UniStudy 当前仅保留单文本提示词编辑器，旧版模块化提示词会在这里按纯文本展示。</p>
            <textarea id="litePromptFallback" rows="6" placeholder="输入系统提示词...">${resolvedPrompt}</textarea>
        `;
        return;
    }

    state.promptModule.updateContext(agentId, {
        ...config,
        promptMode: 'original',
        originalSystemPrompt: resolvedPrompt,
        systemPrompt: resolvedPrompt,
    });
    state.promptModule.render(el.systemPromptContainer);

    const note = document.createElement('p');
    note.className = 'prompt-text-mode-note';
    note.textContent = 'UniStudy 当前仅开放文本提示词模式，旧版模块化或预设提示词会在这里被展开为纯文本。';
    el.systemPromptContainer.prepend(note);
}

async function populateAgentForm(config) {
    el.editingAgentId.value = state.currentSelectedItem.id;
    el.agentNameInput.value = config.name || '';
    el.agentAvatarPreview.src = config.avatarUrl || '../assets/default_avatar.png';
    el.agentModel.value = config.model || '';
    el.agentTemperature.value = config.temperature ?? 0.7;
    el.agentContextTokenLimit.value = config.contextTokenLimit ?? 4000;
    el.agentMaxOutputTokens.value = config.maxOutputTokens ?? 1000;
    el.agentTopP.value = config.top_p ?? '';
    el.agentTopK.value = config.top_k ?? '';
    el.agentStreamOutputTrue.checked = config.streamOutput !== false;
    el.agentStreamOutputFalse.checked = config.streamOutput === false;
    el.agentAvatarBorderColor.value = config.avatarBorderColor || '#3d5a80';
    el.agentAvatarBorderColorText.value = config.avatarBorderColor || '#3d5a80';
    el.agentNameTextColor.value = config.nameTextColor || '#ffffff';
    el.agentNameTextColorText.value = config.nameTextColor || '#ffffff';
    el.disableCustomColors.checked = config.disableCustomColors === true;
    el.useThemeColorsInChat.checked = config.useThemeColorsInChat === true;
    await syncPromptModule(state.currentSelectedItem.id, config);
}

function renderAgentList(unreadCounts = {}) {
    el.agentList.innerHTML = '';
    if (state.agents.length === 0) {
        el.agentList.innerHTML = `
            <li class="empty-list-state">
                <strong>暂无学科入口</strong>
                <span>使用“新建学科”创建一个学习入口，或在首次启动时导入已有数据。</span>
            </li>
        `;
        return;
    }
    state.agents.forEach((agent) => {
        const li = document.createElement('li');
        const unreadCount = Number(unreadCounts[agent.id] || 0);
        const isActive = agent.id === state.currentSelectedItem.id;
        const statusLabel = unreadCount > 0 ? `${unreadCount} 个待处理话题` : (isActive ? '当前学科入口' : '已整理完成');
        li.className = 'list-item list-item--agent';
        li.dataset.agentId = agent.id || '';
        li.dataset.searchText = `${agent.name || ''} ${agent.id || ''}`.toLowerCase();
        li.classList.toggle('active', isActive);
        li.innerHTML = `
          <div class="list-item__media">
            <img class="avatar" src="${agent.avatarUrl || '../assets/default_avatar.png'}" alt="${agent.name || agent.id}" />
            <span class="list-item__media-glow"></span>
          </div>
          <div class="list-item__body">
              <div class="list-item__title-row">
                  <span class="list-item__title">${agent.name || agent.id}</span>
                  ${isActive ? '<span class="list-pill list-pill--active">当前</span>' : ''}
              </div>
              <span class="list-item__meta">${statusLabel}</span>
              <span class="list-item__submeta">${agent.id}</span>
          </div>
          <span class="badge ${unreadCount > 0 ? 'badge--active' : ''}">${unreadCount > 0 ? unreadCount : ''}</span>
        `;
        li.addEventListener('click', () => selectAgent(agent.id));
        el.agentList.appendChild(li);
    });
    filterAgents();
}

async function loadAgents() {
    const agents = await chatAPI.getAgents();
    if (agents?.error) {
        console.error('[LiteRenderer] getAgents failed:', agents.error);
        ui.showToastNotification(`加载智能体失败：${agents.error}`, 'error');
        state.agents = [];
        renderAgentList({});
        return;
    }
    state.agents = Array.isArray(agents) ? agents : [];
    const unreadResult = await chatAPI.getUnreadTopicCounts().catch(() => ({ counts: {} }));
    renderAgentList(unreadResult?.counts || {});
}

function filterAgents() {
    const keyword = el.agentSearchInput.value.trim().toLowerCase();
    Array.from(el.agentList.children).forEach((item) => {
        item.hidden = !item.dataset.searchText.includes(keyword);
    });
}

function renderTopics() {
    el.topicList.innerHTML = '';
    if (state.topics.length === 0) {
        el.topicList.innerHTML = `
            <li class="empty-list-state" style="border: none; background: transparent; padding: 0;">
                <span style="font-size: 12px; color: var(--muted); text-align: center;">暂无话题</span>
            </li>
        `;
        return;
    }
    state.topics.forEach((topic) => {
        const li = document.createElement('li');
        const isActive = topic.id === state.currentTopicId;
        const sourceReady = Boolean(topic.knowledgeBaseId);
        li.className = 'list-item topic-item topic-item--compact';
        li.dataset.topicId = topic.id || '';
        li.dataset.agentId = state.currentSelectedItem.id || '';
        li.dataset.searchText = `${topic.name || ''} ${new Date(topic.createdAt || Date.now()).toLocaleString()}`.toLowerCase();
        li.classList.toggle('active', isActive);

        li.innerHTML = `
            <div class="topic-item__body">
                <strong>${escapeHtml(topic.name || topic.id)}</strong>
            </div>
            <div class="topic-item__actions">
                <button
                    type="button"
                    class="ghost-button icon-btn topic-item__menu-btn"
                    data-topic-menu-button
                    title="更多操作"
                    aria-label="更多操作"
                >
                    <span class="material-symbols-outlined">more_horiz</span>
                </button>
            </div>
        `;

        li.addEventListener('click', async (event) => {
            const actionButton = event.target.closest('[data-topic-menu-button]');
            if (actionButton) {
                event.stopPropagation();
                toggleTopicActionMenu(topic, actionButton);
                return;
            }

            await selectTopic(topic.id);
        });

        li.addEventListener('dblclick', () => renameTopic(topic));
        el.topicList.appendChild(li);
    });
    filterTopics();
}

function filterTopics() {
    const keyword = el.topicSearchInput.value.trim().toLowerCase();
    Array.from(el.topicList.children).forEach((item) => {
        item.hidden = !item.dataset.searchText.includes(keyword);
    });
}

async function loadTopics() {
    if (!state.currentSelectedItem.id) {
        state.topics = [];
        state.currentTopicId = null;
        state.topicKnowledgeBaseDocuments = [];
        syncWorkspaceContext();
        renderTopics();
        renderTopicKnowledgeBaseFiles();
        syncComposerAvailability();
        return;
    }
    const topics = await chatAPI.getAgentTopics(state.currentSelectedItem.id);
    state.topics = Array.isArray(topics) ? topics.map(normalizeTopic) : [];
    if (!state.topics.some((topic) => topic.id === state.currentTopicId)) {
        state.currentTopicId = null;
    }
    if (!state.currentTopicId && state.topics.length > 0) {
        state.currentTopicId = state.topics[0].id;
    }
    syncWorkspaceContext();
    renderTopics();
    syncCurrentTopicKnowledgeBaseControls();
    syncComposerAvailability();
}

async function renameTopic(topic) {
    const nextName = await ui.showPromptDialog({
        title: '重命名话题',
        message: '更新话题标题。',
        placeholder: '话题名称',
        defaultValue: topic.name || topic.id,
        confirmText: '保存',
        cancelText: '取消',
    });
    if (!nextName) return;

    const result = await chatAPI.saveAgentTopicTitle(state.currentSelectedItem.id, topic.id, nextName.trim());
    if (result?.error) {
        ui.showToastNotification(`重命名话题失败：${result.error}`, 'error');
        return;
    }

    topic.name = nextName.trim();
    renderTopics();
}

async function setTopicUnreadState(topic, unread) {
    const result = await chatAPI.setTopicUnread(state.currentSelectedItem.id, topic.id, unread);
    if (!result?.success) {
        ui.showToastNotification(`更新话题状态失败：${result?.error || '未知错误'}`, 'error');
        return;
    }

    topic.unread = unread;
    renderTopics();
    await loadAgents();
}

async function toggleTopicLockState(topic) {
    const result = await chatAPI.toggleTopicLock(state.currentSelectedItem.id, topic.id);
    if (!result?.success) {
        ui.showToastNotification(`更新锁定状态失败：${result?.error || '未知错误'}`, 'error');
        return;
    }

    topic.locked = result.locked;
    renderTopics();
}

async function clearCurrentConversationView() {
    state.currentTopicId = null;
    state.currentChatHistory = [];
    state.topicKnowledgeBaseDocuments = [];
    state.topicNotes = [];
    state.selectedNoteIds = [];
    state.pendingAttachments = [];
    setLeftSidebarMode('source-list');
    setLeftReaderTab('guide');
    syncWorkspaceContext();
    renderTopics();
    syncCurrentTopicKnowledgeBaseControls();
    renderTopicKnowledgeBaseFiles();
    refreshAttachmentPreview();
    renderNotesPanel();
    await renderCurrentHistory();
    syncComposerAvailability();
}

async function deleteTopicFromList(topic) {
    const label = topic.name || topic.id;
    const confirmed = await ui.showConfirmDialog(`确定删除话题 "${label}" 吗？`, '删除话题', '删除', '取消', true);
    if (!confirmed) return;

    const result = await chatAPI.deleteTopic(state.currentSelectedItem.id, topic.id);
    if (result?.error) {
        ui.showToastNotification(`删除话题失败：${result.error}`, 'error');
        return;
    }
    if (result?.warning) {
        ui.showToastNotification(`话题已删除，但清理时出现问题：${result.warning}`, 'warning', 5000);
    }

    if (state.currentTopicId === topic.id) {
        state.currentTopicId = null;
    }

    await loadTopics();
    await loadAgents();

    if (state.topics.length > 0) {
        await selectTopic(state.currentTopicId || state.topics[0].id);
        return;
    }

    await clearCurrentConversationView();
}

function buildHistoryFilePath() {
    const base = (state.currentSelectedItem?.config?.agentDataPath || '').replace(/[\\/]+$/, '');
    if (!base || !state.currentTopicId) return null;
    return `${base}\\topics\\${state.currentTopicId}\\history.json`;
}

async function renderCurrentHistory() {
    messageRenderer.clearChat({ preserveHistory: true });
    if (state.currentChatHistory.length === 0) {
        el.chatMessages.innerHTML = `<div class="empty-state" style="margin-top: 100px; background: transparent; border: none;">
  <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.4; color:var(--accent); margin-bottom:12px;"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
  <p style="font-size: 16px; font-weight: 500; color: var(--muted);">暂无消息，开始对话吧。</p>
</div>`;
        return;
    }
    await messageRenderer.renderHistory(state.currentChatHistory, true);
    decorateChatMessages();
}
async function selectTopic(topicId, options = {}) {
    if (!state.currentSelectedItem.id || !topicId) return;
    state.currentTopicId = topicId;
    state.topicKnowledgeBaseDocuments = [];
    state.selectedNoteIds = [];
    closeNoteDetail({ restoreFocus: false });
    closeNoteActionMenu();
    state.activeFlashcardNoteId = null;
    clearPendingFlashcardGeneration();
    state.pendingAttachments = [];
    clearPendingSelectionContext();
    resetReaderState();
    setLeftSidebarMode('source-list');
    setLeftReaderTab('guide');
    setRightPanelMode('notes');
    renderReaderPanel();
    syncWorkspaceContext();
    refreshAttachmentPreview();
    syncComposerAvailability();
    syncCurrentTopicKnowledgeBaseControls();
    messageRenderer.setCurrentTopicId?.(topicId);

    const history = await chatAPI.getChatHistory(state.currentSelectedItem.id, topicId);
    state.currentChatHistory = normalizeHistory(history);
    renderTopics();
    syncCurrentTopicKnowledgeBaseControls();
    await ensureTopicSource({ silent: true });
    syncCurrentTopicKnowledgeBaseControls();
    await loadCurrentTopicKnowledgeBaseDocuments({ silent: true });
    await loadTopicNotes();
    await renderCurrentHistory();

    const historyPath = buildHistoryFilePath();
    if (historyPath) {
        await chatAPI.watcherStart(historyPath, state.currentSelectedItem.id, topicId);
    }

    if (!options.fromWatcher) {
        await chatAPI.setTopicUnread(state.currentSelectedItem.id, topicId, false).catch(() => {});
        await chatAPI.saveSettings({
            lastOpenItemId: state.currentSelectedItem.id,
            lastOpenItemType: 'agent',
            lastOpenTopicId: topicId,
        }).catch(() => {});
        await loadAgents();
    }
}

async function selectAgent(agentId) {
    const config = await chatAPI.getAgentConfig(agentId);
    if (!config || config.error) {
        ui.showToastNotification(`加载智能体失败：${config?.error || '未知错误'}`, 'error');
        return;
    }

    state.currentSelectedItem = {
        id: agentId,
        type: 'agent',
        name: config.name || agentId,
        avatarUrl: config.avatarUrl || '../assets/default_avatar.png',
        config,
    };
    state.pendingAttachments = [];
    state.selectedNoteIds = [];
    closeNoteDetail({ restoreFocus: false });
    closeNoteActionMenu();
    state.activeFlashcardNoteId = null;
    clearPendingFlashcardGeneration();
    clearPendingSelectionContext();
    resetReaderState();
    setLeftSidebarMode('source-list');
    setLeftReaderTab('guide');
    renderReaderPanel();
    refreshAttachmentPreview();

    el.agentSettingsContainerTitle.textContent = '智能体设置';
    el.selectedAgentNameForSettings.textContent = config.name || agentId;
    syncWorkspaceContext();
    setPromptVisible(true);
    messageRenderer.setCurrentSelectedItem?.(state.currentSelectedItem);
    messageRenderer.setCurrentItemAvatar?.(state.currentSelectedItem.avatarUrl);
    messageRenderer.setCurrentItemAvatarColor?.(config.avatarCalculatedColor || null);

    await populateAgentForm(config);
    await loadTopics();
    await loadAgentNotes();
    await loadAgents();

    if (state.topics.length > 0) {
        await selectTopic(state.currentTopicId || state.topics[0].id);
    } else {
        state.currentTopicId = null;
        state.currentChatHistory = [];
        state.topicKnowledgeBaseDocuments = [];
        state.topicNotes = [];
        resetReaderState();
        renderReaderPanel();
        syncCurrentTopicKnowledgeBaseControls();
        renderTopicKnowledgeBaseFiles();
        renderNotesPanel();
        await renderCurrentHistory();
        syncComposerAvailability();
    }
}

async function saveAgentSettings() {
    if (!state.currentSelectedItem.id) return;
    const promptText = state.promptModule
        ? await state.promptModule.getPrompt()
        : (document.getElementById('litePromptFallback')?.value || '').trim();

    const patch = {
        name: el.agentNameInput.value.trim(),
        model: el.agentModel.value.trim(),
        temperature: Number(el.agentTemperature.value || 0.7),
        contextTokenLimit: Number(el.agentContextTokenLimit.value || 4000),
        maxOutputTokens: Number(el.agentMaxOutputTokens.value || 1000),
        top_p: el.agentTopP.value === '' ? undefined : Number(el.agentTopP.value),
        top_k: el.agentTopK.value === '' ? undefined : Number(el.agentTopK.value),
        streamOutput: el.agentStreamOutputTrue.checked,
        avatarBorderColor: el.agentAvatarBorderColor.value,
        nameTextColor: el.agentNameTextColor.value,
        disableCustomColors: el.disableCustomColors.checked,
        useThemeColorsInChat: el.useThemeColorsInChat.checked,
        promptMode: 'original',
        originalSystemPrompt: promptText,
        systemPrompt: promptText,
    };

    const saveResult = await chatAPI.saveAgentConfig(state.currentSelectedItem.id, patch);
    if (saveResult?.error) {
        ui.showToastNotification(`保存智能体失败：${saveResult.error}`, 'error');
        return;
    }

    const avatarFile = el.agentAvatarInput.files?.[0];
    if (avatarFile) {
        const buffer = await avatarFile.arrayBuffer();
        await chatAPI.saveAvatar(state.currentSelectedItem.id, {
            name: avatarFile.name,
            type: avatarFile.type,
            buffer,
        });
        el.agentAvatarInput.value = '';
    }

    ui.showToastNotification('智能体设置已保存。', 'success');
    await loadAgents();
    await selectAgent(state.currentSelectedItem.id);
}

function refreshAttachmentPreview() {
    ui.updateAttachmentPreview(state.pendingAttachments, el.attachmentPreviewArea);
}

function syncComposerAvailability() {
    const hasTopic = Boolean(state.currentSelectedItem.id && state.currentTopicId);
    const interrupting = Boolean(state.activeRequestId);

    el.messageInput.disabled = !hasTopic;
    el.attachFileBtn.disabled = !hasTopic;
    el.emoticonTriggerBtn.disabled = !hasTopic;
    el.composerQuickNewTopicBtn.disabled = !hasTopic;
    el.sendMessageBtn.disabled = !hasTopic && !interrupting;

    if (!hasTopic) {
        el.chatInputCard?.classList.remove('drag-over');
    }
}

function getComposerContext() {
    if (!state.currentSelectedItem.id || !state.currentTopicId) {
        ui.showToastNotification('请先选择一个智能体和话题。', 'warning');
        return null;
    }

    return {
        agentId: state.currentSelectedItem.id,
        topicId: state.currentTopicId,
    };
}

function summarizeAttachmentErrors(results) {
    const failures = results.filter((item) => item?.error);
    if (failures.length === 0) return;

    const names = failures.map((item) => item.name || 'Unknown file').join(', ');
    ui.showToastNotification(`部分附件导入失败：${names}`, 'warning', 4500);
}

function appendStoredAttachments(attachments) {
    if (attachments.length === 0) return;
    state.pendingAttachments.push(...attachments.map(normalizeStoredAttachment).filter(Boolean));
    refreshAttachmentPreview();
}

function inferExtensionFromType(type = '') {
    if (!type.includes('/')) return 'bin';
    const subtype = type.split('/')[1] || 'bin';
    if (subtype === 'jpeg') return 'jpg';
    return subtype.replace(/[^a-z0-9]/gi, '') || 'bin';
}

async function getNativePathForFile(file) {
    if (!file) {
        return '';
    }

    if (typeof file.path === 'string' && file.path.trim()) {
        return file.path.trim();
    }

    if (typeof window.electronPath?.getPathForFile === 'function') {
        const nativePath = await window.electronPath.getPathForFile(file);
        if (typeof nativePath === 'string' && nativePath.trim()) {
            return nativePath.trim();
        }
    }

    return '';
}

async function fileToTransferPayload(file, index = 0) {
    const fileName = file.name || `attachment_${Date.now()}_${index}.${inferExtensionFromType(file.type)}`;
    const nativePath = await getNativePathForFile(file);
    if (nativePath) {
        return {
            name: fileName,
            path: nativePath,
            type: file.type || 'application/octet-stream',
        };
    }

    const buffer = new Uint8Array(await file.arrayBuffer());
    return {
        name: fileName,
        data: buffer,
        type: file.type || 'application/octet-stream',
    };
}

async function addFilesToComposer(fileList, source = 'drop') {
    const context = getComposerContext();
    if (!context) return;

    if (source === 'picker') {
        const result = await chatAPI.selectFilesToSend(context.agentId, context.topicId);
        if (!result?.success) {
            if (result?.error) {
                ui.showToastNotification(`添加附件失败：${result.error}`, 'error');
            }
            return;
        }

        const attachments = Array.isArray(result.attachments)
            ? result.attachments.filter((item) => !item?.error)
            : [];
        appendStoredAttachments(attachments);
        summarizeAttachmentErrors(Array.isArray(result.attachments) ? result.attachments : []);
        return;
    }

    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    const payload = await Promise.all(files.map((file, index) => fileToTransferPayload(file, index)));
    const result = await chatAPI.handleFileDrop(context.agentId, context.topicId, payload);
    const entries = Array.isArray(result) ? result : [];
    const attachments = entries
        .filter((item) => item?.success && item.attachment)
        .map((item) => item.attachment);

    appendStoredAttachments(attachments);
    summarizeAttachmentErrors(entries);
}

function materializeAttachments() {
    return normalizeAttachmentList(state.pendingAttachments);
}
function buildKnowledgeBaseQuery(message) {
    const segments = [];
    if (message?.content?.trim()) {
        segments.push(message.content.trim());
    }

    for (const attachment of normalizeAttachmentList(message?.attachments)) {
        if (attachment?.extractedText) {
            segments.push(`Attachment: ${attachment.name}\n${String(attachment.extractedText).slice(0, 1200)}`);
        }
    }

    return segments.join('\n\n').trim();
}

async function buildApiMessages(options = {}) {
    const temporarySystemMessages = Array.isArray(options.temporarySystemMessages)
        ? options.temporarySystemMessages.filter((item) => item && item.content)
        : [];
    const activePrompt = await chatAPI.getActiveSystemPrompt(state.currentSelectedItem.id).catch(() => ({ success: false, systemPrompt: '' }));
    const livePrompt = state.promptModule
        ? await state.promptModule.getPrompt().catch(() => '')
        : (document.getElementById('litePromptFallback')?.value || '').trim();
    const systemPrompt = livePrompt || (activePrompt?.success ? activePrompt.systemPrompt : '');
    const messages = [];

    if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
    }

    for (const temporaryMessage of temporarySystemMessages) {
        messages.push(temporaryMessage);
    }

    for (const message of state.currentChatHistory.filter((item) => !item.isThinking)) {
        if (message.role !== 'user') {
            messages.push({ role: message.role, content: message.content, name: message.name });
            continue;
        }

        if (!Array.isArray(message.attachments) || message.attachments.length === 0) {
            messages.push({ role: 'user', content: message.content });
            continue;
        }

        const parts = [];
        if (message.content?.trim()) {
            parts.push({ type: 'text', text: message.content });
        }

        for (const attachment of normalizeAttachmentList(message.attachments)) {
            if (attachment.type?.startsWith('image/')) {
                const fileResult = await chatAPI.getFileAsBase64(attachment.internalPath || attachment.src).catch(() => null);
                const base64Frames = Array.isArray(fileResult?.base64Frames) ? fileResult.base64Frames : [];

                if (base64Frames.length > 0) {
                    base64Frames.forEach((frame) => {
                        parts.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${frame}` } });
                    });
                    continue;
                }

                if (attachment.src?.startsWith('data:')) {
                    parts.push({ type: 'image_url', image_url: { url: attachment.src } });
                    continue;
                }

                parts.push({ type: 'text', text: `Image attachment: ${attachment.name}` });
                continue;
            }

            if (Array.isArray(attachment.imageFrames) && attachment.imageFrames.length > 0) {
                attachment.imageFrames.forEach((frame) => {
                    parts.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${frame}` } });
                });
                if (attachment.extractedText) {
                    parts.push({ type: 'text', text: `Attachment: ${attachment.name}\n${attachment.extractedText}` });
                }
            } else if (attachment.extractedText) {
                parts.push({ type: 'text', text: `Attachment: ${attachment.name}\n${attachment.extractedText}` });
            } else {
                parts.push({ type: 'text', text: `Attachment reference: ${attachment.name}` });
            }
        }

        messages.push({ role: 'user', content: parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts });
    }

    return messages;
}

async function buildKnowledgeBaseRetrieval(userMessage) {
    const currentTopic = getCurrentTopic();
    const kbId = currentTopic?.knowledgeBaseId;
    const query = buildKnowledgeBaseQuery(userMessage);

    if (!kbId || !query) {
        return {
            refs: [],
            temporarySystemMessages: [],
        };
    }

    const result = await chatAPI.retrieveKnowledgeBaseContext({
        kbId,
        query,
    }).catch((error) => ({
        success: false,
        error: error.message,
        refs: [],
        contextText: '',
    }));

    if (!result?.success) {
        ui.showToastNotification(`跳过 Source 检索：${result?.error || '未知错误'}`, 'warning', 4500);
        return {
            refs: [],
            temporarySystemMessages: [],
        };
    }

    return {
        refs: Array.isArray(result.refs) ? result.refs : [],
        temporarySystemMessages: result.contextText
            ? [{ role: 'system', content: result.contextText }]
            : [],
    };
}

function buildTopicContext() {
    return {
        agentId: state.currentSelectedItem.id,
        topicId: state.currentTopicId,
        agentName: state.currentSelectedItem.name,
        avatarUrl: state.currentSelectedItem.avatarUrl,
        avatarColor: state.currentSelectedItem.config?.avatarCalculatedColor || null,
        isGroupMessage: false,
    };
}

function buildSelectionContextTemporaryMessages(selectionContextRefs = []) {
    if (!Array.isArray(selectionContextRefs) || selectionContextRefs.length === 0) {
        return [];
    }

    const lines = selectionContextRefs.map((ref, index) => {
        const location = getReaderLocatorLabel(ref);
        return `[${index + 1}] ${ref.documentName || ref.documentId} | ${location}\n${ref.selectionText || ref.snippet || ''}`;
    });

    return [{
        role: 'system',
        content: [
            'Selected document excerpts for this turn:',
            ...lines,
            'Use these excerpts when they are relevant to the current user request.',
        ].join('\n\n'),
    }];
}

async function persistHistory() {
    if (!state.currentSelectedItem.id || !state.currentTopicId) return;
    await chatAPI.saveChatHistory(state.currentSelectedItem.id, state.currentTopicId, state.currentChatHistory);
}

function updateSendButtonState() {
    const interrupting = Boolean(state.activeRequestId);
    el.sendMessageBtn.dataset.mode = interrupting ? 'interrupt' : 'send';
    el.sendMessageBtn.classList.toggle('interrupt-mode', interrupting);
    el.sendMessageBtn.innerHTML = interrupting ? INTERRUPT_SEND_BUTTON_HTML : DEFAULT_SEND_BUTTON_HTML;
    el.sendMessageBtn.title = interrupting ? '中止回复' : '发送消息';
    syncComposerAvailability();
}

window.sendMessage = async (prefillText) => {
    if (typeof prefillText === 'string') {
        el.messageInput.value = prefillText;
        ui.autoResizeTextarea(el.messageInput);
    }
    return handleSend();
};

window.__liteDebugState = () => ({
    currentSelectedItemId: state.currentSelectedItem.id,
    currentTopicId: state.currentTopicId,
    activeRequestId: state.activeRequestId,
    agentCount: state.agents.length,
    topicCount: state.topics.length,
});

window.updateSendButtonState = updateSendButtonState;
window.setLiteActiveRequestId = (requestId = null) => {
    state.activeRequestId = requestId || null;
    updateSendButtonState();
};

async function handleSend() {
    if (state.activeRequestId) {
        const requestId = state.activeRequestId;
        const result = await interruptRequest(requestId);
        if (!result?.success) {
            await messageRenderer.finalizeStreamedMessage(requestId, 'error', buildTopicContext(), {
                error: result?.error || 'Interrupt failed',
            });
            ui.showToastNotification(result?.error || '中断失败', 'error');
            state.activeRequestId = null;
            updateSendButtonState();
        } else if (result.warning) {
            ui.showToastNotification(result.warning, 'warning');
        }
        return;
    }

    if (!state.currentSelectedItem.id || !state.currentTopicId) {
        ui.showToastNotification('请先选择一个智能体和话题。', 'warning');
        return;
    }

    const text = el.messageInput.value.trim();
    if (!text && state.pendingAttachments.length === 0) {
        return;
    }

    const attachments = await materializeAttachments();
    const selectionContextRefsForTurn = Array.isArray(state.pendingSelectionContextRefs)
        ? state.pendingSelectionContextRefs.map((item) => ({ ...item }))
        : [];
    const userMessage = {
        id: makeId('user'),
        role: 'user',
        content: text,
        timestamp: Date.now(),
        attachments,
        selectionContextRefs: selectionContextRefsForTurn,
    };

    state.currentChatHistory.push(userMessage);
    await persistHistory();
    await messageRenderer.renderMessage(userMessage, false, true);
    decorateChatMessages();

    el.messageInput.value = '';
    ui.autoResizeTextarea(el.messageInput);
    state.pendingAttachments = [];
    clearPendingSelectionContext();
    refreshAttachmentPreview();

    const assistantMessage = {
        id: makeId('assistant'),
        role: 'assistant',
        name: state.currentSelectedItem.name,
        agentId: state.currentSelectedItem.id,
        avatarUrl: state.currentSelectedItem.avatarUrl,
        avatarColor: state.currentSelectedItem.config?.avatarCalculatedColor || null,
        content: 'Thinking',
        timestamp: Date.now(),
        isThinking: true,
        topicId: state.currentTopicId,
    };

    const retrieval = await buildKnowledgeBaseRetrieval(userMessage);
    const selectionRefsForCitation = selectionContextRefsForTurn.map((ref) => ({
        ...ref,
        score: null,
        sourceType: 'reader-selection',
        snippet: ref.selectionText || ref.snippet || '',
    }));
    const combinedRefs = [...selectionRefsForCitation, ...retrieval.refs];
    if (combinedRefs.length > 0) {
        assistantMessage.kbContextRefs = combinedRefs;
    }

    state.currentChatHistory.push(assistantMessage);
    await persistHistory();
    messageRenderer.startStreamingMessage(assistantMessage);
    decorateChatMessages();

    const modelConfig = {
        model: state.currentSelectedItem.config?.model || 'gemini-3.1-flash-lite-preview',
        temperature: Number(state.currentSelectedItem.config?.temperature ?? 0.7),
        max_tokens: Number(state.currentSelectedItem.config?.maxOutputTokens ?? 1000),
        top_p: state.currentSelectedItem.config?.top_p,
        top_k: state.currentSelectedItem.config?.top_k,
        stream: state.currentSelectedItem.config?.streamOutput !== false,
    };

    state.activeRequestId = assistantMessage.id;
    updateSendButtonState();

    const response = await chatAPI.sendToVCP({
        requestId: assistantMessage.id,
        endpoint: state.settings.vcpServerUrl,
        apiKey: state.settings.vcpApiKey,
        messages: await buildApiMessages({
            temporarySystemMessages: [
                ...buildSelectionContextTemporaryMessages(selectionContextRefsForTurn),
                ...retrieval.temporarySystemMessages,
            ],
        }),
        modelConfig,
        context: buildTopicContext(),
    });

    if (response?.error) {
        await messageRenderer.finalizeStreamedMessage(assistantMessage.id, 'error', buildTopicContext(), {
            error: response.error,
        });
        state.activeRequestId = null;
        updateSendButtonState();
        ui.showToastNotification(`请求失败：${response.error}`, 'error');
        return;
    }

    if (!modelConfig.stream && response?.response) {
        const content = response.response?.choices?.[0]?.message?.content || '';
        const assistantEntry = state.currentChatHistory.find((item) => item.id === assistantMessage.id);
        if (assistantEntry) {
            assistantEntry.isThinking = false;
            assistantEntry.content = content;
        }
        await persistHistory();
        await messageRenderer.finalizeStreamedMessage(assistantMessage.id, 'completed', buildTopicContext(), {
            fullResponse: content,
        });
        decorateChatMessages();
        state.activeRequestId = null;
        updateSendButtonState();
    }
}
async function handleStreamEvent(eventData) {
    const {
        type,
        requestId,
        context,
        chunk,
        error,
        partialResponse,
        fullResponse,
        finishReason,
        interrupted,
        timedOut,
    } = eventData || {};
    if (!requestId) return;

    if (type === 'data') {
        messageRenderer.appendStreamChunk(requestId, chunk, context);
        return;
    }

    if (type === 'end') {
        const resolvedFinishReason = finishReason || (timedOut ? 'timed_out' : interrupted ? 'cancelled_by_user' : 'completed');
        await messageRenderer.finalizeStreamedMessage(requestId, resolvedFinishReason, context, {
            fullResponse,
            error: error || (timedOut ? 'Request timed out.' : ''),
        });
        decorateChatMessages();
        state.activeRequestId = null;
        updateSendButtonState();
        await persistHistory();
        await loadTopics();
        await loadAgents();
        return;
    }

    if (type === 'error') {
        await messageRenderer.finalizeStreamedMessage(requestId, 'error', context, {
            fullResponse: partialResponse || fullResponse,
            error,
        });
        decorateChatMessages();
        state.activeRequestId = null;
        updateSendButtonState();
        await persistHistory();
        ui.showToastNotification(error || '流式输出错误', timedOut ? 'warning' : 'error');
    }
}

function buildMarkdownExport() {
    return state.currentChatHistory.map((message) => {
        const title = message.role === 'assistant'
            ? (message.name || state.currentSelectedItem.name || 'Assistant')
            : message.role === 'user'
                ? (state.settings.userName || 'User')
                : 'System';
        const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content, null, 2);
        const attachments = Array.isArray(message.attachments) && message.attachments.length > 0
            ? `\n\nAttachments:\n${message.attachments.map((item) => `- ${item.name}: ${item.internalPath || item.src || ''}`).join('\n')}`
            : '';
        return `## ${title}\n\n${content}${attachments}`;
    }).join('\n\n---\n\n');
}

async function exportCurrentTopic() {
    if (!state.currentTopicId) return;
    const topic = state.topics.find((item) => item.id === state.currentTopicId);
    const result = await chatAPI.exportTopicAsMarkdown({
        topicName: topic?.name || state.currentTopicId,
        markdownContent: buildMarkdownExport(),
    });
    if (!result?.success) {
        ui.showToastNotification(result?.error || '导出失败', 'error');
        return;
    }
    ui.showToastNotification('话题已导出。', 'success');
}

async function createAgent() {
    const name = await ui.showPromptDialog({
        title: '新建学科入口',
        message: '创建一个新的学科入口，并为它配置专属的提示词风格。',
        placeholder: '例如：语文 / 数学 / 英语',
        confirmText: '创建',
        cancelText: '取消',
    });
    if (!name) return;
    const result = await chatAPI.createAgent(name.trim(), null);
    if (result?.error) {
        ui.showToastNotification(result.error, 'error');
        return;
    }
    await loadAgents();
    await selectAgent(result.agentId);
}

async function createTopic() {
    if (!state.currentSelectedItem.id) {
        ui.showToastNotification('请先选择一个智能体。', 'warning');
        return;
    }
    const name = await ui.showPromptDialog({
        title: '新建话题',
        message: `为 ${state.currentSelectedItem.name || state.currentSelectedItem.id} 创建一个新的学习主题。`,
        placeholder: '话题名称',
        defaultValue: '新建学习话题',
        confirmText: '创建',
        cancelText: '取消',
    });
    if (!name) return;
    const result = await chatAPI.createNewTopicForAgent(state.currentSelectedItem.id, name || '', false, true);
    if (result?.error) {
        ui.showToastNotification(result.error, 'error');
        return;
    }
    await loadTopics();
    await selectTopic(result.topicId);
}

async function deleteCurrentAgent() {
    if (!state.currentSelectedItem.id) return;
    const confirmed = await ui.showConfirmDialog(
        `确定删除智能体 ${state.currentSelectedItem.name || state.currentSelectedItem.id} 吗？`,
        '删除智能体',
        '删除',
        '取消',
        true
    );
    if (!confirmed) return;
    const result = await chatAPI.deleteAgent(state.currentSelectedItem.id);
    if (result?.error) {
        ui.showToastNotification(result.error, 'error');
        return;
    }
    state.currentSelectedItem = { id: null, type: 'agent', name: null, avatarUrl: null, config: null };
    state.currentTopicId = null;
    state.currentChatHistory = [];
    state.topicNotes = [];
    state.agentNotes = [];
    state.selectedNoteIds = [];
    state.pendingAttachments = [];
    syncWorkspaceContext();
    setPromptVisible(false);
    await loadAgents();
    renderTopics();
    syncCurrentTopicKnowledgeBaseControls();
    refreshAttachmentPreview();
    renderNotesPanel();
    await renderCurrentHistory();
    syncComposerAvailability();
}

async function createKnowledgeBase() {
    const name = el.knowledgeBaseNameInput.value.trim();
    if (!name) {
        ui.showToastNotification('请输入 Source 名称。', 'warning');
        return;
    }

    const result = await chatAPI.createKnowledgeBase({ name });
    if (!result?.success) {
        ui.showToastNotification(`创建 Source 失败：${result?.error || '未知错误'}`, 'error');
        return;
    }

    state.selectedKnowledgeBaseId = result.item?.id || null;
    await loadKnowledgeBases({ silent: true });
}

async function renameKnowledgeBase() {
    if (!state.selectedKnowledgeBaseId) {
        return;
    }

    const name = el.knowledgeBaseNameInput.value.trim();
    if (!name) {
        ui.showToastNotification('请输入新的 Source 名称。', 'warning');
        return;
    }

    const result = await chatAPI.updateKnowledgeBase(state.selectedKnowledgeBaseId, { name });
    if (!result?.success) {
        ui.showToastNotification(`重命名 Source 失败：${result?.error || '未知错误'}`, 'error');
        return;
    }

    await loadKnowledgeBases({ silent: true });
}

async function deleteKnowledgeBase() {
    if (!state.selectedKnowledgeBaseId) {
        return;
    }

    const currentKb = state.knowledgeBases.find((item) => item.id === state.selectedKnowledgeBaseId);
    const confirmed = await ui.showConfirmDialog(
        `确定删除 Source ${currentKb?.name || state.selectedKnowledgeBaseId} 吗？`,
        '删除 Source',
        '删除',
        '取消',
        true
    );
    if (!confirmed) {
        return;
    }

    const result = await chatAPI.deleteKnowledgeBase(state.selectedKnowledgeBaseId);
    if (!result?.success) {
        ui.showToastNotification(`删除 Source 失败：${result?.error || '未知错误'}`, 'error');
        return;
    }

    state.selectedKnowledgeBaseId = null;
    await loadKnowledgeBases({ silent: true });
    await loadTopics();
}

async function importKnowledgeBaseFilesFromInput(files) {
    await importKnowledgeBaseFilesForKb(state.selectedKnowledgeBaseId, files, { toastSuccess: false });
}

async function handleTopicKnowledgeBaseChange(nextValue = null) {
    if (!state.currentSelectedItem.id || !state.currentTopicId) {
        return;
    }

    const selectedValue = nextValue ?? el.currentTopicKnowledgeBaseSelect?.value ?? el.sourcePanelKnowledgeBaseSelect?.value ?? '';
    const kbId = selectedValue || null;
    const result = await chatAPI.setTopicKnowledgeBase(state.currentSelectedItem.id, state.currentTopicId, kbId);
    if (!result?.success) {
        ui.showToastNotification(`绑定 Source 失败：${result?.error || '未知错误'}`, 'error');
        syncCurrentTopicKnowledgeBaseControls();
        return;
    }

    state.topics = state.topics.map((topic) => (
        topic.id === state.currentTopicId
            ? { ...topic, knowledgeBaseId: kbId }
            : topic
    ));
    renderTopics();
    syncCurrentTopicKnowledgeBaseControls();
    await loadCurrentTopicKnowledgeBaseDocuments({ silent: true, reuseSelected: false });
}

async function runKnowledgeBaseSearch() {
    if (!state.selectedKnowledgeBaseId) {
        ui.showToastNotification('请先选择一个 Source。', 'warning');
        return;
    }

    const query = el.knowledgeBaseDebugQueryInput?.value.trim();
    if (!query) {
        ui.showToastNotification('请输入要搜索的 query。', 'warning');
        return;
    }

    const result = await chatAPI.searchKnowledgeBase({
        kbId: state.selectedKnowledgeBaseId,
        query,
    });

    if (!result?.success) {
        ui.showToastNotification(`Source 搜索失败：${result?.error || '未知错误'}`, 'error');
        return;
    }

    state.knowledgeBaseDebugResult = {
        mode: 'search',
        query,
        items: Array.isArray(result.items) ? result.items : [],
        rerankApplied: result.rerankApplied === true,
        rerankFallbackReason: result.rerankFallbackReason || null,
    };
    renderKnowledgeBaseDebugResults();
}

async function runKnowledgeBaseDebug() {
    if (!state.selectedKnowledgeBaseId) {
        ui.showToastNotification('请先选择一个 Source。', 'warning');
        return;
    }

    const query = el.knowledgeBaseDebugQueryInput?.value.trim();
    if (!query) {
        ui.showToastNotification('请输入要调试的 query。', 'warning');
        return;
    }

    const result = await chatAPI.getKnowledgeBaseRetrievalDebug({
        kbId: state.selectedKnowledgeBaseId,
        query,
    });

    if (!result?.success) {
        ui.showToastNotification(`Source 调试失败：${result?.error || '未知错误'}`, 'error');
        return;
    }

    state.knowledgeBaseDebugResult = {
        mode: 'debug',
        ...result,
    };
    renderKnowledgeBaseDebugResults();
}

function wireEvents() {
    el.leftResizeHandle?.addEventListener('pointerdown', (event) => beginLayoutResize('left', event));
    el.rightResizeHandle?.addEventListener('pointerdown', (event) => beginLayoutResize('right', event));
    el.workspaceVerticalResizeHandle?.addEventListener('pointerdown', beginVerticalLayoutResize);
    window.addEventListener('pointermove', updateLayoutResize);
    window.addEventListener('pointermove', updateVerticalLayoutResize);
    window.addEventListener('pointerup', endLayoutResize);
    window.addEventListener('pointerup', endVerticalLayoutResize);
    window.addEventListener('pointercancel', endLayoutResize);
    window.addEventListener('pointercancel', endVerticalLayoutResize);
    window.addEventListener('resize', scheduleLayoutRefresh);
    window.addEventListener('resize', () => {
        hideSourceFileTooltip();
        closeSourceFileActionMenu();
        closeTopicActionMenu();
    });
    document.addEventListener('click', (event) => {
        const target = event.target;
        if (state.activeSourceFileMenu) {
            if (target instanceof Element && (target.closest('#sourceFileActionMenu') || target.closest('[data-doc-menu-button]'))) {
                return;
            }
            closeSourceFileActionMenu();
        }
        if (state.activeTopicMenu) {
            if (target instanceof Element && (target.closest('#topicActionMenu') || target.closest('[data-topic-menu-button]'))) {
                return;
            }
            closeTopicActionMenu();
        }
        if (state.activeNoteMenu) {
            if (target instanceof Element && (target.closest('#noteActionMenu') || target.closest('[data-note-menu]'))) {
                return;
            }
            closeNoteActionMenu();
        }
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            if (state.activeNoteMenu) {
                closeNoteActionMenu();
            }
            if (el.noteDetailModal && !el.noteDetailModal.classList.contains('hidden')) {
                closeNoteDetail();
            }
            if (el.settingsModal && !el.settingsModal.classList.contains('hidden')) {
                closeSettingsModal();
            }
            hideSourceFileTooltip();
            closeSourceFileActionMenu();
            closeTopicActionMenu();
        }
    });
    el.topicList?.addEventListener('scroll', () => {
        closeTopicActionMenu();
    });
    el.topicKnowledgeBaseFiles?.addEventListener('scroll', () => {
        state.sourceListScrollTop = el.topicKnowledgeBaseFiles.scrollTop;
        hideSourceFileTooltip();
        closeSourceFileActionMenu();
    });
    el.notesList?.addEventListener('scroll', () => {
        closeNoteActionMenu();
    });
    el.agentSearchInput.addEventListener('input', filterAgents);
    el.topicSearchInput.addEventListener('input', filterTopics);
    el.createNewAgentBtn.addEventListener('click', createAgent);
    el.quickNewTopicBtn.addEventListener('click', createTopic);
    el.composerQuickNewTopicBtn.addEventListener('click', createTopic);
    el.exportTopicBtn.addEventListener('click', exportCurrentTopic);
    el.currentAgentSettingsBtn.addEventListener('click', () => {
        openSettingsModal('agent', el.currentAgentSettingsBtn);
    });
    el.globalSettingsBtn.addEventListener('click', () => {
        openSettingsModal('global', el.globalSettingsBtn);
    });
    el.settingsModalCloseBtn?.addEventListener('click', closeSettingsModal);
    el.settingsModalBackdrop?.addEventListener('click', closeSettingsModal);
    el.settingsNavButtons?.forEach((button) => {
        button.addEventListener('click', () => {
            switchSettingsModalSection(button.dataset.settingsSectionButton || 'global');
        });
    });
    el.workspaceReaderBackBtn?.addEventListener('click', () => {
        setLeftSidebarMode('source-list');
        setLeftReaderTab('guide');
        renderTopicKnowledgeBaseFiles();
    });
    el.leftReaderGuideTabBtn?.addEventListener('click', () => setLeftReaderTab('guide'));
    el.leftReaderContentTabBtn?.addEventListener('click', () => setLeftReaderTab('content'));
    el.refreshReaderGuideBtn?.addEventListener('click', () => {
        if (!state.reader.documentId) {
            return;
        }
        void ensureReaderGuide(state.reader.documentId, { forceRefresh: true });
    });
    el.saveGlobalSettingsBtn.addEventListener('click', saveGlobalSettings);
    el.saveAgentSettingsBtn.addEventListener('click', saveAgentSettings);
    el.deleteAgentBtn.addEventListener('click', deleteCurrentAgent);
    el.createKnowledgeBaseBtn?.addEventListener('click', createKnowledgeBase);
    el.renameKnowledgeBaseBtn?.addEventListener('click', renameKnowledgeBase);
    el.deleteKnowledgeBaseBtn?.addEventListener('click', deleteKnowledgeBase);
    el.importKnowledgeBaseFilesBtn?.addEventListener('click', () => el.hiddenKnowledgeBaseFileInput?.click());
    el.hiddenKnowledgeBaseFileInput?.addEventListener('change', async () => {
        await importKnowledgeBaseFilesFromInput(el.hiddenKnowledgeBaseFileInput.files);
        el.hiddenKnowledgeBaseFileInput.value = '';
    });
    el.openKnowledgeBaseManagerBtn?.addEventListener('click', () => {
        void openKnowledgeBaseManager();
    });
    el.importTopicKnowledgeBaseFilesBtn?.addEventListener('click', async () => {
        const kbId = getCurrentTopicKnowledgeBaseId() || await ensureTopicSource({ silent: true });
        if (!kbId) {
            return;
        }
        el.hiddenTopicKnowledgeBaseFileInput?.click();
    });
    el.hiddenTopicKnowledgeBaseFileInput?.addEventListener('change', async () => {
        const kbId = getCurrentTopicKnowledgeBaseId() || await ensureTopicSource({ silent: true });
        if (kbId) {
            await importKnowledgeBaseFilesForKb(kbId, el.hiddenTopicKnowledgeBaseFileInput.files);
        }
        el.hiddenTopicKnowledgeBaseFileInput.value = '';
    });
    el.currentTopicKnowledgeBaseSelect?.addEventListener('change', () => {
        const value = el.currentTopicKnowledgeBaseSelect.value || '';
        if (el.sourcePanelKnowledgeBaseSelect) {
            el.sourcePanelKnowledgeBaseSelect.value = value;
        }
        void handleTopicKnowledgeBaseChange(value || null);
    });
    el.sourcePanelKnowledgeBaseSelect?.addEventListener('change', () => {
        const value = el.sourcePanelKnowledgeBaseSelect.value || '';
        if (el.currentTopicKnowledgeBaseSelect) {
            el.currentTopicKnowledgeBaseSelect.value = value;
        }
        void handleTopicKnowledgeBaseChange(value || null);
    });
    el.runKnowledgeBaseSearchBtn?.addEventListener('click', runKnowledgeBaseSearch);
    el.runKnowledgeBaseDebugBtn?.addEventListener('click', runKnowledgeBaseDebug);
    el.knowledgeBaseDebugQueryInput?.addEventListener('keydown', async (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            if (event.ctrlKey || event.metaKey) {
                await runKnowledgeBaseDebug();
                return;
            }
            await runKnowledgeBaseSearch();
        }
    });

    el.attachFileBtn.addEventListener('click', async () => {
        await addFilesToComposer([], 'picker');
    });

    el.messageInput.addEventListener('keydown', async (event) => {
        if (event.defaultPrevented || event.isComposing) {
            return;
        }
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            await handleSend();
        }
    });
    el.sendMessageBtn.addEventListener('click', handleSend);
    el.emoticonTriggerBtn.addEventListener('click', () => {
        if (el.emoticonTriggerBtn.disabled || !window.emoticonManager) return;
        window.emoticonManager.togglePanel(el.emoticonTriggerBtn, el.messageInput);
    });
    el.agentAvatarInput.addEventListener('change', () => {
        const file = el.agentAvatarInput.files?.[0];
        if (!file) return;
        el.agentAvatarPreview.src = file.path ? `file://${file.path.replace(/\\/g, '/')}` : URL.createObjectURL(file);
    });

    document.querySelectorAll('input[name="themeMode"]').forEach((input) => {
        input.addEventListener('change', () => {
            if (input.checked) {
                chatAPI.setThemeMode(input.value);
            }
        });
    });

    el.themeToggleBtn.addEventListener('click', () => {
        const nextTheme = document.body.classList.contains('dark-theme') ? 'light' : 'dark';
        chatAPI.setTheme(nextTheme);
    });

    el.topicNotesScopeBtn?.addEventListener('click', () => {
        state.notesScope = 'topic';
        state.selectedNoteIds = [];
        renderNotesPanel();
    });
    el.agentNotesScopeBtn?.addEventListener('click', () => {
        state.notesScope = 'agent';
        state.selectedNoteIds = [];
        renderNotesPanel();
    });
    el.newNoteBtn?.addEventListener('click', createBlankNote);
    el.newNoteFabBtn?.addEventListener('click', createBlankNote);
    el.notesStudioOpenBtn?.addEventListener('click', () => {
        const note = getCurrentDetailNote();
        if (note) {
            openNoteDetail(note, { trigger: el.notesStudioOpenBtn });
        } else {
            openNoteDetail(null, { kind: 'note', trigger: el.notesStudioOpenBtn });
        }
    });
    el.saveNoteBtn?.addEventListener('click', () => { void saveActiveNote(); });
    el.deleteNoteBtn?.addEventListener('click', () => { void deleteActiveNote(); });
    el.analyzeNotesBtn?.addEventListener('click', () => { void runNotesTool('analysis'); });
    el.generateQuizBtn?.addEventListener('click', () => { void runNotesTool('quiz'); });
    el.generateFlashcardsBtn?.addEventListener('click', () => { void runNotesTool('flashcards'); });
    el.flashcardsBackToNotesBtn?.addEventListener('click', returnToNotesPanel);
    el.noteDetailCloseBtn?.addEventListener('click', closeNoteDetail);
    el.noteDetailModalBackdrop?.addEventListener('click', closeNoteDetail);
    el.flashcardCardButton?.addEventListener('click', () => {
        if (getPendingFlashcardGeneration()) {
            return;
        }
        void updateFlashcardProgress((progress) => ({
            ...progress,
            flipped: !progress.flipped,
        }));
    });
    el.flashcardsPrevBtn?.addEventListener('click', () => { void navigateFlashcards(-1); });
    el.flashcardsNextBtn?.addEventListener('click', () => { void navigateFlashcards(1); });
    el.flashcardsMarkUnknownBtn?.addEventListener('click', () => { void setFlashcardResult('unknown'); });
    el.flashcardsMarkKnownBtn?.addEventListener('click', () => { void setFlashcardResult('known'); });

    el.minimizeBtn.addEventListener('click', () => chatAPI.minimizeWindow());
    el.maximizeBtn.addEventListener('click', () => chatAPI.maximizeWindow());
    el.closeBtn.addEventListener('click', () => chatAPI.closeWindow());
    el.readerPrevBtn?.addEventListener('click', () => navigateReader(-1));
    el.readerNextBtn?.addEventListener('click', () => navigateReader(1));
    el.clearReaderSelectionBtn?.addEventListener('click', () => {
        state.reader.pendingSelection = null;
        renderReaderPanel();
    });
    el.injectReaderSelectionBtn?.addEventListener('click', injectReaderSelectionIntoComposer);
    el.readerContent?.addEventListener('mouseup', () => {
        requestAnimationFrame(() => {
            syncReaderSelectionFromDom();
        });
    });
    document.addEventListener('unistudy-open-kb-ref', (event) => {
        void openReaderFromRef(event.detail || {});
    });
}

function initMessageRenderer() {
    initMarked();
    initializeInterruptHandler(chatAPI);

    messageRenderer.initializeMessageRenderer({
        currentSelectedItemRef: {
            get: () => state.currentSelectedItem,
            set: (value) => {
                state.currentSelectedItem = value;
            },
        },
        currentTopicIdRef: {
            get: () => state.currentTopicId,
            set: (value) => {
                state.currentTopicId = value;
            },
        },
        currentChatHistoryRef: {
            get: () => state.currentChatHistory,
            set: (value) => {
                state.currentChatHistory = value;
            },
        },
        globalSettingsRef: {
            get: () => state.settings,
            set: (value) => {
                state.settings = value;
            },
        },
        chatMessagesDiv: el.chatMessages,
        electronAPI: chatAPI,
        markedInstance,
        uiHelper: ui,
        interruptHandler: { interrupt: interruptRequest },
        summarizeTopicFromMessages: async () => null,
    });
}

async function initInputFeatures() {
    if (window.emoticonManager?.initialize) {
        await window.emoticonManager.initialize({
            emoticonPanel: el.emoticonPanel,
            messageInput: el.messageInput,
        });
    }

    initializeInputEnhancer({
        messageInput: el.messageInput,
        dropTargetElement: el.chatInputCard,
        electronAPI: chatAPI,
        electronPath: window.electronPath,
        autoResizeTextarea: ui.autoResizeTextarea,
        appendAttachments: appendStoredAttachments,
        getCurrentAgentId: () => state.currentSelectedItem.id,
        getCurrentTopicId: () => state.currentTopicId,
        showToast: (message, type = 'info', duration = 3000) => ui.showToastNotification(message, type, duration),
    });
}

async function bootstrap() {
    const bridgeDiagnostics = {
        chatAPI: Boolean(window.chatAPI),
        electronAPI: Boolean(window.electronAPI),
        electronPath: Boolean(window.electronPath),
    };

    if (!bridgeDiagnostics.chatAPI || !bridgeDiagnostics.electronAPI || !bridgeDiagnostics.electronPath) {
        throw new Error(`Preload bridge missing: ${JSON.stringify(bridgeDiagnostics)}`);
    }

    syncWorkspaceContext();
    setLeftSidebarMode('source-list');
    setLeftReaderTab('guide');
    setRightPanelMode('notes');
    renderReaderPanel();
    renderSelectionContextPreview();
    initMessageRenderer();
    await initInputFeatures();
    await loadSettings();
    initializeResizableLayout();
    await loadKnowledgeBases({ silent: true });

    const theme = await chatAPI.getCurrentTheme().catch(() => 'light');
    applyTheme(theme || 'light');

    chatAPI.onThemeUpdated((nextTheme) => applyTheme(nextTheme));
    chatAPI.onVCPStreamEvent(handleStreamEvent);
    chatAPI.onHistoryFileUpdated(async (payload) => {
        if (payload?.agentId === state.currentSelectedItem.id && payload?.topicId === state.currentTopicId) {
            await selectTopic(state.currentTopicId, { fromWatcher: true });
        }
    });

    wireEvents();
    await loadAgents();

    if (state.agents.length === 0) {
        const createResult = await chatAPI.createAgent("我的学习", null);
        if (createResult && createResult.agentId) {
            await loadAgents();
        }
    }

    const lastOpenItemId = state.settings.lastOpenItemId;
    if (lastOpenItemId && state.agents.some((agent) => agent.id === lastOpenItemId)) {
        await selectAgent(lastOpenItemId);
        if (state.settings.lastOpenTopicId) {
            await selectTopic(state.settings.lastOpenTopicId);
        }
    } else if (state.agents.length > 0) {
        await selectAgent(state.agents[0].id);
    } else {
        setPromptVisible(false);
        renderNotesPanel();
        await renderCurrentHistory();
    }

    ui.autoResizeTextarea(el.messageInput);
    updateSendButtonState();
}

bootstrap().catch((error) => {
    console.error('[LiteRenderer] bootstrap failed:', error);
    ui?.showToastNotification?.(error.message || 'Bootstrap failed', 'error', 5000);
});
