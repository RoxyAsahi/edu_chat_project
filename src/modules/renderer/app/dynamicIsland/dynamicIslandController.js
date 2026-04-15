function clampPomodoroMinutes(value, fallback = 25) {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue)) {
        return fallback;
    }
    return Math.min(180, Math.max(1, Math.round(nextValue)));
}

function formatDigitalClock(date = new Date()) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

function formatPomodoroRemaining(ms = 0) {
    const totalSeconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function createDynamicIslandController(deps = {}) {
    const store = deps.store;
    const el = deps.el;
    const ui = deps.ui || {};
    const windowObj = deps.windowObj || window;
    const documentObj = deps.documentObj || document;
    const nowProvider = deps.nowProvider || (() => new Date());
    const setIntervalFn = deps.setIntervalFn || ((handler, timeout) => windowObj.setInterval(handler, timeout));
    const clearIntervalFn = deps.clearIntervalFn || ((timerId) => windowObj.clearInterval(timerId));
    const setTimeoutFn = deps.setTimeoutFn || ((handler, timeout) => windowObj.setTimeout(handler, timeout));
    const clearTimeoutFn = deps.clearTimeoutFn || ((timerId) => windowObj.clearTimeout(timerId));

    let tickTimerId = null;
    let pulseTimerId = null;
    let releaseLayoutSubscription = null;
    let releaseSessionSubscription = null;

    function getLayoutSlice() {
        return store.getState().layout || {};
    }

    function getSessionSlice() {
        return store.getState().session || {};
    }

    function patchLayout(patch) {
        return store.patchState('layout', (current, rootState) => ({
            ...current,
            ...(typeof patch === 'function' ? patch(current, rootState) : patch),
        }));
    }

    function isOverviewMode() {
        return getLayoutSlice().workspaceViewMode !== 'subject';
    }

    function isPomodoroActive(status = getLayoutSlice().pomodoroStatus) {
        return status === 'running' || status === 'paused';
    }

    function getConfiguredDurationMs(layout = getLayoutSlice()) {
        return clampPomodoroMinutes(layout.pomodoroDurationMinutes, 25) * 60 * 1000;
    }

    function getPomodoroRemainingMs(layout = getLayoutSlice(), currentTime = nowProvider()) {
        if (layout.pomodoroStatus === 'running' && Number.isFinite(layout.pomodoroEndsAt)) {
            return Math.max(0, Number(layout.pomodoroEndsAt) - currentTime.getTime());
        }
        if (Number.isFinite(layout.pomodoroRemainingMs)) {
            return Math.max(0, Number(layout.pomodoroRemainingMs));
        }
        return getConfiguredDurationMs(layout);
    }

    function syncDurationInput(layout = getLayoutSlice()) {
        if (!el.dynamicIslandMinutesInput) {
            return;
        }
        const nextMinutes = clampPomodoroMinutes(layout.pomodoroDurationMinutes, 25);
        if (String(nextMinutes) !== el.dynamicIslandMinutesInput.value) {
            el.dynamicIslandMinutesInput.value = String(nextMinutes);
        }
        el.dynamicIslandMinutesInput.disabled = layout.pomodoroStatus === 'running';
    }

    function pulseIsland() {
        if (!el.dynamicIsland) {
            return;
        }
        el.dynamicIsland.classList.add('dynamic-island--pulse');
        if (pulseTimerId != null) {
            clearTimeoutFn(pulseTimerId);
        }
        pulseTimerId = setTimeoutFn(() => {
            el.dynamicIsland?.classList.remove('dynamic-island--pulse');
            pulseTimerId = null;
        }, 1200);
    }

    function getStatusPresentation(layout = getLayoutSlice(), currentTime = nowProvider()) {
        if (layout.pomodoroStatus === 'running') {
            return {
                eyebrow: '专注中',
                text: formatPomodoroRemaining(getPomodoroRemainingMs(layout, currentTime)),
                isPlaceholder: false,
            };
        }
        if (layout.pomodoroStatus === 'paused') {
            return {
                eyebrow: '已暂停',
                text: formatPomodoroRemaining(getPomodoroRemainingMs(layout, currentTime)),
                isPlaceholder: false,
            };
        }
        if (isOverviewMode()) {
            return {
                eyebrow: '专注计时',
                text: '番茄钟',
                isPlaceholder: true,
            };
        }
        return {
            eyebrow: '当前时间',
            text: formatDigitalClock(currentTime),
            isPlaceholder: false,
        };
    }

    function render() {
        const layout = getLayoutSlice();
        const currentTime = nowProvider();
        const presentation = getStatusPresentation(layout, currentTime);
        const remainingMs = getPomodoroRemainingMs(layout, currentTime);

        if (!el.dynamicIsland) {
            return;
        }

        el.dynamicIsland.classList.toggle('dynamic-island--expanded', layout.dynamicIslandExpanded === true);
        el.dynamicIsland.classList.toggle('dynamic-island--active', isPomodoroActive(layout.pomodoroStatus));
        el.dynamicIsland.classList.toggle('dynamic-island--overview-idle', isOverviewMode() && layout.pomodoroStatus === 'idle');

        if (el.dynamicIslandStatusBtn) {
            el.dynamicIslandStatusBtn.setAttribute('aria-expanded', layout.dynamicIslandExpanded === true ? 'true' : 'false');
        }
        if (el.dynamicIslandPanel) {
            el.dynamicIslandPanel.setAttribute('aria-hidden', layout.dynamicIslandExpanded === true ? 'false' : 'true');
        }
        if (el.dynamicIslandStatusEyebrow) {
            el.dynamicIslandStatusEyebrow.textContent = presentation.eyebrow;
        }
        if (el.dynamicIslandStatusText) {
            el.dynamicIslandStatusText.textContent = presentation.text;
            el.dynamicIslandStatusText.classList.toggle('is-placeholder', presentation.isPlaceholder);
        }
        if (el.dynamicIslandTimerDisplay) {
            el.dynamicIslandTimerDisplay.textContent = formatPomodoroRemaining(remainingMs);
        }
        if (el.dynamicIslandPauseBtn) {
            el.dynamicIslandPauseBtn.classList.toggle('hidden', layout.pomodoroStatus !== 'running');
        }
        if (el.dynamicIslandResumeBtn) {
            el.dynamicIslandResumeBtn.classList.toggle('hidden', layout.pomodoroStatus !== 'paused');
        }
        if (el.dynamicIslandStartBtn) {
            el.dynamicIslandStartBtn.classList.toggle('hidden', layout.pomodoroStatus === 'running' || layout.pomodoroStatus === 'paused');
        }
        if (el.dynamicIslandResetBtn) {
            el.dynamicIslandResetBtn.disabled = layout.pomodoroStatus === 'idle' && remainingMs === getConfiguredDurationMs(layout);
        }

        syncDurationInput(layout);
    }

    function setExpanded(expanded) {
        patchLayout({ dynamicIslandExpanded: expanded === true });
    }

    function toggleExpanded() {
        setExpanded(!getLayoutSlice().dynamicIslandExpanded);
    }

    function syncDurationFromInput() {
        if (!el.dynamicIslandMinutesInput) {
            return getLayoutSlice().pomodoroDurationMinutes || 25;
        }
        const layout = getLayoutSlice();
        const nextMinutes = clampPomodoroMinutes(el.dynamicIslandMinutesInput.value, layout.pomodoroDurationMinutes || 25);
        el.dynamicIslandMinutesInput.value = String(nextMinutes);
        patchLayout((current) => {
            const nextPatch = {
                pomodoroDurationMinutes: nextMinutes,
            };
            if (current.pomodoroStatus !== 'running') {
                nextPatch.pomodoroRemainingMs = nextMinutes * 60 * 1000;
                nextPatch.pomodoroEndsAt = null;
            }
            return nextPatch;
        });
        return nextMinutes;
    }

    function startPomodoro() {
        const durationMinutes = syncDurationFromInput();
        const now = nowProvider();
        const durationMs = durationMinutes * 60 * 1000;
        patchLayout({
            pomodoroStatus: 'running',
            pomodoroDurationMinutes: durationMinutes,
            pomodoroRemainingMs: durationMs,
            pomodoroEndsAt: now.getTime() + durationMs,
        });
    }

    function pausePomodoro() {
        const layout = getLayoutSlice();
        const remainingMs = getPomodoroRemainingMs(layout, nowProvider());
        patchLayout({
            pomodoroStatus: 'paused',
            pomodoroRemainingMs: remainingMs,
            pomodoroEndsAt: null,
        });
    }

    function resumePomodoro() {
        const layout = getLayoutSlice();
        const remainingMs = getPomodoroRemainingMs(layout, nowProvider());
        const now = nowProvider();
        patchLayout({
            pomodoroStatus: 'running',
            pomodoroRemainingMs: remainingMs,
            pomodoroEndsAt: now.getTime() + remainingMs,
        });
    }

    function resetPomodoro() {
        const layout = getLayoutSlice();
        const durationMs = getConfiguredDurationMs(layout);
        patchLayout({
            pomodoroStatus: 'idle',
            pomodoroRemainingMs: durationMs,
            pomodoroEndsAt: null,
        });
    }

    function handleTick() {
        const layout = getLayoutSlice();
        if (layout.pomodoroStatus !== 'running') {
            render();
            return;
        }

        const remainingMs = getPomodoroRemainingMs(layout, nowProvider());
        if (remainingMs <= 0) {
            patchLayout({
                pomodoroStatus: 'idle',
                pomodoroRemainingMs: getConfiguredDurationMs(layout),
                pomodoroEndsAt: null,
            });
            pulseIsland();
            ui.showToastNotification?.('番茄钟结束了，休息一下吧。', 'success');
            render();
            return;
        }

        if (remainingMs !== layout.pomodoroRemainingMs) {
            patchLayout({
                pomodoroRemainingMs: remainingMs,
            });
            return;
        }

        render();
    }

    function ensureTicker() {
        if (tickTimerId != null) {
            return;
        }
        tickTimerId = setIntervalFn(() => {
            handleTick();
        }, 1000);
    }

    function bindEvents() {
        const ElementCtor = windowObj.Element || globalThis.Element;

        releaseLayoutSubscription?.();
        releaseSessionSubscription?.();
        releaseLayoutSubscription = store.subscribe('layout', () => render());
        releaseSessionSubscription = store.subscribe('session', () => render());

        el.dynamicIslandStatusBtn?.addEventListener('click', (event) => {
            event.stopPropagation();
            toggleExpanded();
        });
        el.dynamicIslandPanel?.addEventListener('click', (event) => {
            event.stopPropagation();
        });
        el.dynamicIslandMinutesInput?.addEventListener('input', () => {
            syncDurationFromInput();
        });
        el.dynamicIslandMinutesInput?.addEventListener('blur', () => {
            syncDurationFromInput();
        });
        el.dynamicIslandStartBtn?.addEventListener('click', () => {
            startPomodoro();
        });
        el.dynamicIslandPauseBtn?.addEventListener('click', () => {
            pausePomodoro();
        });
        el.dynamicIslandResumeBtn?.addEventListener('click', () => {
            resumePomodoro();
        });
        el.dynamicIslandResetBtn?.addEventListener('click', () => {
            resetPomodoro();
        });
        documentObj.addEventListener('click', (event) => {
            if (!getLayoutSlice().dynamicIslandExpanded) {
                return;
            }
            const target = event.target;
            if (target instanceof ElementCtor && target.closest('#dynamicIsland')) {
                return;
            }
            setExpanded(false);
        });
        documentObj.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && getLayoutSlice().dynamicIslandExpanded) {
                setExpanded(false);
            }
        });
        windowObj.addEventListener('resize', () => {
            render();
        });

        ensureTicker();
        render();
    }

    return {
        bindEvents,
        formatDigitalClock,
        formatPomodoroRemaining,
        pausePomodoro,
        render,
        resetPomodoro,
        resumePomodoro,
        setExpanded,
        startPomodoro,
        syncDurationFromInput,
        toggleExpanded,
    };
}

export {
    clampPomodoroMinutes,
    formatDigitalClock,
    formatPomodoroRemaining,
    createDynamicIslandController,
};
