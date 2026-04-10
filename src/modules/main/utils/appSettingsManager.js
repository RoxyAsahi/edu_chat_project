// modules/utils/settingsManager.js
const fs = require('fs-extra');
const path = require('path');
const { EventEmitter } = require('events');
const {
    DEFAULT_KB_EMBEDDING_MODEL,
    DEFAULT_KB_RERANK_MODEL,
    DEFAULT_KB_TOP_K,
    DEFAULT_KB_CANDIDATE_TOP_K,
    DEFAULT_KB_SCORE_THRESHOLD,
} = require('../knowledge-base/constants');

class SettingsValidator {
    static validate(settings, defaultSettings) {
        const sourceSettings = settings || {};
        const validated = {};
        let hasIssues = false;

        const unknownKeys = Object.keys(sourceSettings).filter(key => !(key in defaultSettings));
        if (unknownKeys.length > 0) {
            hasIssues = true;
            console.log(`Removed unknown settings fields: ${unknownKeys.join(', ')}`);
        }
        
        for (const [key, defaultValue] of Object.entries(defaultSettings)) {
            if (!(key in sourceSettings)) {
                validated[key] = defaultValue;
                hasIssues = true;
                console.log(`Added missing field: ${key}`);
                continue;
            }

            validated[key] = sourceSettings[key];
            
            if (typeof validated[key] !== typeof defaultValue && defaultValue !== null) {
                validated[key] = defaultValue;
                hasIssues = true;
                console.log(`Fixed type for field: ${key}`);
            } else if (key.startsWith('lastOpen') && validated[key] === undefined) {
                validated[key] = null;
            }
        }
        
        if (validated.sidebarWidth < 100 || validated.sidebarWidth > 800) {
            validated.sidebarWidth = 260;
            hasIssues = true;
        }

        if (!Number.isFinite(validated.layoutLeftWidth) || validated.layoutLeftWidth < 160 || validated.layoutLeftWidth > 1200) {
            validated.layoutLeftWidth = 410;
            hasIssues = true;
        }

        if (!Number.isFinite(validated.layoutRightWidth) || validated.layoutRightWidth < 220 || validated.layoutRightWidth > 1200) {
            validated.layoutRightWidth = 400;
            hasIssues = true;
        }

        if (!Number.isFinite(validated.layoutLeftTopHeight) || validated.layoutLeftTopHeight < 140 || validated.layoutLeftTopHeight > 1600) {
            validated.layoutLeftTopHeight = 360;
            hasIssues = true;
        }
        
        if (!Array.isArray(validated.networkNotesPaths)) {
            validated.networkNotesPaths = [];
            hasIssues = true;
        }

        if (!Array.isArray(validated.combinedItemOrder)) {
            validated.combinedItemOrder = [];
            hasIssues = true;
        }

        if (!Array.isArray(validated.agentOrder)) {
            validated.agentOrder = [];
            hasIssues = true;
        }
        
        return { validated, hasIssues };
    }
}

class SettingsManager extends EventEmitter {
    constructor(settingsPath) {
        super();
        this.settingsPath = settingsPath;
        this.queue = [];
        this.processing = false;
        this.cache = null;
        this.cacheTimestamp = 0;
        this.lockFile = settingsPath + '.lock';
        
        // Lite-only settings schema.
        this.defaultSettings = {
            sidebarWidth: 260,
            notificationsSidebarWidth: 300,
            layoutLeftWidth: 410,
            layoutRightWidth: 400,
            layoutLeftTopHeight: 360,
            userName: 'User',
            vcpServerUrl: '',
            vcpApiKey: '',
            guideModel: '',
            defaultModel: '',
            lastModel: '',
            kbBaseUrl: '',
            kbApiKey: '',
            kbEmbeddingModel: DEFAULT_KB_EMBEDDING_MODEL,
            kbUseRerank: true,
            kbRerankModel: DEFAULT_KB_RERANK_MODEL,
            kbTopK: DEFAULT_KB_TOP_K,
            kbCandidateTopK: DEFAULT_KB_CANDIDATE_TOP_K,
            kbScoreThreshold: DEFAULT_KB_SCORE_THRESHOLD,
            vcpLogUrl: '',
            vcpLogKey: '',
            networkNotesPaths: [],
            enableAgentBubbleTheme: false,
            enableSmoothStreaming: false,
            enableWideChatLayout: false,
            chatBubbleMaxWidthDefault: 82,
            chatBubbleMaxWidthNotifications: 90,
            chatBubbleMaxWidthNarrow: 85,
            chatBubbleMaxWidthWideDefault: 92,
            chatBubbleMaxWidthWideNotifications: 96,
            chatBubbleMaxWidthWideNarrow: 92,
            chatFontPreset: 'system',
            chatFontCustom: '',
            chatCodeFontPreset: 'consolas',
            chatCodeFontCustom: '',
            chatDiaryFontPreset: 'serif',
            chatDiaryFontCustom: '',
            chatToolFontPreset: 'system',
            chatToolFontCustom: '',
            enableUserChatBubbleUi: true,
            showUserMetaInChatBubbleUi: true,
            minChunkBufferSize: 1,
            smoothStreamIntervalMs: 25,
            lastOpenItemId: null,
            lastOpenItemType: null,
            lastOpenTopicId: null,
            userAvatarCalculatedColor: null,
            combinedItemOrder: [],
            agentOrder: [],
            currentThemeMode: 'system',
            themeLastUpdated: 0,
            enableThoughtChainInjection: false
        };
    }

    async acquireLock(timeout = 5000) {
        const startTime = Date.now();
        while (await fs.pathExists(this.lockFile)) {
            if (Date.now() - startTime > timeout) {
                console.warn('Lock acquisition timeout, removing stale lock');
                await fs.remove(this.lockFile).catch(() => {});
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        await fs.writeFile(this.lockFile, `${process.pid}-${Date.now()}`);
    }

    async releaseLock() {
        await fs.remove(this.lockFile).catch(() => {});
    }

    async readSettings() {
        try {
            // Use the cache when the on-disk file has not changed.
            const stats = await fs.stat(this.settingsPath).catch(() => null);
            if (stats && this.cache && stats.mtimeMs <= this.cacheTimestamp) {
                return { ...this.cache };
            }

            const content = await fs.readFile(this.settingsPath, 'utf8');
            const settings = JSON.parse(content.replace(/^\uFEFF/, ''));
            
            // Refresh the in-memory cache.
            this.cache = settings;
            this.cacheTimestamp = stats ? stats.mtimeMs : Date.now();
            
            return { ...settings };
        } catch (error) {
            if (error.code === 'ENOENT') {
                return { ...this.defaultSettings };
            }
            
            console.error('Error reading settings, attempting recovery:', error);
            
            // Try the backup before giving up.
            const backupPath = this.settingsPath + '.backup';
            if (await fs.pathExists(backupPath)) {
                try {
                    const backupContent = await fs.readFile(backupPath, 'utf8');
                    const backupSettings = JSON.parse(backupContent.replace(/^\uFEFF/, ''));
                    
                    // Only recover from a backup that contains meaningful user state.
                    const isNonDefault = backupSettings && (
                        (Array.isArray(backupSettings.combinedItemOrder) && backupSettings.combinedItemOrder.length > 0) ||
                        (backupSettings.userName && backupSettings.userName !== 'User') ||
                        backupSettings.vcpServerUrl
                    );

                    if (isNonDefault) {
                        console.log('Recovered settings from valid backup');
                        return { ...backupSettings };
                    } else {
                        console.warn('Backup exists but appears to be default or empty, skipping recovery to prevent overwrite');
                    }
                } catch (backupError) {
                    console.error('Backup also corrupted:', backupError);
                }
            }
            
            // Refuse to overwrite a corrupted file when no valid backup is available.
            throw new Error(`Settings file corrupted and no valid backup found: ${error.message}`);
        }
    }

    async writeSettings(settings) {
        const tempFile = this.settingsPath + '.tmp';
        const backupFile = this.settingsPath + '.backup';
        
        try {
            // Validate against the Lite schema before writing.
            const { validated } = SettingsValidator.validate(settings, this.defaultSettings);
            
            // Write through a temp file first.
            await fs.writeJson(tempFile, validated, { spaces: 2 });
            
            // Verify the temp file before promoting it.
            const verifyContent = await fs.readFile(tempFile, 'utf8');
            JSON.parse(verifyContent);
            
            // Refresh the backup when the source file already exists.
            if (await fs.pathExists(this.settingsPath)) {
                await fs.copy(this.settingsPath, backupFile, { overwrite: true });
            }
            
            // Atomically replace the source file.
            await fs.move(tempFile, this.settingsPath, { overwrite: true });
            
            // Refresh the cache after the write succeeds.
            const newTimestamp = Date.now();
            this.cache = { ...validated };
            this.cacheTimestamp = newTimestamp;
            
            // Notify listeners after the new state is durable.
            this.emit('settings-updated', validated);
            
            return true;
        } catch (error) {
            console.error('Error writing settings:', error);
            
            // Best-effort temp file cleanup.
            await fs.remove(tempFile).catch(() => {});
            
            throw error;
        }
    }

    async updateSettings(updater) {
        return new Promise((resolve, reject) => {
            this.queue.push({ updater, resolve, reject });
            this.processQueue();
        });
    }

    async processQueue() {
        if (this.processing || this.queue.length === 0) {
            return;
        }

        this.processing = true;
        const { updater, resolve, reject } = this.queue.shift();

        try {
            await this.acquireLock();
            
            const currentSettings = await this.readSettings();
            let newSettings;
            if (typeof updater === 'function') {
                newSettings = await updater(currentSettings);
            } else {
                // Merge on top of the Lite defaults to keep the schema complete.
                newSettings = { ...this.defaultSettings, ...currentSettings, ...updater };
            }
            
            await this.writeSettings(newSettings);
            
            resolve({ success: true, settings: newSettings });
        } catch (error) {
            reject(error);
        } finally {
            await this.releaseLock();
            this.processing = false;
            
            // Continue draining queued updates.
            if (this.queue.length > 0) {
                setImmediate(() => this.processQueue());
            }
        }
    }

    // 定期清理过期的锁文件
    startCleanupTimer() {
        setInterval(async () => {
            if (await fs.pathExists(this.lockFile)) {
                try {
                    const lockContent = await fs.readFile(this.lockFile, 'utf8');
                    const [pid, timestamp] = lockContent.split('-');
                    
                    // 如果锁文件超过10秒，认为是过期的
                    if (Date.now() - parseInt(timestamp) > 10000) {
                        console.log('Removing stale lock file');
                        await fs.remove(this.lockFile);
                    }
                } catch (error) {
                    console.error('Error checking lock file:', error);
                }
            }
        }, 30000); // 每30秒检查一次
    }

    // 自动备份机制
    startAutoBackup(userDataDir) {
        setInterval(async () => {
            try {
                if (await fs.pathExists(this.settingsPath)) {
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    const backupDir = path.join(userDataDir, 'backups');
                    await fs.ensureDir(backupDir);
                    
                    const backupPath = path.join(backupDir, `settings-${timestamp}.json`);
                    await fs.copy(this.settingsPath, backupPath);
                    
                    // 只保留最近7天的备份
                    const files = await fs.readdir(backupDir);
                    const backupFiles = files.filter(f => f.startsWith('settings-'));
                    if (backupFiles.length > 7) {
                        backupFiles.sort((a, b) => b.localeCompare(a)); // 降序，最新在前
                        for (let i = 7; i < backupFiles.length; i++) {
                            await fs.remove(path.join(backupDir, backupFiles[i]));
                        }
                    }
                }
            } catch (error) {
                console.error('Auto backup failed:', error);
            }
        }, 24 * 60 * 60 * 1000); // 每天备份一次
    }

    // 清理缓存
    clearCache() {
        this.cache = null;
        this.cacheTimestamp = 0;
    }

    // 强制刷新缓存
    async refreshCache() {
        this.clearCache();
        return await this.readSettings();
    }
}
module.exports = SettingsManager;


