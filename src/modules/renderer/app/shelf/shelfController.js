import {
    TOPIC_SOURCE_FILE_LIMIT,
    escapeHtml,
    formatDocumentStatus,
    getKnowledgeBaseDocumentVisual,
} from '../source/sourceModel.js';

function createShelfController(deps = {}) {
    const store = deps.store;
    const el = deps.el;
    const chatAPI = deps.chatAPI;
    const ui = deps.ui;
    const windowObj = deps.windowObj || window;
    const documentObj = deps.documentObj || document;
    const getNativePathForFile = deps.getNativePathForFile || (async () => '');
    const showSourceShelfPage = deps.showSourceShelfPage || (() => {});
    const ensureTopicSource = deps.ensureTopicSource || (async () => null);
    const loadCurrentTopicKnowledgeBaseDocuments = deps.loadCurrentTopicKnowledgeBaseDocuments || (async () => []);
    const loadKnowledgeBases = deps.loadKnowledgeBases || (async () => {});
    const updateTopicSourceSelection = deps.updateTopicSourceSelection || (() => {});
    const getCurrentSelectedItem = deps.getCurrentSelectedItem || (() => store.getState().session.currentSelectedItem);
    const getCurrentTopicId = deps.getCurrentTopicId || (() => store.getState().session.currentTopicId);
    const getCurrentTopic = deps.getCurrentTopic || (() => null);

    let pollTimer = null;
    let pollInFlight = false;

    function getShelfSlice() {
        return store.getState().shelf;
    }

    function getSourceSlice() {
        return store.getState().source;
    }

    function patchShelf(patch) {
        return store.patchState('shelf', (current, rootState) => ({
            ...current,
            ...(typeof patch === 'function' ? patch(current, rootState) : patch),
        }));
    }

    const state = {};
    Object.defineProperties(state, {
        groups: {
            get: () => getShelfSlice().groups || [],
            set: (value) => patchShelf({ groups: Array.isArray(value) ? value : [] }),
        },
        selectedGroupId: {
            get: () => getShelfSlice().selectedGroupId || null,
            set: (value) => patchShelf({ selectedGroupId: value || null }),
        },
        documents: {
            get: () => getShelfSlice().documents || [],
            set: (value) => patchShelf({ documents: Array.isArray(value) ? value : [] }),
        },
        pickerOpen: {
            get: () => getShelfSlice().pickerOpen === true,
            set: (value) => patchShelf({ pickerOpen: value === true }),
        },
        pickerGroups: {
            get: () => getShelfSlice().pickerGroups || [],
            set: (value) => patchShelf({ pickerGroups: Array.isArray(value) ? value : [] }),
        },
        pickerDocumentsByGroupId: {
            get: () => getShelfSlice().pickerDocumentsByGroupId || {},
            set: (value) => patchShelf({ pickerDocumentsByGroupId: value && typeof value === 'object' ? value : {} }),
        },
        pickerSelectedDocumentIds: {
            get: () => getShelfSlice().pickerSelectedDocumentIds || [],
            set: (value) => patchShelf({ pickerSelectedDocumentIds: normalizeIds(value) }),
        },
    });

    function normalizeIds(values = []) {
        return [...new Set((Array.isArray(values) ? values : [])
            .map((id) => String(id || '').trim())
            .filter(Boolean))];
    }

    function formatRelativeTime(timestamp) {
        if (!timestamp) {
            return '未知时间';
        }
        try {
            return new Date(timestamp).toLocaleString();
        } catch (_error) {
            return '未知时间';
        }
    }

    function getSelectedGroup() {
        return state.groups.find((group) => group.id === state.selectedGroupId) || null;
    }

    function getPickerDocuments() {
        return Object.values(state.pickerDocumentsByGroupId)
            .flatMap((items) => (Array.isArray(items) ? items : []));
    }

    function getPickerDocumentById(documentId) {
        const normalizedDocumentId = String(documentId || '').trim();
        return getPickerDocuments().find((item) => item.id === normalizedDocumentId) || null;
    }

    function isDocumentReusable(documentItem = {}) {
        return documentItem.status === 'done';
    }

    function getTopicDocumentHashSet() {
        return new Set((getSourceSlice().topicKnowledgeBaseDocuments || [])
            .map((item) => String(item?.fileHash || '').trim())
            .filter(Boolean));
    }

    function shouldPollShelfItems() {
        const pickerDocuments = getPickerDocuments();
        return [...state.documents, ...pickerDocuments].some((item) => (
            item.status === 'pending'
            || item.status === 'processing'
            || item.guideStatus === 'pending'
            || item.guideStatus === 'processing'
        ));
    }

    function syncPolling() {
        const shouldPoll = shouldPollShelfItems();
        if (shouldPoll && !pollTimer) {
            pollTimer = windowObj.setInterval(async () => {
                if (pollInFlight) {
                    return;
                }

                pollInFlight = true;
                try {
                    if (state.selectedGroupId) {
                        await loadShelfDocuments(state.selectedGroupId, { silent: true });
                    }
                    if (state.pickerOpen) {
                        await loadPickerData({ silent: true });
                    }
                } finally {
                    pollInFlight = false;
                }
            }, 2000);
            return;
        }

        if (!shouldPoll && pollTimer) {
            windowObj.clearInterval(pollTimer);
            pollTimer = null;
            pollInFlight = false;
        }
    }

    function setGroupNameInput(value = '') {
        if (el.sourceShelfGroupNameInput) {
            el.sourceShelfGroupNameInput.value = value;
        }
    }

    async function promptForGroupName({ title, defaultValue = '', preferInput = true } = {}) {
        const typedName = String(el.sourceShelfGroupNameInput?.value || '').trim();
        if (preferInput && typedName) {
            return typedName;
        }
        if (typeof ui.showPromptDialog !== 'function') {
            ui.showToastNotification('请输入分组名称。', 'warning');
            return '';
        }
        const result = await ui.showPromptDialog({
            title,
            message: '资料会按这个名称归入书架分组。',
            placeholder: '分组名称',
            defaultValue,
            confirmText: '保存',
            cancelText: '取消',
            validate(value) {
                return String(value || '').trim() ? '' : '分组名称不能为空。';
            },
        });
        return String(result || '').trim();
    }

    async function promptForDocumentName(documentItem = {}) {
        if (typeof ui.showPromptDialog !== 'function') {
            ui.showToastNotification('当前版本暂不支持重命名资料。', 'warning');
            return '';
        }

        const name = String(documentItem.name || '').trim();
        const dotIndex = name.lastIndexOf('.');
        const extension = dotIndex > 0 && dotIndex < name.length - 1 ? name.slice(dotIndex) : '';
        const baseName = extension ? name.slice(0, dotIndex) : name;
        const result = await ui.showPromptDialog({
            title: '重命名资料',
            message: extension ? `原扩展名 ${extension} 会自动保留。` : '更新资料文件名。',
            placeholder: '文件名',
            defaultValue: baseName,
            confirmText: '保存',
            cancelText: '取消',
            validate(value) {
                const trimmed = String(value || '').trim();
                if (!trimmed) {
                    return '文件名不能为空。';
                }
                if (/[\\/]/.test(trimmed)) {
                    return '文件名不能包含路径分隔符。';
                }
                return '';
            },
        });
        const normalized = String(result || '').trim();
        return normalized ? `${normalized}${extension}` : '';
    }

    async function loadShelfDocuments(groupId = state.selectedGroupId, options = {}) {
        if (!groupId) {
            state.documents = [];
            renderShelfPage();
            return [];
        }

        const result = await chatAPI.listKnowledgeBaseDocuments(groupId).catch((error) => ({
            success: false,
            error: error.message,
            items: [],
        }));
        if (!result?.success) {
            state.documents = [];
            if (options.silent !== true) {
                ui.showToastNotification(`加载资料失败：${result?.error || '未知错误'}`, 'error');
            }
            renderShelfPage();
            return [];
        }

        state.documents = Array.isArray(result.items) ? result.items : [];
        renderShelfPage();
        return state.documents;
    }

    async function loadShelfGroups(options = {}) {
        const result = await chatAPI.listKnowledgeBases({ kind: 'shelf' }).catch((error) => ({
            success: false,
            error: error.message,
            items: [],
        }));
        if (!result?.success) {
            state.groups = [];
            state.selectedGroupId = null;
            state.documents = [];
            if (options.silent !== true) {
                ui.showToastNotification(`加载资料书架失败：${result?.error || '未知错误'}`, 'error');
            }
            renderShelfPage();
            return false;
        }

        state.groups = Array.isArray(result.items) ? result.items : [];
        if (!state.groups.some((group) => group.id === state.selectedGroupId)) {
            state.selectedGroupId = state.groups[0]?.id || null;
        }
        setGroupNameInput(getSelectedGroup()?.name || '');
        if (state.selectedGroupId) {
            await loadShelfDocuments(state.selectedGroupId, { silent: true });
        } else {
            state.documents = [];
            renderShelfPage();
        }
        return true;
    }

    async function loadPickerData(options = {}) {
        const result = await chatAPI.listKnowledgeBases({ kind: 'shelf' }).catch((error) => ({
            success: false,
            error: error.message,
            items: [],
        }));
        if (!result?.success) {
            state.pickerGroups = [];
            state.pickerDocumentsByGroupId = {};
            if (options.silent !== true) {
                ui.showToastNotification(`加载资料书架失败：${result?.error || '未知错误'}`, 'error');
            }
            renderPicker();
            return false;
        }

        const groups = Array.isArray(result.items) ? result.items : [];
        const documentEntries = await Promise.all(groups.map(async (group) => {
            const docsResult = await chatAPI.listKnowledgeBaseDocuments(group.id).catch(() => ({ success: false, items: [] }));
            return [group.id, docsResult?.success && Array.isArray(docsResult.items) ? docsResult.items : []];
        }));
        state.pickerGroups = groups;
        state.pickerDocumentsByGroupId = Object.fromEntries(documentEntries);
        state.pickerSelectedDocumentIds = state.pickerSelectedDocumentIds.filter((id) => {
            const documentItem = getPickerDocumentById(id);
            return documentItem && isDocumentReusable(documentItem);
        });
        renderPicker();
        return true;
    }

    async function createShelfGroup() {
        const typedName = String(el.sourceShelfGroupNameInput?.value || '').trim();
        const currentGroupName = String(getSelectedGroup()?.name || '').trim();
        const shouldUseTypedName = Boolean(typedName && typedName !== currentGroupName);
        const name = await promptForGroupName({
            title: '新建资料分组',
            defaultValue: shouldUseTypedName ? typedName : '',
            preferInput: shouldUseTypedName,
        });
        if (!name) {
            return;
        }

        const result = await chatAPI.createKnowledgeBase({ name, kind: 'shelf' }).catch((error) => ({
            success: false,
            error: error.message,
            item: null,
        }));
        if (!result?.success || !result.item?.id) {
            ui.showToastNotification(`创建资料分组失败：${result?.error || '未知错误'}`, 'error');
            return;
        }

        state.selectedGroupId = result.item.id;
        setGroupNameInput(result.item.name || name);
        await loadShelfGroups({ silent: true });
        ui.showToastNotification('已创建资料分组。', 'success');
    }

    async function renameShelfGroup() {
        const selectedGroup = getSelectedGroup();
        if (!selectedGroup) {
            return;
        }

        const name = await promptForGroupName({
            title: '重命名资料分组',
            defaultValue: selectedGroup.name || '',
        });
        if (!name || name === selectedGroup.name) {
            return;
        }

        const result = await chatAPI.updateKnowledgeBase(selectedGroup.id, { name }).catch((error) => ({
            success: false,
            error: error.message,
        }));
        if (!result?.success) {
            ui.showToastNotification(`重命名资料分组失败：${result?.error || '未知错误'}`, 'error');
            return;
        }
        await loadShelfGroups({ silent: true });
        ui.showToastNotification('已重命名资料分组。', 'success');
    }

    async function deleteShelfGroup() {
        const selectedGroup = getSelectedGroup();
        if (!selectedGroup) {
            return;
        }

        const confirmed = await ui.showConfirmDialog(
            `确定删除资料分组 ${selectedGroup.name || selectedGroup.id} 吗？`,
            '删除资料分组',
            '删除',
            '取消',
            true
        );
        if (!confirmed) {
            return;
        }

        const result = await chatAPI.deleteKnowledgeBase(selectedGroup.id).catch((error) => ({
            success: false,
            error: error.message,
        }));
        if (!result?.success) {
            ui.showToastNotification(`删除资料分组失败：${result?.error || '未知错误'}`, 'error');
            return;
        }
        state.selectedGroupId = null;
        await loadShelfGroups({ silent: true });
        ui.showToastNotification('已删除资料分组。', 'success');
    }

    async function importShelfFiles(files) {
        const selectedGroup = getSelectedGroup();
        const fileEntries = Array.from(files || []);
        if (!selectedGroup) {
            ui.showToastNotification('请先新建或选择一个资料分组。', 'warning');
            return;
        }
        if (fileEntries.length === 0) {
            return;
        }

        const payloads = (await Promise.all(fileEntries.map(async (file) => ({
            name: file.name,
            path: await getNativePathForFile(file),
            type: file.type,
            size: file.size,
        })))).filter((item) => item.path);

        if (payloads.length === 0) {
            ui.showToastNotification('当前文件未能解析到本地路径，无法导入资料书架。', 'warning');
            return;
        }

        const result = await chatAPI.importKnowledgeBaseFiles(selectedGroup.id, payloads).catch((error) => ({
            success: false,
            error: error.message,
        }));
        if (!result?.success) {
            ui.showToastNotification(`导入资料失败：${result?.error || '未知错误'}`, 'error');
            return;
        }

        await loadShelfGroups({ silent: true });
        ui.showToastNotification(`已开始导入 ${payloads.length} 个资料文件。`, 'success');
    }

    async function renameShelfDocument(documentItem = {}) {
        const documentId = String(documentItem?.id || '').trim();
        if (!documentId) {
            return;
        }

        const nextName = await promptForDocumentName(documentItem);
        if (!nextName || nextName === documentItem.name) {
            return;
        }

        const result = await chatAPI.renameKnowledgeBaseDocument(documentId, { name: nextName }).catch((error) => ({
            success: false,
            error: error.message,
        }));
        if (!result?.success) {
            ui.showToastNotification(`重命名资料失败：${result?.error || '未知错误'}`, 'error');
            return;
        }
        await loadShelfDocuments(state.selectedGroupId, { silent: true });
        if (state.pickerOpen) {
            await loadPickerData({ silent: true });
        }
        ui.showToastNotification('已重命名资料。', 'success');
    }

    async function deleteShelfDocument(documentItem = {}) {
        const documentId = String(documentItem?.id || '').trim();
        if (!documentId) {
            return;
        }

        const confirmed = await ui.showConfirmDialog(
            `确定删除资料 ${documentItem.name || documentId} 吗？`,
            '删除资料',
            '删除',
            '取消',
            true
        );
        if (!confirmed) {
            return;
        }

        const result = await chatAPI.deleteKnowledgeBaseDocument(documentId).catch((error) => ({
            success: false,
            error: error.message,
        }));
        if (!result?.success) {
            ui.showToastNotification(`删除资料失败：${result?.error || '未知错误'}`, 'error');
            return;
        }
        await loadShelfDocuments(state.selectedGroupId, { silent: true });
        if (state.pickerOpen) {
            await loadPickerData({ silent: true });
        }
        ui.showToastNotification('已删除资料。', 'success');
    }

    function renderShelfGroupButton(group) {
        const button = documentObj.createElement('button');
        button.type = 'button';
        button.className = `source-shelf-group-card${group.id === state.selectedGroupId ? ' source-shelf-group-card--active' : ''}`;
        button.innerHTML = `
            <span class="source-shelf-group-card__icon material-symbols-outlined" aria-hidden="true">folder</span>
            <span class="source-shelf-group-card__body">
                <strong>${escapeHtml(group.name)}</strong>
                <span>${group.documentCount || 0} 份资料 · ${group.doneCount || 0} 可复用</span>
            </span>
        `;
        button.addEventListener('click', async () => {
            state.selectedGroupId = group.id;
            setGroupNameInput(group.name || '');
            await loadShelfDocuments(group.id, { silent: true });
        });
        return button;
    }

    function renderShelfEmptyState({ icon = 'shelves', title = '', detail = '', actionLabel = '', onAction = null } = {}) {
        const empty = documentObj.createElement('div');
        empty.className = 'source-shelf-empty';
        empty.innerHTML = `
            <span class="source-shelf-empty__icon material-symbols-outlined" aria-hidden="true">${escapeHtml(icon)}</span>
            <strong>${escapeHtml(title)}</strong>
            <span>${escapeHtml(detail)}</span>
        `;
        if (actionLabel && typeof onAction === 'function') {
            const actionButton = documentObj.createElement('button');
            actionButton.type = 'button';
            actionButton.className = 'accent-button source-shelf-empty__action';
            actionButton.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">add</span><span>${escapeHtml(actionLabel)}</span>`;
            actionButton.addEventListener('click', onAction);
            empty.appendChild(actionButton);
        }
        return empty;
    }

    function renderShelfDocumentCard(documentItem) {
        const visual = getKnowledgeBaseDocumentVisual(documentItem);
        const card = documentObj.createElement('article');
        card.className = 'source-shelf-card';
        card.classList.toggle('source-shelf-card--processing', visual.spinning === true);
        card.innerHTML = `
            <header class="source-shelf-card__header">
                <span class="source-shelf-card__icon source-shelf-card__icon--${escapeHtml(visual.tone)} material-symbols-outlined ${visual.spinning ? 'source-shelf-card__icon--spinning' : ''}" aria-hidden="true">${escapeHtml(visual.icon)}</span>
                <div class="source-shelf-card__title">
                    <strong>${escapeHtml(documentItem.name)}</strong>
                    <span>${escapeHtml(formatDocumentStatus(documentItem))}</span>
                </div>
                <div class="source-shelf-card__actions">
                    <button type="button" class="ghost-button icon-btn" data-shelf-doc-action="rename" aria-label="重命名资料">
                        <span class="material-symbols-outlined">edit</span>
                    </button>
                    <button type="button" class="ghost-button icon-btn" data-shelf-doc-action="delete" aria-label="删除资料">
                        <span class="material-symbols-outlined">delete</span>
                    </button>
                </div>
            </header>
            <div class="source-shelf-card__meta">
                <span>${escapeHtml(formatRelativeTime(documentItem.updatedAt || documentItem.createdAt))}</span>
                <span>${Math.max(0, Math.round((documentItem.fileSize || 0) / 1024))} KB</span>
            </div>
            ${documentItem.lastError ? `<p class="source-shelf-card__error">${escapeHtml(documentItem.lastError)}</p>` : ''}
        `;
        card.querySelector('[data-shelf-doc-action="rename"]')?.addEventListener('click', (event) => {
            event.stopPropagation();
            void renameShelfDocument(documentItem);
        });
        card.querySelector('[data-shelf-doc-action="delete"]')?.addEventListener('click', (event) => {
            event.stopPropagation();
            void deleteShelfDocument(documentItem);
        });
        return card;
    }

    function renderShelfPage() {
        const selectedGroup = getSelectedGroup();
        const groupCount = state.groups.length;
        const totalDocs = state.groups.reduce((sum, group) => sum + Number(group.documentCount || 0), 0);
        const reusableDocs = state.groups.reduce((sum, group) => sum + Number(group.doneCount || 0), 0);
        if (el.sourceShelfSubtitle) {
            el.sourceShelfSubtitle.textContent = state.groups.length > 0
                ? `共 ${state.groups.length} 个分组，${totalDocs} 份资料可集中收纳和复用。`
                : '提前收纳可复用资料，再添加到任意对话来源。';
        }
        if (el.sourceShelfGroupCount) {
            el.sourceShelfGroupCount.textContent = String(groupCount);
        }
        if (el.sourceShelfDocumentCount) {
            el.sourceShelfDocumentCount.textContent = String(totalDocs);
        }
        if (el.sourceShelfReusableCount) {
            el.sourceShelfReusableCount.textContent = String(reusableDocs);
        }

        if (el.sourceShelfGroupNameInput && documentObj.activeElement !== el.sourceShelfGroupNameInput) {
            el.sourceShelfGroupNameInput.value = selectedGroup?.name || '';
        }
        if (el.renameSourceShelfGroupBtn) {
            el.renameSourceShelfGroupBtn.disabled = !selectedGroup;
        }
        if (el.deleteSourceShelfGroupBtn) {
            el.deleteSourceShelfGroupBtn.disabled = !selectedGroup;
        }
        if (el.importSourceShelfFilesBtn) {
            el.importSourceShelfFilesBtn.disabled = !selectedGroup;
        }

        if (el.sourceShelfGroups) {
            el.sourceShelfGroups.innerHTML = '';
            if (state.groups.length === 0) {
                el.sourceShelfGroups.innerHTML = '<div class="source-shelf-groups-empty"><strong>暂无分组</strong><span>新建后即可上传资料。</span></div>';
            } else {
                state.groups.forEach((group) => {
                    el.sourceShelfGroups.appendChild(renderShelfGroupButton(group));
                });
            }
        }

        if (el.sourceShelfDocuments) {
            el.sourceShelfDocuments.innerHTML = '';
            if (!selectedGroup) {
                el.sourceShelfDocuments.classList.add('source-shelf-grid--empty');
                el.sourceShelfDocuments.appendChild(renderShelfEmptyState({
                    icon: 'create_new_folder',
                    title: '还没有资料分组',
                    detail: '先建一个分组，再把资料放进来。',
                    actionLabel: '新建分组',
                    onAction: () => {
                        void createShelfGroup();
                    },
                }));
            } else if (state.documents.length === 0) {
                el.sourceShelfDocuments.classList.add('source-shelf-grid--empty');
                el.sourceShelfDocuments.appendChild(renderShelfEmptyState({
                    icon: 'upload_file',
                    title: '这个分组还没有资料',
                    detail: '支持 PDF、DOCX、Markdown、文本和图片。',
                    actionLabel: '上传资料',
                    onAction: () => {
                        el.hiddenSourceShelfFileInput?.click();
                    },
                }));
            } else {
                el.sourceShelfDocuments.classList.remove('source-shelf-grid--empty');
                state.documents.forEach((documentItem) => {
                    el.sourceShelfDocuments.appendChild(renderShelfDocumentCard(documentItem));
                });
            }
        }
        syncPolling();
    }

    function renderPickerDocument(documentItem) {
        const topicHashes = getTopicDocumentHashSet();
        const alreadyInTopic = topicHashes.has(String(documentItem.fileHash || '').trim());
        const reusable = isDocumentReusable(documentItem) && !alreadyInTopic;
        const selected = state.pickerSelectedDocumentIds.includes(documentItem.id);
        const remainingSlots = Math.max(0, TOPIC_SOURCE_FILE_LIMIT - (getSourceSlice().topicKnowledgeBaseDocuments || []).length);
        const selectionLimitReached = reusable && !selected && state.pickerSelectedDocumentIds.length >= remainingSlots;
        const visual = getKnowledgeBaseDocumentVisual(documentItem);
        const button = documentObj.createElement('button');
        button.type = 'button';
        button.className = `source-shelf-picker-card${selected ? ' source-shelf-picker-card--selected' : ''}`;
        button.disabled = !reusable || selectionLimitReached;
        button.dataset.shelfPickerDoc = documentItem.id;
        button.innerHTML = `
            <span class="source-shelf-picker-card__check material-symbols-outlined" aria-hidden="true">${selected ? 'check_circle' : 'radio_button_unchecked'}</span>
            <span class="source-shelf-picker-card__icon source-shelf-card__icon--${escapeHtml(visual.tone)} material-symbols-outlined ${visual.spinning ? 'source-shelf-card__icon--spinning' : ''}" aria-hidden="true">${escapeHtml(visual.icon)}</span>
            <span class="source-shelf-picker-card__body">
                <strong>${escapeHtml(documentItem.name)}</strong>
                <span>${alreadyInTopic ? '已在当前来源' : (selectionLimitReached ? '已达到当前来源上限' : escapeHtml(formatDocumentStatus(documentItem)))}</span>
            </span>
        `;
        button.addEventListener('click', () => {
            togglePickerDocument(documentItem.id);
        });
        return button;
    }

    function renderPicker() {
        if (!el.sourceShelfPickerModal || !el.sourceShelfPickerBody) {
            return;
        }

        const selectedCount = state.pickerSelectedDocumentIds.length;
        const remainingSlots = Math.max(0, TOPIC_SOURCE_FILE_LIMIT - (getSourceSlice().topicKnowledgeBaseDocuments || []).length);
        if (el.sourceShelfPickerSummary) {
            if (remainingSlots <= 0) {
                el.sourceShelfPickerSummary.textContent = `当前话题已达到 ${TOPIC_SOURCE_FILE_LIMIT} 个资料上限。`;
            } else if (selectedCount > 0) {
                el.sourceShelfPickerSummary.textContent = `已选择 ${selectedCount} 份资料，还可加入 ${Math.max(0, remainingSlots - selectedCount)} 份。`;
            } else {
                el.sourceShelfPickerSummary.textContent = '只可选择已完成入库、且当前来源尚未包含的资料。';
            }
        }
        if (el.sourceShelfPickerConfirmBtn) {
            el.sourceShelfPickerConfirmBtn.disabled = selectedCount === 0;
        }

        el.sourceShelfPickerBody.innerHTML = '';
        if (state.pickerGroups.length === 0) {
            el.sourceShelfPickerBody.innerHTML = '<div class="empty-list-state source-shelf-picker-empty"><strong>资料书架还是空的</strong><span>先到资料书架页面创建分组并上传资料。</span></div>';
            syncPolling();
            return;
        }

        state.pickerGroups.forEach((group) => {
            const section = documentObj.createElement('section');
            section.className = 'source-shelf-picker-group';
            const documents = state.pickerDocumentsByGroupId[group.id] || [];
            section.innerHTML = `
                <header class="source-shelf-picker-group__header">
                    <strong>${escapeHtml(group.name)}</strong>
                    <span>${documents.length} 份资料</span>
                </header>
            `;
            const grid = documentObj.createElement('div');
            grid.className = 'source-shelf-picker-group__grid';
            if (documents.length === 0) {
                grid.innerHTML = '<div class="empty-list-state empty-list-state--compact"><span>这个分组还没有资料。</span></div>';
            } else {
                documents.forEach((documentItem) => {
                    grid.appendChild(renderPickerDocument(documentItem));
                });
            }
            section.appendChild(grid);
            el.sourceShelfPickerBody.appendChild(section);
        });
        syncPolling();
    }

    function togglePickerDocument(documentId) {
        const documentItem = getPickerDocumentById(documentId);
        if (!documentItem || !isDocumentReusable(documentItem)) {
            return;
        }
        if (getTopicDocumentHashSet().has(String(documentItem.fileHash || '').trim())) {
            return;
        }

        const selectedSet = new Set(state.pickerSelectedDocumentIds);
        if (selectedSet.has(documentId)) {
            selectedSet.delete(documentId);
        } else {
            const remainingSlots = Math.max(0, TOPIC_SOURCE_FILE_LIMIT - (getSourceSlice().topicKnowledgeBaseDocuments || []).length);
            if (remainingSlots <= 0) {
                ui.showToastNotification(`当前话题最多绑定 ${TOPIC_SOURCE_FILE_LIMIT} 个资料文件。`, 'warning');
                return;
            }
            if (selectedSet.size >= remainingSlots) {
                ui.showToastNotification(`本次最多还可加入 ${remainingSlots} 份资料。`, 'warning');
                return;
            }
            selectedSet.add(documentId);
        }
        state.pickerSelectedDocumentIds = [...selectedSet];
        renderPicker();
    }

    async function confirmPickerSelection() {
        const selectedDocuments = state.pickerSelectedDocumentIds
            .map((id) => getPickerDocumentById(id))
            .filter((item) => item && isDocumentReusable(item));
        if (selectedDocuments.length === 0) {
            return;
        }

        const topicDocuments = getSourceSlice().topicKnowledgeBaseDocuments || [];
        const topicHashes = getTopicDocumentHashSet();
        const newDocuments = selectedDocuments.filter((item) => !topicHashes.has(String(item.fileHash || '').trim()));
        if (newDocuments.length === 0) {
            ui.showToastNotification('所选资料已在当前来源中。', 'info');
            closeShelfPicker();
            return;
        }

        if (topicDocuments.length + newDocuments.length > TOPIC_SOURCE_FILE_LIMIT) {
            ui.showToastNotification(`当前话题最多绑定 ${TOPIC_SOURCE_FILE_LIMIT} 个资料文件。`, 'warning');
            return;
        }

        const kbId = await ensureTopicSource({ silent: true });
        if (!kbId) {
            ui.showToastNotification('当前话题 Source 尚未准备好。', 'warning');
            return;
        }

        const result = await chatAPI.copyKnowledgeBaseDocuments(kbId, newDocuments.map((item) => item.id)).catch((error) => ({
            success: false,
            error: error.message,
            items: [],
        }));
        if (!result?.success) {
            ui.showToastNotification(`加入资料失败：${result?.error || '未知错误'}`, 'error');
            return;
        }

        const copiedIds = Array.isArray(result.items) ? result.items.map((item) => item?.id).filter(Boolean) : [];
        const currentTopic = getCurrentTopic();
        if (Array.isArray(currentTopic?.selectedKnowledgeBaseDocumentIds) && copiedIds.length > 0) {
            const nextSelection = normalizeIds([...currentTopic.selectedKnowledgeBaseDocumentIds, ...copiedIds]);
            const agentId = getCurrentSelectedItem()?.id;
            const topicId = getCurrentTopicId();
            if (agentId && topicId && typeof chatAPI.setTopicSourceSelection === 'function') {
                const selectionResult = await chatAPI.setTopicSourceSelection(agentId, topicId, nextSelection).catch((error) => ({
                    success: false,
                    error: error.message,
                }));
                if (selectionResult?.success) {
                    updateTopicSourceSelection(nextSelection);
                }
            }
        }

        await Promise.all([
            loadCurrentTopicKnowledgeBaseDocuments({ silent: true, reuseSelected: false }),
            loadKnowledgeBases({ silent: true }),
        ]);
        ui.showToastNotification(`已加入 ${copiedIds.length || newDocuments.length} 份资料。`, 'success');
        closeShelfPicker();
    }

    async function openShelfPage() {
        showSourceShelfPage();
        await loadShelfGroups({ silent: true });
    }

    async function openShelfPicker() {
        if (!getCurrentSelectedItem()?.id || !getCurrentTopicId()) {
            ui.showToastNotification('请先选择一个话题，再从资料书架添加来源。', 'warning');
            return;
        }

        state.pickerOpen = true;
        state.pickerSelectedDocumentIds = [];
        el.sourceShelfPickerModal?.classList.remove('hidden');
        el.sourceShelfPickerModal?.setAttribute('aria-hidden', 'false');
        documentObj.body?.classList.add('source-shelf-picker-open');
        renderPicker();
        await loadPickerData({ silent: true });
    }

    function closeShelfPicker() {
        state.pickerOpen = false;
        state.pickerSelectedDocumentIds = [];
        el.sourceShelfPickerModal?.classList.add('hidden');
        el.sourceShelfPickerModal?.setAttribute('aria-hidden', 'true');
        documentObj.body?.classList.remove('source-shelf-picker-open');
        renderPicker();
    }

    function bindEvents() {
        el.createSourceShelfGroupBtn?.addEventListener('click', () => {
            void createShelfGroup();
        });
        el.renameSourceShelfGroupBtn?.addEventListener('click', () => {
            void renameShelfGroup();
        });
        el.deleteSourceShelfGroupBtn?.addEventListener('click', () => {
            void deleteShelfGroup();
        });
        el.importSourceShelfFilesBtn?.addEventListener('click', () => {
            if (!getSelectedGroup()) {
                ui.showToastNotification('请先新建或选择一个资料分组。', 'warning');
                return;
            }
            el.hiddenSourceShelfFileInput?.click();
        });
        el.hiddenSourceShelfFileInput?.addEventListener('change', async () => {
            await importShelfFiles(el.hiddenSourceShelfFileInput.files);
            el.hiddenSourceShelfFileInput.value = '';
        });
        el.sourceShelfGroupNameInput?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                void (getSelectedGroup() ? renameShelfGroup() : createShelfGroup());
            }
        });
        el.sourceShelfPickerCloseBtn?.addEventListener('click', closeShelfPicker);
        el.sourceShelfPickerCancelBtn?.addEventListener('click', closeShelfPicker);
        el.sourceShelfPickerBackdrop?.addEventListener('click', closeShelfPicker);
        el.sourceShelfPickerConfirmBtn?.addEventListener('click', () => {
            void confirmPickerSelection();
        });
        documentObj.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && state.pickerOpen) {
                closeShelfPicker();
            }
        });
    }

    return {
        bindEvents,
        closeShelfPicker,
        confirmPickerSelection,
        createShelfGroup,
        deleteShelfDocument,
        deleteShelfGroup,
        importShelfFiles,
        loadPickerData,
        loadShelfDocuments,
        loadShelfGroups,
        openShelfPage,
        openShelfPicker,
        renameShelfDocument,
        renameShelfGroup,
        renderPicker,
        renderShelfPage,
        syncPolling,
        togglePickerDocument,
    };
}

export {
    createShelfController,
};
