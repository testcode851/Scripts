# Angular Migration Roadmap

## Purpose

This document describes what should be completed before converting the Segmentation Annotator to Angular and the recommended migration sequence afterward.

The current ES-module application should remain runnable throughout the Angular migration. The Angular version should be developed in a separate workspace folder so both versions can be compared until feature parity is confirmed.

Implementation progress for the current application is maintained in [CURRENT-REFACTOR-TRACKER.md](CURRENT-REFACTOR-TRACKER.md). A step is checked only after its exit gate and regression checks pass.

## Stage 1: Finish the Current Refactor

Complete these items before starting Angular. They reduce the amount of application behavior that must be redesigned at the same time as the framework migration.

### 1. Introduce a unified annotation model

Replace the parallel polygon, ellipse, label, and color arrays with one annotation collection containing stable IDs.

```ts
type Annotation = PolygonAnnotation | EllipseAnnotation;

interface PolygonAnnotation {
  id: string;
  type: "polygon";
  label: string;
  color: string;
  geometry: {
    points: PolygonPoint[];
  };
}
```

**Why:** Stable IDs prevent index synchronization problems and make Angular list rendering, selection, undo, and updates more reliable.

**Complete when:** Creating, selecting, renaming, duplicating, deleting, importing, and exporting annotations no longer relies on parallel arrays.

### 2. Make imports transactional

Create separate LLNL, COCO, and legacy import adapters. Each adapter should validate the complete input and return a new internal document without modifying application state.

**Why:** Invalid JSON should never leave the application in a partially modified state.

**Complete when:** Import follows `parse -> validate -> create document -> commit document` and every supported format has tests.

### 3. Move mutations behind commands

Use named commands for annotation changes, such as:

- `addAnnotation`
- `deleteAnnotation`
- `moveVertex`
- `renameAnnotation`
- `duplicateAnnotation`
- `replaceDocument`

**Why:** The command layer gives undo/redo, dirty tracking, UI actions, and keyboard shortcuts one consistent mutation path.

**Complete when:** UI event handlers do not directly modify annotation data.

### 4. Separate canvas rendering from DOM rendering

Create distinct rendering entry points for the canvas and interface panels.

```js
renderCanvas(canvasState);
renderToolbar(toolbarState);
renderLabelPanel(labelPanelState);
renderMetadata(metadataState);
```

**Why:** Angular should update HTML controls and panels, while the imperative canvas renderer should paint shapes independently.

**Complete when:** Pointer movement can repaint the canvas without rebuilding label or metadata DOM elements.

### 5. Extract interaction controllers

Move pointer, keyboard, drawing-tool, pan, zoom, and selection behavior out of the application entry file.

**Why:** Angular components can then connect to controller APIs instead of reimplementing complex input behavior.

**Complete when:** The canvas can be initialized using explicit renderer and controller dependencies.

### 6. Complete CSS boundaries

Split global styling into tokens, base styles, layout, and component styles.

```text
styles/
  tokens.css
  base.css
  layout.css
  toolbar.css
  canvas.css
  panels.css
  dialogs.css
```

**Why:** These files map naturally to Angular global styles and component-scoped styles.

**Complete when:** Component styles do not depend on unrelated ID selectors or end-of-file overrides.

### 7. Establish regression coverage

Add tests for:

- Annotation commands and history
- LLNL and COCO import/export round trips
- Polygon and ellipse geometry
- Image loading
- Drawing, selection, and vertex editing
- Keyboard shortcuts
- Mask export
- Dialog and accessibility behavior

**Why:** The existing version becomes the behavioral specification for the Angular migration.

**Complete when:** Unit tests cover pure logic and browser tests cover the primary user workflows.

## Angular Readiness Gate

Start the Angular application after all of the following are true:

- [x] Annotations use stable IDs and a unified collection.
- [x] Import adapters are transactional and tested.
- [x] Annotation mutations use commands.
- [x] Canvas rendering is independent from DOM rendering.
- [x] Pointer and keyboard interactions have controller boundaries.
- [x] Export formats have regression fixtures.
- [x] Primary workflows have browser-level tests.
- [x] The current refactored application runs without known regressions.
- [x] Application code consumes explicit named state slices without a compatibility facade.

The current evidence and deferred physical-device verification are tracked in [CURRENT-REFACTOR-TRACKER.md](CURRENT-REFACTOR-TRACKER.md). Original/refactored browser results are recorded in [PARITY-MATRIX.md](PARITY-MATRIX.md).

## Stage 2: Create the Angular Application

### 1. Confirm prerequisites

Install a supported Node.js release and the Angular CLI. Current requirements should be checked in the official [Angular installation guide](https://angular.dev/installation) before beginning.

```powershell
node --version
npm --version
npm install -g @angular/cli
```

**Why:** Angular's compiler, development server, tests, and production builder run through Node and the Angular CLI.

### 2. Create a separate Angular project

From the repository root, create a sibling application rather than replacing `Refactored`.

```powershell
ng new Angular
```

Recommended selections:

- Standalone components: yes
- Routing: no initially
- Styles: CSS or SCSS
- Server-side rendering: no
- Testing: retain the default setup

**Why:** Keeping both applications allows direct comparison and provides a working fallback during migration.

### 3. Define TypeScript domain types

Create types for annotations, points, application documents, settings, view state, image metadata, and import/export formats.

**Why:** TypeScript should validate the boundaries between state, geometry, rendering, and file formats before UI components are introduced.

**Complete when:** Core modules compile without `any` for application-domain data.

### 4. Copy framework-independent modules

Move the tested geometry, settings, format adapters, and document-model modules into the Angular project. Convert `.js` files to `.ts` without making them Angular services unless they require injected dependencies.

**Why:** Pure functions are easier to test, reuse, and reason about than framework-bound equivalents.

**Complete when:** The original pure-module tests pass inside the Angular project.

### 5. Create the Angular state store

Create an injectable `AnnotationStore` using Angular Signals for document, selection, view, tool, settings, and UI state. Angular Signals track state consumers and update affected templates. See the official [Signals guide](https://angular.dev/guide/signals).

**Why:** Components should consume a typed reactive API instead of sharing a mutable global object.

**Complete when:** Store commands can create, update, select, delete, undo, and redo annotations without a rendered UI.

### 6. Build the application shell

Create standalone components for:

```text
AppComponent
ToolbarComponent
ToolStripComponent
AnnotationCanvasComponent
ImageMetadataComponent
LabelPanelComponent
SnapSettingsComponent
DisplaySettingsComponent
HelpDialogComponent
ConfirmationDialogComponent
```

**Why:** Components provide ownership boundaries for markup, styling, accessibility, inputs, and outputs.

**Complete when:** The static application layout matches the current version at supported viewport sizes.

### 7. Integrate the canvas renderer

Let `AnnotationCanvasComponent` obtain the `<canvas>` through `ViewChild`, then initialize the existing renderer and interaction controllers after the view is ready.

**Why:** Angular should own the canvas element lifecycle, but the renderer should continue using `CanvasRenderingContext2D` and `requestAnimationFrame` directly.

**Important:** Do not represent every polygon point or canvas shape as Angular template elements.

**Complete when:** Image, grid, annotations, drafts, selection, zoom, and pan render with feature parity.

### 8. Connect Angular controls and forms

Replace DOM queries and manual event registration with Angular template bindings, component outputs, and typed form controls.

```html
<button type="button" (click)="history.undo()" [disabled]="!history.canUndo()">
  Undo
</button>
```

**Why:** Template bindings make component dependencies and UI behavior visible in the component contract.

**Complete when:** Toolbar, tool selection, settings, dialogs, labels, and metadata no longer use manual `querySelector` wiring.

### 9. Integrate file operations

Connect PNG loading, JSON import, JSON export, and mask export through Angular services while keeping format conversion in pure modules.

**Why:** Services coordinate browser APIs and store updates; pure adapters retain testable format logic.

**Complete when:** Existing fixtures import and export equivalent results in both applications.

### 10. Port and expand tests

Port pure unit tests and add Angular service and component tests. New Angular projects use Vitest by default; see the official [Angular testing guide](https://angular.dev/guide/testing).

Add browser tests for canvas workflows using Playwright or another supported browser provider.

**Why:** DOM emulation is appropriate for services and components, but real browser tests are required for canvas, files, downloads, focus, and pointer behavior.

**Complete when:** Unit, component, integration, and browser suites pass consistently.

### 11. Verify feature parity

Run the current and Angular applications side by side using the same PNG and JSON fixtures.

Compare:

- Drawing behavior
- Coordinates and geometry
- Undo/redo sequences
- Selection and editing
- Imported annotations
- JSON payloads
- Binary masks
- Keyboard behavior
- Responsive layout
- Accessibility behavior

**Why:** Passing compilation and unit tests does not prove behavioral parity for an interactive canvas application.

**Complete when:** Known workflows and exported artifacts match, with intentional differences documented.

### 12. Build and deploy

Create the optimized build:

```powershell
ng build
```

Deploy the generated static output from Angular's build directory to the chosen web host.

**Why:** Production builds bundle, optimize, and fingerprint application assets for reliable deployment.

**Complete when:** The production build passes tests and functions correctly from its deployment URL.

## Proposed Angular Component Structure

```text
Angular/src/app/
  app.component.ts
  core/
    annotation-store.ts
    history.service.ts
    image.service.ts
    export.service.ts
    shortcut.service.ts
  canvas/
    annotation-canvas.component.ts
    canvas-renderer.ts
    pointer-controller.ts
  toolbar/
    toolbar.component.ts
    tool-strip.component.ts
  panels/
    label-panel.component.ts
    image-metadata.component.ts
  settings/
    snap-settings.component.ts
    display-settings.component.ts
  dialogs/
    help-dialog.component.ts
    confirmation-dialog.component.ts
  model/
    annotation.ts
    application-document.ts
    application-state.ts
  geometry/
    math.ts
    polygon.ts
    ellipse.ts
    hit-testing.ts
  io/
    coco.ts
    llnl.ts
    legacy.ts
    mask.ts
```

## Migration Principles

- Preserve the current working application until Angular feature parity is verified.
- Migrate tested domain logic before UI code.
- Keep geometry and format conversion framework-independent.
- Let Angular render interface elements, not canvas primitives.
- Use services for browser APIs and cross-component coordination.
- Use Signals for reactive state, with mutations exposed through commands.
- Avoid combining the annotation-model redesign with the first Angular UI conversion.
- Compare exported JSON and masks, not only what appears visually correct.

## Expected Effort

These ranges assume one developer familiar with Angular and the existing application:

- Angular scaffold and static shell: approximately 3–5 working days
- Canvas integration and basic controls: approximately 1–2 weeks
- Full feature parity and state integration: approximately 3–5 weeks total
- Production hardening, browser coverage, and accessibility: approximately 5–8 weeks total

Actual effort will depend on how much of Stage 1 is complete before the Angular project begins.
