import { isReaderSupportedDocument } from '../reader/readerUtils.js';
import { createSourceDom } from './sourceDom.js';
import {
    TOPIC_SOURCE_FILE_LIMIT,
    buildTopicSourceName,
    canReuseSelectedKnowledgeBaseDocuments,
    formatDocumentStatus,
    getKnowledgeBaseDocumentVisual,
    shouldPollKnowledgeBaseItems,
} from './sourceModel.js';
import { createSourceOperations } from './sourceOperations.js';

function createSourceController(deps = {}) {
    const store = deps.store;
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
    const getCurrentSelectedItem = deps.getCurrentSelectedItem || (() => store.getState().session.currentSelectedItem);
    const getCurrentTopicId = deps.getCurrentTopicId || (() => store.getState().session.currentTopicId);
    const getTopics = deps.getTopics || (() => store.getState().session.topics);

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

    function getSourceSlice() {
        return store.getState().source;
    }

    function patchSource(patch) {
        return store.patchState('source', (current, rootState) => ({
            ...current,
            ...(typeof patch === 'function' ? patch(current, rootState) : patch),
        }));
    }

    const state = {};
    Object.defineProperties(state, {
        knowledgeBases: {
            get: () => getSourceSlice().knowledgeBases,
            set: (value) => patchSource({ knowledgeBases: value }),
        },
        knowledgeBaseDocuments: {
            get: () => getSourceSlice().knowledgeBaseDocuments,
            set: (value) => patchSource({ knowledgeBaseDocuments: value }),
        },
        topicKnowledgeBaseDocuments: {
            get: () => getSourceSlice().topicKnowledgeBaseDocuments,
            set: (value) => patchSource({ topicKnowledgeBaseDocuments: value }),
        },
        knowledgeBaseDebugResult: {
            get: () => getSourceSlice().knowledgeBaseDebugResult,
            set: (value) => patchSource({ knowledgeBaseDebugResult: value }),
        },
        selectedKnowledgeBaseId: {
            get: () => getSourceSlice().selectedKnowledgeBaseId,
            set: (value) => patchSource({ selectedKnowledgeBaseId: value }),
        },
        activeSourceFileMenu: {
            get: () => getSourceSlice().activeSourceFileMenu,
            set: (value) => patchSource({ activeSourceFileMenu: value }),
        },
        currentSelectedItem: {
            get: () => getCurrentSelectedItem() || { id: null, name: null },
        },
        currentTopicId: {
            get: () => getCurrentTopicId(),
        },
        topics: {
            get: () => {
                const topics = getTopics();
                return Array.isArray(topics) ? topics : [];
            },
        },
    });

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

    const controller = {};
    const getFacade = () => controller;

    const dom = createSourceDom({
        state,
        el,
        windowObj,
        documentObj,
        openReaderDocument,
        isReaderDocumentActive,
        closeTopicActionMenu,
        scheduleFrame,
        formatRelativeTime,
        getSourceFileActions,
        getCurrentTopic,
        getCurrentTopicKnowledgeBaseId,
        getKnowledgeBaseName,
        getLeftSidebarMode,
        getSourceListScrollTop,
        setSourceListScrollTop,
        getFacade,
        onRetryDocument: async (documentId) => {
            const result = await chatAPI.retryKnowledgeBaseDocument(documentId);
            if (!result?.success) {
                ui.showToastNotification(`重试文档失败：${result?.error || '未知错误'}`, 'error');
                return;
            }

            state.knowledgeBaseDebugResult = null;
            await getFacade().loadKnowledgeBaseDocuments(state.selectedKnowledgeBaseId, { silent: true });
            await getFacade().loadCurrentTopicKnowledgeBaseDocuments({ silent: true, reuseSelected: false });
            await getFacade().loadKnowledgeBases({ silent: true });
        },
    });

    const operations = createSourceOperations({
        state,
        el,
        chatAPI,
        ui,
        renderTopics,
        openSettingsModal,
        loadTopics,
        syncReaderFromDocuments,
        getNativePathForFile,
        getCurrentTopic,
        getCurrentTopicKnowledgeBaseId,
        updateTopicKnowledgeBaseBinding,
        getFacade,
    });

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
                    await getFacade().refreshKnowledgeBasePollingTargets();
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

    function invokeFacade(methodName, ...args) {
        return getFacade()[methodName](...args);
    }

    function bindEvents() {
        windowObj.addEventListener('resize', () => {
            invokeFacade('hideSourceFileTooltip');
            invokeFacade('closeSourceFileActionMenu');
        });

        documentObj.addEventListener('click', (event) => {
            const target = event.target;
            if (!state.activeSourceFileMenu) {
                return;
            }

            if (target instanceof Element && (target.closest('#sourceFileActionMenu') || target.closest('[data-doc-menu-button]'))) {
                return;
            }
            invokeFacade('closeSourceFileActionMenu');
        });

        documentObj.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                invokeFacade('hideSourceFileTooltip');
                invokeFacade('closeSourceFileActionMenu');
            }
        });

        el.topicKnowledgeBaseFiles?.addEventListener('scroll', () => {
            setSourceListScrollTop(el.topicKnowledgeBaseFiles.scrollTop);
            invokeFacade('hideSourceFileTooltip');
            invokeFacade('closeSourceFileActionMenu');
        });
        el.createKnowledgeBaseBtn?.addEventListener('click', () => { void invokeFacade('createKnowledgeBase'); });
        el.renameKnowledgeBaseBtn?.addEventListener('click', () => { void invokeFacade('renameKnowledgeBase'); });
        el.deleteKnowledgeBaseBtn?.addEventListener('click', () => { void invokeFacade('deleteKnowledgeBase'); });
        el.importKnowledgeBaseFilesBtn?.addEventListener('click', () => {
            el.hiddenKnowledgeBaseFileInput?.click();
        });
        el.hiddenKnowledgeBaseFileInput?.addEventListener('change', async () => {
            await invokeFacade('importKnowledgeBaseFilesFromInput', el.hiddenKnowledgeBaseFileInput.files);
            el.hiddenKnowledgeBaseFileInput.value = '';
        });
        el.openKnowledgeBaseManagerBtn?.addEventListener('click', () => {
            void invokeFacade('openKnowledgeBaseManager');
        });
        el.importTopicKnowledgeBaseFilesBtn?.addEventListener('click', async () => {
            const kbId = getCurrentTopicKnowledgeBaseId() || await invokeFacade('ensureTopicSource', { silent: true });
            if (kbId) {
                el.hiddenTopicKnowledgeBaseFileInput?.click();
            }
        });
        el.hiddenTopicKnowledgeBaseFileInput?.addEventListener('change', async () => {
            const kbId = getCurrentTopicKnowledgeBaseId() || await invokeFacade('ensureTopicSource', { silent: true });
            if (kbId) {
                await invokeFacade('importKnowledgeBaseFilesForKb', kbId, el.hiddenTopicKnowledgeBaseFileInput.files);
            }
            el.hiddenTopicKnowledgeBaseFileInput.value = '';
        });
        el.currentTopicKnowledgeBaseSelect?.addEventListener('change', () => {
            const value = el.currentTopicKnowledgeBaseSelect.value || '';
            if (el.sourcePanelKnowledgeBaseSelect) {
                el.sourcePanelKnowledgeBaseSelect.value = value;
            }
            void invokeFacade('handleTopicKnowledgeBaseChange', value || null);
        });
        el.sourcePanelKnowledgeBaseSelect?.addEventListener('change', () => {
            const value = el.sourcePanelKnowledgeBaseSelect.value || '';
            if (el.currentTopicKnowledgeBaseSelect) {
                el.currentTopicKnowledgeBaseSelect.value = value;
            }
            void invokeFacade('handleTopicKnowledgeBaseChange', value || null);
        });
        el.runKnowledgeBaseSearchBtn?.addEventListener('click', () => { void invokeFacade('runKnowledgeBaseSearch'); });
        el.runKnowledgeBaseDebugBtn?.addEventListener('click', () => { void invokeFacade('runKnowledgeBaseDebug'); });
        el.knowledgeBaseDebugQueryInput?.addEventListener('keydown', async (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                if (event.ctrlKey || event.metaKey) {
                    await invokeFacade('runKnowledgeBaseDebug');
                    return;
                }
                await invokeFacade('runKnowledgeBaseSearch');
            }
        });
    }

    Object.assign(controller, {
        closeSourceFileActionMenu: dom.closeSourceFileActionMenu,
        createKnowledgeBase: operations.createKnowledgeBase,
        deleteKnowledgeBase: operations.deleteKnowledgeBase,
        ensureTopicSource: operations.ensureTopicSource,
        handleTopicKnowledgeBaseChange: operations.handleTopicKnowledgeBaseChange,
        hideSourceFileTooltip: dom.hideSourceFileTooltip,
        importKnowledgeBaseFilesForKb: operations.importKnowledgeBaseFilesForKb,
        importKnowledgeBaseFilesFromInput: operations.importKnowledgeBaseFilesFromInput,
        loadCurrentTopicKnowledgeBaseDocuments: operations.loadCurrentTopicKnowledgeBaseDocuments,
        loadKnowledgeBaseDocuments: operations.loadKnowledgeBaseDocuments,
        loadKnowledgeBases: operations.loadKnowledgeBases,
        openKnowledgeBaseManager: operations.openKnowledgeBaseManager,
        refreshKnowledgeBasePollingTargets: operations.refreshKnowledgeBasePollingTargets,
        refreshKnowledgeBaseSummaries: operations.refreshKnowledgeBaseSummaries,
        renameKnowledgeBase: operations.renameKnowledgeBase,
        renderKnowledgeBaseDebugResults: dom.renderKnowledgeBaseDebugResults,
        renderKnowledgeBaseManager: dom.renderKnowledgeBaseManager,
        renderTopicKnowledgeBaseFiles: dom.renderTopicKnowledgeBaseFiles,
        runKnowledgeBaseDebug: operations.runKnowledgeBaseDebug,
        runKnowledgeBaseSearch: operations.runKnowledgeBaseSearch,
        syncCurrentTopicKnowledgeBaseControls: dom.syncCurrentTopicKnowledgeBaseControls,
        syncKnowledgeBasePolling,
        bindEvents,
    });

    return controller;
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
