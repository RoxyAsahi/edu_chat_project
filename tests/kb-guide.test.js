const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

const {
    buildGuidePrompt,
    buildGuideSegments,
    createGuideService,
    extractGuideTextFromResponse,
} = require('../src/modules/main/knowledge-base/guideService');
const {
    createImageDocumentTranscriber,
} = require('../src/modules/main/knowledge-base/imageDocumentTranscriber');

test('extractGuideTextFromResponse handles nested model payloads', () => {
    const text = extractGuideTextFromResponse({
        response: {
            output: [
                {
                    content: [
                        {
                            parts: [
                                { text: '# 文档主题\n内容摘要' },
                            ],
                        },
                    ],
                },
            ],
        },
    });

    assert.equal(text, '# 文档主题\n内容摘要');
});

test('buildGuidePrompt preserves required headings and navigation', () => {
    const prompt = buildGuidePrompt(
        { name: '线性代数讲义', contentType: 'markdown' },
        {
            contentType: 'markdown',
            text: '# 第一章\n向量空间\n\n# 第二章\n线性变换',
        },
    );

    assert.match(prompt, /# 文档主题/);
    assert.match(prompt, /# 章节导航/);
    assert.match(prompt, /线性代数讲义/);
    assert.match(prompt, /第一章/);
});

test('buildGuideSegments groups plain text into paragraph windows', () => {
    const segments = buildGuideSegments({
        text: '第一段\n\n第二段\n\n第三段\n\n第四段\n\n第五段',
    });

    assert.equal(segments.length, 2);
    assert.equal(segments[0].locator, '第 1-4 段');
    assert.equal(segments[1].locator, '第 5 段');
});

test('guideService forwards the global chat fallback execution into guide generation calls', async () => {
    let capturedRequest = null;
    const service = createGuideService({
        runtime: {
            async readSettings() {
                return {
                    modelService: {
                        version: 1,
                        providers: [
                            {
                                id: 'primary-provider',
                                presetId: 'custom-openai-compatible',
                                name: 'Primary',
                                protocol: 'openai-compatible',
                                enabled: true,
                                apiBaseUrl: 'https://primary.example.com/base',
                                apiKeys: ['primary-key'],
                                extraHeaders: { 'X-Primary': '1' },
                                models: [
                                    {
                                        id: 'primary-chat',
                                        name: 'primary-chat',
                                        group: 'chat',
                                        capabilities: { chat: true, embedding: false, rerank: false, vision: false, reasoning: false },
                                        enabled: true,
                                        source: 'manual',
                                    },
                                ],
                            },
                            {
                                id: 'fallback-provider',
                                presetId: 'custom-openai-compatible',
                                name: 'Fallback',
                                protocol: 'openai-compatible',
                                enabled: true,
                                apiBaseUrl: 'https://fallback.example.com/base',
                                apiKeys: ['fallback-key'],
                                extraHeaders: { 'X-Fallback': '1' },
                                models: [
                                    {
                                        id: 'fallback-chat',
                                        name: 'fallback-chat',
                                        group: 'chat',
                                        capabilities: { chat: true, embedding: false, rerank: false, vision: true, reasoning: false },
                                        enabled: true,
                                        source: 'manual',
                                    },
                                ],
                            },
                        ],
                        defaults: {
                            chat: { providerId: 'primary-provider', modelId: 'primary-chat' },
                            chatFallback: { providerId: 'fallback-provider', modelId: 'fallback-chat' },
                            followUp: null,
                            topicTitle: null,
                            embedding: null,
                            rerank: null,
                        },
                    },
                };
            },
            async resolveGuideModel() {
                return 'guide-model';
            },
        },
        repository: {},
        parseKnowledgeBaseDocument: async () => ({
            contentType: 'markdown',
            text: '# 第一章\n\n向量空间',
        }),
        chatClient: {
            async send(request) {
                capturedRequest = request;
                return {
                    response: {
                        choices: [{
                            message: {
                                content: '# 文档主题\n向量空间指南',
                            },
                        }],
                    },
                };
            },
        },
    });

    const markdown = await service.generateGuideMarkdown({
        id: 'doc-guide',
        name: '线性代数.md',
        contentType: 'markdown',
    });

    assert.equal(markdown, '# 文档主题\n向量空间指南');
    assert.equal(capturedRequest.endpoint, 'https://primary.example.com/base/v1/chat/completions');
    assert.equal(capturedRequest.modelConfig.model, 'guide-model');
    assert.deepEqual(capturedRequest.fallbackExecution.ref, {
        providerId: 'fallback-provider',
        modelId: 'fallback-chat',
    });
    assert.equal(capturedRequest.fallbackExecution.endpoint, 'https://fallback.example.com/base/v1/chat/completions');
});

test('imageDocumentTranscriber routes image transcription through a vision-capable model and forwards fallback execution', async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-image-transcriber-'));
    const storedPath = path.join(tempRoot, 'diagram.png');
    t.after(() => fs.remove(tempRoot));

    await fs.writeFile(storedPath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

    let capturedRequest = null;
    const transcriber = createImageDocumentTranscriber({
        runtime: {
            async readSettings() {
                return {
                    defaultModel: 'primary-chat',
                    modelService: {
                        version: 1,
                        providers: [
                            {
                                id: 'primary-provider',
                                presetId: 'custom-openai-compatible',
                                name: 'Primary',
                                protocol: 'openai-compatible',
                                enabled: true,
                                apiBaseUrl: 'https://primary.example.com/base',
                                apiKeys: ['primary-key'],
                                extraHeaders: { 'X-Primary': '1' },
                                models: [
                                    {
                                        id: 'primary-chat',
                                        name: 'primary-chat',
                                        group: 'chat',
                                        capabilities: { chat: true, embedding: false, rerank: false, vision: false, reasoning: false },
                                        enabled: true,
                                        source: 'manual',
                                    },
                                    {
                                        id: 'vision-primary',
                                        name: 'vision-primary',
                                        group: 'chat',
                                        capabilities: { chat: true, embedding: false, rerank: false, vision: true, reasoning: false },
                                        enabled: true,
                                        source: 'manual',
                                    },
                                ],
                            },
                            {
                                id: 'fallback-provider',
                                presetId: 'custom-openai-compatible',
                                name: 'Fallback',
                                protocol: 'openai-compatible',
                                enabled: true,
                                apiBaseUrl: 'https://fallback.example.com/base',
                                apiKeys: ['fallback-key'],
                                extraHeaders: { 'X-Fallback': '1' },
                                models: [
                                    {
                                        id: 'fallback-vision',
                                        name: 'fallback-vision',
                                        group: 'chat',
                                        capabilities: { chat: true, embedding: false, rerank: false, vision: true, reasoning: false },
                                        enabled: true,
                                        source: 'manual',
                                    },
                                ],
                            },
                        ],
                        defaults: {
                            chat: { providerId: 'primary-provider', modelId: 'primary-chat' },
                            chatFallback: { providerId: 'fallback-provider', modelId: 'fallback-vision' },
                            followUp: null,
                            topicTitle: null,
                            embedding: null,
                            rerank: null,
                        },
                    },
                };
            },
        },
        chatClient: {
            async send(request) {
                capturedRequest = request;
                return {
                    response: {
                        choices: [{
                            message: {
                                content: '# 图片概览\n\n图片资料可用',
                            },
                        }],
                    },
                };
            },
        },
    });

    const result = await transcriber.transcribeImageDocument({
        id: 'doc-image',
        name: 'diagram.png',
        storedPath,
        mimeType: 'image/png',
    });

    assert.equal(result.contentType, 'markdown');
    assert.match(result.text, /图片资料可用/);
    assert.equal(capturedRequest.modelConfig.model, 'vision-primary');
    assert.equal(capturedRequest.requiredCapability, 'vision');
    assert.deepEqual(capturedRequest.fallbackExecution.ref, {
        providerId: 'fallback-provider',
        modelId: 'fallback-vision',
    });
    assert.equal(capturedRequest.fallbackExecution.endpoint, 'https://fallback.example.com/base/v1/chat/completions');
});
