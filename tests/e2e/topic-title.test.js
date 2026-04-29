const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs-extra');
const http = require('http');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function launchApp(repoRoot, dataRoot) {
    const launchEnv = {
        ...process.env,
        UNISTUDY_DATA_ROOT: dataRoot,
        ELECTRON_ENABLE_LOGGING: '1',
    };
    delete launchEnv.ELECTRON_RUN_AS_NODE;
    return electron.launch({
        args: [repoRoot],
        cwd: repoRoot,
        env: launchEnv,
    });
}

async function waitForFirstWindow(app, timeoutMs = 30000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const windows = app.windows();
        if (windows.length > 0) {
            return windows[0];
        }
        await delay(250);
    }
    throw new Error(`Timed out waiting for the first Electron window after ${timeoutMs}ms.`);
}

async function waitForRendererBridge(page, timeoutMs = 30000) {
    const startedAt = Date.now();
    let lastStatus = null;

    while (Date.now() - startedAt < timeoutMs) {
        lastStatus = await page.evaluate(() => ({
            chatAPI: Boolean(window.chatAPI),
            createAgent: typeof window.chatAPI?.createAgent === 'function',
            loadSettings: typeof window.chatAPI?.loadSettings === 'function',
            sendChatRequest: typeof window.chatAPI?.sendChatRequest === 'function',
        })).catch((error) => ({
            chatAPI: false,
            createAgent: false,
            loadSettings: false,
            sendChatRequest: false,
            evaluationError: error?.message || String(error),
        }));

        if (lastStatus.chatAPI && lastStatus.createAgent && lastStatus.loadSettings && lastStatus.sendChatRequest) {
            return lastStatus;
        }
        await delay(250);
    }

    throw new Error(`Timed out waiting for the preload bridge: ${JSON.stringify(lastStatus)}`);
}

function createMockChatServer() {
    const requests = [];
    const server = http.createServer((request, response) => {
        let rawBody = '';
        request.setEncoding('utf8');
        request.on('data', (chunk) => {
            rawBody += chunk;
        });
        request.on('end', () => {
            let payload = {};
            try {
                payload = rawBody ? JSON.parse(rawBody) : {};
            } catch (_error) {
                payload = {};
            }
            const promptText = (Array.isArray(payload.messages) ? payload.messages : [])
                .map((message) => String(message?.content || ''))
                .join('\n\n');
            const isTopicTitleRequest = /Generate a concise, 3-5 word title/i.test(promptText)
                || /"title"\s*:/i.test(promptText);
            const isFollowUpRequest = /follow_ups|追问建议|追问1/i.test(promptText);
            const content = isTopicTitleRequest
                ? '{"title":"📘 作业习题要求"}'
                : (isFollowUpRequest
                    ? '{"follow_ups":[]}'
                    : '作业习题要求包括审题、列式和检查答案。');

            requests.push({
                body: payload,
                isTopicTitleRequest,
                isFollowUpRequest,
            });

            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({
                choices: [{
                    message: {
                        role: 'assistant',
                        content,
                    },
                    finish_reason: 'stop',
                }],
            }));
        });
    });

    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            resolve({
                endpoint: `http://127.0.0.1:${address.port}/v1/chat/completions`,
                requests,
                close: () => new Promise((closeResolve) => server.close(closeResolve)),
            });
        });
    });
}

test('Electron smoke: first chat request auto-generates a guarded emoji topic title', { timeout: 120000 }, async () => {
    const repoRoot = path.resolve(__dirname, '../..');
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-topic-title-e2e-'));
    const mockServer = await createMockChatServer();
    const app = await launchApp(repoRoot, dataRoot);

    try {
        const page = await waitForFirstWindow(app, 30000);
        await page.waitForLoadState('domcontentloaded');
        await waitForRendererBridge(page, 30000);

        const ids = await page.evaluate(async ({ endpoint }) => {
            const topicId = 'default';
            const topic = {
                id: topicId,
                name: '新对话 1',
                createdAt: Date.now(),
                locked: true,
                unread: false,
                creatorSource: 'ui',
                knowledgeBaseId: null,
                selectedKnowledgeBaseDocumentIds: null,
            };
            const created = await window.chatAPI.createAgent('标题命名 Smoke', {
                systemPrompt: '你是标题命名 smoke 助手。',
                model: 'mock-model',
                streamOutput: false,
                topics: [topic],
            });
            if (!created?.success) {
                throw new Error(created?.error || 'createAgent failed');
            }

            const currentSettings = await window.chatAPI.loadSettings();
            await window.chatAPI.saveSettings({
                ...currentSettings,
                chatEndpoint: endpoint,
                chatApiKey: 'test-key',
                defaultModel: 'mock-model',
                topicTitleDefaultModel: 'mock-model',
                enableTopicTitleGeneration: true,
                studyLogPolicy: {
                    ...(currentSettings.studyLogPolicy || {}),
                    enabled: false,
                },
                lastOpenItemId: created.agentId,
                lastOpenItemType: 'agent',
                lastOpenTopicId: topicId,
            });

            return {
                agentId: created.agentId,
                topicId,
            };
        }, { endpoint: mockServer.endpoint });

        await page.reload();
        await page.waitForLoadState('domcontentloaded');
        await waitForRendererBridge(page, 30000);

        const agentSelector = `.list-item--agent[data-agent-id="${ids.agentId}"]`;
        const topicSelector = `.topic-item[data-topic-id="${ids.topicId}"]`;
        await page.waitForSelector(agentSelector, { state: 'attached', timeout: 30000 });
        await page.evaluate((selector) => {
            document.querySelector(selector)?.click();
        }, agentSelector);
        await page.waitForSelector(topicSelector, { state: 'attached', timeout: 30000 });
        await page.evaluate((selector) => {
            document.querySelector(selector)?.click();
        }, topicSelector);

        const initialTopicUi = await page.evaluate((topicId) => {
            const item = document.querySelector(`.topic-item[data-topic-id="${topicId}"]`);
            return {
                title: item?.querySelector('.topic-item__body strong')?.textContent || '',
            };
        }, ids.topicId);
        assert.deepEqual(initialTopicUi, {
            title: '💬 新对话 1',
        });

        await page.waitForFunction(() => {
            const input = document.getElementById('messageInput');
            const button = document.getElementById('sendMessageBtn');
            return Boolean(input && !input.disabled && button && !button.disabled);
        }, null, { timeout: 30000 });

        await page.evaluate(() => {
            window.__topicTitleSmokePayloads = [];
            const originalSendChatRequest = window.chatAPI.sendChatRequest;
            window.chatAPI.sendChatRequest = async (request) => {
                window.__topicTitleSmokePayloads.push(JSON.parse(JSON.stringify(request)));
                return originalSendChatRequest(request);
            };
        });

        await page.evaluate(() => {
            const input = document.getElementById('messageInput');
            const button = document.getElementById('sendMessageBtn');
            input.value = '请说明作业习题要求';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            button.click();
        });

        try {
            await page.waitForFunction((topicId) => {
                const item = document.querySelector(`.topic-item[data-topic-id="${topicId}"]`);
                return item?.querySelector('.topic-item__body strong')?.textContent === '📘 作业习题要求';
            }, ids.topicId, { timeout: 30000 });
        } catch (error) {
            const diagnostic = await page.evaluate(async ({ agentId, topicId }) => {
                const topics = await window.chatAPI.getAgentTopics(agentId).catch((requestError) => ({ error: requestError.message }));
                const history = await window.chatAPI.getChatHistory(agentId, topicId).catch((requestError) => ({ error: requestError.message }));
                const item = document.querySelector(`.topic-item[data-topic-id="${topicId}"]`);
                return {
                    topics,
                    history,
                    topicText: item?.textContent || '',
                    topicHtml: item?.innerHTML || '',
                    inputDisabled: document.getElementById('messageInput')?.disabled,
                    sendDisabled: document.getElementById('sendMessageBtn')?.disabled,
                    sendPayloads: window.__topicTitleSmokePayloads || [],
                };
            }, ids);
            throw new Error(`${error.message}\n${JSON.stringify({
                diagnostic,
                requestSummary: mockServer.requests.map((request) => ({
                    isTopicTitleRequest: request.isTopicTitleRequest,
                    isFollowUpRequest: request.isFollowUpRequest,
                    messageCount: Array.isArray(request.body?.messages) ? request.body.messages.length : 0,
                    roles: Array.isArray(request.body?.messages)
                        ? request.body.messages.map((message) => message.role)
                        : [],
                    messagePreview: Array.isArray(request.body?.messages)
                        ? request.body.messages.map((message) => String(message.content || '').slice(0, 80))
                        : [],
                })),
            }, null, 2)}`);
        }

        const finalSnapshot = await page.evaluate(async ({ agentId, topicId }) => {
            const topics = await window.chatAPI.getAgentTopics(agentId);
            const history = await window.chatAPI.getChatHistory(agentId, topicId);
            const item = document.querySelector(`.topic-item[data-topic-id="${topicId}"]`);
            return {
                topicName: topics.find((topic) => topic.id === topicId)?.name || '',
                domTitle: item?.querySelector('.topic-item__body strong')?.textContent || '',
                historyRoles: Array.isArray(history) ? history.map((message) => message.role) : [],
            };
        }, ids);

        assert.equal(finalSnapshot.topicName, '📘 作业习题要求');
        assert.equal(finalSnapshot.domTitle, '📘 作业习题要求');
        assert.deepEqual(finalSnapshot.historyRoles, ['user', 'assistant']);
        assert.equal(mockServer.requests.some((request) => request.isTopicTitleRequest), true);
    } finally {
        await app.close().catch(() => {});
        await mockServer.close().catch(() => {});
        await fs.remove(dataRoot);
    }
});
