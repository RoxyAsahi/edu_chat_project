import { positionFloatingElement } from '../dom/positionFloatingElement.js';
import { isReaderSupportedDocument } from '../reader/readerUtils.js';
import {
    escapeHtml,
    formatDocumentStatus,
    getKnowledgeBaseDocumentVisual,
} from './sourceModel.js';

function createSourceDom(deps = {}) {
    const state = deps.state;
    const el = deps.el;
    const windowObj = deps.windowObj || window;
    const documentObj = deps.documentObj || document;
    const openReaderDocument = deps.openReaderDocument || (async () => {});
    const isReaderDocumentActive = deps.isReaderDocumentActive || (() => false);
    const closeTopicActionMenu = deps.closeTopicActionMenu || (() => {});
    const formatRelativeTime = deps.formatRelativeTime || (() => '');
    const getSourceFileActions = deps.getSourceFileActions || (() => []);
    const getCurrentTopic = deps.getCurrentTopic || (() => null);
    const getCurrentTopicKnowledgeBaseId = deps.getCurrentTopicKnowledgeBaseId || (() => null);
    const getKnowledgeBaseName = deps.getKnowledgeBaseName || (() => '准备中');
    const getLeftSidebarMode = deps.getLeftSidebarMode || (() => 'source-list');
    const getSourceListScrollTop = deps.getSourceListScrollTop || (() => 0);
    const setSourceListScrollTop = deps.setSourceListScrollTop || (() => {});
    const onRetryDocument = deps.onRetryDocument || (async () => {});
    const getFacade = deps.getFacade || (() => ({}));
    const scheduleFrame = deps.scheduleFrame || ((callback) => setTimeout(callback, 0));

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
                    await onRetryDocument(activeMenu.documentItem.id);
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
        const processing = visual.spinning === true;
        row.classList.toggle('kb-document-row--clickable', readable);
        row.classList.toggle('kb-document-row--active', isReaderDocumentActive(documentItem.id));
        row.classList.toggle('kb-document-row--menu-open', menuOpen);
        row.classList.toggle('kb-document-row--processing', processing);

        row.innerHTML = `
            <div class="kb-document-row__leading">
                <button
                    class="kb-document-row__menu-btn"
                    type="button"
                    data-doc-menu-button
                    title="更多操作"
                    aria-label="更多操作"
                >
                    <span class="material-symbols-outlined kb-document-row__file-icon kb-document-row__file-icon--${escapeHtml(visual.tone)} ${processing ? 'kb-document-row__file-icon--spinning' : ''}">${escapeHtml(visual.icon)}</span>
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
                    await getFacade().loadKnowledgeBaseDocuments(kb.id, { silent: true });
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
            getFacade().syncKnowledgeBasePolling();
            return;
        }

        if (state.knowledgeBaseDocuments.length === 0) {
            el.knowledgeBaseDocuments.innerHTML = '<div class="empty-list-state"><strong>暂无文档</strong><span>导入文本、PDF 或 DOCX 以开始检索。</span></div>';
            renderKnowledgeBaseDebugResults();
            getFacade().syncKnowledgeBasePolling();
            return;
        }

        state.knowledgeBaseDocuments.forEach((documentItem) => {
            const row = renderKnowledgeBaseDocumentRow(documentItem);
            el.knowledgeBaseDocuments.appendChild(row);
        });

        renderKnowledgeBaseDebugResults();
        getFacade().syncKnowledgeBasePolling();
    }

    function renderTopicKnowledgeBaseFiles() {
        if (!el.topicKnowledgeBaseFiles) {
            return;
        }

        const hasTopic = Boolean(state.currentSelectedItem.id && state.currentTopicId);
        const kbId = getCurrentTopicKnowledgeBaseId();

        if (!hasTopic) {
            el.topicKnowledgeBaseFiles.innerHTML = '';
            getFacade().syncKnowledgeBasePolling();
            return;
        }

        rememberSourceListScrollPosition();
        el.topicKnowledgeBaseFiles.innerHTML = '';
        if (el.importTopicKnowledgeBaseFilesBtn) {
            el.importTopicKnowledgeBaseFilesBtn.classList.add('workspace-card__cta--list-item');
            el.topicKnowledgeBaseFiles.appendChild(el.importTopicKnowledgeBaseFilesBtn);
        }

        if (!kbId) {
            getFacade().syncKnowledgeBasePolling();
            restoreSourceListScrollPosition();
            return;
        }

        if (state.topicKnowledgeBaseDocuments.length === 0) {
            const emptyState = documentObj.createElement('div');
            emptyState.className = 'empty-list-state empty-list-state--compact';
            emptyState.innerHTML = '<span style="font-size: 12px; color: var(--muted); text-align: center;">暂无资料文件，点击上方按钮添加。</span>';
            el.topicKnowledgeBaseFiles.appendChild(emptyState);
            getFacade().syncKnowledgeBasePolling();
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

        getFacade().syncKnowledgeBasePolling();
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

    return {
        closeSourceFileActionMenu,
        hideSourceFileTooltip,
        renderKnowledgeBaseDebugResults,
        renderKnowledgeBaseManager,
        renderTopicKnowledgeBaseFiles,
        syncCurrentTopicKnowledgeBaseControls,
    };
}

export {
    createSourceDom,
};
