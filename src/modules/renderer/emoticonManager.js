var emoticonManagerApi = window.chatAPI || window.utilityAPI || window.electronAPI;
const DEFAULT_EMOTICON_CATEGORY = '表情包';

const emoticonManager = (() => {
    let emoticonLibrary = [];
    let groupedEmoticons = [];
    let isInitialized = false;
    let emoticonPanel = null;
    let messageInput = null;
    let onEmoticonSelected = null;
    let currentTargetInput = null;
    let currentUserName = '';
    let lastLoadStatus = 'idle';
    let lastLoadReason = '';
    let manageMode = false;

    function setLoadStatus(status, reason = '') {
        lastLoadStatus = status;
        lastLoadReason = reason;
    }

    function getConfirm(message) {
        return window.confirm(message);
    }

    function showToast(message, type = 'info', duration = 3000) {
        window.uiHelperFunctions?.showToastNotification?.(message, type, duration);
    }

    function rebuildGroups() {
        const byCategory = new Map();
        for (const emoticon of emoticonLibrary) {
            const category = emoticon?.category || DEFAULT_EMOTICON_CATEGORY;
            if (!byCategory.has(category)) {
                byCategory.set(category, []);
            }
            byCategory.get(category).push(emoticon);
        }

        groupedEmoticons = [...byCategory.entries()]
            .map(([category, items]) => ({ category, items }))
            .sort((a, b) => (a.category || '').localeCompare(b.category || '', 'zh-Hans-CN'));
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

    function getVisibleEmoticons() {
        return groupedEmoticons.flatMap((group) => group.items);
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
                    category: DEFAULT_EMOTICON_CATEGORY,
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

    async function deleteEmoticon(emoticon) {
        if (emoticon.readonly === true || emoticon.source === 'bundled') {
            showToast('内置表情需要在资源目录中管理。', 'info');
            return;
        }

        if (!getConfirm(`删除表情“${emoticon.name || emoticon.filename}”？`)) {
            return;
        }

        if (typeof emoticonManagerApi?.deleteEmoticonItem !== 'function') {
            return;
        }

        const result = await emoticonManagerApi.deleteEmoticonItem(emoticon.id);
        if (result?.success === false) {
            showToast(result.error || '删除表情失败。', 'warning');
            return;
        }
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
              <button type="button" class="ghost-button icon-btn emoticon-manage-button${manageMode ? ' is-active' : ''}" data-emoticon-action="manage" title="${manageMode ? '完成管理' : '管理表情'}" aria-label="${manageMode ? '完成管理' : '管理表情'}">
                <span class="material-symbols-outlined" aria-hidden="true">${manageMode ? 'done' : 'edit'}</span>
              </button>
            </div>
        `;
        emoticonPanel.appendChild(header);

        header.querySelector('[data-emoticon-action="manage"]')?.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            manageMode = !manageMode;
            renderPanelContent();
        });

        const content = document.createElement('div');
        content.className = 'emoticon-panel-content';
        emoticonPanel.appendChild(content);

        const visibleEmoticons = getVisibleEmoticons();
        const grid = document.createElement('div');
        grid.className = 'emoticon-grid';

        const addCard = document.createElement('button');
        addCard.type = 'button';
        addCard.className = 'emoticon-card emoticon-card--add';
        addCard.title = '导入表情';
        addCard.setAttribute('aria-label', '导入表情');
        addCard.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">add</span>';
        addCard.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            void importFiles();
        });
        grid.appendChild(addCard);

        visibleEmoticons.forEach((emoticon) => {
            const card = document.createElement('div');
            card.className = `emoticon-card${manageMode ? ' is-managing' : ''}`;

            const img = document.createElement('img');
            img.src = emoticon.url;
            img.title = `${emoticon.category} / ${emoticon.filename}`;
            img.className = 'emoticon-item';
            img.onclick = () => insertEmoticon(emoticon);
            card.appendChild(img);

            if (manageMode) {
                const isReadOnly = emoticon.readonly === true || emoticon.source === 'bundled';
                const deleteButton = document.createElement('button');
                deleteButton.type = 'button';
                deleteButton.className = `emoticon-card__delete${isReadOnly ? ' is-disabled' : ''}`;
                deleteButton.title = isReadOnly ? '内置表情不可在这里删除' : `删除 ${emoticon.name || emoticon.filename}`;
                deleteButton.setAttribute('aria-label', deleteButton.title);
                deleteButton.textContent = '×';
                deleteButton.addEventListener('click', (event) => {
                    event.stopPropagation();
                    void deleteEmoticon(emoticon);
                });
                card.appendChild(deleteButton);
            }

            grid.appendChild(card);
        });

        if (visibleEmoticons.length === 0) {
            const placeholder = document.createElement('div');
            placeholder.className = 'emoticon-item-placeholder';
            placeholder.textContent = '还没有表情';
            grid.appendChild(placeholder);
        }

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
        const panelWidth = 360;
        const panelHeight = 380;
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
            manageMode,
        }),
    };
})();

window.emoticonManager = emoticonManager;
