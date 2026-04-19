const { app, BrowserWindow, ipcMain, nativeTheme, dialog, shell } = require('electron');
const fs = require('fs-extra');
const path = require('path');
const chokidar = require('chokidar');

let mainProcessLogDir = null;

function isBrokenPipeError(error) {
    if (!error) {
        return false;
    }
    return error.code === 'EPIPE'
        || error.code === 'ERR_STREAM_DESTROYED'
        || /broken pipe/i.test(String(error.message || ''));
}

function resolveMainProcessLogDir() {
    if (mainProcessLogDir) {
        return mainProcessLogDir;
    }

    try {
        return path.join(app.getPath('userData'), '.tmp');
    } catch (_error) {
        return path.join(process.cwd(), '.tmp');
    }
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
                    const logDir = resolveMainProcessLogDir();
                    fs.ensureDirSync(logDir);
                    fs.appendFileSync(
                        path.join(logDir, 'main-process-stream-errors.log'),
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
const modelServiceHandlers = require('../modules/main/ipc/modelServiceHandlers');
const fileDialogHandlers = require('../modules/main/ipc/fileDialogHandlers');
const { getAgentConfigById, ...agentHandlers } = require('../modules/main/ipc/agentHandlers');
const chatHandlers = require('../modules/main/ipc/chatHandlers');
const knowledgeBaseHandlers = require('../modules/main/ipc/knowledgeBaseHandlers');
const notesHandlers = require('../modules/main/ipc/notesHandlers');
const promptHandlers = require('../modules/main/ipc/promptHandlers');
const studyHandlers = require('../modules/main/ipc/studyHandlers');
const themeHandlers = require('../modules/main/ipc/themeHandlers');
const emoticonHandlers = require('../modules/main/ipc/emoticonHandlers');
const { ok, fail } = require('../modules/main/ipc/ipcResult');
const fileManager = require('../modules/main/fileManager');
const knowledgeBase = require('../modules/main/knowledge-base');
const modelUsageTracker = require('../modules/main/modelUsageTracker');
const SettingsManager = require('../modules/main/utils/appSettingsManager');
const AgentConfigManager = require('../modules/main/utils/agentConfigManager');
const { resolveDataRootPaths } = require('../modules/main/utils/dataRootResolver');
const { PRELOAD_ROLES, resolveProjectPreload } = require('../modules/main/services/preloadPaths');

const SRC_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SRC_ROOT, '..');
let DATA_ROOT_PATHS = null;
let DATA_ROOT = null;
let AGENT_DIR = null;
let USER_DATA_DIR = null;
let SETTINGS_FILE = null;
let USER_AVATAR_FILE = null;
let AVATAR_IMAGE_DIR = null;

function ensureDataRootPaths() {
    if (DATA_ROOT_PATHS) {
        return DATA_ROOT_PATHS;
    }

    DATA_ROOT_PATHS = resolveDataRootPaths({ app, env: process.env, cwd: REPO_ROOT });
    DATA_ROOT = DATA_ROOT_PATHS.dataRoot;
    AGENT_DIR = DATA_ROOT_PATHS.agentsDir;
    USER_DATA_DIR = DATA_ROOT_PATHS.userDataDir;
    SETTINGS_FILE = DATA_ROOT_PATHS.settingsFile;
    USER_AVATAR_FILE = DATA_ROOT_PATHS.userAvatarFile;
    AVATAR_IMAGE_DIR = DATA_ROOT_PATHS.avatarImageDir;
    mainProcessLogDir = path.join(DATA_ROOT, '.tmp');
    return DATA_ROOT_PATHS;
}

let mainWindow = null;
const openChildWindows = [];
let settingsManager = null;
let agentConfigManager = null;
let historyWatcher = null;
let lastInternalSaveTime = 0;
let internalSaveTimeout = null;
let isEditingInProgress = false;
const INTERNAL_SAVE_WINDOW_MS = 2000;
let windowHandlersRegistered = false;
let watcherHandlersRegistered = false;
let exportHandlerRegistered = false;
let coreServicesInitialized = false;
let coreIpcRegistered = false;
let domainIpcRegistered = false;
let deferredServicesPromise = null;

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
            console.error('[UniStudyWatcher] error:', error);
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
    ensureDataRootPaths();
    await fs.ensureDir(DATA_ROOT);
    console.log(`[UniStudyBootstrap] Data root: ${DATA_ROOT}`);
    if (DATA_ROOT_PATHS.source === 'env-override') {
        console.log('[UniStudyBootstrap] Using UNISTUDY_DATA_ROOT override.');
    } else {
        console.log('[UniStudyBootstrap] Using Electron userData default.');
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
    const channels = mainWindow.isMaximized()
        ? ['window-maximized', 'window:maximized']
        : ['window-unmaximized', 'window:unmaximized'];

    channels.forEach((channel) => {
        mainWindow.webContents.send(channel);
    });
}

function registerWindowHandlers() {
    if (windowHandlersRegistered) {
        return;
    }

    const registerWindowEvent = (channels, handler) => {
        channels.forEach((channel) => {
            ipcMain.on(channel, handler);
        });
    };

    registerWindowEvent(['minimize-window', 'window:minimize'], (event) => {
        BrowserWindow.fromWebContents(event.sender)?.minimize();
    });

    registerWindowEvent(['maximize-window', 'window:maximize'], (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) return;
        if (win.isMaximized()) {
            win.unmaximize();
        } else {
            win.maximize();
        }
    });

    registerWindowEvent(['unmaximize-window', 'window:unmaximize'], (event) => {
        BrowserWindow.fromWebContents(event.sender)?.unmaximize();
    });

    registerWindowEvent(['close-window', 'window:close'], (event) => {
        BrowserWindow.fromWebContents(event.sender)?.close();
    });

    registerWindowEvent(['open-dev-tools', 'window:open-dev-tools'], (event) => {
        BrowserWindow.fromWebContents(event.sender)?.webContents.openDevTools({ mode: 'detach' });
    });

    ['get-platform', 'window:get-platform'].forEach((channel) => {
        ipcMain.handle(channel, () => process.platform);
    });

    ipcMain.handle('renderer:fatal-error', (_event, payload = {}) => {
        const phase = typeof payload.phase === 'string' && payload.phase.trim()
            ? payload.phase.trim()
            : 'runtime';
        const message = typeof payload.message === 'string' && payload.message.trim()
            ? payload.message.trim()
            : 'Unknown renderer fatal error';
        const stack = typeof payload.stack === 'string' ? payload.stack.trim() : '';
        const source = typeof payload.source === 'string' ? payload.source.trim() : '';

        console.error(`[UniStudyRenderer][Fatal][${phase}] ${message}`);
        if (source) {
            console.error(`[UniStudyRenderer][Fatal][source] ${source}`);
        }
        if (stack) {
            console.error(stack);
        }

        return ok();
    });

    windowHandlersRegistered = true;
}

function registerWatcherHandlers() {
    if (watcherHandlersRegistered) {
        return;
    }

    ipcMain.handle('watcher:start', (_event, filePath, agentId, topicId) => {
        if (typeof filePath !== 'string' || filePath.trim() === ''
            || typeof agentId !== 'string' || agentId.trim() === ''
            || typeof topicId !== 'string' || topicId.trim() === '') {
            return fail('watcher:start expects non-empty filePath, agentId, and topicId.');
        }

        fileWatcher.watchFile(filePath, (changedPath) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                const payload = { path: changedPath, agentId, topicId };
                mainWindow.webContents.send('history-file-updated', payload);
                mainWindow.webContents.send('watcher:history-updated', payload);
            }
        });
        return ok({ watching: filePath });
    });

    ipcMain.handle('watcher:stop', () => {
        fileWatcher.stopWatching();
        return ok();
    });

    watcherHandlersRegistered = true;
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
    if (exportHandlerRegistered) {
        return;
    }

    ipcMain.handle('export-topic-as-markdown', async (_event, exportData) => {
        const { topicName, markdownContent } = exportData || {};
        if (!topicName || !markdownContent) {
            return fail('Missing topicName or markdownContent.');
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
            return fail('Export cancelled.');
        }

        try {
            await fs.writeFile(filePath, markdownContent, 'utf8');
            shell.showItemInFolder(filePath);
            return ok({ path: filePath });
        } catch (error) {
            console.error('[UniStudyExport] failed:', error);
            return fail(error);
        }
    });

    exportHandlerRegistered = true;
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1540,
        height: 960,
        minWidth: 900,
        minHeight: 720,
        frame: false,
        backgroundColor: '#efe7db',
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
        icon: path.join(SRC_ROOT, 'assets', 'icon.png'),
        webPreferences: {
            preload: resolveProjectPreload(SRC_ROOT, PRELOAD_ROLES.LITE),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
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

function getMainWindow() {
    return mainWindow;
}

function getOpenChildWindows() {
    return openChildWindows;
}

async function initializeCoreServices() {
    if (coreServicesInitialized) {
        return;
    }

    ensureDataRootPaths();
    await bootstrapIndependentDataRoot();
    await fs.ensureDir(AGENT_DIR);
    await fs.ensureDir(USER_DATA_DIR);

    settingsManager = new SettingsManager(SETTINGS_FILE);
    settingsManager.startCleanupTimer();
    settingsManager.startAutoBackup(USER_DATA_DIR);

    agentConfigManager = new AgentConfigManager(AGENT_DIR);
    agentConfigManager.startCleanupTimer();

    fileManager.initializeFileManager(USER_DATA_DIR, AGENT_DIR);
    modelUsageTracker.initializeModelUsageTracker({ dataRoot: DATA_ROOT });

    coreServicesInitialized = true;
}

function registerCoreIpc() {
    if (coreIpcRegistered) {
        return;
    }

    registerWindowHandlers();
    registerWatcherHandlers();
    registerExportHandler();

    coreIpcRegistered = true;
}

async function registerDomainIpc() {
    if (domainIpcRegistered) {
        return;
    }

    ensureDataRootPaths();
    await emoticonHandlers.initialize({
        SETTINGS_FILE,
        DATA_ROOT,
        PROJECT_ROOT: REPO_ROOT,
    });
    emoticonHandlers.setupEmoticonHandlers();

    settingsHandlers.initialize({
        SETTINGS_FILE,
        USER_AVATAR_FILE,
        AGENT_DIR,
        DATA_ROOT,
        PROJECT_ROOT: REPO_ROOT,
        settingsManager,
        agentConfigManager,
    });
    modelServiceHandlers.initialize();

    fileDialogHandlers.initialize(getMainWindow, {
        getMainWindow,
        getSelectionListenerStatus,
        stopSelectionListener,
        startSelectionListener,
        openChildWindows,
        getOpenChildWindows,
    });

    agentHandlers.initialize({
        AGENT_DIR,
        USER_DATA_DIR,
        AVATAR_IMAGE_DIR,
        SETTINGS_FILE,
        USER_AVATAR_FILE,
        settingsManager,
        agentConfigManager,
        getSelectionListenerStatus,
        stopSelectionListener,
        startSelectionListener,
    });

    chatHandlers.initialize(getMainWindow, {
        getMainWindow,
        AGENT_DIR,
        USER_DATA_DIR,
        DATA_ROOT,
        PROJECT_ROOT: REPO_ROOT,
        fileWatcher,
        settingsManager,
        agentConfigManager,
        getSelectionListenerStatus,
        stopSelectionListener,
        startSelectionListener,
    });

    knowledgeBaseHandlers.initialize({
        agentConfigManager,
        ensureKnowledgeBaseReady,
    });

    notesHandlers.initialize({
        DATA_ROOT,
        agentConfigManager,
    });

    studyHandlers.initialize({
        DATA_ROOT,
        settingsManager,
    });

    promptHandlers.initialize({
        AGENT_DIR,
        DATA_ROOT,
    });

    themeHandlers.initialize({
        getMainWindow,
        getOpenChildWindows,
        projectRoot: REPO_ROOT,
        APP_DATA_ROOT_IN_PROJECT: DATA_ROOT,
        settingsManager,
    });

    domainIpcRegistered = true;
}

function startDeferredServices() {
    if (deferredServicesPromise) {
        return deferredServicesPromise;
    }

    ensureDataRootPaths();
    deferredServicesPromise = (async () => {
        try {
            await knowledgeBase.initializeKnowledgeBase({
                dataRoot: DATA_ROOT,
                settingsManager,
                agentConfigManager,
                agentDir: AGENT_DIR,
            });
        } catch (error) {
            deferredServicesPromise = null;
            throw error;
        }
    })();

    deferredServicesPromise.catch((error) => {
        console.error('[UniStudyBootstrap] Deferred services failed to start:', error);
    });

    return deferredServicesPromise;
}

async function ensureKnowledgeBaseReady() {
    return startDeferredServices();
}

async function bootstrap() {
    await initializeCoreServices();
    registerCoreIpc();
    await registerDomainIpc();
}

async function loadMainWindow() {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) {
        return;
    }

    await win.loadFile(path.join(SRC_ROOT, 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
    createWindow();
    await bootstrap();
    const windowLoadPromise = loadMainWindow();
    startDeferredServices();
    await windowLoadPromise;

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
            void loadMainWindow();
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
    settingsManager?.dispose?.();
    agentConfigManager?.dispose?.();
    void knowledgeBase.shutdownKnowledgeBase().catch((error) => {
        console.warn('[UniStudyBootstrap] Failed to shutdown knowledge base cleanly:', error?.message || error);
    });
});
