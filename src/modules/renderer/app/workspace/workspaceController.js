import { positionFloatingElement } from '../dom/positionFloatingElement.js';

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

function formatOverviewClock(date = new Date()) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

function formatOverviewClockDate(date = new Date()) {
    const weekdayNames = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${month}月${day}日 ${weekdayNames[date.getDay()]}`;
}

function createWorkspaceController(deps = {}) {
    const store = deps.store;
    const el = deps.el;
    const chatAPI = deps.chatAPI;
    const ui = deps.ui;
    const windowObj = deps.windowObj || window;
    const documentObj = deps.documentObj || document;
    const normalizeTopic = deps.normalizeTopic || ((topic) => topic);
    const normalizeHistory = deps.normalizeHistory || ((history) => history);
    const renderCurrentHistory = deps.renderCurrentHistory || (async () => {});
    const renderTopicKnowledgeBaseFiles = deps.renderTopicKnowledgeBaseFiles || (() => {});
    const syncCurrentTopicKnowledgeBaseControls = deps.syncCurrentTopicKnowledgeBaseControls || (() => {});
    const syncComposerAvailability = deps.syncComposerAvailability || (() => {});
    const renderReaderPanel = deps.renderReaderPanel || (() => {});
    const refreshAttachmentPreview = deps.refreshAttachmentPreview || (() => {});
    const resetComposerState = deps.resetComposerState || (() => {});
    const resetNotesState = deps.resetNotesState || (() => {});
    const resetReaderState = deps.resetReaderState || (() => {});
    const setLeftSidebarMode = deps.setLeftSidebarMode || (() => {});
    const setLeftReaderTab = deps.setLeftReaderTab || (() => {});
    const setRightPanelMode = deps.setRightPanelMode || (() => {});
    const ensureTopicSource = deps.ensureTopicSource || (async () => null);
    const loadCurrentTopicKnowledgeBaseDocuments = deps.loadCurrentTopicKnowledgeBaseDocuments || (async () => {});
    const loadTopicNotes = deps.loadTopicNotes || (async () => {});
    const loadAgentNotes = deps.loadAgentNotes || (async () => {});
    const refreshLogs = deps.refreshLogs || (async () => {});
    const populateAgentForm = deps.populateAgentForm || (async () => {});
    const setPromptVisible = deps.setPromptVisible || (() => {});
    const messageRendererApi = deps.messageRendererApi || null;
    const defaultAgentAvatar = deps.defaultAgentAvatar || DEFAULT_AGENT_AVATAR;
    const buildOverviewMarkup = deps.buildSubjectOverviewMarkup || (() => ({
        headline: '学科总视图',
        summary: '把不同学科整理成独立工作台，在这里快速切换学习上下文。',
        clockMarkup: '',
        statsRowMarkup: '',
        gridMarkup: '',
    }));
    const nowProvider = deps.nowProvider || (() => new Date());
    const setIntervalFn = deps.setIntervalFn || ((handler, timeout) => windowObj.setInterval(handler, timeout));
    const clearIntervalFn = deps.clearIntervalFn || ((timerId) => windowObj.clearInterval(timerId));
    const closeSourceFileActionMenu = deps.closeSourceFileActionMenu || (() => {});
    const hideSourceFileTooltip = deps.hideSourceFileTooltip || (() => {});
    const clearTopicKnowledgeBaseDocuments = deps.clearTopicKnowledgeBaseDocuments || (() => {});
    const getGlobalSettings = deps.getGlobalSettings || (() => store.getState().settings.settings);
    const syncMobileWorkspaceLayout = deps.syncMobileWorkspaceLayout || (() => {});
    const refreshWorkspaceLayout = deps.refreshWorkspaceLayout || (() => {});

    function getSessionSlice() {
        return store.getState().session;
    }

    function getLayoutSlice() {
        return store.getState().layout;
    }

    function patchSession(patch) {
        return store.patchState('session', (current, rootState) => ({
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

    function updateTopicInSession(topicId, updater) {
        patchSession((current) => ({
            topics: current.topics.map((topic) => (
                topic.id === topicId
                    ? { ...topic, ...(typeof updater === 'function' ? updater(topic) : updater) }
                    : topic
            )),
        }));
    }

    const state = {};
    Object.defineProperties(state, {
        agents: {
            get: () => getSessionSlice().agents,
            set: (value) => patchSession({ agents: value }),
        },
        topics: {
            get: () => getSessionSlice().topics,
            set: (value) => patchSession({ topics: value }),
        },
        currentSelectedItem: {
            get: () => getSessionSlice().currentSelectedItem,
            set: (value) => patchSession({ currentSelectedItem: value }),
        },
        currentTopicId: {
            get: () => getSessionSlice().currentTopicId,
            set: (value) => patchSession({ currentTopicId: value }),
        },
        currentChatHistory: {
            get: () => getSessionSlice().currentChatHistory,
            set: (value) => patchSession({ currentChatHistory: value }),
        },
        activeTopicMenu: {
            get: () => getSessionSlice().activeTopicMenu,
            set: (value) => patchSession({ activeTopicMenu: value }),
        },
        workspaceViewMode: {
            get: () => getLayoutSlice().workspaceViewMode,
            set: (value) => patchLayout({ workspaceViewMode: value }),
        },
    });

    let agentOverviewStats = {};
    let overviewLearningMetrics = {
        score: 700,
        streakDays: 0,
        activeDaysLast7: 0,
        totalLearningDays: 0,
    };
    let overviewClockTimerId = null;
    let overviewSubjectRevealObserver = null;
    let overviewSubjectRevealResetTimerId = null;

    function normalizeDateToDayStart(value) {
        const date = new Date(Number(value || Date.now()));
        date.setHours(0, 0, 0, 0);
        return date.getTime();
    }

    function parseDateKeyToTimestamp(dateKey = '') {
        const normalized = String(dateKey || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
            return null;
        }

        const parsed = new Date(`${normalized}T00:00:00`).getTime();
        return Number.isFinite(parsed) ? parsed : null;
    }

    function computeStreakDays(dayTimestamps = []) {
        if (!Array.isArray(dayTimestamps) || dayTimestamps.length === 0) {
            return 0;
        }

        const daySet = new Set(dayTimestamps.map((value) => normalizeDateToDayStart(value)));
        const oneDay = 24 * 60 * 60 * 1000;
        let cursor = normalizeDateToDayStart(Date.now());
        let streak = 0;

        while (daySet.has(cursor)) {
            streak += 1;
            cursor -= oneDay;
        }

        return streak;
    }

    function computeLearningMetricsFromDays(items = []) {
        const dayTimestamps = (Array.isArray(items) ? items : [])
            .map((item) => parseDateKeyToTimestamp(item?.dateKey))
            .filter((value) => Number.isFinite(value));
        const uniqueDaySet = new Set(dayTimestamps.map((value) => normalizeDateToDayStart(value)));
        const totalLearningDays = uniqueDaySet.size;
        const streakDays = computeStreakDays([...uniqueDaySet]);

        const sevenDaysAgo = normalizeDateToDayStart(Date.now()) - (6 * 24 * 60 * 60 * 1000);
        const activeDaysLast7 = [...uniqueDaySet].filter((value) => value >= sevenDaysAgo).length;

        const score = Math.min(
            980,
            600
                + Math.min(streakDays * 18, 180)
                + Math.min(activeDaysLast7 * 20, 140)
                + Math.min(totalLearningDays * 2, 60),
        );

        return {
            score,
            streakDays,
            activeDaysLast7,
            totalLearningDays,
        };
    }

    function buildFallbackLearningMetrics() {
        const stats = Object.values(agentOverviewStats || {});
        const totalTopics = stats.reduce((sum, item) => sum + Number(item?.topicCount || 0), 0);
        const totalUnread = stats.reduce((sum, item) => sum + Number(item?.unreadCount || 0), 0);
        const estimatedActiveDays = Math.min(30, Math.max(0, totalTopics));
        const estimatedActiveLast7 = Math.min(7, Math.ceil(totalUnread / 2) || Math.min(7, totalTopics));
        const estimatedStreak = Math.min(21, Math.max(0, Math.floor(totalTopics / 2)));

        const score = Math.min(
            900,
            620
                + Math.min(estimatedStreak * 12, 120)
                + Math.min(estimatedActiveLast7 * 18, 126)
                + Math.min(estimatedActiveDays * 2, 54),
        );

        return {
            score,
            streakDays: estimatedStreak,
            activeDaysLast7: estimatedActiveLast7,
            totalLearningDays: estimatedActiveDays,
        };
    }

    async function refreshOverviewLearningMetrics() {
        if (typeof chatAPI.listStudyLogDays !== 'function') {
            overviewLearningMetrics = buildFallbackLearningMetrics();
            return overviewLearningMetrics;
        }

        try {
            const result = await chatAPI.listStudyLogDays({
                scope: 'global',
                agentId: '',
                topicId: '',
                query: '',
                dateKey: '',
                notebookId: '',
                notebookName: '',
                limit: 365,
            });

            if (result?.success && Array.isArray(result.items) && result.items.length > 0) {
                overviewLearningMetrics = computeLearningMetricsFromDays(result.items);
                return overviewLearningMetrics;
            }
        } catch (_error) {
            // Fallback is handled below.
        }

        overviewLearningMetrics = buildFallbackLearningMetrics();
        return overviewLearningMetrics;
    }

    function clearOverviewClockTimer() {
        if (overviewClockTimerId == null) {
            return;
        }
        clearIntervalFn(overviewClockTimerId);
        overviewClockTimerId = null;
    }

    function disconnectOverviewSubjectRevealObserver() {
        if (overviewSubjectRevealObserver?.disconnect) {
            overviewSubjectRevealObserver.disconnect();
        }
        overviewSubjectRevealObserver = null;
        if (overviewSubjectRevealResetTimerId != null) {
            windowObj.clearTimeout(overviewSubjectRevealResetTimerId);
            overviewSubjectRevealResetTimerId = null;
        }
    }

    function bindOverviewSubjectReveal() {
        disconnectOverviewSubjectRevealObserver();
        const subjectSection = el.subjectOverviewGrid?.querySelector('.overview-subject-section--pending');
        if (!subjectSection) {
            return;
        }
        const restartEnterAnimation = () => {
            subjectSection.classList.remove('is-leaving');
            subjectSection.classList.remove('is-visible');
            void subjectSection.offsetWidth;
            subjectSection.classList.add('is-visible');
        };
        if (typeof windowObj.IntersectionObserver !== 'function') {
            restartEnterAnimation();
            return;
        }
        overviewSubjectRevealObserver = new windowObj.IntersectionObserver((entries) => {
            const entry = entries[0];
            if (!entry) {
                return;
            }
            if (entry.isIntersecting) {
                if (overviewSubjectRevealResetTimerId != null) {
                    windowObj.clearTimeout(overviewSubjectRevealResetTimerId);
                    overviewSubjectRevealResetTimerId = null;
                }
                restartEnterAnimation();
                return;
            }
            if (!subjectSection.classList.contains('is-visible')) {
                return;
            }
            subjectSection.classList.remove('is-visible');
            subjectSection.classList.add('is-leaving');
            overviewSubjectRevealResetTimerId = windowObj.setTimeout(() => {
                subjectSection.classList.remove('is-leaving');
                overviewSubjectRevealResetTimerId = null;
            }, 460);
        }, {
            root: el.workspaceOverviewPage || null,
            threshold: 0.08,
            rootMargin: '0px 0px -6% 0px',
        });
        overviewSubjectRevealObserver.observe(subjectSection);
    }

    function syncOverviewClockText() {
        const clockTimeElement = el.subjectOverviewGrid?.querySelector('#overviewClockTime');
        if (!clockTimeElement) {
            return;
        }
        const currentTime = nowProvider();
        clockTimeElement.textContent = formatOverviewClock(currentTime);
        const clockDateElement = el.subjectOverviewGrid?.querySelector('#overviewClockDate');
        if (clockDateElement) {
            clockDateElement.textContent = formatOverviewClockDate(currentTime);
        }
    }

    function ensureOverviewClockTimer() {
        if (state.workspaceViewMode === 'subject') {
            clearOverviewClockTimer();
            return;
        }

        syncOverviewClockText();
        if (overviewClockTimerId != null) {
            return;
        }

        overviewClockTimerId = setIntervalFn(() => {
            syncOverviewClockText();
        }, 1000);
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

    function hasCurrentAgentSelected() {
        return Boolean(state.currentSelectedItem?.id);
    }

    function focusOverviewHighlights() {
        const targetSection = el.subjectOverviewGrid?.querySelector('.overview-subject-section');
        if (!targetSection) {
            return;
        }
        targetSection.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
        });
    }

    function showManualNotesLibrary() {
        state.workspaceViewMode = 'manual-notes';
        syncWorkspaceView();
    }

    function openDiaryWall() {
        el.openDiaryWallBtn?.click();
    }

    function continueLearningFromHome() {
        if (!hasCurrentAgentSelected()) {
            void createAgent();
            return;
        }
        showSubjectWorkspace();
    }

    function handleHomeAction(action, payload = {}) {
        switch (action) {
        case 'create-agent':
            void createAgent();
            break;
        case 'open-agent': {
            const agentId = String(payload.agentId || '').trim();
            if (!agentId) {
                break;
            }
            void selectAgent(agentId);
            break;
        }
        case 'view-highlights':
            focusOverviewHighlights();
            break;
        case 'open-subject':
        case 'continue-learning':
            continueLearningFromHome();
            break;
        case 'open-notes':
            showManualNotesLibrary();
            break;
        case 'open-diary':
            openDiaryWall();
            break;
        default:
            break;
        }
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
        positionFloatingElement(el.topicActionMenu, state.activeTopicMenu.anchorRect, 'left', windowObj);
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

    function showWorkspaceOverview() {
        state.workspaceViewMode = 'overview';
        syncWorkspaceView();
    }

    function showSubjectWorkspace() {
        state.workspaceViewMode = 'subject';
        syncWorkspaceView();
    }

    function showManualNotesLibrary() {
        state.workspaceViewMode = 'manual-notes';
        syncWorkspaceView();
    }

    function syncWorkspaceView() {
        const mode = state.workspaceViewMode || 'overview';
        const isOverview = mode === 'overview';
        const isSubject = mode === 'subject';
        const isManualNotes = mode === 'manual-notes';

        el.workspaceOverviewPage?.classList.toggle('hidden', !isOverview);
        el.workspaceSubjectPage?.classList.toggle('hidden', !isSubject);
        el.manualNotesLibraryPage?.classList.toggle('hidden', !isManualNotes);
        el.settingsModal?.classList.add('hidden');
        el.settingsModal?.classList.remove('settings-page--open');
        el.workspaceBackToOverviewBtn?.classList.toggle('titlebar__tab--active', isOverview);
        el.workspaceOpenSubjectBtn?.classList.toggle('titlebar__tab--active', isSubject);
        el.manualNotesLibraryBtn?.classList.toggle('titlebar__tab--active', isManualNotes);
        documentObj.body?.classList?.toggle('workspace-view-overview', isOverview);
        documentObj.body?.classList?.toggle('workspace-view-subject', isSubject);
        documentObj.body?.classList?.toggle('workspace-view-manual-notes', isManualNotes);
        documentObj.body?.classList?.remove('workspace-view-settings');
        documentObj.body?.classList?.remove('settings-page-open');
        if (!isManualNotes) {
            store.patchState('notes', (current) => ({
                ...current,
                manualNotesLibraryOpen: false,
            }));
        }
        if (isOverview) {
            ensureOverviewClockTimer();
        } else {
            clearOverviewClockTimer();
        }
        syncMobileWorkspaceLayout();
        if (isSubject) {
            refreshWorkspaceLayout({
                frames: 2,
                resetDesktopLayout: true,
            });
        }
    }

    async function refreshAgentOverviewStats(unreadCounts = {}) {
        const agents = Array.isArray(state.agents) ? state.agents : [];
        const overviewEntries = await Promise.all(agents.map(async (agent) => {
            const topics = await chatAPI.getAgentTopics(agent.id).catch(() => []);
            const normalizedTopics = Array.isArray(topics) ? topics.map(normalizeTopic) : [];
            return [
                agent.id,
                {
                    topicCount: normalizedTopics.length,
                    unreadCount: Number(unreadCounts[agent.id] || 0),
                    lastTopicName: normalizedTopics[0]?.name || '',
                },
            ];
        }));

        agentOverviewStats = Object.fromEntries(overviewEntries);
        return agentOverviewStats;
    }

    function renderSubjectOverview() {
        if (!el.subjectOverviewGrid) {
            return;
        }

        const markup = buildOverviewMarkup({
            agents: state.agents,
            statsByAgent: agentOverviewStats,
            selectedAgentId: state.currentSelectedItem.id,
            selectedAgentName: getCurrentAgentDisplayName(),
            currentTopicName: getCurrentTopicDisplayName(),
            learningMetrics: overviewLearningMetrics,
        });

        if (el.subjectOverviewHeadline) {
            el.subjectOverviewHeadline.textContent = markup.headline;
        }
        if (el.subjectOverviewSummary) {
            el.subjectOverviewSummary.textContent = markup.summary;
        }
        if (el.workspaceOverviewHighlights) {
            el.workspaceOverviewHighlights.innerHTML = markup.highlightsMarkup || '';
        }

        el.subjectOverviewGrid.innerHTML = `${markup.heroMarkup || ''}${markup.clockMarkup || ''}${markup.statsRowMarkup || ''}${markup.gridMarkup || ''}`;
        el.workspaceOverviewHighlights?.querySelectorAll('[data-home-action]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                const { homeAction } = button.dataset;
                if (!homeAction) {
                    return;
                }
                handleHomeAction(homeAction, button.dataset);
            });
        });
        el.subjectOverviewGrid.querySelectorAll('[data-subject-card]').forEach((button) => {
            button.addEventListener('click', () => {
                const { agentId } = button.dataset;
                if (!agentId) {
                    return;
                }
                void selectAgent(agentId);
            });
        });
        el.subjectOverviewGrid.querySelectorAll('[data-delete-subject-card]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const { agentId, agentName } = button.dataset;
                if (!agentId) {
                    return;
                }
                void deleteAgentById(agentId, { agentName });
            });
        });

        const createCard = el.subjectOverviewGrid.querySelector('#subjectOverviewCreateCard');
        createCard?.addEventListener('click', () => {
            void createAgent();
        });

        el.subjectOverviewGrid.querySelectorAll('[data-home-action]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                const { homeAction } = button.dataset;
                if (!homeAction) {
                    return;
                }
                handleHomeAction(homeAction, button.dataset);
            });
        });

        bindOverviewSubjectReveal();
        ensureOverviewClockTimer();
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
            const li = documentObj.createElement('li');
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
            console.error('[UniStudyRenderer] getAgents failed:', agents.error);
            ui.showToastNotification(`加载智能体失败：${agents.error}`, 'error');
            state.agents = [];
            agentOverviewStats = {};
            renderAgentList({});
            renderSubjectOverview();
            return state.agents;
        }

        state.agents = Array.isArray(agents) ? agents : [];
        const unreadResult = await chatAPI.getUnreadTopicCounts().catch(() => ({ counts: {} }));
        await refreshAgentOverviewStats(unreadResult?.counts || {});
        await refreshOverviewLearningMetrics();
        renderAgentList(unreadResult?.counts || {});
        renderSubjectOverview();
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
            const emptyItem = documentObj.createElement('li');
            emptyItem.className = 'empty-list-state empty-list-state--topics';
            emptyItem.innerHTML = '<span>暂无话题</span>';
            el.topicList.appendChild(emptyItem);
            return;
        }

        state.topics.forEach((topic) => {
            const li = documentObj.createElement('li');
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
            clearTopicKnowledgeBaseDocuments();
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

        updateTopicInSession(topic.id, {
            name: nextName.trim(),
        });
        renderTopics();
    }

    async function setTopicUnreadState(topic, unread) {
        const result = await chatAPI.setTopicUnread(state.currentSelectedItem.id, topic.id, unread);
        if (!result?.success) {
            ui.showToastNotification(`更新话题状态失败：${result?.error || '未知错误'}`, 'error');
            return;
        }

        updateTopicInSession(topic.id, {
            unread,
        });
        renderTopics();
        await loadAgents();
    }

    async function toggleTopicLockState(topic) {
        const result = await chatAPI.toggleTopicLock(state.currentSelectedItem.id, topic.id);
        if (!result?.success) {
            ui.showToastNotification(`更新锁定状态失败：${result?.error || '未知错误'}`, 'error');
            return;
        }

        updateTopicInSession(topic.id, {
            locked: result.locked,
        });
        renderTopics();
    }

    function buildHistoryFilePath() {
        const base = (state.currentSelectedItem?.config?.agentDataPath || '').replace(/[\\/]+$/, '');
        if (!base || !state.currentTopicId) {
            return null;
        }
        return `${base}\\topics\\${state.currentTopicId}\\history.json`;
    }

    async function stopHistoryWatcher() {
        if (typeof chatAPI.watcherStop !== 'function') {
            return;
        }

        try {
            await chatAPI.watcherStop();
        } catch (error) {
            console.warn('[UniStudyRenderer] watcherStop failed:', error);
        }
    }

    async function clearCurrentConversationView() {
        closeTopicActionMenu();
        await stopHistoryWatcher();
        state.currentTopicId = null;
        state.currentChatHistory = [];
        clearTopicKnowledgeBaseDocuments();
        resetNotesState({
            clearTopicNotes: true,
            clearSelection: true,
            clearActiveNote: true,
            closeDetailView: true,
            clearFlashcards: true,
        });
        resetComposerState({
            clearAttachments: true,
            clearSelectionContext: true,
        });
        setLeftSidebarMode('source-list');
        setLeftReaderTab('guide');
        syncWorkspaceContext();
        renderTopics();
        syncCurrentTopicKnowledgeBaseControls();
        renderTopicKnowledgeBaseFiles();
        await renderCurrentHistory();
        await refreshLogs();
    }

    async function deleteTopicFromList(topic) {
        closeTopicActionMenu();
        const label = topic.name || topic.id;
        const confirmed = await ui.showConfirmDialog(`确定删除话题 "${label}" 吗？`, '删除话题', '删除', '取消', true);
        if (!confirmed) {
            return;
        }

        if (state.currentTopicId === topic.id) {
            await stopHistoryWatcher();
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

        closeTopicActionMenu();
        await stopHistoryWatcher();
        state.currentTopicId = topicId;
        clearTopicKnowledgeBaseDocuments();
        resetNotesState({
            clearTopicNotes: true,
            clearSelection: true,
            clearActiveNote: true,
            closeDetailView: true,
            clearFlashcards: true,
        });
        resetComposerState({
            clearAttachments: true,
            clearSelectionContext: true,
        });
        resetReaderState();
        setLeftSidebarMode('source-list');
        setLeftReaderTab('guide');
        setRightPanelMode('notes');
        renderReaderPanel();
        syncWorkspaceContext();
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
        await refreshLogs();

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
        closeTopicActionMenu();
        await stopHistoryWatcher();
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
        resetComposerState({
            clearAttachments: true,
            clearSelectionContext: true,
        });
        resetNotesState({
            clearTopicNotes: true,
            clearAgentNotes: true,
            clearSelection: true,
            clearActiveNote: true,
            closeDetailView: true,
            clearFlashcards: true,
        });
        resetReaderState();
        setLeftSidebarMode('source-list');
        setLeftReaderTab('guide');
        renderReaderPanel();

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
        await refreshLogs();
        if (options.showSubjectWorkspace !== false) {
            showSubjectWorkspace();
        }

        if (state.topics.length > 0) {
            await selectTopic(state.currentTopicId || state.topics[0].id, {
                fromWatcher: options.fromWatcher === true,
            });
            return;
        }

        state.currentTopicId = null;
        state.currentChatHistory = [];
        clearTopicKnowledgeBaseDocuments();
        resetReaderState();
        renderReaderPanel();
        syncCurrentTopicKnowledgeBaseControls();
        renderTopicKnowledgeBaseFiles();
        await renderCurrentHistory();
        syncComposerAvailability();
        renderSubjectOverview();
    }

    function buildMarkdownExport() {
        const settings = getGlobalSettings();
        return state.currentChatHistory.map((message) => {
            const title = message.role === 'assistant'
                ? (message.name || state.currentSelectedItem.name || 'Assistant')
                : message.role === 'user'
                    ? (settings.userName || 'User')
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

        const result = await chatAPI.createNewTopicForAgent(state.currentSelectedItem.id, '', false, true);
        if (result?.error) {
            ui.showToastNotification(result.error, 'error');
            return;
        }

        await loadTopics({ preferredTopicId: result.topicId });
        await selectTopic(result.topicId);
    }

    async function deleteAgentById(agentId, options = {}) {
        if (!agentId) {
            return false;
        }

        const isCurrentAgent = agentId === state.currentSelectedItem.id;
        const fallbackAgent = state.agents.find((agent) => agent.id === agentId) || null;
        const agentLabel = options.agentName || fallbackAgent?.name || fallbackAgent?.id || agentId;

        closeTopicActionMenu();
        const confirmed = await ui.showConfirmDialog(
            `确定删除学科 ${agentLabel} 吗？这会删除该学科下的全部话题、笔记和资料。`,
            '删除学科',
            '删除',
            '取消',
            true,
        );
        if (!confirmed) {
            return false;
        }

        if (isCurrentAgent) {
            await stopHistoryWatcher();
        }

        const result = await chatAPI.deleteAgent(agentId);
        if (result?.error) {
            ui.showToastNotification(result.error, 'error');
            return false;
        }

        if (isCurrentAgent) {
            state.currentSelectedItem = { id: null, type: 'agent', name: null, avatarUrl: null, config: null };
            state.currentTopicId = null;
            state.currentChatHistory = [];
            clearTopicKnowledgeBaseDocuments();
            resetNotesState({
                clearTopicNotes: true,
                clearAgentNotes: true,
                clearSelection: true,
                clearActiveNote: true,
                closeDetailView: true,
                clearFlashcards: true,
            });
            resetComposerState({
                clearAttachments: true,
                clearSelectionContext: true,
            });
            syncWorkspaceContext();
            setPromptVisible(false);
        }

        await loadAgents();

        if (isCurrentAgent) {
            showWorkspaceOverview();
            renderTopics();
            syncCurrentTopicKnowledgeBaseControls();
            await renderCurrentHistory();
        }

        await refreshLogs();
        ui.showToastNotification(`已删除学科 ${agentLabel}。`, 'success');
        return true;
    }

    async function deleteCurrentAgent() {
        await deleteAgentById(state.currentSelectedItem.id, {
            agentName: state.currentSelectedItem.name || state.currentSelectedItem.id,
        });
    }

    function bindEvents() {
        el.agentSearchInput?.addEventListener('input', filterAgents);
        el.topicSearchInput?.addEventListener('input', filterTopics);
        el.createNewAgentBtn?.addEventListener('click', () => {
            void createAgent();
        });
        el.workspaceOverviewCreateAgentBtn?.addEventListener('click', () => {
            void createAgent();
        });
        el.workspaceBackToOverviewBtn?.addEventListener('click', () => {
            showWorkspaceOverview();
        });
        el.workspaceOpenSubjectBtn?.addEventListener('click', () => {
            showSubjectWorkspace();
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
        el.deleteAgentBtn?.addEventListener('click', () => {
            void deleteCurrentAgent();
        });
        el.topicList?.addEventListener('scroll', () => {
            closeTopicActionMenu();
        });
        windowObj.addEventListener('resize', () => {
            closeTopicActionMenu();
        });
        documentObj.addEventListener('click', (event) => {
            const target = event.target;
            if (!state.activeTopicMenu) {
                return;
            }

            if (target instanceof Element && (target.closest('#topicActionMenu') || target.closest('[data-topic-menu-button]'))) {
                return;
            }
            closeTopicActionMenu();
        });
        documentObj.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                closeTopicActionMenu();
            }
        });
    }

    return {
        getCurrentTopic,
        getCurrentTopicDisplayName,
        getCurrentAgentDisplayName,
        closeTopicActionMenu,
        syncWorkspaceContext,
        filterAgents,
        renderAgentList,
        filterTopics,
        renderTopics,
        renderSubjectOverview,
        loadAgents,
        loadTopics,
        renameTopic,
        setTopicUnreadState,
        toggleTopicLockState,
        clearCurrentConversationView,
        deleteTopicFromList,
        showWorkspaceOverview,
        selectTopic,
        selectAgent,
        showSubjectWorkspace,
        showManualNotesLibrary,
        syncWorkspaceView,
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
