import { COMMANDS } from "../commands/command-names.js";
import { clamp } from "../geometry/math.js";
import { clonePolygonPoint } from "../geometry/polygon.js";
import {
  getAnnotationAtTypeIndex,
  getAnnotationById,
  getAnnotationTypeIndex,
} from "../model/annotation.js";

/**
 * Owns annotation dragging, vertex/control editing, edge insertion, and safe
 * vertex deletion while preserving command-owned mutation boundaries.
 */
export function createAnnotationGeometryEdit({
  annotationState,
  interactionState,
  coordinates,
  selection,
  applySnap,
  executeCommand,
  redraw,
  alertFn = globalThis.alert,
}) {
  const {
    clampPointToImage,
    clampPolygonNodesToImage,
    fitEllipseInsideImage,
    getImageBounds,
  } = coordinates;
  const {
    clearVertexSelection,
    findEdgeAtPoint,
    getAnnotationReference,
    selectAnnotation,
    selectSingleVertex,
  } = selection;

  function performInsertVertexOnNearestEdge({ canvasPoint }) {
    const hit = findEdgeAtPoint(canvasPoint);
    const polygon = hit &&
      getAnnotationById(annotationState.annotations, hit.annotationId)?.geometry?.points;
    if (!polygon) return false;
    const index = clamp(hit.insertIndex, 0, polygon.length);
    polygon.splice(index, 0, applySnap(hit.projectedPoint));
    selectAnnotation({ type: "polygon", index: hit.polygonIndex });
    selectSingleVertex({ polygonIndex: hit.polygonIndex, pointIndex: index });
    redraw();
    return true;
  }

  function performDeleteSelectedVertices() {
    const groups = new Map();
    interactionState.selectedVertexKeys.forEach((key) => {
      const separator = key.lastIndexOf("|");
      const id = key.slice(0, separator);
      const index = Number(key.slice(separator + 1));
      if (!Number.isInteger(index)) return;
      if (!groups.has(id)) groups.set(id, new Set());
      groups.get(id).add(index);
    });
    let deleted = 0;
    let blocked = 0;
    groups.forEach((indices, id) => {
      const points =
        id === "draft"
          ? interactionState.currentPolygon
          : getAnnotationById(annotationState.annotations, id)?.geometry?.points;
      if (!points) return;
      if (id !== "draft" && points.length - indices.size < 3) {
        blocked += 1;
        return;
      }
      [...indices].sort((a, b) => b - a).forEach((index) => {
        if (points[index]) {
          points.splice(index, 1);
          deleted += 1;
        }
      });
    });
    if (!deleted) {
      if (blocked) {
        alertFn(
          "Vertices were not deleted because polygons must keep at least 3 vertices. " +
            "Use Delete Selected Annotation to remove the full shape."
        );
      }
      return false;
    }
    clearVertexSelection();
    interactionState.activeVertex = null;
    redraw();
    return true;
  }

  function performStartAnnotationDrag(annotation, start) {
    const resolved = annotation?.id
      ? getAnnotationById(annotationState.annotations, annotation.id)
      : getAnnotationAtTypeIndex(annotationState.annotations, annotation?.type, annotation?.index);
    if (!resolved) return false;
    const index = getAnnotationTypeIndex(annotationState.annotations, resolved.id);
    interactionState.activeAnnotationDrag =
      resolved.type === "polygon"
        ? {
            type: "polygon",
            annotationId: resolved.id,
            index,
            start: { ...start },
            originPolygon: resolved.geometry.points.map(clonePolygonPoint),
          }
        : {
            type: "ellipse",
            annotationId: resolved.id,
            index,
            start: { ...start },
            originEllipse: { ...resolved.geometry },
          };
    selectAnnotation(getAnnotationReference(resolved));
    interactionState.activeVertex = null;
    interactionState.selectionBox = null;
    clearVertexSelection();
    interactionState.isDrawing = true;
    redraw();
    return true;
  }

  function performUpdateActiveAnnotationDrag(point) {
    const drag = interactionState.activeAnnotationDrag;
    if (!drag) return false;
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    const annotation = getAnnotationById(annotationState.annotations, drag.annotationId);
    if (!annotation) return false;
    if (drag.type === "polygon") {
      annotation.geometry.points.forEach((target, index) => {
        const origin = drag.originPolygon[index];
        Object.assign(target, clampPointToImage({ x: origin.x + dx, y: origin.y + dy }));
        if (origin.curveFrom) {
          target.curveFrom = clampPointToImage({
            x: origin.curveFrom.x + dx,
            y: origin.curveFrom.y + dy,
          });
        }
      });
    } else {
      annotation.geometry.cx = drag.originEllipse.cx + dx;
      annotation.geometry.cy = drag.originEllipse.cy + dy;
    }
    redraw();
    return true;
  }

  function performStopActiveAnnotationDrag() {
    const drag = interactionState.activeAnnotationDrag;
    if (!drag) return false;
    const annotation = getAnnotationById(annotationState.annotations, drag.annotationId);
    if (drag.type === "polygon") clampPolygonNodesToImage(annotation.geometry.points);
    else fitEllipseInsideImage(annotation.geometry);
    interactionState.activeAnnotationDrag = null;
    interactionState.isDrawing = false;
    redraw();
    return true;
  }

  function performUpdateActiveVertex(point) {
    const active = interactionState.activeVertex;
    if (!active) return false;
    const clamped = clampPointToImage(applySnap(point));
    if (active.ellipseIndex != null) {
      const ellipse = getAnnotationById(annotationState.annotations, active.annotationId)?.geometry;
      const bounds = getImageBounds();
      if (active.handleType === "center") {
        ellipse.cx = clamped.x;
        ellipse.cy = clamped.y;
        fitEllipseInsideImage(ellipse);
      } else if (active.handleType === "right" || active.handleType === "left") {
        ellipse.rx = Math.min(Math.abs(clamped.x - ellipse.cx), ellipse.cx, bounds.maxX - ellipse.cx);
      } else {
        ellipse.ry = Math.min(Math.abs(clamped.y - ellipse.cy), ellipse.cy, bounds.maxY - ellipse.cy);
      }
    } else {
      const points =
        active.polygonIndex === -1
          ? interactionState.currentPolygon
          : getAnnotationById(annotationState.annotations, active.annotationId)?.geometry?.points;
      if (!points?.[active.pointIndex]) return false;
      if (active.controlType === "curveFrom") points[active.pointIndex].curveFrom = clamped;
      else {
        const curveFrom = points[active.pointIndex].curveFrom;
        points[active.pointIndex] = { ...clamped, ...(curveFrom ? { curveFrom } : {}) };
      }
    }
    redraw();
    return true;
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

  const performUpdateGeometryEdit = (payload = {}) =>
    payload.kind === "annotation"
      ? performUpdateActiveAnnotationDrag(payload.point)
      : payload.kind === "vertex"
        ? performUpdateActiveVertex(payload.point)
        : false;

  function performEndGeometryEdit(payload = {}) {
    if (payload.kind === "annotation") return performStopActiveAnnotationDrag();
    if (payload.kind === "vertex" && interactionState.activeVertex) {
      interactionState.isDrawing = false;
      redraw();
      return true;
    }
    return false;
  }

  return Object.freeze({
    beginVertexGeometryEdit: (vertex) =>
      executeCommand(COMMANDS.ANNOTATION_GEOMETRY_EDIT_START, { kind: "vertex", vertex }),
    insertVertexOnNearestEdge: (canvasPoint) =>
      executeCommand(COMMANDS.ANNOTATION_INSERT_VERTEX, { canvasPoint }),
    performDeleteSelectedVertices,
    performEndGeometryEdit,
    performInsertVertexOnNearestEdge,
    performStartGeometryEdit,
    performUpdateGeometryEdit,
    startAnnotationDrag: (annotation, startImagePoint) =>
      executeCommand(COMMANDS.ANNOTATION_GEOMETRY_EDIT_START, {
        kind: "annotation",
        annotation,
        startImagePoint,
      }),
    stopActiveAnnotationDrag: () =>
      executeCommand(COMMANDS.ANNOTATION_GEOMETRY_EDIT_END, { kind: "annotation" }),
    updateActiveAnnotationDrag: (point) =>
      executeCommand(COMMANDS.ANNOTATION_GEOMETRY_EDIT_UPDATE, {
        kind: "annotation",
        point,
      }),
    updateActiveVertex: (point) =>
      executeCommand(COMMANDS.ANNOTATION_GEOMETRY_EDIT_UPDATE, { kind: "vertex", point }),
  });
}
