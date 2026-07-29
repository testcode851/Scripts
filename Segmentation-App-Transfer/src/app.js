import { DEFAULT_SETTINGS, SNAP_PRESETS, normalizeSettings } from "./config/settings.js";
import { createAppState } from "./state/create-app-state.js";
import { createSnapshotHistory } from "./state/snapshot-history.js";
import { clamp, round } from "./geometry/math.js";
import {
  clonePolygonPoint,
  flattenPolygon,
} from "./geometry/polygon.js";
import { bindCommandElements, createCommandRegistry } from "./commands/command-registry.js";
import { COMMANDS } from "./commands/command-names.js";
import { parseAnnotationDocument } from "./io/annotation-document.js";
import {
  exportCocoDocument,
  exportLlnlDocument,
} from "./io/annotation-export.js";
import { createRenderInvalidation } from "./render/invalidation.js";
import { createKeyboardController } from "./controllers/keyboard-controller.js";
import { createPointerController } from "./controllers/pointer-controller.js";
import { createToolController } from "./controllers/tool-controller.js";
import { createViewController } from "./controllers/view-controller.js";
import {
  cloneAnnotation,
  createEllipseAnnotation,
  createPolygonAnnotation,
  getAnnotationAtTypeIndex,
  getAnnotationById,
  getAnnotationTypeIndex,
  getAnnotationsByType,
  removeAnnotationById,
} from "./model/annotation.js";
import {
  DEFAULT_ANNOTATION_LABELS,
  getDefaultLabelForTool,
  getRememberedAnnotationLabel,
  rememberAnnotationLabel,
} from "./model/annotation-labels.js";

/*
  ============================================================================
  app.js  –  Main application logic for the Segmentation Annotator
  ============================================================================

  WHAT THIS FILE DOES (big picture)
  ----------------------------------
  This single JavaScript file powers an image-annotation tool that runs
  entirely in the browser.  The user loads a PNG image, draws polygon or
  ellipse shapes on top of it, and exports the results as JSON metadata
  or a binary mask PNG.

  HOW THE CODE IS ORGANIZED
  --------------------------
  1.  DOM REFERENCES        – grab every button, input, canvas, etc. we need.
  2.  DEFAULT SETTINGS      – baseline numbers for grid, snap, contrast, etc.
  3.  PRESETS               – named bundles of settings the user can apply.
  4.  APPLICATION STATE     – named state slices track the loaded image,
                              annotations, interaction, view transform,
                              settings, and transient UI state.
  5.  HELPER / UTILITY FNS  – small, reusable math or DOM helpers (clamp,
                              rounding, coordinate transforms, etc.).
  6.  DRAWING FUNCTIONS     – render the image, grid, polygons, and ellipses
                              onto the HTML <canvas>.
  7.  SNAP PIPELINE         – logic that "magnetically" adjusts a point to
                              the nearest grid line, image border, edge, or
                              intensity extremum so annotations align better.
  8.  IMAGE ANALYSIS        – pre-compute grayscale + gradient (edge-strength)
                              buffers from the loaded image for smart snapping.
  9.  IMPORT / EXPORT       – read annotation JSON (LLNL or COCO format),
                              write annotation JSON, and render a binary mask.
  10. EVENT LISTENERS       – wire up every click, key press, slider change,
                              file upload, and wheel event to the right handler.

  KEY CONCEPTS FOR BEGINNERS
  ---------------------------
  • "Image space" = coordinates in the original image (e.g. 0–1024 pixels).
  • "Canvas space" = coordinates on the visible <canvas> element, which may
    be scaled down from image space and further transformed by zoom/pan.
  • scalePoint()  converts image-space → canvas-space.
  • getImagePoint() converts a mouse event → image-space.
  • The entire scene is re-rendered on every change by calling redraw().
  ============================================================================
*/

// ── SECTION 1: DOM REFERENCES ───────────────────────────────────────────
// We grab every interactive element once at startup so we don't have to
// search the DOM each time we need them.  querySelector("#id") finds the
// first element whose id matches.  If the element doesn't exist the
// variable will be null, so many listeners below guard with `if (el)`.
const canvas = document.querySelector("#annotationCanvas");
const ctx = canvas.getContext("2d");
const imageInput = document.querySelector("#imageInput");
const jsonInput = document.querySelector("#jsonInput");
const gridToggle = document.querySelector("#gridToggle");
const snapToggle = document.querySelector("#snapToggle");
const snapPresetSelect = document.querySelector("#snapPreset");
const applyPresetButton = document.querySelector("#applyPreset");
const resetSettingsButton = document.querySelector("#resetSettings");
const smartSnapToggle = document.querySelector("#smartSnapToggle");
const snapBorderToggle = document.querySelector("#snapBorderToggle");
const snapEdgeToggle = document.querySelector("#snapEdgeToggle");
const snapExtremaToggle = document.querySelector("#snapExtremaToggle");
const snapExtremaModeSelect = document.querySelector("#snapExtremaMode");
const gridSizeInput = document.querySelector("#gridSize");
const gridOpacityInput = document.querySelector("#gridOpacity");
const gridMajorEveryInput = document.querySelector("#gridMajorEvery");
const snapRadiusInput = document.querySelector("#snapRadius");
const snapBorderThresholdInput = document.querySelector("#snapBorderThreshold");
const snapEdgeThresholdInput = document.querySelector("#snapEdgeThreshold");
const snapExtremaDeltaInput = document.querySelector("#snapExtremaDelta");
const sourceEnhancementSelect = document.querySelector("#sourceEnhancement");
const imageContrastInput = document.querySelector("#imageContrast");
const maskContrastInput = document.querySelector("#maskContrast");
const maskOpacityInput = document.querySelector("#maskOpacity");
const imageContrastValue = document.querySelector("#imageContrastValue");
const snapEdgeThresholdValue = document.querySelector("#snapEdgeThresholdValue");
const gridOpacityValue = document.querySelector("#gridOpacityValue");
const maskContrastValue = document.querySelector("#maskContrastValue");
const maskOpacityValue = document.querySelector("#maskOpacityValue");
const outputFormatSelect = document.querySelector("#outputFormat");
const emptyState = document.querySelector("#emptyState");
const canvasWrap = document.querySelector(".canvas-wrap");
const canvasLabelEditor = document.querySelector("#canvasLabelEditor");
const canvasLabelEditorTitle = document.querySelector("#canvasLabelEditorTitle");
const canvasLabelEditorInput = document.querySelector("#canvasLabelEditorInput");
const canvasLabelEditorSuggestions = document.querySelector("#canvasLabelEditorSuggestions");
const canvasLabelEditorOk = document.querySelector("#canvasLabelEditorOk");
const canvasLabelEditorCancel = document.querySelector("#canvasLabelEditorCancel");
const canvasContextMenu = document.querySelector("#canvasContextMenu");
const zoomOutButton = document.querySelector("#zoomOut");
const zoomInButton = document.querySelector("#zoomIn");
const zoomResetButton = document.querySelector("#zoomReset");
const fitWindowButton = document.querySelector("#fitWindow");
const zoomValue = document.querySelector("#zoomValue");
const openShortcutsButton = document.querySelector("#openShortcuts");
const shortcutsModal = document.querySelector("#shortcutsModal");
const closeShortcutsButton = document.querySelector("#closeShortcuts");
const newImageConfirmModal = document.querySelector("#newImageConfirmModal");
const confirmNewImageLoadButton = document.querySelector("#confirmNewImageLoad");
const cancelNewImageLoadButton = document.querySelector("#cancelNewImageLoad");
const cancelNewImageLoadTopButton = document.querySelector("#cancelNewImageLoadTop");
const metaImageName = document.querySelector("#metaImageName");
const metaImageDimensions = document.querySelector("#metaImageDimensions");
const metaImageSize = document.querySelector("#metaImageSize");
const metaImageType = document.querySelector("#metaImageType");
const metaImageUpdated = document.querySelector("#metaImageUpdated");
const annotationTimerValue = document.querySelector("#annotationTimerValue");
const annotationTimerStart = document.querySelector("#annotationTimerStart");
const annotationTimerStop = document.querySelector("#annotationTimerStop");
const annotationTimerReset = document.querySelector("#annotationTimerReset");
const imageLoadStatus = document.querySelector("#imageLoadStatus");
const imageLoadStatusText = document.querySelector("#imageLoadStatusText");
const imageLoadPercent = document.querySelector("#imageLoadPercent");
const imageLoadProgress = document.querySelector("#imageLoadProgress");
const imageLoadProgressFill = document.querySelector("#imageLoadProgressFill");
const labelListUnique = document.querySelector("#labelListUnique");
const labelListCount = document.querySelector("#labelListCount");
const polygonLabelList = document.querySelector("#polygonLabelList");
const renameSelectedPolygonButton = document.querySelector("#renameSelectedPolygon");
const selectedShapeColorInput = document.querySelector("#selectedShapeColor");

// Tool strip buttons
const toolPolygonBtn = document.querySelector("#toolPolygon");
const toolCurveSegmentBtn = document.querySelector("#toolCurveSegment");
const toolRectangleBtn = document.querySelector("#toolRectangle");
const toolEllipseBtn = document.querySelector("#toolEllipse");
const toolVertexEditBtn = document.querySelector("#toolVertexEdit");

// Floating dialog elements
const brightnessDialog = document.querySelector("#brightnessDialog");
const closeBrightnessBtn = document.querySelector("#closeBrightnessDialog");
const openBrightnessBtn = document.querySelector("#openBrightnessDialog");
const snapDialog = document.querySelector("#snapDialog");
const closeSnapBtn = document.querySelector("#closeSnapDialog");
const openSnapBtn = document.querySelector("#openSnapDialog");
const displayDialog = document.querySelector("#displayDialog");
const closeDisplayBtn = document.querySelector("#closeDisplayDialog");
const openDisplayBtn = document.querySelector("#openDisplayDialog");

// ── SECTION 2: DEFAULT SETTINGS ─────────────────────────────────────────
// These are the baseline settings we use on first load and on "Reset Defaults".
// Object.freeze() makes the object read-only so nothing accidentally mutates it.
// ── SECTION 4: APPLICATION STATE ────────────────────────────────────────
// State ownership is explicit; features read and write only their named slice.
const stateSlices = createAppState(DEFAULT_SETTINGS);
const {
  image: imageState,
  annotations: annotationState,
  interaction: interactionState,
  view: viewState,
  settings: settingsState,
  ui: uiState,
} = stateSlices;

// ── SECTION 4b: UNDO / REDO HISTORY ──────────────────────────────────────
// Snapshot-based undo/redo.  We deep-clone only the annotation-relevant
// annotation and interaction slices (shapes, drafts, selections) — never the
// image, canvas, or view transform. The stacks live outside the slices so
// they don't get included in their own snapshots.

// Deep-clone the annotation slice of state into a plain object.
function captureSnapshot() {
  // JSON round-trip handles the nested {x,y} arrays cheaply.
  const raw = {
    annotations: annotationState.annotations,
    lastPolygonLabel: annotationState.lastPolygonLabel,
    lastEllipseLabel: annotationState.lastEllipseLabel,
    lastShapeColor: annotationState.lastShapeColor,
    currentPolygon: interactionState.currentPolygon,
    currentCurveControl: interactionState.currentCurveControl,
    curveSegmentMode: interactionState.curveSegmentMode,
    ellipseDraft: interactionState.ellipseDraft,
    rectangleDraft: interactionState.rectangleDraft,
    selectedAnnotationId: interactionState.selectedAnnotationId,
  };
  const snapshot = JSON.parse(JSON.stringify(raw));
  // selectedVertexKeys is a Set — convert to array for cloning.
  snapshot.selectedVertexKeys = [...interactionState.selectedVertexKeys];
  return snapshot;
}

// Restore a previously captured snapshot into the responsible state slices.
function restoreSnapshot(snapshot) {
  annotationState.annotations = Array.isArray(snapshot.annotations) ? snapshot.annotations : [];
  annotationState.lastPolygonLabel = snapshot.lastPolygonLabel || "polygon";
  annotationState.lastEllipseLabel = snapshot.lastEllipseLabel || "ellipse";
  annotationState.lastShapeColor = snapshot.lastShapeColor || "";
  interactionState.currentPolygon = snapshot.currentPolygon;
  interactionState.currentCurveControl = snapshot.currentCurveControl || null;
  interactionState.curveSegmentMode = Boolean(snapshot.curveSegmentMode);
  interactionState.ellipseDraft = snapshot.ellipseDraft;
  interactionState.rectangleDraft = snapshot.rectangleDraft;
  interactionState.selectedAnnotationId = snapshot.selectedAnnotationId || null;
  interactionState.selectedVertexKeys = new Set(snapshot.selectedVertexKeys);
  interactionState.activeVertex = null;
  interactionState.selectionBox = null;
}

const history = createSnapshotHistory({
  capture: captureSnapshot,
  restore: restoreSnapshot,
  maxEntries: 50,
  onRestore: redraw,
});

function undo() {
  return history.undo();
}

function redo() {
  return history.redo();
}

// ── SECTION 5: CONSTANTS & SMALL GLOBALS ────────────────────────────────
// Tool identifiers used when comparing interactionState.tool to the radio-button values.
const TOOL_POLYGON = "polygon";
const TOOL_RECTANGLE = "rectangle";
const TOOL_ELLIPSE = "ellipse";
const MIN_SHAPE_DRAG_PIXELS = 1;
const DEFAULT_POLYGON_LABEL = DEFAULT_ANNOTATION_LABELS.polygon;
const DEFAULT_ELLIPSE_LABEL = DEFAULT_ANNOTATION_LABELS.ellipse;
const DEFAULT_RECTANGLE_LABEL = getDefaultLabelForTool(TOOL_RECTANGLE);

// Base RGB colors used for default polygon/ellipse overlays.
const POLYGON_BASE_COLOR = { r: 34, g: 197, b: 94 };
const ELLIPSE_BASE_COLOR = { r: 34, g: 197, b: 94 };
const LABEL_COLOR_PALETTE = Object.freeze([
  { r: 220, g: 38, b: 38 },   // red
  { r: 234, g: 179, b: 8 },   // yellow
  { r: 37, g: 99, b: 235 },   // blue
  { r: 190, g: 24, b: 93 },   // magenta
  { r: 124, g: 58, b: 237 },  // violet
  { r: 249, g: 115, b: 22 },  // orange
  { r: 8, g: 145, b: 178 },   // cyan
  { r: 168, g: 85, b: 247 },  // purple
  { r: 194, g: 65, b: 12 },   // amber/orange deep
  { r: 127, g: 29, b: 29 },   // maroon
]);
const labelColorAssignments = new Map();

const renderInvalidation = createRenderInvalidation();
let imageLoadStatusTimer = null;
let annotationTimerIntervalId = null;
let activeImageLoadRequestId = 0;
let pendingImageFile = null;

// When the shortcuts modal opens we remember which element had focus so we
// can restore it when the modal closes (good accessibility practice).
let lastFocusedElementBeforeShortcuts = null;
let lastFocusedElementBeforeNewImageConfirm = null;

// Unified annotation selectors. Per-type indexes remain a view concern for
// rendering order and imported/exported formats; stable IDs own identity.
function getPolygonAnnotations() {
  return getAnnotationsByType(annotationState.annotations, "polygon");
}

function getEllipseAnnotations() {
  return getAnnotationsByType(annotationState.annotations, "ellipse");
}

function getPolygonAnnotation(index) {
  return getAnnotationAtTypeIndex(annotationState.annotations, "polygon", index);
}

function getEllipseAnnotation(index) {
  return getAnnotationAtTypeIndex(annotationState.annotations, "ellipse", index);
}

function getPolygonGeometry(index) {
  return getPolygonAnnotation(index)?.geometry?.points || null;
}

function getEllipseGeometry(index) {
  return getEllipseAnnotation(index)?.geometry || null;
}

function getSelectedAnnotation() {
  return getAnnotationById(annotationState.annotations, interactionState.selectedAnnotationId);
}

function getAnnotationReference(annotation) {
  if (!annotation) return null;
  return {
    id: annotation.id,
    type: annotation.type,
    index: getAnnotationTypeIndex(annotationState.annotations, annotation.id),
  };
}

function getAnnotationReferenceAt(type, index) {
  return getAnnotationReference(getAnnotationAtTypeIndex(annotationState.annotations, type, index));
}

// ── SECTION 6: CONTEXTUAL TIPS ──────────────────────────────────────────
// The right-side "Tips → Now" panel shows dynamic hints that change based
// on the current tool, mode, and annotation count.

// Format raw bytes into a compact human-readable size string.
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "-";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = value >= 10 ? value.toFixed(0) : value.toFixed(1);
  return `${rounded} ${units[unitIndex]}`;
}

function formatImageTimestamp(epochMs) {
  if (!Number.isFinite(epochMs)) {
    return "-";
  }
  return new Date(epochMs).toLocaleString();
}

function sanitizePolygonLabel(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || DEFAULT_POLYGON_LABEL;
}

function getNextLabelPaletteColor() {
  return LABEL_COLOR_PALETTE[labelColorAssignments.size % LABEL_COLOR_PALETTE.length];
}

function rgbToCss(color, alpha = null) {
  if (!color) {
    return "rgb(34, 197, 94)";
  }
  if (alpha == null) {
    return `rgb(${color.r}, ${color.g}, ${color.b})`;
  }
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

function rgbToHex(color) {
  if (!color) {
    return "#22c55e";
  }
  const toHex = (value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
}

function hexToRgb(hex) {
  const normalized = typeof hex === "string" ? hex.trim() : "";
  const match = /^#?([0-9a-f]{6})$/i.exec(normalized);
  if (!match) {
    return null;
  }
  const value = match[1];
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function getColorForLabel(label) {
  const safeLabel = sanitizePolygonLabel(label);
  if (!labelColorAssignments.has(safeLabel)) {
    labelColorAssignments.set(safeLabel, getNextLabelPaletteColor());
  }
  return labelColorAssignments.get(safeLabel);
}

function getAnnotationColor(type, index) {
  const annotation = getAnnotationAtTypeIndex(annotationState.annotations, type, index);
  const fallbackLabel = type === "ellipse" ? DEFAULT_ELLIPSE_LABEL : DEFAULT_POLYGON_LABEL;
  const label = annotation?.label || fallbackLabel;
  return annotation?.color
    ? hexToRgb(annotation.color) || getColorForLabel(label)
    : getColorForLabel(label);
}

function getAnnotationColorHex(type, index) {
  return rgbToHex(getAnnotationColor(type, index));
}

function getDefaultShapeColor() {
  return annotationState.lastShapeColor || "";
}

function getPolygonBaseColorByIndex(polygonIndex) {
  if (!Number.isInteger(polygonIndex) || polygonIndex < 0) {
    return POLYGON_BASE_COLOR;
  }
  return getAnnotationColor("polygon", polygonIndex);
}

function getEllipseBaseColorByIndex(ellipseIndex) {
  if (!Number.isInteger(ellipseIndex) || ellipseIndex < 0) {
    return ELLIPSE_BASE_COLOR;
  }
  return getAnnotationColor("ellipse", ellipseIndex);
}

function normalizePolygonLabels() {
  rememberAnnotationLabel(annotationState, "polygon", getRememberedAnnotationLabel(annotationState, "polygon"));
}

function normalizeEllipseLabels() {
  rememberAnnotationLabel(annotationState, "ellipse", getRememberedAnnotationLabel(annotationState, "ellipse"));
}

function getPolygonLabel(index) {
  normalizePolygonLabels();
  return sanitizePolygonLabel(getPolygonAnnotation(index)?.label || DEFAULT_POLYGON_LABEL);
}

function getEllipseLabel(index) {
  normalizeEllipseLabels();
  return sanitizePolygonLabel(getEllipseAnnotation(index)?.label || DEFAULT_ELLIPSE_LABEL);
}

function getPolygonAnchorPoint(polygonIndex) {
  const polygon = getPolygonGeometry(polygonIndex);
  if (!Array.isArray(polygon) || polygon.length === 0) {
    return null;
  }
  return polygon[polygon.length - 1];
}

function getEllipseAnchorPoint(ellipseIndex) {
  const ellipse = getEllipseGeometry(ellipseIndex);
  if (!ellipse) {
    return null;
  }
  return { x: ellipse.cx, y: ellipse.cy };
}

function getKnownAnnotationLabels() {
  normalizePolygonLabels();
  normalizeEllipseLabels();
  const countByLabel = new Map();
  getPolygonAnnotations().forEach(({ label }) => {
    const safeLabel = sanitizePolygonLabel(label);
    countByLabel.set(safeLabel, (countByLabel.get(safeLabel) || 0) + 1);
  });
  getEllipseAnnotations().forEach(({ label }) => {
    const safeLabel = sanitizePolygonLabel(label);
    countByLabel.set(safeLabel, (countByLabel.get(safeLabel) || 0) + 1);
  });
  return [...countByLabel.entries()]
    .sort((left, right) => {
      const byCount = right[1] - left[1];
      if (byCount !== 0) {
        return byCount;
      }
      return left[0].localeCompare(right[0]);
    })
    .map(([label]) => label);
}

function renderCanvasLabelSuggestions(activeLabel = "") {
  if (!canvasLabelEditorSuggestions) {
    return;
  }
  const safeActiveLabel = sanitizePolygonLabel(activeLabel || "");
  const knownLabels = getKnownAnnotationLabels();
  if (knownLabels.length === 0) {
    const empty = document.createElement("li");
    empty.className = "canvas-label-editor-suggestion-empty";
    empty.textContent = "No existing labels yet";
    canvasLabelEditorSuggestions.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  knownLabels.forEach((label) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "canvas-label-editor-suggestion";
    button.dataset.label = label;
    button.textContent = label;
    if (label === safeActiveLabel) {
      button.classList.add("is-match");
    }
    item.append(button);
    fragment.append(item);
  });
  canvasLabelEditorSuggestions.replaceChildren(fragment);
}

function hideCanvasContextMenu() {
  if (!canvasContextMenu) {
    return;
  }
  canvasContextMenu.setAttribute("hidden", "");
  canvasContextMenu.setAttribute("aria-hidden", "true");
}

function isCanvasContextMenuOpen() {
  return Boolean(canvasContextMenu && !canvasContextMenu.hasAttribute("hidden"));
}

function setContextMenuItemEnabled(action, enabled) {
  if (!canvasContextMenu) {
    return;
  }
  const item = canvasContextMenu.querySelector(`[data-action="${action}"]`);
  if (!(item instanceof HTMLButtonElement)) {
    return;
  }
  item.disabled = !enabled;
}

function updateCanvasContextMenuState() {
  if (!canvasContextMenu) {
    return;
  }
  normalizeSelectedAnnotation();
  const hasImage = Boolean(imageState.image);
  const selectedAnnotation = getSelectedAnnotation();
  const hasAnnotations = annotationState.annotations.length > 0;
  const hasSelectedAnnotation = Boolean(selectedAnnotation);
  const hasSelectedLabelableAnnotation =
    selectedAnnotation &&
    (selectedAnnotation.type === "polygon" || selectedAnnotation.type === "ellipse");
  const canDeleteVertices = interactionState.vertexEditEnabled && interactionState.selectedVertexKeys.size > 0;
  const canToggleCurveSegment =
    hasImage && !interactionState.vertexEditEnabled && interactionState.tool === TOOL_POLYGON && interactionState.currentPolygon.length > 0;
  const hasDraftShapes =
    interactionState.currentPolygon.length > 0 ||
    Boolean(interactionState.currentCurveControl) ||
    Boolean(interactionState.ellipseDraft) ||
    Boolean(interactionState.rectangleDraft);

  setContextMenuItemEnabled("tool-polygon", hasImage);
  setContextMenuItemEnabled("curve-segment-toggle", canToggleCurveSegment);
  setContextMenuItemEnabled("tool-rectangle", hasImage);
  setContextMenuItemEnabled("tool-ellipse", hasImage);
  setContextMenuItemEnabled("vertex-edit-toggle", hasImage);
  setContextMenuItemEnabled("rename-selected", Boolean(hasSelectedLabelableAnnotation));
  setContextMenuItemEnabled("duplicate-selected", hasSelectedAnnotation);
  setContextMenuItemEnabled("delete-selected-annotation", hasSelectedAnnotation);
  setContextMenuItemEnabled("delete-selected-vertices", canDeleteVertices);
  setContextMenuItemEnabled("cancel-drawing", hasDraftShapes);
  setContextMenuItemEnabled("clear-all", hasAnnotations || hasDraftShapes);
  setContextMenuItemEnabled("undo", history.canUndo);
  setContextMenuItemEnabled("redo", history.canRedo);
  setContextMenuItemEnabled("zoom-in", hasImage);
  setContextMenuItemEnabled("zoom-out", hasImage);
  setContextMenuItemEnabled("zoom-reset", hasImage);

  const editToggle = canvasContextMenu.querySelector('[data-action="vertex-edit-toggle"]');
  const editLabel = editToggle?.querySelector("span");
  if (editLabel) {
    editLabel.textContent = interactionState.vertexEditEnabled ? "Exit Edit Mode" : "Edit Vertices";
  }
  const curveToggle = canvasContextMenu.querySelector('[data-action="curve-segment-toggle"]');
  const curveLabel = curveToggle?.querySelector("span");
  if (curveLabel) {
    curveLabel.textContent = interactionState.curveSegmentMode ? "Cancel Curve Edge" : "Curve Next Edge";
  }
}

function openCanvasContextMenu(clientX, clientY) {
  if (!canvasContextMenu || !canvasWrap) {
    return;
  }
  updateCanvasContextMenuState();
  canvasContextMenu.removeAttribute("hidden");
  canvasContextMenu.setAttribute("aria-hidden", "false");

  const wrapRect = canvasWrap.getBoundingClientRect();
  const minInset = 6;
  const menuWidth = canvasContextMenu.offsetWidth || 280;
  const menuHeight = canvasContextMenu.offsetHeight || 360;
  let left = clientX - wrapRect.left;
  let top = clientY - wrapRect.top;
  const maxLeft = canvasWrap.clientWidth - menuWidth - minInset;
  const maxTop = canvasWrap.clientHeight - menuHeight - minInset;
  left = clamp(left, minInset, Math.max(minInset, maxLeft));
  top = clamp(top, minInset, Math.max(minInset, maxTop));
  canvasContextMenu.style.left = `${Math.round(left)}px`;
  canvasContextMenu.style.top = `${Math.round(top)}px`;
}

function closeCanvasContextMenu() {
  hideCanvasContextMenu();
}

function toggleVertexEditModeFromMenu() {
  interactionState.vertexEditEnabled = !interactionState.vertexEditEnabled;
  interactionState.activeVertex = null;
  interactionState.activeAnnotationDrag = null;
  interactionState.selectionBox = null;
  interactionState.isDrawing = false;
  if (!interactionState.vertexEditEnabled) {
    clearVertexSelection();
  }
  syncToolStripUI();
  redraw();
}

function switchToolFromContextMenu(tool) {
  if (interactionState.vertexEditEnabled) {
    interactionState.vertexEditEnabled = false;
    interactionState.activeVertex = null;
    interactionState.activeAnnotationDrag = null;
    interactionState.selectionBox = null;
    clearVertexSelection();
  }
  setTool(tool);
  syncToolStripUI();
}

function toggleCurveSegmentMode() {
  if (interactionState.vertexEditEnabled || interactionState.tool !== TOOL_POLYGON || interactionState.currentPolygon.length === 0) {
    return false;
  }
  interactionState.curveSegmentMode = !interactionState.curveSegmentMode;
  if (!interactionState.curveSegmentMode) {
    interactionState.currentCurveControl = null;
  }
  syncToolStripUI();
  redraw();
  return true;
}

const commandRegistry = createCommandRegistry({
  [COMMANDS.TOOL_POLYGON]: () => switchToolFromContextMenu(TOOL_POLYGON),
  [COMMANDS.TOOL_RECTANGLE]: () => switchToolFromContextMenu(TOOL_RECTANGLE),
  [COMMANDS.TOOL_ELLIPSE]: () => switchToolFromContextMenu(TOOL_ELLIPSE),
  [COMMANDS.CURVE_SEGMENT_TOGGLE]: { mutates: true, history: false, execute: toggleCurveSegmentMode },
  [COMMANDS.VERTEX_EDIT_TOGGLE]: toggleVertexEditModeFromMenu,
  [COMMANDS.ANNOTATION_RENAME_REQUEST]: () => {
    normalizeSelectedAnnotation();
    const selected = getSelectedAnnotation();
    if (selected) renameAnnotationLabel(getAnnotationReference(selected));
  },
  [COMMANDS.ANNOTATION_RENAME]: { mutates: true, execute: performRenameAnnotation },
  [COMMANDS.ANNOTATION_RENAME_CREATED]: {
    mutates: true,
    history: false,
    execute: performRenameAnnotation,
  },
  [COMMANDS.ANNOTATION_SET_COLOR]: { mutates: true, execute: performSetSelectedAnnotationColor },
  [COMMANDS.ANNOTATION_DUPLICATE]: { mutates: true, execute: performDuplicateSelectedAnnotation },
  [COMMANDS.ANNOTATION_DELETE]: { mutates: true, execute: performDeleteSelectedAnnotation },
  [COMMANDS.ANNOTATION_CREATE_ELLIPSE]: { mutates: true, execute: performFinishEllipse },
  [COMMANDS.ANNOTATION_CREATE_RECTANGLE]: { mutates: true, execute: performFinishRectangle },
  [COMMANDS.ANNOTATION_CREATE_POLYGON]: { mutates: true, execute: performFinishPolygon },
  [COMMANDS.ANNOTATION_INSERT_VERTEX]: { mutates: true, execute: performInsertVertexOnNearestEdge },
  [COMMANDS.ANNOTATION_DELETE_VERTICES]: { mutates: true, execute: performDeleteSelectedVertices },
  [COMMANDS.ANNOTATION_GEOMETRY_EDIT_START]: { mutates: true, execute: performStartGeometryEdit },
  [COMMANDS.ANNOTATION_GEOMETRY_EDIT_UPDATE]: {
    mutates: true,
    history: false,
    execute: performUpdateGeometryEdit,
  },
  [COMMANDS.ANNOTATION_GEOMETRY_EDIT_END]: {
    mutates: true,
    history: false,
    execute: performEndGeometryEdit,
  },
  [COMMANDS.DRAFT_ADD_POINT]: { mutates: true, execute: performAddDraftPoint },
  [COMMANDS.DRAFT_SET_CURVE_CONTROL]: { mutates: true, execute: performSetDraftCurveControl },
  [COMMANDS.DOCUMENT_REPLACE]: { mutates: true, execute: performLoadAnnotationData },
  [COMMANDS.IMAGE_REPLACE]: { mutates: true, execute: performPendingImageLoad },
  [COMMANDS.CANCEL_DRAWING]: {
    mutates: true,
    history: false,
    execute: () => cancelActiveShapePlacement({ deactivateTool: false }),
  },
  [COMMANDS.CLEAR_ALL]: { mutates: true, execute: performClearAll },
  [COMMANDS.UNDO]: undo,
  [COMMANDS.REDO]: redo,
  [COMMANDS.ZOOM_IN]: () => setViewZoom(viewState.viewZoom * 1.25),
  [COMMANDS.ZOOM_OUT]: () => setViewZoom(viewState.viewZoom / 1.25),
  [COMMANDS.ZOOM_RESET]: () => setViewZoom(1),
  [COMMANDS.EXPORT_JSON]: exportJson,
  [COMMANDS.EXPORT_MASK]: exportMask,
  [COMMANDS.EXPORT_INVERTED_MASK]: () => exportMask({ inverted: true }),
}, { history });

function runCanvasContextAction(action) {
  commandRegistry.execute(action);
}

function hideCanvasLabelEditor() {
  if (!canvasLabelEditor) {
    return;
  }
  canvasLabelEditor.setAttribute("hidden", "");
  canvasLabelEditor.setAttribute("aria-hidden", "true");
}

function isCanvasLabelEditorOpen() {
  return Boolean(canvasLabelEditor && !canvasLabelEditor.hasAttribute("hidden"));
}

function positionCanvasLabelEditor(anchorImagePoint) {
  if (!canvasLabelEditor || !canvasWrap || !imageState.imageSize) {
    return;
  }
  const fallbackImagePoint = {
    x: imageState.imageSize.width / 2,
    y: imageState.imageSize.height / 2,
  };
  const imagePoint = anchorImagePoint || fallbackImagePoint;
  const canvasPoint = scalePoint(imagePoint);
  const wrapRect = canvasWrap.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();

  let left = canvasRect.left - wrapRect.left + canvasPoint.x + 12;
  let top = canvasRect.top - wrapRect.top + canvasPoint.y + 12;

  const minInset = 8;
  const panelWidth = canvasLabelEditor.offsetWidth || 240;
  const panelHeight = canvasLabelEditor.offsetHeight || 104;
  const maxLeft = canvasWrap.clientWidth - panelWidth - minInset;
  const maxTop = canvasWrap.clientHeight - panelHeight - minInset;

  left = clamp(left, minInset, Math.max(minInset, maxLeft));
  top = clamp(top, minInset, Math.max(minInset, maxTop));

  canvasLabelEditor.style.left = `${Math.round(left)}px`;
  canvasLabelEditor.style.top = `${Math.round(top)}px`;
}

function openCanvasLabelEditor(options) {
  if (!canvasLabelEditor || !canvasLabelEditorInput) {
    return false;
  }
  closeCanvasContextMenu();
  const annotationType = options?.annotationType === "ellipse" ? "ellipse" : "polygon";
  const fallbackIndex = options?.annotationIndex ?? options?.polygonIndex;
  const annotationIndex = Number(fallbackIndex);
  const annotation = getAnnotationAtTypeIndex(annotationState.annotations, annotationType, annotationIndex);
  const isValidPolygon =
    annotationType === "polygon" &&
    Boolean(annotation);
  const isValidEllipse =
    annotationType === "ellipse" &&
    Boolean(annotation);
  if (!isValidPolygon && !isValidEllipse) {
    return false;
  }
  const reason = options?.reason === "rename" ? "rename" : "creation";
  const anchorImagePoint =
    options?.anchorImagePoint ||
    (annotationType === "ellipse"
      ? getEllipseAnchorPoint(annotationIndex)
      : getPolygonAnchorPoint(annotationIndex));
  const currentLabel =
    annotationType === "ellipse" ? getEllipseLabel(annotationIndex) : getPolygonLabel(annotationIndex);
  const fallbackLabel = sanitizePolygonLabel(
    options?.initialLabel || currentLabel || getRememberedAnnotationLabel(annotationState, annotationType)
  );
  uiState.activeLabelEdit = {
    annotationId: annotation.id,
    annotationType,
    annotationIndex,
    reason,
    anchorImagePoint,
  };
  if (canvasLabelEditorTitle) {
    const noun = annotationType === "ellipse" ? "Ellipse" : "Polygon";
    canvasLabelEditorTitle.textContent = reason === "creation" ? `${noun} label` : `Rename ${noun.toLowerCase()} label`;
  }
  canvasLabelEditorInput.value = fallbackLabel;
  renderCanvasLabelSuggestions(fallbackLabel);
  canvasLabelEditor.removeAttribute("hidden");
  canvasLabelEditor.setAttribute("aria-hidden", "false");
  positionCanvasLabelEditor(anchorImagePoint);
  requestAnimationFrame(() => {
    canvasLabelEditorInput.focus();
    canvasLabelEditorInput.select();
  });
  return true;
}

function closeCanvasLabelEditor(options = {}) {
  if (!canvasLabelEditor) {
    uiState.activeLabelEdit = null;
    return false;
  }
  const commit = Boolean(options.commit);
  let labelChanged = false;
  const edit = uiState.activeLabelEdit;
  const isCreationEdit = Boolean(edit && edit.reason === "creation");
  if (commit && edit) {
    normalizePolygonLabels();
    normalizeEllipseLabels();
    if (edit.annotationId) {
      const annotation = getAnnotationById(annotationState.annotations, edit.annotationId);
      if (!annotation) {
        uiState.activeLabelEdit = null;
        hideCanvasLabelEditor();
        return false;
      }
      const currentLabel = annotation.label;
      const nextLabel = sanitizePolygonLabel(canvasLabelEditorInput?.value);
      if (nextLabel !== currentLabel) {
        const commandName =
          edit.reason === "rename" ? COMMANDS.ANNOTATION_RENAME : COMMANDS.ANNOTATION_RENAME_CREATED;
        labelChanged = commandRegistry.execute(commandName, {
          annotationId: annotation.id,
          label: nextLabel,
        });
      }
      if (!labelChanged) rememberAnnotationLabel(annotationState, annotation.type, nextLabel);
    }
  }
  uiState.activeLabelEdit = null;
  hideCanvasLabelEditor();
  if (labelChanged || isCreationEdit) {
    redraw();
  } else {
    renderLabelPanels();
  }
  return labelChanged;
}

function renderLabelPanels() {
  if (!labelListUnique || !polygonLabelList || !labelListCount) {
    return;
  }
  normalizePolygonLabels();
  normalizeEllipseLabels();

  const nextRenderKey = JSON.stringify({
    annotations: annotationState.annotations.map(({ id, type, label, color }) => ({ id, type, label, color })),
    selectedAnnotationId: interactionState.selectedAnnotationId,
  });
  if (!renderInvalidation.hasChanged("label-panels", nextRenderKey)) {
    return;
  }

  labelListCount.textContent = String(annotationState.annotations.length);

  const labelCountMap = new Map();
  annotationState.annotations.forEach(({ label }) => {
    labelCountMap.set(label, (labelCountMap.get(label) || 0) + 1);
  });

  const uniqueItems = [...labelCountMap.entries()].sort((left, right) => {
    const byCount = right[1] - left[1];
    if (byCount !== 0) {
      return byCount;
    }
    return left[0].localeCompare(right[0]);
  });

  const uniqueFragment = document.createDocumentFragment();
  if (uniqueItems.length === 0) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "label-list-item label-list-item--unique";
    const text = document.createElement("span");
    text.className = "label-list-item-label";
    text.textContent = "No labels yet";
    emptyItem.append(text);
    uniqueFragment.append(emptyItem);
  } else {
    uniqueItems.forEach(([label, count]) => {
      const item = document.createElement("li");
      item.className = "label-list-item label-list-item--unique";
      const labelSpan = document.createElement("span");
      labelSpan.className = "label-list-item-label";
      const swatch = document.createElement("span");
      swatch.className = "label-list-item-swatch";
      swatch.style.backgroundColor = rgbToCss(getColorForLabel(label));
      const text = document.createElement("span");
      text.textContent = label;
      labelSpan.append(swatch, text);
      const countSpan = document.createElement("span");
      countSpan.className = "label-list-item-meta";
      countSpan.textContent = count === 1 ? "1 shape" : `${count} shapes`;
      item.append(labelSpan, countSpan);
      uniqueFragment.append(item);
    });
  }
  labelListUnique.replaceChildren(uniqueFragment);

  if (selectedShapeColorInput) {
    normalizeSelectedAnnotation();
    const selected = getSelectedAnnotation();
    if (selected) {
      const reference = getAnnotationReference(selected);
      selectedShapeColorInput.disabled = false;
      selectedShapeColorInput.value = getAnnotationColorHex(
        reference.type,
        reference.index
      );
    } else {
      selectedShapeColorInput.disabled = true;
      selectedShapeColorInput.value = "#22c55e";
    }
  }

  const polygonFragment = document.createDocumentFragment();
  const annotationEntries = getAnnotationSequence();
  if (annotationEntries.length === 0) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "label-list-item label-list-item--unique";
    const text = document.createElement("span");
    text.className = "label-list-item-label";
    text.textContent = "No shapes yet";
    emptyItem.append(text);
    polygonFragment.append(emptyItem);
  } else {
    annotationEntries.forEach((entry) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "label-list-item label-list-item--polygon";
      button.dataset.annotationId = entry.id;
      button.dataset.annotationType = entry.type;
      button.dataset.annotationIndex = String(entry.index);
      if (isAnnotationSelected(entry.type, entry.index)) {
        button.classList.add("is-selected");
      }

      const labelSpan = document.createElement("span");
      labelSpan.className = "label-list-item-label";
      const labelText = entry.type === "ellipse" ? getEllipseLabel(entry.index) : getPolygonLabel(entry.index);
      const swatch = document.createElement("span");
      swatch.className = "label-list-item-swatch";
      swatch.style.backgroundColor = rgbToCss(getAnnotationColor(entry.type, entry.index));
      const text = document.createElement("span");
      text.textContent = labelText;
      labelSpan.append(swatch, text);

      const indexSpan = document.createElement("span");
      indexSpan.className = "label-list-item-meta";
      const prefix = entry.type === "ellipse" ? "E" : "P";
      indexSpan.textContent = `${prefix}#${entry.index + 1}`;
      button.append(labelSpan, indexSpan);
      item.append(button);
      polygonFragment.append(item);
    });
  }
  polygonLabelList.replaceChildren(polygonFragment);
}

function renderImageMetadata() {
  const name = imageState.imageName || "-";
  const dimensions = imageState.imageSize
    ? `${imageState.imageSize.width} x ${imageState.imageSize.height}px`
    : "-";
  const fileSize = formatBytes(imageState.imageFileSizeBytes);
  const fileType = imageState.imageFileType || (imageState.image ? "image/png" : "-");
  const updated = formatImageTimestamp(imageState.imageLastModified);
  const nextKey = [name, dimensions, fileSize, fileType, updated].join("|");
  if (!renderInvalidation.hasChanged("image-metadata", nextKey)) {
    return;
  }
  if (metaImageName) {
    metaImageName.textContent = name;
  }
  if (metaImageDimensions) {
    metaImageDimensions.textContent = dimensions;
  }
  if (metaImageSize) {
    metaImageSize.textContent = fileSize;
  }
  if (metaImageType) {
    metaImageType.textContent = fileType;
  }
  if (metaImageUpdated) {
    metaImageUpdated.textContent = updated;
  }
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function getAnnotationElapsedMs(now = Date.now()) {
  const baseElapsed = Math.max(0, annotationState.annotationElapsedMs || 0);
  if (!annotationState.annotationTimerRunning || !Number.isFinite(annotationState.annotationLastStartedMs)) {
    return baseElapsed;
  }
  return baseElapsed + Math.max(0, now - annotationState.annotationLastStartedMs);
}

function renderAnnotationTimer() {
  const hasImage = Boolean(imageState.image && imageState.imageSize);
  const elapsedMs = getAnnotationElapsedMs();
  if (annotationTimerValue) {
    annotationTimerValue.textContent = formatDuration(elapsedMs);
  }
  if (annotationTimerStart) {
    annotationTimerStart.disabled = !hasImage || annotationState.annotationTimerRunning;
  }
  if (annotationTimerStop) {
    annotationTimerStop.disabled = !hasImage || !annotationState.annotationTimerRunning;
  }
  if (annotationTimerReset) {
    annotationTimerReset.disabled = !hasImage || (!annotationState.annotationStartedAt && elapsedMs === 0);
  }
}

function stopAnnotationTimerInterval() {
  if (annotationTimerIntervalId != null) {
    clearInterval(annotationTimerIntervalId);
    annotationTimerIntervalId = null;
  }
}

function startAnnotationTimer() {
  if (!imageState.image || !imageState.imageSize || annotationState.annotationTimerRunning) {
    renderAnnotationTimer();
    return;
  }
  const now = Date.now();
  annotationState.annotationTimerRunning = true;
  annotationState.annotationEndedAt = null;
  annotationState.annotationLastStartedMs = now;
  if (!annotationState.annotationStartedAt) {
    annotationState.annotationStartedAt = new Date(now).toISOString();
  }
  stopAnnotationTimerInterval();
  annotationTimerIntervalId = setInterval(renderAnnotationTimer, 1000);
  renderAnnotationTimer();
}

function stopAnnotationTimer(options = {}) {
  if (!annotationState.annotationStartedAt) {
    renderAnnotationTimer();
    return;
  }
  const now = Date.now();
  if (annotationState.annotationTimerRunning) {
    annotationState.annotationElapsedMs = getAnnotationElapsedMs(now);
  }
  annotationState.annotationTimerRunning = false;
  annotationState.annotationLastStartedMs = null;
  stopAnnotationTimerInterval();
  if (options.markEnded) {
    annotationState.annotationEndedAt = new Date(now).toISOString();
  }
  renderAnnotationTimer();
}

function resetAnnotationTimer() {
  stopAnnotationTimerInterval();
  annotationState.annotationTimerRunning = false;
  annotationState.annotationStartedAt = null;
  annotationState.annotationEndedAt = null;
  annotationState.annotationElapsedMs = 0;
  annotationState.annotationLastStartedMs = null;
  renderAnnotationTimer();
}

function getAnnotationTimingMetadata() {
  const durationMs = Math.round(getAnnotationElapsedMs());
  return {
    startedAt: annotationState.annotationStartedAt,
    endedAt: annotationState.annotationEndedAt,
    durationMs,
    durationSeconds: round(durationMs / 1000),
    durationDisplay: formatDuration(durationMs),
    running: annotationState.annotationTimerRunning,
  };
}

function renderImageLoadStatus() {
  if (
    !imageLoadStatus ||
    !imageLoadStatusText ||
    !imageLoadPercent ||
    !imageLoadProgress ||
    !imageLoadProgressFill
  ) {
    return;
  }
  const status = imageState.imageLoadStatus;
  const progress = clamp(Math.round(imageState.imageLoadProgress || 0), 0, 100);
  const message =
    imageState.imageLoadMessage ||
    (status === "error"
      ? "Image load failed."
      : status === "success"
        ? "Image ready."
        : "Loading image...");
  const visible = status === "loading" || status === "success" || status === "error";
  const nextKey = `${visible}|${status}|${progress}|${message}`;
  if (!renderInvalidation.hasChanged("image-load-status", nextKey)) {
    return;
  }
  imageLoadStatus.hidden = !visible;
  if (!visible) {
    imageLoadStatus.removeAttribute("data-state");
    return;
  }
  imageLoadStatus.dataset.state = status;
  imageLoadStatusText.textContent = message;
  imageLoadPercent.textContent = `${progress}%`;
  imageLoadProgress.setAttribute("aria-valuenow", String(progress));
  imageLoadProgressFill.style.width = `${progress}%`;
}

function setImageLoadState(status, progress, message, options = {}) {
  const { autoHideSuccess = true } = options;
  imageState.imageLoadStatus = status;
  imageState.imageLoadProgress = clamp(Math.round(progress || 0), 0, 100);
  imageState.imageLoadMessage = message || "";
  if (imageLoadStatusTimer) {
    clearTimeout(imageLoadStatusTimer);
    imageLoadStatusTimer = null;
  }
  renderImageLoadStatus();
  if (status === "success" && autoHideSuccess) {
    imageLoadStatusTimer = setTimeout(() => {
      if (imageState.imageLoadStatus !== "success") {
        return;
      }
      imageState.imageLoadStatus = "idle";
      imageState.imageLoadProgress = 0;
      imageState.imageLoadMessage = "";
      renderImageLoadStatus();
    }, 1400);
  }
}

function waitForNextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function isNewImageConfirmModalOpen() {
  return Boolean(newImageConfirmModal && !newImageConfirmModal.hasAttribute("hidden"));
}

function openNewImageConfirmModal(file) {
  if (!newImageConfirmModal) {
    return false;
  }
  pendingImageFile = file;
  if (document.activeElement instanceof HTMLElement) {
    lastFocusedElementBeforeNewImageConfirm = document.activeElement;
  }
  newImageConfirmModal.removeAttribute("hidden");
  newImageConfirmModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  if (confirmNewImageLoadButton) {
    confirmNewImageLoadButton.focus();
  }
  return true;
}

function closeNewImageConfirmModal() {
  if (!newImageConfirmModal || !isNewImageConfirmModalOpen()) {
    pendingImageFile = null;
    return;
  }
  newImageConfirmModal.setAttribute("hidden", "");
  newImageConfirmModal.setAttribute("aria-hidden", "true");
  if (!isShortcutsModalOpen()) {
    document.body.classList.remove("modal-open");
  }
  pendingImageFile = null;
  if (lastFocusedElementBeforeNewImageConfirm instanceof HTMLElement) {
    lastFocusedElementBeforeNewImageConfirm.focus();
  }
}

function isShortcutsModalOpen() {
  return Boolean(shortcutsModal && !shortcutsModal.hasAttribute("hidden"));
}

// Open shortcuts modal and move focus to close button.
function openShortcutsModal() {
  if (!shortcutsModal || isShortcutsModalOpen()) {
    return;
  }
  if (document.activeElement instanceof HTMLElement) {
    lastFocusedElementBeforeShortcuts = document.activeElement;
  }
  shortcutsModal.removeAttribute("hidden");
  shortcutsModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  if (closeShortcutsButton) {
    closeShortcutsButton.focus();
  }
}

// Close shortcuts modal and restore focus.
function closeShortcutsModal() {
  if (!shortcutsModal || !isShortcutsModalOpen()) {
    return;
  }
  shortcutsModal.setAttribute("hidden", "");
  shortcutsModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
  if (lastFocusedElementBeforeShortcuts instanceof HTMLElement) {
    lastFocusedElementBeforeShortcuts.focus();
  }
}

// Keep keyboard focus trapped inside a modal while it is open.
function handleModalTab(event, modal) {
  if (!modal) {
    return;
  }
  const focusableElements = modal.querySelectorAll(
    "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
  );
  if (focusableElements.length === 0) {
    event.preventDefault();
    return;
  }
  const focusable = Array.from(focusableElements).filter((element) => {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    return !element.hasAttribute("disabled");
  });
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
    return;
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function handleShortcutsModalTab(event) {
  handleModalTab(event, shortcutsModal);
}

// ── SECTION 7: TOOL & DRAWING MANAGEMENT ────────────────────────────────
// Functions that control which drawing tool is active, how images are loaded,
// and how the canvas viewport (zoom / pan) behaves.

// Switch tools and reset any in-progress drawing.
function hasAnnotationState() {
  return (
    annotationState.annotations.length > 0 ||
    interactionState.currentPolygon.length > 0 ||
    Boolean(interactionState.currentCurveControl) ||
    Boolean(interactionState.rectangleDraft) ||
    Boolean(interactionState.ellipseDraft)
  );
}

function clearAnnotationsForNewImage() {
  labelColorAssignments.clear();
  annotationState.annotations = [];
  interactionState.currentPolygon = [];
  interactionState.currentCurveControl = null;
  interactionState.curveSegmentMode = false;
  interactionState.rectangleDraft = null;
  interactionState.ellipseDraft = null;
  interactionState.activeVertex = null;
  interactionState.activeAnnotationDrag = null;
  interactionState.selectionBox = null;
  selectAnnotation(null);
  clearVertexSelection();
}

// Load a PNG image from the file input.
function loadImage(file) {
  closeCanvasLabelEditor();
  closeCanvasContextMenu();
  if (hasAnnotationState()) {
    return openNewImageConfirmModal(file);
  }
  return startImageLoad(file);
}

function confirmPendingImageLoad() {
  return commandRegistry.execute(COMMANDS.IMAGE_REPLACE);
}

function performPendingImageLoad() {
  const file = pendingImageFile;
  if (!file) {
    closeNewImageConfirmModal();
    return false;
  }
  closeNewImageConfirmModal();
  clearAnnotationsForNewImage();
  return startImageLoad(file);
}

function cancelPendingImageLoad() {
  closeNewImageConfirmModal();
  if (imageInput) {
    imageInput.value = "";
  }
}

function startImageLoad(file) {
  labelColorAssignments.clear();
  resetAnnotationTimer();
  const requestId = ++activeImageLoadRequestId;
  imageState.imageName = file.name || "";
  imageState.imageFileSizeBytes = Number.isFinite(file.size) ? file.size : null;
  imageState.imageFileType = file.type || "image/png";
  imageState.imageLastModified = Number.isFinite(file.lastModified) ? file.lastModified : null;
  renderImageMetadata();
  setImageLoadState("loading", 0, "Reading image file...", { autoHideSuccess: false });
  renderAnnotationTimer();

  const reader = new FileReader();
  reader.onloadstart = () => {
    if (requestId !== activeImageLoadRequestId) {
      return;
    }
    setImageLoadState("loading", 5, "Reading image file...", { autoHideSuccess: false });
  };
  reader.onprogress = (progressEvent) => {
    if (requestId !== activeImageLoadRequestId) {
      return;
    }
    if (progressEvent.lengthComputable && progressEvent.total > 0) {
      const ratio = progressEvent.loaded / progressEvent.total;
      setImageLoadState("loading", 5 + ratio * 60, "Reading image file...", { autoHideSuccess: false });
    }
  };
  reader.onerror = () => {
    if (requestId !== activeImageLoadRequestId) {
      return;
    }
    setImageLoadState("error", 100, "Could not read the image file.");
    alert("Could not read the selected PNG file.");
  };
  reader.onload = (event) => {
    if (requestId !== activeImageLoadRequestId) {
      return;
    }
    const imageDataUrl = event.target?.result;
    if (typeof imageDataUrl !== "string") {
      setImageLoadState("error", 100, "Image read failed.");
      alert("Could not decode image file contents.");
      return;
    }
    const img = new Image();
    img.onload = async () => {
      if (requestId !== activeImageLoadRequestId) {
        return;
      }
      try {
        setImageLoadState("loading", 72, "Decoding PNG...", { autoHideSuccess: false });
        await waitForNextFrame();

        const equalizedImage = buildHistogramEqualizedCanvas(img);
        if (requestId !== activeImageLoadRequestId) {
          return;
        }

        setImageLoadState("loading", 86, "Analyzing image...", { autoHideSuccess: false });
        await waitForNextFrame();

        const imageAnalysisOriginal = buildImageAnalysisData(img);
        const imageAnalysisEqualized = equalizedImage
          ? buildImageAnalysisData(equalizedImage)
          : null;
        if (requestId !== activeImageLoadRequestId) {
          return;
        }

        setImageLoadState("loading", 98, "Rendering image...", { autoHideSuccess: false });
        await waitForNextFrame();

        imageState.image = img;
        imageState.imageName = file.name;
        imageState.imageSize = { width: img.width, height: img.height };
        imageState.equalizedImage = equalizedImage;
        imageState.imageAnalysisOriginal = imageAnalysisOriginal;
        imageState.imageAnalysisEqualized = imageAnalysisEqualized;
        resizeCanvasToImage();
        resetViewTransform();
        emptyState.style.display = "none";
        renderImageMetadata();
        redraw();
        setImageLoadState("success", 100, "Image ready.");
        renderAnnotationTimer();
      } catch (error) {
        if (requestId !== activeImageLoadRequestId) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        setImageLoadState("error", 100, "Image processing failed.");
        alert(`Could not process image: ${message}`);
      }
    };
    img.onerror = () => {
      if (requestId !== activeImageLoadRequestId) {
        return;
      }
      setImageLoadState("error", 100, "PNG decode failed.");
      alert("Could not decode the selected PNG. The file may be corrupt.");
    };
    setImageLoadState("loading", 70, "Decoding PNG...", { autoHideSuccess: false });
    img.src = imageDataUrl;
  };
  reader.readAsDataURL(file);
  return true;
}

// Resize the canvas to fit available space while keeping aspect ratio.
// Canvas coordinates, zoom, and pan are owned by the view controller.

// ── SECTION 8: ANNOTATION SELECTION & CYCLING ───────────────────────────
// Annotations (polygons + ellipses) can be selected one at a time.
// Tab / Shift+Tab cycles through them so users can quickly review or delete.

// Build a flat, ordered list of annotations used for cycling/selection.
function getAnnotationSequence() {
  const polygonEntries = getPolygonAnnotations().map((annotation, index) => ({
    id: annotation.id,
    type: "polygon",
    index,
  }));
  const ellipseEntries = getEllipseAnnotations().map((annotation, index) => ({
    id: annotation.id,
    type: "ellipse",
    index,
  }));
  return [...polygonEntries, ...ellipseEntries];
}

// Verify selected annotation still points to a valid shape after edits/deletes.
function normalizeSelectedAnnotation() {
  if (interactionState.selectedAnnotationId && !getSelectedAnnotation()) {
    interactionState.selectedAnnotationId = null;
  }
}

// Set currently selected annotation (or clear it with null).
function selectAnnotation(annotation) {
  if (!annotation) {
    interactionState.selectedAnnotationId = null;
    return;
  }
  const resolved = annotation.id
    ? getAnnotationById(annotationState.annotations, annotation.id)
    : getAnnotationAtTypeIndex(annotationState.annotations, annotation.type, Number(annotation.index));
  interactionState.selectedAnnotationId = resolved?.id || null;
}

function clearSelectionForShapeCreation() {
  selectAnnotation(null);
  clearTransientEditState();
}

function clearTransientEditState() {
  interactionState.activeVertex = null;
  interactionState.activeAnnotationDrag = null;
  interactionState.selectionBox = null;
  interactionState.isDrawing = false;
  clearVertexSelection();
}

function renameAnnotationLabel(annotation) {
  if (!annotation || (annotation.type !== "polygon" && annotation.type !== "ellipse")) {
    return false;
  }
  const resolved = annotation.id
    ? getAnnotationById(annotationState.annotations, annotation.id)
    : getAnnotationAtTypeIndex(annotationState.annotations, annotation.type, Number(annotation.index));
  if (!resolved) return false;
  const annotationIndex = getAnnotationTypeIndex(annotationState.annotations, resolved.id);
  const isPolygon = resolved.type === "polygon";
  normalizePolygonLabels();
  normalizeEllipseLabels();
  selectAnnotation(resolved);
  const opened = openCanvasLabelEditor({
    annotationType: resolved.type,
    annotationIndex,
    initialLabel: isPolygon ? getPolygonLabel(annotationIndex) : getEllipseLabel(annotationIndex),
    anchorImagePoint: isPolygon ? getPolygonAnchorPoint(annotationIndex) : getEllipseAnchorPoint(annotationIndex),
    reason: "rename",
  });
  if (!opened) {
    return false;
  }
  redraw();
  return true;
}

function renamePolygonLabelAtIndex(polygonIndex) {
  return renameAnnotationLabel({ type: "polygon", index: polygonIndex });
}

function performRenameAnnotation({ annotationId, label }) {
  const annotation = getAnnotationById(annotationState.annotations, annotationId);
  if (!annotation) return false;
  const nextLabel = sanitizePolygonLabel(label);
  if (annotation.label === nextLabel) {
    rememberAnnotationLabel(annotationState, annotation.type, nextLabel);
    return false;
  }
  annotation.label = nextLabel;
  rememberAnnotationLabel(annotationState, annotation.type, nextLabel);
  return true;
}

function setSelectedAnnotationColor(hexColor) {
  return commandRegistry.execute(COMMANDS.ANNOTATION_SET_COLOR, { hexColor });
}

function performSetSelectedAnnotationColor({ hexColor }) {
  normalizeSelectedAnnotation();
  const selected = getSelectedAnnotation();
  if (!selected) {
    return false;
  }
  const color = rgbToHex(hexToRgb(hexColor));
  if (selected.color === color) return false;
  annotationState.lastShapeColor = color;
  selected.color = color;
  redraw();
  return true;
}

// Check if a given shape is the currently selected annotation.
function isAnnotationSelected(type, index) {
  return getAnnotationAtTypeIndex(annotationState.annotations, type, index)?.id === interactionState.selectedAnnotationId;
}

// Cycle across all annotations; direction 1 = next, -1 = previous.
function cycleAnnotationSelection(direction = 1) {
  const sequence = getAnnotationSequence();
  if (sequence.length === 0) {
    selectAnnotation(null);
    redraw();
    return false;
  }
  normalizeSelectedAnnotation();
  if (!interactionState.selectedAnnotationId) {
    selectAnnotation(direction < 0 ? sequence[sequence.length - 1] : sequence[0]);
    redraw();
    return true;
  }
  const currentIndex = sequence.findIndex((entry) => entry.id === interactionState.selectedAnnotationId);
  if (currentIndex < 0) {
    selectAnnotation(direction < 0 ? sequence[sequence.length - 1] : sequence[0]);
    redraw();
    return true;
  }
  const nextIndex = (currentIndex + direction + sequence.length) % sequence.length;
  selectAnnotation(sequence[nextIndex]);
  redraw();
  return true;
}

function duplicateSelectedAnnotation() {
  return commandRegistry.execute(COMMANDS.ANNOTATION_DUPLICATE);
}

function performDuplicateSelectedAnnotation() {
  closeCanvasLabelEditor();
  closeCanvasContextMenu();
  normalizeSelectedAnnotation();
  const selected = getSelectedAnnotation();
  if (!selected) {
    alert("Select a shape first.");
    return false;
  }

  const duplicateOffset = 8;

  if (selected.type === "polygon") {
    const sourcePolygon = selected.geometry.points;
    if (!Array.isArray(sourcePolygon) || sourcePolygon.length < 3) {
      return false;
    }
    const duplicatePolygon = sourcePolygon.map((point) => {
      const duplicatePoint = {
        x: point.x + duplicateOffset,
        y: point.y + duplicateOffset,
      };
      if (point.curveFrom) {
        duplicatePoint.curveFrom = {
          x: point.curveFrom.x + duplicateOffset,
          y: point.curveFrom.y + duplicateOffset,
        };
      }
      return duplicatePoint;
    });
    fitPolygonInsideImage(duplicatePolygon);
    const duplicate = createPolygonAnnotation({
      label: selected.label,
      color: selected.color,
      points: duplicatePolygon,
    });
    annotationState.annotations.push(duplicate);
    clearTransientEditState();
    selectAnnotation(duplicate);
    redraw();
    return true;
  }

  if (selected.type === "ellipse") {
    const sourceEllipse = selected.geometry;
    if (!sourceEllipse) {
      return false;
    }
    const duplicateEllipse = {
      ...sourceEllipse,
      cx: sourceEllipse.cx + duplicateOffset,
      cy: sourceEllipse.cy + duplicateOffset,
    };
    fitEllipseInsideImage(duplicateEllipse);
    const duplicate = createEllipseAnnotation({
      label: selected.label,
      color: selected.color,
      ellipse: duplicateEllipse,
    });
    annotationState.annotations.push(duplicate);
    clearTransientEditState();
    selectAnnotation(duplicate);
    redraw();
    return true;
  }

  return false;
}

// Delete the selected full annotation (polygon or ellipse) without clearing canvas.
function deleteSelectedAnnotation() {
  return commandRegistry.execute(COMMANDS.ANNOTATION_DELETE);
}

function performDeleteSelectedAnnotation() {
  closeCanvasLabelEditor();
  closeCanvasContextMenu();
  normalizeSelectedAnnotation();
  const selected = getSelectedAnnotation();
  if (!selected) {
    return false;
  }

  const sequenceBefore = getAnnotationSequence();
  const selectedSequenceIndex = sequenceBefore.findIndex((entry) => entry.id === selected.id);

  if (selected.type === "polygon") {
    removeAnnotationById(annotationState.annotations, selected.id);
    // Polygon indices shift after deletion; clear per-vertex selection state safely.
    interactionState.activeVertex = null;
    clearVertexSelection();
  } else if (selected.type === "ellipse") {
    removeAnnotationById(annotationState.annotations, selected.id);
  } else {
    return false;
  }

  const sequenceAfter = getAnnotationSequence();
  if (sequenceAfter.length === 0) {
    selectAnnotation(null);
  } else {
    const fallbackIndex = clamp(selectedSequenceIndex, 0, sequenceAfter.length - 1);
    selectAnnotation(sequenceAfter[fallbackIndex]);
  }
  redraw();
  return true;
}

// Identify annotation under cursor (used for direct click selection).
function findAnnotationAtPoint(canvasPoint) {
  const hitThreshold = 8;
  const result = [];
  const polygonAnnotations = getPolygonAnnotations();
  for (let polygonIndex = 0; polygonIndex < polygonAnnotations.length; polygonIndex += 1) {
    const polygon = flattenPolygon(polygonAnnotations[polygonIndex].geometry.points).map((point) => scalePoint(point));
    if (polygon.length < 3) {
      continue;
    }
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    polygon.forEach((point) => {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    });
    if (
      canvasPoint.x < minX - hitThreshold ||
      canvasPoint.x > maxX + hitThreshold ||
      canvasPoint.y < minY - hitThreshold ||
      canvasPoint.y > maxY + hitThreshold
    ) {
      continue;
    }
    if (isPointInPolygon(canvasPoint, polygon)) {
      result.push({ id: polygonAnnotations[polygonIndex].id, type: "polygon", index: polygonIndex });
    }
  }

  const ellipseAnnotations = getEllipseAnnotations();
  for (let ellipseIndex = 0; ellipseIndex < ellipseAnnotations.length; ellipseIndex += 1) {
    const ellipse = scaleEllipse(ellipseAnnotations[ellipseIndex].geometry);
    if (ellipse.rx <= 0 || ellipse.ry <= 0) {
      continue;
    }
    const normalizedX = (canvasPoint.x - ellipse.cx) / ellipse.rx;
    const normalizedY = (canvasPoint.y - ellipse.cy) / ellipse.ry;
    if (normalizedX * normalizedX + normalizedY * normalizedY <= 1.05) {
      result.push({ id: ellipseAnnotations[ellipseIndex].id, type: "ellipse", index: ellipseIndex });
    }
  }

  return result[result.length - 1] || null;
}

// Point-in-polygon test in canvas coordinates.
function isPointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi || 1e-8) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

// Return true if keyboard event target is an editable field.
function isEditableTarget(target) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLButtonElement ||
    target?.isContentEditable
  );
}

// ── SECTION 9: ELLIPSE CREATION ─────────────────────────────────────────
// Ellipses are created with two clicks:
// 1) first click sets the center
// 2) second click sets the radius point and commits

// Begin or complete a two-click ellipse operation.
function startEllipse(point) {
  startAnnotationTimer();
  const snappedPoint = applySnap(point);
  if (!interactionState.ellipseDraft) {
    clearSelectionForShapeCreation();
    interactionState.ellipseDraft = {
      start: snappedPoint,
      end: snappedPoint,
    };
    interactionState.isDrawing = false;
    redraw();
    return;
  }
  interactionState.ellipseDraft.end = snappedPoint;
  finishEllipse();
}

// Update the ellipse draft while the cursor moves after the first click.
function updateEllipse(point) {
  if (!interactionState.ellipseDraft) {
    return;
  }
  interactionState.ellipseDraft.end = point;
  redraw();
}

// Ignore near-zero shapes so we do not commit collapsed ellipses.
function isDegenerateShapeDrag(start, end) {
  return (
    Math.abs(end.x - start.x) < MIN_SHAPE_DRAG_PIXELS ||
    Math.abs(end.y - start.y) < MIN_SHAPE_DRAG_PIXELS
  );
}

// Finalize the ellipse and store it.
function finishEllipse() {
  return commandRegistry.execute(COMMANDS.ANNOTATION_CREATE_ELLIPSE);
}

function performFinishEllipse() {
  if (!interactionState.ellipseDraft) {
    return false;
  }
  const { start, end } = interactionState.ellipseDraft;
  if (isDegenerateShapeDrag(start, end)) {
    interactionState.ellipseDraft.end = start;
    redraw();
    return false;
  }
  const ellipse = toEllipse(start, end);
  const label = DEFAULT_ELLIPSE_LABEL;
  const anchorImagePoint = { ...end };
  const annotation = createEllipseAnnotation({
    label,
    color: getDefaultShapeColor(),
    ellipse,
  });
  annotationState.annotations.push(annotation);
  const ellipseIndex = getAnnotationTypeIndex(annotationState.annotations, annotation.id);
  selectAnnotation(null);
  interactionState.ellipseDraft = null;
  interactionState.isDrawing = false;
  openCanvasLabelEditor({
    annotationType: "ellipse",
    annotationIndex: ellipseIndex,
    initialLabel: label,
    anchorImagePoint,
    reason: "creation",
  });
  redraw();
  return true;
}

// Convert center + radius-point into ellipse parameters.
function toEllipse(start, end) {
  const cx = start.x;
  const cy = start.y;
  const rx = Math.abs(start.x - end.x);
  const ry = Math.abs(start.y - end.y);
  return { cx, cy, rx, ry, rotation: 0 };
}

// ── SECTION 9b: RECTANGLE CREATION ──────────────────────────────────────
// Rectangles are created with two clicks:
// 1) first click sets the first corner
// 2) second click sets the opposite corner and commits a 4-point polygon
// Once created, the rectangle is stored as a regular polygon and can be
// freely edited in vertex edit mode like any other polygon.

// Begin or complete a two-click rectangle operation.
function startRectangle(point) {
  startAnnotationTimer();
  const snappedPoint = applySnap(point);
  if (!interactionState.rectangleDraft) {
    clearSelectionForShapeCreation();
    interactionState.rectangleDraft = {
      start: snappedPoint,
      end: snappedPoint,
    };
    interactionState.isDrawing = false;
    redraw();
    return;
  }
  interactionState.rectangleDraft.end = snappedPoint;
  finishRectangle();
}

// Update the rectangle draft while the cursor moves after first click.
function updateRectangle(point) {
  if (!interactionState.rectangleDraft) {
    return;
  }
  interactionState.rectangleDraft.end = point;
  redraw();
}

// Convert rectangle draft corners into 4 polygon vertices.
function toRectanglePoints(start, end) {
  return [
    { x: start.x, y: start.y },  // top-left
    { x: end.x,   y: start.y },  // top-right
    { x: end.x,   y: end.y },    // bottom-right
    { x: start.x, y: end.y },    // bottom-left
  ];
}

// Finalize the rectangle and store it as a polygon.
function finishRectangle() {
  return commandRegistry.execute(COMMANDS.ANNOTATION_CREATE_RECTANGLE);
}

function performFinishRectangle() {
  if (!interactionState.rectangleDraft) {
    return false;
  }
  const { start, end } = interactionState.rectangleDraft;
  if (isDegenerateShapeDrag(start, end)) {
    interactionState.rectangleDraft.end = start;
    redraw();
    return false;
  }
  const points = toRectanglePoints(start, end);
  const label = DEFAULT_RECTANGLE_LABEL;
  const annotation = createPolygonAnnotation({
    label,
    color: getDefaultShapeColor(),
    points,
  });
  annotationState.annotations.push(annotation);
  const polygonIndex = getAnnotationTypeIndex(annotationState.annotations, annotation.id);
  selectAnnotation(null);
  interactionState.rectangleDraft = null;
  interactionState.isDrawing = false;
  openCanvasLabelEditor({
    polygonIndex,
    initialLabel: label,
    anchorImagePoint: end,
    reason: "creation",
  });
  redraw();
  return true;
}

// ── SECTION 10: POLYGON CREATION ────────────────────────────────────────
// Polygons are built point-by-point: each click adds a vertex.  Clicking
// near the first vertex (snap-to-close) finalizes the polygon.

// Pixel radius (in canvas-space) within which clicking snaps to the first
// vertex and closes the polygon, matching the LabelMe snap-to-close UX.
const CLOSE_SNAP_RADIUS = 10;

// Check whether cursor (image-space) is close enough to the first vertex
// of the in-progress polygon to trigger a snap-to-close.
function isNearFirstVertex(imagePoint) {
  if (interactionState.currentPolygon.length < 3) return false;
  const first = scalePoint(interactionState.currentPolygon[0]);
  const cursor = scalePoint(imagePoint);
  const dx = first.x - cursor.x;
  const dy = first.y - cursor.y;
  return dx * dx + dy * dy <= CLOSE_SNAP_RADIUS * CLOSE_SNAP_RADIUS;
}

function makePolygonPoint(point, curveFrom = null) {
  const snappedPoint = clampPointToImage(applySnap(point));
  const polygonPoint = { x: snappedPoint.x, y: snappedPoint.y };
  if (curveFrom) {
    const snappedControl = clampPointToImage(applySnap(curveFrom));
    polygonPoint.curveFrom = { x: snappedControl.x, y: snappedControl.y };
  }
  return polygonPoint;
}

function getImageBounds() {
  if (!imageState.imageSize) {
    return null;
  }
  const maxX = Math.max(0, imageState.imageSize.width - 1);
  const maxY = Math.max(0, imageState.imageSize.height - 1);
  return {
    minX: 0,
    minY: 0,
    maxX,
    maxY,
    width: maxX,
    height: maxY,
  };
}

function clampPointToImage(point) {
  const bounds = getImageBounds();
  if (!bounds || !point) {
    return point;
  }
  return {
    x: clamp(point.x, bounds.minX, bounds.maxX),
    y: clamp(point.y, bounds.minY, bounds.maxY),
  };
}

function forEachPolygonNode(points, callback) {
  points.forEach((point) => {
    callback(point);
    if (point.curveFrom) {
      callback(point.curveFrom);
    }
  });
}

function getPolygonNodeBounds(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return null;
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  forEachPolygonNode(points, (point) => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return;
    }
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  });
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

function translatePolygonNodes(points, dx, dy) {
  forEachPolygonNode(points, (point) => {
    point.x += dx;
    point.y += dy;
  });
}

function scalePolygonNodes(points, center, scaleValue) {
  forEachPolygonNode(points, (point) => {
    point.x = center.x + (point.x - center.x) * scaleValue;
    point.y = center.y + (point.y - center.y) * scaleValue;
  });
}

function fitPolygonInsideImage(points) {
  const bounds = getImageBounds();
  const polygonBounds = getPolygonNodeBounds(points);
  if (!bounds || !polygonBounds) {
    return false;
  }

  let changed = false;
  if (polygonBounds.width > bounds.width || polygonBounds.height > bounds.height) {
    const scaleX = polygonBounds.width > 0 ? bounds.width / polygonBounds.width : 1;
    const scaleY = polygonBounds.height > 0 ? bounds.height / polygonBounds.height : 1;
    const scaleValue = Math.min(1, scaleX, scaleY);
    if (scaleValue < 1) {
      scalePolygonNodes(points, { x: polygonBounds.cx, y: polygonBounds.cy }, scaleValue);
      changed = true;
    }
  }

  const fittedBounds = getPolygonNodeBounds(points);
  if (!fittedBounds) {
    return changed;
  }
  let dx = 0;
  let dy = 0;
  if (fittedBounds.minX < bounds.minX) {
    dx = bounds.minX - fittedBounds.minX;
  } else if (fittedBounds.maxX > bounds.maxX) {
    dx = bounds.maxX - fittedBounds.maxX;
  }
  if (fittedBounds.minY < bounds.minY) {
    dy = bounds.minY - fittedBounds.minY;
  } else if (fittedBounds.maxY > bounds.maxY) {
    dy = bounds.maxY - fittedBounds.maxY;
  }
  if (dx !== 0 || dy !== 0) {
    translatePolygonNodes(points, dx, dy);
    changed = true;
  }

  forEachPolygonNode(points, (point) => {
    const clamped = clampPointToImage(point);
    if (clamped.x !== point.x || clamped.y !== point.y) {
      point.x = clamped.x;
      point.y = clamped.y;
      changed = true;
    }
  });
  return changed;
}

function clampPolygonNodesToImage(points) {
  if (!Array.isArray(points)) {
    return false;
  }
  let changed = false;
  forEachPolygonNode(points, (point) => {
    const clamped = clampPointToImage(point);
    if (clamped.x !== point.x || clamped.y !== point.y) {
      point.x = clamped.x;
      point.y = clamped.y;
      changed = true;
    }
  });
  return changed;
}

function fitEllipseInsideImage(ellipse) {
  const bounds = getImageBounds();
  if (!bounds || !ellipse) {
    return false;
  }
  let changed = false;
  const maxRx = bounds.width / 2;
  const maxRy = bounds.height / 2;
  if (ellipse.rx > maxRx || ellipse.ry > maxRy) {
    const scaleX = ellipse.rx > 0 ? maxRx / ellipse.rx : 1;
    const scaleY = ellipse.ry > 0 ? maxRy / ellipse.ry : 1;
    const scaleValue = Math.min(1, scaleX, scaleY);
    ellipse.rx *= scaleValue;
    ellipse.ry *= scaleValue;
    changed = true;
  }
  const nextCx = clamp(ellipse.cx, bounds.minX + ellipse.rx, bounds.maxX - ellipse.rx);
  const nextCy = clamp(ellipse.cy, bounds.minY + ellipse.ry, bounds.maxY - ellipse.ry);
  if (nextCx !== ellipse.cx || nextCy !== ellipse.cy) {
    ellipse.cx = nextCx;
    ellipse.cy = nextCy;
    changed = true;
  }
  return changed;
}

// Add a new vertex to the current polygon, or close it if clicking near
// the first vertex (snap-to-close).
function addPolygonPoint(point) {
  startAnnotationTimer();
  if (interactionState.currentPolygon.length === 0) {
    clearSelectionForShapeCreation();
  }
  if (isNearFirstVertex(point)) {
    finishPolygon(point);
    return;
  }
  if (interactionState.curveSegmentMode && interactionState.currentPolygon.length > 0 && !interactionState.currentCurveControl) {
    commandRegistry.execute(COMMANDS.DRAFT_SET_CURVE_CONTROL, { point });
    return;
  }
  commandRegistry.execute(COMMANDS.DRAFT_ADD_POINT, { point });
}

function performSetDraftCurveControl({ point }) {
  interactionState.currentCurveControl = applySnap(point);
  redraw();
  return true;
}

function performAddDraftPoint({ point }) {
  interactionState.currentPolygon.push(makePolygonPoint(point, interactionState.currentCurveControl));
  interactionState.currentCurveControl = null;
  interactionState.curveSegmentMode = false;
  syncToolStripUI();
  redraw();
  return true;
}

// Finish the polygon if it has at least three points.
function finishPolygon(closePoint = null) {
  return commandRegistry.execute(COMMANDS.ANNOTATION_CREATE_POLYGON, { closePoint });
}

function performFinishPolygon({ closePoint = null } = {}) {
  if (interactionState.currentPolygon.length < 3) {
    alert("Polygon needs at least 3 points.");
    return false;
  }
  const label = DEFAULT_POLYGON_LABEL;
  const anchorImagePoint =
    closePoint || interactionState.currentPolygon[interactionState.currentPolygon.length - 1] || interactionState.currentPolygon[0];
  const savedPolygon = interactionState.currentPolygon.map((point, index) => {
    const savedPoint = clonePolygonPoint(point);
    if (index === 0 && interactionState.currentCurveControl) {
      const snappedControl = applySnap(interactionState.currentCurveControl);
      savedPoint.curveFrom = { x: snappedControl.x, y: snappedControl.y };
    }
    return savedPoint;
  });
  const annotation = createPolygonAnnotation({
    label,
    color: getDefaultShapeColor(),
    points: savedPolygon,
  });
  annotationState.annotations.push(annotation);
  const polygonIndex = getAnnotationTypeIndex(annotationState.annotations, annotation.id);
  selectAnnotation(null);
  interactionState.currentPolygon = [];
  interactionState.currentCurveControl = null;
  interactionState.curveSegmentMode = false;
  syncToolStripUI();
  openCanvasLabelEditor({
    polygonIndex,
    initialLabel: label,
    anchorImagePoint,
    reason: "creation",
  });
  redraw();
  return true;
}

// Clear all annotations from the canvas.
function clearAll() {
  return commandRegistry.execute(COMMANDS.CLEAR_ALL);
}

function performClearAll() {
  closeCanvasLabelEditor();
  closeCanvasContextMenu();
  labelColorAssignments.clear();
  annotationState.annotations = [];
  interactionState.currentPolygon = [];
  interactionState.currentCurveControl = null;
  interactionState.curveSegmentMode = false;
  interactionState.ellipseDraft = null;
  interactionState.rectangleDraft = null;
  interactionState.activeVertex = null;
  interactionState.activeAnnotationDrag = null;
  interactionState.selectionBox = null;
  selectAnnotation(null);
  clearVertexSelection();
  redraw();
  return true;
}

// ── SECTION 11: CANVAS RENDERING ────────────────────────────────────────
// Every visual change triggers redraw(), which clears the canvas and
// repaints everything in order: image → grid → saved shapes → drafts →
// selection box → cursor style → contextual tips.

// Draw the image background.
function drawImage() {
  if (!imageState.image) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const imageSource =
    settingsState.sourceEnhancement === "hist-eq" && imageState.equalizedImage ? imageState.equalizedImage : imageState.image;
  const displayedImageSize = getDisplayedImageSize();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.filter = `contrast(${settingsState.imageContrast}%)`;
  ctx.drawImage(
    imageSource,
    viewState.viewOffsetX,
    viewState.viewOffsetY,
    displayedImageSize.width,
    displayedImageSize.height
  );
  ctx.restore();
}

// Build a histogram-equalized copy of the image for on-screen preview.
function buildHistogramEqualizedCanvas(image) {
  const width = image.width;
  const height = image.height;
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  const sourceContext = sourceCanvas.getContext("2d");
  if (!sourceContext) {
    return null;
  }
  sourceContext.drawImage(image, 0, 0, width, height);
  const imageData = sourceContext.getImageData(0, 0, width, height);
  const data = imageData.data;
  const histogram = new Uint32Array(256);
  const luminance = new Uint8Array(width * height);

  // Standard hist-eq flow: build luminance histogram first.
  for (let index = 0, pixelIndex = 0; index < data.length; index += 4, pixelIndex += 1) {
    const y = Math.round(0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]);
    luminance[pixelIndex] = y;
    histogram[y] += 1;
  }

  let cdfMin = 0;
  let foundMin = false;
  const cumulative = new Uint32Array(256);
  let running = 0;
  // Then compute cumulative distribution (CDF) so we can remap each level.
  for (let level = 0; level < 256; level += 1) {
    running += histogram[level];
    cumulative[level] = running;
    if (!foundMin && histogram[level] > 0) {
      cdfMin = running;
      foundMin = true;
    }
  }

  const totalPixels = width * height;
  const denominator = totalPixels - cdfMin;
  if (denominator <= 0) {
    return sourceCanvas;
  }

  const remap = new Uint8Array(256);
  for (let level = 0; level < 256; level += 1) {
    const normalized = ((cumulative[level] - cdfMin) / denominator) * 255;
    remap[level] = clamp(Math.round(normalized), 0, 255);
  }

  // Remap luminance while preserving color ratios to avoid weird color shifts.
  for (let index = 0, pixelIndex = 0; index < data.length; index += 4, pixelIndex += 1) {
    const originalY = luminance[pixelIndex];
    const mappedY = remap[originalY];
    const scale = originalY === 0 ? 0 : mappedY / originalY;
    data[index] = clamp(Math.round(data[index] * scale), 0, 255);
    data[index + 1] = clamp(Math.round(data[index + 1] * scale), 0, 255);
    data[index + 2] = clamp(Math.round(data[index + 2] * scale), 0, 255);
  }

  sourceContext.putImageData(imageData, 0, 0);
  return sourceCanvas;
}

// ── SECTION 12: IMAGE ANALYSIS (for smart snapping) ─────────────────────
// When the image loads we pre-compute two pixel buffers:
//   • gray[]     – luminance (brightness) of each pixel (0–255).
//   • gradient[] – edge strength at each pixel, computed with a Sobel filter.
// These buffers let the snap pipeline find the nearest strong edge or
// intensity extremum without re-reading the canvas every time.

// Build grayscale + edge-strength buffers used for smart snapping.
function buildImageAnalysisData(imageSource) {
  if (!imageSource) {
    return null;
  }
  const width = imageSource.width;
  const height = imageSource.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 3 || height < 3) {
    return null;
  }
  const analysisCanvas = document.createElement("canvas");
  analysisCanvas.width = width;
  analysisCanvas.height = height;
  const analysisContext = analysisCanvas.getContext("2d");
  if (!analysisContext) {
    return null;
  }
  analysisContext.drawImage(imageSource, 0, 0, width, height);
  const imageData = analysisContext.getImageData(0, 0, width, height);
  const data = imageData.data;
  const gray = new Uint8Array(width * height);
  const gradient = new Uint8Array(width * height);

  for (let index = 0, pixelIndex = 0; index < data.length; index += 4, pixelIndex += 1) {
    gray[pixelIndex] = Math.round(0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]);
  }

  // Simple Sobel-style gradient to estimate local edge strength for edge snapping.
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const center = y * width + x;
      const top = center - width;
      const bottom = center + width;
      const gx =
        -gray[top - 1] -
        2 * gray[center - 1] -
        gray[bottom - 1] +
        gray[top + 1] +
        2 * gray[center + 1] +
        gray[bottom + 1];
      const gy =
        gray[top - 1] +
        2 * gray[top] +
        gray[top + 1] -
        gray[bottom - 1] -
        2 * gray[bottom] -
        gray[bottom + 1];
      gradient[center] = clamp(Math.round(Math.hypot(gx, gy) / 4), 0, 255);
    }
  }

  return { width, height, gray, gradient };
}

// Resolve which image analysis buffer to use for smart snapping.
function getActiveImageAnalysis() {
  if (settingsState.sourceEnhancement === "hist-eq" && imageState.imageAnalysisEqualized) {
    return imageState.imageAnalysisEqualized;
  }
  return imageState.imageAnalysisOriginal;
}

// Keep derived image buffers ready for the selected enhancement mode.
function ensureImageAnalysisCaches() {
  if (!imageState.image) {
    return;
  }
  if (!imageState.imageAnalysisOriginal) {
    imageState.imageAnalysisOriginal = buildImageAnalysisData(imageState.image);
  }
  if (settingsState.sourceEnhancement === "hist-eq" && !imageState.equalizedImage) {
    imageState.equalizedImage = buildHistogramEqualizedCanvas(imageState.image);
  }
  if (imageState.equalizedImage && !imageState.imageAnalysisEqualized) {
    imageState.imageAnalysisEqualized = buildImageAnalysisData(imageState.equalizedImage);
  }
}

// Sync form controls from current state values.
function syncControlValuesFromState() {
  if (gridToggle) {
    gridToggle.checked = settingsState.gridEnabled;
  }
  if (snapToggle) {
    snapToggle.checked = settingsState.snapEnabled;
  }
  if (smartSnapToggle) {
    smartSnapToggle.checked = settingsState.smartSnapEnabled;
  }
  if (snapBorderToggle) {
    snapBorderToggle.checked = settingsState.snapToBorder;
  }
  if (snapEdgeToggle) {
    snapEdgeToggle.checked = settingsState.snapToEdge;
  }
  if (snapExtremaToggle) {
    snapExtremaToggle.checked = settingsState.snapToExtrema;
  }
  if (snapExtremaModeSelect) {
    snapExtremaModeSelect.value = settingsState.snapExtremaMode;
  }
  if (gridSizeInput) {
    gridSizeInput.value = String(settingsState.gridSize);
  }
  if (gridOpacityInput) {
    gridOpacityInput.value = String(settingsState.gridOpacity);
  }
  if (gridMajorEveryInput) {
    gridMajorEveryInput.value = String(settingsState.gridMajorEvery);
  }
  if (snapRadiusInput) {
    snapRadiusInput.value = String(settingsState.snapRadius);
  }
  if (snapBorderThresholdInput) {
    snapBorderThresholdInput.value = String(settingsState.snapBorderThreshold);
  }
  if (snapEdgeThresholdInput) {
    snapEdgeThresholdInput.value = String(settingsState.snapEdgeThreshold);
  }
  if (snapExtremaDeltaInput) {
    snapExtremaDeltaInput.value = String(settingsState.snapExtremaDelta);
  }
  if (sourceEnhancementSelect) {
    sourceEnhancementSelect.value = settingsState.sourceEnhancement;
  }
  if (imageContrastInput) {
    imageContrastInput.value = String(settingsState.imageContrast);
  }
  if (maskContrastInput) {
    maskContrastInput.value = String(settingsState.maskContrast);
  }
  if (maskOpacityInput) {
    maskOpacityInput.value = String(settingsState.maskOpacity);
  }
}

// Apply precision/display settings from defaults or a preset.
function applySettings(settingsPatch, options = {}) {
  const normalized = normalizeSettings({ ...settingsState, ...settingsPatch });
  Object.keys(DEFAULT_SETTINGS).forEach((key) => {
    settingsState[key] = normalized[key];
  });
  ensureImageAnalysisCaches();
  syncControlValuesFromState();
  if (snapPresetSelect && options.presetId) {
    snapPresetSelect.value = options.presetId;
  }
  syncAdjustmentLabels();
  redraw();
}

// Compute preview color styling for mask overlays based on mask contrast.
function getMaskPreviewStyle(baseColor, fillAlpha = 0.12) {
  const contrastFactor = clamp(settingsState.maskContrast / 100, 0.5, 2);
  const strokeR = clamp(Math.round((baseColor.r - 128) * contrastFactor + 128), 0, 255);
  const strokeG = clamp(Math.round((baseColor.g - 128) * contrastFactor + 128), 0, 255);
  const strokeB = clamp(Math.round((baseColor.b - 128) * contrastFactor + 128), 0, 255);
  const adjustedFillAlpha = clamp(fillAlpha * contrastFactor, 0.04, 0.35);
  return {
    stroke: `rgb(${strokeR}, ${strokeG}, ${strokeB})`,
    fill: `rgba(${strokeR}, ${strokeG}, ${strokeB}, ${adjustedFillAlpha})`,
  };
}

// Build a stable key from the annotation ID so selection survives reordering.
function getVertexKey(polygonIndex, pointIndex) {
  const ownerId = polygonIndex === -1 ? "draft" : getPolygonAnnotation(polygonIndex)?.id;
  return ownerId ? `${ownerId}|${pointIndex}` : "";
}

// Clear all selected vertices.
function clearVertexSelection() {
  interactionState.selectedVertexKeys.clear();
}

// Select exactly one vertex and make it active.
function selectSingleVertex(vertex) {
  if (!vertex) {
    interactionState.activeVertex = null;
    clearVertexSelection();
    return;
  }
  clearVertexSelection();
  const key = getVertexKey(vertex.polygonIndex, vertex.pointIndex);
  if (key) interactionState.selectedVertexKeys.add(key);
  interactionState.activeVertex = vertex;
}

// Add one vertex to current multi-selection.
function addVertexToSelection(vertex) {
  if (!vertex) {
    return;
  }
  const key = getVertexKey(vertex.polygonIndex, vertex.pointIndex);
  if (key) interactionState.selectedVertexKeys.add(key);
}

// Remove one vertex from current multi-selection.
function removeVertexFromSelection(vertex) {
  if (!vertex) {
    return;
  }
  interactionState.selectedVertexKeys.delete(getVertexKey(vertex.polygonIndex, vertex.pointIndex));
}

// Check if a specific vertex is currently selected.
function isVertexSelected(polygonIndex, pointIndex) {
  return interactionState.selectedVertexKeys.has(getVertexKey(polygonIndex, pointIndex));
}

// Draw marquee rectangle while selecting multiple vertices.
function drawSelectionBox() {
  if (!interactionState.selectionBox) {
    return;
  }
  const minX = Math.min(interactionState.selectionBox.start.x, interactionState.selectionBox.end.x);
  const maxX = Math.max(interactionState.selectionBox.start.x, interactionState.selectionBox.end.x);
  const minY = Math.min(interactionState.selectionBox.start.y, interactionState.selectionBox.end.y);
  const maxY = Math.max(interactionState.selectionBox.start.y, interactionState.selectionBox.end.y);
  const width = maxX - minX;
  const height = maxY - minY;
  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(14, 116, 144, 0.9)";
  ctx.fillStyle = "rgba(14, 116, 144, 0.12)";
  ctx.fillRect(minX, minY, width, height);
  ctx.strokeRect(minX, minY, width, height);
  ctx.restore();
}

// Draw a polygon and its vertex handles.
function drawPolygon(points, options = {}) {
  if (points.length === 0) {
    return;
  }
  const overlayOpacity = options.opacity ?? settingsState.maskOpacity / 100;
  const polygonBaseColor = options.baseColor || getPolygonBaseColorByIndex(options.polygonIndex);
  const previewStyle = getMaskPreviewStyle(polygonBaseColor, 0.12);
  const isSelectedAnnotation = Boolean(options.selectedAnnotation);
  ctx.save();
  ctx.globalAlpha = overlayOpacity;
  ctx.strokeStyle = options.stroke ?? previewStyle.stroke;
  ctx.lineWidth = options.lineWidth ?? (isSelectedAnnotation ? 3 : 2);
  ctx.fillStyle = options.fill ?? previewStyle.fill;
  ctx.beginPath();
  const scaledPoints = points.map((point) => ({
    ...scalePoint(point),
    curveFrom: point.curveFrom ? scalePoint(point.curveFrom) : null,
  }));
  scaledPoints.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
      return;
    }
    if (point.curveFrom) {
      ctx.quadraticCurveTo(point.curveFrom.x, point.curveFrom.y, point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });
  if (options.closed && scaledPoints.length > 1) {
    const firstPoint = scaledPoints[0];
    if (firstPoint.curveFrom) {
      ctx.quadraticCurveTo(firstPoint.curveFrom.x, firstPoint.curveFrom.y, firstPoint.x, firstPoint.y);
    }
  }
  if (options.closed) {
    ctx.closePath();
    ctx.fill();
  }
  ctx.stroke();
  if (!options.noVertices) {
    ctx.globalAlpha = 1;
    points.forEach((point, index) => {
      const scaledPoint = scalePoint(point);
      const isActive =
        interactionState.activeVertex &&
        interactionState.activeVertex.polygonIndex === options.polygonIndex &&
        interactionState.activeVertex.pointIndex === index;
      const isSelected = isVertexSelected(options.polygonIndex, index);
      ctx.beginPath();
      ctx.arc(scaledPoint.x, scaledPoint.y, isActive ? 6 : 4, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? "#16a34a" : isSelected ? "#0ea5e9" : rgbToCss(polygonBaseColor);
      ctx.fill();
    });
    points.forEach((point, index) => {
      if (!point.curveFrom) {
        return;
      }
      const controlPoint = scalePoint(point.curveFrom);
      const isActive =
        interactionState.activeVertex &&
        interactionState.activeVertex.polygonIndex === options.polygonIndex &&
        interactionState.activeVertex.pointIndex === index &&
        interactionState.activeVertex.controlType === "curveFrom";
      ctx.save();
      ctx.translate(controlPoint.x, controlPoint.y);
      ctx.rotate(Math.PI / 4);
      ctx.beginPath();
      const handleSize = isActive ? 10 : 8;
      ctx.rect(-handleSize / 2, -handleSize / 2, handleSize, handleSize);
      ctx.fillStyle = isActive ? "#16a34a" : "#f59e0b";
      ctx.fill();
      ctx.restore();
    });
  }
  ctx.restore();
}

// Draw a scaled ellipse overlay.
function drawEllipse(ellipse, options = {}) {
  const scaledEllipse = scaleEllipse(ellipse);
  const overlayOpacity = options.opacity ?? settingsState.maskOpacity / 100;
  const baseColor = options.baseColor || ELLIPSE_BASE_COLOR;
  const previewStyle = getMaskPreviewStyle(baseColor, 0.12);
  const isSelectedAnnotation = Boolean(options.selectedAnnotation);
  ctx.save();
  ctx.globalAlpha = overlayOpacity;
  ctx.strokeStyle = options.stroke ?? (isSelectedAnnotation ? "#0284c7" : previewStyle.stroke);
  ctx.lineWidth = options.lineWidth ?? (isSelectedAnnotation ? 3 : 2);
  ctx.fillStyle = options.fill ?? previewStyle.fill;
  ctx.beginPath();
  ctx.ellipse(
    scaledEllipse.cx,
    scaledEllipse.cy,
    scaledEllipse.rx,
    scaledEllipse.ry,
    scaledEllipse.rotation,
    0,
    Math.PI * 2
  );
  ctx.fill();
  ctx.stroke();

  // Draw handles (center + 4 edge points) in edit mode and during draft preview.
  const showHandles =
    !options.noVertices &&
    (options.showHandles !== undefined
      ? options.showHandles
      : options.ellipseIndex != null || interactionState.vertexEditEnabled);
  if (showHandles) {
    ctx.globalAlpha = 1;
    const handles = getEllipseHandles(scaledEllipse);
    const activeHandle = interactionState.activeVertex;
    handles.forEach((h) => {
      const isActive =
        activeHandle &&
        activeHandle.ellipseIndex === options.ellipseIndex &&
        activeHandle.handleType === h.type;
      ctx.beginPath();
      ctx.arc(h.x, h.y, isActive ? 6 : 4, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? "#16a34a" : rgbToCss(baseColor);
      ctx.fill();
    });
  }
  ctx.restore();
}

// Return the 5 handle positions for an ellipse (in whatever coordinate space
// the ellipse is in — image-space or canvas-space).
function getEllipseHandles(ellipse) {
  return [
    { type: "center", x: ellipse.cx, y: ellipse.cy },
    { type: "right",  x: ellipse.cx + ellipse.rx, y: ellipse.cy },
    { type: "left",   x: ellipse.cx - ellipse.rx, y: ellipse.cy },
    { type: "top",    x: ellipse.cx, y: ellipse.cy - ellipse.ry },
    { type: "bottom", x: ellipse.cx, y: ellipse.cy + ellipse.ry },
  ];
}

// ── rAF-throttled redraw ────────────────────────────────────────────────
// Instead of repainting the canvas on every single event (mouse move,
// slider tick, etc.), we schedule one repaint per screen refresh using
// requestAnimationFrame.  Multiple redraw() calls between frames are
// coalesced into a single paint, avoiding wasted work the user never sees.
let redrawScheduled = false;

function redraw() {
  renderDomPanels();
  if (redrawScheduled) return;
  redrawScheduled = true;
  requestAnimationFrame(() => {
    redrawScheduled = false;
    renderCanvas();
  });
}

// The actual painting function — called once per frame at most.
function renderCanvas() {
  normalizeSelectedAnnotation();
  drawImage();
  if (settingsState.gridEnabled) {
    drawGrid();
  }
  const creationPreviewPolygonIndex =
    uiState.activeLabelEdit?.reason === "creation" &&
    uiState.activeLabelEdit?.annotationType !== "ellipse" &&
    Number.isInteger(uiState.activeLabelEdit?.annotationIndex)
      ? uiState.activeLabelEdit.annotationIndex
      : -1;
  getPolygonAnnotations().forEach((annotation, index) => {
    drawPolygon(annotation.geometry.points, {
      closed: true,
      polygonIndex: index,
      opacity: settingsState.maskOpacity / 100,
      selectedAnnotation: isAnnotationSelected("polygon", index),
      baseColor: index === creationPreviewPolygonIndex ? POLYGON_BASE_COLOR : null,
    });
  });
  const selectedAnnotation = getSelectedAnnotation();
  if (selectedAnnotation?.type === "polygon") {
    const selectedPolygonIndex = getAnnotationTypeIndex(annotationState.annotations, selectedAnnotation.id);
    const selectedPolygon = selectedAnnotation.geometry.points;
    if (Array.isArray(selectedPolygon) && selectedPolygon.length > 0) {
      drawPolygon(selectedPolygon, {
        closed: true,
        polygonIndex: selectedPolygonIndex,
        opacity: 1,
        stroke: "#0284c7",
        fill: "rgba(2, 132, 199, 0.08)",
        lineWidth: 3.5,
        noVertices: true,
      });
    }
  }
  getEllipseAnnotations().forEach((annotation, index) =>
    drawEllipse(annotation.geometry, {
      opacity: settingsState.maskOpacity / 100,
      selectedAnnotation: isAnnotationSelected("ellipse", index),
      ellipseIndex: index,
      baseColor: getEllipseBaseColorByIndex(index),
      showHandles: true,
    })
  );
  if (interactionState.currentPolygon.length > 0) {
    const cursorPt = interactionState.cursorImagePos;
    const readyToClose = cursorPt && interactionState.currentPolygon.length >= 3 && isNearFirstVertex(cursorPt);
    const draftColor = POLYGON_BASE_COLOR;
    const draftStroke = rgbToCss(draftColor);
    const draftFillStrong = rgbToCss(draftColor, 0.45);
    const draftFillSoft = rgbToCss(draftColor, 0.15);
    const draftClosingStroke = rgbToCss(draftColor, 0.35);

    if (readyToClose) {
      // ── "Ready to close" state ──────────────────────────────────────
      // Mimics LabelMe: the entire polygon lights up — thicker white
      // edges, stronger fill, and enlarged white first-vertex circle.
      drawPolygon(interactionState.currentPolygon, {
        closed: true,
        stroke: "rgba(255, 255, 255, 0.9)",
        fill: draftFillStrong,
        lineWidth: 2.5,
        opacity: 1,
        polygonIndex: -1,
        noVertices: true,
      });

      // Draw all vertices as white dots.
      interactionState.currentPolygon.forEach((pt) => {
        const sp = scalePoint(pt);
        ctx.save();
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.restore();
      });

      // First vertex: large white circle (the snap-to-close target).
      const firstPt = scalePoint(interactionState.currentPolygon[0]);
      ctx.save();
      ctx.beginPath();
      ctx.arc(firstPt.x, firstPt.y, CLOSE_SNAP_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
      ctx.fill();
      ctx.restore();
    } else {
      // ── Normal drawing state ────────────────────────────────────────
      // Live fill preview: treat cursor as a temporary extra vertex.
      if (cursorPt && interactionState.currentPolygon.length >= 2) {
        const previewPts = [
          ...interactionState.currentPolygon,
          makePolygonPoint(cursorPt, interactionState.currentCurveControl),
        ];
        drawPolygon(previewPts, {
          closed: true,
          stroke: "transparent",
          fill: draftFillSoft,
          opacity: 1,
          polygonIndex: -1,
          noVertices: true,
        });
      }

      // Draw confirmed edges and vertex handles.
      drawPolygon(interactionState.currentPolygon, {
        closed: false,
        stroke: draftStroke,
        opacity: 1,
        polygonIndex: -1,
      });

      // Rubber-band line: last placed point → cursor position.
      if (cursorPt && interactionState.currentPolygon.length >= 1) {
        const lastPt = scalePoint(interactionState.currentPolygon[interactionState.currentPolygon.length - 1]);
        const cursorScaled = scalePoint(cursorPt);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(lastPt.x, lastPt.y);
        if (interactionState.currentCurveControl) {
          const controlScaled = scalePoint(interactionState.currentCurveControl);
          ctx.quadraticCurveTo(controlScaled.x, controlScaled.y, cursorScaled.x, cursorScaled.y);
        } else {
          ctx.lineTo(cursorScaled.x, cursorScaled.y);
        }
        ctx.strokeStyle = draftStroke;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.restore();

        if (interactionState.curveSegmentMode && !interactionState.currentCurveControl) {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(lastPt.x, lastPt.y);
          ctx.lineTo(cursorScaled.x, cursorScaled.y);
          ctx.strokeStyle = "#f59e0b";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([2, 5]);
          ctx.stroke();
          ctx.restore();
        }

        if (interactionState.currentCurveControl) {
          const controlScaled = scalePoint(interactionState.currentCurveControl);
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(lastPt.x, lastPt.y);
          ctx.lineTo(controlScaled.x, controlScaled.y);
          ctx.lineTo(cursorScaled.x, cursorScaled.y);
          ctx.strokeStyle = "rgba(245, 158, 11, 0.75)";
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.stroke();
          ctx.translate(controlScaled.x, controlScaled.y);
          ctx.rotate(Math.PI / 4);
          ctx.beginPath();
          ctx.rect(-4, -4, 8, 8);
          ctx.fillStyle = "#f59e0b";
          ctx.fill();
          ctx.restore();
        }

        // Closing-edge ghost: cursor → first point.
        if (interactionState.currentPolygon.length >= 2) {
          const firstPt = scalePoint(interactionState.currentPolygon[0]);
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(cursorScaled.x, cursorScaled.y);
          ctx.lineTo(firstPt.x, firstPt.y);
          ctx.strokeStyle = draftClosingStroke;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 6]);
          ctx.stroke();
          ctx.restore();
        }
      }
    }
  }
  if (interactionState.ellipseDraft) {
    drawEllipse(toEllipse(interactionState.ellipseDraft.start, interactionState.ellipseDraft.end), {
      stroke: "#22c55e",
      fill: "rgba(34, 197, 94, 0.1)",
      opacity: 1,
      showHandles: true,
    });
  }
  if (interactionState.rectangleDraft) {
    const rectangleDraftColor = POLYGON_BASE_COLOR;
    drawPolygon(toRectanglePoints(interactionState.rectangleDraft.start, interactionState.rectangleDraft.end), {
      closed: true,
      stroke: rgbToCss(rectangleDraftColor),
      fill: rgbToCss(rectangleDraftColor, 0.1),
      opacity: 1,
      polygonIndex: -2,
    });
  }
  drawSelectionBox();
  syncCanvasCursor();
}

function renderDomPanels() {
  renderImageMetadata();
  renderImageLoadStatus();
  if (!interactionState.activeAnnotationDrag) {
    renderLabelPanels();
  }
}

// ── SECTION 15: EXPORT (JSON + Mask) ────────────────────────────────────
// Two export paths:
//   • JSON export  – serializes annotations to a downloadable .json file
//                    in either LLNL or MS COCO format.
//   • Mask export  – renders all shapes onto a new canvas as white-on-black
//                    and downloads it as a PNG (useful for segmentation pipelines).

// Export annotations to JavaScript Object Notation (JSON).
function exportJson() {
  if (!imageState.imageName) {
    alert("Upload a PNG before exporting.");
    return;
  }

  if (settingsState.outputFormat === "coco" && getEllipseAnnotations().length > 0) {
    alert("MS COCO export includes polygons only. Ellipses will not be exported.");
  }

  stopAnnotationTimer({ markEnded: true });
  const payload =
    settingsState.outputFormat === "coco" ? buildCocoPayload() : buildLlnlPayload();

  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const suffix = settingsState.outputFormat === "coco" ? "-coco" : "";
  link.download = `${imageState.imageName.replace(/\.png$/i, "") || "annotation"}${suffix}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function getAnnotationsForExport() {
  return annotationState.annotations.map((annotation) => {
    const clone = cloneAnnotation(annotation);
    const index = getAnnotationTypeIndex(annotationState.annotations, annotation.id);
    clone.color = getAnnotationColorHex(annotation.type, index);
    clone.label = sanitizePolygonLabel(annotation.label);
    return clone;
  });
}

// Build the existing LLNL JSON payload.
function buildLlnlPayload() {
  return exportLlnlDocument({
    annotations: getAnnotationsForExport(),
    imageName: imageState.imageName,
    imageSize: imageState.imageSize,
    displaySize: { width: canvas.width, height: canvas.height },
    annotationTiming: getAnnotationTimingMetadata(),
  });
}

// Build a minimal MS COCO JSON payload using polygon annotations only.
function buildCocoPayload() {
  return exportCocoDocument({
    annotations: getAnnotationsForExport(),
    imageName: imageState.imageName,
    imageSize: imageState.imageSize,
    annotationTiming: getAnnotationTimingMetadata(),
  });
}

// Export a binary mask PNG (opacity slider affects preview only).
function exportMask(options = {}) {
  if (!imageState.imageSize) {
    alert("Upload a PNG before exporting a mask.");
    return;
  }
  const inverted = Boolean(options.inverted);
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = imageState.imageSize.width;
  maskCanvas.height = imageState.imageSize.height;
  const maskContext = maskCanvas.getContext("2d");
  if (!maskContext) {
    alert("Mask rendering is not available in this browser.");
    return;
  }
  maskContext.fillStyle = inverted ? "white" : "black";
  maskContext.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
  // Exported masks stay binary for segmentation workflows:
  // normal: background 0, foreground 255; inverted swaps those values.
  maskContext.fillStyle = inverted ? "black" : "white";

  getPolygonAnnotations().forEach((annotation) =>
    drawMaskPolygon(maskContext, annotation.geometry.points)
  );
  getEllipseAnnotations().forEach((annotation) =>
    drawMaskEllipse(maskContext, annotation.geometry)
  );

  enforceBinaryMask(maskContext, maskCanvas.width, maskCanvas.height);

  // Convert the mask canvas to a downloadable PNG data URL and trigger download.
  // We revoke the object URL afterward to free the memory blob.
  const url = maskCanvas.toDataURL("image/png");
  const link = document.createElement("a");
  link.href = url;
  const suffix = inverted ? "-inverted-mask" : "-mask";
  link.download = `${imageState.imageName.replace(/\.png$/i, "") || "annotation"}${suffix}.png`;
  link.click();
  // Note: toDataURL returns a data: URI (not an object URL), so no revoke needed
  // here. The JSON export below correctly revokes its createObjectURL blob.
}

// Force mask pixels to strict binary values (0 or 255) after rasterization.
function enforceBinaryMask(maskContext, width, height) {
  const imageData = maskContext.getImageData(0, 0, width, height);
  const data = imageData.data;
  for (let index = 0; index < data.length; index += 4) {
    const value = data[index] > 127 ? 255 : 0;
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
    data[index + 3] = 255;
  }
  maskContext.putImageData(imageData, 0, 0);
}

// Keep slider label text in sync with current values.
function syncAdjustmentLabels() {
  if (imageContrastValue) {
    imageContrastValue.textContent = `${settingsState.imageContrast}%`;
  }
  if (snapEdgeThresholdValue) {
    snapEdgeThresholdValue.textContent = `${settingsState.snapEdgeThreshold}`;
  }
  if (gridOpacityValue) {
    gridOpacityValue.textContent = `${settingsState.gridOpacity}%`;
  }
  if (maskContrastValue) {
    maskContrastValue.textContent = `${settingsState.maskContrast}%`;
  }
  if (maskOpacityValue) {
    maskOpacityValue.textContent = `${settingsState.maskOpacity}%`;
  }
  if (zoomValue) {
    zoomValue.textContent = `${Math.round(viewState.viewZoom * 100)}%`;
  }
}

// ── SECTION 13: SNAP PIPELINE ───────────────────────────────────────────
// The snap system adjusts a clicked point so it lines up with meaningful
// features.  The pipeline runs in order:
//   1. Clamp to image bounds
//   2. Border snap   – pull toward the nearest image edge
//   3. Edge snap     – pull toward the strongest gradient (edge) nearby
//   4. Extrema snap  – pull toward a local intensity min or max
//   5. Grid snap     – round to the nearest grid intersection (if grid on)
//   6. Final border  – re-check border after grid may have nudged the point
// The user can toggle each stage independently via the left panel.

// Clamp a point so it always stays inside image bounds.
function clampPointToImageBounds(point) {
  if (!imageState.imageSize) {
    return point;
  }
  return {
    x: clamp(point.x, 0, imageState.imageSize.width - 1),
    y: clamp(point.y, 0, imageState.imageSize.height - 1),
  };
}

// Snap a point to the grid in image coordinates.
function applyGridSnap(point) {
  if (!settingsState.gridSize) {
    return point;
  }
  return {
    x: Math.round(point.x / settingsState.gridSize) * settingsState.gridSize,
    y: Math.round(point.y / settingsState.gridSize) * settingsState.gridSize,
  };
}

// Snap a point to the nearest image border if it is within threshold.
function applyBorderSnap(point) {
  if (!imageState.imageSize) {
    return point;
  }
  const threshold = Math.max(0, settingsState.snapBorderThreshold);
  const maxX = imageState.imageSize.width - 1;
  const maxY = imageState.imageSize.height - 1;
  let { x, y } = point;
  if (x <= threshold) {
    x = 0;
  } else if (x >= maxX - threshold) {
    x = maxX;
  }
  if (y <= threshold) {
    y = 0;
  } else if (y >= maxY - threshold) {
    y = maxY;
  }
  return { x, y };
}

// Snap a point to the strongest local edge using gradient magnitude.
function applyEdgeSnap(point, analysis) {
  const radius = Math.max(1, Math.round(settingsState.snapRadius));
  const anchorX = clamp(Math.round(point.x), 0, analysis.width - 1);
  const anchorY = clamp(Math.round(point.y), 0, analysis.height - 1);
  const minX = Math.max(1, anchorX - radius);
  const maxX = Math.min(analysis.width - 2, anchorX + radius);
  const minY = Math.max(1, anchorY - radius);
  const maxY = Math.min(analysis.height - 2, anchorY + radius);
  let bestX = anchorX;
  let bestY = anchorY;
  let bestScore = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const score = analysis.gradient[y * analysis.width + x];
      if (score < settingsState.snapEdgeThreshold) {
        continue;
      }
      const distance = Math.hypot(x - anchorX, y - anchorY);
      if (score > bestScore || (score === bestScore && distance < bestDistance)) {
        bestScore = score;
        bestDistance = distance;
        bestX = x;
        bestY = y;
      }
    }
  }
  if (bestScore < 0) {
    return point;
  }
  return { x: bestX, y: bestY };
}

// Snap a point to a local intensity minimum or maximum in a search radius.
function applyExtremaSnap(point, analysis) {
  const radius = Math.max(1, Math.round(settingsState.snapRadius));
  const anchorX = clamp(Math.round(point.x), 0, analysis.width - 1);
  const anchorY = clamp(Math.round(point.y), 0, analysis.height - 1);
  const minX = Math.max(0, anchorX - radius);
  const maxX = Math.min(analysis.width - 1, anchorX + radius);
  const minY = Math.max(0, anchorY - radius);
  const maxY = Math.min(analysis.height - 1, anchorY + radius);
  const anchorIndex = anchorY * analysis.width + anchorX;
  const anchorValue = analysis.gray[anchorIndex];
  const mode = settingsState.snapExtremaMode === "max" ? "max" : "min";
  let bestX = anchorX;
  let bestY = anchorY;
  let bestValue = anchorValue;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const value = analysis.gray[y * analysis.width + x];
      const distance = Math.hypot(x - anchorX, y - anchorY);
      const isBetter = mode === "max" ? value > bestValue : value < bestValue;
      const sameValueCloser = value === bestValue && distance < bestDistance;
      if (isBetter || sameValueCloser) {
        bestValue = value;
        bestDistance = distance;
        bestX = x;
        bestY = y;
      }
    }
  }
  const delta = Math.abs(bestValue - anchorValue);
  if ((bestX === anchorX && bestY === anchorY) || delta < settingsState.snapExtremaDelta) {
    return point;
  }
  return { x: bestX, y: bestY };
}

// Snap a point using the configured pipeline (smart snap + grid snap).
function applySnap(point) {
  const boundedPoint = clampPointToImageBounds(point);
  if (!settingsState.snapEnabled) {
    return boundedPoint;
  }
  let snappedPoint = boundedPoint;
  // Order matters here: border -> edge/extrema -> grid -> border again.
  // That final border pass keeps points on the frame even after grid snap nudges them.
  if (settingsState.smartSnapEnabled) {
    if (settingsState.snapToBorder) {
      snappedPoint = applyBorderSnap(snappedPoint);
    }
    const analysis = getActiveImageAnalysis();
    if (analysis && settingsState.snapToEdge) {
      snappedPoint = applyEdgeSnap(snappedPoint, analysis);
    }
    if (analysis && settingsState.snapToExtrema) {
      snappedPoint = applyExtremaSnap(snappedPoint, analysis);
    }
  }
  // Only snap to grid lines when the grid overlay is actually turned on.
  // Without this check, points silently snap to the grid size even when
  // the user hasn't enabled the grid, producing confusing placement.
  if (settingsState.gridEnabled) {
    snappedPoint = applyGridSnap(snappedPoint);
  }
  if (settingsState.smartSnapEnabled && settingsState.snapToBorder) {
    snappedPoint = applyBorderSnap(snappedPoint);
  }
  return clampPointToImageBounds(snappedPoint);
}

// ── SECTION 14: COORDINATE TRANSFORMS ───────────────────────────────────
// These functions convert between "image space" (original pixel coords)
// and "canvas space" (what you see on screen after scaling + zoom + pan).

// Convert image-space point to canvas-space point.
function scalePoint(point) {
  return {
    x: point.x * viewState.imageScale * viewState.viewZoom + viewState.viewOffsetX,
    y: point.y * viewState.imageScale * viewState.viewZoom + viewState.viewOffsetY,
  };
}

// Convert image-space ellipse to canvas-space ellipse.
function scaleEllipse(ellipse) {
  return {
    cx: ellipse.cx * viewState.imageScale * viewState.viewZoom + viewState.viewOffsetX,
    cy: ellipse.cy * viewState.imageScale * viewState.viewZoom + viewState.viewOffsetY,
    rx: ellipse.rx * viewState.imageScale * viewState.viewZoom,
    ry: ellipse.ry * viewState.imageScale * viewState.viewZoom,
    rotation: ellipse.rotation,
  };
}

// Draw a polygon into the mask canvas.
function drawMaskPolygon(maskContext, points) {
  const flattenedPoints = flattenPolygon(points);
  if (!flattenedPoints.length) {
    return;
  }
  maskContext.beginPath();
  flattenedPoints.forEach((point, index) => {
    if (index === 0) {
      maskContext.moveTo(point.x, point.y);
    } else {
      maskContext.lineTo(point.x, point.y);
    }
  });
  maskContext.closePath();
  maskContext.fill();
}

// Draw an ellipse into the mask canvas.
function drawMaskEllipse(maskContext, ellipse) {
  maskContext.beginPath();
  maskContext.ellipse(
    ellipse.cx,
    ellipse.cy,
    ellipse.rx,
    ellipse.ry,
    ellipse.rotation,
    0,
    Math.PI * 2
  );
  maskContext.fill();
}

// Draw a grid overlay for precision alignment.
function drawGrid() {
  if (!imageState.imageSize || !settingsState.gridSize) {
    return;
  }
  const spacing = settingsState.gridSize * viewState.imageScale * viewState.viewZoom;
  ctx.save();
  const baseOpacity = clamp(settingsState.gridOpacity / 100, 0.1, 1);
  const majorEvery = Math.max(2, Math.round(settingsState.gridMajorEvery));
  // When spacing gets tiny (Fine Boundary + zoomed out), draw every Nth line
  // instead of hiding the grid completely.
  const minVisibleSpacing = 2;
  const lineStepMultiplier = Math.max(1, Math.ceil(minVisibleSpacing / Math.max(spacing, 0.001)));
  const drawSpacing = spacing * lineStepMultiplier;
  const showMinorLines = spacing >= 4 && lineStepMultiplier === 1;
  const minorLineWidth = spacing < 10 ? 1 : 1.1;
  const majorLineWidth = showMinorLines ? (spacing < 10 ? 1.4 : 1.8) : 1.3;
  const minorColor = `rgba(71, 85, 105, ${baseOpacity})`;
  const majorColor = `rgba(15, 23, 42, ${clamp(baseOpacity * 1.9, 0.2, 1)})`;
  const width = imageState.imageSize.width * viewState.imageScale * viewState.viewZoom;
  const height = imageState.imageSize.height * viewState.imageScale * viewState.viewZoom;
  const startX = viewState.viewOffsetX;
  const startY = viewState.viewOffsetY;
  let verticalIndex = 0;
  for (let x = startX; x <= startX + width; x += drawSpacing, verticalIndex += lineStepMultiplier) {
    const isMajor = verticalIndex % majorEvery === 0;
    if (!showMinorLines && !isMajor) {
      continue;
    }
    ctx.strokeStyle = isMajor ? majorColor : minorColor;
    ctx.lineWidth = isMajor ? majorLineWidth : minorLineWidth;
    ctx.beginPath();
    ctx.moveTo(x, startY);
    ctx.lineTo(x, startY + height);
    ctx.stroke();
  }
  let horizontalIndex = 0;
  for (let y = startY; y <= startY + height; y += drawSpacing, horizontalIndex += lineStepMultiplier) {
    const isMajor = horizontalIndex % majorEvery === 0;
    if (!showMinorLines && !isMajor) {
      continue;
    }
    ctx.strokeStyle = isMajor ? majorColor : minorColor;
    ctx.lineWidth = isMajor ? majorLineWidth : minorLineWidth;
    ctx.beginPath();
    ctx.moveTo(startX, y);
    ctx.lineTo(startX + width, y);
    ctx.stroke();
  }
  ctx.restore();
}

// ── SECTION 16: VERTEX EDITING ──────────────────────────────────────────
// When "Vertex edit mode" is checked, the user can click-drag individual
// polygon vertices to reposition them, use a selection box (Shift/Ctrl+drag)
// to multi-select vertices, and press Delete to remove selected vertices.
// Alt+click on a polygon edge inserts a new vertex at the clicked position.

// Find a vertex near the cursor (used in vertex edit mode).
function findVertexAtPoint(canvasPoint) {
  const threshold = 10;
  const polygonAnnotations = getPolygonAnnotations();
  for (let polygonIndex = 0; polygonIndex < polygonAnnotations.length; polygonIndex += 1) {
    const annotation = polygonAnnotations[polygonIndex];
    const polygon = annotation.geometry.points;
    for (let pointIndex = 0; pointIndex < polygon.length; pointIndex += 1) {
      if (polygon[pointIndex].curveFrom) {
        const scaledControl = scalePoint(polygon[pointIndex].curveFrom);
        const controlDistance = Math.hypot(scaledControl.x - canvasPoint.x, scaledControl.y - canvasPoint.y);
        if (controlDistance <= threshold) {
          return { annotationId: annotation.id, polygonIndex, pointIndex, controlType: "curveFrom" };
        }
      }
      const scaledPoint = scalePoint(polygon[pointIndex]);
      const distance = Math.hypot(scaledPoint.x - canvasPoint.x, scaledPoint.y - canvasPoint.y);
      if (distance <= threshold) {
        return { annotationId: annotation.id, polygonIndex, pointIndex };
      }
    }
  }
  for (let pointIndex = 0; pointIndex < interactionState.currentPolygon.length; pointIndex += 1) {
    if (interactionState.currentPolygon[pointIndex].curveFrom) {
      const scaledControl = scalePoint(interactionState.currentPolygon[pointIndex].curveFrom);
      const controlDistance = Math.hypot(scaledControl.x - canvasPoint.x, scaledControl.y - canvasPoint.y);
      if (controlDistance <= threshold) {
        return { polygonIndex: -1, pointIndex, controlType: "curveFrom" };
      }
    }
    const scaledPoint = scalePoint(interactionState.currentPolygon[pointIndex]);
    const distance = Math.hypot(scaledPoint.x - canvasPoint.x, scaledPoint.y - canvasPoint.y);
    if (distance <= threshold) {
      return { polygonIndex: -1, pointIndex };
    }
  }
  // Check ellipse handles (center + edge points).
  const ellipseAnnotations = getEllipseAnnotations();
  for (let ellipseIndex = 0; ellipseIndex < ellipseAnnotations.length; ellipseIndex += 1) {
    const annotation = ellipseAnnotations[ellipseIndex];
    const scaledEllipse = scaleEllipse(annotation.geometry);
    const handles = getEllipseHandles(scaledEllipse);
    for (const handle of handles) {
      const distance = Math.hypot(handle.x - canvasPoint.x, handle.y - canvasPoint.y);
      if (distance <= threshold) {
        return { annotationId: annotation.id, ellipseIndex, handleType: handle.type };
      }
    }
  }
  return null;
}

// Find the closest polygon edge near the cursor for Alt+click vertex insertion.
function findEdgeAtPoint(canvasPoint) {
  const threshold = 10;
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const polygonAnnotations = getPolygonAnnotations();
  for (let polygonIndex = 0; polygonIndex < polygonAnnotations.length; polygonIndex += 1) {
    const annotation = polygonAnnotations[polygonIndex];
    const polygon = annotation.geometry.points;
    if (!Array.isArray(polygon) || polygon.length < 2) {
      continue;
    }
    for (let pointIndex = 0; pointIndex < polygon.length; pointIndex += 1) {
      const nextIndex = (pointIndex + 1) % polygon.length;
      const start = scalePoint(polygon[pointIndex]);
      const end = scalePoint(polygon[nextIndex]);
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const segmentLengthSquared = dx * dx + dy * dy;
      if (segmentLengthSquared === 0) {
        continue;
      }
      const projectedT = clamp(
        ((canvasPoint.x - start.x) * dx + (canvasPoint.y - start.y) * dy) /
          segmentLengthSquared,
        0,
        1
      );
      const projectedCanvasX = start.x + projectedT * dx;
      const projectedCanvasY = start.y + projectedT * dy;
      const distance = Math.hypot(canvasPoint.x - projectedCanvasX, canvasPoint.y - projectedCanvasY);
      if (distance > threshold || distance >= bestDistance) {
        continue;
      }
      bestDistance = distance;
      // Convert the projected canvas-space point back to image-space.
      // scalePoint does: imageX * imageScale * viewZoom + viewOffsetX,
      // so the inverse is: (canvasX - viewOffsetX) / (imageScale * viewZoom).
      best = {
        annotationId: annotation.id,
        polygonIndex,
        insertIndex: pointIndex + 1,
        projectedPoint: {
          x: (projectedCanvasX - viewState.viewOffsetX) / (viewState.imageScale * viewState.viewZoom),
          y: (projectedCanvasY - viewState.viewOffsetY) / (viewState.imageScale * viewState.viewZoom),
        },
      };
    }
  }
  return best;
}

// Insert a vertex on the nearest edge (used by Alt+click in vertex edit mode).
function insertVertexOnNearestEdge(canvasPoint) {
  return commandRegistry.execute(COMMANDS.ANNOTATION_INSERT_VERTEX, { canvasPoint });
}

function performInsertVertexOnNearestEdge({ canvasPoint }) {
  const edgeHit = findEdgeAtPoint(canvasPoint);
  if (!edgeHit) {
    return false;
  }
  const polygon = getAnnotationById(annotationState.annotations, edgeHit.annotationId)?.geometry?.points;
  if (!polygon) {
    return false;
  }
  const snappedPoint = applySnap(edgeHit.projectedPoint);
  const insertIndex = clamp(edgeHit.insertIndex, 0, polygon.length);
  polygon.splice(insertIndex, 0, snappedPoint);
  selectAnnotation({ type: "polygon", index: edgeHit.polygonIndex });
  selectSingleVertex({ polygonIndex: edgeHit.polygonIndex, pointIndex: insertIndex });
  redraw();
  return true;
}

// Resolve marquee behavior from modifier keys.
function getSelectionModeFromEvent(event) {
  if (event.shiftKey) {
    return "add";
  }
  if (event.ctrlKey || event.metaKey) {
    return "subtract";
  }
  return "replace";
}

// Return all vertices contained in a canvas-space marquee rectangle.
function getVerticesInSelectionBox(selectionBox) {
  if (!selectionBox) {
    return [];
  }
  const minX = Math.min(selectionBox.start.x, selectionBox.end.x);
  const maxX = Math.max(selectionBox.start.x, selectionBox.end.x);
  const minY = Math.min(selectionBox.start.y, selectionBox.end.y);
  const maxY = Math.max(selectionBox.start.y, selectionBox.end.y);
  const selected = [];
  const polygonAnnotations = getPolygonAnnotations();
  for (let polygonIndex = 0; polygonIndex < polygonAnnotations.length; polygonIndex += 1) {
    const annotation = polygonAnnotations[polygonIndex];
    const polygon = annotation.geometry.points;
    for (let pointIndex = 0; pointIndex < polygon.length; pointIndex += 1) {
      const scaledPoint = scalePoint(polygon[pointIndex]);
      if (
        scaledPoint.x >= minX &&
        scaledPoint.x <= maxX &&
        scaledPoint.y >= minY &&
        scaledPoint.y <= maxY
      ) {
        selected.push({ annotationId: annotation.id, polygonIndex, pointIndex });
      }
    }
  }
  for (let pointIndex = 0; pointIndex < interactionState.currentPolygon.length; pointIndex += 1) {
    const scaledPoint = scalePoint(interactionState.currentPolygon[pointIndex]);
    if (
      scaledPoint.x >= minX &&
      scaledPoint.x <= maxX &&
      scaledPoint.y >= minY &&
      scaledPoint.y <= maxY
    ) {
      selected.push({ polygonIndex: -1, pointIndex });
    }
  }
  return selected;
}

// Apply marquee selection updates based on the active selection mode.
function finalizeSelectionBox() {
  if (!interactionState.selectionBox) {
    return;
  }
  const minX = Math.min(interactionState.selectionBox.start.x, interactionState.selectionBox.end.x);
  const maxX = Math.max(interactionState.selectionBox.start.x, interactionState.selectionBox.end.x);
  const minY = Math.min(interactionState.selectionBox.start.y, interactionState.selectionBox.end.y);
  const maxY = Math.max(interactionState.selectionBox.start.y, interactionState.selectionBox.end.y);
  const width = maxX - minX;
  const height = maxY - minY;
  const vertices = getVerticesInSelectionBox(interactionState.selectionBox);
  const isTinyBox = width < 3 && height < 3;

  // For modifier-click (no meaningful drag), still allow add/subtract
  // against the nearest vertex so the old click behavior remains usable.
  if (isTinyBox && interactionState.selectionMode !== "replace" && vertices.length === 0) {
    const vertexHit = findVertexAtPoint(interactionState.selectionBox.end);
    if (vertexHit && vertexHit.polygonIndex != null && vertexHit.pointIndex != null) {
      if (interactionState.selectionMode === "subtract") {
        removeVertexFromSelection(vertexHit);
      } else {
        addVertexToSelection(vertexHit);
      }
      interactionState.selectionBox = null;
      interactionState.selectionMode = "replace";
      return;
    }
  }

  if (interactionState.selectionMode === "replace") {
    clearVertexSelection();
  }
  vertices.forEach((vertex) => {
    if (interactionState.selectionMode === "subtract") {
      removeVertexFromSelection(vertex);
    } else {
      addVertexToSelection(vertex);
    }
  });
  interactionState.selectionBox = null;
  interactionState.selectionMode = "replace";
}

// Delete currently selected vertices while preserving polygon validity.
function deleteSelectedVertices() {
  return commandRegistry.execute(COMMANDS.ANNOTATION_DELETE_VERTICES);
}

function performDeleteSelectedVertices() {
  const verticesByPolygon = new Map();
  const draftPointIndices = new Set();
  interactionState.selectedVertexKeys.forEach((key) => {
    const separatorIndex = key.lastIndexOf("|");
    const annotationId = key.slice(0, separatorIndex);
    const pointIndexText = key.slice(separatorIndex + 1);
    const pointIndex = Number(pointIndexText);
    if (separatorIndex < 1 || !Number.isInteger(pointIndex)) {
      return;
    }
    if (annotationId === "draft") {
      if (pointIndex >= 0 && pointIndex < interactionState.currentPolygon.length) {
        draftPointIndices.add(pointIndex);
      }
      return;
    }
    const polygon = getAnnotationById(annotationState.annotations, annotationId)?.geometry?.points;
    if (!polygon || pointIndex < 0 || pointIndex >= polygon.length) {
      return;
    }
    if (!verticesByPolygon.has(annotationId)) {
      verticesByPolygon.set(annotationId, new Set());
    }
    verticesByPolygon.get(annotationId).add(pointIndex);
  });

  if (verticesByPolygon.size === 0 && draftPointIndices.size === 0) {
    return false;
  }

  let deletedCount = 0;
  let blockedPolygons = 0;
  verticesByPolygon.forEach((pointIndexSet, annotationId) => {
    const polygon = getAnnotationById(annotationState.annotations, annotationId)?.geometry?.points;
    if (!polygon) {
      return;
    }
    const pointIndices = [...pointIndexSet].sort((a, b) => b - a);
    const remainingCount = polygon.length - pointIndices.length;
    if (remainingCount < 3 && polygon.length >= 3) {
      blockedPolygons += 1;
      return;
    }
    pointIndices.forEach((pointIndex) => {
      polygon.splice(pointIndex, 1);
      deletedCount += 1;
    });
  });
  if (draftPointIndices.size > 0) {
    [...draftPointIndices]
      .sort((a, b) => b - a)
      .forEach((pointIndex) => {
        interactionState.currentPolygon.splice(pointIndex, 1);
        deletedCount += 1;
      });
  }

  if (blockedPolygons > 0 && deletedCount === 0) {
    alert(
      "Vertices were not deleted because polygons must keep at least 3 vertices. " +
        "Use Delete Selected Annotation to remove the full shape."
    );
  }
  if (deletedCount === 0) {
    return false;
  }
  clearVertexSelection();
  interactionState.activeVertex = null;
  redraw();
  return true;
}

function startAnnotationDrag(annotation, startImagePoint) {
  return commandRegistry.execute(COMMANDS.ANNOTATION_GEOMETRY_EDIT_START, {
    kind: "annotation",
    annotation,
    startImagePoint,
  });
}

function performStartAnnotationDrag(annotation, startImagePoint) {
  const resolved = annotation?.id
    ? getAnnotationById(annotationState.annotations, annotation.id)
    : getAnnotationAtTypeIndex(annotationState.annotations, annotation?.type, annotation?.index);
  if (!resolved) {
    return false;
  }
  const annotationIndex = getAnnotationTypeIndex(annotationState.annotations, resolved.id);
  if (resolved.type === "polygon") {
    const polygon = resolved.geometry.points;
    if (!Array.isArray(polygon) || polygon.length < 3) {
      return false;
    }
    interactionState.activeAnnotationDrag = {
      type: "polygon",
      annotationId: resolved.id,
      index: annotationIndex,
      start: { x: startImagePoint.x, y: startImagePoint.y },
      originPolygon: polygon.map((point) => clonePolygonPoint(point)),
    };
  } else if (resolved.type === "ellipse") {
    const ellipse = resolved.geometry;
    if (!ellipse) {
      return false;
    }
    interactionState.activeAnnotationDrag = {
      type: "ellipse",
      annotationId: resolved.id,
      index: annotationIndex,
      start: { x: startImagePoint.x, y: startImagePoint.y },
      originEllipse: { ...ellipse },
    };
  } else {
    return false;
  }
  selectAnnotation(getAnnotationReference(resolved));
  interactionState.activeVertex = null;
  interactionState.selectionBox = null;
  clearVertexSelection();
  interactionState.isDrawing = true;
  redraw();
  return true;
}

function beginVertexGeometryEdit(vertex) {
  return commandRegistry.execute(COMMANDS.ANNOTATION_GEOMETRY_EDIT_START, {
    kind: "vertex",
    vertex,
  });
}

function performStartGeometryEdit(payload = {}) {
  if (payload.kind === "annotation") {
    return performStartAnnotationDrag(payload.annotation, payload.startImagePoint);
  }
  if (payload.kind !== "vertex" || !payload.vertex) return false;
  interactionState.activeVertex = payload.vertex;
  interactionState.activeAnnotationDrag = null;
  interactionState.selectionBox = null;
  interactionState.isDrawing = true;
  redraw();
  return true;
}

function performUpdateGeometryEdit(payload = {}) {
  if (payload.kind === "annotation") {
    return performUpdateActiveAnnotationDrag(payload.point);
  }
  if (payload.kind === "vertex") {
    performUpdateActiveVertex(payload.point);
    return true;
  }
  return false;
}

function performEndGeometryEdit(payload = {}) {
  if (payload.kind === "annotation") {
    return performStopActiveAnnotationDrag();
  }
  if (payload.kind === "vertex" && interactionState.activeVertex) {
    interactionState.isDrawing = false;
    redraw();
    return true;
  }
  return false;
}

function updateActiveAnnotationDrag(point) {
  return commandRegistry.execute(COMMANDS.ANNOTATION_GEOMETRY_EDIT_UPDATE, {
    kind: "annotation",
    point,
  });
}

function performUpdateActiveAnnotationDrag(point) {
  if (!interactionState.activeAnnotationDrag) {
    return false;
  }
  const dx = point.x - interactionState.activeAnnotationDrag.start.x;
  const dy = point.y - interactionState.activeAnnotationDrag.start.y;

  if (interactionState.activeAnnotationDrag.type === "polygon") {
    const polygon = getAnnotationById(
      annotationState.annotations,
      interactionState.activeAnnotationDrag.annotationId
    )?.geometry?.points;
    const originPolygon = interactionState.activeAnnotationDrag.originPolygon;
    if (
      !Array.isArray(polygon) ||
      !Array.isArray(originPolygon) ||
      polygon.length !== originPolygon.length
    ) {
      return false;
    }
    for (let index = 0; index < polygon.length; index += 1) {
      const movedPoint = clampPointToImage({
        x: originPolygon[index].x + dx,
        y: originPolygon[index].y + dy,
      });
      polygon[index].x = movedPoint.x;
      polygon[index].y = movedPoint.y;
      if (originPolygon[index].curveFrom) {
        polygon[index].curveFrom = clampPointToImage({
          x: originPolygon[index].curveFrom.x + dx,
          y: originPolygon[index].curveFrom.y + dy,
        });
      }
    }
    redraw();
    return true;
  }

  if (interactionState.activeAnnotationDrag.type === "ellipse") {
    const ellipse = getAnnotationById(
      annotationState.annotations,
      interactionState.activeAnnotationDrag.annotationId
    )?.geometry;
    const originEllipse = interactionState.activeAnnotationDrag.originEllipse;
    if (!ellipse || !originEllipse) {
      return false;
    }
    ellipse.cx = originEllipse.cx + dx;
    ellipse.cy = originEllipse.cy + dy;
    redraw();
    return true;
  }

  return false;
}

function stopActiveAnnotationDrag() {
  return commandRegistry.execute(COMMANDS.ANNOTATION_GEOMETRY_EDIT_END, {
    kind: "annotation",
  });
}

function performStopActiveAnnotationDrag() {
  if (!interactionState.activeAnnotationDrag) {
    return false;
  }
  const drag = interactionState.activeAnnotationDrag;
  if (drag.type === "polygon") {
    const polygon = getAnnotationById(annotationState.annotations, drag.annotationId)?.geometry?.points;
    if (Array.isArray(polygon)) {
      clampPolygonNodesToImage(polygon);
    }
  } else if (drag.type === "ellipse") {
    fitEllipseInsideImage(getAnnotationById(annotationState.annotations, drag.annotationId)?.geometry);
  }
  interactionState.activeAnnotationDrag = null;
  interactionState.isDrawing = false;
  redraw();
  return true;
}

// Move the selected vertex to a new image-space position.
function updateActiveVertex(point) {
  return commandRegistry.execute(COMMANDS.ANNOTATION_GEOMETRY_EDIT_UPDATE, {
    kind: "vertex",
    point,
  });
}

function performUpdateActiveVertex(point) {
  if (!interactionState.activeVertex) {
    return;
  }

  // ── Ellipse handle dragging ──
  if (interactionState.activeVertex.ellipseIndex != null) {
    const { annotationId, ellipseIndex, handleType } = interactionState.activeVertex;
    const ellipse = annotationId
      ? getAnnotationById(annotationState.annotations, annotationId)?.geometry
      : getEllipseGeometry(ellipseIndex);
    if (!ellipse) return;
    const snapped = applySnap(point);
    const clamped = clampPointToImage(snapped);
    if (handleType === "center") {
      ellipse.cx = clamped.x;
      ellipse.cy = clamped.y;
      fitEllipseInsideImage(ellipse);
    } else if (handleType === "right") {
      const bounds = getImageBounds();
      ellipse.rx = Math.min(Math.abs(clamped.x - ellipse.cx), ellipse.cx, bounds.maxX - ellipse.cx);
    } else if (handleType === "left") {
      const bounds = getImageBounds();
      ellipse.rx = Math.min(Math.abs(ellipse.cx - clamped.x), ellipse.cx, bounds.maxX - ellipse.cx);
    } else if (handleType === "bottom") {
      const bounds = getImageBounds();
      ellipse.ry = Math.min(Math.abs(clamped.y - ellipse.cy), ellipse.cy, bounds.maxY - ellipse.cy);
    } else if (handleType === "top") {
      const bounds = getImageBounds();
      ellipse.ry = Math.min(Math.abs(ellipse.cy - clamped.y), ellipse.cy, bounds.maxY - ellipse.cy);
    }
    redraw();
    return;
  }

  // ── Polygon vertex dragging ──
  const { polygonIndex, pointIndex } = interactionState.activeVertex;
  if (polygonIndex === -1) {
    if (!interactionState.currentPolygon[pointIndex]) {
      return;
    }
    if (interactionState.activeVertex.controlType === "curveFrom") {
      interactionState.currentPolygon[pointIndex].curveFrom = clampPointToImage(applySnap(point));
    } else {
      const existingCurve = interactionState.currentPolygon[pointIndex].curveFrom;
      const snapped = clampPointToImage(applySnap(point));
      interactionState.currentPolygon[pointIndex] = { x: snapped.x, y: snapped.y };
      if (existingCurve) {
        interactionState.currentPolygon[pointIndex].curveFrom = existingCurve;
      }
    }
    redraw();
    return;
  }
  const polygon = interactionState.activeVertex.annotationId
    ? getAnnotationById(annotationState.annotations, interactionState.activeVertex.annotationId)?.geometry?.points
    : getPolygonGeometry(polygonIndex);
  if (!polygon?.[pointIndex]) {
    return;
  }
  if (interactionState.activeVertex.controlType === "curveFrom") {
    polygon[pointIndex].curveFrom = clampPointToImage(applySnap(point));
  } else {
    const existingCurve = polygon[pointIndex].curveFrom;
    const snapped = clampPointToImage(applySnap(point));
    polygon[pointIndex] = { x: snapped.x, y: snapped.y };
    if (existingCurve) {
      polygon[pointIndex].curveFrom = existingCurve;
    }
  }
  redraw();
}

// ── SECTION 17: JSON IMPORT ─────────────────────────────────────────────
// Accepts annotation data in three formats:
//   • MS COCO   – detected by the presence of `images[]` + `annotations[]`.
//   • LLNL      – detected by `shapes[]` (our native export format).
//   • Legacy    – a simpler format with top-level `polygons[]` / `ellipses[]`.

// Load annotations from a JSON file and redraw.
function loadAnnotationData(data) {
  const imported = parseAnnotationDocument(data, { currentImageName: imageState.imageName });
  return commandRegistry.execute(COMMANDS.DOCUMENT_REPLACE, { imported });
}

function performLoadAnnotationData({ imported }) {
  // Commit only after the complete document has parsed and validated. A bad
  // file therefore leaves the current annotation session untouched.
  closeCanvasLabelEditor();
  closeCanvasContextMenu();
  labelColorAssignments.clear();
  annotationState.annotations = imported.annotations;
  annotationState.lastPolygonLabel = imported.lastLabel;
  if (imported.imageSize) {
    imageState.imageSize = imported.imageSize;
    resizeCanvasToImage();
  }
  if (imported.imageName) {
    imageState.imageName = imported.imageName;
  }
  interactionState.currentPolygon = [];
  interactionState.currentCurveControl = null;
  interactionState.curveSegmentMode = false;
  interactionState.activeVertex = null;
  interactionState.activeAnnotationDrag = null;
  interactionState.selectionBox = null;
  clearVertexSelection();
  resetViewTransform();
  selectAnnotation(null);
  redraw();
  return true;
}

// ── SECTION 18: EVENT LISTENERS ─────────────────────────────────────────
// Everything below wires user interactions (clicks, key presses, slider
// changes, file uploads, wheel events) to the functions defined above.
// Most listeners follow the same pattern:
//   1. Read the event (which key, which value, which file).
//   2. Update the responsible named state slice.
//   3. Call redraw() so the canvas reflects the new state.
const viewController = createViewController({
  imageState,
  interactionState,
  viewState,
  canvas,
  canvasWrap,
  controls: {
    fitWindow: fitWindowButton,
    zoomIn: zoomInButton,
    zoomOut: zoomOutButton,
    zoomReset: zoomResetButton,
  },
  redraw,
  syncAdjustmentLabels,
});
const {
  getCanvasPoint,
  getDisplayedImageSize,
  getImagePoint,
  resetViewTransform,
  resizeCanvasToImage,
  setViewZoom,
  syncCanvasCursor,
} = viewController;

const toolController = createToolController({
  interactionState,
  commandRegistry,
  tools: { polygon: TOOL_POLYGON, rectangle: TOOL_RECTANGLE, ellipse: TOOL_ELLIPSE },
  buttons: {
    polygon: toolPolygonBtn,
    curveSegment: toolCurveSegmentBtn,
    rectangle: toolRectangleBtn,
    ellipse: toolEllipseBtn,
    vertexEdit: toolVertexEditBtn,
  },
  closeCanvasLabelEditor,
  closeCanvasContextMenu,
  clearVertexSelection,
  syncCanvasCursor,
  redraw,
});
const { setTool, cancelActiveShapePlacement, syncToolStripUI } = toolController;

const pointerController = createPointerController({
  canvas,
  documentTarget: document,
  imageState,
  interactionState,
  tools: { polygon: TOOL_POLYGON, rectangle: TOOL_RECTANGLE, ellipse: TOOL_ELLIPSE },
  commandRegistry,
  view: viewController,
  redraw,
  applySnap,
  closeCanvasContextMenu,
  isCanvasContextMenuOpen,
  contextMenuContains: (target) => target instanceof Element && canvasContextMenu?.contains(target),
  openCanvasContextMenu,
  closeCanvasLabelEditor,
  isCanvasLabelEditorOpen,
  getSelectionModeFromEvent,
  insertVertexOnNearestEdge,
  findVertexAtPoint,
  selectAnnotation,
  clearVertexSelection,
  beginVertexGeometryEdit,
  addVertexToSelection,
  removeVertexFromSelection,
  selectSingleVertex,
  findAnnotationAtPoint,
  startAnnotationDrag,
  addPolygonPoint,
  startRectangle,
  startEllipse,
  updateRectangle,
  updateEllipse,
  updateActiveAnnotationDrag,
  updateActiveVertex,
  stopActiveAnnotationDrag,
  finalizeSelectionBox,
});

const keyboardController = createKeyboardController({
  target: document,
  interactionState,
  commandRegistry,
  isEditableTarget,
  isNewImageConfirmModalOpen,
  cancelPendingImageLoad,
  handleNewImageModalTab: (event) => handleModalTab(event, newImageConfirmModal),
  isShortcutsModalOpen,
  openShortcutsModal,
  closeShortcutsModal,
  handleShortcutsModalTab,
  isCanvasLabelEditorOpen,
  closeCanvasLabelEditor,
  isCanvasContextMenuOpen,
  closeCanvasContextMenu,
  cancelActiveShapePlacement,
  closeFloatingDialogs: () =>
    [brightnessDialog, snapDialog, displayDialog].forEach((dialog) =>
      closeFloatingDialog(dialog)
    ),
  cycleAnnotationSelection,
  polygonTool: TOOL_POLYGON,
});

viewController.bind();
toolController.bind();
pointerController.bind();
keyboardController.bind();
bindCommandElements(document, commandRegistry);

imageInput.addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (!file) {
    return;
  }
  if (file.type !== "image/png") {
    alert("Please upload a PNG image.");
    event.target.value = "";
    return;
  }
  if (!loadImage(file)) {
    event.target.value = "";
  }
});

jsonInput.addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (!file) {
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try {
      data = JSON.parse(reader.result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      alert(`Could not parse JSON: ${message}`);
      return;
    }

    try {
      loadAnnotationData(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      alert(`Could not import annotations: ${message}`);
    }
  };
  reader.readAsText(file);
});

if (annotationTimerStart) {
  annotationTimerStart.addEventListener("click", startAnnotationTimer);
}

if (annotationTimerStop) {
  annotationTimerStop.addEventListener("click", () => {
    stopAnnotationTimer();
  });
}

if (annotationTimerReset) {
  annotationTimerReset.addEventListener("click", resetAnnotationTimer);
}

// ── Tool strip buttons ──
// ── Floating dialog toggles ──
const allFloatingDialogs = [brightnessDialog, snapDialog, displayDialog];

function toggleFloatingDialog(dialog) {
  if (!dialog) return;
  if (dialog.hasAttribute("hidden")) {
    // Close any other open dialog first
    allFloatingDialogs.forEach((d) => { if (d && d !== dialog) closeFloatingDialog(d); });
    // Reset drag position so it re-centers on open
    dialog.style.left = "";
    dialog.style.top = "";
    dialog.style.transform = "";
    delete dialog.dataset.dragged;
    dialog.removeAttribute("hidden");
    dialog.setAttribute("aria-hidden", "false");
  } else {
    dialog.setAttribute("hidden", "");
    dialog.setAttribute("aria-hidden", "true");
  }
}

function closeFloatingDialog(dialog) {
  if (!dialog) return;
  dialog.setAttribute("hidden", "");
  dialog.setAttribute("aria-hidden", "true");
}

// ── Draggable floating dialogs ──
function makeDraggable(dialog) {
  const header = dialog.querySelector(".floating-dialog-header");
  if (!header) return;
  header.style.cursor = "grab";
  let startX, startY, startLeft, startTop;

  function onMouseDown(event) {
    if (event.target.closest("button")) return;
    event.preventDefault();
    // On first drag, switch from centered transform to explicit top/left
    if (!dialog.dataset.dragged) {
      const rect = dialog.getBoundingClientRect();
      dialog.style.left = rect.left + "px";
      dialog.style.top = rect.top + "px";
      dialog.style.transform = "none";
      dialog.dataset.dragged = "true";
    }
    startX = event.clientX;
    startY = event.clientY;
    startLeft = parseInt(dialog.style.left, 10);
    startTop = parseInt(dialog.style.top, 10);
    header.style.cursor = "grabbing";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  function onMouseMove(event) {
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    dialog.style.left = (startLeft + dx) + "px";
    dialog.style.top = (startTop + dy) + "px";
  }

  function onMouseUp() {
    header.style.cursor = "grab";
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  }

  header.addEventListener("mousedown", onMouseDown);
}

[brightnessDialog, snapDialog, displayDialog].forEach((d) => {
  if (d) makeDraggable(d);
});

if (openBrightnessBtn) {
  openBrightnessBtn.addEventListener("click", () => toggleFloatingDialog(brightnessDialog));
}
if (closeBrightnessBtn) {
  closeBrightnessBtn.addEventListener("click", () => closeFloatingDialog(brightnessDialog));
}
if (openSnapBtn) {
  openSnapBtn.addEventListener("click", () => toggleFloatingDialog(snapDialog));
}
if (closeSnapBtn) {
  closeSnapBtn.addEventListener("click", () => closeFloatingDialog(snapDialog));
}
if (openDisplayBtn) {
  openDisplayBtn.addEventListener("click", () => toggleFloatingDialog(displayDialog));
}
if (closeDisplayBtn) {
  closeDisplayBtn.addEventListener("click", () => closeFloatingDialog(displayDialog));
}

// ── Fit Window (toggle) ──

gridToggle.addEventListener("change", (event) => {
  applySettings({ gridEnabled: event.target.checked });
});

snapToggle.addEventListener("change", (event) => {
  applySettings({ snapEnabled: event.target.checked });
});

if (smartSnapToggle) {
  smartSnapToggle.addEventListener("change", (event) => {
    applySettings({ smartSnapEnabled: event.target.checked });
  });
}

if (snapBorderToggle) {
  snapBorderToggle.addEventListener("change", (event) => {
    applySettings({ snapToBorder: event.target.checked });
  });
}

if (snapEdgeToggle) {
  snapEdgeToggle.addEventListener("change", (event) => {
    applySettings({ snapToEdge: event.target.checked });
  });
}

if (snapExtremaToggle) {
  snapExtremaToggle.addEventListener("change", (event) => {
    applySettings({ snapToExtrema: event.target.checked });
  });
}

if (snapExtremaModeSelect) {
  snapExtremaModeSelect.addEventListener("change", (event) => {
    applySettings({ snapExtremaMode: event.target.value });
  });
}

gridSizeInput.addEventListener("change", (event) => {
  const value = Number(event.target.value);
  if (Number.isFinite(value) && value > 0) {
    applySettings({ gridSize: value });
  }
});

if (gridMajorEveryInput) {
  gridMajorEveryInput.addEventListener("change", (event) => {
    const value = Number(event.target.value);
    if (Number.isFinite(value) && value >= 2) {
      applySettings({ gridMajorEvery: value });
    }
  });
}

if (snapRadiusInput) {
  snapRadiusInput.addEventListener("change", (event) => {
    const value = Number(event.target.value);
    if (Number.isFinite(value) && value > 0) {
      applySettings({ snapRadius: value });
    }
  });
}

if (snapBorderThresholdInput) {
  snapBorderThresholdInput.addEventListener("change", (event) => {
    const value = Number(event.target.value);
    if (Number.isFinite(value) && value >= 0) {
      applySettings({ snapBorderThreshold: value });
    }
  });
}

if (snapExtremaDeltaInput) {
  snapExtremaDeltaInput.addEventListener("change", (event) => {
    const value = Number(event.target.value);
    if (Number.isFinite(value) && value >= 0) {
      applySettings({ snapExtremaDelta: value });
    }
  });
}

if (applyPresetButton) {
  applyPresetButton.addEventListener("click", () => {
    const presetId = snapPresetSelect?.value || "balanced";
    const preset = SNAP_PRESETS[presetId];
    if (!preset) {
      return;
    }
    applySettings(preset, { presetId });
  });
}

if (resetSettingsButton) {
  resetSettingsButton.addEventListener("click", () => {
    applySettings(DEFAULT_SETTINGS, { presetId: "balanced" });
  });
}

function bindRangeInput(input, callback) {
  if (!input) {
    return;
  }
  const handleUpdate = (event) => {
    const value = Number(event.target.value);
    if (!Number.isFinite(value)) {
      return;
    }
    callback(value);
    syncAdjustmentLabels();
    redraw();
  };
  input.addEventListener("input", handleUpdate);
  input.addEventListener("change", handleUpdate);
}

bindRangeInput(imageContrastInput, (value) => {
  settingsState.imageContrast = value;
});

bindRangeInput(gridOpacityInput, (value) => {
  settingsState.gridOpacity = value;
});

bindRangeInput(snapEdgeThresholdInput, (value) => {
  settingsState.snapEdgeThreshold = value;
});

bindRangeInput(maskContrastInput, (value) => {
  settingsState.maskContrast = value;
});

bindRangeInput(maskOpacityInput, (value) => {
  settingsState.maskOpacity = value;
});

window.addEventListener("resize", () => {
  resizeCanvasToImage();
  closeCanvasContextMenu();
  if (isCanvasLabelEditorOpen()) {
    positionCanvasLabelEditor(uiState.activeLabelEdit?.anchorImagePoint || null);
  }
  redraw();
});

window.addEventListener("blur", () => {
  closeCanvasContextMenu();
  pointerController.handlePointerEnd();
});

if (outputFormatSelect) {
  settingsState.outputFormat = outputFormatSelect.value || settingsState.outputFormat;
  outputFormatSelect.addEventListener("change", (event) => {
    settingsState.outputFormat = event.target.value;
    redraw();
  });
  outputFormatSelect.value = settingsState.outputFormat;
}

if (sourceEnhancementSelect) {
  sourceEnhancementSelect.addEventListener("change", (event) => {
    applySettings({ sourceEnhancement: event.target.value });
  });
}

if (openShortcutsButton) {
  openShortcutsButton.addEventListener("click", () => {
    openShortcutsModal();
  });
}

if (closeShortcutsButton) {
  closeShortcutsButton.addEventListener("click", () => {
    closeShortcutsModal();
  });
}

if (shortcutsModal) {
  shortcutsModal.addEventListener("click", (event) => {
    if (event.target === shortcutsModal) {
      closeShortcutsModal();
    }
  });
}

if (confirmNewImageLoadButton) {
  confirmNewImageLoadButton.addEventListener("click", () => {
    confirmPendingImageLoad();
  });
}

if (cancelNewImageLoadButton) {
  cancelNewImageLoadButton.addEventListener("click", () => {
    cancelPendingImageLoad();
  });
}

if (cancelNewImageLoadTopButton) {
  cancelNewImageLoadTopButton.addEventListener("click", () => {
    cancelPendingImageLoad();
  });
}

if (newImageConfirmModal) {
  newImageConfirmModal.addEventListener("click", (event) => {
    if (event.target === newImageConfirmModal) {
      cancelPendingImageLoad();
    }
  });
}

if (canvasLabelEditorOk) {
  canvasLabelEditorOk.addEventListener("click", () => {
    closeCanvasLabelEditor({ commit: true });
  });
}

if (canvasLabelEditorCancel) {
  canvasLabelEditorCancel.addEventListener("click", () => {
    closeCanvasLabelEditor();
  });
}

if (canvasLabelEditorInput) {
  canvasLabelEditorInput.addEventListener("input", (event) => {
    const value =
      event && event.target && "value" in event.target
        ? String(event.target.value)
        : canvasLabelEditorInput.value;
    renderCanvasLabelSuggestions(value);
  });

  canvasLabelEditorInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      closeCanvasLabelEditor({ commit: true });
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeCanvasLabelEditor();
    }
  });
}

if (canvasLabelEditorSuggestions) {
  canvasLabelEditorSuggestions.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }
    const button = event.target.closest("[data-label]");
    if (!button) {
      return;
    }
    const label = sanitizePolygonLabel(button.getAttribute("data-label"));
    if (canvasLabelEditorInput) {
      canvasLabelEditorInput.value = label;
    }
    closeCanvasLabelEditor({ commit: true });
  });
}

if (canvasContextMenu) {
  canvasContextMenu.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  canvasContextMenu.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }
    const menuItem = event.target.closest("[data-action]");
    if (!(menuItem instanceof HTMLButtonElement) || menuItem.disabled) {
      return;
    }
    closeCanvasContextMenu();
    runCanvasContextAction(menuItem.dataset.action || "");
  });
}

if (polygonLabelList) {
  polygonLabelList.addEventListener("click", (event) => {
    if (isCanvasLabelEditorOpen()) {
      closeCanvasLabelEditor({ commit: true });
    }
    if (!(event.target instanceof Element)) {
      return;
    }
    const target = event.target.closest("[data-annotation-index]");
    if (!target) {
      return;
    }
    const annotationType = target.dataset.annotationType === "ellipse" ? "ellipse" : "polygon";
    const annotationIndex = Number(target.dataset.annotationIndex);
    const maxIndex = getAnnotationsByType(annotationState.annotations, annotationType).length;
    if (!Number.isInteger(annotationIndex) || annotationIndex < 0 || annotationIndex >= maxIndex) {
      return;
    }
    selectAnnotation({ type: annotationType, index: annotationIndex });
    interactionState.activeVertex = null;
    clearVertexSelection();
    redraw();
  });

  polygonLabelList.addEventListener("dblclick", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }
    const target = event.target.closest("[data-annotation-index]");
    if (!target) {
      return;
    }
    const annotationType = target.dataset.annotationType === "ellipse" ? "ellipse" : "polygon";
    const annotationIndex = Number(target.dataset.annotationIndex);
    renameAnnotationLabel({ type: annotationType, index: annotationIndex });
  });
}

if (renameSelectedPolygonButton) {
  renameSelectedPolygonButton.addEventListener("click", () => {
    normalizeSelectedAnnotation();
    const selectedAnnotation = getSelectedAnnotation();
    if (!selectedAnnotation) {
      alert("Select a shape first.");
      return;
    }
    renameAnnotationLabel(getAnnotationReference(selectedAnnotation));
  });
}

if (selectedShapeColorInput) {
  selectedShapeColorInput.addEventListener("input", (event) => {
    const nextColor =
      event && event.target && "value" in event.target
        ? String(event.target.value)
        : selectedShapeColorInput.value;
    setSelectedAnnotationColor(nextColor);
  });
}

if (snapPresetSelect) {
  snapPresetSelect.value = "balanced";
}

syncControlValuesFromState();

syncAdjustmentLabels();
renderAnnotationTimer();
redraw();
document.documentElement.dataset.appReady = "true";
