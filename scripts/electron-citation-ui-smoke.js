const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');
const { buildPreloadBundles } = require('./lib/preload-bundles');

const repoRoot = path.resolve(__dirname, '..');
const reportDir = path.join(repoRoot, 'docs', 'test-reports');
let preloadBundlesReady = false;

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatStamp(date = new Date()) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const sec = String(date.getSeconds()).padStart(2, '0');
    return `${yyyy}${mm}${dd}-${hh}${min}${sec}`;
}

function resolveRealDataRoot() {
    const explicit = String(process.env.UNISTUDY_REAL_DATA_ROOT || process.env.UNISTUDY_DATA_ROOT || '').trim();
    if (explicit) {
        return path.resolve(explicit);
    }

    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'UniStudy');
}

async function readSettings(dataRoot) {
    const settingsPath = path.join(dataRoot, 'settings.json');
    if (!await fs.pathExists(settingsPath)) {
        throw new Error(`settings.json not found under ${dataRoot}`);
    }
    return fs.readJson(settingsPath);
}

async function launchApp(dataRoot) {
    if (!preloadBundlesReady) {
        await buildPreloadBundles();
        preloadBundlesReady = true;
    }

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

async function readMainBridgeStatus(page) {
    return page.evaluate(() => ({
        chatAPI: Boolean(window.chatAPI),
        electronAPI: Boolean(window.electronAPI),
        electronPath: Boolean(window.electronPath),
        openTextInNewWindow: typeof window.chatAPI?.openTextInNewWindow === 'function',
        openImageViewer: typeof window.chatAPI?.openImageViewer === 'function',
    })).catch((error) => ({
        chatAPI: false,
        electronAPI: false,
        electronPath: false,
        openTextInNewWindow: false,
        openImageViewer: false,
        evaluationError: error?.message || String(error),
    }));
}

async function waitForMainBridge(page, timeoutMs = 30000) {
    const startedAt = Date.now();
    let lastStatus = null;

    while (Date.now() - startedAt < timeoutMs) {
        lastStatus = await readMainBridgeStatus(page);
        if (
            lastStatus.chatAPI
            && lastStatus.electronAPI
            && lastStatus.electronPath
            && lastStatus.openTextInNewWindow
            && lastStatus.openImageViewer
        ) {
            return lastStatus;
        }
        await delay(250);
    }

    throw new Error(`Timed out waiting for main preload bridge: ${JSON.stringify(lastStatus)}`);
}

function buildCitationSmokeHistoryTemplate() {
    const baseTimestamp = Date.now();
    return [
        {
            id: `user_${baseTimestamp}_citation_smoke`,
            role: 'user',
            content: '请基于来源做一个简短总结。',
            timestamp: baseTimestamp,
            attachments: [],
        },
        {
            id: `assistant_${baseTimestamp + 1}_citation_smoke`,
            role: 'assistant',
            name: 'Citation Smoke',
            avatarUrl: '../assets/default_avatar.png',
            avatarColor: null,
            content: [
                '## 回答摘要',
                '',
                '牛顿第一定律说明，当一个物体不受外力时，它会保持静止或匀速直线运动状态。',
                '',
                '欧姆定律描述了电流、电压与电阻之间的关系。',
                '',
                '最后这段只是补充说明，用来承接没有明显命中的引用。',
            ].join('\n'),
            timestamp: baseTimestamp + 1,
            isThinking: false,
            finishReason: 'stop',
            kbContextRefs: [
                {
                    documentId: '',
                    documentName: '牛顿讲义.txt',
                    snippet: '当一个物体不受外力作用时，它将保持静止状态或匀速直线运动状态。',
                    pageNumber: 1,
                    paragraphIndex: 2,
                    sectionTitle: '第一章 力学',
                    score: 0.9821,
                    vecScore: 0.8123,
                    rerankScore: 0.9555,
                },
                {
                    documentId: '',
                    documentName: '牛顿讲义.txt',
                    snippet: '保持静止状态或匀速直线运动状态是这条定律的核心表述。',
                    pageNumber: 1,
                    paragraphIndex: 3,
                    sectionTitle: '第一章 力学',
                    score: 0.9432,
                    vecScore: 0.8011,
                    rerankScore: 0.9312,
                },
                {
                    documentId: '',
                    documentName: '化学总复习.md',
                    snippet: '元素周期表帮助我们理解元素性质变化规律。',
                    paragraphIndex: 6,
                    sectionTitle: '化学基础',
                    score: 0.7123,
                    vecScore: 0.6211,
                    rerankScore: 0.7011,
                },
            ],
        },
    ];
}

async function prepareCitationTopic(dataRoot, agentId, topicName) {
    const app = await launchApp(dataRoot);

    try {
        const page = await waitForFirstWindow(app, 30000);
        await page.waitForLoadState('domcontentloaded');
        await waitForMainBridge(page, 30000);
        await delay(1000);

        return await page.evaluate(async ({ requestedAgentId, topicName, historyTemplate }) => {
            const current = await window.chatAPI.loadSettings();
            const agents = await window.chatAPI.getAgents();
            const matchedAgent = Array.isArray(agents)
                ? agents.find((agent) => agent?.id === requestedAgentId) || null
                : null;

            if (!matchedAgent) {
                throw new Error(`Target agent not found: ${requestedAgentId}`);
            }

            const topicResult = await window.chatAPI.createNewTopicForAgent(requestedAgentId, topicName, false, true);
            if (!topicResult?.success) {
                throw new Error(topicResult?.error || 'Failed to create smoke topic.');
            }

            const topicId = topicResult.topicId;
            const history = historyTemplate.map((message) => (
                message.role === 'assistant'
                    ? {
                        ...message,
                        agentId: requestedAgentId,
                        topicId,
                    }
                    : message
            ));

            await window.chatAPI.saveChatHistory(requestedAgentId, topicId, history);
            const persisted = await window.chatAPI.getChatHistory(requestedAgentId, topicId);
            await window.chatAPI.saveSettings({
                ...current,
                lastOpenItemId: requestedAgentId,
                lastOpenItemType: 'agent',
                lastOpenTopicId: topicId,
            });

            return {
                originalLastOpenItemId: current.lastOpenItemId || null,
                originalLastOpenItemType: current.lastOpenItemType || null,
                originalLastOpenTopicId: current.lastOpenTopicId || null,
                topicId,
                topicName: topicResult.topicName || topicName,
                persistedAssistantKbRefs: Array.isArray(persisted)
                    ? ((persisted.find((item) => item.role === 'assistant') || {}).kbContextRefs || []).length
                    : 0,
            };
        }, {
            requestedAgentId: agentId,
            topicName,
            historyTemplate: buildCitationSmokeHistoryTemplate(),
        });
    } finally {
        await app.close().catch(() => {});
    }
}

async function cleanupCitationTopic(dataRoot, agentId, setup = {}) {
    const app = await launchApp(dataRoot);

    try {
        const page = await waitForFirstWindow(app, 30000);
        await page.waitForLoadState('domcontentloaded');
        await waitForMainBridge(page, 30000);
        await delay(500);

        return await page.evaluate(async ({ agentId, setup }) => {
            const current = await window.chatAPI.loadSettings();
            await window.chatAPI.saveSettings({
                ...current,
                lastOpenItemId: setup.originalLastOpenItemId || current.lastOpenItemId || null,
                lastOpenItemType: setup.originalLastOpenItemType || current.lastOpenItemType || 'agent',
                lastOpenTopicId: setup.originalLastOpenTopicId || current.lastOpenTopicId || null,
            });

            let deleteResult = null;
            if (setup.topicId) {
                deleteResult = await window.chatAPI.deleteTopic(agentId, setup.topicId).catch((error) => ({
                    success: false,
                    error: error?.message || String(error),
                }));
            }

            return {
                restoredLastOpenItemId: setup.originalLastOpenItemId || null,
                restoredLastOpenTopicId: setup.originalLastOpenTopicId || null,
                deleteResult,
            };
        }, { agentId, setup });
    } finally {
        await app.close().catch(() => {});
    }
}

async function verifyCitationUi(dataRoot, expectedTopicName) {
    const app = await launchApp(dataRoot);

    try {
        const page = await waitForFirstWindow(app, 30000);
        await page.waitForLoadState('domcontentloaded');
        await waitForMainBridge(page, 30000);
        await page.waitForFunction(
            (topicName) => document.getElementById('currentChatTopicName')?.textContent?.includes(topicName),
            expectedTopicName,
            { timeout: 30000 },
        );

        await page.waitForFunction(() => {
            const lastAssistant = document.querySelector('.message-item.assistant:last-of-type .md-content');
            return Boolean(lastAssistant?.querySelectorAll('.message-citation-chip').length >= 3);
        }, null, { timeout: 30000 });
        await page.waitForFunction(() => {
            const loading = document.getElementById('appBootLoading');
            if (!loading) {
                return true;
            }
            return loading.classList.contains('hidden') || loading.getAttribute('aria-hidden') === 'true';
        }, null, { timeout: 30000 }).catch(() => {});

        const initial = await page.evaluate(() => {
            const assistantMessages = Array.from(document.querySelectorAll('.message-item.assistant'));
            const lastMessage = assistantMessages[assistantMessages.length - 1];
            const content = lastMessage?.querySelector('.md-content');
            const paragraphs = Array.from(content?.querySelectorAll('p') || []);
            const firstParagraph = paragraphs[0] || null;
            const secondParagraph = paragraphs[1] || null;
            const thirdParagraph = paragraphs[2] || null;

            return {
                chipCount: content?.querySelectorAll('.message-citation-chip').length || 0,
                bottomRefCardCount: lastMessage?.querySelectorAll('.message-kb-refs').length || 0,
                popoverExists: Boolean(document.getElementById('messageCitationPopover')),
                headingChipCount: content?.querySelector('h1,h2,h3,h4,h5,h6')?.querySelectorAll('.message-citation-chip').length || 0,
                firstParagraphChipTexts: Array.from(firstParagraph?.querySelectorAll('.message-citation-chip') || []).map((node) => node.textContent?.trim()),
                secondParagraphChipTexts: Array.from(secondParagraph?.querySelectorAll('.message-citation-chip') || []).map((node) => node.textContent?.trim()),
                thirdParagraphChipTexts: Array.from(thirdParagraph?.querySelectorAll('.message-citation-chip') || []).map((node) => node.textContent?.trim()),
            };
        });

        await page.evaluate(() => {
            window.__citationSmokeEvents = [];
            if (!window.__citationSmokeListenerInstalled) {
                document.addEventListener('unistudy-open-kb-ref', (event) => {
                    window.__citationSmokeEvents.push(event.detail || null);
                });
                window.__citationSmokeListenerInstalled = true;
            }
        });

        const chips = page.locator('.message-item.assistant').last().locator('.message-citation-chip');
        await chips.nth(0).evaluate((node) => node.click());
        await page.waitForFunction(() => {
            const popoverEl = document.getElementById('messageCitationPopover');
            return Boolean(popoverEl && !popoverEl.classList.contains('hidden') && popoverEl.getAttribute('aria-hidden') === 'false');
        }, null, { timeout: 10000 });

        const firstPopover = await page.evaluate(() => {
            const popoverEl = document.getElementById('messageCitationPopover');
            return {
                badge: popoverEl?.querySelector('.message-citation-popover__badge')?.textContent?.trim() || '',
                title: popoverEl?.querySelector('.message-citation-popover__title')?.textContent?.trim() || '',
                meta: popoverEl?.querySelector('.message-citation-popover__meta')?.textContent?.trim() || '',
                snippet: popoverEl?.querySelector('.message-citation-popover__snippet')?.textContent?.trim() || '',
                openActionText: popoverEl?.querySelector('.message-citation-popover__action')?.textContent?.trim() || '',
                rawText: popoverEl?.textContent || '',
            };
        });

        await page.keyboard.press('Escape');
        await page.waitForFunction(() => {
            const popoverEl = document.getElementById('messageCitationPopover');
            return Boolean(popoverEl?.classList.contains('hidden') && popoverEl?.getAttribute('aria-hidden') === 'true');
        }, null, { timeout: 10000 });

        await chips.nth(1).evaluate((node) => node.click());
        await page.waitForFunction(() => {
            const popoverEl = document.getElementById('messageCitationPopover');
            return Boolean(popoverEl && !popoverEl.classList.contains('hidden'));
        }, null, { timeout: 10000 });

        const secondPopover = await page.evaluate(() => {
            const popoverEl = document.getElementById('messageCitationPopover');
            return {
                badge: popoverEl?.querySelector('.message-citation-popover__badge')?.textContent?.trim() || '',
                title: popoverEl?.querySelector('.message-citation-popover__title')?.textContent?.trim() || '',
            };
        });

        await page.locator('#currentChatTopicName').evaluate((node) => node.click());
        await page.waitForFunction(() => {
            const popoverEl = document.getElementById('messageCitationPopover');
            return Boolean(popoverEl?.classList.contains('hidden'));
        }, null, { timeout: 10000 });

        await chips.nth(2).evaluate((node) => node.click());
        await page.waitForFunction(() => {
            const popoverEl = document.getElementById('messageCitationPopover');
            return Boolean(popoverEl && !popoverEl.classList.contains('hidden'));
        }, null, { timeout: 10000 });

        const thirdPopoverBeforeAction = await page.evaluate(() => {
            const popoverEl = document.getElementById('messageCitationPopover');
            return {
                badge: popoverEl?.querySelector('.message-citation-popover__badge')?.textContent?.trim() || '',
                title: popoverEl?.querySelector('.message-citation-popover__title')?.textContent?.trim() || '',
                meta: popoverEl?.querySelector('.message-citation-popover__meta')?.textContent?.trim() || '',
            };
        });

        await page.locator('#messageCitationPopover [data-citation-open-original="true"]').evaluate((node) => node.click());
        await delay(300);

        const afterAction = await page.evaluate(() => {
            const popoverEl = document.getElementById('messageCitationPopover');
            return {
                popoverHidden: Boolean(popoverEl?.classList.contains('hidden')),
                events: Array.isArray(window.__citationSmokeEvents) ? window.__citationSmokeEvents : [],
            };
        });

        const passed = Boolean(
            initial.chipCount === 3
            && initial.bottomRefCardCount === 0
            && initial.popoverExists
            && initial.headingChipCount === 0
            && JSON.stringify(initial.firstParagraphChipTexts) === JSON.stringify(['1', '2'])
            && JSON.stringify(initial.secondParagraphChipTexts) === JSON.stringify([])
            && JSON.stringify(initial.thirdParagraphChipTexts) === JSON.stringify(['3'])
            && firstPopover.badge === '1'
            && firstPopover.title === '牛顿讲义.txt'
            && firstPopover.meta.includes('第 1 页')
            && firstPopover.meta.includes('第 2 段')
            && firstPopover.meta.includes('第一章 力学')
            && firstPopover.snippet.includes('不受外力作用')
            && firstPopover.openActionText === '打开原文'
            && !/score|vec|rerank/i.test(firstPopover.rawText)
            && secondPopover.badge === '2'
            && secondPopover.title === '牛顿讲义.txt'
            && thirdPopoverBeforeAction.badge === '3'
            && thirdPopoverBeforeAction.title === '化学总复习.md'
            && thirdPopoverBeforeAction.meta.includes('第 6 段')
            && thirdPopoverBeforeAction.meta.includes('化学基础')
            && afterAction.popoverHidden
            && Array.isArray(afterAction.events)
            && afterAction.events.length >= 1
            && afterAction.events[afterAction.events.length - 1]?.documentName === '化学总复习.md'
        );

        return {
            passed,
            initial,
            firstPopover,
            secondPopover,
            thirdPopoverBeforeAction,
            afterAction,
        };
    } finally {
        await app.close().catch(() => {});
    }
}

async function run() {
    const startedAt = new Date().toISOString();
    const dataRoot = resolveRealDataRoot();
    const settings = await readSettings(dataRoot);
    const agentId = String(process.env.UNISTUDY_REAL_AGENT_ID || settings.lastOpenItemId || '').trim();
    if (!agentId) {
        throw new Error('No target agent id found. Set UNISTUDY_REAL_AGENT_ID or ensure settings.lastOpenItemId exists.');
    }

    const topicName = `引用气泡真实实测-${formatStamp()}`;
    const reportPath = path.join(reportDir, `citation-ui-real-${formatStamp()}.json`);
    let setup = null;
    let cleanup = null;

    const summary = {
        repoRoot,
        dataRoot,
        agentId,
        reportPath,
        topicName,
        settingsDiagnostics: {
            hasChatEndpoint: Boolean(String(settings.chatEndpoint || '').trim()),
            hasChatApiKey: Boolean(String(settings.chatApiKey || '').trim()),
            hasKbBaseUrl: Boolean(String(settings.kbBaseUrl || '').trim()),
            hasKbApiKey: Boolean(String(settings.kbApiKey || '').trim()),
            defaultModel: settings.defaultModel || '',
            guideModel: settings.guideModel || '',
        },
        setup: null,
        verification: null,
        cleanup: null,
        startedAt,
        finishedAt: null,
        success: false,
        error: null,
    };

    try {
        await fs.ensureDir(reportDir);
        setup = await prepareCitationTopic(dataRoot, agentId, topicName);
        summary.setup = setup;
        summary.verification = await verifyCitationUi(dataRoot, setup.topicName);
        summary.success = summary.verification?.passed === true;
    } catch (error) {
        summary.error = error?.stack || String(error);
        summary.success = false;
    } finally {
        try {
            if (setup?.topicId) {
                cleanup = await cleanupCitationTopic(dataRoot, agentId, setup);
            }
            summary.cleanup = cleanup;
        } catch (cleanupError) {
            summary.cleanup = {
                error: cleanupError?.stack || String(cleanupError),
            };
            summary.success = false;
            if (!summary.error) {
                summary.error = `Cleanup failed: ${cleanupError?.message || cleanupError}`;
            }
        }

        summary.finishedAt = new Date().toISOString();
        await fs.writeJson(reportPath, summary, { spaces: 2 });
    }

    return summary;
}

if (require.main === module) {
    run()
        .then((summary) => {
            console.log(JSON.stringify(summary, null, 2));
            if (!summary.success) {
                process.exitCode = 1;
            }
        })
        .catch((error) => {
            console.error(error?.stack || String(error));
            process.exitCode = 1;
        });
}
