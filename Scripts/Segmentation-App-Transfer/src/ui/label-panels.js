import { rgbToCss } from "../utils/colors.js";

/** Own label-summary and shape-list DOM rendering and delegated list events. */
export function createLabelPanels({
  documentRoot,
  elements,
  annotationState,
  interactionState,
  renderInvalidation,
  normalizeLabels,
  normalizeSelectedAnnotation,
  getSelectedAnnotation,
  getAnnotationReference,
  getAnnotationSequence,
  getColorForLabel,
  getAnnotationColor,
  getAnnotationColorHex,
  getAnnotationLabel,
  isAnnotationSelected,
  isLabelEditorOpen,
  closeLabelEditor,
  selectAnnotation,
  clearVertexSelection,
  redraw,
  renameAnnotationLabel,
}) {
  const {
    labelListUnique,
    labelListCount,
    polygonLabelList,
    selectedShapeColorInput,
  } = elements;
  const ElementType = documentRoot?.defaultView?.Element;
  const isElement = (value) => typeof ElementType === "function" && value instanceof ElementType;
  let bound = false;

  function render() {
    if (!labelListUnique || !polygonLabelList || !labelListCount) return;
    normalizeLabels();
    const nextRenderKey = JSON.stringify({
      annotations: annotationState.annotations.map(({ id, type, label, color }) => ({
        id,
        type,
        label,
        color,
      })),
      selectedAnnotationId: interactionState.selectedAnnotationId,
    });
    if (!renderInvalidation.hasChanged("label-panels", nextRenderKey)) return;

    labelListCount.textContent = String(annotationState.annotations.length);
    const labelCountMap = new Map();
    annotationState.annotations.forEach(({ label }) => {
      labelCountMap.set(label, (labelCountMap.get(label) || 0) + 1);
    });
    const uniqueItems = [...labelCountMap.entries()].sort((left, right) => {
      const byCount = right[1] - left[1];
      return byCount !== 0 ? byCount : left[0].localeCompare(right[0]);
    });
    const uniqueFragment = documentRoot.createDocumentFragment();
    if (uniqueItems.length === 0) {
      const emptyItem = documentRoot.createElement("li");
      emptyItem.className = "label-list-item label-list-item--unique";
      const text = documentRoot.createElement("span");
      text.className = "label-list-item-label";
      text.textContent = "No labels yet";
      emptyItem.append(text);
      uniqueFragment.append(emptyItem);
    } else {
      uniqueItems.forEach(([label, count]) => {
        const item = documentRoot.createElement("li");
        item.className = "label-list-item label-list-item--unique";
        const labelSpan = documentRoot.createElement("span");
        labelSpan.className = "label-list-item-label";
        const swatch = documentRoot.createElement("span");
        swatch.className = "label-list-item-swatch";
        swatch.style.backgroundColor = rgbToCss(getColorForLabel(label));
        const text = documentRoot.createElement("span");
        text.textContent = label;
        labelSpan.append(swatch, text);
        const countSpan = documentRoot.createElement("span");
        countSpan.className = "label-list-item-meta";
        countSpan.textContent = count === 1 ? "1 shape" : `${count} shapes`;
        item.append(labelSpan, countSpan);
        uniqueFragment.append(item);
      });
    }
    labelListUnique.replaceChildren(uniqueFragment);

    if (selectedShapeColorInput) {
      normalizeSelectedAnnotation();
      const selected = getSelectedAnnotation();
      if (selected) {
        const reference = getAnnotationReference(selected);
        selectedShapeColorInput.disabled = false;
        selectedShapeColorInput.value = getAnnotationColorHex(
          reference.type,
          reference.index
        );
      } else {
        selectedShapeColorInput.disabled = true;
        selectedShapeColorInput.value = "#22c55e";
      }
    }

    const shapeFragment = documentRoot.createDocumentFragment();
    const annotationEntries = getAnnotationSequence();
    if (annotationEntries.length === 0) {
      const emptyItem = documentRoot.createElement("li");
      emptyItem.className = "label-list-item label-list-item--unique";
      const text = documentRoot.createElement("span");
      text.className = "label-list-item-label";
      text.textContent = "No shapes yet";
      emptyItem.append(text);
      shapeFragment.append(emptyItem);
    } else {
      annotationEntries.forEach((entry) => {
        const item = documentRoot.createElement("li");
        const button = documentRoot.createElement("button");
        button.type = "button";
        button.className = "label-list-item label-list-item--polygon";
        button.dataset.annotationId = entry.id;
        button.dataset.annotationType = entry.type;
        button.dataset.annotationIndex = String(entry.index);
        if (isAnnotationSelected(entry.type, entry.index)) {
          button.classList.add("is-selected");
        }
        const labelSpan = documentRoot.createElement("span");
        labelSpan.className = "label-list-item-label";
        const swatch = documentRoot.createElement("span");
        swatch.className = "label-list-item-swatch";
        swatch.style.backgroundColor = rgbToCss(
          getAnnotationColor(entry.type, entry.index)
        );
        const text = documentRoot.createElement("span");
        text.textContent = getAnnotationLabel(entry.type, entry.index);
        labelSpan.append(swatch, text);
        const indexSpan = documentRoot.createElement("span");
        indexSpan.className = "label-list-item-meta";
        indexSpan.textContent = `${entry.type === "ellipse" ? "E" : "P"}#${entry.index + 1}`;
        button.append(labelSpan, indexSpan);
        item.append(button);
        shapeFragment.append(item);
      });
    }
    polygonLabelList.replaceChildren(shapeFragment);
  }

  function getListTarget(event) {
    if (!isElement(event.target)) return null;
    return event.target.closest("[data-annotation-index]");
  }

  function bind() {
    if (bound || !polygonLabelList) return;
    bound = true;
    polygonLabelList.addEventListener("click", (event) => {
      if (isLabelEditorOpen()) closeLabelEditor({ commit: true });
      const target = getListTarget(event);
      if (!target) return;
      const type = target.dataset.annotationType === "ellipse" ? "ellipse" : "polygon";
      const index = Number(target.dataset.annotationIndex);
      const maxIndex = annotationState.annotations.filter(
        (annotation) => annotation.type === type
      ).length;
      if (!Number.isInteger(index) || index < 0 || index >= maxIndex) return;
      selectAnnotation({ type, index });
      interactionState.activeVertex = null;
      clearVertexSelection();
      redraw();
    });
    polygonLabelList.addEventListener("dblclick", (event) => {
      const target = getListTarget(event);
      if (!target) return;
      const type = target.dataset.annotationType === "ellipse" ? "ellipse" : "polygon";
      renameAnnotationLabel({
        type,
        index: Number(target.dataset.annotationIndex),
      });
    });
  }

  return Object.freeze({ bind, render });
}
