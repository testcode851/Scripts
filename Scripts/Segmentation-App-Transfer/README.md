# Segmentation Annotator

This folder contains the ES-module version of the segmentation application.
The application runs in a web browser, while Node.js provides the local web
server used to open it correctly.

## Requirements

- Node.js approved for the computer running the application
- A current Chromium-based browser such as Google Chrome or Microsoft Edge
- For width Analytics: Python with the dependencies in
  `diw_width_extraction_benchmark/requirements.txt`

The application currently has no third-party npm dependencies, so `npm
install` is not required. If dependencies are added later, configure the
organization-approved `.npmrc` and Artifactory registry before installing
them.

## Required Runtime Files

Keep this structure intact when running or transferring the application:

- `index.html`
- `package.json`
- `scripts/dev-server.js`
- `scripts/local-project-service.js`
- `scripts/project-folder-picker.js` and `scripts/project-folder-picker.ps1`
- `scripts/analytics-service.js` and `scripts/analytics_adapter.py`
- `src/` and everything inside it
- `styles/` and everything inside it
- `diw_width_extraction_benchmark/pdtools/` and a configured Python environment
  for Analytics (the annotation editor can still run without Python)

`README.md` provides documentation and is not loaded by the application.
A development copy may also contain tests and additional documentation, but
those files are not required for normal application use.

## Run from Git Bash

Open Git Bash in this folder and run:

```bash
npm run dev
```

Then open <http://127.0.0.1:4173> in a browser. Press `Ctrl+C` in Git Bash to
stop the server.

If port 4173 is already being used:

```bash
PORT=4174 npm run dev
```

Then open <http://127.0.0.1:4174>.

## Run from PowerShell

```powershell
npm run dev
```

For a different port in PowerShell:

```powershell
$env:PORT=4174
npm run dev
```

## Local project folders

Projects now save to ordinary folders on this computer through the local Node
server. They do not use the browser's IndexedDB quota. Choose **Open** in the
Images drawer, then **Browse** to choose where to create a named project or
select an existing project folder. A location can also be pasted into the dialog.
The full destination appears before creation. No shared parent folder is required
or created automatically. The drawer displays the actual folder name and path. Switching
projects saves the current work first and reloads the editor for the selected
project. The base app URL starts with no project open and creates no default
project. Regular **Open** and **Open JSON** still allow temporary annotation,
with autosave off. Export temporary work to keep it, or create a project to save
the current image, annotations, calibration, classes, and active class choice.
Opening an existing project asks before discarding temporary work. Multi-image
batches require an explicitly opened project. Refreshing a URL containing
`?project=...` restores only that explicitly selected project while the same app
server is running. After restarting the server, browse to the project folder again.

On Windows, **Browse** opens a native folder chooser on the computer running
`npm run dev`. If the chooser is unavailable, enter the full folder path directly.
The previous `SEGMENTATION_PROJECTS_DIR` setting is no longer used. Each project
has a separate image queue, saved documents, and class catalog. New folders use the exact
valid folder name entered by the operator (for example `Batch001`). An existing
folder must be opened or a different name chosen; no numbered suffix is added.
Older projects stored in ID-named folders can be opened directly by browsing to
that folder. Their old parent `projects.json` registry is not required. The batch
name names the dataset ZIP; changing it does not rename the project folder or
its displayed project name.

Project files include original image bytes and internal editor snapshots. These
snapshots preserve editor state beyond what LLNL or COCO exports contain; exported
JSON files are not the project's working database. Source images selected from
other folders are copied without modifying those originals. Clearing browser data
does not remove the saved project folders. Unsaved edits remain in memory until
the next successful save. Earlier browser databases are not imported or migrated.

For a complete backup, finish saving, stop the server, and copy the whole project
folder, including `project.json` and `images`. Browse to that folder to reopen it
after moving or copying it, including on another computer. Separate folders can
have the same name. Concurrent app servers cannot write to the same project folder.
Continue using dataset exports to share PNGs, annotation JSON, and masks with other tools.

## Application Files and Data

- Start the app with `npm run dev`; do not open `index.html` directly.
- PNG images and annotation JSON files are selected through the application UI.
- Annotation editing and rendering happen locally in the browser.
- LLNL and COCO annotation JSON exports include a top-level `image_base64` field
  containing the original loaded image file's Base64 bytes, without a data URL
  prefix. Display adjustments and annotations are not baked into this image.
  The value is `null` for annotation-only documents with no loaded image. This is
  an app-specific extension to COCO; the existing annotation fields are unchanged.
  Importing either format restores this embedded PNG together with its
  annotations and calibration. Missing or `null` image data keeps the existing
  annotation-only import behavior. Invalid image data or mismatched dimensions
  rejects the import before replacing the current document. Embedded COCO JSON
  must identify exactly one image. Replacing the image clears old undo history,
  as with a PNG upload; importing the same image bytes preserves annotation undo.
- Analytics sends the selected binary mask to the local Node server, which
  runs the existing Python width engine. It also sends the original image raster
  to that same local server to generate the benchmark's original Python figure.
  Requests and results are held in memory; the server does not save them or send
  them to an external service. CSV, PNG, and JSON are saved only when exported.
- Keep the terminal open while using the application.
- Press `Ctrl+C` in the terminal when finished.

## Main Runtime Structure

- `index.html` defines the application page and UI structure.
- `styles/` contains the component and layout stylesheets.
- `src/app.js` assembles the browser application.
- `src/bootstrap/` controls application startup order.
- `src/commands/` routes application actions such as undo, delete, and export.
- `src/controllers/` handles user input and UI events.
- `src/model/` and `src/state/` manage annotations and application state.
- `src/render/` draws the canvas, shapes, grid, and masks.
- `src/workflows/` coordinates annotation and document operations.
- `scripts/dev-server.js` runs the local Node.js web server.
- `scripts/analytics-service.js` handles local measurement requests and Python jobs.
- `scripts/local-project-service.js` saves project files through the local server.
- `scripts/project-folder-picker.js` and its `.ps1` helper open the Windows folder chooser.
- `scripts/analytics_adapter.py` converts masks and engine results to pixel-based JSON.
- `src/analytics/` handles calibration, results, figures, and downloads.
- `src/session/` validates recovery snapshots and saves them through the local project API.

## Autosave and Session Recovery

Outside an image batch, the app automatically saves the current session in its project folder and restores it
when you reopen that project. The status below the image name shows whether
changes are **Unsaved**, **Saving…**, or **Saved**. Both single-image and batch
editing save 30 seconds after the first unsaved change. Further edits do not
postpone that checkpoint, and another is scheduled only when changes are pending.
Fixed polygon vertices are included in those checkpoints.
Active geometry drags and image loading defer a checkpoint until saving is safe.
Image replacement saves the new session only after the image finishes loading.
Switching batch images and exporting a batch still wait for the latest save;
hiding or leaving the page requests an immediate save. Browser shutdown cannot
guarantee completion of that last request.

Recovery includes the original image bytes, full-precision annotations and curve
data, labels and colors, calibration, image names and dimensions, fixed polygon
draft points, and elapsed annotation time. Annotation-only JSON imports can also
be recovered before loading an image. The timer returns paused. While running, it
marks elapsed time for saving every 15 seconds; the same 30-second save schedule
applies. Undo history, selection, pan/zoom, display settings,
unconfirmed label text, pointer previews, active drags, rectangle/ellipse drafts,
and analytics results are not restored.

Storage errors show a retry option without interrupting editing. If another tab
saves a newer session, the older tab stops saving and asks you to export its work
before reloading; it cannot overwrite the newer saved session automatically.

Recovery stays in the local project folder. It does not depend on the browser
profile, browser storage quota, or server port. Use the same configured project
location to reopen it. Unsaved edits can still be lost on a crash before a save
finishes. A full disk or unavailable project folder can prevent saving; keep
project backups and annotation exports separately.

## Image batches

Use **Images** in the toolbar to expand the image drawer beside the drawing tools.
Choose **Add images** to select multiple PNGs or LLNL/COCO JSON files containing
embedded PNGs. The current loaded image and its annotations are included when
starting a batch. Annotation-only JSON still uses **Open JSON** on the selected image.

The drawer overlays the left side of the canvas without moving or resizing the image.
Select an image, then collapse the drawer manually to reveal the full canvas.
Previous/Next, the current image name and position, Mark complete, and Export batch
remain available while the drawer is collapsed. Search filenames or filter by
completion status in the drawer. Completion is explicit, including for images
with no shapes; subsequent geometry, label, color, or calibration edits reopen it.

Use **Batch actions → Close current image** to save immediately and empty the canvas
while keeping the image in the drawer. Reopen it by selecting its row. **Remove image**
beside a row deletes that image and its saved annotations from the batch;
**Batch actions → Clear batch** removes all images and their saved annotations.
Both removal actions ask for confirmation and offer **Export first**, which opens
the existing ZIP export dialog without deleting anything. Removing the open image
leaves the canvas empty rather than opening another image. Closed and empty batches
stay that way after a refresh. Original files, downloaded exports, and the reusable
class catalog are unaffected. A save or storage failure keeps the current image and
queue in place. These actions apply to images in the drawer, separately from clearing
shapes on an image.

The current batch saves automatically in the local project folder. Image bytes
are stored separately from annotation snapshots, so an annotation save does not
rewrite every original image. Each image retains its original bytes, annotations, colors, calibration,
review/visibility/lock state, fixed polygon draft, and paused annotation timer.
Switching waits for a successful save and prepares the destination before replacing
the editor. A save or decode failure keeps the current image open. Finish or cancel
active drags, rectangle/ellipse placement, and label dialogs before switching.
Undo history is cleared at image switches, as with an ordinary image replacement;
it never applies one image's edits to another. Analytics remains explicitly started
with Analyze widths. While a batch is active, Open adds a PNG to that batch;
Open JSON imports onto the current image unless it embeds a different image, which
is added as another batch item.

**Export batch** downloads a ZIP for all images, completed images, or the current
image. Select original PNGs, normal binary mask PNGs, and LLNL or COCO JSON.
It uses the existing serializers and mask renderer, including the COCO ellipse
limitation and the original image bytes in `image_base64`. Hidden/filtered shapes
remain included. Quality warnings and omitted ellipses are disclosed before
export. Each image has its own folder containing the original filename, annotation
JSON, and mask; a manifest keeps same-named images separate and records their paths.
This is a dataset export, not a full project backup: it does not provide restoration
of the queue's completion states or all app-specific review information. Each local
project manages one continuing batch. Use **Open** in the Images drawer for separate
projects and copy the complete individual project folder for a full backup.

Local project storage can hold batches larger than browser storage allows. The
existing ZIP exporter still builds the download in browser memory and supports
archives below 4 GiB. A larger disk project therefore does not imply that its
entire dataset can be exported in one ZIP; streaming exports with ZIP64 support
are a separate follow-up.

## COCO classes and instances

LLNL JSON keeps its tailored format and independent shape records. COCO keeps
its standard category, annotation, and polygon segmentation fields. Binary mask
exports and the existing COCO ellipse omission warning are unchanged.

COCO imports preserve the source category IDs and provided annotation IDs of
imported shapes, plus the relationship between polygon components of one
instance. Exports include the categories used by the exported polygons.
Components remain separately editable in the canvas. Export regroups them into one COCO annotation
with a bounding box covering all components; overlapping component area is
counted once. Single-polygon area calculation is unchanged.

Duplicating a component creates a separate instance. Editing or deleting one
component affects that component. Giving components different class labels
splits them into separate COCO annotations on export. Undo/redo and automatic
session recovery preserve these relationships.

Invalid or undefined class references and duplicate source IDs reject the import
without replacing the current document. Older inputs that omit annotation IDs
remain supported, and zero is a valid ID. Different imported categories with the
same name retain their distinct IDs. If a newly drawn or renamed shape uses that
ambiguous name, COCO export asks for a distinct label instead of guessing a class.

LLNL JSON does not carry COCO instance grouping; use COCO or session recovery to
retain those relationships. Without an enabled reusable class catalog, newly
allocated export class IDs are local to the document. Instance IDs remain local
to each document.

## Reusable class catalog

Open **Classes** to define names and numeric class IDs that you can reuse across
images. The catalog is optional and starts disabled. Add entries, select **Use
this catalog**, and choose **Apply** to save. Names are case-sensitive; IDs must
be unique nonnegative integers (zero and gaps are allowed). Cancel discards
staged changes. Removing a catalog entry does not rename or delete annotations.

Enabled catalog names appear in the label editor's suggestions and the **Class
for new shapes** dropdown, with counts including classes with zero shapes. Choose
a class there to use it for new shapes. Polygons, rectangles, and ellipses keep
the class chosen when drawing started and finish without a naming popup. Choose
**Manual naming** to return to the existing naming workflow. If a draft's class
is removed, renamed, or disabled before completion, the naming popup returns.
The active choice is saved as a preference in the local project folder,
survives image replacement, and clears if its class is removed or
disabled. Choosing a class does not relabel existing shapes.

To relabel an existing shape, select it and choose its **Class** in the selected
shape controls. **Rename** still accepts a free-text label. For bulk assignment,
choose **Select multiple**, check shapes, choose **Assign class**, and click
**Assign to selected**. These class choices are separate from **Class for new
shapes**. **Done** exits multiple selection and clears the checks.
Checkboxes only choose class
assignment targets; canvas editing and deletion still act on the selected shape.
The whole assignment is one undoable edit. Checked targets clear on undo/redo,
import, or image replacement. Assignment preserves geometry, custom colors, and
source COCO identities; shapes without a custom color use the existing label
color behavior. It waits until image loading, shape dragging, or naming is finished.

Manual drawing and LLNL imports still allow free-text labels. MS COCO exports use the registered
IDs regardless of drawing order or which classes appear in the current image;
only used categories are exported. Unknown polygon labels must be registered,
renamed to a registered class, or exported with the catalog disabled. COCO
imports whose selected-image classes are unknown or conflict with catalog IDs,
names, or explicitly supplied supercategories are rejected before changing the
document. Existing instance grouping and the ellipse omission rule still apply.
LLNL JSON keeps its existing format and contains the labels you assigned. Binary
masks remain unchanged by class assignment. The catalog does not define colors.

The catalog is stored in the project folder, separately from the image and its undo
history. It survives image replacement, clearing annotations, and project recovery.
Each project has its own catalog. **Export catalog** downloads the staged class definitions
as a separate catalog JSON file; **Import catalog** replaces the staged entries
and enables them, with **Apply** required to save. These files are not annotation
files. Keep a catalog export as a backup or use it to share definitions across
projects, browsers, and computers. Clearing browser data does not remove the saved catalog.

Saving checks for edits from another tab and never silently overwrites them.
**Reload saved catalog** discards staged edits and reloads the saved definitions.
If a newer catalog is detected in another tab, reload it before class selection,
assignment, or COCO import/export. Catalog validation or storage errors leave
annotations untouched.

## Annotation quality review

Choose **Review** in the toolbar to inspect committed shapes, or export LLNL JSON,
MS COCO JSON, a mask, or an inverted mask. Exports with no quality warnings follow
the existing download flow. Flagged exports open a review before downloading or
stopping the annotation timer. **Back to editing** or Escape cancels that export;
**Export anyway** keeps the geometry and export format unchanged.

The **Quality checks** tab lists shape numbers and labels for crossing, touching,
or retraced polygon edges, zero-area shapes, invalid geometry, duplicate
boundaries, and positive regions smaller than **4 square pixels in the original
image**. The small-region threshold is a geometric-area hint, independent of zoom
and physical calibration. Curves use the same preserved sampling as masks.
Duplicates are checked across labels. The optional overlap check warns when the
intersection exceeds **20% of the smaller shape's area**; crossing strands can be
intentional. Ellipse overlap uses a 64-point approximation. Pair checks have work
and boundary-complexity limits; the dialog explicitly reports incomplete checks
and skipped shapes. COCO review checks polygons only, and its existing ellipse
omission warning still applies.

The **Mask preview** tab shows the full-document binary mask at its original pixel
dimensions, scaled to fit the dialog. Choose normal or inverted and optionally
show the original image beside it. Preview uses the same renderer as mask
downloads, includes ellipses and hidden/filtered shapes, and does not run width
analytics. It previews binary-mask PNG output, not a raster interpretation of a
COCO document.

The sidebar keeps image details and timer controls inside the collapsed **Image
details** section; save status and save errors stay visible. **Shapes** is the
main list, and selecting a row opens its editing controls below the list.

Under **Shapes**, **Show shapes** filters the canvas and shape list without
changing the active class used for new shapes. Select a shape to toggle **Show
on canvas** or **Locked**. Hidden shapes remain available in the filtered sidebar; locked
shapes can be selected but cannot be moved, resized, renamed, recolored, assigned
a different class, or deleted until unlocked. Clear All also requires unlocking
all shapes. Duplicates start visible, unlocked, and unreviewed. Whole-document
imports and image replacement retain their existing behavior. Visibility and
locking never exclude annotations from JSON, masks, or analytics.

Mark individual shapes **Unreviewed**, **Needs review**, or **Approved** in the
sidebar or Review dialog; the dialog can filter this list by status and displays
25 entries per page. These are human decisions, separate from automatic warnings.
Changing approved geometry or its label returns it to Unreviewed; Needs review
persists until explicitly changed. Visibility, lock, and review decisions support
undo/redo and automatic project recovery. They are editor metadata and do
not change LLNL or COCO export schemas. The class filter is a temporary view setting.

Use **Select shape** to close the review and select that annotation for inspection.
This cancels a pending export and leaves the viewport unchanged, clears a
conflicting class filter, and unhides that shape when necessary. Checks and mask
preview never repair shapes or change labels; only explicit review or visibility
actions change editor metadata. Drafts are excluded. Export confirmation is used
once, and changed export contents require a fresh review. Marking a shape Approved
does not dismiss geometry warnings or waive later export confirmation.
Checks run only on review/export requests, not on drawing, selection, pan, zoom,
or autosave. They identify geometry concerns, not annotation accuracy; intentional
small shapes or touching boundaries can still be exported. Existing import and
COCO class-validation rules continue to apply.

## Width Analytics

1. In **Annotation**, load the original PNG and draw or import its annotations.
   Imported dimensions must match the original image.
2. Open **Analytics** and select all labels or one label to measure.
3. Use **Benchmark default**, enter a known **µm per pixel**, or calibrate a known
   distance by selecting two endpoints and entering its real length in µm.
   A separate reference image must use the same acquisition settings and pixel
   scaling. Display zoom is irrelevant. Without an image calibration, results
   use the benchmark's own nominal scale (currently 3.25 µm/pixel), explicitly
   identified as a benchmark default rather than a calibration of the specimen.
4. Click **Analyze widths**. The page displays the PNG produced directly by
   `transect_panel.render_3panel`: enhanced raw image, binary mask, and the
   benchmark's transects, colors, median/solidity labels, and colorbar. The
   per-strand table retains its CSV column order. Selecting a row selects only
   that row; it does not repaint the original benchmark figure.
5. Use **Export CSV** or **Export figure PNG** to save results. To keep calibration
   for later, return to Annotation and **Export JSON**. Load the matching image
   before importing that JSON next time. Calibration is optional metadata in
   native JSON and the COCO image entry; files without calibration use the
   benchmark default when analyzed.
6. Use **Export analysis bundle** to download one ZIP containing `mask.png`
   (the exact full-resolution PNG sent to the measurement engine), `results.csv`,
   `report.png`, and `analysis.json`. The JSON records the original image name
   and dimensions, measured label filter, analysis/export times, calibration
   used for the exported CSV and report, raw pixel measurements and transects,
   method settings, Python/library versions, and SHA-256 source fingerprints.
   The bundled benchmark has no published package version, so its source
   fingerprints identify the measurement code. File hashes link the JSON to
   the other three files. The report is the original Python PNG, including all
   measured strands, unchanged by table selection. Rendering provenance records
   the renderer source, Matplotlib version, source image/mask hashes, grayscale
   conversion, scale, and aggregation. Empty analyses have no benchmark figure;
   their CSV can still be exported.
7. Click **Open saved analysis** in Analytics to review an exported ZIP, even
   when no image is loaded. The viewer checks the archive, file hashes, image
   dimensions, and consistency between the recorded measurements, calibration,
   and CSV before displaying it. It shows the saved report, full-resolution
   mask, per-strand results, and recorded software/settings. Close the viewer
   to return to your current work.

Opening a saved analysis is read-only: it does not replace the current image,
annotations, calibration, undo history, or live analysis, and it does not run
Python or automatically save anything. A failed opening leaves the current
document and any previously opened analysis intact. Verification confirms that
the bundled files match their recorded hashes and metadata; it does not certify
their author or claim that measurements were rerun with the currently installed
software. Open the original ZIP exported by the app; recompressed archives and
other ZIP formats are not supported. The viewer accepts archives up to 256 MiB,
with individual file and decoded image limits.

Analysis bundles are saved only when you click the export button. Running an
analysis does not download or persist its results. Project autosave
continues to save annotations, the image, and calibration separately. Export a
bundle before refreshing or closing the page. The ZIP documents a completed
analysis; it does not install its recorded Python environment or reopen as an
annotation project. Keep the original image and annotation JSON with your work.
If the image, annotations, or calibration change while a bundle is being
prepared, that download is canceled so files from different states cannot mix.

Width results are retained internally in original image pixels. The benchmark
default or supplied calibration converts widths and their standard deviations
to micrometers. Changing calibration rerenders the original Python figure
without rerunning width extraction. Figure and bundle downloads become available
when that render finishes; failures can be retried without losing measurements.
Coordinates and area stay in pixels, and counts and CV do not change.
The image summary is the **mean of per-strand medians**, calculated from the
benchmark's per-strand results.
Fewer than 30 measurements flags a strand as `low_transect_count`; this does not
automatically remove it. Touching or crossing strands can merge into one
component. Editing the mask clears previous results; loading another image also
clears calibration. Save exports before closing or refreshing the page.
The adapter calls `width_extraction_eval.per_strand_medians` and delegates each
component to the original `method_global` function in the bundled package. The package's
measurement code is used unchanged: it measures the raw binary mask, excludes
components smaller than 200 pixels, uses its fixed skeleton seed and sampling
stride of 15, and retains its boundary-truncated fallback when no complete
cross-sections are available. No hole filling, edge smoothing, skeleton pruning,
or additional measurement acceptance rules are applied by the app. Repeating
the same mask in the same Python environment produces the same measurements.

The benchmark returns widths using its `RES` scale; the adapter converts these
values back to pixels for the app's existing calibration controls. The adapter
also packages statistics and line coordinates for the existing table, CSV and
overlay. Overlay coordinates do not determine the measured widths. The original
`strand_diameter.py` production pipeline remains in the package, but is not the
measurement entry point used by the app.

The browser does not recreate benchmark plots. It displays and downloads the
original PNG bytes from `transect_panel.render_3panel`, passing the package's
`mean_of_medians` aggregation to match the selected evaluator. The source image
is captured at original dimensions, composited on black for transparency, and
converted to grayscale by Pillow before the renderer applies its own CLAHE.
This conversion is recorded in rendering provenance. PNG pixels match direct
calls with the same inputs, options, and Python/Matplotlib environment.
CSV/JSON/ZIP are app transport and download formats: the selected evaluator
does not provide a user-image CSV writer. Its synthetic error-analysis CSV and
the separate production pipeline's outputs are different workflows.

### Configure Python (Git Bash on Windows)

If the benchmark environment already works, no reinstall or activation is
required. The server automatically finds
`diw_width_extraction_benchmark/.venv/Scripts/python.exe`, then the root
`.venv/Scripts/python.exe` (or `.venv/bin/python` on macOS/Linux).

For a new environment, from the application root:

```bash
python -m venv diw_width_extraction_benchmark/.venv
diw_width_extraction_benchmark/.venv/Scripts/python.exe -m pip install -r diw_width_extraction_benchmark/requirements.txt
npm run dev
```

To use another existing environment, supply its executable when starting the
server:

```bash
ANALYTICS_PYTHON="C:/path/to/your/.venv/Scripts/python.exe" npm run dev
```

In PowerShell, set `$env:ANALYTICS_PYTHON` before `npm run dev` instead. Restart
an already-running server after updating its code or configuration. Analytics
processes one image at a time, with a three-minute timeout and limits of 25
million pixels, 12,000 pixels per side, and 12 MiB per PNG mask. A failed job
displays an explanation without changing annotations.

### Runtime distribution

This runtime copy excludes development tests, QA scripts, generated sample masks,
and benchmark output reports. The application source, styles, local API server,
Python adapter, and benchmark package are retained.

Keep every Python source file under `diw_width_extraction_benchmark/pdtools/`.
Analytics includes their fingerprints in saved analysis bundles, including modules
that are not directly called during measurement. The configured Python environment
and its installed package data are required for measurements and figures.
