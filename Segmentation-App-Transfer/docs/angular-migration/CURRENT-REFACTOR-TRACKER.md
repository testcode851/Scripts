# Current Refactor Completion Tracker

## Objective

Finish the framework-independent refactor while preserving the behavior and export compatibility of the original root-level `app.js`, `index.html`, and `styles.css` application.

The original three files are the behavioral baseline. Refactor work is limited to `Refactored/`.

## Status Legend

- `[x]` Implemented and verified
- `[ ]` Not yet complete
- `[~]` In progress; do not treat as complete

## Completed Foundation

- [x] Create an isolated `Refactored/` application.
- [x] Preserve the original three-file application as the comparison baseline.
- [x] Load the refactored application through an ES-module entry point.
- [x] Add a dependency-free local development server.
- [x] Extract settings defaults, presets, and normalization.
- [x] Extract reusable numeric and polygon geometry functions.
- [x] Split application state into named responsibility slices.
- [x] Add a strict compatibility facade for legacy `state.property` access.
- [x] Extract snapshot history into a reusable service.
- [x] Add a command registry and delegated core toolbar commands.
- [x] Add initial semantic HTML and keyboard-focus improvements.
- [x] Add a Node test harness and integration contract audits.
- [x] Verify the ES-module application initializes in a real headless browser.

## Remaining Work in Dependency Order

### Phase 1: Regression Baseline

- [x] Record a repeatable parity test matrix for the original and refactored applications.
- [x] Add golden fixtures for native LLNL, COCO, and legacy JSON formats.
- [x] Add deterministic tests for polygon and ellipse export payloads.
- [x] Add browser coverage for image loading, drawing, selection, undo/redo, and dialogs.

**Exit gate:** Existing behavior is captured before high-risk data-model changes.

### Phase 2: Unified Annotation Model

- [x] Add a single `annotations` collection with stable IDs.
- [x] Define polygon and ellipse annotation constructors and validators.
- [x] Change selection and vertex keys to use annotation IDs.
- [x] Migrate creation, rename, recolor, duplicate, delete, drag, and vertex-edit paths.
- [x] Remove parallel polygon/ellipse label and color arrays.
- [x] Update undo snapshots to capture the unified collection.

**Exit gate:** Runtime annotation data has one source of truth and all model tests pass.

### Phase 3: Transactional Import and Export

- [x] Create pure LLNL import/export adapters.
- [x] Create pure COCO import/export adapters.
- [x] Create a pure legacy import adapter.
- [x] Validate complete input before committing state.
- [x] Preserve current JSON field names, timing metadata, curves, colors, and ellipse behavior.
- [x] Add round-trip and invalid-input tests.

**Exit gate:** Failed imports cannot partially mutate the current document, and golden payloads match the baseline.

### Phase 4: Command-Owned Mutations

- [x] Add typed command names for every annotation mutation.
- [x] Move history recording into command execution.
- [x] Route toolbar, context-menu, keyboard, and canvas actions through the same commands.
- [x] Remove direct annotation mutations from UI event handlers.
- [x] Add command/history transaction tests.

**Exit gate:** Annotation changes and undo boundaries have one owner.

### Phase 5: Rendering Boundaries

- [x] Separate `renderCanvas` from DOM-panel rendering.
- [x] Render metadata only when image metadata changes.
- [x] Render label panels only when annotations or selection change.
- [x] Keep `requestAnimationFrame` throttling for canvas painting.
- [x] Add render invalidation tests.

**Exit gate:** Pointer movement can repaint the canvas without rebuilding unrelated DOM panels.

### Phase 6: Interaction Controllers

- [x] Extract pointer/drawing interaction handling.
- [x] Extract keyboard shortcut handling.
- [x] Extract pan and zoom control.
- [x] Extract tool-selection state transitions.
- [x] Prefer Pointer Events and pointer capture where behavior remains equivalent.
- [x] Add controller-level and browser interaction tests.

**Exit gate:** The application entry point initializes controllers rather than containing interaction algorithms.

### Phase 7: CSS and UI Boundaries

- [x] Split theme tokens and base rules.
- [x] Split layout rules.
- [x] Split toolbar/tool-strip rules.
- [x] Split canvas/overlay rules.
- [x] Split panels and dialog rules.
- [x] Replace remaining behavior-specific ID selectors with component classes where safe.
- [x] Preserve the current rendered layout at supported breakpoints.

**Exit gate:** Styles have explicit ownership and visual parity is verified.

### Phase 8: Final Verification

- [x] Run all unit and contract tests.
- [x] Run syntax checks across every JavaScript module.
- [x] Run the browser parity matrix against original and refactored applications.
- [x] Compare LLNL and COCO JSON output.
- [x] Compare normal and inverted binary masks.
- [x] Confirm keyboard, dialog, focus, zoom, pan, and responsive behavior.
- [x] Verify simulated pen/stylus Pointer Events across the primary drawing workflow.
- [ ] Verify touch, physical stylus, and physical middle-button input on real hardware. *(Deferred: hardware unavailable.)*
- [x] Remove the compatibility state facade after no consumers remain.
- [x] Update all refactor and Angular-readiness documentation.

**Exit gate:** The refactored application has no known behavior differences from the original baseline.

## Angular Readiness

- [x] Unified annotations with stable IDs
- [x] Transactional and tested format adapters
- [x] Command-owned mutations and history
- [x] Independent canvas and DOM rendering
- [x] Extracted interaction controllers
- [x] Regression fixtures and browser tests
- [x] No remaining compatibility facade

The automated Angular-readiness gate is complete. Physical-device verification remains deferred until suitable hardware is available and should be completed before production release.

## Change Log

### Foundation — completed before this tracker

- Created the isolated application and ES-module runtime.
- Extracted settings, geometry, state, history, and command infrastructure.
- Added 14 passing unit and contract tests.
- Added HTTP and real-browser initialization verification.

### Current completion pass

- Created this gated tracker.
- Confirmed the original root application files remain outside the refactor scope.
- Confirmed all 14 baseline refactor tests pass before further changes.
- Replaced parallel polygon, ellipse, label, and color arrays with a unified stable-ID annotation model.
- Migrated creation, selection, rename, recolor, duplicate, delete, drag, vertex edit, history, rendering, masks, and format paths to the unified model.
- Added transactional native LLNL, COCO, and legacy import parsing.
- Added pure deterministic LLNL and COCO export adapters.
- Added golden format fixtures, invalid-input tests, and a native export/import round-trip test.
- Split canvas painting from invalidated metadata and label-panel rendering.
- Split the stylesheet into nine ordered ownership modules and retained `styles.css` as a compatibility entry point.
- Replaced remaining behavior-specific CSS ID selectors with component classes.
- Added a repeatable real-browser smoke scenario and parity matrix.
- Verified PNG loading, three drawing tools, label commits, selection, duplicate, undo/redo, dialogs, focus, zoom, mask polarity, and mask filenames in both applications.
- Added atomic invalid-import browser coverage for the refactored application.
- Fixed Escape handling so the shortcuts modal closes while a drawing tool is active.
- Expanded the automated suite from 14 to 33 unit/contract tests before final verification.
- Added a centralized command-name catalog for annotation, document, history, and UI actions.
- Made the command registry history-aware with transactional rollback on failure.
- Made nested mutations share one outer undo boundary.
- Routed creation, rename, recolor, duplicate, delete, import replacement, vertex changes, and geometry editing through commands.
- Removed the remaining `pushUndo()` compatibility calls from application code.
- Routed keyboard, toolbar, context-menu, label, and canvas mutation paths through the same registry.
- Added command transaction, rollback, nested-boundary, and command-ownership contract tests.
- Re-ran the full browser smoke scenario successfully after the command migration.
- Added keyboard, pointer/drawing, tool-transition, and view/pan/zoom controllers.
- Changed canvas drawing from mouse-only listeners to Pointer Events with pointer capture.
- Added `touch-action: none` to the drawing canvas so touch and pen input reach the pointer controller.
- Moved controller state access to the named image, interaction, and view slices.
- Added eight controller unit tests plus controller-boundary contract tests, bringing the suite to 43 tests.
- Extended browser smoke coverage to use Pointer Events and verify middle-button pan start/end behavior.
- Re-ran syntax checks across 30 JavaScript modules and the complete browser parity scenario successfully.
- Fixed ellipse labels leaking into the next polygon or rectangle label default.
- Added type-specific polygon and ellipse label memory, including undo/redo snapshot coverage.
- Added three label-memory unit tests and an ellipse-to-polygon browser regression assertion.
- Verified 46 tests, 32 JavaScript modules, and the full browser smoke scenario after the label fix.
- Changed new-shape labels to deterministic tool defaults: `polygon`, `rectangle`, and `ellipse`.
- Added unit and browser assertions covering the visible default for every drawing tool.
- Verified 47 tests, 32 JavaScript modules, and the full browser smoke scenario after the tool-default fix.
- Added a repeatable responsive-browser smoke test covering 1600, 1301, 1300, 1100, 961, 960, and 480 pixel widths.
- Verified the three-column, two-column, and single-column layout modes at their exact CSS boundaries.
- Confirmed toolbar fit, primary-region visibility, document width, component ordering, and zero horizontal overflow at every tested width.
- Visually reviewed representative 1600px, 1100px, and 480px screenshots; no responsive CSS changes were required.
- Parameterized the browser smoke workflow to run canvas interactions as mouse, pen, or touch Pointer Events.
- Ran the complete workflow with `pointerType="pen"`, pressure, and tilt values across rectangle, ellipse, and polygon creation.
- Verified stylus labeling, selection/history workflow, exports, `touch-action: none`, and pointer-capture/release behavior.
- Kept physical stylus verification open because a simulated pointer cannot validate digitizer or browser-driver behavior.
- Deferred the real touch, stylus, and middle-button check because matching hardware is unavailable.
- Removed the flat compatibility state Proxy and migrated all application consumers to explicit image, annotation, interaction, view, settings, and UI slices.
- Added state ownership contract tests that reject undeclared cross-slice references and duplicate key ownership.
- Re-verified 47 tests, syntax across 33 JavaScript modules, all seven responsive breakpoints, and the complete mouse and simulated-pen browser workflows.

## Next Steps in Order

1. Begin Stage 2 of the Angular migration in a separate application folder.
2. Test touch input, a physical stylus, and a physical middle-button pan interaction when suitable hardware is available.
