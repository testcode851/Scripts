import { DEFAULT_SETTINGS, normalizeSettings } from "./config/settings.js";
import { createAppState } from "./state/create-app-state.js";
import { createAppHistory } from "./state/app-history.js";
import { createCoordinateService } from "./geometry/coordinate-service.js";
import { createSnapService } from "./geometry/snap-service.js";
import { bindCommandElements, createCommandRegistry } from "./commands/command-registry.js";
import { COMMANDS } from "./commands/command-names.js";
import { createDownloadService } from "./io/download-service.js";
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

const bootstrap = createBootstrapAssembly([
  "core-services",
  "application-services",
  "command-routing",
  "interactive-controllers",
  "event-binding",
  "initial-render",
]);
bootstrap.enter("core-services");

const history = createAppHistory({
  annotationState,
  interactionState,
  maxEntries: 50,
  onRestore: bootstrap.method("appPresenter", "redraw"),
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
  coordinates,
  applySnap,
  executeCommand: bootstrap.method("commandRegistry", "execute"),
  redraw: bootstrap.method("appPresenter", "redraw"),
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
  getPolygonBaseColor: (index) => annotationCatalog.getBaseColor("polygon", index),
  getEllipseBaseColor: (index) => annotationCatalog.getBaseColor("ellipse", index),
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
const { requestRender: requestCanvasRender } = canvasRenderer;
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
});
bootstrap.register("appPresenter", appPresenter);
const {
  applySettings,
  redraw,
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
  [COMMANDS.ANNOTATION_RENAME_CREATED]: {
    mutates: true,
    history: false,
    execute: documentWorkflows.performRename,
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
    execute: bootstrap.method("imageLoaderController", "replacePending"),
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
}, { history });
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
  redraw,
  renameAnnotationLabel: documentWorkflows.requestRename,
});
bootstrap.register("labelPanelsController", labelPanelsController);
const { render: renderLabelPanels } = labelPanelsController;

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
  redraw,
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
    setLoadState: setImageLoadState,
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
  alertFn: (message) => alert(message),
});
bootstrap.register("imageLoaderController", imageLoaderController);
const {
  cancelPending: cancelPendingImageLoad,
  confirmPending: confirmPendingImageLoad,
  load: loadImage,
} = imageLoaderController;

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
bootstrap.register("toolController", toolController);
const { cancelActiveShapePlacement } = toolController;

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
    loadAnnotationData: documentWorkflows.loadAnnotationData,
    startAnnotationTimer,
    stopAnnotationTimer,
    resetAnnotationTimer,
    applySettings,
    syncAdjustmentLabels,
    redraw,
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
document.documentElement.dataset.appReady = "true";
