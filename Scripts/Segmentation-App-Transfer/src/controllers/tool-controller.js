import { COMMANDS } from "../commands/command-names.js";
import { createInteractionReset } from "../state/interaction-reset.js";
import { createListenerLifecycle } from "../utils/listener-lifecycle.js";

/** Owns drawing-tool state transitions and tool-strip event binding. */
export function createToolController(options) {
  const {
    interactionState,
    commandRegistry,
    tools,
    buttons,
    closeCanvasLabelEditor,
    closeCanvasContextMenu,
    clearVertexSelection,
    syncCanvasCursor,
    redraw,
  } = options;

  const interactionReset = createInteractionReset(interactionState);
  const listenerLifecycle = createListenerLifecycle();
  const { listen } = listenerLifecycle;
  const drawingButtons = [buttons.polygon, buttons.rectangle, buttons.ellipse].filter(Boolean);
  const toolByButton = new Map([
    [buttons.polygon, tools.polygon],
    [buttons.rectangle, tools.rectangle],
    [buttons.ellipse, tools.ellipse],
  ]);

  function syncToolStripUI() {
    drawingButtons.forEach((button) => {
      button.classList.toggle(
        "active",
        toolByButton.get(button) === interactionState.tool && !interactionState.vertexEditEnabled
      );
    });
    if (buttons.curveSegment) {
      buttons.curveSegment.classList.toggle(
        "active",
        interactionState.curveSegmentMode &&
          interactionState.tool === tools.polygon &&
          !interactionState.vertexEditEnabled
      );
      buttons.curveSegment.disabled =
        interactionState.vertexEditEnabled ||
        interactionState.tool !== tools.polygon ||
        interactionState.currentPolygon.length === 0;
    }
    buttons.vertexEdit?.classList.toggle("active", interactionState.vertexEditEnabled);
  }

  function setTool(tool) {
    closeCanvasLabelEditor();
    closeCanvasContextMenu();
    interactionState.tool = tool || null;
    interactionReset.clearShapeDrafts();
    interactionReset.stopDrawing();
    interactionReset.clearGeometryInteraction();
    clearVertexSelection();
    syncCanvasCursor();
    syncToolStripUI();
    redraw();
  }

  function cancelActiveShapePlacement(options = {}) {
    if (interactionState.vertexEditEnabled) return false;
    const hasDraftShape =
      interactionState.currentPolygon.length > 0 ||
      Boolean(interactionState.currentCurveControl) ||
      Boolean(interactionState.rectangleDraft) ||
      Boolean(interactionState.ellipseDraft);
    const hasActiveDrawTool = Object.values(tools).includes(interactionState.tool);
    if (!hasDraftShape && !hasActiveDrawTool) return false;

    interactionReset.clearShapeDrafts();
    interactionReset.stopDrawing();
    interactionReset.clearCursor();
    interactionReset.clearGeometryInteraction();
    clearVertexSelection();
    if (options.deactivateTool) interactionState.tool = null;
    syncCanvasCursor();
    syncToolStripUI();
    redraw();
    return true;
  }

  function selectDrawingTool(requestedTool) {
    if (!interactionState.vertexEditEnabled && interactionState.tool === requestedTool) {
      setTool(null);
      return;
    }
    if (interactionState.vertexEditEnabled) {
      interactionState.vertexEditEnabled = false;
      interactionReset.clearGeometryInteraction();
      clearVertexSelection();
    }
    setTool(requestedTool);
  }

  function toggleVertexEdit() {
    interactionState.vertexEditEnabled = !interactionState.vertexEditEnabled;
    interactionReset.clearGeometryInteraction();
    interactionReset.stopDrawing();
    if (!interactionState.vertexEditEnabled) clearVertexSelection();
    syncToolStripUI();
    redraw();
  }

  function bind() {
    drawingButtons.forEach((button) => {
      listen(button, "click", () => selectDrawingTool(toolByButton.get(button)));
    });
    listen(buttons.curveSegment, "click", () =>
      commandRegistry.execute(COMMANDS.CURVE_SEGMENT_TOGGLE)
    );
    listen(buttons.vertexEdit, "click", toggleVertexEdit);
    syncToolStripUI();
    return controller;
  }

  function destroy() {
    listenerLifecycle.clear();
  }

  const controller = {
    bind,
    destroy,
    setTool,
    cancelActiveShapePlacement,
    syncToolStripUI,
    selectDrawingTool,
    toggleVertexEdit,
  };
  return controller;
}
