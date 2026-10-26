import { COMMANDS } from "../commands/command-names.js";
import { createListenerLifecycle } from "../utils/listener-lifecycle.js";

/**
 * Owns the canvas Pointer Events lifecycle. Pointer capture keeps drag, edit,
 * marquee, and middle-button pan operations active outside the canvas.
 */
export function createPointerController(options) {
  const {
    canvas,
    canvasWrap,
    documentTarget,
    imageState,
    interactionState,
    tools,
    commandRegistry,
    view,
    redraw,
    applySnap,
    closeCanvasContextMenu,
    isCanvasContextMenuOpen,
    contextMenuContains,
    openCanvasContextMenu,
    closeCanvasLabelEditor,
    isCanvasLabelEditorOpen,
    getSelectionModeFromEvent,
    insertVertexOnNearestEdge,
    findVertexAtPoint,
    selectAnnotation,
    clearVertexSelection,
    beginVertexGeometryEdit,
    addVertexToSelection,
    removeVertexFromSelection,
    selectSingleVertex,
    findAnnotationAtPoint,
    startAnnotationDrag,
    canDragAnnotation = () => true,
    addPolygonPoint,
    startRectangle,
    startEllipse,
    updateRectangle,
    updateEllipse,
    updateActiveAnnotationDrag,
    updateActiveVertex,
    stopActiveAnnotationDrag,
    finalizeSelectionBox,
  } = options;

  const listenerLifecycle = createListenerLifecycle();
  const { listen } = listenerLifecycle;
  let activePointerId = null;

  function capturePointer(event) {
    activePointerId = event.pointerId;
    if (typeof canvas.setPointerCapture === "function") {
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // Capture is an enhancement; the document-level listener remains a fallback.
      }
    }
  }

  function releasePointer(event) {
    if (activePointerId == null) return;
    if (typeof canvas.hasPointerCapture === "function" && canvas.hasPointerCapture(activePointerId)) {
      canvas.releasePointerCapture(activePointerId);
    }
    activePointerId = null;
  }

  function handlePointerDown(event) {
    if (!imageState.image || event.button === 2) return;
    if (activePointerId != null && event.pointerId !== activePointerId) return;
    capturePointer(event);

    if (isCanvasContextMenuOpen()) closeCanvasContextMenu();
    if (isCanvasLabelEditorOpen()) closeCanvasLabelEditor({ commit: true });
    if (view.shouldStartPan(event)) {
      event.preventDefault();
      view.startPan(event);
      return;
    }

    if (interactionState.vertexEditEnabled) {
      const canvasPoint = view.getCanvasPoint(event);
      if (event.altKey) {
        insertVertexOnNearestEdge(canvasPoint);
        interactionState.isDrawing = false;
        return;
      }

      const selectionMode = getSelectionModeFromEvent(event);
      if (selectionMode !== "replace") {
        interactionState.activeVertex = null;
        interactionState.activeAnnotationDrag = null;
        interactionState.selectionMode = selectionMode;
        interactionState.selectionBox = { start: canvasPoint, end: canvasPoint };
        interactionState.isDrawing = true;
        redraw();
        return;
      }

      const vertexHit = findVertexAtPoint(canvasPoint);
      if (vertexHit) {
        if (vertexHit.ellipseIndex != null) {
          selectAnnotation({ type: "ellipse", index: vertexHit.ellipseIndex });
          clearVertexSelection();
          beginVertexGeometryEdit(vertexHit);
          return;
        }
        selectAnnotation(
          vertexHit.polygonIndex >= 0
            ? { type: "polygon", index: vertexHit.polygonIndex }
            : null
        );
        if (selectionMode === "add") {
          addVertexToSelection(vertexHit);
          interactionState.activeVertex = null;
        } else if (selectionMode === "subtract") {
          removeVertexFromSelection(vertexHit);
          interactionState.activeVertex = null;
        } else {
          selectSingleVertex(vertexHit);
          beginVertexGeometryEdit(vertexHit);
        }
        interactionState.selectionBox = null;
        interactionState.activeAnnotationDrag = null;
        interactionState.isDrawing = selectionMode === "replace";
        redraw();
        return;
      }

      interactionState.activeVertex = null;
      interactionState.activeAnnotationDrag = null;
      interactionState.selectionMode = selectionMode;
      if (selectionMode === "replace") {
        const annotationHit = findAnnotationAtPoint(canvasPoint);
        if (annotationHit && !canDragAnnotation(annotationHit)) {
          selectAnnotation(annotationHit);
          clearVertexSelection();
          interactionState.selectionBox = null;
          interactionState.isDrawing = false;
          redraw();
          return;
        }
        if (annotationHit && startAnnotationDrag(annotationHit, view.getImagePoint(event))) return;
        selectAnnotation(null);
        clearVertexSelection();
      }
      interactionState.selectionBox = { start: canvasPoint, end: canvasPoint };
      interactionState.isDrawing = true;
      redraw();
      return;
    }

    const imagePoint = view.getImagePoint(event);
    if (interactionState.tool === tools.polygon) addPolygonPoint(imagePoint);
    if (interactionState.tool === tools.rectangle) startRectangle(imagePoint);
    if (interactionState.tool === tools.ellipse) startEllipse(imagePoint);
  }

  function handleCanvasPointerMove(event) {
    if (!imageState.image) return;
    interactionState.cursorImagePos = view.getImagePoint(event);
    if (interactionState.tool === tools.rectangle && interactionState.rectangleDraft) {
      updateRectangle(applySnap(interactionState.cursorImagePos));
    } else if (interactionState.tool === tools.ellipse && interactionState.ellipseDraft) {
      updateEllipse(applySnap(interactionState.cursorImagePos));
    } else if (
      interactionState.tool === tools.polygon &&
      interactionState.currentPolygon.length > 0
    ) {
      redraw();
    }
  }

  function canContinuePolygon() {
    return Boolean(
      imageState.image &&
      interactionState.tool === tools.polygon &&
      interactionState.currentPolygon.length > 0 &&
      !interactionState.vertexEditEnabled &&
      !interactionState.panModeEnabled &&
      !interactionState.isPanning
    );
  }

  function handleWorkspacePointerMove(event) {
    if (event.target !== canvasWrap || !canContinuePolygon()) return;
    if (activePointerId != null && event.pointerId !== activePointerId) return;
    handleCanvasPointerMove(event);
  }

  function handleWorkspacePointerDown(event) {
    if (event.target !== canvasWrap || event.button !== 0 || !canContinuePolygon()) return;
    if (isCanvasLabelEditorOpen() || isCanvasContextMenuOpen()) return;
    handlePointerDown(event);
  }

  function handleCanvasPointerLeave(event) {
    if (activePointerId != null) return;
    if (canvasWrap && event.relatedTarget === canvasWrap && canContinuePolygon()) return;
    interactionState.cursorImagePos = null;
    if (interactionState.tool === tools.polygon && interactionState.currentPolygon.length > 0) {
      redraw();
    }
  }

  function handleDocumentPointerMove(event) {
    if (activePointerId != null && event.pointerId !== activePointerId) return;
    if ((interactionState.isDrawing || interactionState.isPanning) && event.buttons === 0) {
      handlePointerEnd(event);
      return;
    }
    if (!interactionState.isDrawing) {
      if (interactionState.isPanning) view.updatePan(event);
      return;
    }
    if (interactionState.isPanning) {
      view.updatePan(event);
      return;
    }
    if (!interactionState.vertexEditEnabled) return;
    if (interactionState.activeAnnotationDrag) {
      updateActiveAnnotationDrag(view.getImagePoint(event));
    } else if (interactionState.activeVertex) {
      updateActiveVertex(view.getImagePoint(event));
    } else if (interactionState.selectionBox) {
      interactionState.selectionBox.end = view.getCanvasPoint(event);
      redraw();
    }
  }

  function handlePointerEnd(event = {}) {
    if (activePointerId != null && event.pointerId != null && event.pointerId !== activePointerId) {
      return;
    }
    if (interactionState.isPanning) {
      view.stopPan();
    } else if (interactionState.isDrawing && interactionState.vertexEditEnabled) {
      if (interactionState.activeAnnotationDrag) {
        stopActiveAnnotationDrag();
      } else if (interactionState.activeVertex) {
        commandRegistry.execute(COMMANDS.ANNOTATION_GEOMETRY_EDIT_END, { kind: "vertex" });
      } else {
        if (interactionState.selectionBox) {
          finalizeSelectionBox();
          redraw();
        }
        interactionState.isDrawing = false;
      }
    }
    releasePointer(event);
  }

  function handleContextMenu(event) {
    event.preventDefault();
    if (!imageState.image) return;
    if (isCanvasLabelEditorOpen()) closeCanvasLabelEditor({ commit: true });
    openCanvasContextMenu(event.clientX, event.clientY);
  }

  function handleOutsidePointerDown(event) {
    if (!isCanvasContextMenuOpen() || contextMenuContains(event.target)) return;
    closeCanvasContextMenu();
  }

  function preventMiddleAuxClick(event) {
    if (event.button === 1) event.preventDefault();
  }

  function bind() {
    listen(canvas, "pointerdown", handlePointerDown);
    listen(canvas, "pointermove", handleCanvasPointerMove);
    listen(canvas, "pointerleave", handleCanvasPointerLeave);
    listen(canvas, "contextmenu", handleContextMenu);
    listen(canvas, "auxclick", preventMiddleAuxClick);
    listen(canvasWrap, "pointermove", handleWorkspacePointerMove);
    listen(canvasWrap, "pointerdown", handleWorkspacePointerDown);
    listen(canvasWrap, "pointerleave", handleCanvasPointerLeave);
    listen(documentTarget, "pointermove", handleDocumentPointerMove);
    listen(documentTarget, "pointerup", handlePointerEnd);
    listen(documentTarget, "pointercancel", handlePointerEnd);
    listen(documentTarget, "pointerdown", handleOutsidePointerDown);
    return controller;
  }

  function destroy() {
    listenerLifecycle.clear();
    releasePointer({});
  }

  const controller = {
    bind,
    destroy,
    handlePointerDown,
    handleCanvasPointerMove,
    handleDocumentPointerMove,
    handlePointerEnd,
  };
  return controller;
}
