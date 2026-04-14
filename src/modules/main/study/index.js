const { createStudyLogStore } = require('./studyLogStore');
const { createStudyDiaryProjector } = require('./studyDiaryProjector');
const { createStudyMemoryService } = require('./studyMemoryService');
const { createStudyToolRuntime } = require('./studyToolRuntime');
const { createChatOrchestrator } = require('./chatOrchestrator');

function createStudyServices(options = {}) {
    const studyLogStore = createStudyLogStore(options);
    const diaryProjector = createStudyDiaryProjector({
        ...options,
        studyLogStore,
    });
    const studyMemoryService = createStudyMemoryService({
        ...options,
        studyLogStore,
        diaryProjector,
    });
    const studyToolRuntime = createStudyToolRuntime({
        ...options,
        studyLogStore,
        diaryProjector,
    });
    const chatOrchestrator = createChatOrchestrator({
        ...options,
        studyLogStore,
        diaryProjector,
        studyMemoryService,
        studyToolRuntime,
    });

    return {
        chatOrchestrator,
        diaryProjector,
        studyLogStore,
        studyMemoryService,
        studyToolRuntime,
    };
}

module.exports = {
    createStudyServices,
};
