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
            <div id="notesList"></div>
            <div id="dynamicIsland" class="dynamic-island dynamic-island--overview">
                <div class="dynamic-island__bar">
                    <button id="dynamicIslandStatusBtn" type="button" aria-expanded="false" aria-controls="dynamicIslandPanel">
                        <span id="dynamicIslandStatusEyebrow"></span>
                        <strong id="dynamicIslandStatusText"></strong>
                    </button>
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
            <section id="studioPomodoroPanel">
                <button id="studioPomodoroToggleBtn" type="button">
                    <span id="studioPomodoroSummaryText">25:00</span>
                </button>
                <div id="studioPomodoroBody">
                    <input id="studioPomodoroDisplayInput" type="text" value="25:00" />
                    <button id="studioPomodoroStartBtn" type="button">开始</button>
                    <button id="studioPomodoroPauseBtn" class="hidden" type="button">暂停</button>
                    <button id="studioPomodoroResumeBtn" class="hidden" type="button">继续</button>
                    <button id="studioPomodoroResetBtn" type="button">重置</button>
                </div>
            </section>
        </body>
    `, { pretendToBeVisual: true });

    return {
        window: dom.window,
        document: dom.window.document,
        el: {
            dynamicIsland: dom.window.document.getElementById('dynamicIsland'),
            dynamicIslandStatusBtn: dom.window.document.getElementById('dynamicIslandStatusBtn'),
            dynamicIslandStatusEyebrow: dom.window.document.getElementById('dynamicIslandStatusEyebrow'),
            dynamicIslandStatusText: dom.window.document.getElementById('dynamicIslandStatusText'),
            notesList: dom.window.document.getElementById('notesList'),
            dynamicIslandPanel: dom.window.document.getElementById('dynamicIslandPanel'),
            dynamicIslandTimerDisplay: dom.window.document.getElementById('dynamicIslandTimerDisplay'),
            dynamicIslandMinutesInput: dom.window.document.getElementById('dynamicIslandMinutesInput'),
            dynamicIslandStartBtn: dom.window.document.getElementById('dynamicIslandStartBtn'),
            dynamicIslandPauseBtn: dom.window.document.getElementById('dynamicIslandPauseBtn'),
            dynamicIslandResumeBtn: dom.window.document.getElementById('dynamicIslandResumeBtn'),
            dynamicIslandResetBtn: dom.window.document.getElementById('dynamicIslandResetBtn'),
            studioPomodoroSummaryText: dom.window.document.getElementById('studioPomodoroSummaryText'),
            studioPomodoroDisplayInput: dom.window.document.getElementById('studioPomodoroDisplayInput'),
            studioPomodoroStartBtn: dom.window.document.getElementById('studioPomodoroStartBtn'),
            studioPomodoroPauseBtn: dom.window.document.getElementById('studioPomodoroPauseBtn'),
            studioPomodoroResumeBtn: dom.window.document.getElementById('studioPomodoroResumeBtn'),
            studioPomodoroResetBtn: dom.window.document.getElementById('studioPomodoroResetBtn'),
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
            };
        },
    };
}

test('dynamic island shows pomodoro placeholder on overview idle', async () => {
    const { createDynamicIslandController } = await loadDynamicIslandModule();
    const harness = createHarness();
    const controller = createDynamicIslandController(harness.createControllerDeps());

    controller.bindEvents();

    assert.equal(harness.el.dynamicIslandStatusEyebrow.textContent, '专注计时');
    assert.equal(harness.el.dynamicIslandStatusText.textContent, '番茄钟');
});

test('dynamic island pomodoro start pause resume and reset update the status text and timer display', async () => {
    const { createDynamicIslandController } = await loadDynamicIslandModule();
    const harness = createHarness({
        layout: {
            workspaceViewMode: 'overview',
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
    assert.equal(harness.el.dynamicIslandStatusText.textContent, '番茄钟');
});

test('studio pomodoro start button starts the timer and swaps visible actions', async () => {
    const { createDynamicIslandController } = await loadDynamicIslandModule();
    const harness = createHarness();
    const controller = createDynamicIslandController(harness.createControllerDeps());

    controller.bindEvents();
    harness.el.studioPomodoroDisplayInput.value = '12:00';
    harness.el.studioPomodoroDisplayInput.focus();
    harness.el.studioPomodoroStartBtn.click();

    assert.equal(harness.store.getState().layout.pomodoroStatus, 'running');
    assert.equal(harness.store.getState().layout.pomodoroDurationMinutes, 12);
    assert.equal(harness.el.studioPomodoroDisplayInput.value, '12:00');
    assert.equal(harness.el.studioPomodoroStartBtn.classList.contains('hidden'), true);
    assert.equal(harness.el.studioPomodoroPauseBtn.classList.contains('hidden'), false);
    assert.equal(harness.el.studioPomodoroResetBtn.disabled, false);
});

test('studio pomodoro start button still works after the panel is reparented by notes render', async () => {
    const { createDynamicIslandController } = await loadDynamicIslandModule();
    const harness = createHarness();
    const controller = createDynamicIslandController(harness.createControllerDeps());

    controller.bindEvents();
    harness.el.notesList.appendChild(harness.document.createElement('div'));
    harness.el.notesList.innerHTML = '';
    harness.el.notesList.appendChild(harness.document.getElementById('studioPomodoroPanel'));
    harness.el.studioPomodoroStartBtn.click();

    assert.equal(harness.store.getState().layout.pomodoroStatus, 'running');
    assert.equal(harness.el.studioPomodoroStartBtn.classList.contains('hidden'), true);
    assert.equal(harness.el.studioPomodoroPauseBtn.classList.contains('hidden'), false);
});

test('studio pomodoro actions use event delegation so replaced buttons still work', async () => {
    const { createDynamicIslandController } = await loadDynamicIslandModule();
    const harness = createHarness();
    const controller = createDynamicIslandController(harness.createControllerDeps());

    controller.bindEvents();
    const replacement = harness.document.createElement('button');
    replacement.id = 'studioPomodoroStartBtn';
    replacement.type = 'button';
    replacement.textContent = '开始';
    harness.el.studioPomodoroStartBtn.replaceWith(replacement);
    replacement.click();

    assert.equal(harness.store.getState().layout.pomodoroStatus, 'running');
});

test('dynamic island expands from the status button and closes on outside click', async () => {
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
