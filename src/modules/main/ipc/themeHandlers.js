const { ipcMain, nativeTheme } = require('electron');

let getMainWindow = () => null;
let getOpenChildWindows = () => [];
let settingsManager = null;
let isInitialized = false;

async function persistThemeMode(themeMode) {
    if (!settingsManager) {
        return;
    }

    try {
        await settingsManager.updateSettings((settings) => ({
            ...settings,
            currentThemeMode: themeMode,
            themeLastUpdated: Date.now(),
        }));
    } catch (error) {
        console.error('[ThemeHandlers] Failed to save theme mode:', error);
    }
}

function broadcastThemeUpdate(theme) {
    const mainWindow = getMainWindow();
    const openChildWindows = getOpenChildWindows();
    const windows = [mainWindow, ...(Array.isArray(openChildWindows) ? openChildWindows : [])];

    new Set(windows.filter(Boolean)).forEach((win) => {
        if (win && !win.isDestroyed()) {
            win.webContents.send('theme-updated', theme);
            win.webContents.send('theme:updated', theme);
        }
    });
}

async function handleThemeChange(themeMode) {
    if (!['light', 'dark', 'system'].includes(themeMode)) {
        return;
    }

    nativeTheme.themeSource = themeMode;
    await persistThemeMode(themeMode);
    broadcastThemeUpdate(nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
}

function initialize(options) {
    getMainWindow = typeof options.getMainWindow === 'function'
        ? options.getMainWindow
        : (() => options.mainWindow || null);
    getOpenChildWindows = typeof options.getOpenChildWindows === 'function'
        ? options.getOpenChildWindows
        : (() => options.openChildWindows || []);
    settingsManager = options.settingsManager;

    if (isInitialized) {
        return;
    }

    ['set-theme-mode', 'theme:set-mode'].forEach((channel) => {
        ipcMain.on(channel, (_event, themeMode) => {
            handleThemeChange(themeMode);
        });
    });

    ['set-theme', 'theme:set'].forEach((channel) => {
        ipcMain.on(channel, (_event, theme) => {
            handleThemeChange(theme);
        });
    });

    ['get-current-theme', 'theme:get-current'].forEach((channel) => {
        ipcMain.handle(channel, () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'));
    });

    nativeTheme.on('updated', () => {
        broadcastThemeUpdate(nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
    });

    isInitialized = true;
}

module.exports = {
    initialize,
    broadcastThemeUpdate,
};
