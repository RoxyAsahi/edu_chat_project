const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');
const { JSDOM } = require('jsdom');

async function loadDynamicIslandModule() {
    const modulePath = path.resolve(__dirname, '..', 'src/modules/renderer/app/dynamicIsland/dynamicIslandController.js');
    const source = await fs.readFile(modulePath, 'utf8');
    return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
}

function createStore(initialState) {
    const state = initialState;
    const listeners = new Map();
    return {
        getState() {
            return state;
        },
        patchState(slice, patch) {
            const currentSlice = state[slice];
            const nextSlice = typeof patch === 'function'
                ? patch(currentSlice, state)
                : { ...currentSlice, ...patch };
            state[slice] = nextSlice;
            for (const listener of listeners.get(slice) || []) {
                listener(nextSlice, state);
            }
            return nextSlice;
        },
        subscribe(slice, listener) {
            if (!listeners.has(slice)) {
                listeners.set(slice, new Set());
            }
            listeners.get(slice).add(listener);
            return () => {
                listeners.get(slice)?.delete(listener);
            };
        },
    };
}

function createDynamicIslandDom() {
    const dom = new JSDOM(`
        <body>
            <div id="outside"></div>
            <div id="dynamicIsland" class="dynamic-island">
                <div class="dynamic-island__bar">
                    <button id="dynamicIslandCurrentAgentBtn" type="button">
                        <strong id="titlebarCurrentAgent">未选择学科</strong>
                    </button>
                    <button id="dynamicIslandStatusBtn" type="button" aria-expanded="false" aria-controls="dynamicIslandPanel">
                        <span id="dynamicIslandStatusEyebrow"></span>
                        <strong id="dynamicIslandStatusText"></strong>
                    </button>
                    <button id="manualNotesLibraryBtn" type="button">我的笔记</button>
                </div>
                <div id="dynamicIslandPanel" aria-hidden="true">
                    <strong id="dynamicIslandTimerDisplay"></strong>
                    <input id="dynamicIslandMinutesInput" type="number" value="25" />
                    <button id="dynamicIslandStartBtn" type="button">开始</button>
                    <button id="dynamicIslandPauseBtn" class="hidden" type="button">暂停</button>
                    <button id="dynamicIslandResumeBtn" class="hidden" type="button">继续</button>
                    <button id="dynamicIslandResetBtn" type="button">重置</button>
                </div>
            </div>
        </body>
    `, { pretendToBeVisual: true });

    return {
        window: dom.window,
        document: dom.window.document,
        el: {
            dynamicIsland: dom.window.document.getElementById('dynamicIsland'),
            dynamicIslandCurrentAgentBtn: dom.window.document.getElementById('dynamicIslandCurrentAgentBtn'),
            dynamicIslandStatusBtn: dom.window.document.getElementById('dynamicIslandStatusBtn'),
            dynamicIslandStatusEyebrow: dom.window.document.getElementById('dynamicIslandStatusEyebrow'),
            dynamicIslandStatusText: dom.window.document.getElementById('dynamicIslandStatusText'),
            dynamicIslandPanel: dom.window.document.getElementById('dynamicIslandPanel'),
            dynamicIslandTimerDisplay: dom.window.document.getElementById('dynamicIslandTimerDisplay'),
            dynamicIslandMinutesInput: dom.window.document.getElementById('dynamicIslandMinutesInput'),
            dynamicIslandStartBtn: dom.window.document.getElementById('dynamicIslandStartBtn'),
            dynamicIslandPauseBtn: dom.window.document.getElementById('dynamicIslandPauseBtn'),
            dynamicIslandResumeBtn: dom.window.document.getElementById('dynamicIslandResumeBtn'),
            dynamicIslandResetBtn: dom.window.document.getElementById('dynamicIslandResetBtn'),
            titlebarCurrentAgent: dom.window.document.getElementById('titlebarCurrentAgent'),
            manualNotesLibraryBtn: dom.window.document.getElementById('manualNotesLibraryBtn'),
        },
    };
}

function createHarness(overrides = {}) {
    const nowRef = { value: new Date('2026-04-15T09:05:00') };
    const intervalFns = [];
    const toastCalls = [];
    const state = {
        layout: {
            workspaceViewMode: 'overview',
            dynamicIslandExpanded: false,
            pomodoroStatus: 'idle',
            pomodoroDurationMinutes: 25,
            pomodoroRemainingMs: 25 * 60 * 1000,
            pomodoroEndsAt: null,
            ...(overrides.layout || {}),
        },
        session: {
            currentSelectedItem: { id: null, name: null },
            currentTopicId: null,
            ...(overrides.session || {}),
        },
    };
    const dom = createDynamicIslandDom();
    dom.window.innerWidth = overrides.innerWidth || 1440;
    const store = createStore(state);

    return {
        nowRef,
        intervalFns,
        toastCalls,
        store,
        window: dom.window,
        document: dom.document,
        el: dom.el,
        createControllerDeps() {
            return {
                store,
                el: dom.el,
                ui: {
                    showToastNotification: (...args) => {
                        toastCalls.push(args);
                    },
                },
                windowObj: dom.window,
                documentObj: dom.document,
                nowProvider: () => nowRef.value,
                setIntervalFn: (handler) => {
                    intervalFns.push(handler);
                    return intervalFns.length;
                },
                clearIntervalFn: () => {},
                setTimeoutFn: (handler) => {
                    handler();
                    return 1;
                },
                clearTimeoutFn: () => {},
                showSubjectWorkspace: overrides.showSubjectWorkspace || (() => {}),
            };
        },
    };
}

test('dynamic island hides clock on overview idle and shows clock plus topic chip in subject view', async () => {
    const { createDynamicIslandController } = await loadDynamicIslandModule();
    const subjectWorkspaceCalls = [];
    const harness = createHarness({
        showSubjectWorkspace: () => {
            subjectWorkspaceCalls.push('open');
        },
    });
    const controller = createDynamicIslandController(harness.createControllerDeps());

    controller.bindEvents();

    assert.equal(harness.el.dynamicIslandStatusText.textContent, '番茄钟');
    assert.equal(harness.el.dynamicIslandCurrentAgentBtn.disabled, true);

    harness.store.patchState('session', {
        currentSelectedItem: { id: 'agent-1', name: '数学' },
    });
    harness.store.patchState('layout', {
        workspaceViewMode: 'subject',
    });

    assert.equal(harness.el.dynamicIslandStatusText.textContent, '09:05');
    assert.equal(harness.el.dynamicIslandCurrentAgentBtn.disabled, false);

    harness.el.dynamicIslandCurrentAgentBtn.click();
    assert.deepEqual(subjectWorkspaceCalls, ['open']);
});

test('dynamic island pomodoro start pause resume and reset update the status text and timer display', async () => {
    const { createDynamicIslandController } = await loadDynamicIslandModule();
    const harness = createHarness({
        layout: {
            workspaceViewMode: 'subject',
        },
    });
    const controller = createDynamicIslandController(harness.createControllerDeps());

    controller.bindEvents();
    harness.el.dynamicIslandMinutesInput.value = '10';
    harness.el.dynamicIslandStartBtn.click();

    assert.equal(harness.store.getState().layout.pomodoroStatus, 'running');
    assert.equal(harness.el.dynamicIslandStatusText.textContent, '10:00');

    harness.nowRef.value = new Date('2026-04-15T09:05:01');
    harness.intervalFns[0]();
    assert.equal(harness.el.dynamicIslandStatusText.textContent, '9:59');

    harness.el.dynamicIslandPauseBtn.click();
    assert.equal(harness.store.getState().layout.pomodoroStatus, 'paused');

    harness.nowRef.value = new Date('2026-04-15T09:05:04');
    harness.intervalFns[0]();
    assert.equal(harness.el.dynamicIslandStatusText.textContent, '9:59');

    harness.el.dynamicIslandResumeBtn.click();
    harness.nowRef.value = new Date('2026-04-15T09:05:05');
    harness.intervalFns[0]();
    assert.equal(harness.el.dynamicIslandStatusText.textContent, '9:58');

    harness.el.dynamicIslandResetBtn.click();
    assert.equal(harness.store.getState().layout.pomodoroStatus, 'idle');
    assert.equal(harness.el.dynamicIslandTimerDisplay.textContent, '10:00');
    assert.equal(harness.el.dynamicIslandStatusText.textContent, '09:05');
});

test('dynamic island shows remaining time on overview when pomodoro is active and finishes with toast plus pulse', async () => {
    const { createDynamicIslandController } = await loadDynamicIslandModule();
    const harness = createHarness();
    const controller = createDynamicIslandController(harness.createControllerDeps());

    controller.bindEvents();
    harness.el.dynamicIslandMinutesInput.value = '1';
    harness.el.dynamicIslandStartBtn.click();

    assert.equal(harness.el.dynamicIslandStatusText.textContent, '1:00');

    harness.nowRef.value = new Date('2026-04-15T09:06:01');
    harness.intervalFns[0]();

    assert.equal(harness.store.getState().layout.pomodoroStatus, 'idle');
    assert.equal(harness.el.dynamicIslandStatusText.textContent, '番茄钟');
    assert.equal(harness.toastCalls.length, 1);
    assert.equal(harness.el.dynamicIsland.classList.contains('dynamic-island--pulse'), false);
});

test('dynamic island expands from the center button and closes on outside click', async () => {
    const { createDynamicIslandController } = await loadDynamicIslandModule();
    const harness = createHarness();
    const controller = createDynamicIslandController(harness.createControllerDeps());

    controller.bindEvents();
    harness.el.dynamicIslandStatusBtn.click();

    assert.equal(harness.store.getState().layout.dynamicIslandExpanded, true);
    assert.equal(harness.el.dynamicIslandPanel.getAttribute('aria-hidden'), 'false');

    harness.document.getElementById('outside').dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));

    assert.equal(harness.store.getState().layout.dynamicIslandExpanded, false);
    assert.equal(harness.el.dynamicIslandPanel.getAttribute('aria-hidden'), 'true');
});
