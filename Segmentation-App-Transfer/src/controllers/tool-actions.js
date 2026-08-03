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
  } = options;
  const interactionReset = createInteractionReset(interactionState);

  function disableVertexEditing() {
    interactionState.vertexEditEnabled = false;
    interactionReset.clearGeometryInteraction();
    clearVertexSelection();
  }

  function toggleVertexEditMode() {
    interactionState.vertexEditEnabled = !interactionState.vertexEditEnabled;
    interactionReset.clearGeometryInteraction();
    interactionReset.stopDrawing();
    if (!interactionState.vertexEditEnabled) clearVertexSelection();
    syncToolStrip();
    redraw();
  }

  function switchTool(tool) {
    if (interactionState.vertexEditEnabled) disableVertexEditing();
    setTool(tool);
    syncToolStrip();
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
