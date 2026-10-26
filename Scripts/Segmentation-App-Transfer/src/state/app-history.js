import { createSnapshotHistory } from "./snapshot-history.js";
import { createInteractionReset } from "./interaction-reset.js";

/**
 * Creates annotation undo/redo history without exposing snapshot details to
 * the application composition root.
 */
export function createAppHistory({
  annotationState,
  interactionState,
  imageState,
  getLabelColorAssignments = () => null,
  onRestore,
  onImageSizeRestore = () => {},
  maxEntries = 50,
}) {
  const interactionReset = createInteractionReset(interactionState);

  function capture() {
    const raw = {
      annotations: annotationState.annotations,
      lastPolygonLabel: annotationState.lastPolygonLabel,
      lastEllipseLabel: annotationState.lastEllipseLabel,
      lastShapeColor: annotationState.lastShapeColor,
      labelColorAssignments: [...(getLabelColorAssignments() || [])],
      currentPolygon: interactionState.currentPolygon,
      currentPolygonClass: interactionState.currentPolygonClass,
      currentCurveControl: interactionState.currentCurveControl,
      curveSegmentMode: interactionState.curveSegmentMode,
      ellipseDraft: interactionState.ellipseDraft,
      rectangleDraft: interactionState.rectangleDraft,
      selectedAnnotationId: interactionState.selectedAnnotationId,
      calibration: imageState?.calibration || null,
      imageRevision: imageState?.revision,
      imageName: imageState?.imageName || "",
      imageSize: imageState?.imageSize || null,
    };
    const snapshot = JSON.parse(JSON.stringify(raw));
    // Keep pixel identity outside the JSON copy; failed loads can change revision.
    snapshot.imageSource = imageState?.image;
    snapshot.selectedVertexKeys = [...interactionState.selectedVertexKeys];
    return snapshot;
  }

  function restore(snapshot) {
    let dimensionsChanged = false;
    if (imageState && snapshot.imageRevision === imageState.revision) {
      imageState.calibration = snapshot.calibration || null;
    }
    if (imageState && snapshot.imageSource === imageState.image) {
      dimensionsChanged = imageState.imageSize?.width !== snapshot.imageSize?.width
        || imageState.imageSize?.height !== snapshot.imageSize?.height;
      imageState.imageName = snapshot.imageName || "";
      imageState.imageSize = snapshot.imageSize ? { ...snapshot.imageSize } : null;
    }
    annotationState.annotations = Array.isArray(snapshot.annotations)
      ? snapshot.annotations
      : [];
    annotationState.lastPolygonLabel = snapshot.lastPolygonLabel || "polygon";
    annotationState.lastEllipseLabel = snapshot.lastEllipseLabel || "ellipse";
    annotationState.lastShapeColor = snapshot.lastShapeColor || "";
    // Imported labels can reset the palette. Restore its order and colors before
    // redraw, keeping the shared Map used by the catalog, exports, and recovery.
    const labelColorAssignments = getLabelColorAssignments();
    if (labelColorAssignments) {
      labelColorAssignments.clear();
      for (const [label, color] of snapshot.labelColorAssignments || []) {
        labelColorAssignments.set(label, { ...color });
      }
    }
    interactionState.currentPolygon = snapshot.currentPolygon;
    interactionState.currentPolygonClass = snapshot.currentPolygonClass || null;
    interactionState.currentCurveControl = snapshot.currentCurveControl || null;
    interactionState.curveSegmentMode = Boolean(snapshot.curveSegmentMode);
    interactionState.ellipseDraft = snapshot.ellipseDraft;
    interactionState.rectangleDraft = snapshot.rectangleDraft;
    interactionState.selectedAnnotationId = snapshot.selectedAnnotationId || null;
    interactionState.selectedVertexKeys = new Set(snapshot.selectedVertexKeys);
    interactionReset.clearGeometryInteraction();
    if (dimensionsChanged) onImageSizeRestore();
  }

  return createSnapshotHistory({
    capture,
    restore,
    maxEntries,
    onRestore,
    canRestore: () => imageState?.imageLoadStatus !== "loading",
  });
}
