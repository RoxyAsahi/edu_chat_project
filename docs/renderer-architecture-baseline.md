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

## Guardrails
- `renderer.js` must stay at or below 900 lines.
- Renderer entry must not cache mutable app state with `const state = store.getState()`-style patterns.
- Controllers must keep exactly one writable slice.
- Retired compatibility paths must stay retired: no `storeView.js`, no `createStoreView(...)`, and no `FLAT_STATE_PROPERTY_PATHS`.
- Renderer global surface must stay within the three approved bridges.
- Shared CSS scoping for message rendering must continue to route through `scopedCss.js`.

## Test Entry Points
- `npm run test:main`
  Main-process and shared node tests.
- `npm run test:renderer:logic`
  Renderer architecture and pure-logic node tests under `tests/renderer-*.test.js`.
- `npm run test:renderer:dom`
  Jsdom/vitest renderer DOM tests.
- `npm run test:renderer`
  Runs both renderer logic and renderer DOM tests.

## Follow-up Priorities
- Reduce `notesController` surface into clearer model, DOM, and operations layers without changing renderer behavior.
- Reduce message-pipeline change surface across `messageRenderer`, `streamManager`, and `messageContextMenu`, and add direct tests around that hot path.
- Keep renderer docs and test fixtures aligned with the current ownership and guardrail baseline so retired compatibility layers do not leak back in.
