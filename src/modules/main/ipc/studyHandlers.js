const { ipcMain } = require('electron');
const fs = require('fs-extra');
const path = require('path');
const { createStudyServices } = require('../study');

let registered = false;
let studyServices = null;
let agentDir = '';
let orphanCleanupPromise = null;

async function listExistingAgentIds() {
    if (!agentDir || !await fs.pathExists(agentDir)) {
        return null;
    }

    const entries = await fs.readdir(agentDir).catch(() => []);
    const agentIds = [];
    for (const entry of entries) {
        const fullPath = path.join(agentDir, entry);
        const stat = await fs.stat(fullPath).catch(() => null);
        if (stat?.isDirectory()) {
            agentIds.push(entry);
        }
    }
    return agentIds;
}

async function cleanupOrphanStudyData() {
    if (!studyServices?.diaryProjector?.cleanupMissingAgents) {
        return null;
    }
    if (orphanCleanupPromise) {
        return orphanCleanupPromise;
    }

    orphanCleanupPromise = (async () => {
        const agentIds = await listExistingAgentIds();
        if (!Array.isArray(agentIds)) {
            return null;
        }
        return studyServices.diaryProjector.cleanupMissingAgents(agentIds);
    })();

    return orphanCleanupPromise;
}

function initialize(context = {}) {
    if (registered) {
        return;
    }

    studyServices = createStudyServices({
        dataRoot: context.DATA_ROOT,
        settingsManager: context.settingsManager,
        chatClient: context.chatClient,
    });
    agentDir = context.AGENT_DIR || '';

    ipcMain.handle('list-study-log-days', async (_event, payload = {}) => {
        try {
            await cleanupOrphanStudyData();
            const scope = payload.scope === 'agent'
                ? 'agent'
                : payload.scope === 'global'
                    ? 'global'
                    : 'topic';
            const topicId = scope === 'topic' ? payload.topicId : '';
            const items = await studyServices.diaryProjector.listDiaryDays({
                agentId: payload.agentId,
                topicId,
                query: payload.query,
                limit: payload.limit,
                dateKey: payload.dateKey,
                notebookId: payload.notebookId,
                notebookName: payload.notebookName,
                tag: payload.tag,
            });
            return { success: true, items };
        } catch (error) {
            return { success: false, error: error.message, items: [] };
        }
    });

    ipcMain.handle('list-study-log-entries', async (_event, payload = {}) => {
        try {
            await cleanupOrphanStudyData();
            const scope = payload.scope === 'agent'
                ? 'agent'
                : payload.scope === 'global'
                    ? 'global'
                    : 'topic';
            const topicId = scope === 'topic' ? payload.topicId : '';
            const items = await studyServices.studyLogStore.listEntries({
                agentId: payload.agentId,
                topicId,
                dateKey: payload.dateKey,
                query: payload.query,
                limit: payload.limit,
                notebookId: payload.notebookId,
                notebookName: payload.notebookName,
                tag: payload.tag,
            });
            return { success: true, items };
        } catch (error) {
            return { success: false, error: error.message, items: [] };
        }
    });

    ipcMain.handle('get-study-log-entry', async (_event, payload = {}) => {
        try {
            const item = await studyServices.studyLogStore.getEntry(payload);
            return { success: true, item };
        } catch (error) {
            return { success: false, error: error.message, item: null };
        }
    });

    ipcMain.handle('get-study-diary-day', async (_event, payload = {}) => {
        try {
            const item = await studyServices.diaryProjector.getDiaryDay(payload);
            return { success: true, item };
        } catch (error) {
            return { success: false, error: error.message, item: null };
        }
    });

    ipcMain.handle('list-study-diary-wall-cards', async (_event, payload = {}) => {
        try {
            await cleanupOrphanStudyData();
            const items = await studyServices.diaryProjector.listDiaryWallCards(payload);
            return { success: true, items };
        } catch (error) {
            return { success: false, error: error.message, items: [] };
        }
    });

    ipcMain.handle('get-study-diary-wall-detail', async (_event, payload = {}) => {
        try {
            const item = await studyServices.diaryProjector.getDiaryWallDetail(payload);
            return { success: true, item };
        } catch (error) {
            return { success: false, error: error.message, item: null };
        }
    });

    ipcMain.handle('update-study-log-entry', async (_event, payload = {}) => {
        try {
            const item = await studyServices.diaryProjector.updateDiaryEntry({
                agentId: payload.agentId,
                topicId: payload.topicId,
                entryId: payload.entryId,
                updates: payload.updates || {},
            });
            return { success: Boolean(item), item, error: item ? '' : '未找到要编辑的日记条目' };
        } catch (error) {
            return { success: false, error: error.message, item: null };
        }
    });

    ipcMain.handle('delete-study-log-entry', async (_event, payload = {}) => {
        try {
            const item = await studyServices.diaryProjector.deleteDiaryEntry({
                agentId: payload.agentId,
                topicId: payload.topicId,
                entryId: payload.entryId,
            });
            return { success: Boolean(item), item, error: item ? '' : '未找到要删除的日记条目' };
        } catch (error) {
            return { success: false, error: error.message, item: null };
        }
    });

    ipcMain.handle('delete-study-diary-wall-card', async (_event, payload = {}) => {
        try {
            const result = await studyServices.diaryProjector.deleteDiaryWallCard(payload);
            return { success: true, ...result };
        } catch (error) {
            return { success: false, error: error.message, deletedCount: 0, removed: [], rebuilt: [] };
        }
    });

    ipcMain.handle('search-study-memory', async (_event, payload = {}) => {
        try {
            const result = await studyServices.studyMemoryService.searchStudyMemory(payload);
            return { success: true, ...result };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                refs: [],
                contextText: '',
                itemCount: 0,
            };
        }
    });

    registered = true;
}

module.exports = {
    initialize,
};
