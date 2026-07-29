# Segmentation Annotator Refactor

## Purpose

This folder is an isolated refactor of the application in the repository root. The original application files were not modified. The refactored copy starts from the current working versions of `app.js`, `index.html`, and `styles.css`.

## Running the application

ES modules must be loaded through HTTP rather than by double-clicking `index.html`:

```powershell
cd Refactored
npm.cmd run dev
```

Open <http://127.0.0.1:4173>.

No third-party packages are required. The development server uses Node's standard library.

## Testing

```powershell
cd Refactored
npm.cmd test
npm.cmd run check
```

With the development server and a CDP-enabled browser running, responsive layout checks are also available through `npm.cmd run test:responsive`.

The main browser smoke workflow accepts `POINTER_TYPE=pen` to repeat drawing with simulated stylus Pointer Events. Physical-device verification remains a manual gate.

The tests cover settings normalization, geometry, the unified annotation model, all supported JSON formats, deterministic exports, state ownership, snapshot history, commands, interaction controllers, render invalidation, DOM contracts, stylesheet ownership, and responsive breakpoint contracts.

The repeatable browser workflow and original/refactored results are documented in [`docs/angular-migration/PARITY-MATRIX.md`](docs/angular-migration/PARITY-MATRIX.md).

## Implemented architecture

### ES module entry point

`index.html` now loads `src/app.js` as an ES module. Extracted modules have explicit imports and exports instead of relying on additional globals.

### Settings boundary

`src/config/settings.js` owns defaults, presets, and validation. `normalizeSettings` is now pure and testable.

### Explicit state slices

`src/state/create-app-state.js` divides state into:

- image
- annotations
- interaction
- view
- settings
- UI

All application code and interaction controllers consume the named slices directly. The temporary flat `state.property` Proxy has been removed. Contract tests verify that each referenced property belongs to the correct slice and that state keys have only one owner.

### Unified annotation model

`src/model/annotation.js` owns polygon and ellipse records. Every annotation has a stable ID, type, label, color, and geometry. Selection, vertex ownership, history, rendering, imports, and exports use this collection instead of synchronized parallel arrays.

### Transactional format boundary

`src/io/annotation-document.js` parses native LLNL, COCO, and legacy JSON into a complete candidate document before application state changes. `src/io/annotation-export.js` creates deterministic LLNL and COCO payloads. Invalid input cannot partially clear the active document.

### Reusable history service

`src/state/snapshot-history.js` owns undo and redo stacks, capacity limits, and restoration callbacks. Feature code retains small compatibility functions while mutation commands are introduced.

### Command registry

`src/commands/command-registry.js` provides one dispatch point for toolbar and context-menu commands. Core toolbar buttons use `data-command` attributes and delegated event handling, reducing DOM references and repeated listeners.

### Pure polygon geometry

`src/geometry/polygon.js` now owns point cloning, curve sampling, curve metadata, bounding boxes, polygon areas, and COCO segment parsing. `src/geometry/math.js` owns shared numeric helpers.

### HTML and CSS cleanup

- The top action area and drawing tools now expose toolbar semantics.
- The canvas is keyboard focusable and labelled.
- Core toolbar actions use `data-command` attributes.
- A missing `--button-bg` token is defined.
- Shared `:focus-visible` styles were added.
- Four repeated hidden-element declarations were replaced by one rule.
- Styles are divided into token, base, toolbar, layout, tool-strip, canvas, panel, dialog, and responsive modules.
- Behavior-specific ID selectors were replaced with component classes.

### Rendering boundary

Canvas painting is requestAnimationFrame-throttled in `renderCanvas`. Metadata, load status, and label panels render independently and use keyed invalidation so pointer movement does not rebuild unrelated DOM.

### Interaction controllers

`src/controllers/` now owns global keyboard policy, canvas pointer/drawing behavior, tool transitions, and view pan/zoom math. Canvas input uses Pointer Events and pointer capture, while controllers read named state slices directly.

### Regression coverage

Golden LLNL, COCO, and legacy fixtures live in `tests/fixtures`. The browser smoke script exercises PNG loading, Pointer Event drawing, all drawing tools, labeling, selection, duplicate, undo/redo, dialogs, focus, zoom, middle-button pan lifecycle, masks, and import failure behavior.

## Compatibility notes

- Existing export formats and JSON structures are unchanged.
- Existing visual layout is intentionally preserved.
- Invalid imports now leave the active document untouched.
- Escape now closes the shortcuts modal even when a drawing tool is active.
- New shapes default to the selected tool name: `polygon`, `rectangle`, or `ellipse`.
- Automated responsive, mouse, and simulated-pen verification is complete. Physical touch, stylus, and middle-button checks are deferred until matching hardware is available.
- The temporary state compatibility Proxy has been removed.

## Recommended next phases

The detailed prerequisites and staged Angular plan are documented in [`docs/angular-migration/README.md`](docs/angular-migration/README.md).
Live completion status and the refactor change log are maintained in [`docs/angular-migration/CURRENT-REFACTOR-TRACKER.md`](docs/angular-migration/CURRENT-REFACTOR-TRACKER.md).

1. Begin the separate Angular application while preserving this version as the parity baseline.
2. Complete physical touch/pen/middle-button verification when hardware is available.
3. Profile image analysis and move it to a Web Worker if large images block interaction.
