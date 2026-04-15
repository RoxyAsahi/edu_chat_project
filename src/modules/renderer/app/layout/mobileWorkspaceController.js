function createMobileWorkspaceController(deps = {}) {
    const store = deps.store;
    const el = deps.el;
    const windowObj = deps.windowObj || window;
    const mobileBreakpoint = Number(deps.mobileBreakpoint) || 1180;
    const mobileLayoutClasses = ['layout--mobile-source', 'layout--mobile-chat', 'layout--mobile-studio'];
    const mobilePaneElements = [el.workspaceSidebar, el.chatStage, el.settingsPanel];

    function getLayoutSlice() {
        return store.getState().layout;
    }

    function isNarrowWorkspaceLayout() {
        return windowObj.innerWidth <= mobileBreakpoint;
    }

    function syncMobileWorkspaceLayout() {
        const layout = getLayoutSlice();
        const isNarrow = isNarrowWorkspaceLayout();
        const activeTab = layout.mobileWorkspaceTab || 'source';

        el.mobileWorkspaceSourceTabBtn?.classList.toggle('mobile-workspace-tab--active', activeTab === 'source');
        el.mobileWorkspaceChatTabBtn?.classList.toggle('mobile-workspace-tab--active', activeTab === 'chat');
        el.mobileWorkspaceStudioTabBtn?.classList.toggle('mobile-workspace-tab--active', activeTab === 'studio');

        if (!isNarrow) {
            mobileLayoutClasses.forEach((className) => {
                el.layout?.classList.remove(className);
            });
            mobilePaneElements.forEach((pane) => {
                pane?.classList.remove('mobile-workspace-pane--hidden');
            });
            return;
        }

        el.layout?.classList.toggle('layout--mobile-source', activeTab === 'source');
        el.layout?.classList.toggle('layout--mobile-chat', activeTab === 'chat');
        el.layout?.classList.toggle('layout--mobile-studio', activeTab === 'studio');

        el.workspaceSidebar?.classList.toggle('mobile-workspace-pane--hidden', activeTab !== 'source');
        el.chatStage?.classList.toggle('mobile-workspace-pane--hidden', activeTab !== 'chat');
        el.settingsPanel?.classList.toggle('mobile-workspace-pane--hidden', activeTab !== 'studio');
    }

    function setMobileWorkspaceTab(tab) {
        const nextTab = tab === 'chat' || tab === 'studio' ? tab : 'source';
        store.patchState('layout', {
            mobileWorkspaceTab: nextTab,
        });
        syncMobileWorkspaceLayout();
    }

    function bindEvents() {
        el.mobileWorkspaceSourceTabBtn?.addEventListener('click', () => {
            setMobileWorkspaceTab('source');
        });
        el.mobileWorkspaceChatTabBtn?.addEventListener('click', () => {
            setMobileWorkspaceTab('chat');
        });
        el.mobileWorkspaceStudioTabBtn?.addEventListener('click', () => {
            setMobileWorkspaceTab('studio');
        });
        windowObj.addEventListener('resize', syncMobileWorkspaceLayout);
    }

    return {
        bindEvents,
        isNarrowWorkspaceLayout,
        setMobileWorkspaceTab,
        syncMobileWorkspaceLayout,
    };
}

export {
    createMobileWorkspaceController,
};
