import { COMMANDS } from "../commands/command-names.js";
import { clamp } from "../geometry/math.js";
import { clonePolygonPoint } from "../geometry/polygon.js";
import { prepareCurveSamplingInsertion, finishCurveSamplingInsertion } from "../geometry/curve-sampling.js";
import {
  getAnnotationAtTypeIndex,
  getAnnotationById,
  getAnnotationTypeIndex,
} from "../model/annotation.js";
import { getReviewStatus, invalidateReview } from "../model/annotation-review.js";

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
  canEditAnnotation = annotation => !annotation.editor?.hidden && !annotation.editor?.locked,
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
    const annotation = hit && getAnnotationById(annotationState.annotations, hit.annotationId);
    if (!annotation || !canEditAnnotation(annotation)) return false;
    const geometry = annotation.geometry;
    const polygon = geometry?.points;
    if (!polygon) return false;
    const index = clamp(hit.insertIndex, 0, polygon.length);
    const sampling = prepareCurveSamplingInsertion(geometry, index);
    if (hit.curveT != null) {
      const start = polygon[(index + polygon.length - 1) % polygon.length];
      const end = polygon[index % polygon.length];
      const control = end.curveFrom;
      const t = hit.curveT;
      const firstControl = {
        x: start.x + t * (control.x - start.x),
        y: start.y + t * (control.y - start.y),
      };
      const secondControl = {
        x: control.x + t * (end.x - control.x),
        y: control.y + t * (end.y - control.y),
      };
      // De Casteljau subdivision preserves the curve; snapping would move it off its path.
      polygon.splice(index, 0, {
        x: firstControl.x + t * (secondControl.x - firstControl.x),
        y: firstControl.y + t * (secondControl.y - firstControl.y),
        curveFrom: firstControl,
      });
      end.curveFrom = secondControl;
    } else polygon.splice(index, 0, applySnap(hit.projectedPoint));
    finishCurveSamplingInsertion(geometry, index, hit.curveT, sampling);
    invalidateReview(annotation);
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
    for (const id of groups.keys()) {
      const annotation = id === "draft" ? null : getAnnotationById(annotationState.annotations, id);
      if (annotation && !canEditAnnotation(annotation)) return false;
    }
    let deleted = 0;
    let blocked = 0;
    groups.forEach((indices, id) => {
      const annotation = id === "draft" ? null : getAnnotationById(annotationState.annotations, id);
      if (id !== "draft" && (!annotation || !canEditAnnotation(annotation))) return;
      const points =
        id === "draft"
          ? interactionState.currentPolygon
          : annotation.geometry?.points;
      if (!points) return;
      if (id !== "draft" && points.length - indices.size < 3) {
        blocked += 1;
        return;
      }
      [...indices].sort((a, b) => b - a).forEach((index) => {
        if (points[index]) {
          points.splice(index, 1);
          if (annotation) invalidateReview(annotation);
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
    if (!resolved || !canEditAnnotation(resolved)) return false;
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
    if (!annotation || !canEditAnnotation(annotation)) return false;
    let changed = false;
    if (drag.type === "polygon") {
      annotation.geometry.points.forEach((target, index) => {
        const origin = drag.originPolygon[index];
        const next = clampPointToImage({ x: origin.x + dx, y: origin.y + dy });
        changed ||= target.x !== next.x || target.y !== next.y;
        Object.assign(target, next);
        if (origin.curveFrom) {
          const control = clampPointToImage({
            x: origin.curveFrom.x + dx,
            y: origin.curveFrom.y + dy,
          });
          changed ||= target.curveFrom?.x !== control.x || target.curveFrom?.y !== control.y;
          target.curveFrom = control;
        }
      });
    } else {
      changed = annotation.geometry.cx !== drag.originEllipse.cx + dx
        || annotation.geometry.cy !== drag.originEllipse.cy + dy;
      annotation.geometry.cx = drag.originEllipse.cx + dx;
      annotation.geometry.cy = drag.originEllipse.cy + dy;
    }
    if (changed) invalidateReview(annotation);
    redraw();
    return true;
  }

  function performStopActiveAnnotationDrag() {
    const drag = interactionState.activeAnnotationDrag;
    if (!drag) return false;
    const annotation = getAnnotationById(annotationState.annotations, drag.annotationId);
    if (!annotation || !canEditAnnotation(annotation)) {
      interactionState.activeAnnotationDrag = null;
      interactionState.isDrawing = false;
      return false;
    }
    const approvedGeometry = getReviewStatus(annotation) === "approved" ? JSON.stringify(annotation.geometry) : null;
    if (drag.type === "polygon") clampPolygonNodesToImage(annotation.geometry.points);
    else fitEllipseInsideImage(annotation.geometry);
    if (approvedGeometry !== null && approvedGeometry !== JSON.stringify(annotation.geometry)) invalidateReview(annotation);
    interactionState.activeAnnotationDrag = null;
    interactionState.isDrawing = false;
    redraw();
    return true;
  }

  function performUpdateActiveVertex(point) {
    const active = interactionState.activeVertex;
    if (!active) return false;
    const annotation = active.polygonIndex === -1 ? null
      : getAnnotationById(annotationState.annotations, active.annotationId);
    if (active.polygonIndex !== -1 && (!annotation || !canEditAnnotation(annotation))) return false;
    const clamped = clampPointToImage(applySnap(point));
    let changed = false;
    if (active.ellipseIndex != null) {
      const ellipse = annotation.geometry;
      const before = { ...ellipse };
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
      changed = Object.keys(before).some(key => before[key] !== ellipse[key]);
    } else {
      const points =
        active.polygonIndex === -1
          ? interactionState.currentPolygon
          : annotation.geometry?.points;
      if (!points?.[active.pointIndex]) return false;
      if (active.controlType === "curveFrom") {
        const control = points[active.pointIndex].curveFrom;
        changed = control?.x !== clamped.x || control?.y !== clamped.y;
        points[active.pointIndex].curveFrom = clamped;
      }
      else {
        changed = points[active.pointIndex].x !== clamped.x || points[active.pointIndex].y !== clamped.y;
        const curveFrom = points[active.pointIndex].curveFrom;
        points[active.pointIndex] = { ...clamped, ...(curveFrom ? { curveFrom } : {}) };
      }
    }
    if (annotation && changed) invalidateReview(annotation);
    redraw();
    return true;
  }

  function performStartGeometryEdit(payload = {}) {
    if (payload.kind === "annotation") {
      return performStartAnnotationDrag(payload.annotation, payload.startImagePoint);
    }
    if (payload.kind !== "vertex" || !payload.vertex) return false;
    if (payload.vertex.polygonIndex !== -1) {
      const annotation = getAnnotationById(annotationState.annotations, payload.vertex.annotationId);
      if (!annotation || !canEditAnnotation(annotation)) return false;
    }
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
