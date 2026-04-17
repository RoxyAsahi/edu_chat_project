const fs = require('fs-extra');
const path = require('path');
const {
    initializeDatabase,
    closeDatabase,
} = require('./db');
const { pickFirstNonEmptyString } = require('./helpers');
const { resolveExecutionConfig } = require('../utils/modelService');

function createInitialState() {
    return {
        initialized: false,
        dataRoot: null,
        filesRoot: null,
        settingsManager: null,
        agentConfigManager: null,
        agentDir: null,
        processing: false,
        queue: [],
        shuttingDown: false,
    };
}

function createKnowledgeBaseRuntime(deps = {}) {
    const fsImpl = deps.fs || fs;
    const pathImpl = deps.path || path;
    const initializeDatabaseImpl = deps.initializeDatabase || initializeDatabase;
    const closeDatabaseImpl = deps.closeDatabase || closeDatabase;

    let moduleState = createInitialState();
    const guideJobs = new Map();

    function getState() {
        return moduleState;
    }

    function getFilesRoot() {
        return moduleState.filesRoot;
    }

    function enqueueDocument(documentId) {
        if (!documentId || moduleState.queue.includes(documentId)) {
            return;
        }
        moduleState.queue.push(documentId);
    }

    function shiftQueuedDocument() {
        return moduleState.queue.shift() || null;
    }

    function hasQueuedDocuments() {
        return moduleState.queue.length > 0;
    }

    function shouldDrainQueue() {
        return moduleState.initialized && !moduleState.processing && !moduleState.shuttingDown;
    }

    function isShuttingDown() {
        return moduleState.shuttingDown;
    }

    function setProcessing(value) {
        moduleState.processing = value === true;
    }

    function hasGuideJob(documentId) {
        return guideJobs.has(documentId);
    }

    function setGuideJob(documentId, job) {
        guideJobs.set(documentId, job);
    }

    function deleteGuideJob(documentId) {
        guideJobs.delete(documentId);
    }

    function clearGuideJobs() {
        guideJobs.clear();
    }

    async function initialize(options = {}) {
        const dataRoot = options.dataRoot;
        if (!dataRoot) {
            throw new Error('Knowledge base dataRoot is required.');
        }

        if (moduleState.initialized) {
            if (moduleState.dataRoot === dataRoot) {
                return moduleState;
            }
            await shutdown();
        }

        const kbRoot = pathImpl.join(dataRoot, 'KnowledgeBase');
        const filesRoot = pathImpl.join(kbRoot, 'files');
        await fsImpl.ensureDir(filesRoot);
        await initializeDatabaseImpl(dataRoot);

        moduleState = {
            ...moduleState,
            initialized: true,
            dataRoot,
            filesRoot,
            settingsManager: options.settingsManager || null,
            agentConfigManager: options.agentConfigManager || null,
            agentDir: options.agentDir || null,
            processing: false,
            queue: [],
            shuttingDown: false,
        };

        return moduleState;
    }

    async function shutdown() {
        moduleState.shuttingDown = true;
        moduleState.queue = [];
        moduleState.processing = false;
        clearGuideJobs();
        await closeDatabaseImpl();
        moduleState = createInitialState();
    }

    async function readSettings() {
        if (!moduleState.settingsManager || typeof moduleState.settingsManager.readSettings !== 'function') {
            return {};
        }

        return moduleState.settingsManager.readSettings();
    }

    async function resolveGuideModel(settings = {}) {
        const modelServiceExecution = resolveExecutionConfig(settings, { purpose: 'chat' });
        if (modelServiceExecution?.model?.id) {
            return modelServiceExecution.model.id;
        }

        const directModel = pickFirstNonEmptyString(
            settings?.guideModel,
            settings?.defaultModel,
            settings?.lastModel,
        );
        if (directModel) {
            return directModel;
        }

        if (moduleState.agentConfigManager && moduleState.agentDir) {
            const candidateAgentIds = [];
            if (settings?.lastOpenItemType === 'agent' && settings?.lastOpenItemId) {
                candidateAgentIds.push(String(settings.lastOpenItemId));
            }

            const dirEntries = await fsImpl.readdir(moduleState.agentDir, { withFileTypes: true }).catch(() => []);
            for (const entry of dirEntries) {
                if (!entry.isDirectory()) {
                    continue;
                }
                if (!candidateAgentIds.includes(entry.name)) {
                    candidateAgentIds.push(entry.name);
                }
            }

            for (const agentId of candidateAgentIds) {
                const config = await moduleState.agentConfigManager.readAgentConfig(agentId, { allowDefault: true }).catch(() => null);
                const model = pickFirstNonEmptyString(config?.model);
                if (model) {
                    return model;
                }
            }
        }

        return 'gemini-3.1-flash-lite-preview';
    }

    return {
        getState,
        getFilesRoot,
        initialize,
        shutdown,
        enqueueDocument,
        shiftQueuedDocument,
        hasQueuedDocuments,
        shouldDrainQueue,
        isShuttingDown,
        setProcessing,
        hasGuideJob,
        setGuideJob,
        deleteGuideJob,
        clearGuideJobs,
        readSettings,
        resolveGuideModel,
    };
}

module.exports = {
    createInitialState,
    createKnowledgeBaseRuntime,
};
