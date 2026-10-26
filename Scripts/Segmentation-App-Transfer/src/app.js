import { DEFAULT_SETTINGS, normalizeSettings } from "./config/settings.js";
import { createAppState } from "./state/create-app-state.js";
import { createAppHistory } from "./state/app-history.js";
import { createCoordinateService } from "./geometry/coordinate-service.js";
import { createSnapService } from "./geometry/snap-service.js";
import { bindCommandElements, createCommandRegistry } from "./commands/command-registry.js";
import { COMMANDS } from "./commands/command-names.js";
import { createDownloadService } from "./io/download-service.js";
import { createEmbeddedImageImporter } from "./io/embedded-image-import.js";
import { inspectAnnotationQuality } from "./quality/annotation-quality.js";
import { createAnnotationQualityReview } from "./ui/annotation-quality-review.js";
import { createClassCatalogDialog } from "./ui/class-catalog-dialog.js";
import { emptyClassCatalog, normalizeClassCatalog, validateCatalogAnnotations } from "./model/class-catalog.js";
import { createClassCatalogStore } from "./session/class-catalog-store.js";
import { createClassWorkflow } from "./model/class-workflow.js";
import { getReviewStatus } from "./model/annotation-review.js";
import { isAnnotationVisible, isAnnotationEditable, matchesAnnotationFilter } from "./model/annotation-visibility.js";
import { createImageCache } from "./image/image-cache.js";
import { createImageLoader } from "./image/image-loader.js";
import { createImageProcessing } from "./image/image-processing.js";
import { createCanvasRenderer } from "./render/canvas-renderer.js";
import { createRenderInvalidation } from "./render/invalidation.js";
import { createMaskRenderer } from "./render/mask-renderer.js";
import { createKeyboardController } from "./controllers/keyboard-controller.js";
import { createFeatureController } from "./controllers/feature-controller.js";
import { createPointerController } from "./controllers/pointer-controller.js";
import { createToolActions } from "./controllers/tool-actions.js";
import { createToolController } from "./controllers/tool-controller.js";
import { createViewController } from "./controllers/view-controller.js";
import { createAnnotationCatalog } from "./model/annotation-catalog.js";
import {
  DEFAULT_ANNOTATION_LABELS,
  getDefaultLabelForTool,
} from "./model/annotation-labels.js";
import { isEditableTarget } from "./utils/editable-target.js";
import { createAnnotationTimer } from "./ui/annotation-timer.js";
import { createAppPresenter } from "./ui/app-presenter.js";
import { createCanvasContextMenu } from "./ui/canvas-context-menu.js";
import { createCanvasLabelEditor } from "./ui/canvas-label-editor.js";
import { getDomElements } from "./ui/dom-elements.js";
import { createFloatingDialogs } from "./ui/floating-dialogs.js";
import { createImageLoadStatus } from "./ui/image-load-status.js";
import { createImageMetadataPanel } from "./ui/metadata-panel.js";
import { createModalController } from "./ui/modal-controller.js";
import { createLabelPanels } from "./ui/label-panels.js";
import { createAnnotationWorkflows } from "./workflows/annotation-workflows.js";
import { createDocumentWorkflows } from "./workflows/document-workflows.js";
import { createBootstrapAssembly } from "./bootstrap/bootstrap-assembly.js";
import { createAnalyticsController } from "./analytics/analytics-controller.js";
import { normalizeCalibration } from "./analytics/analytics-data.js";
import { createSessionStore } from "./session/session-store.js";
import { createSessionAutosave } from "./session/session-autosave.js";
import { captureSessionSnapshot, validateSessionSnapshot, applySessionSnapshot } from "./session/session-snapshot.js";
import { createProjectStore } from "./session/project-store.js";
import { createProjectController } from "./session/project-controller.js";
import { createProjectDrawer } from "./ui/project-drawer.js";
import { prepareProjectFile, prepareProjectDocument, projectThumbnail } from "./io/project-images.js";
import { buildProjectExport, inspectProjectExport } from "./io/project-export.js";

/*
 * Browser composition root.
 *
 * Feature algorithms live in model, workflow, renderer, controller, state,
 * image, I/O, and UI modules. This entry point resolves the DOM, creates the
 * application state and services, connects dependencies and commands, binds
 * controllers, and performs the initial render.
 */

// ── SECTION 1: DOM REFERENCES ───────────────────────────────────────────
// The registry owns selectors; this entry point only receives resolved elements.
const {
  canvas,
  imageInput,
  jsonInput,
  gridToggle,
  snapToggle,
  snapPresetSelect,
  applyPresetButton,
  resetSettingsButton,
  smartSnapToggle,
  snapBorderToggle,
  snapEdgeToggle,
  snapExtremaToggle,
  snapExtremaModeSelect,
  gridSizeInput,
  gridOpacityInput,
  gridMajorEveryInput,
  snapRadiusInput,
  snapBorderThresholdInput,
  snapEdgeThresholdInput,
  snapExtremaDeltaInput,
  sourceEnhancementSelect,
  imageContrastInput,
  maskContrastInput,
  maskOpacityInput,
  imageContrastValue,
  snapEdgeThresholdValue,
  gridOpacityValue,
  maskContrastValue,
  maskOpacityValue,
  outputFormatSelect,
  emptyState,
  canvasWrap,
  canvasLabelEditor,
  canvasLabelEditorTitle,
  canvasLabelEditorInput,
  canvasLabelEditorSuggestions,
  canvasLabelEditorOk,
  canvasLabelEditorCancel,
  canvasContextMenu,
  zoomOutButton,
  zoomInButton,
  zoomResetButton,
  fitWindowButton,
  zoomValue,
  openShortcutsButton,
  shortcutsModal,
  closeShortcutsButton,
  newImageConfirmModal,
  confirmNewImageLoadButton,
  cancelNewImageLoadButton,
  cancelNewImageLoadTopButton,
  metaImageName,
  metaImageDimensions,
  metaImageSize,
  metaImageType,
  metaImageUpdated,
  annotationTimerValue,
  annotationTimerStart,
  annotationTimerStop,
  annotationTimerReset,
  imageLoadStatus,
  imageLoadStatusText,
  imageLoadPercent,
  imageLoadProgress,
  imageLoadProgressFill,
  labelListUnique,
  labelListCount,
  polygonLabelList,
  renameSelectedPolygonButton,
  selectedShapeColorInput,
  toolPolygonBtn,
  toolCurveSegmentBtn,
  toolRectangleBtn,
  toolEllipseBtn,
  toolVertexEditBtn,
  brightnessDialog,
  closeBrightnessBtn,
  openBrightnessBtn,
  snapDialog,
  closeSnapBtn,
  openSnapBtn,
  displayDialog,
  closeDisplayBtn,
  openDisplayBtn,
} = getDomElements(document);
const ctx = canvas.getContext("2d");

// Application state
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
const annotationIsVisible = annotation => isAnnotationVisible(annotation, uiState.annotationClassFilter);
const annotationIsEditable = annotation => isAnnotationEditable(annotation, uiState.annotationClassFilter);

function canChangeInspection() {
  return imageState.imageLoadStatus !== "loading" && !uiState.activeLabelEdit
    && !(interactionState.isDrawing && (interactionState.activeVertex || interactionState.activeAnnotationDrag));
}

function redrawInspection() {
  bootstrap.resolve("labelPanelsController").render();
  requestCanvasRender();
}

const bootstrap = createBootstrapAssembly([
  "core-services",
  "application-services",
  "command-routing",
  "interactive-controllers",
  "event-binding",
  "initial-render",
]);
bootstrap.enter("core-services");

let sessionAutosave = null;
let projectController = null;
let projectImportGeneration = 0;
let sessionImage = null;
let recoveringImage = null;
const classCatalogStore = createClassCatalogStore();
let classCatalog = emptyClassCatalog();
let classCatalogRevision = 0;
let classCatalogObservedRevision = 0;
let classCatalogRecoveryRevision = null;
let classCatalogError = "The class catalog is still loading.";
let refreshClassWorkflow = () => {};
const classWorkflow = createClassWorkflow({
  annotationState, interactionState, imageState,
  getCatalog: () => classCatalog,
  getCatalogError: () => classCatalogError,
  isLabelEditorOpen: () => Boolean(uiState.activeLabelEdit),
});
const classCatalogButton = document.getElementById("openClassCatalog");
const classCatalogChannel = typeof BroadcastChannel === "function"
  ? new BroadcastChannel("segmentation-annotator-class-catalog") : null;

function updateClassCatalogStatus() {
  classCatalogButton.dataset.enabled = String(classCatalog.enabled);
  classCatalogButton.dataset.error = String(Boolean(classCatalogError));
  classCatalogButton.title = classCatalogError || (classCatalog.enabled
    ? `Reusable class catalog enabled (${classCatalog.classes.length} classes)` : "Manage reusable classes across images");
  refreshClassWorkflow();
}

function getClassCatalog() {
  if (classCatalogError) throw new Error(classCatalogRecoveryRevision !== null ? classCatalogError
    : `${classCatalogError} Open Classes and reload the saved catalog before using MS COCO.`);
  return classCatalog;
}

async function reloadClassCatalog() {
  try {
    const loaded = await classCatalogStore.load();
    classCatalog = loaded.catalog;
    classCatalogRevision = loaded.revision;
    classCatalogRecoveryRevision = null;
    classCatalogError = classCatalogObservedRevision > classCatalogRevision
      ? "The class catalog changed in another tab." : "";
    updateClassCatalogStatus();
    if (classCatalogError) throw new Error(classCatalogError);
    if (canvasLabelEditorController.isOpen()) {
      canvasLabelEditorController.renderSuggestions(canvasLabelEditorInput.value);
    }
    return classCatalog;
  } catch (error) {
    classCatalogRecoveryRevision = error.name === "ClassCatalogDataError" ? error.catalogRevision : null;
    classCatalogError = error instanceof Error ? error.message : String(error);
    updateClassCatalogStatus();
    throw error;
  }
}

classCatalogChannel?.addEventListener("message", ({ data }) => {
  if (!Number.isSafeInteger(data?.revision) || data.revision <= classCatalogRevision) return;
  classCatalogObservedRevision = Math.max(classCatalogObservedRevision, data.revision);
  classCatalogError = "The class catalog changed in another tab.";
  classCatalogRecoveryRevision = null;
  updateClassCatalogStatus();
});
const history = createAppHistory({
  imageState,
  annotationState,
  interactionState,
  getLabelColorAssignments: () => annotationCatalog.colorAssignments,
  maxEntries: 50,
  onRestore: () => {
    bootstrap.resolve("appPresenter").redraw();
    sessionAutosave?.notifyChange();
  },
  onImageSizeRestore: bootstrap.method("viewController", "resizeCanvasToImage"),
});

// Application constants
const TOOL_POLYGON = "polygon";
const TOOL_RECTANGLE = "rectangle";
const TOOL_ELLIPSE = "ellipse";
const MIN_SHAPE_DRAG_PIXELS = 1;
const CLOSE_SNAP_RADIUS = 10;
const DEFAULT_POLYGON_LABEL = DEFAULT_ANNOTATION_LABELS.polygon;
const DEFAULT_ELLIPSE_LABEL = DEFAULT_ANNOTATION_LABELS.ellipse;
const DEFAULT_RECTANGLE_LABEL = getDefaultLabelForTool(TOOL_RECTANGLE);

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
const annotationCatalog = createAnnotationCatalog({
  annotationState,
  interactionState,
  labels: {
    polygon: DEFAULT_POLYGON_LABEL,
    ellipse: DEFAULT_ELLIPSE_LABEL,
  },
  baseColors: {
    polygon: POLYGON_BASE_COLOR,
    ellipse: ELLIPSE_BASE_COLOR,
  },
  colorPalette: LABEL_COLOR_PALETTE,
  getReusableLabels: () => classCatalog.enabled ? classCatalog.classes.map(entry => entry.name) : [],
});

const renderInvalidation = createRenderInvalidation();
const imageProcessing = createImageProcessing({ documentRoot: document });
const imageCache = createImageCache({
  imageState,
  settingsState,
  imageProcessing,
});
const {
  ensure: ensureImageAnalysisCaches,
  getActiveAnalysis: getActiveImageAnalysis,
  getActiveImageSource,
} = imageCache;
const coordinates = createCoordinateService({ imageState, viewState });
const {
  fitEllipseInsideImage,
  fitPolygonInsideImage,
  scalePoint,
} = coordinates;
const snapService = createSnapService({
  settingsState,
  coordinates,
  getActiveImageAnalysis,
});
const { applySnap } = snapService;
const annotationWorkflows = createAnnotationWorkflows({
  annotationState,
  interactionState,
  getActiveClass: classWorkflow.getActiveClass,
  isClassAvailable: classWorkflow.isClassAvailable,
  isAnnotationVisible: annotationIsVisible,
  isAnnotationEditable: annotationIsEditable,
  matchesSelectionFilter: annotation => matchesAnnotationFilter(annotation, uiState.annotationClassFilter),
  coordinates,
  applySnap,
  executeCommand: bootstrap.method("commandRegistry", "execute"),
  redraw: bootstrap.method("appPresenter", "redraw"),
  redrawSelection: bootstrap.method("appPresenter", "redrawSelection"),
  startTimer: bootstrap.method("annotationTimer", "start"),
  openLabelEditor: bootstrap.method("canvasLabelEditorController", "open"),
  syncToolStrip: bootstrap.method("toolController", "syncToolStripUI"),
  getDefaultShapeColor: annotationCatalog.getDefaultShapeColor,
  labels: {
    polygon: DEFAULT_POLYGON_LABEL,
    rectangle: DEFAULT_RECTANGLE_LABEL,
    ellipse: DEFAULT_ELLIPSE_LABEL,
  },
  alertFn: (message) => alert(message),
  closeSnapRadius: CLOSE_SNAP_RADIUS,
  minShapeDragPixels: MIN_SHAPE_DRAG_PIXELS,
});
const {
  addPolygonPoint,
  addVertexToSelection,
  beginVertexGeometryEdit,
  clearTransientEditState,
  clearVertexSelection,
  cycleAnnotationSelection,
  finalizeSelectionBox,
  findAnnotationAtPoint,
  findVertexAtPoint,
  getAnnotationSequence,
  getSelectionModeFromEvent,
  insertVertexOnNearestEdge,
  isVertexSelected,
  makePolygonPoint,
  normalizeSelectedAnnotation,
  performAddDraftPoint,
  performDeleteSelectedVertices,
  performEndGeometryEdit,
  performFinishEllipse,
  performFinishPolygon,
  performFinishRectangle,
  performInsertVertexOnNearestEdge,
  performSetDraftCurveControl,
  performStartGeometryEdit,
  performUpdateGeometryEdit,
  removeVertexFromSelection,
  selectAnnotation,
  selectSingleVertex,
  startAnnotationDrag,
  startEllipse,
  startRectangle,
  stopActiveAnnotationDrag,
  updateActiveAnnotationDrag,
  updateActiveVertex,
  updateEllipse,
  updateRectangle,
} = annotationWorkflows;
const canvasRenderer = createCanvasRenderer({
  canvas,
  context: ctx,
  imageState,
  annotationState,
  interactionState,
  viewState,
  settingsState,
  uiState,
  coordinates,
  getActiveImageSource,
  getPolygonBaseColor: (index, annotation) => annotationCatalog.getBaseColor("polygon", index, annotation),
  getEllipseBaseColor: (index, annotation) => annotationCatalog.getBaseColor("ellipse", index, annotation),
  isVertexSelected: annotationWorkflows.isVertexSelected,
  createPreviewPolygonPoint: annotationWorkflows.makePolygonPoint,
  createEllipseFromDraft: (draft) =>
    annotationWorkflows.toEllipse(draft.start, draft.end),
  createRectangleFromDraft: (draft) =>
    annotationWorkflows.toRectanglePoints(draft.start, draft.end),
  syncCursor: bootstrap.method("viewController", "syncCanvasCursor"),
  polygonBaseColor: POLYGON_BASE_COLOR,
  ellipseBaseColor: ELLIPSE_BASE_COLOR,
  closeSnapRadius: CLOSE_SNAP_RADIUS,
});
const {
  requestRender: requestCanvasRender,
  requestSelectionRender: requestSelectionCanvasRender,
} = canvasRenderer;
const maskRenderer = createMaskRenderer({ documentRoot: document });

const { render: renderImageMetadata } = createImageMetadataPanel({
  elements: {
    metaImageName,
    metaImageDimensions,
    metaImageSize,
    metaImageType,
    metaImageUpdated,
  },
  imageState,
  renderInvalidation,
});

const annotationTimer = createAnnotationTimer({
  elements: {
    annotationTimerValue,
    annotationTimerStart,
    annotationTimerStop,
    annotationTimerReset,
  },
  imageState,
  annotationState,
  onChange: () => sessionAutosave?.notifyChange(),
});
bootstrap.register("annotationTimer", annotationTimer);
const {
  render: renderAnnotationTimer,
  start: startAnnotationTimer,
  stop: stopAnnotationTimer,
  reset: resetAnnotationTimer,
  getMetadata: getAnnotationTimingMetadata,
} = annotationTimer;

const imageLoadStatusController = createImageLoadStatus({
  elements: {
    imageLoadStatus,
    imageLoadStatusText,
    imageLoadPercent,
    imageLoadProgress,
    imageLoadProgressFill,
  },
  imageState,
  renderInvalidation,
});
const {
  render: renderImageLoadStatus,
  setState: setImageLoadState,
} = imageLoadStatusController;

bootstrap.enter("application-services");

let analyticsController = null;
const appPresenter = createAppPresenter({
  controls: {
    gridToggle,
    snapToggle,
    smartSnapToggle,
    snapBorderToggle,
    snapEdgeToggle,
    snapExtremaToggle,
    snapExtremaModeSelect,
    gridSizeInput,
    gridOpacityInput,
    gridMajorEveryInput,
    snapRadiusInput,
    snapBorderThresholdInput,
    snapEdgeThresholdInput,
    snapExtremaDeltaInput,
    sourceEnhancementSelect,
    imageContrastInput,
    maskContrastInput,
    maskOpacityInput,
    snapPresetSelect,
    imageContrastValue,
    snapEdgeThresholdValue,
    gridOpacityValue,
    maskContrastValue,
    maskOpacityValue,
    zoomValue,
  },
  settingsState,
  viewState,
  interactionState,
  defaultSettings: DEFAULT_SETTINGS,
  normalizeSettings,
  ensureImageAnalysisCaches,
  normalizeSelection: normalizeSelectedAnnotation,
  renderMetadata: renderImageMetadata,
  renderLoadStatus: renderImageLoadStatus,
  renderLabels: bootstrap.method("labelPanelsController", "render"),
  requestCanvasRender,
  requestSelectionCanvasRender,
  onRedraw: () => analyticsController?.refresh(),
});
bootstrap.register("appPresenter", appPresenter);
const {
  applySettings,
  redraw,
  redrawSelection,
  redrawView,
  syncAdjustmentLabels,
  syncControlValues: syncControlValuesFromState,
} = appPresenter;

const modalController = createModalController({
  documentRoot: document,
  elements: {
    shortcutsModal,
    closeShortcutsButton,
    newImageConfirmModal,
    confirmNewImageLoadButton,
  },
});
const {
  isNewImageConfirmOpen: isNewImageConfirmModalOpen,
  openNewImageConfirm: openNewImageConfirmModal,
  closeNewImageConfirm: closeNewImageConfirmModal,
  getPendingImageFile,
  isShortcutsOpen: isShortcutsModalOpen,
  openShortcuts: openShortcutsModal,
  closeShortcuts: closeShortcutsModal,
  handleNewImageTab,
  handleShortcutsTab: handleShortcutsModalTab,
} = modalController;

const floatingDialogs = createFloatingDialogs({
  documentRoot: document,
  entries: [
    {
      dialog: brightnessDialog,
      openButton: openBrightnessBtn,
      closeButton: closeBrightnessBtn,
    },
    {
      dialog: snapDialog,
      openButton: openSnapBtn,
      closeButton: closeSnapBtn,
    },
    {
      dialog: displayDialog,
      openButton: openDisplayBtn,
      closeButton: closeDisplayBtn,
    },
  ],
});

const documentWorkflows = createDocumentWorkflows({
  imageState,
  annotationState,
  interactionState,
  catalog: annotationCatalog,
  getClassCatalog,
  canAssignClass: classWorkflow.canAssignClass,
  canChangeEditorState: canChangeInspection,
  canEditAnnotation: annotationIsEditable,
  redrawEditorState: redrawInspection,
  executeCommand: bootstrap.method("commandRegistry", "execute"),
  fitPolygonInsideImage,
  fitEllipseInsideImage,
  normalizeSelectedAnnotation,
  getAnnotationSequence,
  clearTransientEditState,
  clearVertexSelection,
  selectAnnotation,
  closeLabelEditor: bootstrap.method("canvasLabelEditorController", "close"),
  openLabelEditor: bootstrap.method("canvasLabelEditorController", "open"),
  closeContextMenu: bootstrap.method("canvasContextMenuController", "close"),
  clearLabelColors: annotationCatalog.clearLabelColors,
  resizeCanvasToImage: bootstrap.method("viewController", "resizeCanvasToImage"),
  resetViewTransform: bootstrap.method("viewController", "resetViewTransform"),
  redraw,
  alertFn: (message) => alert(message),
});

const toolActions = createToolActions({
  interactionState,
  polygonTool: TOOL_POLYGON,
  clearVertexSelection,
  setTool: bootstrap.method("toolController", "setTool"),
  syncToolStrip: bootstrap.method("toolController", "syncToolStripUI"),
  redraw,
  onDocumentChange: () => sessionAutosave?.notifyChange(),
});

const qualityReview = createAnnotationQualityReview({
  documentRoot: document,
  getPreview: () => ({
    image: imageState.image, imageSize: imageState.imageSize,
    annotations: annotationState.annotations, loading: imageState.imageLoadStatus === "loading",
  }),
  renderMask: maskRenderer.render,
  getReport: ({ includeOverlaps = false, includeEllipses = true } = {}) =>
    inspectAnnotationQuality(annotationState.annotations, { includeDuplicates: true, includeOverlaps, includeEllipses }),
  getReviewEntries: () => {
    const indices = { polygon: 0, ellipse: 0 };
    return annotationState.annotations.map(annotation => ({
      id: annotation.id, type: annotation.type, typeIndex: indices[annotation.type]++,
      label: annotation.label, status: getReviewStatus(annotation),
    }));
  },
  onSetReviewStatus: (annotationId, reviewStatus) => documentWorkflows.setEditorState({ annotationId, reviewStatus }),
  onShowAnnotation: (annotationId) => {
    const annotation = annotationState.annotations.find(item => item.id === annotationId);
    if (!annotation) return;
    if (!matchesAnnotationFilter(annotation, uiState.annotationClassFilter)) {
      uiState.annotationClassFilter = null;
      classWorkflow.clearChecked();
    }
    if (annotation.editor?.hidden) documentWorkflows.setEditorState({ annotationId, hidden: false });
    selectAnnotation(annotation);
    clearVertexSelection();
    redrawInspection();
  },
});
const classCatalogDialog = createClassCatalogDialog({
  documentRoot: document,
  getCatalog: () => classCatalog,
  getStatus: () => classCatalogError,
  reloadCatalog: reloadClassCatalog,
  applyCatalog: async (value) => {
    // Persist first: a failed write must not change the active mapping.
    if (classCatalogError && classCatalogRecoveryRevision === null) {
      throw new Error(`${classCatalogError} Reload the saved catalog before applying changes.`);
    }
    const next = normalizeClassCatalog(value);
    validateCatalogAnnotations(next, annotationState.annotations);
    try {
      const revision = await classCatalogStore.save(next, classCatalogRecoveryRevision ?? classCatalogRevision);
      classCatalog = next;
      classCatalogRevision = revision;
      classCatalogRecoveryRevision = null;
      classCatalogError = classCatalogObservedRevision > revision ? "The class catalog changed in another tab." : "";
      updateClassCatalogStatus();
      if (canvasLabelEditorController.isOpen()) {
        canvasLabelEditorController.renderSuggestions(canvasLabelEditorInput.value);
      }
      classCatalogChannel?.postMessage({ revision });
      if (classCatalogError) throw new Error(`${classCatalogError} Reload the saved catalog.`);
    } catch (error) {
      if (error.name === "SessionConflictError") {
        classCatalogError = "The class catalog changed in another tab. Reload the saved catalog.";
        classCatalogRecoveryRevision = null;
        updateClassCatalogStatus();
      }
      throw error;
    }
  },
});
classCatalogButton.addEventListener("click", () => classCatalogDialog.open());
document.querySelector("#reviewAnnotations")?.addEventListener("click", () => {
  if (imageState.imageLoadStatus === "loading") {
    alert("Wait for the image to finish loading before reviewing annotations.");
    return;
  }
  qualityReview.open({ report: inspectAnnotationQuality(annotationState.annotations, { includeDuplicates: true }) });
});

const downloadService = createDownloadService({
  documentRoot: document,
  URLType: URL,
  BlobType: Blob,
  alertFn: (message) => alert(message),
  imageState,
  annotationState,
  settingsState,
  canvas,
  maskRenderer,
  stopAnnotationTimer,
  getAnnotationTimingMetadata,
  getAnnotationColorHex: annotationCatalog.getAnnotationColorHex,
  sanitizeAnnotationLabel: annotationCatalog.sanitizeLabel,
  requestQualityReview: (request) => qualityReview.open(request),
  qualityOptions: { includeDuplicates: true },
  getClassCatalog,
});
const { exportJson, exportMask } = downloadService;

bootstrap.enter("command-routing");

const commandRegistry = createCommandRegistry({
  [COMMANDS.TOOL_POLYGON]: () => toolActions.switchTool(TOOL_POLYGON),
  [COMMANDS.TOOL_RECTANGLE]: () => toolActions.switchTool(TOOL_RECTANGLE),
  [COMMANDS.TOOL_ELLIPSE]: () => toolActions.switchTool(TOOL_ELLIPSE),
  [COMMANDS.CURVE_SEGMENT_TOGGLE]: {
    mutates: true,
    history: false,
    execute: toolActions.toggleCurveSegmentMode,
  },
  [COMMANDS.VERTEX_EDIT_TOGGLE]: toolActions.toggleVertexEditMode,
  [COMMANDS.ANNOTATION_RENAME_REQUEST]: () => {
    normalizeSelectedAnnotation();
    const selected = annotationCatalog.getSelectedAnnotation();
    if (selected) {
      documentWorkflows.requestRename(annotationCatalog.getReference(selected));
    }
  },
  [COMMANDS.ANNOTATION_RENAME]: {
    mutates: true,
    execute: documentWorkflows.performRename,
  },
  [COMMANDS.ANNOTATION_ASSIGN_CLASS]: {
    mutates: true,
    execute: documentWorkflows.performAssignClass,
  },
  [COMMANDS.ANNOTATION_SET_EDITOR_STATE]: {
    mutates: true,
    execute: documentWorkflows.performSetEditorState,
  },
  [COMMANDS.ANNOTATION_RENAME_CREATED]: {
    mutates: true,
    history: false,
    execute: documentWorkflows.performRenameCreated,
  },
  [COMMANDS.ANNOTATION_SET_COLOR]: {
    mutates: true,
    execute: documentWorkflows.performSetSelectedColor,
  },
  [COMMANDS.ANNOTATION_DUPLICATE]: {
    mutates: true,
    execute: documentWorkflows.performDuplicateSelected,
  },
  [COMMANDS.ANNOTATION_DELETE]: {
    mutates: true,
    execute: documentWorkflows.performDeleteSelected,
  },
  [COMMANDS.ANNOTATION_CREATE_ELLIPSE]: { mutates: true, execute: performFinishEllipse },
  [COMMANDS.ANNOTATION_CREATE_RECTANGLE]: { mutates: true, execute: performFinishRectangle },
  [COMMANDS.ANNOTATION_CREATE_POLYGON]: { mutates: true, execute: performFinishPolygon },
  [COMMANDS.ANNOTATION_CANCEL_CREATED]: {
    mutates: true,
    history: false,
    execute: (payload) => {
      const cancelled = documentWorkflows.performCancelCreated(payload);
      if (cancelled) history.discardLatest();
      return cancelled;
    },
  },
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
  [COMMANDS.DOCUMENT_REPLACE]: {
    mutates: true,
    execute: documentWorkflows.performLoadAnnotationData,
  },
  [COMMANDS.IMAGE_REPLACE]: {
    mutates: true,
    execute: () => {
      // Capture the old document before replacement clears annotations.
      sessionAutosave?.flush();
      return bootstrap.resolve("imageLoaderController").replacePending();
    },
  },
  [COMMANDS.CANCEL_DRAWING]: {
    mutates: true,
    history: false,
    execute: () =>
      bootstrap.resolve("toolController").cancelActiveShapePlacement({
        deactivateTool: false,
      }),
  },
  [COMMANDS.CLEAR_ALL]: {
    mutates: true,
    execute: documentWorkflows.performClearAll,
  },
  [COMMANDS.UNDO]: () => history.undo(),
  [COMMANDS.REDO]: () => history.redo(),
  [COMMANDS.ZOOM_IN]: () =>
    bootstrap.resolve("viewController").setViewZoom(viewState.viewZoom * 1.25),
  [COMMANDS.ZOOM_OUT]: () =>
    bootstrap.resolve("viewController").setViewZoom(viewState.viewZoom / 1.25),
  [COMMANDS.ZOOM_RESET]: () => bootstrap.resolve("viewController").setViewZoom(1),
  [COMMANDS.EXPORT_JSON]: exportJson,
  [COMMANDS.EXPORT_MASK]: exportMask,
  [COMMANDS.EXPORT_INVERTED_MASK]: () => exportMask({ inverted: true }),
}, { history, onMutation: () => sessionAutosave?.notifyChange() });
bootstrap.register("commandRegistry", commandRegistry);

bootstrap.enter("interactive-controllers");

const canvasContextMenuController = createCanvasContextMenu({
  documentRoot: document,
  elements: { canvasContextMenu, canvasWrap },
  imageState,
  annotationState,
  interactionState,
  history,
  tools: { polygon: TOOL_POLYGON },
  normalizeSelectedAnnotation,
  getSelectedAnnotation: annotationCatalog.getSelectedAnnotation,
  commandRegistry,
});
bootstrap.register("canvasContextMenuController", canvasContextMenuController);
const {
  close: closeCanvasContextMenu,
  contains: canvasContextMenuContains,
  isOpen: isCanvasContextMenuOpen,
  open: openCanvasContextMenu,
} = canvasContextMenuController;

const labelPanelsController = createLabelPanels({
  documentRoot: document,
  elements: {
    labelListUnique,
    labelListCount,
    polygonLabelList,
    selectedShapeColorInput,
  },
  annotationState,
  interactionState,
  renderInvalidation,
  normalizeLabels: annotationCatalog.normalizeLabels,
  normalizeSelectedAnnotation,
  getSelectedAnnotation: annotationCatalog.getSelectedAnnotation,
  getAnnotationReference: annotationCatalog.getReference,
  getAnnotationSequence,
  getColorForLabel: annotationCatalog.getColorForLabel,
  getAnnotationColor: annotationCatalog.getAnnotationColor,
  getAnnotationColorHex: annotationCatalog.getAnnotationColorHex,
  getAnnotationLabel: annotationCatalog.getLabel,
  isAnnotationSelected: annotationCatalog.isSelected,
  isLabelEditorOpen: bootstrap.method("canvasLabelEditorController", "isOpen"),
  closeLabelEditor: bootstrap.method("canvasLabelEditorController", "close"),
  selectAnnotation,
  clearVertexSelection,
  redraw: redrawSelection,
  renameAnnotationLabel: documentWorkflows.requestRename,
  getClassWorkflow: () => {
    const view = classWorkflow.getView();
    if (view.canAssignTargets) {
      const targets = new Set(classWorkflow.getTargetIds());
      if (annotationState.annotations.some(annotation => targets.has(annotation.id) && !annotationIsEditable(annotation))) {
        const message = "Show and unlock the target shapes before assigning a class.";
        return { ...view, canAssign: false, canAssignTargets: false, message, assignmentMessage: message };
      }
    }
    return view;
  },
  getInspection: () => {
    const selected = annotationCatalog.getSelectedAnnotation();
    const canChange = canChangeInspection();
    return { filter: uiState.annotationClassFilter, selected, canChange,
      canEditSelected: Boolean(selected && annotationIsEditable(selected)),
      message: !canChange ? "Finish image loading, naming, or dragging before changing review controls."
        : selected?.editor?.locked ? "This shape is locked. Unlock it before editing."
          : selected?.editor?.hidden ? "This shape is hidden from the canvas and remains included in exports." : "",
    };
  },
  onFilterClass: label => {
    if (canChangeInspection()) {
      uiState.annotationClassFilter = label;
      classWorkflow.clearChecked();
      clearVertexSelection();
      interactionState.activeVertex = null;
      const selected = annotationCatalog.getSelectedAnnotation();
      if (selected && !matchesAnnotationFilter(selected, label)) selectAnnotation(null);
      redrawInspection();
    } else labelPanelsController.refreshInspectionControls();
  },
  onSetEditorState: request => documentWorkflows.setEditorState(request),
  onClearSelection: () => {
    if (!canChangeInspection()) return;
    selectAnnotation(null);
    interactionState.activeVertex = null;
    clearVertexSelection();
    redrawSelection();
  },
  onChooseClass: (id) => {
    classWorkflow.chooseClass(id);
    labelPanelsController.refreshClassControls();
  },
  onToggleChecked: (id, checked) => {
    classWorkflow.toggleChecked(id, checked);
    labelPanelsController.refreshClassControls();
  },
  onClearChecked: () => {
    classWorkflow.clearChecked();
    labelPanelsController.refreshClassControls();
  },
  onAssignClass: ({ classId, annotationIds }) => {
    const view = classWorkflow.getView();
    const entry = view.enabled && view.classes.find(value => value.id === classId);
    if (entry) documentWorkflows.assignClass({
      annotationIds, classId: entry.id, className: entry.name,
    });
    labelPanelsController.refreshClassControls();
    labelPanelsController.refreshInspectionControls();
  },
});
bootstrap.register("labelPanelsController", labelPanelsController);
const { render: renderLabelPanels } = labelPanelsController;
refreshClassWorkflow = renderLabelPanels;

const canvasLabelEditorController = createCanvasLabelEditor({
  documentRoot: document,
  elements: {
    canvas,
    canvasWrap,
    canvasLabelEditor,
    canvasLabelEditorTitle,
    canvasLabelEditorInput,
    canvasLabelEditorSuggestions,
    canvasLabelEditorOk,
    canvasLabelEditorCancel,
  },
  imageState,
  annotationState,
  uiState,
  commandRegistry,
  sanitizeLabel: annotationCatalog.sanitizeLabel,
  getKnownLabels: annotationCatalog.getKnownLabels,
  getAnnotationLabel: annotationCatalog.getLabel,
  getAnnotationAnchorPoint: annotationCatalog.getAnchorPoint,
  getRememberedLabel: annotationCatalog.getRememberedLabel,
  normalizeLabels: annotationCatalog.normalizeLabels,
  closeContextMenu: closeCanvasContextMenu,
  scalePoint,
  redraw,
  renderLabelPanels,
});
bootstrap.register("canvasLabelEditorController", canvasLabelEditorController);
const {
  close: closeCanvasLabelEditor,
  isOpen: isCanvasLabelEditorOpen,
  position: positionCanvasLabelEditor,
} = canvasLabelEditorController;

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
  redraw: redrawView,
  syncAdjustmentLabels,
});
bootstrap.register("viewController", viewController);
const {
  resetViewTransform,
  resizeCanvasToImage,
  syncCanvasCursor,
} = viewController;

const imageLoaderController = createImageLoader({
  elements: { imageInput, emptyState },
  imageState,
  annotationState,
  interactionState,
  labelColorAssignments: annotationCatalog.colorAssignments,
  imageProcessing,
  imageCache,
  commandRegistry,
  replaceCommand: COMMANDS.IMAGE_REPLACE,
  modal: {
    openConfirm: openNewImageConfirmModal,
    closeConfirm: closeNewImageConfirmModal,
    getPendingFile: getPendingImageFile,
  },
  ui: {
    closeLabelEditor: closeCanvasLabelEditor,
    closeContextMenu: closeCanvasContextMenu,
  },
  selection: {
    selectAnnotation,
    clearVertexSelection,
  },
  render: {
    metadata: renderImageMetadata,
    onImageReady: (file) => {
      history.clear();
      sessionImage = {
        source: imageState.image,
        metadata: {
          id: crypto.randomUUID(), blob: file, fileName: file.name,
          fileType: file.type, lastModified: file.lastModified,
          width: imageState.image.width, height: imageState.image.height,
        },
      };
      if (recoveringImage) recoveringImage.resolve();
      else sessionAutosave?.notifyChange();
    },
    onImageError: (message) => {
      if (recoveringImage) recoveringImage.reject(new Error(message));
      else sessionAutosave?.flush();
    },
    setLoadState: (...args) => {
      setImageLoadState(...args);
      labelPanelsController.refreshClassControls();
      labelPanelsController.refreshInspectionControls();
    },
    timer: renderAnnotationTimer,
    resetTimer: resetAnnotationTimer,
    redraw,
  },
  view: {
    resizeCanvasToImage,
    resetViewTransform,
  },
  FileReaderType: window.FileReader,
  ImageType: window.Image,
  alertFn: (message) => { if (!recoveringImage) alert(message); },
});
bootstrap.register("imageLoaderController", imageLoaderController);
const {
  cancelPending: cancelPendingImageLoad,
  confirmPending: confirmPendingImageLoad,
} = imageLoaderController;
function loadImage(file) {
  if (projectController?.active) {
    void projectController.addFiles([file]).finally(() => { imageInput.value = ""; });
    return true;
  }
  sessionAutosave?.flush();
  return imageLoaderController.load(file);
}

const embeddedImageImporter = createEmbeddedImageImporter({
  imageState, annotationState, interactionState, imageProcessing, getClassCatalog,
  loadAnnotationData: documentWorkflows.loadAnnotationData,
  commitEmbeddedImage: ({ imported, file, ...preparedImage }) => {
    // Preparation has already validated the complete document. Install it in
    // one synchronous step so recovery never captures mismatched pixels/shapes.
    sessionAutosave?.flush();
    imageLoaderController.cancelPending();
    resetAnnotationTimer();
    imageCache.install(preparedImage);
    Object.assign(imageState, {
      revision: (imageState.revision || 0) + 1,
      imageName: imported.imageName,
      imageSize: imported.imageSize,
      imageFileSizeBytes: file.size,
      imageFileType: file.type,
      imageLastModified: file.lastModified,
    });
    sessionImage = {
      source: imageState.image,
      metadata: {
        id: crypto.randomUUID(), blob: file, fileName: file.name,
        fileType: file.type, lastModified: file.lastModified,
        width: imageState.image.width, height: imageState.image.height,
      },
    };
    if (emptyState) emptyState.style.display = "none";
    setImageLoadState("success", 100, "Image ready.");
    const result = documentWorkflows.loadAnnotationData(null, { preparedDocument: imported });
    // As with a PNG upload, old-image undo entries cannot cross this boundary.
    history.clear();
    renderImageMetadata();
    renderAnnotationTimer();
    sessionAutosave?.notifyChange();
    return result;
  },
});

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
  onDocumentChange: () => sessionAutosave?.notifyChange(),
});
bootstrap.register("toolController", toolController);
const { cancelActiveShapePlacement } = toolController;

const pointerController = createPointerController({
  canvas,
  canvasWrap,
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
  contextMenuContains: canvasContextMenuContains,
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
  canDragAnnotation: reference => annotationIsEditable(annotationCatalog.getAt(reference.type, reference.index)),
  updateEllipse,
  updateActiveAnnotationDrag,
  updateActiveVertex,
  stopActiveAnnotationDrag,
  finalizeSelectionBox,
});

const keyboardController = createKeyboardController({
  target: document,
  isEnabled: () => uiState.activePage === "annotation" && !qualityReview.isOpen() && !classCatalogDialog.isOpen()
    && !projectController?.busy && !document.getElementById("projectExportDialog")?.open
    && !document.getElementById("projectCleanupDialog")?.open
    && !document.activeElement?.closest(".app-page-nav"),
  interactionState,
  commandRegistry,
  isEditableTarget,
  isNewImageConfirmModalOpen,
  cancelPendingImageLoad,
  handleNewImageModalTab: handleNewImageTab,
  isShortcutsModalOpen,
  openShortcutsModal,
  closeShortcutsModal,
  handleShortcutsModalTab,
  isCanvasLabelEditorOpen,
  closeCanvasLabelEditor,
  isCanvasContextMenuOpen,
  closeCanvasContextMenu,
  cancelActiveShapePlacement,
  closeFloatingDialogs: floatingDialogs.closeAll,
  cycleAnnotationSelection,
  polygonTool: TOOL_POLYGON,
});

bootstrap.enter("event-binding");

viewController.bind();
toolController.bind();
pointerController.bind();
keyboardController.bind();
bindCommandElements(document, commandRegistry);

// ── Tool strip buttons ──
// ── Floating dialog toggles ──
// ── Draggable floating dialogs ──
floatingDialogs.bind();

// ── Fit Window (toggle) ──

canvasLabelEditorController.bind();
canvasContextMenuController.bind();
labelPanelsController.bind();

const featureController = createFeatureController({
  elements: {
    imageInput,
    jsonInput,
    annotationTimerStart,
    annotationTimerStop,
    annotationTimerReset,
    gridToggle,
    snapToggle,
    smartSnapToggle,
    snapBorderToggle,
    snapEdgeToggle,
    snapExtremaToggle,
    snapExtremaModeSelect,
    gridSizeInput,
    gridMajorEveryInput,
    snapRadiusInput,
    snapBorderThresholdInput,
    snapExtremaDeltaInput,
    snapPresetSelect,
    applyPresetButton,
    resetSettingsButton,
    imageContrastInput,
    gridOpacityInput,
    snapEdgeThresholdInput,
    maskContrastInput,
    maskOpacityInput,
    outputFormatSelect,
    sourceEnhancementSelect,
    openShortcutsButton,
    closeShortcutsButton,
    shortcutsModal,
    confirmNewImageLoadButton,
    cancelNewImageLoadButton,
    cancelNewImageLoadTopButton,
    newImageConfirmModal,
    renameSelectedPolygonButton,
    selectedShapeColorInput,
  },
  windowRoot: window,
  FileReaderType: window.FileReader,
  alertFn: (message) => alert(message),
  settingsState,
  actions: {
    loadImage,
    getImportGeneration: () => projectImportGeneration,
    loadAnnotationData: (data) => {
      if (projectController?.busy) throw new Error("Wait for the batch operation to finish before importing annotations.");
      if (projectController?.active && !projectController.project.activeId && data?.image_base64 == null) {
        throw new Error("Choose an image from the drawer before importing annotation-only JSON.");
      }
      const currentBase64 = imageState.image?.src?.split(",")[1];
      if (projectController?.active && data?.image_base64 != null && data.image_base64 !== currentBase64) {
        return projectController.addFiles([new File([JSON.stringify(data)], "annotations.json", { type: "application/json" })]);
      }
      return embeddedImageImporter.load(data);
    },
    cancelAnnotationImport: embeddedImageImporter.cancelPending,
    startAnnotationTimer,
    stopAnnotationTimer,
    resetAnnotationTimer,
    applySettings,
    syncAdjustmentLabels,
    redraw: redrawView,
    resizeCanvasToImage,
    closeCanvasContextMenu,
    isCanvasLabelEditorOpen,
    positionCanvasLabelEditor,
    getActiveLabelAnchor: () => uiState.activeLabelEdit?.anchorImagePoint || null,
    endPointerInteraction: () => pointerController.handlePointerEnd(),
    openShortcutsModal,
    closeShortcutsModal,
    confirmPendingImageLoad,
    cancelPendingImageLoad,
    normalizeSelectedAnnotation,
    getSelectedAnnotation: annotationCatalog.getSelectedAnnotation,
    renameAnnotationLabel: documentWorkflows.requestRename,
    getAnnotationReference: annotationCatalog.getReference,
    setSelectedAnnotationColor: documentWorkflows.setSelectedColor,
  },
});
featureController.bind();

const annotationPage = document.getElementById("annotationPage");
const annotationToolbar = document.querySelector("header.toolbar");
const analyticsPage = document.getElementById("analyticsPage");
const annotationTab = document.getElementById("annotationTab");
const analyticsTab = document.getElementById("analyticsTab");
analyticsController = createAnalyticsController({
  root: analyticsPage,
  imageState,
  annotationState,
  maskRenderer,
  onCalibrationChange: (value) => {
    history.transaction(() => {
      imageState.calibration = normalizeCalibration(value, imageState.imageSize);
    });
    sessionAutosave?.notifyChange();
  },
});

function showPage(page) {
  const isAnalytics = page === "analytics";
  pointerController.handlePointerEnd();
  closeCanvasLabelEditor();
  closeCanvasContextMenu();
  floatingDialogs.closeAll();
  uiState.activePage = page;
  document.body.dataset.page = page;
  annotationPage.hidden = isAnalytics;
  annotationToolbar.hidden = isAnalytics;
  analyticsPage.hidden = !isAnalytics;
  annotationTab.setAttribute("aria-selected", String(!isAnalytics));
  analyticsTab.setAttribute("aria-selected", String(isAnalytics));
  annotationTab.tabIndex = isAnalytics ? -1 : 0;
  analyticsTab.tabIndex = isAnalytics ? 0 : -1;
  if (isAnalytics) analyticsController.activate();
  else {
    analyticsController.deactivate();
    resizeCanvasToImage();
    redraw();
  }
}
annotationTab.addEventListener("click", () => showPage("annotation"));
analyticsTab.addEventListener("click", () => showPage("analytics"));
for (const tab of [annotationTab, analyticsTab]) {
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? annotationTab : event.key === "End" ? analyticsTab
      : tab === annotationTab ? analyticsTab : annotationTab;
    next.focus();
    next.click();
  });
}

bootstrap.enter("initial-render");

syncControlValuesFromState();

syncAdjustmentLabels();
renderAnnotationTimer();
redraw();
bootstrap.complete([
  "annotationTimer",
  "appPresenter",
  "commandRegistry",
  "canvasContextMenuController",
  "labelPanelsController",
  "canvasLabelEditorController",
  "viewController",
  "imageLoaderController",
  "toolController",
]);

const autosaveStatus = document.getElementById("autosaveStatus");
const autosaveRetry = document.getElementById("autosaveRetry");
const sessionState = {
  imageState, annotationState, interactionState,
  labelColorAssignments: annotationCatalog.colorAssignments,
};

async function restoreSession(value) {
  if (value?.schemaVersion !== 1 || !Number.isFinite(value.savedAt)) {
    throw new Error("The saved session format is unsupported.");
  }
  const image = value.image;
  if (image !== null && (!image || !(image.blob instanceof Blob) || image.blob.size === 0
    || typeof image.id !== "string" || !image.id
    || typeof image.fileName !== "string" || typeof image.fileType !== "string"
    || !Number.isFinite(image.lastModified)
    || !Number.isSafeInteger(image.width) || image.width <= 0
    || !Number.isSafeInteger(image.height) || image.height <= 0)) {
    throw new Error("The saved image metadata is invalid.");
  }
  const snapshot = validateSessionSnapshot(value.snapshot, image || undefined);
  if (image) {
    // Verify the original bytes and dimensions before installing any document data.
    const url = URL.createObjectURL(image.blob);
    try {
      const decoded = new Image();
      decoded.src = url;
      await decoded.decode();
      if (decoded.naturalWidth !== image.width || decoded.naturalHeight !== image.height) {
        throw new Error("The saved image does not match the document dimensions.");
      }
    } finally {
      URL.revokeObjectURL(url);
    }
    try {
      await new Promise((resolve, reject) => {
        recoveringImage = { resolve, reject };
        imageLoaderController.start(new File([image.blob], image.fileName, {
          type: image.fileType, lastModified: image.lastModified,
        }));
      });
      sessionImage.metadata = { ...image };
    } finally {
      recoveringImage = null;
    }
  }
  applySessionSnapshot(snapshot, sessionState);
  resizeCanvasToImage();
  resetViewTransform();
  history.clear();
  renderInvalidation.invalidateAll();
  toolController.syncToolStripUI();
  renderAnnotationTimer();
  redraw();
}

sessionAutosave = createSessionAutosave({
  store: createSessionStore(),
  canSave: () => imageState.imageLoadStatus !== "loading"
    && !(interactionState.isDrawing && (interactionState.activeVertex || interactionState.activeAnnotationDrag)),
  capture: () => {
    if (!imageState.image && !imageState.imageSize && !imageState.imageName
      && annotationState.annotations.length === 0) return null;
    if (imageState.image && sessionImage?.source !== imageState.image) {
      throw new Error("The current image is not ready for autosave.");
    }
    return {
      image: imageState.image ? sessionImage.metadata : null,
      snapshot: captureSessionSnapshot(sessionState),
    };
  },
  restore: restoreSession,
  onStatus: ({ state, message, canRetry }) => {
    autosaveStatus.dataset.state = state;
    autosaveStatus.textContent = message;
    autosaveRetry.hidden = !canRetry;
  },
});
const legacySessionAutosave = sessionAutosave;
let projectDrawer = null;
let projectView = null;

function projectNavigationGuard() {
  if (imageState.imageLoadStatus === "loading") return "Wait for the image to finish loading before switching images.";
  if (uiState.activeLabelEdit || qualityReview.isOpen() || classCatalogDialog.isOpen()) return "Finish or close the current dialog before switching images.";
  if (interactionState.isDrawing || interactionState.isPanning || interactionState.activeVertex
    || interactionState.activeAnnotationDrag || interactionState.rectangleDraft || interactionState.ellipseDraft) {
    return "Finish or cancel the current drawing or drag before switching images.";
  }
  return "";
}

projectController = createProjectController({
  store: createProjectStore(), legacyAutosave: legacySessionAutosave,
  canLeave: projectNavigationGuard,
  canSave: () => imageState.imageLoadStatus === "loading"
    || (interactionState.isDrawing && (interactionState.activeVertex || interactionState.activeAnnotationDrag)),
  canComplete: () => projectNavigationGuard() || (interactionState.currentPolygon.length
    ? "Finish or cancel the polygon draft before marking this image complete." : ""),
  summarizeDocument: () => ({ name: imageState.imageName,
    annotationCount: annotationState.annotations.length,
    hasDraft: interactionState.currentPolygon.length > 0 }),
  capture: () => {
    if (!imageState.image) return null;
    if (sessionImage?.source !== imageState.image) throw new Error("The image is not ready to save.");
    return { session: { schemaVersion: 1, savedAt: Date.now(), image: sessionImage.metadata,
      snapshot: captureSessionSnapshot(sessionState) },
      displaySize: { width: canvas.width, height: canvas.height },
      ...(!projectController?.active ? { thumbnailUrl: projectThumbnail(imageState.image) } : {}) };
  },
  prepareFile: file => prepareProjectFile(file, { getClassCatalog }),
  prepareDocument: entry => prepareProjectDocument(entry, imageProcessing),
  clearDocument: () => {
    embeddedImageImporter.cancelPending();
    imageLoaderController.cancelPending();
    closeCanvasLabelEditor();
    closeCanvasContextMenu();
    floatingDialogs.closeAll();
    resetAnnotationTimer();
    const empty = createAppState(DEFAULT_SETTINGS);
    Object.assign(imageState, empty.image, { revision: (imageState.revision || 0) + 1 });
    Object.assign(annotationState, empty.annotations);
    Object.assign(interactionState, empty.interaction);
    annotationCatalog.colorAssignments.clear();
    sessionImage = null;
    uiState.annotationClassFilter = null;
    history.clear();
    emptyState.textContent = projectController.project.items.length
      ? "Choose an image from the Images drawer."
      : "Add images from the Images drawer or open a PNG to get started.";
    emptyState.style.display = "";
    setImageLoadState("idle", 0, "");
    resetViewTransform();
    renderInvalidation.invalidateAll();
    toolController.syncToolStripUI();
    renderImageMetadata();
    renderAnnotationTimer();
    redraw();
  },
  commitDocument: (prepared, entry) => {
    embeddedImageImporter.cancelPending();
    imageLoaderController.cancelPending();
    closeCanvasLabelEditor();
    closeCanvasContextMenu();
    resetAnnotationTimer();
    imageCache.install(prepared);
    const metadata = entry.session.image;
    Object.assign(imageState, { revision: (imageState.revision || 0) + 1,
      imageFileSizeBytes: metadata.blob.size, imageFileType: metadata.fileType || "image/png",
      imageLastModified: metadata.lastModified });
    sessionImage = { source: imageState.image, metadata };
    applySessionSnapshot(prepared.snapshot, sessionState);
    history.clear();
    uiState.annotationClassFilter = null;
    emptyState.style.display = "none";
    setImageLoadState("success", 100, "Image ready.");
    resizeCanvasToImage();
    resetViewTransform();
    renderInvalidation.invalidateAll();
    toolController.syncToolStripUI();
    renderImageMetadata();
    renderAnnotationTimer();
    redraw();
  },
  onBusy: value => {
    if (value) { projectImportGeneration += 1; embeddedImageImporter.cancelPending(); }
    for (const element of [canvasWrap, document.querySelector(".tool-strip"),
      document.querySelector(".tips-panel"), annotationToolbar, document.querySelector(".app-page-nav")]) {
      if (element) element.inert = value;
    }
  },
  onState: value => {
    projectView = value;
    projectDrawer?.render({ ...value, outputFormat: settingsState.outputFormat });
    if (value.project) {
      const state = value.error ? "unavailable" : value.saving ? "saving" : value.dirty ? "dirty" : "saved";
      const message = value.error ? `${value.message} ${value.error}`
        : value.saving ? "Saving…" : value.dirty ? "Unsaved" : "Saved";
      if (autosaveStatus.dataset.state !== state) autosaveStatus.dataset.state = state;
      if (autosaveStatus.textContent !== message) autosaveStatus.textContent = message;
      autosaveRetry.hidden = !value.canRetry;
    }
  },
  exportDocuments: async options => {
    const exportOptions = { ...options, colorPalette: LABEL_COLOR_PALETTE, maskRenderer,
      project: { ...options.project, classCatalog: options.includeJson && options.format === "coco" ? getClassCatalog() : null },
      documents: options.documents.map(entry => ({ ...entry,
        status: options.project.items.find(item => item.id === entry.id)?.status })) };
    const inspection = inspectProjectExport(exportOptions);
    if (inspection.warningCount || inspection.omittedEllipseCount || inspection.incompleteQualityCheckCount) {
      const details = [inspection.warningCount ? `${inspection.warningCount} annotation quality warning(s).` : "",
        inspection.incompleteQualityCheckCount ? "Some overlap checks could not be completed." : "",
        inspection.omittedEllipseCount ? `COCO JSON omits ${inspection.omittedEllipseCount} ellipse(s); masks include all shapes.` : ""];
      if (!confirm(`${details.filter(Boolean).join("\n")}\n\nExport this batch anyway?`)) return;
    }
    const { blob } = await buildProjectExport(exportOptions);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${options.project.name.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 80) || "image-batch"}.zip`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
});
projectDrawer = createProjectDrawer({
  onToggle: value => projectController.toggle(value), onSelect: id => projectController.select(id),
  onAddFiles: files => projectController.addFiles(files),
  onComplete: (id, complete) => projectController.complete(id, complete),
  onExport: options => projectController.exportBatch(options), onRename: name => projectController.rename(name),
  onRetry: () => projectController.retry(),
  onClose: () => projectController.closeCurrent(),
  onRemove: id => projectController.remove(id),
  onClear: () => projectController.clearBatch(),
});
projectDrawer.render({ expanded: false });
outputFormatSelect.addEventListener("change", () => {
  if (projectView) projectDrawer.render({ ...projectView, outputFormat: settingsState.outputFormat });
});
sessionAutosave = projectController;
autosaveRetry.addEventListener("click", () => sessionAutosave.retry());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") sessionAutosave.flush();
});
window.addEventListener("pagehide", () => sessionAutosave.flush());
window.addEventListener("beforeunload", (event) => {
  sessionAutosave.flush();
  if (sessionAutosave.hasUnsavedChanges) {
    event.preventDefault();
    event.returnValue = "";
  }
});
// Checkpoint a running timer without making ordinary canvas redraws do storage work.
window.setInterval(() => {
  if (annotationState.annotationTimerRunning) sessionAutosave.notifyChange();
}, 15000);
document.body.inert = true;
try {
  await Promise.all([
    legacySessionAutosave.initialize(),
    reloadClassCatalog().catch(() => {}),
  ]);
  await projectController.initialize();
} finally {
  document.body.inert = false;
  document.documentElement.dataset.appReady = "true";
}
