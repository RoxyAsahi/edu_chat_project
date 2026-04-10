const DEFAULT_AGENT_AVATAR = '../assets/default_avatar.png';

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function shouldPersistTopicSelection(options = {}) {
    return options.fromWatcher !== true;
}

function createWorkspaceController(deps = {}) {
    const state = deps.state;
    const el = deps.el;
    const chatAPI = deps.chatAPI;
    const ui = deps.ui;
    const normalizeTopic = deps.normalizeTopic || ((topic) => topic);
    const normalizeHistory = deps.normalizeHistory || ((history) => history);
    const toggleTopicActionMenu = deps.toggleTopicActionMenu || (() => {});
    const renderCurrentHistory = deps.renderCurrentHistory || (async () => {});
    const renderTopicKnowledgeBaseFiles = deps.renderTopicKnowledgeBaseFiles || (() => {});
    const syncCurrentTopicKnowledgeBaseControls = deps.syncCurrentTopicKnowledgeBaseControls || (() => {});
    const syncComposerAvailability = deps.syncComposerAvailability || (() => {});
    const renderNotesPanel = deps.renderNotesPanel || (() => {});
    const renderReaderPanel = deps.renderReaderPanel || (() => {});
    const refreshAttachmentPreview = deps.refreshAttachmentPreview || (() => {});
    const closeNoteDetail = deps.closeNoteDetail || (() => {});
    const closeNoteActionMenu = deps.closeNoteActionMenu || (() => {});
    const clearPendingFlashcardGeneration = deps.clearPendingFlashcardGeneration || (() => {});
    const clearPendingSelectionContext = deps.clearPendingSelectionContext || (() => {});
    const resetReaderState = deps.resetReaderState || (() => {});
    const setLeftSidebarMode = deps.setLeftSidebarMode || (() => {});
    const setLeftReaderTab = deps.setLeftReaderTab || (() => {});
    const setRightPanelMode = deps.setRightPanelMode || (() => {});
    const ensureTopicSource = deps.ensureTopicSource || (async () => null);
    const loadCurrentTopicKnowledgeBaseDocuments = deps.loadCurrentTopicKnowledgeBaseDocuments || (async () => {});
    const loadTopicNotes = deps.loadTopicNotes || (async () => {});
    const loadAgentNotes = deps.loadAgentNotes || (async () => {});
    const populateAgentForm = deps.populateAgentForm || (async () => {});
    const setPromptVisible = deps.setPromptVisible || (() => {});
    const messageRendererApi = deps.messageRendererApi || null;
    const defaultAgentAvatar = deps.defaultAgentAvatar || DEFAULT_AGENT_AVATAR;

    function getCurrentTopic() {
        return state.topics.find((topic) => topic.id === state.currentTopicId) || null;
    }

    function getCurrentTopicDisplayName() {
        return getCurrentTopic()?.name || '请选择一个话题';
    }

    function getCurrentAgentDisplayName() {
        return state.currentSelectedItem.name || '未选择学科';
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

    function filterAgents() {
        const keyword = el.agentSearchInput?.value.trim().toLowerCase() || '';
        Array.from(el.agentList?.children || []).forEach((item) => {
            item.hidden = !item.dataset.searchText.includes(keyword);
        });
    }

    function renderAgentList(unreadCounts = {}) {
        if (!el.agentList) {
            return;
        }

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
                <img class="avatar" src="${agent.avatarUrl || defaultAgentAvatar}" alt="${agent.name || agent.id}" />
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
            li.addEventListener('click', () => {
                void selectAgent(agent.id);
            });
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
            return state.agents;
        }

        state.agents = Array.isArray(agents) ? agents : [];
        const unreadResult = await chatAPI.getUnreadTopicCounts().catch(() => ({ counts: {} }));
        renderAgentList(unreadResult?.counts || {});
        return state.agents;
    }

    function filterTopics() {
        const keyword = el.topicSearchInput?.value.trim().toLowerCase() || '';
        Array.from(el.topicList?.children || []).forEach((item) => {
            item.hidden = !item.dataset.searchText.includes(keyword);
        });
    }

    function renderTopics() {
        if (!el.topicList) {
            return;
        }

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
                const target = event.target instanceof Element ? event.target : null;
                const actionButton = target?.closest?.('[data-topic-menu-button]');
                if (actionButton) {
                    event.stopPropagation();
                    toggleTopicActionMenu(topic, actionButton);
                    return;
                }

                await selectTopic(topic.id);
            });

            li.addEventListener('dblclick', () => {
                void renameTopic(topic);
            });
            el.topicList.appendChild(li);
        });

        filterTopics();
    }

    async function loadTopics(options = {}) {
        if (!state.currentSelectedItem.id) {
            state.topics = [];
            state.currentTopicId = null;
            state.topicKnowledgeBaseDocuments = [];
            syncWorkspaceContext();
            renderTopics();
            renderTopicKnowledgeBaseFiles();
            syncComposerAvailability();
            return state.topics;
        }

        const topics = await chatAPI.getAgentTopics(state.currentSelectedItem.id);
        state.topics = Array.isArray(topics) ? topics.map(normalizeTopic) : [];
        const preferredTopicId = options.preferredTopicId || null;
        if (preferredTopicId && state.topics.some((topic) => topic.id === preferredTopicId)) {
            state.currentTopicId = preferredTopicId;
        } else if (!state.topics.some((topic) => topic.id === state.currentTopicId)) {
            state.currentTopicId = null;
        }

        if (!state.currentTopicId && state.topics.length > 0) {
            state.currentTopicId = state.topics[0].id;
        }

        syncWorkspaceContext();
        renderTopics();
        syncCurrentTopicKnowledgeBaseControls();
        syncComposerAvailability();
        return state.topics;
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
        if (!nextName) {
            return;
        }

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

    function buildHistoryFilePath() {
        const base = (state.currentSelectedItem?.config?.agentDataPath || '').replace(/[\\/]+$/, '');
        if (!base || !state.currentTopicId) {
            return null;
        }
        return `${base}\\topics\\${state.currentTopicId}\\history.json`;
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
        if (!confirmed) {
            return;
        }

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

    async function selectTopic(topicId, options = {}) {
        if (!state.currentSelectedItem.id || !topicId) {
            return;
        }

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
        messageRendererApi?.setCurrentTopicId?.(topicId);

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

        if (!shouldPersistTopicSelection(options)) {
            return;
        }

        await chatAPI.setTopicUnread(state.currentSelectedItem.id, topicId, false).catch(() => {});
        await chatAPI.saveSettings({
            lastOpenItemId: state.currentSelectedItem.id,
            lastOpenItemType: 'agent',
            lastOpenTopicId: topicId,
        }).catch(() => {});
        await loadAgents();
    }

    async function selectAgent(agentId, options = {}) {
        const config = await chatAPI.getAgentConfig(agentId);
        if (!config || config.error) {
            ui.showToastNotification(`加载智能体失败：${config?.error || '未知错误'}`, 'error');
            return;
        }

        state.currentSelectedItem = {
            id: agentId,
            type: 'agent',
            name: config.name || agentId,
            avatarUrl: config.avatarUrl || defaultAgentAvatar,
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

        if (el.agentSettingsContainerTitle) {
            el.agentSettingsContainerTitle.textContent = '智能体设置';
        }
        if (el.selectedAgentNameForSettings) {
            el.selectedAgentNameForSettings.textContent = config.name || agentId;
        }
        syncWorkspaceContext();
        setPromptVisible(true);
        messageRendererApi?.setCurrentSelectedItem?.(state.currentSelectedItem);
        messageRendererApi?.setCurrentItemAvatar?.(state.currentSelectedItem.avatarUrl);
        messageRendererApi?.setCurrentItemAvatarColor?.(config.avatarCalculatedColor || null);

        await populateAgentForm(config);
        await loadTopics({ preferredTopicId: options.preferredTopicId || null });
        await loadAgentNotes();
        await loadAgents();

        if (state.topics.length > 0) {
            await selectTopic(state.currentTopicId || state.topics[0].id, {
                fromWatcher: options.fromWatcher === true,
            });
            return;
        }

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
        if (!state.currentTopicId) {
            return;
        }

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
        if (!name) {
            return;
        }

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
        if (!name) {
            return;
        }

        const result = await chatAPI.createNewTopicForAgent(state.currentSelectedItem.id, name || '', false, true);
        if (result?.error) {
            ui.showToastNotification(result.error, 'error');
            return;
        }

        await loadTopics({ preferredTopicId: result.topicId });
        await selectTopic(result.topicId);
    }

    async function deleteCurrentAgent() {
        if (!state.currentSelectedItem.id) {
            return;
        }

        const confirmed = await ui.showConfirmDialog(
            `确定删除智能体 ${state.currentSelectedItem.name || state.currentSelectedItem.id} 吗？`,
            '删除智能体',
            '删除',
            '取消',
            true,
        );
        if (!confirmed) {
            return;
        }

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

    function bindEvents() {
        el.agentSearchInput?.addEventListener('input', filterAgents);
        el.topicSearchInput?.addEventListener('input', filterTopics);
        el.createNewAgentBtn?.addEventListener('click', () => {
            void createAgent();
        });
        el.quickNewTopicBtn?.addEventListener('click', () => {
            void createTopic();
        });
        el.composerQuickNewTopicBtn?.addEventListener('click', () => {
            void createTopic();
        });
        el.exportTopicBtn?.addEventListener('click', () => {
            void exportCurrentTopic();
        });
        el.topicList?.addEventListener('scroll', () => {
            deps.closeTopicActionMenu?.();
        });
    }

    return {
        getCurrentTopic,
        getCurrentTopicDisplayName,
        getCurrentAgentDisplayName,
        syncWorkspaceContext,
        filterAgents,
        renderAgentList,
        filterTopics,
        renderTopics,
        loadAgents,
        loadTopics,
        renameTopic,
        setTopicUnreadState,
        toggleTopicLockState,
        clearCurrentConversationView,
        deleteTopicFromList,
        selectTopic,
        selectAgent,
        exportCurrentTopic,
        createAgent,
        createTopic,
        deleteCurrentAgent,
        bindEvents,
    };
}

export {
    DEFAULT_AGENT_AVATAR,
    shouldPersistTopicSelection,
    createWorkspaceController,
};
