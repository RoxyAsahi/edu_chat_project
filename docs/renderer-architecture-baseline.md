# Renderer Architecture Baseline

## Current Shape
- `src/renderer/renderer.js` is the renderer shell entrypoint. It owns store creation, DOM collection, controller assembly, bootstrap wiring, and a very small set of `window.*` bridges.
- Renderer state is grouped into seven slices: `settings`, `layout`, `session`, `source`, `reader`, `notes`, `composer`.
- Store ownership convergence has landed. Controllers read through `store.getState()` plus local selectors/helpers and keep single-slice write ownership:
  `settings -> settings`
  `layout -> layout`
  `workspace -> session`
  `source -> source`
  `reader -> reader`
  `notes/flashcards -> notes`
  `composer -> composer`
- Renderer global bridges are limited to `window.sendMessage`, `window.updateSendButtonState`, and `window.__unistudyDebugState`.
- `sourceController` surface reduction and main-process lifecycle hardening are part of the current mainline shape.
- Current-topic history watcher updates use message-id diff sync where safe, with active streaming and edit-state protection before falling back to a full topic reload.

## Rendering Baseline
- Streaming messages are organized as native reasoning, stable content, and active tail roots. Reasoning-only deltas update only the reasoning root.
- Bare HTML fragments can render inline during streaming; final message rendering is performed once through the high-fidelity message renderer and scoped CSS pipeline.
- HTML code-block preview and Three.js preview run in iframe-based preview containers with loading, ready, error, resize, and teardown handling.
- Runtime DOM replacement must preserve stateful controls, active previews, focused form controls, and playing media where possible.
- Visibility optimization owns pause, resume, cleanup, and debug snapshots for long-chat resources such as animations, media, canvas, and Three.js scenes.

## Guardrails
- `renderer.js` must stay at or below 900 lines.
- Renderer entry must not cache mutable app state with `const state = store.getState()`-style patterns.
- Controllers must keep exactly one writable slice.
- Retired compatibility paths must stay retired: no `storeView.js`, no `createStoreView(...)`, and no `FLAT_STATE_PROPERTY_PATHS`.
- Renderer global surface must stay within the three approved bridges.
- Shared CSS scoping for message rendering must continue to route through `scopedCss.js`.
- DOM-node caches used by streaming morphdom must not strongly retain discarded nodes; use `WeakMap` unless iteration is required.
- Preview iframe, animation, media, canvas, and generated object URL lifecycles must be cleaned up before DOM replacement, message removal, modal close, or page unload.
- Watcher-driven history sync must not overwrite the active streaming message or a message currently in edit mode.

## Test Entry Points
- `npm run test:main`
  Main-process and shared node tests.
- `npm run test:renderer:logic`
  Renderer architecture and pure-logic node tests under `tests/renderer-*.test.js`.
- `npm run test:renderer:dom`
  Jsdom/vitest renderer DOM tests.
- `npm run test:renderer`
  Runs both renderer logic and renderer DOM tests.
- `tests/renderer-stream-manager.test.js`
  Covers streaming roots, reasoning deltas, inline HTML, state preservation, and finalization.
- `tests/renderer-html-preview.test.js`
  Covers HTML / Three preview creation, teardown, diagnostics, and protected blocks.
- `tests/renderer-visibility-optimizer.test.js`
  Covers pause, resume, cleanup, and debug snapshots for long-chat resources.

## Follow-up Priorities
- Reduce `notesController` surface into clearer model, DOM, and operations layers without changing renderer behavior.
- Keep message-pipeline changes covered by direct tests before modifying `messageRenderer`, `streamManager`, `contentProcessor`, or preview helpers.
- Keep renderer docs and test fixtures aligned with the current ownership and guardrail baseline so retired compatibility layers do not leak back in.
