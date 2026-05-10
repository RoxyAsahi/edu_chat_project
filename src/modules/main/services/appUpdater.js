const UPDATE_CHANNELS = Object.freeze({
    checking: 'app:update-checking',
    available: 'app:update-available',
    notAvailable: 'app:update-not-available',
    progress: 'app:update-download-progress',
    downloaded: 'app:update-downloaded',
    error: 'app:update-error',
});

let appRef = null;
let getMainWindowRef = null;
let initialized = false;
let checking = false;
let downloading = false;
let lastUpdateInfo = null;
let downloadedUpdateInfo = null;
let lastError = null;
let autoUpdaterRef = null;

function getAutoUpdater() {
    if (!autoUpdaterRef) {
        autoUpdaterRef = require('electron-updater').autoUpdater;
    }
    return autoUpdaterRef;
}

function isPortableRuntime() {
    return Boolean(process.env.PORTABLE_EXECUTABLE_DIR || process.env.PORTABLE_EXECUTABLE_FILE);
}

function serializeError(error) {
    if (!error) {
        return { message: 'Unknown update error' };
    }

    return {
        message: String(error.message || error),
        code: error.code || error.name || '',
    };
}

function serializeUpdateInfo(updateInfo = {}) {
    if (!updateInfo || typeof updateInfo !== 'object') {
        return null;
    }

    return {
        version: String(updateInfo.version || ''),
        releaseName: String(updateInfo.releaseName || ''),
        releaseDate: String(updateInfo.releaseDate || ''),
        releaseNotes: updateInfo.releaseNotes || '',
    };
}

function serializeProgress(progress = {}) {
    const percent = Number(progress.percent);
    const transferred = Number(progress.transferred);
    const total = Number(progress.total);
    const bytesPerSecond = Number(progress.bytesPerSecond);

    return {
        percent: Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0,
        transferred: Number.isFinite(transferred) ? transferred : 0,
        total: Number.isFinite(total) ? total : 0,
        bytesPerSecond: Number.isFinite(bytesPerSecond) ? bytesPerSecond : 0,
    };
}

function getSupportInfo() {
    const isPackaged = Boolean(appRef?.isPackaged);
    const isPortable = isPortableRuntime();
    let unsupportedReason = '';

    if (!isPackaged) {
        unsupportedReason = 'development';
    } else if (isPortable) {
        unsupportedReason = 'portable';
    }

    return {
        version: String(appRef?.getVersion?.() || ''),
        platform: process.platform,
        isPackaged,
        isPortable,
        updateSupported: isPackaged && !isPortable,
        unsupportedReason,
    };
}

function getInfo() {
    return {
        ...getSupportInfo(),
        checking,
        downloading,
        updateInfo: serializeUpdateInfo(lastUpdateInfo),
        downloadedUpdateInfo: serializeUpdateInfo(downloadedUpdateInfo),
        lastError,
    };
}

function emit(channel, payload = {}) {
    const win = getMainWindowRef?.();
    if (!win || win.isDestroyed()) {
        return;
    }

    win.webContents.send(channel, {
        ...getInfo(),
        ...payload,
    });
}

function initialize({ app, getMainWindow } = {}) {
    appRef = app || appRef;
    getMainWindowRef = typeof getMainWindow === 'function' ? getMainWindow : getMainWindowRef;

    if (initialized) {
        return getInfo();
    }

    const autoUpdater = getAutoUpdater();
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.disableDifferentialDownload = true;

    autoUpdater.on('checking-for-update', () => {
        checking = true;
        lastError = null;
        emit(UPDATE_CHANNELS.checking, { status: 'checking' });
    });

    autoUpdater.on('update-available', (updateInfo) => {
        checking = false;
        lastUpdateInfo = updateInfo || null;
        downloadedUpdateInfo = null;
        emit(UPDATE_CHANNELS.available, {
            status: 'available',
            updateInfo: serializeUpdateInfo(lastUpdateInfo),
        });
    });

    autoUpdater.on('update-not-available', (updateInfo) => {
        checking = false;
        lastUpdateInfo = null;
        downloadedUpdateInfo = null;
        emit(UPDATE_CHANNELS.notAvailable, {
            status: 'not-available',
            updateInfo: serializeUpdateInfo(updateInfo),
        });
    });

    autoUpdater.on('download-progress', (progress) => {
        downloading = true;
        emit(UPDATE_CHANNELS.progress, {
            status: 'downloading',
            progress: serializeProgress(progress),
        });
    });

    autoUpdater.on('update-downloaded', (updateInfo) => {
        downloading = false;
        downloadedUpdateInfo = updateInfo || lastUpdateInfo;
        emit(UPDATE_CHANNELS.downloaded, {
            status: 'downloaded',
            downloadedUpdateInfo: serializeUpdateInfo(downloadedUpdateInfo),
            progress: { percent: 100 },
        });
    });

    autoUpdater.on('error', (error) => {
        checking = false;
        downloading = false;
        lastError = serializeError(error);
        emit(UPDATE_CHANNELS.error, {
            status: 'error',
            error: lastError.message,
            updateError: lastError,
        });
    });

    initialized = true;
    return getInfo();
}

async function checkForUpdates() {
    const supportInfo = getSupportInfo();
    if (!supportInfo.updateSupported) {
        return {
            ...getInfo(),
            status: 'unsupported',
        };
    }

    if (checking) {
        return {
            ...getInfo(),
            status: 'checking',
        };
    }

    checking = true;
    lastError = null;

    try {
        const autoUpdater = getAutoUpdater();
        const result = await autoUpdater.checkForUpdates();
        return {
            ...getInfo(),
            status: lastUpdateInfo ? 'available' : 'checked',
            updateInfo: serializeUpdateInfo(result?.updateInfo || lastUpdateInfo),
        };
    } finally {
        checking = false;
    }
}

async function downloadUpdate() {
    const supportInfo = getSupportInfo();
    if (!supportInfo.updateSupported) {
        return {
            ...getInfo(),
            status: 'unsupported',
        };
    }

    if (downloading) {
        return {
            ...getInfo(),
            status: 'downloading',
        };
    }

    downloading = true;
    lastError = null;

    try {
        const autoUpdater = getAutoUpdater();
        const files = await autoUpdater.downloadUpdate();
        return {
            ...getInfo(),
            status: 'downloaded',
            files: Array.isArray(files) ? files : [],
        };
    } finally {
        downloading = false;
    }
}

function quitAndInstall() {
    const supportInfo = getSupportInfo();
    if (!supportInfo.updateSupported) {
        return {
            ...getInfo(),
            status: 'unsupported',
        };
    }

    const autoUpdater = getAutoUpdater();
    autoUpdater.quitAndInstall(false, true);
    return {
        ...getInfo(),
        status: 'installing',
    };
}

module.exports = {
    UPDATE_CHANNELS,
    initialize,
    getInfo,
    checkForUpdates,
    downloadUpdate,
    quitAndInstall,
    isPortableRuntime,
};
