import { createSnapshotHistory } from "./snapshot-history.js";
import { createInteractionReset } from "./interaction-reset.js";

/**
 * Creates annotation undo/redo history without exposing snapshot details to
 * the application composition root.
 */
export function createAppHistory({
  annotationState,
  interactionState,
  onRestore,
  maxEntries = 50,
}) {
  const interactionReset = createInteractionReset(interactionState);

  function capture() {
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
    snapshot.selectedVertexKeys = [...interactionState.selectedVertexKeys];
    return snapshot;
  }

  function restore(snapshot) {
    annotationState.annotations = Array.isArray(snapshot.annotations)
      ? snapshot.annotations
      : [];
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
    interactionReset.clearVertexInteraction();
  }

  return createSnapshotHistory({
    capture,
    restore,
    maxEntries,
    onRestore,
  });
}
