const test = require('node:test');
const assert = require('assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const { JSDOM } = require('jsdom');

async function createHarness(t, messageCount = 1) {
    const messages = Array.from({ length: messageCount }, (_value, index) => `
        <article class="message-item" data-message-id="m${index}">
            <div class="md-content">
                <canvas></canvas>
                <video></video>
                <svg></svg>
                <img src="spin.gif">
            </div>
        </article>
    `).join('');
    const dom = new JSDOM(`<!doctype html><html><body>
        <main id="chatContainer">${messages}</main>
    </body></html>`, {
        pretendToBeVisual: true,
        url: 'http://localhost',
    });
    const previousGlobals = {
        cancelAnimationFrame: global.cancelAnimationFrame,
        document: global.document,
        Element: global.Element,
        HTMLElement: global.HTMLElement,
        IntersectionObserver: global.IntersectionObserver,
        MutationObserver: global.MutationObserver,
        requestAnimationFrame: global.requestAnimationFrame,
        window: global.window,
    };
    const previousGetAnimations = dom.window.Element.prototype.getAnimations;
    const previousConsoleDebug = console.debug;
    console.debug = () => {};

    const observed = new Set();
    global.window = dom.window;
    global.document = dom.window.document;
    global.Element = dom.window.Element;
    global.HTMLElement = dom.window.HTMLElement;
    global.MutationObserver = dom.window.MutationObserver;
    global.IntersectionObserver = class IntersectionObserver {
        constructor(callback) {
            this.callback = callback;
        }
        observe(element) {
            observed.add(element);
        }
        unobserve(element) {
            observed.delete(element);
        }
        disconnect() {
            observed.clear();
        }
    };
    global.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
    global.cancelAnimationFrame = () => {};
    dom.window.IntersectionObserver = global.IntersectionObserver;
    dom.window.requestAnimationFrame = global.requestAnimationFrame;
    dom.window.cancelAnimationFrame = global.cancelAnimationFrame;
    dom.window.Element.prototype.getAnimations = () => [];

    const modulePath = path.resolve(__dirname, '../src/modules/renderer/visibilityOptimizer.js');
    const visibilityOptimizer = await import(`${pathToFileURL(modulePath).href}?visibilityTest=${Date.now()}${Math.random()}`);
    const chatContainer = dom.window.document.getElementById('chatContainer');
    visibilityOptimizer.initializeVisibilityOptimizer(chatContainer);

    t.after(() => {
        visibilityOptimizer.destroyVisibilityOptimizer();
        if (previousGetAnimations === undefined) {
            delete dom.window.Element.prototype.getAnimations;
        } else {
            dom.window.Element.prototype.getAnimations = previousGetAnimations;
        }
        dom.window.close();
        console.debug = previousConsoleDebug;
        Object.entries(previousGlobals).forEach(([key, value]) => {
            if (value === undefined) {
                delete global[key];
            } else {
                global[key] = value;
            }
        });
    });

    return {
        chatContainer,
        dom,
        message: chatContainer.querySelector('.message-item'),
        visibilityOptimizer,
    };
}

test('visibilityOptimizer pauses, resumes, and cleans dynamic resources', async (t) => {
    const { dom, message, visibilityOptimizer } = await createHarness(t);
    const canvas = message.querySelector('canvas');
    const media = message.querySelector('video');
    const svg = message.querySelector('svg');
    let mediaPaused = false;
    let svgPaused = false;
    let canvasPaused = false;
    let canvasResumed = false;
    let disposed = false;
    let threeLoopResumed = false;
    let animationCancelled = false;

    Object.defineProperty(media, 'paused', {
        configurable: true,
        get: () => mediaPaused,
    });
    media.pause = () => {
        mediaPaused = true;
    };
    media.play = () => {
        mediaPaused = false;
        return Promise.resolve();
    };
    svg.pauseAnimations = () => {
        svgPaused = true;
    };
    svg.unpauseAnimations = () => {
        svgPaused = false;
    };

    const webAnimation = {
        playState: 'running',
        pause() {
            this.playState = 'paused';
        },
        play() {
            this.playState = 'running';
        },
        cancel() {
            animationCancelled = true;
            this.playState = 'idle';
        },
    };
    message.getAnimations = () => [webAnimation];

    const animeInstance = {
        paused: false,
        pause() {
            this.paused = true;
        },
        play() {
            this.paused = false;
        },
    };
    const renderer = {
        setAnimationLoop(value) {
            this.animationLoop = value;
        },
        dispose() {
            disposed = true;
        },
    };
    dom.window.cancelAnimationFrame = global.cancelAnimationFrame = () => {};

    visibilityOptimizer.registerAnimeInstance(message, animeInstance);
    visibilityOptimizer.registerThreeContext(message, {
        animationId: 123,
        renderer,
        renderLoop() {
            threeLoopResumed = true;
        },
    });
    visibilityOptimizer.registerCanvasAnimation(message, {
        canvas,
        pauseCallback() {
            canvasPaused = true;
        },
        resumeCallback() {
            canvasResumed = true;
        },
    });

    let snapshot = visibilityOptimizer.getVisibilityOptimizerDebugSnapshot();
    assert.equal(snapshot.observedMessages, 1);
    assert.equal(snapshot.animeInstances, 1);
    assert.equal(snapshot.threeContexts, 1);
    assert.equal(snapshot.canvasContexts, 1);

    visibilityOptimizer.pauseMessageAnimations(message);
    snapshot = visibilityOptimizer.getVisibilityOptimizerDebugSnapshot();
    assert.equal(snapshot.pausedMessages, 1);
    assert.equal(webAnimation.playState, 'paused');
    assert.equal(animeInstance.paused, true);
    assert.equal(renderer.animationLoop, null);
    assert.equal(canvasPaused, true);
    assert.equal(canvas.dataset.renderPaused, 'true');
    assert.equal(mediaPaused, true);
    assert.equal(svgPaused, true);
    assert.equal(message.querySelector('img').style.visibility, 'hidden');

    visibilityOptimizer.resumeMessageAnimations(message);
    snapshot = visibilityOptimizer.getVisibilityOptimizerDebugSnapshot();
    assert.equal(snapshot.pausedMessages, 0);
    assert.equal(webAnimation.playState, 'running');
    assert.equal(animeInstance.paused, false);
    assert.equal(threeLoopResumed, true);
    assert.equal(canvasResumed, true);
    assert.equal(canvas.dataset.renderPaused, undefined);
    assert.equal(mediaPaused, false);
    assert.equal(svgPaused, false);
    assert.equal(message.querySelector('img').style.visibility, 'visible');

    visibilityOptimizer.unobserveMessage(message);
    snapshot = visibilityOptimizer.getVisibilityOptimizerDebugSnapshot();
    assert.equal(snapshot.observedMessages, 0);
    assert.equal(disposed, true);
    assert.equal(animationCancelled, true);
});

test('visibilityOptimizer debug snapshot stays bounded across long chat cleanup', async (t) => {
    const { chatContainer, visibilityOptimizer } = await createHarness(t, 80);
    const messages = [...chatContainer.querySelectorAll('.message-item')];

    let snapshot = visibilityOptimizer.getVisibilityOptimizerDebugSnapshot();
    assert.equal(snapshot.observedMessages, 80);

    messages.forEach((message, index) => {
        if (index % 2 === 0) {
            visibilityOptimizer.pauseMessageAnimations(message);
        }
    });
    snapshot = visibilityOptimizer.getVisibilityOptimizerDebugSnapshot();
    assert.equal(snapshot.pausedMessages, 40);
    assert.ok(snapshot.canvasContexts >= 40 && snapshot.canvasContexts <= 80);
    assert.ok(snapshot.mediaElements >= 40 && snapshot.mediaElements <= 80);
    assert.ok(snapshot.svgElements >= 40 && snapshot.svgElements <= 80);
    assert.ok(snapshot.gifImages >= 40 && snapshot.gifImages <= 80);

    messages.forEach((message) => visibilityOptimizer.unobserveMessage(message));
    snapshot = visibilityOptimizer.getVisibilityOptimizerDebugSnapshot();
    assert.equal(snapshot.observedMessages, 0);
    assert.equal(snapshot.canvasContexts, 0);
    assert.equal(snapshot.pendingPause, 0);
    assert.equal(snapshot.pendingResume, 0);
});
