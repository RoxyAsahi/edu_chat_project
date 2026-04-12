import { createStoreView } from '../store/storeView.js';

const LAYOUT_DEFAULTS = Object.freeze({
    leftWidth: 410,
    rightWidth: 400,
    leftMin: 220,
    rightMin: 300,
    centerMin: 560,
    leftCompactMin: 160,
    rightCompactMin: 220,
    leftTopHeight: 360,
    leftTopMin: 220,
    leftBottomMin: 240,
    leftTopCompactMin: 140,
    leftBottomCompactMin: 180,
    dividerWidth: 12,
    leftVerticalDividerHeight: 12,
    desktopBreakpoint: 1200,
});

function clamp(value, min, max) {
    if (!Number.isFinite(value)) {
        return min;
    }
    return Math.min(Math.max(value, min), max);
}

function normalizeStoredLayoutWidth(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeStoredLayoutHeight(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function consumeWidth(value, floor, requested) {
    const available = Math.max(0, value - floor);
    const used = Math.min(requested, available);
    return {
        value: value - used,
        used,
    };
}

function resolveLayoutWidths({
    desiredLeft = LAYOUT_DEFAULTS.leftWidth,
    desiredRight = LAYOUT_DEFAULTS.rightWidth,
    contentWidth = 0,
    collapsed = false,
    defaults = LAYOUT_DEFAULTS,
} = {}) {
    const dividerWidth = defaults.dividerWidth;
    const effectiveRightDividerWidth = collapsed ? 0 : dividerWidth;
    const panelBudget = Math.max(0, contentWidth - dividerWidth - effectiveRightDividerWidth);

    let left = Math.min(
        Math.max(normalizeStoredLayoutWidth(desiredLeft, defaults.leftWidth), defaults.leftCompactMin),
        panelBudget,
    );
    let right = 0;

    if (!collapsed) {
        const remainingAfterLeft = Math.max(0, panelBudget - left);
        right = Math.min(
            Math.max(normalizeStoredLayoutWidth(desiredRight, defaults.rightWidth), defaults.rightCompactMin),
            remainingAfterLeft,
        );
    }

    let center = Math.max(0, panelBudget - left - right);

    if (center < defaults.centerMin) {
        let shortage = defaults.centerMin - center;
        let reduction = consumeWidth(left, defaults.leftMin, shortage);
        left = reduction.value;
        shortage -= reduction.used;

        if (!collapsed && shortage > 0) {
            reduction = consumeWidth(right, defaults.rightMin, shortage);
            right = reduction.value;
            shortage -= reduction.used;
        }

        if (shortage > 0) {
            reduction = consumeWidth(left, defaults.leftCompactMin, shortage);
            left = reduction.value;
            shortage -= reduction.used;
        }

        if (!collapsed && shortage > 0) {
            reduction = consumeWidth(right, defaults.rightCompactMin, shortage);
            right = reduction.value;
        }

        center = Math.max(0, panelBudget - left - right);
    }

    return {
        left: Math.round(left),
        right: Math.round(right),
        center: Math.round(center),
        collapsed,
        dividerWidth,
        effectiveRightDividerWidth,
    };
}

function resolveLeftSidebarHeights({
    desiredTop = LAYOUT_DEFAULTS.leftTopHeight,
    contentHeight = 0,
    defaults = LAYOUT_DEFAULTS,
} = {}) {
    const dividerHeight = defaults.leftVerticalDividerHeight;
    const panelBudget = Math.max(0, contentHeight - dividerHeight);
    const canHonorFullMins = panelBudget >= (defaults.leftTopMin + defaults.leftBottomMin);
    const topFloor = canHonorFullMins ? defaults.leftTopMin : defaults.leftTopCompactMin;
    const bottomFloor = canHonorFullMins ? defaults.leftBottomMin : defaults.leftBottomCompactMin;
    const maxTop = Math.max(topFloor, panelBudget - bottomFloor);

    let top = clamp(
        normalizeStoredLayoutHeight(desiredTop, defaults.leftTopHeight),
        topFloor,
        maxTop,
    );
    let bottom = Math.max(0, panelBudget - top);

    if (bottom < bottomFloor) {
        bottom = Math.min(panelBudget, bottomFloor);
        top = Math.max(0, panelBudget - bottom);
    }

    return {
        top: Math.round(top),
        bottom: Math.round(bottom),
        dividerHeight,
    };
}

function createLayoutController(deps = {}) {
    const store = deps.store;
    const state = createStoreView(store, {
        writableSlices: ['layout'],
    });
    const el = deps.el;
    const chatAPI = deps.chatAPI;
    const ui = deps.ui;
    const windowObj = deps.windowObj || window;
    const documentObj = deps.documentObj || document;
    const mergeSettingsPatch = deps.mergeSettingsPatch || (() => {});
    let layoutResizeFrame = 0;

    function isDesktopResizableLayout() {
        return windowObj.innerWidth > LAYOUT_DEFAULTS.desktopBreakpoint;
    }

    function isRightPanelCollapsed() {
        return false;
    }

    function getLayoutContentWidth() {
        if (!el.layout) {
            return 0;
        }

        const rect = el.layout.getBoundingClientRect();
        const styles = windowObj.getComputedStyle(el.layout);
        const paddingLeft = Number.parseFloat(styles.paddingLeft || '0') || 0;
        const paddingRight = Number.parseFloat(styles.paddingRight || '0') || 0;
        return Math.max(0, rect.width - paddingLeft - paddingRight);
    }

    function getLeftSidebarContentHeight() {
        if (!el.workspaceSidebar) {
            return 0;
        }

        const rect = el.workspaceSidebar.getBoundingClientRect();
        return Math.max(0, rect.height);
    }

    function syncLayoutHandleVisibility() {
        const desktopMode = isDesktopResizableLayout();
        el.leftResizeHandle?.classList.toggle('layout-splitter--hidden', !desktopMode);
        el.rightResizeHandle?.classList.toggle('layout-splitter--hidden', !desktopMode);
        el.workspaceVerticalResizeHandle?.classList.toggle('layout-splitter--hidden', !desktopMode);
    }

    function applyLayoutWidths() {
        if (!el.layout || !state.layoutInitialized) {
            return;
        }

        if (!isDesktopResizableLayout()) {
            el.layout.style.removeProperty('--unistudy-left-width');
            el.layout.style.removeProperty('--unistudy-right-width');
            el.layout.style.removeProperty('--unistudy-effective-right-width');
            el.layout.style.removeProperty('--unistudy-divider-width');
            el.layout.style.removeProperty('--unistudy-effective-right-divider-width');
            syncLayoutHandleVisibility();
            return;
        }

        const resolved = resolveLayoutWidths({
            desiredLeft: state.layoutLeftWidth,
            desiredRight: state.layoutRightWidth,
            contentWidth: getLayoutContentWidth(),
            collapsed: isRightPanelCollapsed(),
        });
        state.layoutLeftWidth = resolved.left;
        if (!resolved.collapsed) {
            state.layoutRightWidth = resolved.right;
        }

        el.layout.style.setProperty('--unistudy-left-width', `${resolved.left}px`);
        el.layout.style.setProperty('--unistudy-right-width', `${state.layoutRightWidth}px`);
        el.layout.style.setProperty('--unistudy-effective-right-width', `${resolved.collapsed ? 0 : resolved.right}px`);
        el.layout.style.setProperty('--unistudy-center-min', `${LAYOUT_DEFAULTS.centerMin}px`);
        el.layout.style.setProperty('--unistudy-divider-width', `${resolved.dividerWidth}px`);
        el.layout.style.setProperty('--unistudy-effective-right-divider-width', `${resolved.effectiveRightDividerWidth}px`);

        syncLayoutHandleVisibility();
    }

    function applyLeftSidebarHeights() {
        if (!el.workspaceSidebar || !state.layoutInitialized) {
            return;
        }

        if (!isDesktopResizableLayout()) {
            el.workspaceSidebar.style.removeProperty('--unistudy-left-top-height');
            el.workspaceSidebar.style.removeProperty('--unistudy-left-vertical-divider-height');
            syncLayoutHandleVisibility();
            return;
        }

        const resolved = resolveLeftSidebarHeights({
            desiredTop: state.layoutLeftTopHeight,
            contentHeight: getLeftSidebarContentHeight(),
        });
        state.layoutLeftTopHeight = resolved.top;
        el.workspaceSidebar.style.setProperty('--unistudy-left-top-height', `${resolved.top}px`);
        el.workspaceSidebar.style.setProperty('--unistudy-left-vertical-divider-height', `${resolved.dividerHeight}px`);
        syncLayoutHandleVisibility();
    }

    function scheduleLayoutRefresh() {
        if (layoutResizeFrame) {
            windowObj.cancelAnimationFrame(layoutResizeFrame);
        }
        layoutResizeFrame = windowObj.requestAnimationFrame(() => {
            layoutResizeFrame = 0;
            applyLayoutWidths();
            applyLeftSidebarHeights();
        });
    }

    async function persistLayoutWidths() {
        const patch = {
            layoutLeftWidth: Math.round(state.layoutLeftWidth),
            layoutRightWidth: Math.round(state.layoutRightWidth),
            layoutLeftTopHeight: Math.round(state.layoutLeftTopHeight),
        };

        if (
            patch.layoutLeftWidth === state.settings.layoutLeftWidth
            && patch.layoutRightWidth === state.settings.layoutRightWidth
            && patch.layoutLeftTopHeight === state.settings.layoutLeftTopHeight
        ) {
            return;
        }

        const result = await chatAPI.saveSettings(patch);
        if (!result?.success) {
            ui.showToastNotification(`保存布局失败：${result?.error || '未知错误'}`, 'error');
            return;
        }

        mergeSettingsPatch(patch);
    }

    function initializeResizableLayout() {
        if (state.layoutInitialized) {
            applyLayoutWidths();
            applyLeftSidebarHeights();
            return;
        }

        state.layoutLeftWidth = normalizeStoredLayoutWidth(state.settings.layoutLeftWidth, LAYOUT_DEFAULTS.leftWidth);
        state.layoutRightWidth = normalizeStoredLayoutWidth(state.settings.layoutRightWidth, LAYOUT_DEFAULTS.rightWidth);
        state.layoutLeftTopHeight = normalizeStoredLayoutHeight(state.settings.layoutLeftTopHeight, LAYOUT_DEFAULTS.leftTopHeight);
        state.layoutInitialized = true;
        applyLayoutWidths();
        applyLeftSidebarHeights();
    }

    function beginLayoutResize(handle, event) {
        if (!isDesktopResizableLayout()) {
            return;
        }

        state.activeResizeHandle = handle;
        documentObj.body.classList.add('layout-resizing');
        event.preventDefault();
    }

    function updateLayoutResize(event) {
        if (!state.activeResizeHandle || !isDesktopResizableLayout() || !el.layout) {
            return;
        }

        const layoutRect = el.layout.getBoundingClientRect();
        const styles = windowObj.getComputedStyle(el.layout);
        const paddingLeft = Number.parseFloat(styles.paddingLeft || '0') || 0;
        const contentLeft = layoutRect.left + paddingLeft;
        const contentWidth = getLayoutContentWidth();
        const offsetX = clamp(event.clientX - contentLeft, 0, contentWidth);
        const handleOffset = LAYOUT_DEFAULTS.dividerWidth / 2;

        if (state.activeResizeHandle === 'left') {
            state.layoutLeftWidth = Math.round(offsetX - handleOffset);
        } else if (state.activeResizeHandle === 'right') {
            state.layoutRightWidth = Math.round(contentWidth - offsetX - handleOffset);
        }

        applyLayoutWidths();
    }

    function endLayoutResize() {
        if (!state.activeResizeHandle) {
            return;
        }

        state.activeResizeHandle = null;
        documentObj.body.classList.remove('layout-resizing');
        void persistLayoutWidths();
    }

    function beginVerticalLayoutResize(event) {
        if (!isDesktopResizableLayout()) {
            return;
        }

        state.activeVerticalResizeHandle = 'workspace';
        documentObj.body.classList.add('layout-resizing-vertical');
        event.preventDefault();
    }

    function updateVerticalLayoutResize(event) {
        if (!state.activeVerticalResizeHandle || !isDesktopResizableLayout() || !el.workspaceSidebar) {
            return;
        }

        const sidebarRect = el.workspaceSidebar.getBoundingClientRect();
        const offsetY = clamp(event.clientY - sidebarRect.top, 0, sidebarRect.height);
        const handleOffset = LAYOUT_DEFAULTS.leftVerticalDividerHeight / 2;
        state.layoutLeftTopHeight = Math.round(offsetY - handleOffset);
        applyLeftSidebarHeights();
    }

    function endVerticalLayoutResize() {
        if (!state.activeVerticalResizeHandle) {
            return;
        }

        state.activeVerticalResizeHandle = null;
        documentObj.body.classList.remove('layout-resizing-vertical');
        void persistLayoutWidths();
    }

    function bindEvents() {
        el.leftResizeHandle?.addEventListener('pointerdown', (event) => beginLayoutResize('left', event));
        el.rightResizeHandle?.addEventListener('pointerdown', (event) => beginLayoutResize('right', event));
        el.workspaceVerticalResizeHandle?.addEventListener('pointerdown', beginVerticalLayoutResize);
        windowObj.addEventListener('pointermove', updateLayoutResize);
        windowObj.addEventListener('pointermove', updateVerticalLayoutResize);
        windowObj.addEventListener('pointerup', endLayoutResize);
        windowObj.addEventListener('pointerup', endVerticalLayoutResize);
        windowObj.addEventListener('pointercancel', endLayoutResize);
        windowObj.addEventListener('pointercancel', endVerticalLayoutResize);
        windowObj.addEventListener('resize', scheduleLayoutRefresh);
    }

    return {
        LAYOUT_DEFAULTS,
        clamp,
        normalizeStoredLayoutWidth,
        normalizeStoredLayoutHeight,
        resolveLayoutWidths,
        resolveLeftSidebarHeights,
        applyLayoutWidths,
        applyLeftSidebarHeights,
        scheduleLayoutRefresh,
        initializeResizableLayout,
        beginLayoutResize,
        updateLayoutResize,
        endLayoutResize,
        beginVerticalLayoutResize,
        updateVerticalLayoutResize,
        endVerticalLayoutResize,
        bindEvents,
    };
}

export {
    LAYOUT_DEFAULTS,
    clamp,
    normalizeStoredLayoutWidth,
    normalizeStoredLayoutHeight,
    resolveLayoutWidths,
    resolveLeftSidebarHeights,
    createLayoutController,
};
