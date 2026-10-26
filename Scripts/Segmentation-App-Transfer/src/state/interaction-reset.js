/**
 * Owns field-level reset rules for transient drawing and editing state.
 *
 * Consumers compose these focused operations to preserve the reset scope of
 * their workflow instead of repeating lists of state assignments.
 */
export function createInteractionReset(interactionState) {
  function clearPolygonDraft() {
    interactionState.currentPolygon = [];
    interactionState.currentPolygonClass = null;
    interactionState.currentCurveControl = null;
    interactionState.curveSegmentMode = false;
  }

  function clearShapeDrafts() {
    clearPolygonDraft();
    interactionState.rectangleDraft = null;
    interactionState.ellipseDraft = null;
  }

  function clearVertexInteraction() {
    interactionState.activeVertex = null;
    interactionState.selectionBox = null;
  }

  function clearGeometryInteraction() {
    clearVertexInteraction();
    interactionState.activeAnnotationDrag = null;
  }

  function clearVertexSelection() {
    if (interactionState.selectedVertexKeys instanceof Set) {
      interactionState.selectedVertexKeys.clear();
    } else {
      interactionState.selectedVertexKeys = new Set();
    }
  }

  function stopDrawing() {
    interactionState.isDrawing = false;
  }

  function clearCursor() {
    interactionState.cursorImagePos = null;
  }

  function clearTransientEditState() {
    clearGeometryInteraction();
    stopDrawing();
    clearVertexSelection();
  }

  return {
    clearCursor,
    clearGeometryInteraction,
    clearPolygonDraft,
    clearShapeDrafts,
    clearTransientEditState,
    clearVertexInteraction,
    clearVertexSelection,
    stopDrawing,
  };
}
