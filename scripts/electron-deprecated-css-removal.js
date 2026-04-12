const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');
const { ensureFixtureDataRoot, resolveFixtureDataRoot } = require('./lib/runtime-data-roots');
const { buildPreloadBundles } = require('./lib/preload-bundles');

const DEPRECATED_FIELDS = ['cardCss', 'chatCss', 'customCss'];
const REMOVED_INPUT_IDS = ['agentCardCss', 'agentChatCss', 'agentCustomCss'];

async function readJsonIfExists(filePath) {
    if (!await fs.pathExists(filePath)) {
        return null;
    }

    try {
        return await fs.readJson(filePath);
    } catch {
        return null;
    }
}

async function chooseTopicWithAssistantMessages(dataRoot) {
    const userDataRoot = path.join(dataRoot, 'UserData');
    if (!await fs.pathExists(userDataRoot)) {
        throw new Error(`UserData root not found: ${userDataRoot}`);
    }

    const agentIds = await fs.readdir(userDataRoot);
    for (const agentId of agentIds) {
        const topicsRoot = path.join(userDataRoot, agentId, 'topics');
        if (!await fs.pathExists(topicsRoot)) {
            continue;
        }

        const topicIds = await fs.readdir(topicsRoot);
        for (const topicId of topicIds) {
            const historyPath = path.join(topicsRoot, topicId, 'history.json');
            const history = await readJsonIfExists(historyPath);
            if (!Array.isArray(history)) {
                continue;
            }

            const hasAssistant = history.some((message) => message && message.role === 'assistant');
            if (hasAssistant) {
                return { agentId, topicId, historyPath, assistantCount: history.filter((item) => item.role === 'assistant').length };
            }
        }
    }

    throw new Error('No topic with assistant messages was found in the copied AppData.');
}

async function prepareDataRoot(repoRoot) {
    const sourceRoot = await ensureFixtureDataRoot(resolveFixtureDataRoot({ repoRoot }));

    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-css-removal-'));
    await fs.copy(sourceRoot, tempRoot);

    const targetTopic = await chooseTopicWithAssistantMessages(tempRoot);
    const settingsPath = path.join(tempRoot, 'settings.json');
    const settings = (await readJsonIfExists(settingsPath)) || {};
    settings.lastOpenItemId = targetTopic.agentId;
    settings.lastOpenItemType = 'agent';
    settings.lastOpenTopicId = targetTopic.topicId;
    await fs.writeJson(settingsPath, settings, { spaces: 2 });

    return {
        tempRoot,
        targetTopic,
    };
}

async function launchApp(repoRoot, dataRoot) {
    await buildPreloadBundles();
    return electron.launch({
        args: [repoRoot],
        cwd: repoRoot,
        env: {
            ...process.env,
            UNISTUDY_DATA_ROOT: dataRoot,
            ELECTRON_ENABLE_LOGGING: '1',
        },
    });
}

async function waitForMainBridge(page, timeoutMs = 30000) {
    const startedAt = Date.now();
    let lastStatus = null;

    while (Date.now() - startedAt < timeoutMs) {
        lastStatus = await page.evaluate(() => ({
            chatAPI: Boolean(window.chatAPI),
            electronAPI: Boolean(window.electronAPI),
            electronPath: Boolean(window.electronPath),
            loadSettings: typeof window.chatAPI?.loadSettings === 'function',
            getAgentConfig: typeof window.chatAPI?.getAgentConfig === 'function',
        })).catch((error) => ({
            chatAPI: false,
            electronAPI: false,
            electronPath: false,
            loadSettings: false,
            getAgentConfig: false,
            evaluationError: error?.message || String(error),
        }));

        if (lastStatus.chatAPI
            && lastStatus.electronAPI
            && lastStatus.electronPath
            && lastStatus.loadSettings
            && lastStatus.getAgentConfig) {
            return lastStatus;
        }

        await new Promise((resolve) => setTimeout(resolve, 250));
    }

    throw new Error(`Timed out waiting for main preload bridge: ${JSON.stringify(lastStatus)}`);
}

function collectDeprecatedFieldPresence(config) {
    if (!config || typeof config !== 'object') {
        return {};
    }

    return DEPRECATED_FIELDS.reduce((result, field) => {
        result[field] = Object.prototype.hasOwnProperty.call(config, field);
        return result;
    }, {});
}

async function run() {
    const repoRoot = path.resolve(__dirname, '..');
    const { tempRoot, targetTopic } = await prepareDataRoot(repoRoot);
    const summary = {
        repoRoot,
        tempRoot,
        targetTopic,
        rendererErrors: [],
        checks: {},
        success: false,
    };

    let app;
    try {
        app = await launchApp(repoRoot, tempRoot);
        const page = await app.firstWindow({ timeout: 30000 });

        page.on('pageerror', (error) => {
            summary.rendererErrors.push(String(error && error.stack ? error.stack : error));
        });
        page.on('console', (message) => {
            if (message.type() === 'error') {
                summary.rendererErrors.push(message.text());
            }
        });

        await page.waitForLoadState('domcontentloaded');
        await waitForMainBridge(page, 30000);
        await page.waitForFunction(
            (expectedTopicId) => {
                const topicId = document.body?.dataset?.currentTopicId;
                return topicId ? topicId === expectedTopicId : document.querySelectorAll('.message-item.assistant').length > 0;
            },
            targetTopic.topicId,
            { timeout: 30000 },
        );

        const uiState = await page.evaluate(({ removedInputIds }) => ({
            removedInputsPresent: removedInputIds.filter((id) => Boolean(document.getElementById(id))),
            assistantMessageCount: document.querySelectorAll('.message-item.assistant').length,
            scopedStyleCount: document.querySelectorAll('style[data-chat-scope-id]').length,
            scopedMessageCount: document.querySelectorAll('[data-chat-scope]').length,
        }), { removedInputIds: REMOVED_INPUT_IDS });
        summary.checks.ui = uiState;

        const apiState = await page.evaluate(async () => {
            const deprecatedFields = ['cardCss', 'chatCss', 'customCss'];
            const getPresence = (config) => deprecatedFields.reduce((result, field) => {
                result[field] = Object.prototype.hasOwnProperty.call(config || {}, field);
                return result;
            }, {});
            const settings = await window.chatAPI.loadSettings();
            const selectedAgentId = settings.lastOpenItemId;
            const config = await window.chatAPI.getAgentConfig(selectedAgentId);
            const agents = await window.chatAPI.getAgents();
            const selectedAgent = Array.isArray(agents)
                ? agents.find((agent) => agent.id === selectedAgentId)
                : null;

            return {
                selectedAgentId,
                getAgentConfigDeprecatedFields: getPresence(config),
                getAgentsDeprecatedFields: getPresence(selectedAgent?.config || {}),
            };
        });
        summary.checks.apiRead = apiState;

        const saveState = await page.evaluate(async ({ deprecatedFields }) => {
            const getPresence = (config) => Object.keys(deprecatedFields).reduce((result, field) => {
                result[field] = Object.prototype.hasOwnProperty.call(config || {}, field);
                return result;
            }, {});
            const settings = await window.chatAPI.loadSettings();
            const agentId = settings.lastOpenItemId;
            const currentConfig = await window.chatAPI.getAgentConfig(agentId);
            const saveResult = await window.chatAPI.saveAgentConfig(agentId, {
                ...currentConfig,
                ...deprecatedFields,
            });
            const afterConfig = await window.chatAPI.getAgentConfig(agentId);
            const agents = await window.chatAPI.getAgents();
            const selectedAgent = Array.isArray(agents)
                ? agents.find((agent) => agent.id === agentId)
                : null;

            return {
                agentId,
                saveResult,
                afterGetAgentConfigDeprecatedFields: getPresence(afterConfig),
                afterGetAgentsDeprecatedFields: getPresence(selectedAgent?.config || {}),
            };
        }, {
            deprecatedFields: {
                cardCss: '.message-item { border: 10px solid red; }',
                chatCss: 'h1, body { display: none; }',
                customCss: '* { opacity: 0.25; }',
            },
        });
        summary.checks.apiWrite = saveState;

        const diskConfigPath = path.join(tempRoot, 'Agents', saveState.agentId, 'config.json');
        const diskConfig = await readJsonIfExists(diskConfigPath);
        summary.checks.disk = {
            configPath: diskConfigPath,
            deprecatedFields: collectDeprecatedFieldPresence(diskConfig || {}),
        };

        const noRemovedInputs = uiState.removedInputsPresent.length === 0;
        const hasAssistantMessages = uiState.assistantMessageCount > 0;
        const noScopedChatArtifacts = uiState.scopedStyleCount === 0 && uiState.scopedMessageCount === 0;
        const noDeprecatedFieldsInReads = Object.values(apiState.getAgentConfigDeprecatedFields).every((present) => present === false)
            && Object.values(apiState.getAgentsDeprecatedFields).every((present) => present === false);
        const noDeprecatedFieldsAfterWrite = Object.values(saveState.afterGetAgentConfigDeprecatedFields).every((present) => present === false)
            && Object.values(saveState.afterGetAgentsDeprecatedFields).every((present) => present === false)
            && Object.values(summary.checks.disk.deprecatedFields).every((present) => present === false);
        const saveSucceeded = saveState.saveResult && saveState.saveResult.success === true;

        summary.success = Boolean(
            noRemovedInputs
            && hasAssistantMessages
            && noScopedChatArtifacts
            && noDeprecatedFieldsInReads
            && noDeprecatedFieldsAfterWrite
            && saveSucceeded
            && summary.rendererErrors.length === 0
        );
    } finally {
        if (app) {
            await app.close();
        }
        if (summary.success) {
            await fs.remove(tempRoot);
        }
    }

    return summary;
}

if (require.main === module) {
    run()
        .then((summary) => {
            console.log(JSON.stringify(summary, null, 2));
            if (!summary.success) {
                process.exitCode = 1;
            }
        })
        .catch((error) => {
            console.error(error && error.stack ? error.stack : error);
            process.exitCode = 1;
        });
}
