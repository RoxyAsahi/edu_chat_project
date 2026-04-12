import { positionFloatingElement } from '../dom/positionFloatingElement.js';
import { isReaderSupportedDocument } from '../reader/readerUtils.js';
import { createStoreView } from '../store/storeView.js';

const TOPIC_SOURCE_FILE_LIMIT = 50;

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildTopicSourceName({ topic = null, agentName = '' } = {}) {
    const topicLabel = String(topic?.name || topic?.id || '未命名话题').trim();
    const agentLabel = String(agentName || '当前学科').trim();
    return `${agentLabel} · ${topicLabel}`;
}

function formatDocumentStatus(documentItem = {}) {
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
        return { icon: 'picture_as_pdf', tone: 'pdf' };
    }

    if (
        contentType === 'docx-text'
        || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        || name.endsWith('.docx')
        || name.endsWith('.doc')
    ) {
        return { icon: 'description', tone: 'doc' };
    }

    if (contentType === 'markdown' || name.endsWith('.md')) {
        return { icon: 'article', tone: 'text' };
    }

    if (
        contentType === 'plain'
        || contentType === 'html'
        || mimeType.startsWith('text/')
        || name.endsWith('.txt')
        || name.endsWith('.html')
        || name.endsWith('.htm')
    ) {
        return { icon: 'article', tone: 'text' };
    }

    return { icon: 'draft', tone: 'neutral' };
}

function canReuseSelectedKnowledgeBaseDocuments({
    topicKnowledgeBaseId = null,
    selectedKnowledgeBaseId = null,
    reuseSelected = true,
} = {}) {
    return reuseSelected !== false
        && Boolean(topicKnowledgeBaseId)
        && topicKnowledgeBaseId === selectedKnowledgeBaseId;
}

function shouldPollKnowledgeBaseItems({
    knowledgeBaseDocuments = [],
    topicKnowledgeBaseDocuments = [],
} = {}) {
    return [...knowledgeBaseDocuments, ...topicKnowledgeBaseDocuments]
        .some((item) => (
            item.status === 'pending'
            || item.status === 'processing'
            || item.guideStatus === 'pending'
            || item.guideStatus === 'processing'
        ));
}

function createSourceController(deps = {}) {
    const store = deps.store;
    const state = createStoreView(store, {
        writableSlices: ['source'],
    });
    const el = deps.el;
    const chatAPI = deps.chatAPI;
    const ui = deps.ui;
    const windowObj = deps.windowObj || window;
    const documentObj = deps.documentObj || document;
    const renderTopics = deps.renderTopics || (() => {});
    const openSettingsModal = deps.openSettingsModal || (() => {});
    const closeTopicActionMenu = deps.closeTopicActionMenu || (() => {});
    const openReaderDocument = deps.openReaderDocument || (async () => {});
    const isReaderDocumentActive = deps.isReaderDocumentActive || (() => false);
    const syncReaderFromDocuments = deps.syncReaderFromDocuments || (() => {});
    const getNativePathForFile = deps.getNativePathForFile || (async () => '');
    const loadTopics = deps.loadTopics || (async () => {});
    const getLeftSidebarMode = deps.getLeftSidebarMode || (() => 'source-list');
    const getSourceListScrollTop = deps.getSourceListScrollTop || (() => 0);
    const setSourceListScrollTop = deps.setSourceListScrollTop || (() => {});
    const updateTopicKnowledgeBaseBinding = deps.updateTopicKnowledgeBaseBinding || (() => {});

    const scheduleFrame = typeof windowObj.requestAnimationFrame === 'function'
        ? windowObj.requestAnimationFrame.bind(windowObj)
        : (callback) => setTimeout(callback, 0);
    const startInterval = typeof windowObj.setInterval === 'function'
        ? windowObj.setInterval.bind(windowObj)
        : setInterval;
    const stopInterval = typeof windowObj.clearInterval === 'function'
        ? windowObj.clearInterval.bind(windowObj)
        : clearInterval;

    let knowledgeBasePollTimer = null;
    let knowledgeBasePollInFlight = false;

    function getCurrentTopic() {
        return state.topics.find((topic) => topic.id === state.currentTopicId) || null;
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

    function getSourceFileActions(documentItem) {
        const readable = isReaderSupportedDocument(documentItem) && documentItem.status === 'done';
        const actions = [];

        if (readable) {
            actions.push({ key: 'open', label: '打开阅读区', icon: 'menu_book', disabled: false });
        }
        if (documentItem.status === 'failed') {
            actions.push({ key: 'retry', label: '重试导入', icon: 'refresh', disabled: false });
        }
        if (actions.length === 0) {
            actions.push({ key: 'empty', label: '暂无可用操作', icon: 'hourglass_top', disabled: true });
        }

        return actions;
    }

    function rememberSourceListScrollPosition() {
        if (el.topicKnowledgeBaseFiles) {
            setSourceListScrollTop(el.topicKnowledgeBaseFiles.scrollTop);
        }
    }

    function restoreSourceListScrollPosition() {
        if (!el.topicKnowledgeBaseFiles || getLeftSidebarMode() !== 'source-list') {
            return;
        }
        scheduleFrame(() => {
            if (el.topicKnowledgeBaseFiles) {
                el.topicKnowledgeBaseFiles.scrollTop = getSourceListScrollTop() || 0;
            }
        });
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

    function showSourceFileTooltip(documentItem, anchorElement) {
        if (!el.sourceFileTooltip || !anchorElement) {
            return;
        }

        const meta = [
            formatDocumentStatus(documentItem),
            `时间：${formatRelativeTime(documentItem.updatedAt || documentItem.createdAt) || '未知'}`,
        ];

        el.sourceFileTooltip.innerHTML = `
            <div class="source-file-tooltip__meta">
                ${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}
            </div>
        `;
        el.sourceFileTooltip.classList.remove('hidden');
        el.sourceFileTooltip.style.visibility = 'hidden';
        positionFloatingElement(el.sourceFileTooltip, anchorElement.getBoundingClientRect(), 'right', windowObj);
        el.sourceFileTooltip.style.visibility = 'visible';
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
        positionFloatingElement(el.sourceFileActionMenu, activeMenu.anchorRect, 'left', windowObj);
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
        closeTopicActionMenu();
        state.activeSourceFileMenu = {
            documentId: documentItem.id,
            documentItem,
            anchorRect: anchorElement.getBoundingClientRect(),
        };
        renderSourceFileActionMenu();
    }

    function renderKnowledgeBaseDocumentRow(documentItem) {
        const row = documentObj.createElement('div');
        row.className = 'kb-document-row';
        const readable = isReaderSupportedDocument(documentItem) && documentItem.status === 'done';
        const visual = getKnowledgeBaseDocumentVisual(documentItem);
        const menuOpen = state.activeSourceFileMenu?.documentId === documentItem.id;
        row.classList.toggle('kb-document-row--clickable', readable);
        row.classList.toggle('kb-document-row--active', isReaderDocumentActive(documentItem.id));
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
                const empty = documentObj.createElement('div');
                empty.className = 'empty-list-state';
                empty.innerHTML = '<strong>没有命中结果</strong><span>当前 query 没有检索到满足阈值的 chunk。</span>';
                el.knowledgeBaseDebugResults.appendChild(empty);
                return;
            }

            items.forEach((item) => {
                const card = documentObj.createElement('div');
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
            const empty = documentObj.createElement('div');
            empty.className = 'empty-list-state';
            empty.innerHTML = '<strong>没有调试结果</strong><span>当前 query 没有命中满足条件的 chunk。</span>';
            el.knowledgeBaseDebugResults.appendChild(empty);
            return;
        }

        if (result.contextText) {
            const contextCard = documentObj.createElement('div');
            contextCard.className = 'kb-debug-card kb-debug-card--context';
            contextCard.innerHTML = `
                <strong>最终注入上下文</strong>
                <pre>${escapeHtml(result.contextText)}</pre>
            `;
            el.knowledgeBaseDebugResults.appendChild(contextCard);
        }

        const finalCard = documentObj.createElement('div');
        finalCard.className = 'kb-debug-card';
        finalCard.innerHTML = '<strong>最终命中</strong>';
        finalItems.forEach((item) => {
            const row = documentObj.createElement('div');
            row.className = 'kb-debug-hit';
            row.innerHTML = `
                <span>${escapeHtml(item.documentName)}${item.sectionTitle ? ` · ${escapeHtml(item.sectionTitle)}` : ''}</span>
                <span>score ${item.score}${typeof item.vectorScore === 'number' ? ` · vec ${item.vectorScore}` : ''}${typeof item.rerankScore === 'number' ? ` · rerank ${item.rerankScore}` : ''}</span>
                <pre>${escapeHtml(item.content || '')}</pre>
            `;
            finalCard.appendChild(row);
        });
        el.knowledgeBaseDebugResults.appendChild(finalCard);

        const candidateCard = documentObj.createElement('div');
        candidateCard.className = 'kb-debug-card';
        candidateCard.innerHTML = '<strong>向量候选</strong>';
        vectorCandidates.slice(0, 12).forEach((item) => {
            const row = documentObj.createElement('div');
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
        if (el.knowledgeBaseNameInput) {
            el.knowledgeBaseNameInput.value = selectedKb?.name || '';
        }
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
                const button = documentObj.createElement('button');
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

        if (el.renameKnowledgeBaseBtn) {
            el.renameKnowledgeBaseBtn.disabled = !selectedKb;
        }
        if (el.deleteKnowledgeBaseBtn) {
            el.deleteKnowledgeBaseBtn.disabled = !selectedKb;
        }
        if (el.importKnowledgeBaseFilesBtn) {
            el.importKnowledgeBaseFilesBtn.disabled = !selectedKb;
        }

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

    async function loadKnowledgeBaseDocuments(kbId, options = {}) {
        const isTopicTarget = options.target === 'topic';
        const target = isTopicTarget ? 'topicKnowledgeBaseDocuments' : 'knowledgeBaseDocuments';

        if (!kbId) {
            state[target] = [];
            if (isTopicTarget) {
                syncReaderFromDocuments([], { resetIfMissing: true });
            }
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
            if (isTopicTarget) {
                syncReaderFromDocuments([], { resetIfMissing: true });
            }
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
        syncReaderFromDocuments(state[target], { resetIfMissing: isTopicTarget });

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

        if (canReuseSelectedKnowledgeBaseDocuments({
            topicKnowledgeBaseId: kbId,
            selectedKnowledgeBaseId: state.selectedKnowledgeBaseId,
            reuseSelected: options.reuseSelected,
        })) {
            state.topicKnowledgeBaseDocuments = [...state.knowledgeBaseDocuments];
            syncReaderFromDocuments(state.topicKnowledgeBaseDocuments, { resetIfMissing: true });
            renderTopicKnowledgeBaseFiles();
            return state.topicKnowledgeBaseDocuments;
        }

        return loadKnowledgeBaseDocuments(kbId, { ...options, target: 'topic' });
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
            name: buildTopicSourceName({
                topic: currentTopic,
                agentName: state.currentSelectedItem.name || '',
            }),
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

        updateTopicKnowledgeBaseBinding(nextKbId);
        state.selectedKnowledgeBaseId = nextKbId;
        await loadKnowledgeBases({ silent: true });
        syncCurrentTopicKnowledgeBaseControls();

        if (options.silent !== true) {
            ui.showToastNotification('已为当前话题自动准备独立 Source。', 'success');
        }

        return nextKbId;
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

        rememberSourceListScrollPosition();
        el.topicKnowledgeBaseFiles.innerHTML = '';
        if (el.importTopicKnowledgeBaseFilesBtn) {
            el.importTopicKnowledgeBaseFilesBtn.classList.add('workspace-card__cta--list-item');
            el.topicKnowledgeBaseFiles.appendChild(el.importTopicKnowledgeBaseFilesBtn);
        }

        if (!kbId) {
            syncKnowledgeBasePolling();
            restoreSourceListScrollPosition();
            return;
        }

        if (state.topicKnowledgeBaseDocuments.length === 0) {
            const emptyState = documentObj.createElement('div');
            emptyState.className = 'empty-list-state empty-list-state--compact';
            emptyState.innerHTML = '<span style="font-size: 12px; color: var(--muted); text-align: center;">暂无资料文件，点击上方按钮添加。</span>';
            el.topicKnowledgeBaseFiles.appendChild(emptyState);
            syncKnowledgeBasePolling();
            restoreSourceListScrollPosition();
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
        restoreSourceListScrollPosition();
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

        if (el.currentTopicKnowledgeBaseSelect) {
            el.currentTopicKnowledgeBaseSelect.disabled = !hasTopic;
            el.currentTopicKnowledgeBaseSelect.value = currentKbId;
        }
        if (el.sourcePanelKnowledgeBaseSelect) {
            el.sourcePanelKnowledgeBaseSelect.disabled = !hasTopic;
            el.sourcePanelKnowledgeBaseSelect.value = currentKbId;
        }

        renderTopicKnowledgeBaseFiles();
    }

    function syncKnowledgeBasePolling() {
        const shouldPoll = shouldPollKnowledgeBaseItems({
            knowledgeBaseDocuments: state.knowledgeBaseDocuments,
            topicKnowledgeBaseDocuments: state.topicKnowledgeBaseDocuments,
        });

        if (shouldPoll && !knowledgeBasePollTimer) {
            knowledgeBasePollTimer = startInterval(async () => {
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
            stopInterval(knowledgeBasePollTimer);
            knowledgeBasePollTimer = null;
            knowledgeBasePollInFlight = false;
        }
    }

    async function createKnowledgeBase() {
        const name = el.knowledgeBaseNameInput?.value.trim();
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

        const name = el.knowledgeBaseNameInput?.value.trim();
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

        updateTopicKnowledgeBaseBinding(kbId);
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

    function bindEvents() {
        windowObj.addEventListener('resize', () => {
            hideSourceFileTooltip();
            closeSourceFileActionMenu();
        });

        documentObj.addEventListener('click', (event) => {
            const target = event.target;
            if (!state.activeSourceFileMenu) {
                return;
            }

            if (target instanceof Element && (target.closest('#sourceFileActionMenu') || target.closest('[data-doc-menu-button]'))) {
                return;
            }
            closeSourceFileActionMenu();
        });

        documentObj.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                hideSourceFileTooltip();
                closeSourceFileActionMenu();
            }
        });

        el.topicKnowledgeBaseFiles?.addEventListener('scroll', () => {
            rememberSourceListScrollPosition();
            hideSourceFileTooltip();
            closeSourceFileActionMenu();
        });
        el.createKnowledgeBaseBtn?.addEventListener('click', () => { void createKnowledgeBase(); });
        el.renameKnowledgeBaseBtn?.addEventListener('click', () => { void renameKnowledgeBase(); });
        el.deleteKnowledgeBaseBtn?.addEventListener('click', () => { void deleteKnowledgeBase(); });
        el.importKnowledgeBaseFilesBtn?.addEventListener('click', () => {
            el.hiddenKnowledgeBaseFileInput?.click();
        });
        el.hiddenKnowledgeBaseFileInput?.addEventListener('change', async () => {
            await importKnowledgeBaseFilesFromInput(el.hiddenKnowledgeBaseFileInput.files);
            el.hiddenKnowledgeBaseFileInput.value = '';
        });
        el.openKnowledgeBaseManagerBtn?.addEventListener('click', () => {
            void openKnowledgeBaseManager();
        });
        el.importTopicKnowledgeBaseFilesBtn?.addEventListener('click', async () => {
            const kbId = getCurrentTopicKnowledgeBaseId() || await ensureTopicSource({ silent: true });
            if (kbId) {
                el.hiddenTopicKnowledgeBaseFileInput?.click();
            }
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
        el.runKnowledgeBaseSearchBtn?.addEventListener('click', () => { void runKnowledgeBaseSearch(); });
        el.runKnowledgeBaseDebugBtn?.addEventListener('click', () => { void runKnowledgeBaseDebug(); });
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
    }

    return {
        closeSourceFileActionMenu,
        createKnowledgeBase,
        deleteKnowledgeBase,
        ensureTopicSource,
        handleTopicKnowledgeBaseChange,
        hideSourceFileTooltip,
        importKnowledgeBaseFilesForKb,
        importKnowledgeBaseFilesFromInput,
        loadCurrentTopicKnowledgeBaseDocuments,
        loadKnowledgeBaseDocuments,
        loadKnowledgeBases,
        openKnowledgeBaseManager,
        refreshKnowledgeBasePollingTargets,
        refreshKnowledgeBaseSummaries,
        renameKnowledgeBase,
        renderKnowledgeBaseDebugResults,
        renderKnowledgeBaseManager,
        renderTopicKnowledgeBaseFiles,
        runKnowledgeBaseDebug,
        runKnowledgeBaseSearch,
        syncCurrentTopicKnowledgeBaseControls,
        syncKnowledgeBasePolling,
        bindEvents,
    };
}

export {
    TOPIC_SOURCE_FILE_LIMIT,
    buildTopicSourceName,
    canReuseSelectedKnowledgeBaseDocuments,
    createSourceController,
    formatDocumentStatus,
    getKnowledgeBaseDocumentVisual,
    shouldPollKnowledgeBaseItems,
};
