const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');

const { buildPreloadBundles } = require('../../scripts/lib/preload-bundles');

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function launchApp(repoRoot, dataRoot) {
    await buildPreloadBundles();
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

async function waitForRendererReady(page, timeoutMs = 30000) {
    const startedAt = Date.now();
    let lastStatus = null;
    while (Date.now() - startedAt < timeoutMs) {
        lastStatus = await page.evaluate(() => ({
            chatAPI: Boolean(window.chatAPI),
            createKnowledgeBase: typeof window.chatAPI?.createKnowledgeBase === 'function',
            subjectCards: document.querySelectorAll('[data-subject-card]').length,
        })).catch((error) => ({
            chatAPI: false,
            createKnowledgeBase: false,
            subjectCards: 0,
            error: error?.message || String(error),
        }));

        if (lastStatus.chatAPI && lastStatus.createKnowledgeBase && lastStatus.subjectCards > 0) {
            return lastStatus;
        }
        await delay(250);
    }
    throw new Error(`Timed out waiting for renderer readiness: ${JSON.stringify(lastStatus)}`);
}

async function waitForPageCondition(page, predicate, timeoutMs = 30000, arg = undefined) {
    const startedAt = Date.now();
    let lastValue = null;
    while (Date.now() - startedAt < timeoutMs) {
        lastValue = await page.evaluate(predicate, arg).catch((error) => ({
            error: error?.message || String(error),
        }));
        if (lastValue) {
            return lastValue;
        }
        await delay(250);
    }
    throw new Error(`Timed out waiting for page condition: ${JSON.stringify(lastValue)}`);
}

test('subject emoji picker loads bundled data, saves selected emoji, and clears back to fallback', { timeout: 120000 }, async () => {
    const repoRoot = path.resolve(__dirname, '../..');
    const tempDataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unistudy-emoji-picker-e2e-'));
    const app = await launchApp(repoRoot, tempDataRoot);
    const consoleMessages = [];

    try {
        const page = await waitForFirstWindow(app);
        page.on('console', (message) => {
            consoleMessages.push(`${message.type()}: ${message.text()}`);
        });
        page.on('pageerror', (error) => {
            consoleMessages.push(`pageerror: ${error.message}`);
        });
        await page.waitForLoadState('domcontentloaded');
        await waitForRendererReady(page);

        const initialState = await page.evaluate(() => {
            const card = document.querySelector('[data-subject-card]');
            return {
                agentId: card?.dataset.agentId || '',
                fallbackEmoji: card?.querySelector('.subject-overview-card__emoji')?.textContent?.trim() || '',
            };
        });
        assert.ok(initialState.agentId);
        assert.ok(initialState.fallbackEmoji);

        await page.locator('[data-subject-card]').first().click({ button: 'right' });
        await page.locator('[data-subject-action="manage"]').click();
        await waitForPageCondition(page, () => !document.getElementById('subjectSettingsPanel')?.classList.contains('hidden'));

        const panelFallbackEmoji = await page.locator('#agentCardEmojiPreview').textContent();
        assert.equal(panelFallbackEmoji, initialState.fallbackEmoji);

        await page.locator('#agentCardEmojiPickerBtn').click();
        const pickerState = await waitForPageCondition(page, () => {
            const picker = document.getElementById('agentCardEmojiPicker');
            const shadowText = picker?.shadowRoot?.textContent || '';
            const emojiButtons = picker?.shadowRoot?.querySelectorAll('.tabpanel .emoji-menu button.emoji')?.length || 0;
            return emojiButtons > 20
                ? {
                    emojiButtons,
                    shadowHasCouldNotLoad: /Could not load emoji/i.test(shadowText),
                    shadowTextSample: shadowText.replace(/\s+/g, ' ').trim().slice(0, 160),
                }
                : false;
        });
        assert.equal(pickerState.shadowHasCouldNotLoad, false);

        const selectedEmoji = await page.evaluate(() => {
            const picker = document.getElementById('agentCardEmojiPicker');
            const button = picker?.shadowRoot?.querySelector('.tabpanel .emoji-menu button.emoji');
            if (!button) {
                return '';
            }
            const emoji = button.textContent.trim();
            button.click();
            return emoji;
        });
        assert.ok(selectedEmoji);

        await waitForPageCondition(page, () => document.getElementById('agentCardEmojiInput')?.value || false);
        assert.equal(await page.locator('#agentCardEmojiInput').inputValue(), selectedEmoji);
        assert.equal(await page.locator('#agentCardEmojiPreview').textContent(), selectedEmoji);

        await page.locator('#saveAgentSettingsBtn').click();
        await waitForPageCondition(page, ({ agentId, emoji }) => window.chatAPI.getAgentConfig(agentId)
            .then((config) => config?.cardEmoji === emoji), 30000, { agentId: initialState.agentId, emoji: selectedEmoji });
        await waitForPageCondition(page, ({ agentId, emoji }) => {
            const card = [...document.querySelectorAll('[data-subject-card]')]
                .find((item) => item.dataset.agentId === agentId);
            return card?.querySelector('.subject-overview-card__emoji')?.textContent?.trim() === emoji;
        }, 30000, { agentId: initialState.agentId, emoji: selectedEmoji });

        await page.locator('#agentCardEmojiClearBtn').click();
        assert.equal(await page.locator('#agentCardEmojiInput').inputValue(), '');
        assert.equal(await page.locator('#agentCardEmojiPreview').textContent(), initialState.fallbackEmoji);

        await page.locator('#saveAgentSettingsBtn').click();
        await waitForPageCondition(page, ({ agentId }) => window.chatAPI.getAgentConfig(agentId)
            .then((config) => (config?.cardEmoji || '') === ''), 30000, { agentId: initialState.agentId });
        await waitForPageCondition(page, ({ agentId, fallbackEmoji }) => {
            const card = [...document.querySelectorAll('[data-subject-card]')]
                .find((item) => item.dataset.agentId === agentId);
            return card?.querySelector('.subject-overview-card__emoji')?.textContent?.trim() === fallbackEmoji;
        }, 30000, { agentId: initialState.agentId, fallbackEmoji: initialState.fallbackEmoji });

        const relevantConsoleErrors = consoleMessages.filter((line) => /Could not load emoji|Refused to connect.*(?:data|blob):|violates.*connect-src/i.test(line));
        assert.deepEqual(relevantConsoleErrors, []);
    } finally {
        await app.close().catch(() => {});
    }
});
