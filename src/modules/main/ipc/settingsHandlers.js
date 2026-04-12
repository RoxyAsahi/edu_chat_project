// modules/ipc/settingsHandlers.js
const { ipcMain } = require('electron');
const fs = require('fs-extra');
const path = require('path');

/**
 * Initializes settings and theme related IPC handlers.
 * @param {object} paths - An object containing required paths.
 * @param {string} paths.SETTINGS_FILE - The path to the settings.json file.
 * @param {string} paths.USER_AVATAR_FILE - The path to the user_avatar.png file.
 * @param {string} paths.AGENT_DIR - The path to the agents directory.
 * @param {object} paths.settingsManager - The AppSettingsManager instance.
 */
function initialize(paths) {
    const { SETTINGS_FILE, USER_AVATAR_FILE, AGENT_DIR, settingsManager, agentConfigManager } = paths;
    const WEBINDEX_MODEL_FILE = path.join(path.dirname(SETTINGS_FILE), 'webindexmodel.json');

    // Settings Management
    ipcMain.handle('load-settings', async () => {
        try {
            const settings = await settingsManager.readSettings();
            
            // Check for user avatar
            if (await fs.pathExists(USER_AVATAR_FILE)) {
                settings.userAvatarUrl = `file://${USER_AVATAR_FILE}?t=${Date.now()}`;
            } else {
                settings.userAvatarUrl = null; // Or a default path
            }
            
            return settings;
        } catch (error) {
            console.error('加载设置失败:', error);
            return {
                error: error.message,
                sidebarWidth: 260,
                notificationsSidebarWidth: 300,
                userAvatarUrl: null,
            };
        }
    });

    ipcMain.handle('save-settings', async (event, settings) => {
        try {
            // User avatar URL is handled by 'save-user-avatar', remove it from general settings to avoid saving a file path
            // Also protect order fields from being accidentally overwritten by stale renderer snapshots.
            const {
                userAvatarUrl,
                combinedItemOrder,
                agentOrder,
                ...settingsToSave
            } = settings;

            const result = await settingsManager.updateSettings(settingsToSave);
            return result;
        } catch (error) {
            console.error('Failed to save settings:', error);
            return { success: false, error: error.message };
        }
    });

    // New IPC Handler to save calculated avatar color
    ipcMain.handle('save-avatar-color', async (event, { type, id, color }) => {
        try {
            if (type === 'user') {
                const result = await settingsManager.updateSettings(settings => ({
                    ...settings,
                    userAvatarCalculatedColor: color
                }));
                console.log(`[Main] User avatar color saved: ${color}`);
                return result;
            } else if (type === 'agent' && id) {
                if (agentConfigManager) {
                    const result = await agentConfigManager.updateAgentConfig(id, config => ({
                        ...config,
                        avatarCalculatedColor: color
                    }));
                    console.log(`[Main] Agent ${id} avatar color saved: ${color}`);
                    return result;
                } else {
                    // Fallback path when AgentConfigManager is not available.
                    const configPath = path.join(AGENT_DIR, id, 'config.json');
                    if (await fs.pathExists(configPath)) {
                        let agentConfig;
                        // Fail fast if the config file cannot be parsed so we do not overwrite it with a broken payload.
                        try {
                            agentConfig = await fs.readJson(configPath);
                        } catch (parseError) {
                            console.error(`[Main] Error parsing agent config for ${id} to save avatar color:`, parseError);
                            return { success: false, error: `Failed to read agent config for ${id}: ${parseError.message}` };
                        }
                        
                        agentConfig.avatarCalculatedColor = color;
                        
                        // Write through a temp file first.
                        const tempConfigPath = configPath + '.tmp';
                        await fs.writeJson(tempConfigPath, agentConfig, { spaces: 2 });
                        
                        // Verify the temp file before replacing the source file.
                        const verifyContent = await fs.readFile(tempConfigPath, 'utf8');
                        JSON.parse(verifyContent);
                        
                        // Promote the verified temp file into place.
                        await fs.move(tempConfigPath, configPath, { overwrite: true });
                        
                        console.log(`[Main] Agent ${id} avatar color saved: ${color}`);
                        return { success: true };
                    } else {
                        return { success: false, error: `Agent config for ${id} not found.` };
                    }
                }
            }
            return { success: false, error: 'Invalid type or missing ID for saving avatar color.' };
        } catch (error) {
            console.error('Error saving avatar color:', error);
            
            // Clean up a temp file left by the fallback write path if needed.
            if (type === 'agent' && id && !agentConfigManager) {
                const tempConfigPath = path.join(AGENT_DIR, id, 'config.json') + '.tmp';
                if (await fs.pathExists(tempConfigPath)) {
                    await fs.remove(tempConfigPath).catch(() => {});
                }
            }
            
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('load-webindex-models', async () => {
        try {
            if (!await fs.pathExists(WEBINDEX_MODEL_FILE)) {
                return {
                    success: true,
                    exists: false,
                    path: WEBINDEX_MODEL_FILE,
                    models: [],
                    defaults: [],
                    remoteVoices: [],
                    mergedVoiceOptions: []
                };
            }

            const payload = await fs.readJson(WEBINDEX_MODEL_FILE);

            const defaults = Array.isArray(payload?.defaults) ? payload.defaults : [];
            const remoteVoices = Array.isArray(payload?.remoteVoices) ? payload.remoteVoices : [];
            const mergedVoiceOptions = Array.isArray(payload?.mergedVoiceOptions)
                ? payload.mergedVoiceOptions
                : [...defaults, ...remoteVoices];

            const legacyModels = Array.isArray(payload?.models) ? payload.models : [];
            const normalizedLegacyModels = legacyModels.flatMap(model => {
                if (Array.isArray(model?.mergedVoiceOptions) && model.mergedVoiceOptions.length) {
                    return model.mergedVoiceOptions;
                }
                const legacyDefaults = Array.isArray(model?.defaults) ? model.defaults : [];
                const legacyRemoteVoices = Array.isArray(model?.remoteVoices) ? model.remoteVoices : [];
                return [...legacyDefaults, ...legacyRemoteVoices];
            });

            return {
                success: true,
                exists: true,
                path: WEBINDEX_MODEL_FILE,
                models: mergedVoiceOptions.length ? mergedVoiceOptions : normalizedLegacyModels,
                defaults,
                remoteVoices,
                mergedVoiceOptions: mergedVoiceOptions.length ? mergedVoiceOptions : normalizedLegacyModels,
                updatedAt: payload?.updatedAt || null,
                source: payload?.source || 'unknown',
                providerUrl: payload?.providerUrl || null,
                modelId: payload?.modelId || null
            };
        } catch (error) {
            console.error('Failed to read webindexmodel.json:', error);
            return {
                success: false,
                error: error.message,
                path: WEBINDEX_MODEL_FILE,
                models: [],
                defaults: [],
                remoteVoices: [],
                mergedVoiceOptions: []
            };
        }
    });

    // Recovery is handled inside SettingsManager.
}

module.exports = {
    initialize
};

