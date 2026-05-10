const { ipcMain } = require('electron');
const fs = require('fs-extra');
const path = require('path');

let AGENT_DIR = null;
let initialized = false;

function extractPromptTextFromAgentConfig(config = {}) {
    if (typeof config.originalSystemPrompt === 'string' && config.originalSystemPrompt.trim()) {
        return config.originalSystemPrompt;
    }

    if (typeof config.systemPrompt === 'string' && config.systemPrompt.trim()) {
        return config.systemPrompt;
    }

    return '';
}

async function loadAgentConfig(agentId) {
    try {
        const { getAgentConfigById } = require('./agentHandlers');
        const config = await getAgentConfigById(agentId);
        if (config && !config.error) {
            return config;
        }
    } catch (_error) {
        // Fall back to direct file access below.
    }

    const configPath = path.join(AGENT_DIR, agentId, 'config.json');
    if (!await fs.pathExists(configPath)) {
        throw new Error('Agent config not found.');
    }

    return fs.readJson(configPath);
}

function initialize(options) {
    AGENT_DIR = options.AGENT_DIR;

    if (initialized) {
        return;
    }

    ipcMain.handle('get-active-system-prompt', async (_event, agentId) => {
        try {
            const config = await loadAgentConfig(agentId);
            return {
                success: true,
                systemPrompt: extractPromptTextFromAgentConfig(config),
                promptMode: 'original',
            };
        } catch (error) {
            console.error('[PromptHandlers] Failed to load active system prompt:', error);
            return {
                success: false,
                error: error.message,
                systemPrompt: '',
                promptMode: 'original',
            };
        }
    });

    initialized = true;
}

module.exports = {
    initialize,
};
