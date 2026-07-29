import { COMMANDS } from "../commands/command-names.js";

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

  const listeners = [];
  const drawingButtons = [buttons.polygon, buttons.rectangle, buttons.ellipse].filter(Boolean);
  const toolByButton = new Map([
    [buttons.polygon, tools.polygon],
    [buttons.rectangle, tools.rectangle],
    [buttons.ellipse, tools.ellipse],
  ]);

  function listen(target, type, handler) {
    if (!target) return;
    target.addEventListener(type, handler);
    listeners.push(() => target.removeEventListener(type, handler));
  }

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

  function resetTransientInteraction() {
    interactionState.activeVertex = null;
    interactionState.activeAnnotationDrag = null;
    interactionState.selectionBox = null;
  }

  function setTool(tool) {
    closeCanvasLabelEditor();
    closeCanvasContextMenu();
    interactionState.tool = tool || null;
    interactionState.currentPolygon = [];
    interactionState.currentCurveControl = null;
    interactionState.curveSegmentMode = false;
    interactionState.ellipseDraft = null;
    interactionState.rectangleDraft = null;
    interactionState.isDrawing = false;
    resetTransientInteraction();
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

    interactionState.currentPolygon = [];
    interactionState.currentCurveControl = null;
    interactionState.curveSegmentMode = false;
    interactionState.rectangleDraft = null;
    interactionState.ellipseDraft = null;
    interactionState.isDrawing = false;
    interactionState.cursorImagePos = null;
    resetTransientInteraction();
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
      resetTransientInteraction();
      clearVertexSelection();
    }
    setTool(requestedTool);
  }

  function toggleVertexEdit() {
    interactionState.vertexEditEnabled = !interactionState.vertexEditEnabled;
    resetTransientInteraction();
    interactionState.isDrawing = false;
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
    listeners.splice(0).forEach((remove) => remove());
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
