const fs = require('fs-extra');
const http = require('http');
const path = require('path');
const { _electron: electron } = require('playwright');
const {
    createTempDataRootFromFixture,
    ensureFixtureDataRoot,
    resolveFixtureDataRoot,
} = require('./lib/runtime-data-roots');
const { buildPreloadBundles } = require('./lib/preload-bundles');
const { resolveElectronBinary } = require('./lib/electron-binary');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function flattenContent(content) {
    if (typeof content === 'string') {
        return content;
    }

    if (Array.isArray(content)) {
        return content.map((part) => flattenContent(part?.text ?? part?.content ?? part)).join('');
    }

    if (content && typeof content === 'object') {
        if (typeof content.text === 'string') {
            return content.text;
        }
        if (typeof content.content === 'string') {
            return content.content;
        }
    }

    return '';
}

function extractScenario(body) {
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const lastUserMessage = [...messages].reverse().find((message) => message?.role === 'user');
    const content = flattenContent(lastUserMessage?.content || '');

    if (content.includes('E2E_INTERRUPT')) return 'interrupt';
    if (content.includes('E2E_ERROR')) return 'error';
    if (content.includes('E2E_TIMEOUT')) return 'timeout';
    if (content.includes('E2E_NON_STREAM')) return 'non_stream';
    return 'normal';
}

function createMockServer() {
    const activeStreams = new Map();

    const cleanupStream = (requestId) => {
        const entry = activeStreams.get(requestId);
        if (!entry) {
            return;
        }

        entry.closed = true;
        for (const timer of entry.timers) {
            clearTimeout(timer);
        }
        activeStreams.delete(requestId);
    };

    const safeWrite = (requestId, payload) => {
        const entry = activeStreams.get(requestId);
        if (!entry || entry.closed) {
            return;
        }
        entry.response.write(payload);
    };

    const safeEnd = (requestId) => {
        const entry = activeStreams.get(requestId);
        if (!entry || entry.closed) {
            return;
        }

        entry.closed = true;
        entry.response.end();
        cleanupStream(requestId);
    };

    const scheduleWrite = (requestId, delayMs, payload) => {
        const entry = activeStreams.get(requestId);
        if (!entry) {
            return;
        }

        const timer = setTimeout(() => {
            safeWrite(requestId, payload);
        }, delayMs);
        entry.timers.push(timer);
    };

    const scheduleEnd = (requestId, delayMs) => {
        const entry = activeStreams.get(requestId);
        if (!entry) {
            return;
        }

        const timer = setTimeout(() => {
            safeEnd(requestId);
        }, delayMs);
        entry.timers.push(timer);
    };

    const server = http.createServer(async (request, response) => {
        const chunks = [];
        request.on('data', (chunk) => chunks.push(chunk));

        await new Promise((resolve) => request.on('end', resolve));

        let body = {};
        try {
            body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
        } catch (_error) {
            body = {};
        }

        if (request.method === 'POST' && request.url === '/v1/interrupt') {
            const requestId = body?.requestId;
            if (requestId) {
                safeEnd(requestId);
            }

            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ success: true, message: 'Interrupt accepted.' }));
            return;
        }

        if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
            response.writeHead(404, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ message: 'Not found.' }));
            return;
        }

        const requestId = body?.requestId || `mock_${Date.now()}`;
        const scenario = extractScenario(body);
        const streaming = body?.stream === true;

        if (!streaming || scenario === 'non_stream') {
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({
                id: requestId,
                choices: [
                    {
                        message: {
                            content: 'Non-stream response complete.',
                        },
                    },
                ],
            }));
            return;
        }

        if (scenario === 'error') {
            response.writeHead(500, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ message: 'Mock server error.' }));
            return;
        }

        response.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
        });

        activeStreams.set(requestId, {
            response,
            timers: [],
            closed: false,
        });

        request.on('aborted', () => cleanupStream(requestId));
        response.on('close', () => cleanupStream(requestId));

        if (scenario === 'interrupt') {
            scheduleWrite(requestId, 100, `data: ${JSON.stringify({ choices: [{ delta: { content: 'Partial ' } }] })}\n\n`);
            scheduleWrite(requestId, 200, `data: ${JSON.stringify({ delta: { content: 'interrupt ' } })}\n\n`);
            scheduleWrite(requestId, 5000, `data: ${JSON.stringify({ content: 'response should not fully arrive' })}\n\n`);
            scheduleWrite(requestId, 5200, 'data: [DONE]\n\n');
            scheduleEnd(requestId, 5250);
            return;
        }

        if (scenario === 'timeout') {
            scheduleWrite(requestId, 100, `data: ${JSON.stringify({ choices: [{ delta: { content: 'Timed ' } }] })}\n\n`);
            scheduleWrite(requestId, 200, `data: ${JSON.stringify({ delta: { content: 'partial ' } })}\n\n`);
            return;
        }

        scheduleWrite(requestId, 50, 'data: {invalid-json}\n\n');
        scheduleWrite(requestId, 120, `data: ${JSON.stringify({ choices: [{ delta: { content: 'Normal ' } }] })}\n\n`);
        scheduleWrite(requestId, 220, `data: ${JSON.stringify({ delta: { content: 'response ' } })}\n\n`);
        scheduleWrite(requestId, 320, `data: ${JSON.stringify({ content: 'complete ' })}\n\n`);
        scheduleWrite(requestId, 420, `data: ${JSON.stringify({ message: { content: 'now.' } })}\n\n`);
        scheduleWrite(requestId, 520, 'data: [DONE]\n\n');
        scheduleEnd(requestId, 560);
    });

    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            resolve({
                server,
                port: address.port,
            });
        });
    });
}

async function prepareTempDataRoot(port) {
    const fixtureRoot = await ensureFixtureDataRoot(resolveFixtureDataRoot({ repoRoot: PROJECT_ROOT }));
    const tempRoot = await createTempDataRootFromFixture({
        prefix: 'vcpchat-lite-recovery-',
        fixtureRoot,
    });

    const settingsPath = path.join(tempRoot, 'settings.json');
    const settings = await fs.readJson(settingsPath);
    settings.vcpServerUrl = `http://127.0.0.1:${port}/v1/chat/completions`;
    settings.vcpApiKey = 'mock-key';
    await fs.writeJson(settingsPath, settings, { spaces: 2 });

    return { tempRoot };
}

async function readHistory(historyPath) {
    return fs.readJson(historyPath);
}

async function listHistoryFiles(tempRoot) {
    const historyFiles = [];
    const userDataDir = path.join(tempRoot, 'UserData');
    const agentDirs = await fs.readdir(userDataDir).catch(() => []);

    for (const agentId of agentDirs) {
        const topicsDir = path.join(userDataDir, agentId, 'topics');
        const topicIds = await fs.readdir(topicsDir).catch(() => []);
        for (const topicId of topicIds) {
            const historyPath = path.join(topicsDir, topicId, 'history.json');
            if (await fs.pathExists(historyPath)) {
                historyFiles.push(historyPath);
            }
        }
    }

    return historyFiles;
}

async function waitFor(predicate, timeoutMs, label) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        const result = await predicate();
        if (result) {
            return result;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }

    throw new Error(`Timed out waiting for ${label}.`);
}

async function waitForFinalAssistant(historyPath, previousMessageId, matcher, label) {
    return waitFor(async () => {
        const history = await readHistory(historyPath).catch(() => null);
        if (!Array.isArray(history) || history.length === 0) {
            return null;
        }

        const lastMessage = history[history.length - 1];
        if (!lastMessage || lastMessage.role !== 'assistant' || lastMessage.isThinking) {
            return null;
        }

        if (previousMessageId && lastMessage.id === previousMessageId) {
            return null;
        }

        if (matcher && !matcher(lastMessage, history, historyPath)) {
            return null;
        }

        return { historyPath, message: lastMessage, history };
    }, 30000, label);
}

async function ensureLoaded(page) {
    await page.waitForSelector('#sendMessageBtn');
    await page.waitForFunction(() => {
        const debugState = window.__liteDebugState ? window.__liteDebugState() : null;
        const agentItems = document.querySelectorAll('#agentList .list-item');
        const activeTopic = document.querySelector('#topicList .topic-item.active');
        const activeAgentName = document.getElementById('currentChatAgentName')?.textContent?.trim();
        return (
            typeof window.sendMessage === 'function' &&
            debugState &&
            typeof debugState.currentSelectedItemId === 'string' &&
            typeof debugState.currentTopicId === 'string' &&
            debugState.currentSelectedItemId.length > 0 &&
            debugState.currentTopicId.length > 0 &&
            agentItems.length > 0 &&
            activeTopic &&
            activeAgentName &&
            activeAgentName !== 'Select an agent'
        );
    });
}

async function resolveCurrentContext(page, tempRoot) {
    const viewState = await page.evaluate(() => ({
        debugState: window.__liteDebugState ? window.__liteDebugState() : null,
        agentId: document.querySelector('#agentList .list-item.active')?.dataset?.agentId || '',
        topicId: document.querySelector('#topicList .topic-item.active')?.dataset?.topicId || '',
        agentName: document.getElementById('currentChatAgentName')?.textContent?.trim() || '',
        topicName: document.querySelector('#topicList .topic-item.active .list-item__title')?.textContent?.trim() || '',
    }));

    const effectiveAgentId = viewState.debugState?.currentSelectedItemId || viewState.agentId;
    const effectiveTopicId = viewState.debugState?.currentTopicId || viewState.topicId;

    if (effectiveAgentId && effectiveTopicId) {
        return {
            agentId: effectiveAgentId,
            topicId: effectiveTopicId,
            historyPath: path.join(tempRoot, 'UserData', effectiveAgentId, 'topics', effectiveTopicId, 'history.json'),
            agentConfigPath: path.join(tempRoot, 'Agents', effectiveAgentId, 'config.json'),
            agentName: viewState.agentName,
            topicName: viewState.topicName,
        };
    }

    const agentsDir = path.join(tempRoot, 'Agents');
    const agentIds = await fs.readdir(agentsDir).catch(() => []);

    for (const agentId of agentIds) {
        const configPath = path.join(agentsDir, agentId, 'config.json');
        const config = await fs.readJson(configPath).catch(() => null);
        if (!config || config.name !== viewState.agentName) {
            continue;
        }

        const topic = Array.isArray(config.topics)
            ? config.topics.find((entry) => entry.name === viewState.topicName)
            : null;
        if (!topic) {
            continue;
        }

        return {
            agentId,
            topicId: topic.id,
            historyPath: path.join(tempRoot, 'UserData', agentId, 'topics', topic.id, 'history.json'),
            agentConfigPath: configPath,
            agentName: viewState.agentName,
            topicName: viewState.topicName,
        };
    }

    throw new Error(`Unable to resolve current context from UI. agent=${viewState.agentName}, topic=${viewState.topicName}`);
}

async function sendMessage(page, text) {
    await page.evaluate((value) => window.sendMessage(value), text);
}

async function triggerInterrupt(page) {
    await page.evaluate(() => window.sendMessage());
}

async function settle(ms = 2500) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
    const { server, port } = await createMockServer();
    const tempData = await prepareTempDataRoot(port);
    const electronBinary = resolveElectronBinary(PROJECT_ROOT);

    let electronApp;
    try {
        await buildPreloadBundles();
        electronApp = await electron.launch({
            executablePath: electronBinary,
            args: [PROJECT_ROOT],
            cwd: PROJECT_ROOT,
            env: {
                ...process.env,
                VCPCHAT_DATA_ROOT: tempData.tempRoot,
                VCPCHAT_VCP_TIMEOUT_MS: '1200',
            },
        });

        const page = await electronApp.firstWindow();
        page.on('pageerror', (error) => {
            console.log(`[renderer:pageerror] ${error.message}`);
        });

        await ensureLoaded(page);

        const currentContext = await resolveCurrentContext(page, tempData.tempRoot);
        console.log(`[E2E] Using agent "${currentContext.agentName}" and topic "${currentContext.topicName}".`);
        const normalHistoryBefore = await readHistory(currentContext.historyPath).catch(() => []);
        const normalPreviousMessageId = normalHistoryBefore[normalHistoryBefore.length - 1]?.id || null;
        await sendMessage(page, 'E2E_NORMAL');
        await settle();
        const normalResult = await waitForFinalAssistant(
            currentContext.historyPath,
            normalPreviousMessageId,
            (message) => message.content.includes('Normal response complete now.'),
            'normal streaming completion'
        );
        console.log('[E2E] Normal stream final message:', normalResult.message.content);

        const interruptHistoryBefore = await readHistory(currentContext.historyPath).catch(() => []);
        const interruptPreviousMessageId = interruptHistoryBefore[interruptHistoryBefore.length - 1]?.id || null;
        await sendMessage(page, 'E2E_INTERRUPT');
        await waitFor(
            async () => (await page.textContent('#sendMessageBtn'))?.trim() === 'Stop',
            5000,
            'interrupt button state'
        );
        await new Promise((resolve) => setTimeout(resolve, 450));
        await triggerInterrupt(page);
        const interruptedResult = await waitForFinalAssistant(
            currentContext.historyPath,
            interruptPreviousMessageId,
            (message) => message.finishReason === 'cancelled_by_user' && message.content.includes('Partial interrupt'),
            'interrupted streaming completion'
        );
        console.log('[E2E] Interrupt final message:', interruptedResult.message.content);

        const errorHistoryBefore = await readHistory(currentContext.historyPath).catch(() => []);
        const errorPreviousMessageId = errorHistoryBefore[errorHistoryBefore.length - 1]?.id || null;
        await sendMessage(page, 'E2E_ERROR');
        await settle();
        const errorResult = await waitForFinalAssistant(
            currentContext.historyPath,
            errorPreviousMessageId,
            (message) => message.content.includes('Mock server error'),
            'server error completion'
        );
        console.log('[E2E] Error final message:', errorResult.message.content);

        const timeoutHistoryBefore = await readHistory(currentContext.historyPath).catch(() => []);
        const timeoutPreviousMessageId = timeoutHistoryBefore[timeoutHistoryBefore.length - 1]?.id || null;
        await sendMessage(page, 'E2E_TIMEOUT');
        await settle();
        const timeoutResult = await waitForFinalAssistant(
            currentContext.historyPath,
            timeoutPreviousMessageId,
            (message) => message.finishReason === 'timed_out' && message.content.includes('Timed partial'),
            'timeout completion'
        );
        console.log('[E2E] Timeout final message:', timeoutResult.message.content);

        const agentConfig = await fs.readJson(currentContext.agentConfigPath);
        agentConfig.streamOutput = false;
        await fs.writeJson(currentContext.agentConfigPath, agentConfig, { spaces: 2 });
        await page.reload();
        await ensureLoaded(page);
        await page.evaluate(() => {
            const activeAgent = document.querySelector('#agentList .list-item.active');
            if (activeAgent) {
                activeAgent.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            }
        });
        await settle(800);
        await page.evaluate(() => {
            const activeTopic = document.querySelector('#topicList .topic-item.active');
            if (activeTopic) {
                activeTopic.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            }
        });
        await settle(800);

        const reloadedContext = await resolveCurrentContext(page, tempData.tempRoot);
        const nonStreamHistoryBefore = await readHistory(reloadedContext.historyPath).catch(() => []);
        const nonStreamPreviousMessageId = nonStreamHistoryBefore[nonStreamHistoryBefore.length - 1]?.id || null;
        await sendMessage(page, 'E2E_NON_STREAM');
        await settle();
        const nonStreamResult = await waitForFinalAssistant(
            reloadedContext.historyPath,
            nonStreamPreviousMessageId,
            (message) => message.content.includes('Non-stream response complete.'),
            'non-stream completion'
        );
        console.log('[E2E] Non-stream final message:', nonStreamResult.message.content);

        console.log('[E2E] All VCP recovery scenarios passed.');
    } finally {
        if (electronApp) {
            await electronApp.close().catch(() => {});
        }
        await new Promise((resolve) => server.close(resolve));
        await fs.remove(tempData.tempRoot).catch(() => {});
    }
}

run().catch((error) => {
    console.error('[E2E] Failure:', error);
    process.exit(1);
});
