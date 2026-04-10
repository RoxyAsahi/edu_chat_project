const { app, BrowserWindow, ipcMain, nativeTheme, dialog, shell } = require('electron');
const fs = require('fs-extra');
const path = require('path');
const chokidar = require('chokidar');

function isBrokenPipeError(error) {
    if (!error) {
        return false;
    }
    return error.code === 'EPIPE'
        || error.code === 'ERR_STREAM_DESTROYED'
        || /broken pipe/i.test(String(error.message || ''));
}

function installSafeConsoleWrite() {
    const safeWrap = (methodName) => {
        const originalMethod = console[methodName];
        if (typeof originalMethod !== 'function') {
            return;
        }

        console[methodName] = (...args) => {
            try {
                return originalMethod.apply(console, args);
            } catch (error) {
                if (!isBrokenPipeError(error)) {
                    throw error;
                }
                return undefined;
            }
        };
    };

    [process.stdout, process.stderr].forEach((stream) => {
        if (!stream || typeof stream.on !== 'function') {
            return;
        }

        stream.on('error', (error) => {
            if (!isBrokenPipeError(error)) {
                try {
                    fs.ensureDirSync(path.join(process.cwd(), '.tmp'));
                    fs.appendFileSync(
                        path.join(process.cwd(), '.tmp', 'main-process-stream-errors.log'),
                        `[${new Date().toISOString()}] ${error?.stack || error}\n`
                    );
                } catch (_writeError) {
                    // Swallow secondary logging failures to avoid cascading crashes.
                }
            }
        });
    });

    safeWrap('log');
    safeWrap('info');
    safeWrap('warn');
    safeWrap('error');
}

installSafeConsoleWrite();

const settingsHandlers = require('../modules/main/ipc/settingsHandlers');
const fileDialogHandlers = require('../modules/main/ipc/fileDialogHandlers');
const { getAgentConfigById, ...agentHandlers } = require('../modules/main/ipc/agentHandlers');
const chatHandlers = require('../modules/main/ipc/chatHandlers');
const knowledgeBaseHandlers = require('../modules/main/ipc/knowledgeBaseHandlers');
const notesHandlers = require('../modules/main/ipc/notesHandlers');
const promptHandlers = require('../modules/main/ipc/promptHandlers');
const themeHandlers = require('../modules/main/ipc/themeHandlers');
const emoticonHandlers = require('../modules/main/ipc/emoticonHandlers');
const fileManager = require('../modules/main/fileManager');
const knowledgeBase = require('../modules/main/knowledge-base');
const SettingsManager = require('../modules/main/utils/appSettingsManager');
const AgentConfigManager = require('../modules/main/utils/agentConfigManager');
const { PRELOAD_ROLES, resolveProjectPreload } = require('../modules/main/services/preloadPaths');

const SRC_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SRC_ROOT, '..');
const DEFAULT_LITE_DATA_ROOT = path.join(REPO_ROOT, 'AppData');
const APP_DATA_ROOT_IN_PROJECT = process.env.VCPCHAT_DATA_ROOT
    ? path.resolve(process.env.VCPCHAT_DATA_ROOT)
    : DEFAULT_LITE_DATA_ROOT;

const AGENT_DIR = path.join(APP_DATA_ROOT_IN_PROJECT, 'Agents');
const USER_DATA_DIR = path.join(APP_DATA_ROOT_IN_PROJECT, 'UserData');
const SETTINGS_FILE = path.join(APP_DATA_ROOT_IN_PROJECT, 'settings.json');
const USER_AVATAR_FILE = path.join(USER_DATA_DIR, 'user_avatar.png');

let mainWindow = null;
const openChildWindows = [];
let settingsManager = null;
let agentConfigManager = null;
let historyWatcher = null;
let lastInternalSaveTime = 0;
let internalSaveTimeout = null;
let isEditingInProgress = false;
const INTERNAL_SAVE_WINDOW_MS = 2000;

const fileWatcher = {
    watchFile(filePath, callback) {
        this.stopWatching();
        historyWatcher = chokidar.watch(filePath, {
            persistent: true,
            ignoreInitial: true,
            awaitWriteFinish: {
                stabilityThreshold: 300,
                pollInterval: 100,
            },
        });

        historyWatcher.on('all', (_event, changedPath) => {
            const now = Date.now();
            const withinInternalWindow = (now - lastInternalSaveTime) < INTERNAL_SAVE_WINDOW_MS;
            if (withinInternalWindow || isEditingInProgress) {
                return;
            }
            callback(changedPath);
        });

        historyWatcher.on('error', (error) => {
            console.error('[LiteWatcher] error:', error);
        });
    },
    stopWatching() {
        if (historyWatcher) {
            historyWatcher.close();
            historyWatcher = null;
        }
        isEditingInProgress = false;
        lastInternalSaveTime = 0;
        if (internalSaveTimeout) {
            clearTimeout(internalSaveTimeout);
            internalSaveTimeout = null;
        }
    },
    signalInternalSave() {
        lastInternalSaveTime = Date.now();
        if (internalSaveTimeout) {
            clearTimeout(internalSaveTimeout);
        }
        internalSaveTimeout = setTimeout(() => {
            internalSaveTimeout = null;
        }, INTERNAL_SAVE_WINDOW_MS + 1000);
    },
    setEditingMode(editing) {
        isEditingInProgress = Boolean(editing);
    },
};

async function bootstrapIndependentDataRoot() {
    await fs.ensureDir(APP_DATA_ROOT_IN_PROJECT);
    console.log(`[LiteBootstrap] Data root: ${APP_DATA_ROOT_IN_PROJECT}`);
    if (process.env.VCPCHAT_DATA_ROOT) {
        console.log('[LiteBootstrap] Using VCPCHAT_DATA_ROOT override.');
    } else {
        console.log('[LiteBootstrap] Using Lite AppData only.');
    }
}

function getSelectionListenerStatus() {
    return false;
}

function startSelectionListener() {
    return false;
}

function stopSelectionListener() {
    return false;
}

function broadcastWindowState() {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }
    const channel = mainWindow.isMaximized() ? 'window-maximized' : 'window-unmaximized';
    mainWindow.webContents.send(channel);
}

function registerWindowHandlers() {
    ipcMain.on('minimize-window', (event) => {
        BrowserWindow.fromWebContents(event.sender)?.minimize();
    });

    ipcMain.on('maximize-window', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) return;
        if (win.isMaximized()) {
            win.unmaximize();
        } else {
            win.maximize();
        }
    });

    ipcMain.on('unmaximize-window', (event) => {
        BrowserWindow.fromWebContents(event.sender)?.unmaximize();
    });

    ipcMain.on('close-window', (event) => {
        BrowserWindow.fromWebContents(event.sender)?.close();
    });

    ipcMain.on('open-dev-tools', (event) => {
        BrowserWindow.fromWebContents(event.sender)?.webContents.openDevTools({ mode: 'detach' });
    });

    ipcMain.handle('get-platform', () => process.platform);
}

function registerWatcherHandlers() {
    ipcMain.handle('watcher:start', (_event, filePath, agentId, topicId) => {
        fileWatcher.watchFile(filePath, (changedPath) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('history-file-updated', { path: changedPath, agentId, topicId });
            }
        });
        return { success: true, watching: filePath };
    });

    ipcMain.handle('watcher:stop', () => {
        fileWatcher.stopWatching();
        return { success: true };
    });
}

function formatTimestampForFilename(timestamp) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}

function registerExportHandler() {
    ipcMain.handle('export-topic-as-markdown', async (_event, exportData) => {
        const { topicName, markdownContent } = exportData || {};
        if (!topicName || !markdownContent) {
            return { success: false, error: 'Missing topicName or markdownContent.' };
        }

        const safeTopicName = topicName.replace(/[/\\?%*:|"<>]/g, '-');
        const defaultFileName = `${safeTopicName}-${formatTimestampForFilename(Date.now())}.md`;
        const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
            title: 'Export Topic as Markdown',
            defaultPath: defaultFileName,
            filters: [
                { name: 'Markdown Files', extensions: ['md'] },
                { name: 'All Files', extensions: ['*'] },
            ],
        });

        if (canceled || !filePath) {
            return { success: false, error: 'Export cancelled.' };
        }

        try {
            await fs.writeFile(filePath, markdownContent, 'utf8');
            shell.showItemInFolder(filePath);
            return { success: true, path: filePath };
        } catch (error) {
            console.error('[LiteExport] failed:', error);
            return { success: false, error: error.message };
        }
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1540,
        height: 960,
        minWidth: 1120,
        minHeight: 720,
        frame: false,
        backgroundColor: '#efe7db',
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
        icon: path.join(SRC_ROOT, 'assets', 'icon.png'),
        webPreferences: {
            preload: resolveProjectPreload(SRC_ROOT, PRELOAD_ROLES.LITE),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });

    mainWindow.removeMenu();

    mainWindow.on('maximize', broadcastWindowState);
    mainWindow.on('unmaximize', broadcastWindowState);
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') {
            return;
        }

        const commandOrControl = process.platform === 'darwin' ? input.meta : input.control;

        if (input.key === 'F5' || (commandOrControl && input.key.toLowerCase() === 'r' && !input.shift)) {
            event.preventDefault();
            mainWindow.webContents.reload();
            return;
        }

        if (commandOrControl && input.shift && input.key.toLowerCase() === 'r') {
            event.preventDefault();
            mainWindow.webContents.reloadIgnoringCache();
            return;
        }

        if (commandOrControl && input.shift && input.key.toLowerCase() === 'i') {
            event.preventDefault();
            mainWindow.webContents.openDevTools({ mode: 'detach' });
        }
    });
    mainWindow.webContents.on('did-finish-load', () => {
        broadcastWindowState();
        themeHandlers.broadcastThemeUpdate(nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

async function bootstrap() {
    await bootstrapIndependentDataRoot();
    await fs.ensureDir(AGENT_DIR);
    await fs.ensureDir(USER_DATA_DIR);

    settingsManager = new SettingsManager(SETTINGS_FILE);
    settingsManager.startCleanupTimer();
    settingsManager.startAutoBackup(USER_DATA_DIR);

    agentConfigManager = new AgentConfigManager(AGENT_DIR);
    agentConfigManager.startCleanupTimer();

    fileManager.initializeFileManager(USER_DATA_DIR, AGENT_DIR);
    await knowledgeBase.initializeKnowledgeBase({
        dataRoot: APP_DATA_ROOT_IN_PROJECT,
        settingsManager,
        agentConfigManager,
        agentDir: AGENT_DIR,
    });

    registerWindowHandlers();
    registerWatcherHandlers();
    registerExportHandler();

    settingsHandlers.initialize({
        SETTINGS_FILE,
        USER_AVATAR_FILE,
        AGENT_DIR,
        settingsManager,
        agentConfigManager,
    });

    fileDialogHandlers.initialize(mainWindow, {
        getSelectionListenerStatus,
        stopSelectionListener,
        startSelectionListener,
        openChildWindows,
    });

    agentHandlers.initialize({
        AGENT_DIR,
        USER_DATA_DIR,
        SETTINGS_FILE,
        USER_AVATAR_FILE,
        settingsManager,
        agentConfigManager,
        getSelectionListenerStatus,
        stopSelectionListener,
        startSelectionListener,
    });

    chatHandlers.initialize(mainWindow, {
        AGENT_DIR,
        USER_DATA_DIR,
        APP_DATA_ROOT_IN_PROJECT,
        fileWatcher,
        settingsManager,
        agentConfigManager,
    });

    knowledgeBaseHandlers.initialize({
        agentConfigManager,
    });

    notesHandlers.initialize({
        APP_DATA_ROOT_IN_PROJECT,
        agentConfigManager,
    });

    promptHandlers.initialize({
        AGENT_DIR,
        APP_DATA_ROOT_IN_PROJECT,
    });

    themeHandlers.initialize({
        mainWindow,
        openChildWindows,
        projectRoot: REPO_ROOT,
        APP_DATA_ROOT_IN_PROJECT,
        settingsManager,
    });

    await emoticonHandlers.initialize({
        SETTINGS_FILE,
        APP_DATA_ROOT_IN_PROJECT,
    });
    emoticonHandlers.setupEmoticonHandlers();
}

app.whenReady().then(async () => {
    createWindow();
    await bootstrap();
    await mainWindow.loadFile(path.join(SRC_ROOT, 'renderer', 'index.html'));

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
            mainWindow?.loadFile(path.join(SRC_ROOT, 'renderer', 'index.html'));
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    fileWatcher.stopWatching();
    void knowledgeBase.shutdownKnowledgeBase().catch((error) => {
        console.warn('[LiteBootstrap] Failed to shutdown knowledge base cleanly:', error?.message || error);
    });
});
