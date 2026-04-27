const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs-extra');
const Module = require('module');
const os = require('os');
const path = require('path');

const AgentConfigManager = require('../src/modules/main/utils/agentConfigManager');
const { createStudyLogStore } = require('../src/modules/main/study/studyLogStore');
const { createStudyDiaryProjector } = require('../src/modules/main/study/studyDiaryProjector');

const AGENT_HANDLERS_PATH = path.resolve(__dirname, '../src/modules/main/ipc/agentHandlers.js');

function loadAgentHandlers({ invokeImpl } = {}) {
    const handlers = new Map();
    const electronStub = {
        ipcMain: {
            handle(channel, handler) {
                handlers.set(channel, handler);
            },
            invoke: invokeImpl || (() => {
                throw new Error('ipcMain.invoke should not be used by agent handlers');
            }),
        },
    };
    const originalLoad = Module._load;

    try {
        delete require.cache[require.resolve(AGENT_HANDLERS_PATH)];
        Module._load = function patchedLoad(request, parent, isMain) {
            if (request === 'electron') {
                return electronStub;
            }
            return originalLoad.call(this, request, parent, isMain);
        };

        const agentHandlers = require(AGENT_HANDLERS_PATH);
        return { agentHandlers, handlers };
    } finally {
        Module._load = originalLoad;
    }
}

async function createAgent(agentDir, agentId, config, { avatarExt, invalidConfig = false } = {}) {
    const dir = path.join(agentDir, agentId);
    await fs.ensureDir(dir);

    if (invalidConfig) {
        await fs.writeFile(path.join(dir, 'config.json'), '{"broken": ', 'utf8');
    } else if (config) {
        await fs.writeJson(path.join(dir, 'config.json'), config, { spaces: 2 });
    }

    if (avatarExt) {
        await fs.writeFile(path.join(dir, `avatar${avatarExt}`), 'avatar');
    }
}

async function createHarness({
    agentDefinitions = [],
    initialSettings = {},
    useAgentConfigManager = true,
    invokeImpl,
} = {}) {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-agent-handlers-'));
    const agentDir = path.join(tempRoot, 'agents');
    const userDataDir = path.join(tempRoot, 'user-data');

    await fs.ensureDir(agentDir);
    await fs.ensureDir(userDataDir);

    for (const definition of agentDefinitions) {
        await createAgent(agentDir, definition.id, definition.config, definition.options);
    }

    const settingsState = { ...initialSettings };
    const settingsManager = {
        async readSettings() {
            return { ...settingsState };
        },
        async updateSettings(updater) {
            const nextSettings = await updater({ ...settingsState });
            Object.keys(settingsState).forEach((key) => {
                delete settingsState[key];
            });
            Object.assign(settingsState, nextSettings);
            return { success: true };
        },
    };

    const agentConfigManager = useAgentConfigManager ? new AgentConfigManager(agentDir) : null;
    const { agentHandlers, handlers } = loadAgentHandlers({ invokeImpl });

    agentHandlers.initialize({
        AGENT_DIR: agentDir,
        USER_DATA_DIR: userDataDir,
        DATA_ROOT: tempRoot,
        AVATAR_IMAGE_DIR: null,
        SETTINGS_FILE: path.join(tempRoot, 'settings.json'),
        USER_AVATAR_FILE: path.join(tempRoot, 'user-avatar.png'),
        settingsManager,
        agentConfigManager,
        getSelectionListenerStatus: () => false,
        stopSelectionListener: () => false,
        startSelectionListener: () => false,
    });

    return {
        agentDir,
        handlers,
        settingsState,
        tempRoot,
        cleanup: () => fs.remove(tempRoot),
    };
}

test('get-agents-metadata reuses helpers instead of ipcMain.invoke', async (t) => {
    const harness = await createHarness({
        initialSettings: { agentOrder: ['agent-b', 'agent-a'] },
        agentDefinitions: [
            {
                id: 'agent-a',
                config: {
                    name: 'Alpha',
                    avatarCalculatedColor: '#111111',
                    topics: [{ id: 'default', name: '主要对话', createdAt: 1 }],
                },
                options: { avatarExt: '.png' },
            },
            {
                id: 'agent-b',
                config: {
                    name: 'Beta',
                    avatarCalculatedColor: '#222222',
                    topics: [{ id: 'default', name: '主要对话', createdAt: 2 }],
                },
                options: { avatarExt: '.jpg' },
            },
        ],
    });
    t.after(harness.cleanup);

    const getAgentsMetadata = harness.handlers.get('get-agents-metadata');
    const result = await getAgentsMetadata();

    assert.deepEqual(result, [
        {
            id: 'agent-b',
            name: 'Beta',
            avatarUrl: `file://${path.join(harness.agentDir, 'agent-b', 'avatar.jpg')}`,
            avatarCalculatedColor: '#222222',
        },
        {
            id: 'agent-a',
            name: 'Alpha',
            avatarUrl: `file://${path.join(harness.agentDir, 'agent-a', 'avatar.png')}`,
            avatarCalculatedColor: '#111111',
        },
    ]);
});

test('save-agent-order invalidates metadata cache and reflects new order', async (t) => {
    const harness = await createHarness({
        initialSettings: { agentOrder: ['agent-a', 'agent-b'] },
        agentDefinitions: [
            {
                id: 'agent-a',
                config: {
                    name: 'Alpha',
                    avatarCalculatedColor: '#111111',
                    topics: [{ id: 'default', name: '主要对话', createdAt: 1 }],
                },
            },
            {
                id: 'agent-b',
                config: {
                    name: 'Beta',
                    avatarCalculatedColor: '#222222',
                    topics: [{ id: 'default', name: '主要对话', createdAt: 2 }],
                },
            },
        ],
    });
    t.after(harness.cleanup);

    const getAgentsMetadata = harness.handlers.get('get-agents-metadata');
    const saveAgentOrder = harness.handlers.get('save-agent-order');

    const firstResult = await getAgentsMetadata();
    assert.deepEqual(firstResult.map((agent) => agent.id), ['agent-a', 'agent-b']);

    const saveResult = await saveAgentOrder(null, ['agent-b', 'agent-a']);
    assert.deepEqual(saveResult, { success: true });
    assert.deepEqual(harness.settingsState.agentOrder, ['agent-b', 'agent-a']);

    const secondResult = await getAgentsMetadata();
    assert.deepEqual(secondResult.map((agent) => agent.id), ['agent-b', 'agent-a']);
});

test('get-agents-metadata skips corrupted agents with the same tolerance as get-agents', async (t) => {
    const harness = await createHarness({
        useAgentConfigManager: false,
        agentDefinitions: [
            {
                id: 'agent-valid',
                config: {
                    name: 'Valid Agent',
                    avatarCalculatedColor: '#00aa00',
                    topics: [{ id: 'default', name: '主要对话', createdAt: 1 }],
                },
            },
            {
                id: 'agent-broken',
                options: { invalidConfig: true },
            },
        ],
    });
    t.after(harness.cleanup);

    const getAgents = harness.handlers.get('get-agents');
    const getAgentsMetadata = harness.handlers.get('get-agents-metadata');

    const agents = await getAgents();
    const metadata = await getAgentsMetadata();

    assert.deepEqual(agents.map((agent) => agent.id), ['agent-valid']);
    assert.deepEqual(metadata, [
        {
            id: 'agent-valid',
            name: 'Valid Agent',
            avatarUrl: null,
            avatarCalculatedColor: '#00aa00',
        },
    ]);
});

test('delete-agent clears matching study logs and diary wall projections', async (t) => {
    const harness = await createHarness({
        agentDefinitions: [
            {
                id: 'agent_math',
                config: {
                    name: '数学',
                    topics: [{ id: 'topic_algebra', name: '代数', createdAt: 1 }],
                },
            },
            {
                id: 'agent_physics',
                config: {
                    name: '物理',
                    topics: [{ id: 'topic_force', name: '力学', createdAt: 1 }],
                },
            },
        ],
    });
    t.after(harness.cleanup);

    const store = createStudyLogStore({ dataRoot: harness.tempRoot });
    const projector = createStudyDiaryProjector({ dataRoot: harness.tempRoot, studyLogStore: store });
    const privateEntry = await store.writeEntry({
        agentId: 'agent_math',
        topicId: 'topic_algebra',
        dateKey: '2026-04-23',
        notebookId: 'math',
        notebookName: '数学',
        contentMarkdown: '数学私有日记。',
        tags: ['代数'],
    });
    const sharedMathEntry = await store.writeEntry({
        agentId: 'agent_math',
        topicId: 'topic_algebra',
        dateKey: '2026-04-24',
        notebookId: 'public',
        notebookName: '公共',
        contentMarkdown: '数学共享日记。',
        tags: ['共享'],
    });
    const sharedPhysicsEntry = await store.writeEntry({
        agentId: 'agent_physics',
        topicId: 'topic_force',
        dateKey: '2026-04-24',
        notebookId: 'public',
        notebookName: '公共',
        contentMarkdown: '物理共享日记。',
        tags: ['共享'],
    });
    await projector.projectEntry(privateEntry);
    await projector.projectEntry(sharedMathEntry);
    await projector.projectEntry(sharedPhysicsEntry);

    const deleteAgent = harness.handlers.get('delete-agent');
    const result = await deleteAgent(null, 'agent_math');

    assert.equal(result.success, true);
    assert.equal(result.studyCleanup.deletedCount, 2);
    assert.equal(await fs.pathExists(path.join(harness.tempRoot, 'StudyLogs', 'agent_math')), false);
    assert.equal(await fs.pathExists(path.join(harness.tempRoot, 'StudyDiary', 'math', '2026-04-23.json')), false);

    const sharedDiary = await projector.getDiaryDay({
        notebookId: 'public',
        dateKey: '2026-04-24',
    });
    assert.equal(sharedDiary.entryCount, 1);
    assert.deepEqual(sharedDiary.agentIds, ['agent_physics']);
    assert.match(sharedDiary.contentMarkdown, /物理共享日记/);
    assert.doesNotMatch(sharedDiary.contentMarkdown, /数学共享日记/);
});
