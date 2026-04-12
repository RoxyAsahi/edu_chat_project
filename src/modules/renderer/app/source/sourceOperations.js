import {
    TOPIC_SOURCE_FILE_LIMIT,
    buildTopicSourceName,
    canReuseSelectedKnowledgeBaseDocuments,
} from './sourceModel.js';

function createSourceOperations(deps = {}) {
    const state = deps.state;
    const el = deps.el;
    const chatAPI = deps.chatAPI;
    const ui = deps.ui;
    const renderTopics = deps.renderTopics || (() => {});
    const openSettingsModal = deps.openSettingsModal || (() => {});
    const loadTopics = deps.loadTopics || (async () => {});
    const syncReaderFromDocuments = deps.syncReaderFromDocuments || (() => {});
    const getNativePathForFile = deps.getNativePathForFile || (async () => '');
    const getCurrentTopic = deps.getCurrentTopic || (() => null);
    const getCurrentTopicKnowledgeBaseId = deps.getCurrentTopicKnowledgeBaseId || (() => null);
    const updateTopicKnowledgeBaseBinding = deps.updateTopicKnowledgeBaseBinding || (() => {});
    const getFacade = deps.getFacade || (() => ({}));

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
            getFacade().renderKnowledgeBaseManager();
            getFacade().renderTopicKnowledgeBaseFiles();
            getFacade().syncCurrentTopicKnowledgeBaseControls();
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
                getFacade().renderTopicKnowledgeBaseFiles();
            } else {
                getFacade().renderKnowledgeBaseManager();
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
                getFacade().renderTopicKnowledgeBaseFiles();
            } else {
                getFacade().renderKnowledgeBaseManager();
            }
            return [];
        }

        state[target] = Array.isArray(result.items) ? result.items : [];
        syncReaderFromDocuments(state[target], { resetIfMissing: isTopicTarget });

        if (isTopicTarget) {
            getFacade().renderTopicKnowledgeBaseFiles();
        } else {
            getFacade().renderKnowledgeBaseManager();
        }
        return state[target];
    }

    async function loadCurrentTopicKnowledgeBaseDocuments(options = {}) {
        const kbId = getCurrentTopicKnowledgeBaseId();
        if (!kbId) {
            state.topicKnowledgeBaseDocuments = [];
            getFacade().renderTopicKnowledgeBaseFiles();
            return [];
        }

        if (canReuseSelectedKnowledgeBaseDocuments({
            topicKnowledgeBaseId: kbId,
            selectedKnowledgeBaseId: state.selectedKnowledgeBaseId,
            reuseSelected: options.reuseSelected,
        })) {
            state.topicKnowledgeBaseDocuments = [...state.knowledgeBaseDocuments];
            syncReaderFromDocuments(state.topicKnowledgeBaseDocuments, { resetIfMissing: true });
            getFacade().renderTopicKnowledgeBaseFiles();
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
        getFacade().renderKnowledgeBaseManager();
        getFacade().renderTopicKnowledgeBaseFiles();
        getFacade().syncCurrentTopicKnowledgeBaseControls();
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
            getFacade().renderTopicKnowledgeBaseFiles();
        } else {
            await Promise.all([
                loadKnowledgeBaseDocuments(selectedKbId, { silent: true }),
                loadCurrentTopicKnowledgeBaseDocuments({ silent: true }),
            ]);
        }

        getFacade().renderKnowledgeBaseManager();
        getFacade().renderTopicKnowledgeBaseFiles();
        getFacade().syncCurrentTopicKnowledgeBaseControls();
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
        getFacade().syncCurrentTopicKnowledgeBaseControls();

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

        getFacade().renderKnowledgeBaseManager();
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
            getFacade().syncCurrentTopicKnowledgeBaseControls();
            return;
        }

        updateTopicKnowledgeBaseBinding(kbId);
        renderTopics();
        getFacade().syncCurrentTopicKnowledgeBaseControls();
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
        getFacade().renderKnowledgeBaseDebugResults();
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
        getFacade().renderKnowledgeBaseDebugResults();
    }

    return {
        createKnowledgeBase,
        deleteKnowledgeBase,
        ensureTopicSource,
        handleTopicKnowledgeBaseChange,
        importKnowledgeBaseFilesForKb,
        importKnowledgeBaseFilesFromInput,
        loadCurrentTopicKnowledgeBaseDocuments,
        loadKnowledgeBaseDocuments,
        loadKnowledgeBases,
        openKnowledgeBaseManager,
        refreshKnowledgeBasePollingTargets,
        refreshKnowledgeBaseSummaries,
        renameKnowledgeBase,
        runKnowledgeBaseDebug,
        runKnowledgeBaseSearch,
    };
}

export {
    createSourceOperations,
};
