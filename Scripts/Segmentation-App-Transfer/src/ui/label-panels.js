import { rgbToCss } from "../utils/colors.js";
import { getReviewStatus } from "../model/annotation-review.js";

/** Own focused class controls, shape-list rendering, and delegated list events. */
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
  isLabelEditorOpen,
  closeLabelEditor,
  selectAnnotation,
  clearVertexSelection,
  redraw,
  renameAnnotationLabel,
  getClassWorkflow = () => null,
  onChooseClass = () => {},
  onToggleChecked = () => {},
  onClearChecked = () => {},
  onAssignClass = () => {},
  onClearSelection = () => {},
  getInspection = () => null,
  onFilterClass = () => {},
  onSetEditorState = () => {},
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
  const shapeButtons = new Map();
  const shapeChecks = new Map();
  const shapeRows = new Map();
  const inspectionElements = Object.fromEntries([
    "annotationClassFilter", "selectedShapePanel", "selectedShapeTitle", "clearShapeSelection",
    "selectedShapeInspection", "selectedShapeVisible", "selectedShapeClassRow", "selectedShapeClass", "renameSelectedPolygon",
    "noShapeSelected",
    "selectedShapeLocked", "selectedShapeReviewStatus", "shapeInspectionMessage",
  ].map(id => [id, elements[id] || documentRoot?.getElementById?.(id)]));
  let renderedFilter;
  let filterLabels = [];
  let renderedFilterOptions = "";
  const classElements = Object.fromEntries([
    "classWorkflowControls", "selectMultipleShapes", "batchClassSelect", "checkedShapeCount",
    "classAssignmentControls", "assignClassToSelected", "clearClassChecks",
    "classAssignmentMessage",
  ].map(id => [id, elements[id] || documentRoot?.getElementById?.(id)]));
  let renderedSelectionId;
  let renderedCheckedIds = new Set();
  let multipleSelection = false;
  let renderedMultipleSelection;
  let batchClassId = "";
  let renderedSelectedClassOptions = "";

  function setProperty(element, property, value) {
    if (element && element[property] !== value) element[property] = value;
  }

  function createOption(value, text) {
    const option = documentRoot.createElement("option");
    option.value = value;
    option.textContent = text;
    return option;
  }

  function findClass(workflow, value) {
    return value !== "" && workflow?.enabled
      ? workflow.classes.find(entry => String(entry.id) === value) || null : null;
  }

  function refreshClassControls(workflow = getClassWorkflow()) {
    const enabled = Boolean(workflow?.enabled);
    if (!enabled && multipleSelection) {
      multipleSelection = false;
      onClearChecked();
    }
    setProperty(classElements.classWorkflowControls, "hidden", false);
    setProperty(labelListUnique, "disabled", !enabled);
    setProperty(classElements.selectMultipleShapes, "hidden", !enabled);
    setProperty(classElements.selectMultipleShapes, "disabled", !enabled || (!multipleSelection && annotationState.annotations.length === 0));
    setProperty(classElements.selectMultipleShapes, "textContent", multipleSelection ? "Done" : "Select multiple");
    for (const attribute of ["aria-expanded", "aria-pressed"]) {
      if (classElements.selectMultipleShapes?.getAttribute(attribute) !== String(multipleSelection)) {
        classElements.selectMultipleShapes?.setAttribute(attribute, String(multipleSelection));
      }
    }
    setProperty(classElements.classAssignmentControls, "hidden", !multipleSelection);
    if (renderedMultipleSelection !== multipleSelection) {
      for (const check of shapeChecks.values()) setProperty(check, "hidden", !multipleSelection);
      renderedMultipleSelection = multipleSelection;
    }
    const active = enabled ? workflow.activeClass : null;
    setProperty(labelListUnique, "value", active ? String(active.id) : "");
    const checkedIds = enabled ? workflow.checkedIds || new Set() : new Set();
    for (const id of renderedCheckedIds) {
      if (!checkedIds.has(id)) setProperty(shapeChecks.get(id), "checked", false);
    }
    for (const id of checkedIds) {
      if (!renderedCheckedIds.has(id)) setProperty(shapeChecks.get(id), "checked", true);
    }
    renderedCheckedIds = new Set(checkedIds);
    if (!findClass(workflow, batchClassId)) batchClassId = "";
    setProperty(classElements.batchClassSelect, "value", batchClassId);
    setProperty(classElements.batchClassSelect, "disabled", !multipleSelection || !enabled || workflow.classes.length === 0);
    const canAssign = multipleSelection && checkedIds.size > 0 && batchClassId !== "" && workflow?.canAssignTargets;
    setProperty(classElements.assignClassToSelected, "disabled", !canAssign);
    setProperty(classElements.checkedShapeCount, "textContent", `${checkedIds.size} selected`);
    setProperty(classElements.clearClassChecks, "disabled", checkedIds.size === 0);
    const message = multipleSelection
      ? workflow?.assignmentMessage || (checkedIds.size === 0 ? "Select shapes to assign a class." : batchClassId === "" ? "Choose a class to assign." : "")
      : "";
    setProperty(classElements.classAssignmentMessage, "textContent", message);
    setProperty(classElements.classAssignmentMessage, "hidden", !message);
  }

  function renderSelectedColor() {
    if (!selectedShapeColorInput) return;
    normalizeSelectedAnnotation();
    const selected = getSelectedAnnotation();
    if (selected) {
      const reference = getAnnotationReference(selected);
      selectedShapeColorInput.disabled = false;
      selectedShapeColorInput.value = getAnnotationColorHex(
        reference.type,
        reference.index,
        selected
      );
      const inspection = getInspection();
      if (inspection?.canEditSelected === false || inspection?.canChange === false) selectedShapeColorInput.disabled = true;
    } else {
      selectedShapeColorInput.disabled = true;
      selectedShapeColorInput.value = "#22c55e";
    }
  }

  function refreshInspectionControls(workflow = getClassWorkflow()) {
    const inspection = getInspection();
    if (!inspection) return;
    const filter = inspection.filter ?? null;
    const labels = filter !== null && !filterLabels.includes(filter) ? [...filterLabels, filter] : filterLabels;
    const key = JSON.stringify(labels);
    const select = inspectionElements.annotationClassFilter;
    if (select && key !== renderedFilterOptions) {
      const options = [null, ...labels].map(label => {
        const option = documentRoot.createElement("option");
        option.value = label ?? "";
        option.textContent = label ?? "All classes";
        return option;
      });
      select.replaceChildren(...options);
      renderedFilterOptions = key;
    }
    setProperty(select, "value", filter ?? "");
    if (filter !== renderedFilter) {
      for (const { row, label } of shapeRows.values()) setProperty(row, "hidden", filter !== null && label !== filter);
      renderedFilter = filter;
    }
    const selected = inspection.selected;
    setProperty(inspectionElements.selectedShapePanel, "hidden", !selected || multipleSelection);
    setProperty(inspectionElements.noShapeSelected, "hidden", Boolean(selected) || multipleSelection);
    if (selected && inspectionElements.selectedShapeTitle) {
      const selectedButton = shapeButtons.get(selected.id);
      const reference = selectedButton ? {
        type: selectedButton.dataset.annotationType,
        index: Number(selectedButton.dataset.annotationIndex),
      } : getAnnotationReference(selected);
      setProperty(inspectionElements.selectedShapeTitle, "textContent",
        `Selected shape · ${reference.type === "ellipse" ? "E" : "P"}#${reference.index + 1}`);
    }
    setProperty(inspectionElements.selectedShapeInspection, "disabled", !selected || !inspection.canChange);
    setProperty(inspectionElements.clearShapeSelection, "disabled", !selected || !inspection.canChange);
    setProperty(inspectionElements.renameSelectedPolygon, "disabled", !selected || !inspection.canChange || inspection.canEditSelected === false);
    setProperty(inspectionElements.selectedShapeVisible, "checked", Boolean(selected && !selected.editor?.hidden));
    setProperty(inspectionElements.selectedShapeLocked, "checked", Boolean(selected?.editor?.locked));
    setProperty(inspectionElements.selectedShapeReviewStatus, "value", getReviewStatus(selected));
    setProperty(inspectionElements.shapeInspectionMessage, "textContent", inspection.message || "");
    setProperty(inspectionElements.shapeInspectionMessage, "hidden", !inspection.message);
    const classes = workflow?.enabled ? workflow.classes : [];
    setProperty(inspectionElements.selectedShapeClassRow, "hidden", !workflow?.enabled);
    const classSelect = inspectionElements.selectedShapeClass;
    if (classSelect) {
      const selectedClass = selected && classes.find(entry => entry.name === selected.label);
      const optionsKey = JSON.stringify([classes, selectedClass ? null : selected?.label]);
      if (optionsKey !== renderedSelectedClassOptions) {
        const options = classes.map(entry => createOption(String(entry.id), entry.name));
        if (!selectedClass) options.unshift(createOption("", selected ? `${selected.label} (custom label)` : "Choose a class"));
        classSelect.replaceChildren(...options);
        renderedSelectedClassOptions = optionsKey;
      }
      setProperty(classSelect, "value", selectedClass ? String(selectedClass.id) : "");
      setProperty(classSelect, "disabled", !selected || !inspection.canChange || inspection.canEditSelected === false || !workflow?.enabled);
    }
    setProperty(selectedShapeColorInput, "disabled", !selected || !inspection.canChange || inspection.canEditSelected === false);
  }

  function render() {
    if (!labelListUnique || !polygonLabelList || !labelListCount) return;
    normalizeLabels();
    const workflow = getClassWorkflow();
    const classes = workflow?.enabled ? workflow.classes : [];
    const nextRenderKey = JSON.stringify({
      annotations: annotationState.annotations.map(({ id, type, label, color, editor }) => ({
        id,
        type,
        label,
        color,
        ...(editor ? { editor } : {}),
      })),
      classes: workflow?.enabled ? classes : null,
    });
    if (!renderInvalidation.hasChanged("label-panels", nextRenderKey)) {
      refreshClassControls(workflow);
      refreshInspectionControls(workflow);
      if (renderedSelectionId === interactionState.selectedAnnotationId) return;
      renderSelectedColor();
      // Selection changes only affect the old/new highlights and color control.
      shapeButtons.get(renderedSelectionId)?.classList.remove("is-selected");
      shapeButtons.get(interactionState.selectedAnnotationId)?.classList.add("is-selected");
      // Replacing rows used to release their focus, enabling document shortcuts.
      const focusedElement = documentRoot.activeElement;
      if (polygonLabelList.contains(focusedElement)) focusedElement.blur();
      renderedSelectionId = interactionState.selectedAnnotationId;
      return;
    }

    labelListCount.textContent = String(annotationState.annotations.length);
    const labelCountMap = new Map();
    annotationState.annotations.forEach(({ label }) => {
      labelCountMap.set(label, (labelCountMap.get(label) || 0) + 1);
    });
    const classesByName = new Map(classes.map(entry => [entry.name, entry]));
    for (const entry of classes) {
      if (!labelCountMap.has(entry.name)) labelCountMap.set(entry.name, 0);
    }
    const uniqueItems = [...labelCountMap.entries()].sort((left, right) => {
      const byCount = right[1] - left[1];
      return byCount !== 0 ? byCount : left[0].localeCompare(right[0]);
    });
    filterLabels = [...labelCountMap.keys()].sort((a, b) => a.localeCompare(b));
    // Preserve the palette allocation order used by the former label summary.
    // Unused catalog classes never consume a color slot.
    for (const [label, count] of uniqueItems) if (count > 0) getColorForLabel(label);
    labelListUnique.replaceChildren(createOption("", "Manual naming"), ...uniqueItems
      .filter(([label]) => classesByName.has(label))
      .map(([label, count]) => createOption(String(classesByName.get(label).id),
        `${label} (${count} ${count === 1 ? "shape" : "shapes"})`)));
    classElements.batchClassSelect?.replaceChildren(createOption("", "Choose a class"),
      ...classes.map(entry => createOption(String(entry.id), entry.name)));

    renderSelectedColor();

    const shapeFragment = documentRoot.createDocumentFragment();
    const annotationEntries = getAnnotationSequence();
    // Resolve rows once per rebuild; keep only DOM nodes between renders.
    const annotationsById = new Map(annotationState.annotations.map(annotation => [annotation.id, annotation]));
    shapeButtons.clear();
    shapeChecks.clear();
    shapeRows.clear();
    renderedFilter = undefined;
    renderedCheckedIds = new Set();
    renderedMultipleSelection = undefined;
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
        const annotation = annotationsById.get(entry.id);
        const item = documentRoot.createElement("li");
        shapeRows.set(entry.id, { row: item, label: annotation.label });
        if (workflow?.enabled) {
          item.className = "class-assignment-shape-row";
          const check = documentRoot.createElement("input");
          check.type = "checkbox";
          check.className = "class-assignment-check";
          check.dataset.classCheckId = entry.id;
          check.setAttribute("aria-label", `Include ${entry.type === "ellipse" ? "ellipse" : "polygon"} ${entry.index + 1} (${annotation.label}) in class assignment`);
          shapeChecks.set(entry.id, check);
          item.append(check);
        }
        const button = documentRoot.createElement("button");
        button.type = "button";
        button.className = "label-list-item label-list-item--polygon";
        button.dataset.annotationId = entry.id;
        button.dataset.annotationType = entry.type;
        button.dataset.annotationIndex = String(entry.index);
        if (entry.id === interactionState.selectedAnnotationId) {
          button.classList.add("is-selected");
        }
        shapeButtons.set(entry.id, button);
        const labelSpan = documentRoot.createElement("span");
        labelSpan.className = "label-list-item-label";
        const swatch = documentRoot.createElement("span");
        swatch.className = "label-list-item-swatch";
        swatch.style.backgroundColor = rgbToCss(
          getAnnotationColor(entry.type, entry.index, annotation)
        );
        const text = documentRoot.createElement("span");
        text.textContent = getAnnotationLabel(entry.type, entry.index, annotation);
        labelSpan.append(swatch, text);
        if (annotation.editor) {
          const badges = [];
          if (annotation.editor.hidden) { badges.push("Hidden"); button.classList.add("is-hidden-shape"); }
          if (annotation.editor.locked) badges.push("Locked");
          if (getReviewStatus(annotation) === "approved") badges.push("Approved");
          if (getReviewStatus(annotation) === "needs-review") badges.push("Needs review");
          if (badges.length) {
            const badge = documentRoot.createElement("span");
            badge.className = "shape-review-badge";
            badge.textContent = badges.join(" · ");
            labelSpan.append(badge);
          }
        }
        const indexSpan = documentRoot.createElement("span");
        indexSpan.className = "label-list-item-meta";
        indexSpan.textContent = `${entry.type === "ellipse" ? "E" : "P"}#${entry.index + 1}`;
        button.append(labelSpan, indexSpan);
        item.append(button);
        shapeFragment.append(item);
      });
    }
    polygonLabelList.replaceChildren(shapeFragment);
    renderedSelectionId = interactionState.selectedAnnotationId;
    refreshClassControls(workflow);
    refreshInspectionControls(workflow);
  }

  function getListTarget(event) {
    if (!isElement(event.target)) return null;
    return event.target.closest("[data-annotation-index]");
  }

  function bind() {
    if (bound || !polygonLabelList) return;
    bound = true;
    inspectionElements.annotationClassFilter?.addEventListener("change", event => onFilterClass(event.target.value || null));
    for (const [id, field] of [["selectedShapeVisible", "hidden"], ["selectedShapeLocked", "locked"]]) {
      inspectionElements[id]?.addEventListener("change", event => {
        const inspection = getInspection();
        if (inspection?.selected && inspection.canChange) {
          onSetEditorState({ annotationId: inspection.selected.id,
            [field]: field === "hidden" ? !event.target.checked : event.target.checked });
        }
        refreshInspectionControls();
      });
    }
    inspectionElements.selectedShapeReviewStatus?.addEventListener("change", event => {
      const inspection = getInspection();
      if (inspection?.selected && inspection.canChange) {
        onSetEditorState({ annotationId: inspection.selected.id, reviewStatus: event.target.value });
      }
      refreshInspectionControls();
    });
    labelListUnique?.addEventListener("change", (event) => {
      const workflow = getClassWorkflow();
      if (event.target !== labelListUnique || !workflow?.enabled) return;
      const entry = findClass(workflow, event.target.value);
      if (entry || event.target.value === "") onChooseClass(entry?.id ?? null);
      refreshClassControls();
    });
    classElements.selectMultipleShapes?.addEventListener("click", () => {
      if (!getClassWorkflow()?.enabled) return;
      multipleSelection = !multipleSelection;
      if (!multipleSelection) onClearChecked();
      const workflow = getClassWorkflow();
      refreshClassControls(workflow);
      refreshInspectionControls(workflow);
    });
    classElements.batchClassSelect?.addEventListener("change", event => {
      const workflow = getClassWorkflow();
      batchClassId = findClass(workflow, event.target.value) ? event.target.value : "";
      refreshClassControls(workflow);
    });
    classElements.clearClassChecks?.addEventListener("click", () => onClearChecked());
    classElements.assignClassToSelected?.addEventListener("click", () => {
      const workflow = getClassWorkflow();
      const entry = findClass(workflow, batchClassId);
      if (multipleSelection && entry && workflow.checkedIds?.size && workflow.canAssignTargets) {
        onAssignClass({ classId: entry.id, annotationIds: [...workflow.checkedIds] });
      }
    });
    inspectionElements.selectedShapeClass?.addEventListener("change", event => {
      const inspection = getInspection();
      const entry = findClass(getClassWorkflow(), event.target.value);
      if (!multipleSelection && entry && inspection?.selected && inspection.canChange && inspection.canEditSelected !== false) {
        onAssignClass({ classId: entry.id, annotationIds: [inspection.selected.id] });
      }
      refreshInspectionControls();
    });
    inspectionElements.clearShapeSelection?.addEventListener("click", () => {
      const inspection = getInspection();
      if (inspection?.selected && inspection.canChange) onClearSelection();
    });
    polygonLabelList.addEventListener("change", (event) => {
      const target = event.target;
      if (multipleSelection && isElement(target) && shapeChecks.get(target.dataset.classCheckId) === target) {
        onToggleChecked(target.dataset.classCheckId, target.checked);
      }
    });
    polygonLabelList.addEventListener("click", (event) => {
      if (isElement(event.target) && Object.hasOwn(event.target.dataset, "classCheckId")) return;
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
      if (isElement(event.target) && Object.hasOwn(event.target.dataset, "classCheckId")) return;
      const target = getListTarget(event);
      if (!target) return;
      const type = target.dataset.annotationType === "ellipse" ? "ellipse" : "polygon";
      renameAnnotationLabel({
        type,
        index: Number(target.dataset.annotationIndex),
      });
    });
  }

  return Object.freeze({ bind, render, refreshClassControls, refreshInspectionControls });
}
