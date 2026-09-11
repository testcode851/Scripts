import { clamp } from "../geometry/math.js";
import { flattenPolygon } from "../geometry/polygon.js";
import {
  getAnnotationAtTypeIndex,
  getAnnotationById,
  getAnnotationTypeIndex,
  getAnnotationsByType,
} from "../model/annotation.js";
import { getEllipseHandles } from "../render/canvas-renderer.js";
import { createInteractionReset } from "../state/interaction-reset.js";

/** Owns annotation and vertex selection plus canvas-space hit testing. */
export function createAnnotationSelection({
  annotationState,
  interactionState,
  coordinates,
  redraw,
}) {
  const interactionReset = createInteractionReset(interactionState);
  const { scaleEllipse, scalePoint, unscalePoint } = coordinates;
  const polygons = () => getAnnotationsByType(annotationState.annotations, "polygon");
  const ellipses = () => getAnnotationsByType(annotationState.annotations, "ellipse");
  const selected = () =>
    getAnnotationById(annotationState.annotations, interactionState.selectedAnnotationId);

  function getAnnotationReference(annotation) {
    return annotation
      ? {
          id: annotation.id,
          type: annotation.type,
          index: getAnnotationTypeIndex(annotationState.annotations, annotation.id),
        }
      : null;
  }

  function getAnnotationSequence() {
    return [
      ...polygons().map((annotation, index) => ({
        id: annotation.id,
        type: "polygon",
        index,
      })),
      ...ellipses().map((annotation, index) => ({
        id: annotation.id,
        type: "ellipse",
        index,
      })),
    ];
  }

  function normalizeSelectedAnnotation() {
    if (interactionState.selectedAnnotationId && !selected()) {
      interactionState.selectedAnnotationId = null;
    }
  }

  function selectAnnotation(annotation) {
    if (!annotation) {
      interactionState.selectedAnnotationId = null;
      return;
    }
    const resolved = annotation.id
      ? getAnnotationById(annotationState.annotations, annotation.id)
      : getAnnotationAtTypeIndex(
          annotationState.annotations,
          annotation.type,
          Number(annotation.index)
        );
    interactionState.selectedAnnotationId = resolved?.id || null;
  }

  function getVertexKey(polygonIndex, pointIndex) {
    const ownerId = polygonIndex === -1 ? "draft" : polygons()[polygonIndex]?.id;
    return ownerId ? `${ownerId}|${pointIndex}` : "";
  }

  function clearVertexSelection() {
    interactionReset.clearVertexSelection();
  }

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

  function addVertexToSelection(vertex) {
    const key = vertex && getVertexKey(vertex.polygonIndex, vertex.pointIndex);
    if (key) interactionState.selectedVertexKeys.add(key);
  }

  function removeVertexFromSelection(vertex) {
    if (vertex) {
      interactionState.selectedVertexKeys.delete(
        getVertexKey(vertex.polygonIndex, vertex.pointIndex)
      );
    }
  }

  function isVertexSelected(polygonIndex, pointIndex) {
    return interactionState.selectedVertexKeys.has(getVertexKey(polygonIndex, pointIndex));
  }

  function cycleAnnotationSelection(direction = 1) {
    const sequence = getAnnotationSequence();
    if (sequence.length === 0) {
      selectAnnotation(null);
      redraw();
      return false;
    }
    normalizeSelectedAnnotation();
    const currentIndex = sequence.findIndex(
      (entry) => entry.id === interactionState.selectedAnnotationId
    );
    const nextIndex =
      currentIndex < 0
        ? direction < 0
          ? sequence.length - 1
          : 0
        : (currentIndex + direction + sequence.length) % sequence.length;
    selectAnnotation(sequence[nextIndex]);
    redraw();
    return true;
  }

  function isPointInPolygon(point, polygon) {
    let inside = false;
    for (
      let index = 0, previous = polygon.length - 1;
      index < polygon.length;
      previous = index++
    ) {
      const currentPoint = polygon[index];
      const previousPoint = polygon[previous];
      const intersects =
        currentPoint.y > point.y !== previousPoint.y > point.y &&
        point.x <
          ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
            (previousPoint.y - currentPoint.y || 1e-8) +
            currentPoint.x;
      if (intersects) inside = !inside;
    }
    return inside;
  }

  function findAnnotationAtPoint(canvasPoint) {
    const hits = [];
    polygons().forEach((annotation, index) => {
      const polygon = flattenPolygon(annotation.geometry.points).map(scalePoint);
      if (polygon.length >= 3 && isPointInPolygon(canvasPoint, polygon)) {
        hits.push({ id: annotation.id, type: "polygon", index });
      }
    });
    ellipses().forEach((annotation, index) => {
      const ellipse = scaleEllipse(annotation.geometry);
      if (
        ellipse.rx > 0 &&
        ellipse.ry > 0 &&
        ((canvasPoint.x - ellipse.cx) / ellipse.rx) ** 2 +
          ((canvasPoint.y - ellipse.cy) / ellipse.ry) ** 2 <=
          1.05
      ) {
        hits.push({ id: annotation.id, type: "ellipse", index });
      }
    });
    return hits.at(-1) || null;
  }

  function findVertexAtPoint(canvasPoint) {
    const threshold = 10;
    for (const [polygonIndex, annotation] of polygons().entries()) {
      for (const [pointIndex, point] of annotation.geometry.points.entries()) {
        if (point.curveFrom) {
          const control = scalePoint(point.curveFrom);
          if (
            Math.hypot(control.x - canvasPoint.x, control.y - canvasPoint.y) <=
            threshold
          ) {
            return {
              annotationId: annotation.id,
              polygonIndex,
              pointIndex,
              controlType: "curveFrom",
            };
          }
        }
        const scaled = scalePoint(point);
        if (Math.hypot(scaled.x - canvasPoint.x, scaled.y - canvasPoint.y) <= threshold) {
          return { annotationId: annotation.id, polygonIndex, pointIndex };
        }
      }
    }
    for (const [pointIndex, point] of interactionState.currentPolygon.entries()) {
      if (point.curveFrom) {
        const control = scalePoint(point.curveFrom);
        if (
          Math.hypot(control.x - canvasPoint.x, control.y - canvasPoint.y) <= threshold
        ) {
          return { polygonIndex: -1, pointIndex, controlType: "curveFrom" };
        }
      }
      const scaled = scalePoint(point);
      if (Math.hypot(scaled.x - canvasPoint.x, scaled.y - canvasPoint.y) <= threshold) {
        return { polygonIndex: -1, pointIndex };
      }
    }
    for (const [ellipseIndex, annotation] of ellipses().entries()) {
      for (const handle of getEllipseHandles(scaleEllipse(annotation.geometry))) {
        if (Math.hypot(handle.x - canvasPoint.x, handle.y - canvasPoint.y) <= threshold) {
          return { annotationId: annotation.id, ellipseIndex, handleType: handle.type };
        }
      }
    }
    return null;
  }

  function findEdgeAtPoint(canvasPoint) {
    let best = null;
    let bestDistance = 10;
    polygons().forEach((annotation, polygonIndex) => {
      const points = annotation.geometry.points;
      points.forEach((point, pointIndex) => {
        const start = scalePoint(point);
        const end = scalePoint(points[(pointIndex + 1) % points.length]);
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const lengthSquared = dx * dx + dy * dy;
        if (!lengthSquared) return;
        const ratio = clamp(
          ((canvasPoint.x - start.x) * dx + (canvasPoint.y - start.y) * dy) /
            lengthSquared,
          0,
          1
        );
        const projected = { x: start.x + ratio * dx, y: start.y + ratio * dy };
        const distance = Math.hypot(
          canvasPoint.x - projected.x,
          canvasPoint.y - projected.y
        );
        if (distance < bestDistance) {
          bestDistance = distance;
          best = {
            annotationId: annotation.id,
            polygonIndex,
            insertIndex: pointIndex + 1,
            projectedPoint: unscalePoint(projected),
          };
        }
      });
    });
    return best;
  }

  const getSelectionModeFromEvent = (event) =>
    event.shiftKey ? "add" : event.ctrlKey || event.metaKey ? "subtract" : "replace";

  function getVerticesInSelectionBox(box) {
    if (!box) return [];
    const minX = Math.min(box.start.x, box.end.x);
    const maxX = Math.max(box.start.x, box.end.x);
    const minY = Math.min(box.start.y, box.end.y);
    const maxY = Math.max(box.start.y, box.end.y);
    const hits = [];
    polygons().forEach((annotation, polygonIndex) => {
      annotation.geometry.points.forEach((point, pointIndex) => {
        const scaled = scalePoint(point);
        if (
          scaled.x >= minX &&
          scaled.x <= maxX &&
          scaled.y >= minY &&
          scaled.y <= maxY
        ) {
          hits.push({ annotationId: annotation.id, polygonIndex, pointIndex });
        }
      });
    });
    interactionState.currentPolygon.forEach((point, pointIndex) => {
      const scaled = scalePoint(point);
      if (
        scaled.x >= minX &&
        scaled.x <= maxX &&
        scaled.y >= minY &&
        scaled.y <= maxY
      ) {
        hits.push({ polygonIndex: -1, pointIndex });
      }
    });
    return hits;
  }

  function finalizeSelectionBox() {
    const box = interactionState.selectionBox;
    if (!box) return;
    const vertices = getVerticesInSelectionBox(box);
    const width = Math.abs(box.end.x - box.start.x);
    const height = Math.abs(box.end.y - box.start.y);
    if (
      width < 3 &&
      height < 3 &&
      interactionState.selectionMode !== "replace" &&
      vertices.length === 0
    ) {
      const hit = findVertexAtPoint(box.end);
      if (hit?.polygonIndex != null && hit?.pointIndex != null) {
        if (interactionState.selectionMode === "subtract") {
          removeVertexFromSelection(hit);
        } else {
          addVertexToSelection(hit);
        }
        interactionState.selectionBox = null;
        interactionState.selectionMode = "replace";
        return;
      }
    }
    if (interactionState.selectionMode === "replace") clearVertexSelection();
    vertices.forEach(
      interactionState.selectionMode === "subtract"
        ? removeVertexFromSelection
        : addVertexToSelection
    );
    interactionState.selectionBox = null;
    interactionState.selectionMode = "replace";
  }

  return Object.freeze({
    addVertexToSelection,
    clearVertexSelection,
    cycleAnnotationSelection,
    finalizeSelectionBox,
    findAnnotationAtPoint,
    findEdgeAtPoint,
    findVertexAtPoint,
    getAnnotationReference,
    getAnnotationSequence,
    getSelectionModeFromEvent,
    isVertexSelected,
    normalizeSelectedAnnotation,
    removeVertexFromSelection,
    selectAnnotation,
    selectSingleVertex,
  });
}
