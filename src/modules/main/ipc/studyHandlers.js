const { ipcMain } = require('electron');
const { createStudyServices } = require('../study');

let registered = false;
let studyServices = null;

function initialize(context = {}) {
    if (registered) {
        return;
    }

    studyServices = createStudyServices({
        dataRoot: context.DATA_ROOT,
        settingsManager: context.settingsManager,
        vcpClient: context.vcpClient,
    });

    ipcMain.handle('list-study-log-days', async (_event, payload = {}) => {
        try {
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
