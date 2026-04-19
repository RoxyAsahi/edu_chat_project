var emoticonManagerApi = window.chatAPI || window.utilityAPI || window.electronAPI;

const ALL_CATEGORY_KEY = '__all__';

const emoticonManager = (() => {
    let emoticonLibrary = [];
    let groupedEmoticons = [];
    let isInitialized = false;
    let emoticonPanel = null;
    let messageInput = null;
    let onEmoticonSelected = null;
    let currentTargetInput = null;
    let currentUserName = '';
    let activeCategory = ALL_CATEGORY_KEY;
    let lastLoadStatus = 'idle';
    let lastLoadReason = '';
    let manageMode = false;

    function setLoadStatus(status, reason = '') {
        lastLoadStatus = status;
        lastLoadReason = reason;
    }

    function getPrompt(message, defaultValue = '') {
        return window.prompt(message, defaultValue);
    }

    function getConfirm(message) {
        return window.confirm(message);
    }

    function showToast(message, type = 'info', duration = 3000) {
        window.uiHelperFunctions?.showToastNotification?.(message, type, duration);
    }

    function getCategoryPriority(category) {
        if (category === '通用表情包') return 0;
        return 1;
    }

    function sortCategories(a, b) {
        const priorityDiff = getCategoryPriority(a.category || '') - getCategoryPriority(b.category || '');
        if (priorityDiff !== 0) {
            return priorityDiff;
        }
        return (a.category || '').localeCompare(b.category || '', 'zh-Hans-CN');
    }

    function rebuildGroups() {
        const byCategory = new Map();
        for (const emoticon of emoticonLibrary) {
            const category = emoticon?.category || '未分类';
            if (!byCategory.has(category)) {
                byCategory.set(category, []);
            }
            byCategory.get(category).push(emoticon);
        }

        groupedEmoticons = [...byCategory.entries()]
            .map(([category, items]) => ({ category, items }))
            .sort(sortCategories);

        if (!groupedEmoticons.some((group) => group.category === activeCategory)) {
            activeCategory = ALL_CATEGORY_KEY;
        }
    }

    async function initialize(elements) {
        if (isInitialized) return;

        emoticonPanel = elements.emoticonPanel;
        messageInput = elements.messageInput || null;
        onEmoticonSelected = typeof elements.onEmoticonSelected === 'function'
            ? elements.onEmoticonSelected
            : null;

        if (!emoticonPanel) {
            console.error('[EmoticonManager] Emoticon panel element not provided.');
            return;
        }

        await loadUserEmoticons();
        isInitialized = true;
    }

    async function loadUserEmoticons() {
        emoticonLibrary = [];
        groupedEmoticons = [];
        activeCategory = ALL_CATEGORY_KEY;
        setLoadStatus('loading');

        try {
            if (!emoticonManagerApi?.loadSettings || !emoticonManagerApi?.getEmoticonLibrary) {
                setLoadStatus('degraded', 'emoticon api unavailable');
                return;
            }

            const settings = await emoticonManagerApi.loadSettings();
            currentUserName = settings?.userName?.trim() || '';

            const libraryResult = typeof emoticonManagerApi.listEmoticonLibrary === 'function'
                ? await emoticonManagerApi.listEmoticonLibrary()
                : await emoticonManagerApi.getEmoticonLibrary();
            const library = Array.isArray(libraryResult?.items)
                ? libraryResult.items
                : (Array.isArray(libraryResult) ? libraryResult : []);

            emoticonLibrary = library.filter((emoticon) => emoticon?.url && emoticon?.category);
            rebuildGroups();
            setLoadStatus(groupedEmoticons.length > 0 ? 'ready' : 'empty', groupedEmoticons.length > 0 ? '' : 'no emoticons available');
        } catch (error) {
            emoticonLibrary = [];
            groupedEmoticons = [];
            setLoadStatus('degraded', error?.message || 'unknown error');
        }
    }

    function buildTabs() {
        const tabs = [{
            key: ALL_CATEGORY_KEY,
            label: '全部',
            count: emoticonLibrary.length,
        }];

        groupedEmoticons.forEach((group) => {
            tabs.push({
                key: group.category,
                label: group.category,
                count: group.items.length,
            });
        });

        return tabs;
    }

    function getVisibleEmoticons() {
        if (activeCategory === ALL_CATEGORY_KEY) {
            return groupedEmoticons.flatMap((group) => group.items);
        }
        return groupedEmoticons.find((group) => group.category === activeCategory)?.items || [];
    }

    async function importFiles() {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.multiple = true;
        fileInput.onchange = async () => {
            const files = Array.from(fileInput.files || []);
            const payload = files
                .map((file) => ({
                    sourcePath: file.path || '',
                    name: file.name.replace(/\.[^.]+$/, ''),
                    category: activeCategory === ALL_CATEGORY_KEY ? '未分类' : activeCategory,
                }))
                .filter((item) => item.sourcePath);

            if (payload.length === 0 || typeof emoticonManagerApi?.importEmoticonItems !== 'function') {
                return;
            }

            await emoticonManagerApi.importEmoticonItems({ items: payload });
            await loadUserEmoticons();
            renderPanelContent();
        };
        fileInput.click();
    }

    async function editEmoticon(emoticon) {
        if (typeof emoticonManagerApi?.saveEmoticonItem !== 'function') {
            return;
        }

        const nextName = getPrompt('表情名称', emoticon.name || emoticon.filename);
        if (!nextName) {
            return;
        }

        const nextCategory = getPrompt('分类', emoticon.category || '未分类');
        if (!nextCategory) {
            return;
        }

        const nextTags = getPrompt('标签（逗号分隔）', Array.isArray(emoticon.tags) ? emoticon.tags.join(', ') : '');
        await emoticonManagerApi.saveEmoticonItem({
            id: emoticon.id,
            name: nextName.trim(),
            filename: emoticon.filename,
            category: nextCategory.trim(),
            tags: String(nextTags || '').split(',').map((item) => item.trim()).filter(Boolean),
        });
        await loadUserEmoticons();
        renderPanelContent();
    }

    async function deleteEmoticon(emoticon) {
        if (!getConfirm(`删除表情“${emoticon.name || emoticon.filename}”？`)) {
            return;
        }

        if (typeof emoticonManagerApi?.deleteEmoticonItem !== 'function') {
            return;
        }

        await emoticonManagerApi.deleteEmoticonItem(emoticon.id);
        await loadUserEmoticons();
        renderPanelContent();
    }

    function renderPanelContent() {
        if (!emoticonPanel) return;

        emoticonPanel.innerHTML = '';

        const header = document.createElement('div');
        header.className = 'emoticon-panel-header';
        header.innerHTML = `
            <div class="emoticon-panel-title">UniStudy 表情库</div>
            <div class="emoticon-panel-actions">
              <button type="button" class="ghost-button icon-text-btn" data-emoticon-action="import">导入</button>
              <button type="button" class="ghost-button icon-text-btn" data-emoticon-action="manage">${manageMode ? '完成' : '管理'}</button>
            </div>
        `;
        emoticonPanel.appendChild(header);

        header.querySelector('[data-emoticon-action="import"]')?.addEventListener('click', () => {
            void importFiles();
        });
        header.querySelector('[data-emoticon-action="manage"]')?.addEventListener('click', () => {
            manageMode = !manageMode;
            renderPanelContent();
        });

        const tabsScroller = document.createElement('div');
        tabsScroller.className = 'emoticon-category-scroller';
        emoticonPanel.appendChild(tabsScroller);

        const tabs = buildTabs();
        tabs.forEach((tab) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `emoticon-category-tab${tab.key === activeCategory ? ' is-active' : ''}`;
            button.title = `${tab.label} (${tab.count})`;
            button.textContent = `${tab.label} ${tab.count}`;
            button.addEventListener('click', () => {
                activeCategory = tab.key;
                renderPanelContent();
            });
            tabsScroller.appendChild(button);
        });

        const content = document.createElement('div');
        content.className = 'emoticon-panel-content';
        emoticonPanel.appendChild(content);

        const visibleEmoticons = getVisibleEmoticons();
        if (visibleEmoticons.length === 0) {
            content.innerHTML = '<div class="emoticon-item-placeholder">当前分类下没有表情</div>';
            return;
        }

        const grid = document.createElement('div');
        grid.className = 'emoticon-grid';

        visibleEmoticons.forEach((emoticon) => {
            const card = document.createElement('div');
            card.className = 'emoticon-card';

            const img = document.createElement('img');
            img.src = emoticon.url;
            img.title = `${emoticon.category} / ${emoticon.filename}`;
            img.className = 'emoticon-item';
            img.onclick = () => insertEmoticon(emoticon);
            card.appendChild(img);

            if (manageMode) {
                const meta = document.createElement('div');
                meta.className = 'emoticon-card__meta';
                const tag = emoticon.readonly === true || emoticon.source === 'bundled'
                    ? '内置'
                    : '自定义';
                meta.innerHTML = `
                    <strong>${emoticon.name || emoticon.filename}</strong>
                    <span>${emoticon.category} · ${tag}</span>
                `;
                card.appendChild(meta);

                if (emoticon.readonly !== true && emoticon.source !== 'bundled') {
                    const actions = document.createElement('div');
                    actions.className = 'emoticon-card__actions';
                    actions.innerHTML = `
                        <button type="button" class="ghost-button icon-text-btn" data-action="edit">编辑</button>
                        <button type="button" class="ghost-button icon-text-btn" data-action="delete">删除</button>
                    `;
                    actions.querySelector('[data-action="edit"]')?.addEventListener('click', (event) => {
                        event.stopPropagation();
                        void editEmoticon(emoticon);
                    });
                    actions.querySelector('[data-action="delete"]')?.addEventListener('click', (event) => {
                        event.stopPropagation();
                        void deleteEmoticon(emoticon);
                    });
                    card.appendChild(actions);
                }
            }

            grid.appendChild(card);
        });

        content.appendChild(grid);
    }

    function populateAndShowPanel(x, y) {
        if (!emoticonPanel) return;

        renderPanelContent();
        emoticonPanel.style.left = `${x}px`;
        emoticonPanel.style.top = `${y}px`;
        emoticonPanel.style.display = 'flex';

        setTimeout(() => {
            document.addEventListener('click', hidePanelOnClickOutside, { once: true });
        }, 100);
    }

    function hidePanel() {
        if (emoticonPanel) {
            emoticonPanel.style.display = 'none';
        }
        document.removeEventListener('click', hidePanelOnClickOutside);
        currentTargetInput = null;
    }

    function hidePanelOnClickOutside(event) {
        const clickedTrigger = event.target?.closest?.('#emoticonTriggerBtn');
        if (emoticonPanel && !emoticonPanel.contains(event.target) && !clickedTrigger) {
            hidePanel();
        } else {
            document.addEventListener('click', hidePanelOnClickOutside, { once: true });
        }
    }

    async function insertEmoticon(emoticon) {
        if (!currentTargetInput || manageMode) return;

        if (currentTargetInput === messageInput && typeof onEmoticonSelected === 'function') {
            try {
                const result = await onEmoticonSelected(emoticon, currentTargetInput);
                if (result?.success === false) {
                    showToast(result.error || '添加表情失败。', 'warning');
                    return;
                }

                currentTargetInput.focus();
                hidePanel();
                return;
            } catch (error) {
                showToast(`添加表情失败：${error?.message || '未知错误'}`, 'error');
                return;
            }
        }

        const source = emoticon.renderPath || decodeURIComponent(emoticon.url);
        const imgTag = `<img src="${source}" width="80">`;
        const currentValue = currentTargetInput.value;
        const separator = currentValue.length > 0 && !/\s$/.test(currentValue) ? ' ' : '';

        currentTargetInput.value += separator + imgTag;
        currentTargetInput.focus();
        currentTargetInput.dispatchEvent(new Event('input', { bubbles: true }));

        hidePanel();
    }

    function togglePanel(triggerButton, targetInput) {
        const input = targetInput || messageInput;
        if (!emoticonPanel || !input) {
            return;
        }

        if (emoticonPanel.style.display === 'flex' && input === currentTargetInput) {
            hidePanel();
            return;
        }

        currentTargetInput = input;

        const rect = triggerButton.getBoundingClientRect();
        const panelWidth = 380;
        const panelHeight = 420;
        let x = rect.left - panelWidth + rect.width;
        let y = rect.top - panelHeight - 10;

        if (x < 0) x = 10;
        if (y < 0) y = rect.bottom + 10;

        populateAndShowPanel(x, y);
    }

    return {
        initialize,
        togglePanel,
        reload: async () => {
            await loadUserEmoticons();
            if (emoticonPanel?.style.display === 'flex') {
                renderPanelContent();
            }
        },
        getStatus: () => ({
            isInitialized,
            lastLoadStatus,
            lastLoadReason,
            emoticonCount: emoticonLibrary.length,
            categoryCount: groupedEmoticons.length,
            currentUserName,
            activeCategory,
            manageMode,
        }),
    };
})();

window.emoticonManager = emoticonManager;
