import { createInteractionReset } from "../state/interaction-reset.js";
import { createAnnotationCreation } from "./annotation-creation.js";
import { createAnnotationGeometryEdit } from "./annotation-geometry-edit.js";
import { createAnnotationSelection } from "./annotation-selection.js";

/** Own annotation creation, selection, dragging, and vertex-edit workflows. */
export function createAnnotationWorkflows({
  annotationState,
  interactionState,
  coordinates,
  applySnap,
  executeCommand,
  redraw,
  redrawSelection = redraw,
  startTimer,
  openLabelEditor,
  syncToolStrip,
  getDefaultShapeColor,
  labels,
  getActiveClass = () => null,
  isClassAvailable = () => true,
  isAnnotationVisible = annotation => !annotation.editor?.hidden,
  isAnnotationEditable = annotation => !annotation.editor?.hidden && !annotation.editor?.locked,
  matchesSelectionFilter = () => true,
  alertFn = globalThis.alert,
  closeSnapRadius = 10,
  minShapeDragPixels = 1,
}) {
  const interactionReset = createInteractionReset(interactionState);
  const annotationSelection = createAnnotationSelection({
    annotationState,
    interactionState,
    coordinates,
    redraw: redrawSelection,
    isAnnotationVisible,
    isAnnotationEditable,
    matchesSelectionFilter,
  });
  const {
    addVertexToSelection,
    clearVertexSelection,
    cycleAnnotationSelection,
    finalizeSelectionBox,
    findAnnotationAtPoint,
    findEdgeAtPoint,
    findVertexAtPoint,
    getAnnotationSequence,
    getSelectionModeFromEvent,
    isVertexSelected,
    normalizeSelectedAnnotation,
    removeVertexFromSelection,
    selectAnnotation,
    selectSingleVertex,
  } = annotationSelection;

  function clearTransientEditState() {
    interactionReset.clearTransientEditState();
  }

  function clearSelectionForShapeCreation() {
    selectAnnotation(null);
    clearTransientEditState();
  }

  const {
    addPolygonPoint,
    makePolygonPoint,
    performAddDraftPoint,
    performFinishEllipse,
    performFinishPolygon,
    performFinishRectangle,
    performSetDraftCurveControl,
    startEllipse,
    startRectangle,
    toEllipse,
    toRectanglePoints,
    updateEllipse,
    updateRectangle,
  } = createAnnotationCreation({
    annotationState,
    interactionState,
    coordinates,
    applySnap,
    executeCommand,
    redraw,
    startTimer,
    openLabelEditor,
    syncToolStrip,
    clearSelectionForShapeCreation,
    selectAnnotation,
    getDefaultShapeColor,
    labels,
    getActiveClass,
    isClassAvailable,
    alertFn,
    closeSnapRadius,
    minShapeDragPixels,
  });

  const {
    beginVertexGeometryEdit,
    insertVertexOnNearestEdge,
    performDeleteSelectedVertices,
    performEndGeometryEdit,
    performInsertVertexOnNearestEdge,
    performStartGeometryEdit,
    performUpdateGeometryEdit,
    startAnnotationDrag,
    stopActiveAnnotationDrag,
    updateActiveAnnotationDrag,
    updateActiveVertex,
  } = createAnnotationGeometryEdit({
    annotationState,
    interactionState,
    coordinates,
    selection: annotationSelection,
    canEditAnnotation: isAnnotationEditable,
    applySnap,
    executeCommand,
    redraw,
    alertFn,
  });

  return Object.freeze({
    addPolygonPoint,
    addVertexToSelection,
    beginVertexGeometryEdit,
    clearSelectionForShapeCreation,
    clearTransientEditState,
    clearVertexSelection,
    cycleAnnotationSelection,
    finalizeSelectionBox,
    findAnnotationAtPoint,
    findEdgeAtPoint,
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
    toEllipse,
    toRectanglePoints,
    updateActiveAnnotationDrag,
    updateActiveVertex,
    updateEllipse,
    updateRectangle,
  });
}
