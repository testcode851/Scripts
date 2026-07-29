# Original-to-Refactored Parity Matrix

## Baseline

The root-level `app.js`, `index.html`, and `styles.css` application is the behavioral baseline. It remains unchanged by work in `Refactored/`.

The repeatable browser scenario is implemented in `scripts/browser-smoke.js`. It loads a generated PNG and performs the same workflow against the original and refactored applications.

## Automated Browser Matrix

| Behavior | Original | Refactored | Result |
| --- | --- | --- | --- |
| PNG load and processing | Pass | Pass | Same |
| Legacy JSON import | Pass | Pass | Same |
| Rectangle creation and label commit | Pass | Pass | Same |
| Ellipse creation and label commit | Pass | Pass | Same |
| Polygon creation and label commit | Pass | Pass | Same |
| Tool-specific creation defaults | Not automated | Pass | Polygon, rectangle, and ellipse defaults verified |
| Select and duplicate | Pass | Pass | Same |
| Undo and redo | Pass | Pass | Same |
| Floating dialog open and close | Pass | Pass | Same |
| Zoom in and reset | Pass | Pass | Same |
| Middle-button pan controller lifecycle | Not automated | Pass | Pointer Event coverage added |
| Responsive layout at supported breakpoints | Not automated | Pass | 1600px through 480px verified |
| Simulated pen/stylus primary workflow | Not automated | Pass | Pen pointer, pressure, tilt, and capture path verified |
| Shortcuts modal opens and receives focus | Pass | Pass | Same |
| Normal mask is binary | Pass | Pass | Same |
| Inverted mask is binary and pixel-inverse | Pass | Pass | Same |
| Mask download names | Pass | Pass | Same |
| Five-shape ordering after scenario | Pass | Pass | Same |
| Invalid import preserves active document | Not guaranteed | Pass | Intentional safety improvement |
| Escape closes shortcuts modal while a drawing tool is active | Fails | Pass | Intentional accessibility fix |

Both applications produced this shape order after the shared scenario:

1. `baseline` polygon
2. `road` polygon
3. `roof` polygon
4. duplicated `baseline` polygon
5. `wheel` ellipse

Both applications produced `smoke-mask.png` and `smoke-inverted-mask.png`, with strict 0/255 pixels and inverse foreground/background values.

## Format Coverage

- `tests/fixtures/native-llnl.json` is the native LLNL fixture.
- `tests/fixtures/coco.json` is the COCO fixture.
- `tests/fixtures/legacy.json` is the legacy fixture.
- `tests/annotation-document.test.js` verifies all three fixtures map into the unified model.
- `tests/annotation-export.test.js` verifies deterministic LLNL and COCO payloads and native round trips.

## Repeat the Browser Check

The smoke script expects a browser launched with a Chrome DevTools Protocol port. With the application and browser already running:

```powershell
$env:CDP_PORT=9224
$env:APP_URL="http://127.0.0.1:4173"
node scripts/browser-smoke.js
```

The original baseline can be checked with:

```powershell
$env:CDP_PORT=9225
$env:APP_URL="http://127.0.0.1:4181"
$env:BASELINE_MODE="true"
$env:EXPECTED_STYLESHEETS="1"
node scripts/browser-smoke.js
```

## Manual Checks Still Required Before Angular Work

- Very large PNG responsiveness and memory use.
- Pan interaction with a physical middle mouse button.
- Touch behavior and physical stylus behavior on real hardware.
- Downloaded LLNL and COCO files opened in a downstream consumer, if one exists.
