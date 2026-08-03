import { clamp } from "../geometry/math.js";
import {
  getAnnotationAtTypeIndex,
  getAnnotationById,
} from "../model/annotation.js";
import { rememberAnnotationLabel } from "../model/annotation-labels.js";
import { COMMANDS } from "../commands/command-names.js";

/** Own the in-canvas label editor DOM, positioning, suggestions, and focus. */
export function createCanvasLabelEditor({
  documentRoot,
  elements,
  imageState,
  annotationState,
  uiState,
  commandRegistry,
  sanitizeLabel,
  getKnownLabels,
  getAnnotationLabel,
  getAnnotationAnchorPoint,
  getRememberedLabel,
  normalizeLabels,
  closeContextMenu,
  scalePoint,
  redraw,
  renderLabelPanels,
  requestFrame = requestAnimationFrame,
}) {
  const {
    canvas,
    canvasWrap,
    canvasLabelEditor,
    canvasLabelEditorTitle,
    canvasLabelEditorInput,
    canvasLabelEditorSuggestions,
    canvasLabelEditorOk,
    canvasLabelEditorCancel,
  } = elements;
  const ElementType = documentRoot?.defaultView?.Element;
  const isElement = (value) => typeof ElementType === "function" && value instanceof ElementType;
  let bound = false;

  function hide() {
    if (!canvasLabelEditor) return;
    canvasLabelEditor.setAttribute("hidden", "");
    canvasLabelEditor.setAttribute("aria-hidden", "true");
  }

  const isOpen = () =>
    Boolean(canvasLabelEditor && !canvasLabelEditor.hasAttribute("hidden"));

  function renderSuggestions(activeLabel = "") {
    if (!canvasLabelEditorSuggestions) return;
    const safeActiveLabel = sanitizeLabel(activeLabel || "");
    const knownLabels = getKnownLabels();
    if (knownLabels.length === 0) {
      const empty = documentRoot.createElement("li");
      empty.className = "canvas-label-editor-suggestion-empty";
      empty.textContent = "No existing labels yet";
      canvasLabelEditorSuggestions.replaceChildren(empty);
      return;
    }

    const fragment = documentRoot.createDocumentFragment();
    knownLabels.forEach((label) => {
      const item = documentRoot.createElement("li");
      const button = documentRoot.createElement("button");
      button.type = "button";
      button.className = "canvas-label-editor-suggestion";
      button.dataset.label = label;
      button.textContent = label;
      if (label === safeActiveLabel) button.classList.add("is-match");
      item.append(button);
      fragment.append(item);
    });
    canvasLabelEditorSuggestions.replaceChildren(fragment);
  }

  function position(anchorImagePoint) {
    if (!canvasLabelEditor || !canvasWrap || !imageState.imageSize) return;
    const fallbackImagePoint = {
      x: imageState.imageSize.width / 2,
      y: imageState.imageSize.height / 2,
    };
    const canvasPoint = scalePoint(anchorImagePoint || fallbackImagePoint);
    const wrapRect = canvasWrap.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const minInset = 8;
    const panelWidth = canvasLabelEditor.offsetWidth || 240;
    const panelHeight = canvasLabelEditor.offsetHeight || 104;
    const maxLeft = canvasWrap.clientWidth - panelWidth - minInset;
    const maxTop = canvasWrap.clientHeight - panelHeight - minInset;
    const left = clamp(
      canvasRect.left - wrapRect.left + canvasPoint.x + 12,
      minInset,
      Math.max(minInset, maxLeft)
    );
    const top = clamp(
      canvasRect.top - wrapRect.top + canvasPoint.y + 12,
      minInset,
      Math.max(minInset, maxTop)
    );
    canvasLabelEditor.style.left = `${Math.round(left)}px`;
    canvasLabelEditor.style.top = `${Math.round(top)}px`;
  }

  function open(options) {
    if (!canvasLabelEditor || !canvasLabelEditorInput) return false;
    closeContextMenu();
    const annotationType = options?.annotationType === "ellipse" ? "ellipse" : "polygon";
    const annotationIndex = Number(options?.annotationIndex ?? options?.polygonIndex);
    const annotation = getAnnotationAtTypeIndex(
      annotationState.annotations,
      annotationType,
      annotationIndex
    );
    if (!annotation) return false;

    const reason = options?.reason === "rename" ? "rename" : "creation";
    const anchorImagePoint =
      options?.anchorImagePoint ||
      getAnnotationAnchorPoint(annotationType, annotationIndex);
    const currentLabel = getAnnotationLabel(annotationType, annotationIndex);
    const fallbackLabel = sanitizeLabel(
      options?.initialLabel ||
        currentLabel ||
        getRememberedLabel(annotationType)
    );
    uiState.activeLabelEdit = {
      annotationId: annotation.id,
      annotationType,
      annotationIndex,
      reason,
      anchorImagePoint,
    };
    if (canvasLabelEditorTitle) {
      const noun = annotationType === "ellipse" ? "Ellipse" : "Polygon";
      canvasLabelEditorTitle.textContent =
        reason === "creation"
          ? `${noun} label`
          : `Rename ${noun.toLowerCase()} label`;
    }
    canvasLabelEditorInput.value = fallbackLabel;
    renderSuggestions(fallbackLabel);
    canvasLabelEditor.removeAttribute("hidden");
    canvasLabelEditor.setAttribute("aria-hidden", "false");
    position(anchorImagePoint);
    requestFrame(() => {
      canvasLabelEditorInput.focus();
      canvasLabelEditorInput.select();
    });
    return true;
  }

  function close(options = {}) {
    if (!canvasLabelEditor) {
      uiState.activeLabelEdit = null;
      return false;
    }
    const commit = Boolean(options.commit);
    let labelChanged = false;
    let creationCancelled = false;
    const edit = uiState.activeLabelEdit;
    const isCreationEdit = Boolean(edit && edit.reason === "creation");
    if (commit && edit) {
      normalizeLabels();
      const annotation = edit.annotationId
        ? getAnnotationById(annotationState.annotations, edit.annotationId)
        : null;
      if (!annotation) {
        uiState.activeLabelEdit = null;
        hide();
        return false;
      }
      const nextLabel = sanitizeLabel(canvasLabelEditorInput?.value);
      if (nextLabel !== annotation.label) {
        const commandName =
          edit.reason === "rename"
            ? COMMANDS.ANNOTATION_RENAME
            : COMMANDS.ANNOTATION_RENAME_CREATED;
        labelChanged = commandRegistry.execute(commandName, {
          annotationId: annotation.id,
          label: nextLabel,
        });
      }
      if (!labelChanged) {
        rememberAnnotationLabel(annotationState, annotation.type, nextLabel);
      }
    } else if (isCreationEdit) {
      creationCancelled = commandRegistry.execute(COMMANDS.ANNOTATION_CANCEL_CREATED, {
        annotationId: edit.annotationId,
      });
    }
    uiState.activeLabelEdit = null;
    hide();
    if (labelChanged || isCreationEdit) redraw();
    else renderLabelPanels();
    return labelChanged || creationCancelled;
  }

  function bind() {
    if (bound) return;
    bound = true;
    canvasLabelEditorOk?.addEventListener("click", () => close({ commit: true }));
    canvasLabelEditorCancel?.addEventListener("click", () => close());
    canvasLabelEditorInput?.addEventListener("input", (event) => {
      const value =
        event && event.target && "value" in event.target
          ? String(event.target.value)
          : canvasLabelEditorInput.value;
      renderSuggestions(value);
    });
    canvasLabelEditorInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        close({ commit: true });
      } else if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    });
    canvasLabelEditorSuggestions?.addEventListener("click", (event) => {
      if (!isElement(event.target)) return;
      const button = event.target.closest("[data-label]");
      if (!button) return;
      canvasLabelEditorInput.value = sanitizeLabel(button.getAttribute("data-label"));
      close({ commit: true });
    });
  }

  return Object.freeze({
    bind,
    close,
    hide,
    isOpen,
    open,
    position,
    renderSuggestions,
  });
}
