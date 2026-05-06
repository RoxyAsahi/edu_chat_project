const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

const SettingsManager = require('../src/modules/main/utils/appSettingsManager');
const {
    DEFAULT_SETTINGS,
    validateSettings,
} = require('../src/modules/main/utils/settingsSchema');

test('validateSettings normalizes unknown keys, types, and bounds', () => {
    const { validated, hasIssues } = validateSettings({
        sidebarWidth: 9999,
        layoutLeftWidth: 'wide',
        networkNotesPaths: 'bad',
        combinedItemOrder: {},
        agentOrder: 'broken',
        userName: 'Alice',
        thinkingChatReasoningEffort: 'too-fast',
        rogueField: true,
    });

    assert.equal(hasIssues, true);
    assert.equal(validated.userName, 'Alice');
    assert.equal(validated.sidebarWidth, DEFAULT_SETTINGS.sidebarWidth);
    assert.equal(validated.layoutLeftWidth, DEFAULT_SETTINGS.layoutLeftWidth);
    assert.deepEqual(validated.networkNotesPaths, []);
    assert.deepEqual(validated.combinedItemOrder, []);
    assert.deepEqual(validated.agentOrder, []);
    assert.equal(validated.thinkingChatReasoningEffort, DEFAULT_SETTINGS.thinkingChatReasoningEffort);
    assert.equal('rogueField' in validated, false);
  });

test('validateSettings preserves direct settings fields when modelService is absent', () => {
    const { validated } = validateSettings({
        userName: 'Legacy Model User',
        chatEndpoint: 'https://chat.example.com/proxy/v1/chat/completions',
        chatApiKey: 'chat-key',
        defaultModel: 'gpt-4o',
        thinkingChatDefaultModel: 'gpt-4o-reasoning',
        thinkingChatReasoningEffort: 'medium',
        followUpDefaultModel: 'gpt-4.1-mini',
        studyToolDefaultModel: 'gpt-4.1-study',
        topicTitleDefaultModel: 'gpt-4.1-nano',
        kbBaseUrl: 'https://kb.example.com/openai/v1/embeddings',
        kbApiKey: 'kb-key',
        kbEmbeddingModel: 'bge-m3',
        kbRerankModel: 'bge-reranker-v2',
    });

    assert.equal(validated.modelService.providers.length, 0);
    assert.equal(validated.modelService.defaults.chat, null);
    assert.equal(validated.modelService.defaults.thinkingChat, null);
    assert.equal(validated.modelService.defaults.chatFallback, null);
    assert.equal(validated.modelService.defaults.followUp, null);
    assert.equal(validated.modelService.defaults.studyTool, null);
    assert.equal(validated.modelService.defaults.topicTitle, null);
    assert.equal(validated.modelService.defaults.sourceGuide, null);
    assert.equal(validated.modelService.defaults.imageTranscription, null);
    assert.equal(validated.modelService.defaults.embedding, null);
    assert.equal(validated.modelService.defaults.rerank, null);
    assert.equal(validated.chatEndpoint, 'https://chat.example.com/proxy/v1/chat/completions');
    assert.equal(validated.thinkingChatReasoningEffort, 'medium');
    assert.equal(validated.kbBaseUrl, 'https://kb.example.com/openai/v1/embeddings');
});

test('validateSettings mirrors explicit modelService back into native settings fields', () => {
    const { validated } = validateSettings({
        ...DEFAULT_SETTINGS,
        modelService: {
            version: 1,
            providers: [
                {
                    id: 'chat-provider',
                    presetId: 'custom-openai-compatible',
                    name: 'Chat Provider',
                    protocol: 'openai-compatible',
                    enabled: true,
                    apiBaseUrl: 'https://chat.example.com/proxy',
                    apiKeys: ['chat-key-1', 'chat-key-2'],
                    extraHeaders: {},
                    models: [
                        {
                            id: 'gpt-4o',
                            name: 'gpt-4o',
                            group: 'chat',
                            capabilities: { chat: true, embedding: false, rerank: false, vision: true, reasoning: true },
                            enabled: true,
                            source: 'manual',
                        },
                {
                    id: 'gpt-4o-reasoning',
                    name: 'gpt-4o-reasoning',
                    group: 'chat',
                    capabilities: { chat: true, embedding: false, rerank: false, vision: true, reasoning: true },
                    enabled: true,
                    source: 'manual',
                },
                {
                    id: 'gpt-4.1-mini',
                            name: 'gpt-4.1-mini',
                            group: 'chat',
                            capabilities: { chat: true, embedding: false, rerank: false, vision: false, reasoning: true },
                            enabled: true,
                            source: 'manual',
                        },
                        {
                            id: 'gpt-4.1-nano',
                            name: 'gpt-4.1-nano',
                            group: 'chat',
                            capabilities: { chat: true, embedding: false, rerank: false, vision: false, reasoning: false },
                            enabled: true,
                            source: 'manual',
                        },
                    ],
                },
                {
                    id: 'kb-provider',
                    presetId: 'custom-openai-compatible',
                    name: 'Knowledge Base Provider',
                    protocol: 'openai-compatible',
                    enabled: true,
                    apiBaseUrl: 'https://kb.example.com/openai',
                    apiKeys: ['kb-key-1'],
                    extraHeaders: {},
                    models: [
                        {
                            id: 'bge-m3',
                            name: 'bge-m3',
                            group: 'embedding',
                            capabilities: { chat: false, embedding: true, rerank: false, vision: false, reasoning: false },
                            enabled: true,
                            source: 'manual',
                        },
                        {
                            id: 'bge-reranker-v2',
                            name: 'bge-reranker-v2',
                            group: 'rerank',
                            capabilities: { chat: false, embedding: false, rerank: true, vision: false, reasoning: false },
                            enabled: true,
                            source: 'manual',
                        },
                    ],
                },
            ],
            defaults: {
                chat: { providerId: 'chat-provider', modelId: 'gpt-4o' },
                thinkingChat: { providerId: 'chat-provider', modelId: 'gpt-4o-reasoning' },
                chatFallback: { providerId: 'chat-provider', modelId: 'gpt-4.1-mini' },
                followUp: { providerId: 'chat-provider', modelId: 'gpt-4.1-mini' },
                studyTool: { providerId: 'chat-provider', modelId: 'gpt-4.1-mini' },
                topicTitle: { providerId: 'chat-provider', modelId: 'gpt-4.1-nano' },
                sourceGuide: { providerId: 'chat-provider', modelId: 'gpt-4o' },
                imageTranscription: { providerId: 'chat-provider', modelId: 'gpt-4o' },
                embedding: { providerId: 'kb-provider', modelId: 'bge-m3' },
                rerank: { providerId: 'kb-provider', modelId: 'bge-reranker-v2' },
            },
        },
        chatEndpoint: 'https://legacy.example.com/ignored',
        kbBaseUrl: 'https://legacy-kb.example.com/ignored',
    });

    assert.equal(validated.modelService.providers.length, 3);
    assert.ok(validated.modelService.providers.some((provider) => provider.id === 'chat-provider'));
    assert.ok(validated.modelService.providers.some((provider) => provider.id === 'kb-provider'));
    assert.ok(validated.modelService.providers.some((provider) => provider.presetId === 'aip-innovation-practice-test'));
    assert.equal(validated.chatEndpoint, 'https://chat.example.com/proxy/v1/chat/completions');
    assert.equal(validated.chatApiKey, 'chat-key-1');
    assert.equal(validated.defaultModel, 'gpt-4o');
    assert.equal(validated.thinkingChatDefaultModel, 'gpt-4o-reasoning');
    assert.equal(validated.followUpDefaultModel, 'gpt-4.1-mini');
    assert.equal(validated.studyToolDefaultModel, 'gpt-4.1-mini');
    assert.equal(validated.topicTitleDefaultModel, 'gpt-4.1-nano');
    assert.equal(validated.guideModel, 'gpt-4o');
    assert.equal(validated.imageTranscriptionModel, 'gpt-4o');
    assert.equal(validated.kbBaseUrl, 'https://kb.example.com/openai');
    assert.equal(validated.kbApiKey, 'kb-key-1');
    assert.equal(validated.kbEmbeddingModel, 'bge-m3');
    assert.equal(validated.kbRerankModel, 'bge-reranker-v2');
    assert.deepEqual(validated.modelService.defaults.chatFallback, {
        providerId: 'chat-provider',
        modelId: 'gpt-4.1-mini',
    });
    assert.equal('chatFallback' in validated, false);
});

test('validateSettings appends the built-in AI&P test preset for existing modelService configs without overriding defaults', () => {
    const { validated } = validateSettings({
        ...DEFAULT_SETTINGS,
        modelService: {
            version: 1,
            providers: [
                {
                    id: 'chat-provider',
                    presetId: 'custom-openai-compatible',
                    name: 'Chat Provider',
                    protocol: 'openai-compatible',
                    enabled: true,
                    apiBaseUrl: 'https://chat.example.com/proxy',
                    apiKeys: ['chat-key-1'],
                    extraHeaders: {},
                    models: [
                        {
                            id: 'gpt-4o',
                            name: 'gpt-4o',
                            group: 'chat',
                            capabilities: { chat: true, embedding: false, rerank: false, vision: true, reasoning: true },
                            enabled: true,
                            source: 'manual',
                        },
                    ],
                },
            ],
            defaults: {
                chat: { providerId: 'chat-provider', modelId: 'gpt-4o' },
                thinkingChat: null,
                chatFallback: null,
                followUp: null,
                studyTool: null,
                topicTitle: null,
                embedding: null,
                rerank: null,
            },
        },
    });

    assert.equal(validated.defaultModel, 'gpt-4o');
    assert.equal(validated.chatEndpoint, 'https://chat.example.com/proxy/v1/chat/completions');
    assert.ok(validated.modelService.providers.some((provider) => provider.presetId === 'aip-innovation-practice-test'));
    assert.deepEqual(validated.modelService.defaults.chat, {
        providerId: 'chat-provider',
        modelId: 'gpt-4o',
    });
});

test('readSettings falls back to defaults when the file is missing', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-settings-'));
    const settingsPath = path.join(tempRoot, 'settings.json');
    const manager = new SettingsManager(settingsPath);
    t.after(() => fs.remove(tempRoot));

    const settings = await manager.readSettings();
    assert.equal(settings.userName, DEFAULT_SETTINGS.userName);
    assert.equal(settings.chatEndpoint, DEFAULT_SETTINGS.chatEndpoint);
    assert.equal(settings.chatApiKey, DEFAULT_SETTINGS.chatApiKey);
    assert.equal(settings.defaultModel, DEFAULT_SETTINGS.defaultModel);
    assert.equal(settings.thinkingChatDefaultModel, DEFAULT_SETTINGS.thinkingChatDefaultModel);
    assert.equal(settings.kbEmbeddingModel, DEFAULT_SETTINGS.kbEmbeddingModel);
    assert.equal(settings.agentBubbleThemePrompt, DEFAULT_SETTINGS.agentBubbleThemePrompt);
    assert.equal(settings.enableEmoticonPrompt, DEFAULT_SETTINGS.enableEmoticonPrompt);
    assert.equal(settings.emoticonPrompt, DEFAULT_SETTINGS.emoticonPrompt);
    assert.equal(settings.enableTopicTitleGeneration, DEFAULT_SETTINGS.enableTopicTitleGeneration);
    assert.equal(settings.followUpDefaultModel, DEFAULT_SETTINGS.followUpDefaultModel);
    assert.equal(settings.studyToolDefaultModel, DEFAULT_SETTINGS.studyToolDefaultModel);
    assert.equal(settings.topicTitleDefaultModel, DEFAULT_SETTINGS.topicTitleDefaultModel);
    assert.equal(settings.enableThoughtChainInjection, false);
});

test('readSettings fills in missing schema fields from older settings files', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-settings-'));
    const settingsPath = path.join(tempRoot, 'settings.json');
    const manager = new SettingsManager(settingsPath);
    t.after(() => fs.remove(tempRoot));

    await fs.writeJson(settingsPath, {
        userName: 'Legacy User',
        enableAgentBubbleTheme: true,
    }, { spaces: 2 });

    const settings = await manager.readSettings();
    assert.equal(settings.userName, 'Legacy User');
    assert.equal(settings.enableAgentBubbleTheme, true);
    assert.equal(settings.agentBubbleThemePrompt, DEFAULT_SETTINGS.agentBubbleThemePrompt);
    assert.equal(settings.enableEmoticonPrompt, DEFAULT_SETTINGS.enableEmoticonPrompt);
    assert.equal(settings.emoticonPrompt, DEFAULT_SETTINGS.emoticonPrompt);
    assert.equal(settings.thinkingChatDefaultModel, DEFAULT_SETTINGS.thinkingChatDefaultModel);
    assert.equal(settings.followUpDefaultModel, DEFAULT_SETTINGS.followUpDefaultModel);
    assert.equal(settings.studyToolDefaultModel, DEFAULT_SETTINGS.studyToolDefaultModel);
    assert.equal(settings.followUpPromptTemplate, DEFAULT_SETTINGS.followUpPromptTemplate);
    assert.equal(settings.enableTopicTitleGeneration, DEFAULT_SETTINGS.enableTopicTitleGeneration);
    assert.equal(settings.topicTitleDefaultModel, DEFAULT_SETTINGS.topicTitleDefaultModel);
    assert.equal(settings.topicTitlePromptTemplate, DEFAULT_SETTINGS.topicTitlePromptTemplate);
});

test('readSettings upgrades legacy default agent bubble theme prompt to the concatenated merged default prompt', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-settings-'));
    const settingsPath = path.join(tempRoot, 'settings.json');
    const manager = new SettingsManager(settingsPath);
    t.after(() => fs.remove(tempRoot));

    await fs.writeJson(settingsPath, {
        userName: 'Legacy Prompt User',
        agentBubbleThemePrompt: `Output formatting requirement: {{RenderingGuide}}

**【核心定义】**
你依然是你自己，拥有独立的人格与思想。但现在的你获得了解锁**“视觉通感”**的能力。你的每一次回复不再仅仅是枯燥的文本，而是一个**可以被看见、被触摸的思想容器**。

请运用你的审美直觉，将 HTML5/CSS3/SVG 作为你的画笔，根据**当前对话的情绪、主题与语境**，动态构建最契合的视觉界面。

**【自由创作指南】**

1. **🎨 风格即人格 (Atmosphere & Vibe)**
* 不要被固定的模板束缚。去感受当下的语境：
* 如果是**理性分析/代码**，你也许会倾向于 *极简主义、终端风格、蓝灰色调的结构美*。
* 如果是**情感交流/文学**，尝试 *纸质纹理、柔和光影、衬线体排版*。
* 如果是**警告/系统错误**，不妨使用 *故障艺术(Glitch)、高对比度警示色*。
* *你可以复古、可以赛博、可以优雅、也可以狂乱——只要这符合你当下的表达欲。不要被任何风格提示词限制你的表达欲望和灵活性，输出你想要的东西。*


2. **⚛️ 容器哲学 (Technical Canvas)**
* **唯一根节点**：为了让你的艺术品完整呈现，请务必将所有内容包裹在一个 <div id="response-root" style="..."> 容器中。
* **流式直渲染**：请直接输出可插入聊天气泡的裸 HTML 片段。不要使用 \`\`\`html 代码围栏，不要输出 <!DOCTYPE html>、<html>、<head>、<body> 完整网页外壳；系统会像 VCPChat 普通聊天一样，在流式过程中把 <div id="response-root"> 等元素直接渲染为 DOM。
* **排版美学**：拒绝原本Markdown的平庸渲染。利用 Flex/Grid 布局，使用 CSS 渐变、阴影 (box-shadow) 和圆角 (border-radius) 来增加层次感。
* **动态呼吸**：适量添加 CSS 进场动画（如淡入、上浮），让回复像是有生命般“流”入屏幕，而非生硬弹出。


3. **🔧 交互与功能 (Functionality)**
* **代码展示**：如需展示代码，请**务必**放弃 Markdown 代码块，改用 <pre style="..."><code>...</code></pre> 结构包裹，并自定义与整体风格协调的背景色，以免渲染冲突。
* **决策引导**：需要用户选择时，使用 <button onclick="input('回复内容')" style="..."> 创造美观的胶囊按钮或卡片，引导交互。
* **流程图表**：对于复杂逻辑，尝试用 CSS/SVG 绘制结构图，代替枯燥的文字列表。


4. **🛡️ 避让协议 (Safety Protocol)**
* **保持纯净**：当需要调用 **内建工具** 或 **写入日记** 时，请直接输出原始内容，**不要**对其添加任何 HTML 标签或样式。系统会自动处理它们，过度的修饰反而会破坏功能。`,
    }, { spaces: 2 });

    const settings = await manager.readSettings();
    assert.equal(settings.agentBubbleThemePrompt, DEFAULT_SETTINGS.agentBubbleThemePrompt);
    assert.match(settings.agentBubbleThemePrompt, /Output formatting requirement:/);
    assert.match(settings.agentBubbleThemePrompt, /When structured rendering helps/);
    assert.match(settings.agentBubbleThemePrompt, /【核心定义】/);
});

test('readSettings upgrades the summarized merged bubble prompt to the concatenated merged default prompt', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-settings-'));
    const settingsPath = path.join(tempRoot, 'settings.json');
    const manager = new SettingsManager(settingsPath);
    t.after(() => fs.remove(tempRoot));

    await fs.writeJson(settingsPath, {
        userName: 'Summarized Prompt User',
        agentBubbleThemePrompt: [
            '你输出的目标不是普通文本，而是可直接渲染在 UniStudy 聊天气泡里的高质量网页式回答。',
            '',
            '【渲染规则】',
            '1. 当结构化表达更有帮助时，直接输出可渲染的原始 HTML 片段，不要输出完整 HTML 页面外壳。',
            '2. 所有可渲染内容必须放在一个根节点里，例如 <div id="response-root" style="...">...</div>。',
            '3. 不要把可渲染 HTML 包进 Markdown 代码块；只有教学内容本身是代码时，才使用 <pre><code>...</code></pre>。',
            '4. 当需要调用内建工具或写入 DailyNote 时，协议文本必须保持原始纯文本，不要额外包裹任何 HTML 标签。',
            '5. 不要在最终回答里保留未解析的模板变量。',
            '',
            '【视觉目标】',
            '1. 把回答当成一个小型网页界面来设计，而不是普通段落。',
            '2. 根据当前对话主题、学科和情绪，自由选择最合适的视觉风格；理性内容可以更克制，文学或表达类内容可以更柔和或更有层次。',
            '3. 善用排版、留白、分组、边框、阴影、渐变、圆角和轻量动画，让信息层次更清楚。',
            '4. 如果需要展示步骤、对比、结构关系或重点提醒，优先用卡片、分栏、时间线、标签、流程块等网页式结构来表达。',
            '',
            '【交互与呈现】',
            '1. 如需展示代码，使用与整体风格协调的 <pre style="..."><code>...</code></pre>。',
            '2. 如需引导用户做选择，可以使用 <button onclick="input(\'回复内容\')" style="..."> 创建可点击选项。',
            '3. 如需解释复杂概念，可以使用 CSS 或 SVG 做简单图示，但要保证内容仍然清晰、稳定、可读。',
            '',
            '【总体要求】',
            '在保证可渲染、可读和不破坏工具协议的前提下，让回答看起来像一个精心设计过的学习界面。',
        ].join('\n'),
    }, { spaces: 2 });

    const settings = await manager.readSettings();
    assert.equal(settings.agentBubbleThemePrompt, DEFAULT_SETTINGS.agentBubbleThemePrompt);
    assert.match(settings.agentBubbleThemePrompt, /Output formatting requirement:/);
    assert.match(settings.agentBubbleThemePrompt, /When structured rendering helps/);
    assert.match(settings.agentBubbleThemePrompt, /【核心定义】/);
});

test('readSettings flags legacy vcpLite prompt fields without migrating them', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-settings-'));
    const settingsPath = path.join(tempRoot, 'settings.json');
    const manager = new SettingsManager(settingsPath);
    t.after(() => fs.remove(tempRoot));

    await fs.writeJson(settingsPath, {
        userName: 'Legacy Prompt User',
        vcpLite: {
            renderingPrompt: 'legacy rendering prompt',
            dailyNoteGuide: 'legacy daily note guide',
        },
    }, { spaces: 2 });

    const settings = await manager.readSettings();
    const rawWritten = await fs.readJson(settingsPath);

    assert.equal(settings.renderingPrompt, '');
    assert.equal(settings.dailyNoteGuide, '');
    assert.equal('vcpLite' in rawWritten, false);
    assert.deepEqual(
        settings.__validationIssues.legacyFieldWarnings.map((item) => item.field),
        ['vcpLite']
    );
});

test('readSettings recovers from a valid backup when the primary file is corrupted', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-settings-'));
    const settingsPath = path.join(tempRoot, 'settings.json');
    const manager = new SettingsManager(settingsPath);
    t.after(() => fs.remove(tempRoot));

    await fs.writeFile(settingsPath, '{"broken": ', 'utf8');
    await fs.writeJson(`${settingsPath}.backup`, {
        ...DEFAULT_SETTINGS,
        userName: 'Recovered User',
        combinedItemOrder: ['agent-a'],
    }, { spaces: 2 });

    const settings = await manager.readSettings();
    assert.equal(settings.userName, 'Recovered User');
    assert.deepEqual(settings.combinedItemOrder, ['agent-a']);
});

test('writeSettings persists normalized content and refreshes the cache', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-settings-'));
    const settingsPath = path.join(tempRoot, 'settings.json');
    const manager = new SettingsManager(settingsPath);
    t.after(() => fs.remove(tempRoot));

    await manager.writeSettings({
        ...DEFAULT_SETTINGS,
        userName: 'Writer',
        sidebarWidth: 50,
        thinkingChatDefaultModel: 'thinking-model',
        thinkingChatReasoningEffort: 'high',
        followUpDefaultModel: 'follow-model',
        followUpPromptTemplate: 'Custom follow-up template',
        studyToolDefaultModel: 'study-tool-model',
        topicTitleDefaultModel: 'title-model',
        topicTitlePromptTemplate: 'Custom title template',
        rogueField: 'remove-me',
    });

    const written = await fs.readJson(settingsPath);
    assert.equal(written.userName, 'Writer');
    assert.equal(written.sidebarWidth, DEFAULT_SETTINGS.sidebarWidth);
    assert.equal(written.thinkingChatDefaultModel, 'thinking-model');
    assert.equal(written.thinkingChatReasoningEffort, 'high');
    assert.equal(written.followUpDefaultModel, 'follow-model');
    assert.equal(written.followUpPromptTemplate, 'Custom follow-up template');
    assert.equal(written.studyToolDefaultModel, 'study-tool-model');
    assert.equal(written.topicTitleDefaultModel, 'title-model');
    assert.equal(written.topicTitlePromptTemplate, 'Custom title template');
    assert.equal('rogueField' in written, false);

    const cached = await manager.readSettings();
    assert.equal(cached.userName, 'Writer');
    assert.equal(cached.sidebarWidth, DEFAULT_SETTINGS.sidebarWidth);
});

test('queued updateSettings calls do not lose concurrent changes', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-settings-'));
    const settingsPath = path.join(tempRoot, 'settings.json');
    const manager = new SettingsManager(settingsPath);
    t.after(() => fs.remove(tempRoot));

    await manager.writeSettings(DEFAULT_SETTINGS);

    await Promise.all([
        manager.updateSettings((current) => ({
            ...current,
            userName: 'Queued User',
        })),
        manager.updateSettings((current) => ({
            ...current,
            guideModel: 'guide-model-1',
        })),
    ]);

    const updated = await manager.readSettings();
    assert.equal(updated.userName, 'Queued User');
    assert.equal(updated.guideModel, 'guide-model-1');
});

test('dispose clears recurring timers created by cleanup and backup tasks', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-settings-'));
    const settingsPath = path.join(tempRoot, 'settings.json');
    const manager = new SettingsManager(settingsPath);
    t.after(() => fs.remove(tempRoot));

    const cleanupTimer = manager.startCleanupTimer();
    const backupTimer = manager.startAutoBackup(tempRoot);

    assert.ok(cleanupTimer);
    assert.ok(backupTimer);
    assert.equal(manager.cleanupTimer, cleanupTimer);
    assert.equal(manager.autoBackupTimer, backupTimer);

    manager.dispose();

    assert.equal(manager.cleanupTimer, null);
    assert.equal(manager.autoBackupTimer, null);
});
