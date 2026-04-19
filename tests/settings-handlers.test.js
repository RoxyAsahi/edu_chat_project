const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const Module = require('module');

const SettingsManager = require('../src/modules/main/utils/appSettingsManager');
const {
    DEFAULT_SETTINGS,
} = require('../src/modules/main/utils/settingsSchema');

const SETTINGS_HANDLERS_PATH = path.resolve(__dirname, '../src/modules/main/ipc/settingsHandlers.js');

function loadSettingsHandlers() {
    const handleHandlers = new Map();
    const electronStub = {
        ipcMain: {
            handle(channel, handler) {
                handleHandlers.set(channel, handler);
            },
        },
    };
    const originalLoad = Module._load;

    try {
        delete require.cache[require.resolve(SETTINGS_HANDLERS_PATH)];
        Module._load = function patchedLoad(request, parent, isMain) {
            if (request === 'electron') {
                return electronStub;
            }
            return originalLoad.call(this, request, parent, isMain);
        };

        const settingsHandlers = require(SETTINGS_HANDLERS_PATH);
        return { settingsHandlers, handleHandlers };
    } finally {
        Module._load = originalLoad;
    }
}

test('save-settings reports raw persistence checks for agent bubble theme fields', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-settings-handlers-'));
    const settingsPath = path.join(tempRoot, 'settings.json');
    const manager = new SettingsManager(settingsPath);
    t.after(() => fs.remove(tempRoot));

    await manager.writeSettings(DEFAULT_SETTINGS);

    const { settingsHandlers, handleHandlers } = loadSettingsHandlers();
    settingsHandlers.initialize({
        SETTINGS_FILE: settingsPath,
        USER_AVATAR_FILE: path.join(tempRoot, 'user_avatar.png'),
        AGENT_DIR: path.join(tempRoot, 'Agents'),
        settingsManager: manager,
        agentConfigManager: null,
    });

    const saveSettings = handleHandlers.get('save-settings');
    const result = await saveSettings({}, {
        enableAgentBubbleTheme: true,
        agentBubbleThemePrompt: 'Custom prompt {{VarDivRender}}',
    });

    const rawSettings = await fs.readJson(settingsPath);
    assert.equal(result.success, true);
    assert.equal(rawSettings.enableAgentBubbleTheme, true);
    assert.equal(rawSettings.agentBubbleThemePrompt, 'Custom prompt {{VarDivRender}}');
    assert.equal(result.persistenceCheck.rawHasAgentBubbleThemePromptField, true);
    assert.equal(result.persistenceCheck.agentBubbleThemePromptMatched, true);
    assert.equal(result.persistenceCheck.enableAgentBubbleThemeMatched, true);
});

test('save-settings verifies follow-up prompt template persistence', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-settings-handlers-'));
    const settingsPath = path.join(tempRoot, 'settings.json');
    const manager = new SettingsManager(settingsPath);
    t.after(() => fs.remove(tempRoot));

    await manager.writeSettings(DEFAULT_SETTINGS);

    const { settingsHandlers, handleHandlers } = loadSettingsHandlers();
    settingsHandlers.initialize({
        SETTINGS_FILE: settingsPath,
        USER_AVATAR_FILE: path.join(tempRoot, 'user_avatar.png'),
        AGENT_DIR: path.join(tempRoot, 'Agents'),
        settingsManager: manager,
        agentConfigManager: null,
    });

    const saveSettings = handleHandlers.get('save-settings');
    const result = await saveSettings({}, {
        followUpPromptTemplate: 'Follow up with {{CHAT_HISTORY}}',
    });

    const rawSettings = await fs.readJson(settingsPath);
    assert.equal(result.success, true);
    assert.equal(rawSettings.followUpPromptTemplate, 'Follow up with {{CHAT_HISTORY}}');
    assert.equal(result.persistenceCheck.fieldChecks.followUpPromptTemplate.matched, true);
    assert.deepEqual(result.persistenceCheck.mismatchedFields, []);
});

test('save-settings verifies emoticon prompt fields persist correctly', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-settings-handlers-'));
    const settingsPath = path.join(tempRoot, 'settings.json');
    const manager = new SettingsManager(settingsPath);
    t.after(() => fs.remove(tempRoot));

    await manager.writeSettings(DEFAULT_SETTINGS);

    const { settingsHandlers, handleHandlers } = loadSettingsHandlers();
    settingsHandlers.initialize({
        SETTINGS_FILE: settingsPath,
        USER_AVATAR_FILE: path.join(tempRoot, 'user_avatar.png'),
        AGENT_DIR: path.join(tempRoot, 'Agents'),
        settingsManager: manager,
        agentConfigManager: null,
    });

    const saveSettings = handleHandlers.get('save-settings');
    const result = await saveSettings({}, {
        enableEmoticonPrompt: false,
        emoticonPrompt: 'Use {{GeneralEmoticonPath}}',
    });

    const rawSettings = await fs.readJson(settingsPath);
    assert.equal(result.success, true);
    assert.equal(rawSettings.enableEmoticonPrompt, false);
    assert.equal(rawSettings.emoticonPrompt, 'Use {{GeneralEmoticonPath}}');
    assert.equal(result.persistenceCheck.fieldChecks.enableEmoticonPrompt.matched, true);
    assert.equal(result.persistenceCheck.fieldChecks.emoticonPrompt.matched, true);
});

test('save-settings verifies dedicated task model fields persist correctly', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-settings-handlers-'));
    const settingsPath = path.join(tempRoot, 'settings.json');
    const manager = new SettingsManager(settingsPath);
    t.after(() => fs.remove(tempRoot));

    await manager.writeSettings(DEFAULT_SETTINGS);

    const { settingsHandlers, handleHandlers } = loadSettingsHandlers();
    settingsHandlers.initialize({
        SETTINGS_FILE: settingsPath,
        USER_AVATAR_FILE: path.join(tempRoot, 'user_avatar.png'),
        AGENT_DIR: path.join(tempRoot, 'Agents'),
        settingsManager: manager,
        agentConfigManager: null,
    });

    const saveSettings = handleHandlers.get('save-settings');
    const result = await saveSettings({}, {
        followUpDefaultModel: 'follow-up-model',
        topicTitleDefaultModel: 'topic-title-model',
    });

    const rawSettings = await fs.readJson(settingsPath);
    assert.equal(result.success, true);
    assert.equal(rawSettings.followUpDefaultModel, 'follow-up-model');
    assert.equal(rawSettings.topicTitleDefaultModel, 'topic-title-model');
    assert.equal(result.persistenceCheck.fieldChecks.followUpDefaultModel.matched, true);
    assert.equal(result.persistenceCheck.fieldChecks.topicTitleDefaultModel.matched, true);
    assert.deepEqual(result.persistenceCheck.mismatchedFields, []);
});

test('save-settings verifies topic title generation fields persist correctly', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-settings-handlers-'));
    const settingsPath = path.join(tempRoot, 'settings.json');
    const manager = new SettingsManager(settingsPath);
    t.after(() => fs.remove(tempRoot));

    await manager.writeSettings(DEFAULT_SETTINGS);

    const { settingsHandlers, handleHandlers } = loadSettingsHandlers();
    settingsHandlers.initialize({
        SETTINGS_FILE: settingsPath,
        USER_AVATAR_FILE: path.join(tempRoot, 'user_avatar.png'),
        AGENT_DIR: path.join(tempRoot, 'Agents'),
        settingsManager: manager,
        agentConfigManager: null,
    });

    const saveSettings = handleHandlers.get('save-settings');
    const result = await saveSettings({}, {
        enableTopicTitleGeneration: false,
        topicTitlePromptTemplate: 'Title with {{CHAT_HISTORY}}',
    });

    const rawSettings = await fs.readJson(settingsPath);
    assert.equal(result.success, true);
    assert.equal(rawSettings.enableTopicTitleGeneration, false);
    assert.equal(rawSettings.topicTitlePromptTemplate, 'Title with {{CHAT_HISTORY}}');
    assert.equal(result.persistenceCheck.fieldChecks.enableTopicTitleGeneration.matched, true);
    assert.equal(result.persistenceCheck.fieldChecks.topicTitlePromptTemplate.matched, true);
});

test('preview-agent-bubble-theme-prompt resolves the effective injected text', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-settings-handlers-'));
    const settingsPath = path.join(tempRoot, 'settings.json');
    const manager = new SettingsManager(settingsPath);
    t.after(() => fs.remove(tempRoot));

    await manager.writeSettings({
        ...DEFAULT_SETTINGS,
        userName: 'PersistedUser',
    });

    const { settingsHandlers, handleHandlers } = loadSettingsHandlers();
    settingsHandlers.initialize({
        SETTINGS_FILE: settingsPath,
        USER_AVATAR_FILE: path.join(tempRoot, 'user_avatar.png'),
        AGENT_DIR: path.join(tempRoot, 'Agents'),
        settingsManager: manager,
        agentConfigManager: null,
    });

    const previewPrompt = handleHandlers.get('preview-agent-bubble-theme-prompt');
    const preview = await previewPrompt({}, {
        enabled: true,
        prompt: 'Hello {{UserName}} :: {{VarDivRender}}',
        settings: {
            userName: 'PreviewUser',
        },
    });

    assert.equal(preview.enabled, true);
    assert.equal(preview.willInject, true);
    assert.match(preview.resolvedPrompt, /Hello PreviewUser ::/);
    assert.equal(preview.resolvedPrompt.includes('{{VarDivRender}}'), false);
    assert.deepEqual(preview.unresolvedTokens, []);
});

test('preview-final-system-prompt reports segment states and final prompt', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-settings-handlers-'));
    const settingsPath = path.join(tempRoot, 'settings.json');
    const projectRoot = path.join(tempRoot, 'project-root');
    const bundledPackDir = path.join(projectRoot, '通用表情包');
    const manager = new SettingsManager(settingsPath);
    t.after(() => fs.remove(tempRoot));

    await fs.ensureDir(bundledPackDir);
    await fs.writeFile(path.join(bundledPackDir, '阿巴阿巴.jpg'), Buffer.from([255, 216, 255]));
    await fs.writeFile(path.join(bundledPackDir, '啊？.png'), Buffer.from([137, 80, 78, 71]));

    await manager.writeSettings({
        ...DEFAULT_SETTINGS,
        userName: 'PersistedUser',
        enableRenderingPrompt: true,
        enableEmoticonPrompt: true,
        enableAdaptiveBubbleTip: true,
        studyLogPolicy: {
            ...DEFAULT_SETTINGS.studyLogPolicy,
            enabled: true,
            enableDailyNotePromptVariables: true,
            autoInjectDailyNoteProtocol: true,
        },
    });

    const { settingsHandlers, handleHandlers } = loadSettingsHandlers();
    settingsHandlers.initialize({
        SETTINGS_FILE: settingsPath,
        USER_AVATAR_FILE: path.join(tempRoot, 'user_avatar.png'),
        AGENT_DIR: path.join(tempRoot, 'Agents'),
        PROJECT_ROOT: projectRoot,
        settingsManager: manager,
        agentConfigManager: null,
    });

    const previewPrompt = handleHandlers.get('preview-final-system-prompt');
    const result = await previewPrompt({}, {
        systemPrompt: 'Hello {{UserName}}\n{{VarDivRender}}\n{{VarEmoticonPrompt}}\n{{DailyNoteTool}}',
        settings: {
            userName: 'PreviewUser',
            emoticonPrompt: 'Path {{GeneralEmoticonPath}}\nList {{GeneralEmoticonList}}',
            enableAgentBubbleTheme: true,
            agentBubbleThemePrompt: 'Bubble {{VarDivRender}}',
        },
        context: {
            agentName: 'Nova',
            topicName: '二次函数',
        },
    });

    assert.equal(result.success, true);
    assert.match(result.preview.finalSystemPrompt, /Hello PreviewUser/);
    assert.equal(result.preview.segments.rendering.enabled, true);
    assert.equal(result.preview.segments.emoticonPrompt.enabled, true);
    assert.equal(result.preview.segments.emoticonPrompt.available, true);
    assert.equal(result.preview.segments.emoticonPrompt.appended, false);
    assert.equal(result.preview.segments.emoticonPrompt.skippedBecausePromptAlreadyContainsVariable, true);
    assert.match(result.preview.finalSystemPrompt, /Path \/通用表情包/);
    assert.equal(result.preview.segments.dailyNoteVariable.enabled, true);
    assert.equal(result.preview.segments.bubbleTheme.appended, true);
});

test('preview-final-system-prompt auto-appends the emoticon segment when the base prompt does not reference emoticon variables', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-settings-handlers-'));
    const settingsPath = path.join(tempRoot, 'settings.json');
    const projectRoot = path.join(tempRoot, 'project-root');
    const bundledPackDir = path.join(projectRoot, '通用表情包');
    const manager = new SettingsManager(settingsPath);
    t.after(() => fs.remove(tempRoot));

    await fs.ensureDir(bundledPackDir);
    await fs.writeFile(path.join(bundledPackDir, '阿巴阿巴.jpg'), Buffer.from([255, 216, 255]));

    await manager.writeSettings({
        ...DEFAULT_SETTINGS,
        userName: 'PersistedUser',
        enableEmoticonPrompt: true,
    });

    const { settingsHandlers, handleHandlers } = loadSettingsHandlers();
    settingsHandlers.initialize({
        SETTINGS_FILE: settingsPath,
        USER_AVATAR_FILE: path.join(tempRoot, 'user_avatar.png'),
        AGENT_DIR: path.join(tempRoot, 'Agents'),
        PROJECT_ROOT: projectRoot,
        settingsManager: manager,
        agentConfigManager: null,
    });

    const previewPrompt = handleHandlers.get('preview-final-system-prompt');
    const result = await previewPrompt({}, {
        systemPrompt: 'Hello {{UserName}}',
        settings: {
            userName: 'PreviewUser',
            emoticonPrompt: 'Auto {{GeneralEmoticonPath}}',
        },
        context: {
            agentName: 'Nova',
            topicName: '二次函数',
        },
    });

    assert.equal(result.success, true);
    assert.match(result.preview.finalSystemPrompt, /Hello PreviewUser/);
    assert.match(result.preview.finalSystemPrompt, /Auto \/通用表情包/);
    assert.equal(result.preview.segments.emoticonPrompt.appended, true);
    assert.equal(result.preview.segments.emoticonPrompt.skippedBecausePromptAlreadyContainsVariable, false);
});

test('save-settings persists study profile and study log policy fields', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-settings-handlers-'));
    const settingsPath = path.join(tempRoot, 'settings.json');
    const manager = new SettingsManager(settingsPath);
    t.after(() => fs.remove(tempRoot));

    await manager.writeSettings(DEFAULT_SETTINGS);

    const { settingsHandlers, handleHandlers } = loadSettingsHandlers();
    settingsHandlers.initialize({
        SETTINGS_FILE: settingsPath,
        USER_AVATAR_FILE: path.join(tempRoot, 'user_avatar.png'),
        AGENT_DIR: path.join(tempRoot, 'Agents'),
        settingsManager: manager,
        agentConfigManager: null,
    });

    const saveSettings = handleHandlers.get('save-settings');
    const result = await saveSettings({}, {
        studyProfile: {
            studentName: 'Alice',
            studyWorkspace: 'Dorm A-301',
            workEnvironment: 'Laptop',
            timezone: 'Asia/Hong_Kong',
        },
        promptVariables: {
            CourseName: '高数',
        },
        studyLogPolicy: {
            enabled: true,
            maxToolRounds: 5,
            memoryTopK: 6,
            memoryFallbackTopK: 3,
        },
    });

    const rawSettings = await fs.readJson(settingsPath);
    assert.equal(result.success, true);
    assert.equal(rawSettings.studyProfile.studentName, 'Alice');
    assert.equal(rawSettings.promptVariables.CourseName, '高数');
    assert.equal(rawSettings.studyLogPolicy.maxToolRounds, 5);
});

test('save-settings persists prompt injection toggles when explicitly disabled', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-settings-handlers-'));
    const settingsPath = path.join(tempRoot, 'settings.json');
    const manager = new SettingsManager(settingsPath);
    t.after(() => fs.remove(tempRoot));

    await manager.writeSettings(DEFAULT_SETTINGS);

    const { settingsHandlers, handleHandlers } = loadSettingsHandlers();
    settingsHandlers.initialize({
        SETTINGS_FILE: settingsPath,
        USER_AVATAR_FILE: path.join(tempRoot, 'user_avatar.png'),
        AGENT_DIR: path.join(tempRoot, 'Agents'),
        settingsManager: manager,
        agentConfigManager: null,
    });

    const saveSettings = handleHandlers.get('save-settings');
    const result = await saveSettings({}, {
        enableRenderingPrompt: false,
        enableEmoticonPrompt: false,
        enableAdaptiveBubbleTip: false,
        studyLogPolicy: {
            ...DEFAULT_SETTINGS.studyLogPolicy,
            enabled: true,
            enableDailyNotePromptVariables: false,
            autoInjectDailyNoteProtocol: false,
        },
    });

    const rawSettings = await fs.readJson(settingsPath);
    assert.equal(result.success, true);
    assert.equal(rawSettings.enableRenderingPrompt, false);
    assert.equal(rawSettings.enableEmoticonPrompt, false);
    assert.equal(rawSettings.enableAdaptiveBubbleTip, false);
    assert.equal(rawSettings.studyLogPolicy.enableDailyNotePromptVariables, false);
    assert.equal(rawSettings.studyLogPolicy.autoInjectDailyNoteProtocol, false);
    assert.equal(result.persistenceCheck.fieldChecks.enableRenderingPrompt.matched, true);
    assert.equal(result.persistenceCheck.fieldChecks.enableEmoticonPrompt.matched, true);
    assert.equal(result.persistenceCheck.fieldChecks.enableAdaptiveBubbleTip.matched, true);
    assert.equal(result.persistenceCheck.fieldChecks['studyLogPolicy.enableDailyNotePromptVariables'].matched, true);
    assert.equal(result.persistenceCheck.fieldChecks['studyLogPolicy.autoInjectDailyNoteProtocol'].matched, true);
    assert.equal(result.persistenceCheck.promptToggleFieldsMatched, true);
    assert.deepEqual(result.persistenceCheck.mismatchedFields, []);
});
