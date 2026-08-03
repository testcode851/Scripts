import { clamp } from "../geometry/math.js";

/** Own canvas context-menu rendering, positioning, and delegated actions. */
export function createCanvasContextMenu({
  documentRoot,
  elements,
  imageState,
  annotationState,
  interactionState,
  history,
  tools,
  normalizeSelectedAnnotation,
  getSelectedAnnotation,
  commandRegistry,
}) {
  const { canvasContextMenu, canvasWrap } = elements;
  const ElementType = documentRoot?.defaultView?.Element;
  const ButtonType = documentRoot?.defaultView?.HTMLButtonElement;
  const isElement = (value) => typeof ElementType === "function" && value instanceof ElementType;
  const isButton = (value) => typeof ButtonType === "function" && value instanceof ButtonType;
  let bound = false;

  function hide() {
    if (!canvasContextMenu) return;
    canvasContextMenu.setAttribute("hidden", "");
    canvasContextMenu.setAttribute("aria-hidden", "true");
  }

  const close = hide;
  const isOpen = () =>
    Boolean(canvasContextMenu && !canvasContextMenu.hasAttribute("hidden"));
  const contains = (target) =>
    Boolean(canvasContextMenu && isElement(target) && canvasContextMenu.contains(target));

  function setItemEnabled(action, enabled) {
    const item = canvasContextMenu?.querySelector(`[data-action="${action}"]`);
    if (isButton(item)) item.disabled = !enabled;
  }

  function updateState() {
    if (!canvasContextMenu) return;
    normalizeSelectedAnnotation();
    const hasImage = Boolean(imageState.image);
    const selectedAnnotation = getSelectedAnnotation();
    const hasAnnotations = annotationState.annotations.length > 0;
    const hasSelectedAnnotation = Boolean(selectedAnnotation);
    const hasSelectedLabelableAnnotation =
      selectedAnnotation &&
      (selectedAnnotation.type === "polygon" || selectedAnnotation.type === "ellipse");
    const canDeleteVertices =
      interactionState.vertexEditEnabled && interactionState.selectedVertexKeys.size > 0;
    const canToggleCurveSegment =
      hasImage &&
      !interactionState.vertexEditEnabled &&
      interactionState.tool === tools.polygon &&
      interactionState.currentPolygon.length > 0;
    const hasDraftShapes =
      interactionState.currentPolygon.length > 0 ||
      Boolean(interactionState.currentCurveControl) ||
      Boolean(interactionState.ellipseDraft) ||
      Boolean(interactionState.rectangleDraft);

    setItemEnabled("tool-polygon", hasImage);
    setItemEnabled("curve-segment-toggle", canToggleCurveSegment);
    setItemEnabled("tool-rectangle", hasImage);
    setItemEnabled("tool-ellipse", hasImage);
    setItemEnabled("vertex-edit-toggle", hasImage);
    setItemEnabled("rename-selected", Boolean(hasSelectedLabelableAnnotation));
    setItemEnabled("duplicate-selected", hasSelectedAnnotation);
    setItemEnabled("delete-selected-annotation", hasSelectedAnnotation);
    setItemEnabled("delete-selected-vertices", canDeleteVertices);
    setItemEnabled("cancel-drawing", hasDraftShapes);
    setItemEnabled("clear-all", hasAnnotations || hasDraftShapes);
    setItemEnabled("undo", history.canUndo);
    setItemEnabled("redo", history.canRedo);
    setItemEnabled("zoom-in", hasImage);
    setItemEnabled("zoom-out", hasImage);
    setItemEnabled("zoom-reset", hasImage);

    const editLabel = canvasContextMenu
      .querySelector('[data-action="vertex-edit-toggle"]')
      ?.querySelector("span");
    if (editLabel) {
      editLabel.textContent = interactionState.vertexEditEnabled
        ? "Exit Edit Mode"
        : "Edit Vertices";
    }
    const curveLabel = canvasContextMenu
      .querySelector('[data-action="curve-segment-toggle"]')
      ?.querySelector("span");
    if (curveLabel) {
      curveLabel.textContent = interactionState.curveSegmentMode
        ? "Cancel Curve Edge"
        : "Curve Next Edge";
    }
  }

  function open(clientX, clientY) {
    if (!canvasContextMenu || !canvasWrap) return;
    updateState();
    canvasContextMenu.removeAttribute("hidden");
    canvasContextMenu.setAttribute("aria-hidden", "false");

    const wrapRect = canvasWrap.getBoundingClientRect();
    const minInset = 6;
    const menuWidth = canvasContextMenu.offsetWidth || 280;
    const menuHeight = canvasContextMenu.offsetHeight || 360;
    const maxLeft = canvasWrap.clientWidth - menuWidth - minInset;
    const maxTop = canvasWrap.clientHeight - menuHeight - minInset;
    const left = clamp(
      clientX - wrapRect.left,
      minInset,
      Math.max(minInset, maxLeft)
    );
    const top = clamp(
      clientY - wrapRect.top,
      minInset,
      Math.max(minInset, maxTop)
    );
    canvasContextMenu.style.left = `${Math.round(left)}px`;
    canvasContextMenu.style.top = `${Math.round(top)}px`;
  }

  function bind() {
    if (bound || !canvasContextMenu) return;
    bound = true;
    canvasContextMenu.addEventListener("contextmenu", (event) => {
      event.preventDefault();
    });
    canvasContextMenu.addEventListener("click", (event) => {
      if (!isElement(event.target)) return;
      const menuItem = event.target.closest("[data-action]");
      if (!isButton(menuItem) || menuItem.disabled) return;
      close();
      commandRegistry.execute(menuItem.dataset.action || "");
    });
  }

  return Object.freeze({
    bind,
    close,
    contains,
    hide,
    isOpen,
    open,
    updateState,
  });
}
