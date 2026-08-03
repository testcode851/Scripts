import { COMMANDS } from "../commands/command-names.js";

/** Owns global shortcut precedence and command dispatch. */
export function createKeyboardController(options) {
  const {
    target,
    interactionState,
    commandRegistry,
    isEditableTarget,
    isNewImageConfirmModalOpen,
    cancelPendingImageLoad,
    handleNewImageModalTab,
    isShortcutsModalOpen,
    openShortcutsModal,
    closeShortcutsModal,
    handleShortcutsModalTab,
    isCanvasLabelEditorOpen,
    closeCanvasLabelEditor,
    isCanvasContextMenuOpen,
    closeCanvasContextMenu,
    cancelActiveShapePlacement,
    closeFloatingDialogs,
    cycleAnnotationSelection,
    polygonTool,
  } = options;

  function handleKeyDown(event) {
    const isFormField = isEditableTarget(event.target);
    const isQuestionShortcut = event.key === "?" || (event.key === "/" && event.shiftKey);

    if (isNewImageConfirmModalOpen()) {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelPendingImageLoad();
      } else if (event.key === "Tab") {
        handleNewImageModalTab(event);
      }
      return;
    }

    if (isQuestionShortcut && (!isFormField || isShortcutsModalOpen())) {
      event.preventDefault();
      if (isShortcutsModalOpen()) closeShortcutsModal();
      else openShortcutsModal();
      return;
    }

    if (isCanvasLabelEditorOpen() && event.key === "Escape") {
      event.preventDefault();
      closeCanvasLabelEditor();
      return;
    }

    if (isCanvasContextMenuOpen() && event.key === "Escape") {
      event.preventDefault();
      closeCanvasContextMenu();
      return;
    }

    if (isShortcutsModalOpen()) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeShortcutsModal();
      } else if (event.key === "Tab") {
        handleShortcutsModalTab(event);
      }
      return;
    }

    if (event.key === "Escape" && cancelActiveShapePlacement({ deactivateTool: false })) {
      event.preventDefault();
      return;
    }

    if (event.key === "Escape") {
      closeFloatingDialogs();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        commandRegistry.execute(event.shiftKey ? COMMANDS.REDO : COMMANDS.UNDO);
        return;
      }
      if (key === "y") {
        event.preventDefault();
        commandRegistry.execute(COMMANDS.REDO);
        return;
      }
      if (key === "d" && !event.shiftKey && !isFormField) {
        event.preventDefault();
        commandRegistry.execute(COMMANDS.ANNOTATION_DUPLICATE);
        return;
      }
    }

    if (event.key === "Tab" && !isFormField) {
      event.preventDefault();
      cycleAnnotationSelection(event.shiftKey ? -1 : 1);
      return;
    }

    if (
      event.key.toLowerCase() === "c" &&
      !isFormField &&
      !interactionState.vertexEditEnabled &&
      interactionState.tool === polygonTool &&
      interactionState.currentPolygon.length > 0
    ) {
      event.preventDefault();
      commandRegistry.execute(COMMANDS.CURVE_SEGMENT_TOGGLE);
      return;
    }

    if ((event.key === "Delete" || event.key === "Backspace") && !isFormField) {
      event.preventDefault();
      const command =
        interactionState.vertexEditEnabled && interactionState.selectedVertexKeys.size > 0
          ? COMMANDS.ANNOTATION_DELETE_VERTICES
          : COMMANDS.ANNOTATION_DELETE;
      commandRegistry.execute(command);
    }
  }

  function bind() {
    target.addEventListener("keydown", handleKeyDown);
    return controller;
  }

  function destroy() {
    target.removeEventListener("keydown", handleKeyDown);
  }

  const controller = { bind, destroy, handleKeyDown };
  return controller;
}
