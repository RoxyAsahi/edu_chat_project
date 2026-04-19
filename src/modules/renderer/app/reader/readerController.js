import {
    buildReaderSelectionPayload,
    createInitialReaderState,
    getReaderLocatorLabel,
    getReaderNavigationTarget,
    resolveReaderInitialLocation,
    shouldRefreshReaderGuide,
} from './readerUtils.js';

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function isMarkdownReaderDocument(reader = {}) {
    const name = String(reader.documentName || '').toLowerCase();
    const contentType = String(reader.contentType || '').toLowerCase();
    return name.endsWith('.md')
        || name.endsWith('.markdown')
        || contentType.includes('markdown')
        || contentType === 'text/markdown';
}

function renderReaderMarkdown(markdown, renderMarkdownToSafeHtml, getMarkedInstance) {
    return renderMarkdownToSafeHtml(
        markdown,
        getMarkedInstance() || {
            parse(value) {
                return `<pre>${escapeHtml(value)}</pre>`;
            },
        },
    );
}

function enhanceReaderRenderedContent(container, windowObj) {
    if (!container || !windowObj?.renderMathInElement) {
        return;
    }

    try {
        windowObj.renderMathInElement(container, {
            delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: '$', right: '$', display: false },
                { left: '\\(', right: '\\)', display: false },
                { left: '\\[', right: '\\]', display: true },
            ],
            throwOnError: false,
        });
    } catch (error) {
        console.error('Reader math rendering error:', error);
    }
}

function createReaderController(deps = {}) {
    const store = deps.store;
    const el = deps.el;
    const chatAPI = deps.chatAPI;
    const ui = deps.ui;
    const windowObj = deps.windowObj || window;
    const documentObj = deps.documentObj || document;
    const renderMarkdownToSafeHtml = deps.renderMarkdownToSafeHtml || ((value) => value);
    const getMarkedInstance = deps.getMarkedInstance || (() => null);
    const setLeftSidebarMode = deps.setLeftSidebarMode || (() => {});
    const setLeftReaderTab = deps.setLeftReaderTab || (() => {});
    const renderTopicKnowledgeBaseFiles = deps.renderTopicKnowledgeBaseFiles || (() => {});
    const syncKnowledgeBasePolling = deps.syncKnowledgeBasePolling || (() => {});
    const hideSourceFileTooltip = deps.hideSourceFileTooltip || (() => {});
    const onInjectSelection = deps.onInjectSelection || (() => {});
    const patchDocumentGuideStateInSource = deps.patchDocumentGuideStateInSource || (() => {});
    const getLeftReaderActiveTab = deps.getLeftReaderActiveTab || (() => store.getState().layout.leftReaderActiveTab);

    const scheduleFrame = typeof windowObj.requestAnimationFrame === 'function'
        ? windowObj.requestAnimationFrame.bind(windowObj)
        : (callback) => setTimeout(callback, 0);
    const selectionApi = typeof windowObj.getSelection === 'function'
        ? windowObj.getSelection.bind(windowObj)
        : () => null;
    const NodeCtor = windowObj.Node || globalThis.Node;

    function getReaderSlice() {
        return store.getState().reader;
    }

    function patchReader(patch) {
        return store.patchState('reader', (current, rootState) => ({
            ...current,
            ...(typeof patch === 'function' ? patch(current, rootState) : patch),
        }));
    }

    const readerProxy = new Proxy({}, {
        get(_target, prop) {
            return getReaderSlice()[prop];
        },
        set(_target, prop, value) {
            patchReader({
                [prop]: value,
            });
            return true;
        },
        ownKeys() {
            return Reflect.ownKeys(getReaderSlice());
        },
        getOwnPropertyDescriptor(_target, prop) {
            return {
                configurable: true,
                enumerable: true,
                writable: true,
                value: getReaderSlice()[prop],
            };
        },
    });

    const state = {};
    Object.defineProperties(state, {
        reader: {
            get: () => readerProxy,
            set: (value) => patchReader(value),
        },
        leftReaderActiveTab: {
            get: () => getLeftReaderActiveTab(),
        },
    });

    function resetReaderState() {
        state.reader = createInitialReaderState();
    }

    function clearPendingSelection() {
        state.reader.pendingSelection = null;
        renderReaderPanel();
    }

    function patchDocumentGuideState(documentId, patch = {}) {
        patchDocumentGuideStateInSource(documentId, patch);
    }

    function mergeActiveDocumentIntoReader(documentItem = {}) {
        if (!documentItem || documentItem.id !== state.reader.documentId) {
            return false;
        }

        state.reader = {
            ...state.reader,
            status: documentItem.status || state.reader.status,
            isIndexed: documentItem.status === 'done',
            contentType: documentItem.contentType || state.reader.contentType,
            guideStatus: documentItem.guideStatus || state.reader.guideStatus || 'idle',
            guideMarkdown: documentItem.guideMarkdown || '',
            guideGeneratedAt: documentItem.guideGeneratedAt || null,
            guideError: documentItem.guideError || null,
        };
        return true;
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
            el.readerSelectionBar.classList.add('hidden');
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
                <div class="reader-guide-content__title">来源指南</div>
                <div class="empty-list-state">
                    <strong>来源指南会显示在这里</strong>
                    <span>从左侧“学习来源”打开资料后，系统会先生成一份学习导向的阅读指南。</span>
                </div>
            `;
        } else if (reader.guideStatus === 'processing' || reader.guideStatus === 'pending') {
            el.readerGuideContent.innerHTML = `
                <div class="reader-guide-content__title">来源指南</div>
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
                <div class="reader-guide-content__title">来源指南</div>
                <div class="empty-list-state reader-guide-empty">
                    <strong>来源指南生成失败</strong>
                    <span>${escapeHtml(reader.guideError || '暂时无法生成来源指南。')}</span>
                </div>
            `;
        } else if (reader.guideMarkdown) {
            const sanitized = renderReaderMarkdown(reader.guideMarkdown, renderMarkdownToSafeHtml, getMarkedInstance);
            el.readerGuideContent.innerHTML = `
                <div class="reader-guide-content__title">来源指南</div>
                <article class="reader-guide-card">
                    ${sanitized}
                </article>
            `;
            enhanceReaderRenderedContent(el.readerGuideContent, windowObj);
        } else {
            el.readerGuideContent.innerHTML = `
                <div class="reader-guide-content__title">来源指南</div>
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
        const treatAsMarkdown = isMarkdownReaderDocument(reader);

        if (treatAsMarkdown) {
            const markdownSource = paragraphs
                .map((paragraph) => String(paragraph.text || ''))
                .join('\n\n')
                .trim();
            const renderedMarkdown = renderReaderMarkdown(markdownSource, renderMarkdownToSafeHtml, getMarkedInstance);
            el.readerContent.className = 'reader-content reader-content--markdown';
            el.readerContent.innerHTML = `
                <article class="reader-markdown-doc">
                    ${renderedMarkdown}
                </article>
            `;
            enhanceReaderRenderedContent(el.readerContent, windowObj);
            return;
        }

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
                    <strong>${escapeHtml(group.sectionTitle)}</strong>
                    <span>${group.paragraphs.length} 段</span>
                </header>
                <div class="reader-docx-block__content">
                    ${group.paragraphs.map((paragraph) => `
                        <p class="reader-paragraph ${Number(paragraph.index) === Number(reader.activeParagraphIndex) ? 'reader-paragraph--active' : ''}" data-reader-paragraph-index="${paragraph.index}" data-reader-section-title="${escapeHtml(group.sectionTitle)}">${escapeHtml(paragraph.text || '')}</p>
                    `).join('')}
                </div>
            </article>
        `).join('');
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

    function getSelectionAnchorElement(range) {
        const anchorNode = range.commonAncestorContainer?.nodeType === NodeCtor?.TEXT_NODE
            ? range.commonAncestorContainer.parentElement
            : range.commonAncestorContainer;
        return anchorNode?.closest?.('[data-reader-page], [data-reader-paragraph-index]') || null;
    }

    function syncReaderSelectionFromDom() {
        if (!el.readerContent) {
            return;
        }

        const selection = selectionApi();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
            clearPendingSelection();
            return;
        }

        const range = selection.getRangeAt(0);
        const target = getSelectionAnchorElement(range);
        if (!target || !el.readerContent.contains(target)) {
            clearPendingSelection();
            return;
        }

        const nextSelection = buildReaderSelectionPayload(state.reader, {
            selectionText: selection.toString(),
            pageNumber: target.dataset.readerPage || target.closest('[data-reader-page]')?.dataset.readerPage || null,
            paragraphIndex: target.dataset.readerParagraphIndex || null,
            sectionTitle: target.dataset.readerSectionTitle || target.closest('[data-reader-section-title]')?.dataset.readerSectionTitle || null,
        });

        state.reader.pendingSelection = nextSelection;
        renderReaderPanel();
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
            if (state.reader.documentId === documentId) {
                state.reader = {
                    ...state.reader,
                    guideStatus: current.guideStatus || 'idle',
                    guideMarkdown: current.guideMarkdown || '',
                    guideGeneratedAt: current.guideGeneratedAt || null,
                    guideError: current.guideError || null,
                };
                renderReaderPanel();
            }
        }

        if (!shouldRefreshReaderGuide(current, options)) {
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
            state.reader = {
                ...state.reader,
                guideStatus: result.guideStatus || 'processing',
                guideMarkdown: result.guideMarkdown || '',
                guideGeneratedAt: result.guideGeneratedAt || null,
                guideError: result.guideError || null,
            };
            renderReaderPanel();
        } else if (!result?.success && state.reader.documentId === documentId) {
            patchDocumentGuideState(documentId, {
                guideStatus: 'failed',
                guideError: result?.error || '来源指南生成失败。',
            });
            state.reader = {
                ...state.reader,
                guideStatus: 'failed',
                guideError: result?.error || '来源指南生成失败。',
            };
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
        const initialLocation = resolveReaderInitialLocation({ locator, view });

        state.reader = {
            ...createInitialReaderState(),
            documentId,
            documentName: documentItem.name || '未命名文档',
            contentType: documentItem.contentType || view.contentType || null,
            status: documentItem.status || 'done',
            isIndexed: documentItem.isIndexed === true,
            view,
            activePageNumber: initialLocation.activePageNumber,
            activeParagraphIndex: initialLocation.activeParagraphIndex,
            activeSectionTitle: initialLocation.activeSectionTitle,
            guideStatus: documentItem.guideStatus || 'idle',
            guideMarkdown: documentItem.guideMarkdown || '',
            guideGeneratedAt: documentItem.guideGeneratedAt || null,
            guideError: documentItem.guideError || null,
        };

        setLeftSidebarMode('reader');
        setLeftReaderTab(initialLocation.preferredTab);
        renderReaderPanel();
        renderTopicKnowledgeBaseFiles();
        scheduleFrame(() => {
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

        onInjectSelection({
            ...selection,
            sourceType: 'reader-selection',
        });
        ui.showToastNotification('已将当前选段注入本轮对话上下文。', 'success');
    }

    function navigateReader(step) {
        const nextTarget = getReaderNavigationTarget(state.reader, step);
        if (!nextTarget) {
            return;
        }

        if (state.reader.view?.type === 'pdf') {
            state.reader.activePageNumber = nextTarget.pageNumber;
            state.reader.activeParagraphIndex = nextTarget.paragraphIndex ?? state.reader.activeParagraphIndex;
            scrollReaderToLocator({ pageNumber: nextTarget.pageNumber });
            return;
        }

        state.reader.activeParagraphIndex = nextTarget.paragraphIndex;
        state.reader.activeSectionTitle = nextTarget.sectionTitle || null;
        scrollReaderToLocator({
            paragraphIndex: nextTarget.paragraphIndex,
            sectionTitle: nextTarget.sectionTitle || null,
        });
    }

    function syncFromSourceDocuments(documents = [], options = {}) {
        const activeDocument = Array.isArray(documents)
            ? documents.find((item) => item.id === state.reader.documentId) || null
            : null;

        if (activeDocument) {
            mergeActiveDocumentIntoReader(activeDocument);
            renderReaderPanel();
            return;
        }

        if (options.resetIfMissing !== false && state.reader.documentId) {
            resetReaderState();
            setLeftSidebarMode('source-list');
            setLeftReaderTab('guide');
            renderReaderPanel();
        }
    }

    function isDocumentActive(documentId) {
        return Boolean(documentId) && documentId === state.reader.documentId;
    }

    function hasPendingSelection() {
        return Boolean(state.reader.pendingSelection);
    }

    function bindEvents() {
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
        el.readerPrevBtn?.addEventListener('click', () => navigateReader(-1));
        el.readerNextBtn?.addEventListener('click', () => navigateReader(1));
        el.clearReaderSelectionBtn?.addEventListener('click', clearPendingSelection);
        el.injectReaderSelectionBtn?.addEventListener('click', injectReaderSelectionIntoComposer);
        el.readerContent?.addEventListener('mouseup', () => {
            scheduleFrame(() => {
                syncReaderSelectionFromDom();
            });
        });
        documentObj.addEventListener('unistudy-open-kb-ref', (event) => {
            void openReaderFromRef(event.detail || {});
        });
    }

    return {
        bindEvents,
        ensureReaderGuide,
        hasPendingSelection,
        isDocumentActive,
        navigateReader,
        openReaderDocument,
        openReaderFromRef,
        renderReaderPanel,
        resetReaderState,
        syncFromSourceDocuments,
        syncReaderSelectionFromDom,
    };
}

export {
    createReaderController,
};
