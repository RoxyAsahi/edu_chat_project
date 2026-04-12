# Renderer Architecture Baseline

## Current Shape
- `src/renderer/renderer.js` is the renderer shell entrypoint. It owns store creation, DOM collection, controller assembly, bootstrap wiring, and a very small set of `window.*` bridges.
- Renderer state is grouped into seven slices: `settings`, `layout`, `session`, `source`, `reader`, `notes`, `composer`.
- Controllers write through `storeView` with single-slice ownership only:
  `settings -> settings`
  `layout -> layout`
  `workspace -> session`
  `source -> source`
  `reader -> reader`
  `notes/flashcards -> notes`
  `composer -> composer`

## Transitional Rule
- `storeView` is a temporary compatibility layer for flat-state call sites.
- Do not add new `FLAT_STATE_PROPERTY_PATHS` mappings.
- Do not add new `storeView` capabilities without guardrail tests.
- New renderer code should prefer `store.getState()` plus explicit slice getter/command helpers.

## Guardrails
- `renderer.js` must stay at or below 900 lines.
- Renderer entry must not cache mutable app state with `const state = store.getState()`-style patterns.
- Controllers must keep exactly one writable slice.
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
- Keep shrinking `storeView` usage in favor of explicit slice selectors.
- Reduce `sourceController` and `messageRenderer` change surface without restarting a large file-splitting project.
- Apply the same shell/ownership discipline to `src/main/main.js`.
