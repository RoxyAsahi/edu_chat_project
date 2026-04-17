const {
    command,
    query,
    subscription,
} = require('./apiFactory');

function createShellCatalog(ops) {
    return {
        loadSettings: query(() => ops.invoke('load-settings')),
        saveSettings: query((settings) => ops.invoke('save-settings', settings)),
        fetchModelServiceModels: query((payload) => ops.invoke('model-service:fetch-models', payload)),
        checkModelServiceProvider: query((payload) => ops.invoke('model-service:check-provider', payload)),
        checkModelServiceHealth: query((payload) => ops.invoke('model-service:check-health', payload)),
        previewAgentBubbleThemePrompt: query((payload) => ops.invoke('preview-agent-bubble-theme-prompt', payload)),
        previewFinalSystemPrompt: query((payload) => ops.invoke('preview-final-system-prompt', payload)),
        saveAvatarColor: query((data) => ops.invoke('save-avatar-color', data)),
        readImageFromClipboard: query(async () => {
            const result = await ops.invoke('read-image-from-clipboard-main');
            if (result && result.success) {
                return { data: result.data, extension: result.extension };
            }
            return null;
        }),
        readTextFromClipboard: query(async () => {
            const result = await ops.invoke('read-text-from-clipboard-main');
            return result?.success ? result.text : '';
        }),
        minimizeWindow: command(() => ops.send('window:minimize')),
        maximizeWindow: command(() => ops.send('window:maximize')),
        unmaximizeWindow: command(() => ops.send('window:unmaximize')),
        closeWindow: command(() => ops.send('window:close')),
        openDevTools: command(() => ops.send('window:open-dev-tools')),
        onWindowMaximized: subscription(ops.subscribe('window:maximized', () => undefined)),
        onWindowUnmaximized: subscription(ops.subscribe('window:unmaximized', () => undefined)),
        showImageContextMenu: command((imageUrl) => ops.send('show-image-context-menu', imageUrl)),
        openImageViewer: command((data) => ops.send('open-image-viewer', data)),
        openImageInNewWindow: command((imageUrl, imageTitle) => ops.send('open-image-in-new-window', imageUrl, imageTitle)),
        openTextInNewWindow: query((textContent, windowTitle, theme) => ops.invoke('display-text-content-in-viewer', textContent, windowTitle, theme)),
        sendOpenExternalLink: command((url) => ops.send('open-external-link', url)),
        onThemeUpdated: subscription(ops.subscribe('theme:updated', (_event, theme) => theme)),
        getCurrentTheme: query(() => ops.invoke('theme:get-current')),
        setTheme: command((theme) => ops.send('theme:set', theme)),
        setThemeMode: command((themeMode) => ops.send('theme:set-mode', themeMode)),
        getPlatform: query(() => ops.invoke('window:get-platform')),
    };
}

module.exports = {
    createShellCatalog,
};
