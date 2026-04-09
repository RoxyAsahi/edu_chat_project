const { ipcMain } = require('electron');
const fs = require('fs-extra');
const path = require('path');

let AGENT_DIR = null;
let initialized = false;

function extractPromptTextFromLegacyConfig(config = {}) {
    if (typeof config.originalSystemPrompt === 'string' && config.originalSystemPrompt.trim()) {
        return config.originalSystemPrompt;
    }

    if (typeof config.systemPrompt === 'string' && config.systemPrompt.trim()) {
        return config.systemPrompt;
    }

    if (config.promptMode === 'modular') {
        const advancedPrompt = config.advancedSystemPrompt;
        if (typeof advancedPrompt === 'string' && advancedPrompt.trim()) {
            return advancedPrompt;
        }

        if (advancedPrompt && typeof advancedPrompt === 'object' && Array.isArray(advancedPrompt.blocks)) {
            return advancedPrompt.blocks
                .filter((block) => block && block.disabled !== true)
                .map((block) => {
                    if (block.type === 'newline') {
                        return '\n';
                    }

                    if (Array.isArray(block.variants) && block.variants.length > 0) {
                        const selectedIndex = Number.isInteger(block.selectedVariant) ? block.selectedVariant : 0;
                        return block.variants[selectedIndex] || block.content || '';
                    }

                    return block.content || '';
                })
                .join('');
        }
    }

    if (config.promptMode === 'preset' && typeof config.presetSystemPrompt === 'string') {
        return config.presetSystemPrompt;
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
                systemPrompt: extractPromptTextFromLegacyConfig(config),
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
