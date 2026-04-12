const {
    command,
    query,
    subscription,
} = require('./apiFactory');

function createShellCatalog(ops) {
    return {
        loadSettings: query(() => ops.invoke('load-settings')),
        saveSettings: query((settings) => ops.invoke('save-settings', settings)),
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
        minimizeWindow: command(() => ops.send('minimize-window')),
        maximizeWindow: command(() => ops.send('maximize-window')),
        unmaximizeWindow: command(() => ops.send('unmaximize-window')),
        closeWindow: command(() => ops.send('close-window')),
        openDevTools: command(() => ops.send('open-dev-tools')),
        onWindowMaximized: subscription(ops.subscribe('window-maximized', () => undefined)),
        onWindowUnmaximized: subscription(ops.subscribe('window-unmaximized', () => undefined)),
        showImageContextMenu: command((imageUrl) => ops.send('show-image-context-menu', imageUrl)),
        openImageViewer: command((data) => ops.send('open-image-viewer', data)),
        openImageInNewWindow: command((imageUrl, imageTitle) => ops.send('open-image-in-new-window', imageUrl, imageTitle)),
        openTextInNewWindow: query((textContent, windowTitle, theme) => ops.invoke('display-text-content-in-viewer', textContent, windowTitle, theme)),
        sendOpenExternalLink: command((url) => ops.send('open-external-link', url)),
        onThemeUpdated: subscription(ops.subscribe('theme-updated', (_event, theme) => theme)),
        getCurrentTheme: query(() => ops.invoke('get-current-theme')),
        setTheme: command((theme) => ops.send('set-theme', theme)),
        setThemeMode: command((themeMode) => ops.send('set-theme-mode', themeMode)),
        getPlatform: query(() => ops.invoke('get-platform')),
    };
}

module.exports = {
    createShellCatalog,
};
