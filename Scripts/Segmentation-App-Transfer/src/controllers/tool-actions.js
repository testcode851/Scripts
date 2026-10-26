import { createInteractionReset } from "../state/interaction-reset.js";

/**
 * Owns toolbar/context-menu mode transitions that coordinate the tool and
 * annotation workflow controllers.
 */
export function createToolActions(options) {
  const {
    interactionState,
    polygonTool,
    clearVertexSelection,
    setTool,
    syncToolStrip,
    redraw,
    onDocumentChange = () => {},
  } = options;
  const interactionReset = createInteractionReset(interactionState);

  function disableVertexEditing() {
    interactionState.vertexEditEnabled = false;
    interactionReset.clearGeometryInteraction();
    clearVertexSelection();
  }

  function toggleVertexEditMode() {
    const endsGeometryEdit = interactionState.isDrawing
      && Boolean(interactionState.activeVertex || interactionState.activeAnnotationDrag);
    interactionState.vertexEditEnabled = !interactionState.vertexEditEnabled;
    interactionReset.clearGeometryInteraction();
    interactionReset.stopDrawing();
    if (!interactionState.vertexEditEnabled) clearVertexSelection();
    syncToolStrip();
    redraw();
    if (endsGeometryEdit) onDocumentChange();
  }

  function switchTool(tool) {
    const endsGeometryEdit = interactionState.vertexEditEnabled && interactionState.isDrawing
      && Boolean(interactionState.activeVertex || interactionState.activeAnnotationDrag);
    const clearsFixedDraft = interactionState.currentPolygon.length > 0
      || Boolean(interactionState.currentCurveControl);
    if (interactionState.vertexEditEnabled) disableVertexEditing();
    setTool(tool);
    syncToolStrip();
    if (endsGeometryEdit && !clearsFixedDraft) onDocumentChange();
  }

  function toggleCurveSegmentMode() {
    if (
      interactionState.vertexEditEnabled ||
      interactionState.tool !== polygonTool ||
      interactionState.currentPolygon.length === 0
    ) {
      return false;
    }
    interactionState.curveSegmentMode = !interactionState.curveSegmentMode;
    if (!interactionState.curveSegmentMode) {
      interactionState.currentCurveControl = null;
    }
    syncToolStrip();
    redraw();
    return true;
  }

  return {
    switchTool,
    toggleCurveSegmentMode,
    toggleVertexEditMode,
  };
}
