import { COMMANDS } from "../commands/command-names.js";
import { clonePolygonPoint } from "../geometry/polygon.js";
import { rememberAnnotationLabel } from "../model/annotation-labels.js";
import {
  createEllipseAnnotation,
  createPolygonAnnotation,
  getAnnotationTypeIndex,
} from "../model/annotation.js";

/**
 * Owns polygon, rectangle, and ellipse creation while keeping command routing
 * and the annotation-workflow facade stable.
 */
export function createAnnotationCreation({
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
  getActiveClass = () => null,
  isClassAvailable = () => true,
  alertFn = globalThis.alert,
  closeSnapRadius = 10,
  minShapeDragPixels = 1,
}) {
  const { clampPointToImage, scalePoint } = coordinates;

  function captureClassChoice() {
    const choice = getActiveClass();
    return choice ? { id: choice.id, name: choice.name } : null;
  }

  const availableClass = (choice) => choice && isClassAvailable(choice) ? choice : null;

  const toEllipse = (start, end) => ({
    cx: start.x,
    cy: start.y,
    rx: Math.abs(start.x - end.x),
    ry: Math.abs(start.y - end.y),
    rotation: 0,
  });
  const toRectanglePoints = (start, end) => [
    { x: start.x, y: start.y },
    { x: end.x, y: start.y },
    { x: end.x, y: end.y },
    { x: start.x, y: end.y },
  ];
  const isDegenerateShapeDrag = (start, end) =>
    Math.abs(end.x - start.x) < minShapeDragPixels ||
    Math.abs(end.y - start.y) < minShapeDragPixels;

  function startDraft(kind, point) {
    startTimer();
    const stateKey = kind === "ellipse" ? "ellipseDraft" : "rectangleDraft";
    const snappedPoint = applySnap(point);
    if (!interactionState[stateKey]) {
      clearSelectionForShapeCreation();
      const classChoice = captureClassChoice();
      interactionState[stateKey] = {
        start: snappedPoint, end: snappedPoint,
        ...(classChoice ? { classChoice } : {}),
      };
      redraw();
      return;
    }
    interactionState[stateKey].end = snappedPoint;
    executeCommand(
      kind === "ellipse"
        ? COMMANDS.ANNOTATION_CREATE_ELLIPSE
        : COMMANDS.ANNOTATION_CREATE_RECTANGLE
    );
  }

  function updateDraft(kind, point) {
    const draft = interactionState[kind === "ellipse" ? "ellipseDraft" : "rectangleDraft"];
    if (!draft) return;
    draft.end = point;
    redraw();
  }

  function performFinishEllipse() {
    const draft = interactionState.ellipseDraft;
    if (!draft) return false;
    if (isDegenerateShapeDrag(draft.start, draft.end)) {
      draft.end = draft.start;
      redraw();
      return false;
    }
    const classChoice = availableClass(draft.classChoice);
    const annotation = createEllipseAnnotation({
      label: classChoice?.name || labels.ellipse,
      color: getDefaultShapeColor(),
      ellipse: toEllipse(draft.start, draft.end),
    });
    annotationState.annotations.push(annotation);
    const index = getAnnotationTypeIndex(annotationState.annotations, annotation.id);
    selectAnnotation(null);
    interactionState.ellipseDraft = null;
    interactionState.isDrawing = false;
    if (classChoice) {
      rememberAnnotationLabel(annotationState, "ellipse", classChoice.name);
    } else {
      openLabelEditor({
        annotationType: "ellipse",
        annotationIndex: index,
        initialLabel: labels.ellipse,
        anchorImagePoint: { ...draft.end },
        reason: "creation",
      });
    }
    redraw();
    return true;
  }

  function performFinishRectangle() {
    const draft = interactionState.rectangleDraft;
    if (!draft) return false;
    if (isDegenerateShapeDrag(draft.start, draft.end)) {
      draft.end = draft.start;
      redraw();
      return false;
    }
    const classChoice = availableClass(draft.classChoice);
    const annotation = createPolygonAnnotation({
      label: classChoice?.name || labels.rectangle,
      color: getDefaultShapeColor(),
      points: toRectanglePoints(draft.start, draft.end),
    });
    annotationState.annotations.push(annotation);
    const index = getAnnotationTypeIndex(annotationState.annotations, annotation.id);
    selectAnnotation(null);
    interactionState.rectangleDraft = null;
    interactionState.isDrawing = false;
    if (classChoice) {
      rememberAnnotationLabel(annotationState, "polygon", classChoice.name);
    } else {
      openLabelEditor({
        polygonIndex: index,
        initialLabel: labels.rectangle,
        anchorImagePoint: draft.end,
        reason: "creation",
      });
    }
    redraw();
    return true;
  }

  function isNearFirstVertex(point) {
    if (interactionState.currentPolygon.length < 3) return false;
    const first = scalePoint(interactionState.currentPolygon[0]);
    const cursor = scalePoint(point);
    return (first.x - cursor.x) ** 2 + (first.y - cursor.y) ** 2 <= closeSnapRadius ** 2;
  }

  function makePolygonPoint(point, curveFrom = null) {
    const clamped = clampPointToImage(point);
    const snapped = clampPointToImage(applySnap(point));
    // Outside the image, keep the crossed boundary fixed while sliding along it.
    const result = {
      x: point.x !== clamped.x ? clamped.x : snapped.x,
      y: point.y !== clamped.y ? clamped.y : snapped.y,
    };
    if (curveFrom) result.curveFrom = clampPointToImage(applySnap(curveFrom));
    return result;
  }

  function addPolygonPoint(point) {
    startTimer();
    if (interactionState.currentPolygon.length === 0) clearSelectionForShapeCreation();
    const clamped = clampPointToImage(point);
    const closePoint = point.x !== clamped.x || point.y !== clamped.y
      ? makePolygonPoint(point)
      : point;
    if (isNearFirstVertex(closePoint)) {
      executeCommand(COMMANDS.ANNOTATION_CREATE_POLYGON, { closePoint });
    } else if (
      interactionState.curveSegmentMode &&
      interactionState.currentPolygon.length > 0 &&
      !interactionState.currentCurveControl
    ) {
      executeCommand(COMMANDS.DRAFT_SET_CURVE_CONTROL, { point });
    } else {
      executeCommand(COMMANDS.DRAFT_ADD_POINT, { point });
    }
  }

  function performSetDraftCurveControl({ point }) {
    interactionState.currentCurveControl = applySnap(point);
    redraw();
    return true;
  }

  function performAddDraftPoint({ point }) {
    if (interactionState.currentPolygon.length === 0) {
      interactionState.currentPolygonClass = captureClassChoice();
    }
    interactionState.currentPolygon.push(
      makePolygonPoint(point, interactionState.currentCurveControl)
    );
    interactionState.currentCurveControl = null;
    interactionState.curveSegmentMode = false;
    syncToolStrip();
    redraw();
    return true;
  }

  function performFinishPolygon({ closePoint = null } = {}) {
    if (interactionState.currentPolygon.length < 3) {
      alertFn("Polygon needs at least 3 points.");
      return false;
    }
    const anchor =
      closePoint ||
      interactionState.currentPolygon.at(-1) ||
      interactionState.currentPolygon[0];
    const points = interactionState.currentPolygon.map((point, index) => {
      const copy = clonePolygonPoint(point);
      if (index === 0 && interactionState.currentCurveControl) {
        copy.curveFrom = applySnap(interactionState.currentCurveControl);
      }
      return copy;
    });
    const classChoice = availableClass(interactionState.currentPolygonClass);
    const annotation = createPolygonAnnotation({
      label: classChoice?.name || labels.polygon,
      color: getDefaultShapeColor(),
      points,
    });
    annotationState.annotations.push(annotation);
    const index = getAnnotationTypeIndex(annotationState.annotations, annotation.id);
    selectAnnotation(null);
    interactionState.currentPolygon = [];
    interactionState.currentPolygonClass = null;
    interactionState.currentCurveControl = null;
    interactionState.curveSegmentMode = false;
    syncToolStrip();
    if (classChoice) {
      rememberAnnotationLabel(annotationState, "polygon", classChoice.name);
    } else {
      openLabelEditor({
        polygonIndex: index,
        initialLabel: labels.polygon,
        anchorImagePoint: anchor,
        reason: "creation",
      });
    }
    redraw();
    return true;
  }

  return Object.freeze({
    addPolygonPoint,
    makePolygonPoint,
    performAddDraftPoint,
    performFinishEllipse,
    performFinishPolygon,
    performFinishRectangle,
    performSetDraftCurveControl,
    startEllipse: (point) => startDraft("ellipse", point),
    startRectangle: (point) => startDraft("rectangle", point),
    toEllipse,
    toRectanglePoints,
    updateEllipse: (point) => updateDraft("ellipse", point),
    updateRectangle: (point) => updateDraft("rectangle", point),
  });
}
