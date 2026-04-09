var emoticonManagerApi = window.chatAPI || window.utilityAPI || window.electronAPI;

const ALL_CATEGORY_KEY = '__all__';

const emoticonManager = (() => {
    let emoticonLibrary = [];
    let groupedEmoticons = [];
    let isInitialized = false;
    let emoticonPanel = null;
    let messageInput = null;
    let currentTargetInput = null;
    let currentUserName = '';
    let activeCategory = ALL_CATEGORY_KEY;
    let lastLoadStatus = 'idle';
    let lastLoadReason = '';

    function setLoadStatus(status, reason = '') {
        lastLoadStatus = status;
        lastLoadReason = reason;
    }

    function getUserCategory() {
        return currentUserName ? `${currentUserName}表情包` : '';
    }

    function getCategoryPriority(category) {
        const userCategory = getUserCategory();
        if (userCategory && category === userCategory) return 0;
        if (category === '通用表情包') return 1;
        return 2;
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

        if (!emoticonPanel) {
            console.error('[EmoticonManager] Emoticon panel element not provided.');
            return;
        }

        await loadUserEmoticons();
        isInitialized = true;
        console.log('[EmoticonManager] Initialized successfully.');
    }

    async function loadUserEmoticons() {
        emoticonLibrary = [];
        groupedEmoticons = [];
        currentUserName = '';
        activeCategory = ALL_CATEGORY_KEY;
        setLoadStatus('loading');

        try {
            if (!emoticonManagerApi?.loadSettings || !emoticonManagerApi?.getEmoticonLibrary) {
                setLoadStatus('degraded', 'emoticon api unavailable');
                return;
            }

            const settings = await emoticonManagerApi.loadSettings();
            currentUserName = settings?.userName?.trim() || '';

            const library = await emoticonManagerApi.getEmoticonLibrary();
            if (!Array.isArray(library)) {
                setLoadStatus('degraded', 'emoticon library unavailable');
                return;
            }

            emoticonLibrary = library.filter((emoticon) => emoticon?.url && emoticon?.category);
            rebuildGroups();
            setLoadStatus(groupedEmoticons.length > 0 ? 'ready' : 'empty', groupedEmoticons.length > 0 ? '' : 'no emoticons available');

            console.log(`[EmoticonManager] Loaded ${emoticonLibrary.length} emoticons across ${groupedEmoticons.length} categories.`);
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

    function renderPanelContent() {
        if (!emoticonPanel) return;

        emoticonPanel.innerHTML = '';

        const title = document.createElement('div');
        title.className = 'emoticon-panel-title';
        title.textContent = '- VChat 表情包系统 -';
        emoticonPanel.appendChild(title);

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
            const img = document.createElement('img');
            img.src = emoticon.url;
            img.title = `${emoticon.category} / ${emoticon.filename}`;
            img.className = 'emoticon-item';
            img.onclick = () => insertEmoticon(emoticon);
            grid.appendChild(img);
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

    function insertEmoticon(emoticon) {
        if (!currentTargetInput) return;

        const decodedUrl = decodeURIComponent(emoticon.url);
        const imgTag = `<img src="${decodedUrl}" width="80">`;
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
            console.error('[EmoticonManager] No target input specified or found.');
            return;
        }

        if (emoticonPanel.style.display === 'flex' && input === currentTargetInput) {
            hidePanel();
            return;
        }

        currentTargetInput = input;

        const rect = triggerButton.getBoundingClientRect();
        const panelWidth = 360;
        const panelHeight = 360;
        let x = rect.left - panelWidth + rect.width;
        let y = rect.top - panelHeight - 10;

        if (x < 0) x = 10;
        if (y < 0) y = rect.bottom + 10;

        populateAndShowPanel(x, y);
    }

    return {
        initialize,
        togglePanel,
        reload: loadUserEmoticons,
        getStatus: () => ({
            isInitialized,
            lastLoadStatus,
            lastLoadReason,
            emoticonCount: emoticonLibrary.length,
            categoryCount: groupedEmoticons.length,
            currentUserName,
            activeCategory,
        }),
    };
})();

window.emoticonManager = emoticonManager;
