import { COMMANDS } from "../commands/command-names.js";
import { clamp } from "../geometry/math.js";
import { parseAnnotationDocument } from "../io/annotation-document.js";
import {
  createEllipseAnnotation,
  createPolygonAnnotation,
  getAnnotationById,
  getAnnotationTypeIndex,
  removeAnnotationById,
} from "../model/annotation.js";
import { rememberAnnotationLabel } from "../model/annotation-labels.js";
import { createInteractionReset } from "../state/interaction-reset.js";
import { hexToRgb, rgbToHex } from "../utils/colors.js";
import { cloneCocoIdentity } from "../model/coco-identity.js";
import { normalizeClassCatalog, validateCatalogAnnotations } from "../model/class-catalog.js";
import { invalidateReview, isLocked, normalizeEditorMetadata } from "../model/annotation-review.js";

/**
 * Owns document-level annotation mutations and the UI workflow around them.
 * Every public mutation request still enters through the command registry.
 */
export function createDocumentWorkflows(options) {
  const {
    imageState,
    annotationState,
    interactionState,
    catalog,
    executeCommand,
    fitPolygonInsideImage,
    fitEllipseInsideImage,
    normalizeSelectedAnnotation,
    getAnnotationSequence,
    clearTransientEditState,
    clearVertexSelection,
    selectAnnotation,
    closeLabelEditor,
    openLabelEditor,
    closeContextMenu,
    clearLabelColors,
    resizeCanvasToImage,
    resetViewTransform,
    redraw,
    redrawEditorState = redraw,
    alertFn = globalThis.alert,
    getClassCatalog = () => null,
    canAssignClass = () => true,
    canChangeEditorState = () => true,
    canEditAnnotation = annotation => !isLocked(annotation) && !annotation.editor?.hidden,
  } = options;
  const interactionReset = createInteractionReset(interactionState);

  function requestRename(reference) {
    if (!reference || !["polygon", "ellipse"].includes(reference.type)) return false;
    const annotation = reference.id
      ? getAnnotationById(annotationState.annotations, reference.id)
      : catalog.getAt(reference.type, Number(reference.index));
    if (!annotation || !canEditAnnotation(annotation)) return false;

    const index = getAnnotationTypeIndex(annotationState.annotations, annotation.id);
    catalog.normalizeLabels();
    selectAnnotation(annotation);
    const opened = openLabelEditor({
      annotationType: annotation.type,
      annotationIndex: index,
      initialLabel: catalog.getLabel(annotation.type, index),
      anchorImagePoint: catalog.getAnchorPoint(annotation.type, index),
      reason: "rename",
    });
    if (!opened) return false;
    redraw();
    return true;
  }

  function performRename({ annotationId, label }, { creation = false } = {}) {
    const annotation = getAnnotationById(annotationState.annotations, annotationId);
    if (!annotation || (creation ? isLocked(annotation) || annotation.editor?.hidden : !canEditAnnotation(annotation))) return false;
    const nextLabel = catalog.sanitizeLabel(label);
    if (annotation.label === nextLabel) {
      rememberAnnotationLabel(annotationState, annotation.type, nextLabel);
      return false;
    }
    annotation.label = nextLabel;
    invalidateReview(annotation);
    rememberAnnotationLabel(annotationState, annotation.type, nextLabel);
    return true;
  }

  // The initial tool label may not match the current view filter while its
  // creation naming popup is open. Completing that popup still names the shape.
  const performRenameCreated = request => performRename(request, { creation: true });

  function validateClassAssignment({ annotationIds, classId, className } = {}) {
    if (imageState.imageLoadStatus === "loading") {
      throw new Error("Wait for the image to finish loading before assigning a class.");
    }
    if (!canAssignClass()) throw new Error("Finish the current operation before assigning a class.");
    const savedCatalog = getClassCatalog();
    if (!savedCatalog) throw new Error("Enable a class catalog before assigning a class.");
    const classCatalog = normalizeClassCatalog(savedCatalog);
    if (!classCatalog.enabled) throw new Error("Enable a class catalog before assigning a class.");
    const choice = classCatalog.classes.find(item => item.id === classId && item.name === className);
    if (!choice) throw new Error("The selected class is no longer available. Choose a class from the current catalog.");
    if (!Array.isArray(annotationIds) || annotationIds.length === 0
      || Array.from(annotationIds).some(id => typeof id !== "string" || !id.trim())
      || new Set(annotationIds).size !== annotationIds.length) {
      throw new Error("Select one or more shapes before assigning a class.");
    }
    const byId = new Map(annotationState.annotations.map(annotation => [annotation.id, annotation]));
    const targets = annotationIds.map(id => byId.get(id));
    if (targets.some(annotation => !annotation || !["polygon", "ellipse"].includes(annotation.type))) {
      throw new Error("Some selected shapes are no longer available. Select the shapes again.");
    }
    if (targets.some(annotation => !canEditAnnotation(annotation))) {
      throw new Error("Unlock and show all selected shapes before assigning a class.");
    }
    return { targets, choice };
  }

  function assignClass(request) {
    try {
      const { targets, choice } = validateClassAssignment(request);
      if (targets.every(annotation => annotation.label === choice.name)) return false;
      return executeCommand(COMMANDS.ANNOTATION_ASSIGN_CLASS, {
        annotationIds: targets.map(annotation => annotation.id), classId: choice.id, className: choice.name,
      });
    } catch (error) {
      alertFn(error.message);
      return false;
    }
  }

  function performAssignClass(request) {
    const { targets, choice } = validateClassAssignment(request);
    if (targets.every(annotation => annotation.label === choice.name)) return false;
    for (const annotation of targets) {
      if (annotation.label !== choice.name) invalidateReview(annotation);
      annotation.label = choice.name;
      rememberAnnotationLabel(annotationState, annotation.type, choice.name);
    }
    redraw();
    return true;
  }

  function setSelectedColor(hexColor) {
    return executeCommand(COMMANDS.ANNOTATION_SET_COLOR, { hexColor });
  }

  function performSetSelectedColor({ hexColor }) {
    normalizeSelectedAnnotation();
    const selected = catalog.getSelectedAnnotation();
    if (!selected || !canEditAnnotation(selected)) return false;
    const color = rgbToHex(hexToRgb(hexColor));
    if (selected.color === color) return false;
    annotationState.lastShapeColor = color;
    selected.color = color;
    redraw();
    return true;
  }

  function performDuplicateSelected() {
    closeLabelEditor();
    closeContextMenu();
    normalizeSelectedAnnotation();
    const selected = catalog.getSelectedAnnotation();
    if (!selected) {
      alertFn("Select a shape first.");
      return false;
    }

    const duplicateOffset = 8;
    if (selected.type === "polygon") {
      const source = selected.geometry.points;
      if (!Array.isArray(source) || source.length < 3) return false;
      const points = source.map((point) => {
        const duplicate = {
          x: point.x + duplicateOffset,
          y: point.y + duplicateOffset,
        };
        if (point.curveFrom) {
          duplicate.curveFrom = {
            x: point.curveFrom.x + duplicateOffset,
            y: point.curveFrom.y + duplicateOffset,
          };
        }
        return duplicate;
      });
      fitPolygonInsideImage(points);
      const duplicate = createPolygonAnnotation({
        label: selected.label,
        color: selected.color,
        points,
        ...(selected.coco !== undefined ? { coco: cloneCocoIdentity(selected.coco, { preserveInstance: false }) } : {}),
      });
      annotationState.annotations.push(duplicate);
      clearTransientEditState();
      selectAnnotation(duplicate);
      redraw();
      return true;
    }

    if (selected.type === "ellipse") {
      if (!selected.geometry) return false;
      const ellipse = {
        ...selected.geometry,
        cx: selected.geometry.cx + duplicateOffset,
        cy: selected.geometry.cy + duplicateOffset,
      };
      fitEllipseInsideImage(ellipse);
      const duplicate = createEllipseAnnotation({
        label: selected.label,
        color: selected.color,
        ellipse,
      });
      annotationState.annotations.push(duplicate);
      clearTransientEditState();
      selectAnnotation(duplicate);
      redraw();
      return true;
    }
    return false;
  }

  function performDeleteSelected() {
    const target = catalog.getSelectedAnnotation();
    if (target && !canEditAnnotation(target)) return false;
    closeLabelEditor();
    closeContextMenu();
    normalizeSelectedAnnotation();
    const selected = catalog.getSelectedAnnotation();
    if (!selected) return false;

    const before = getAnnotationSequence();
    const selectedIndex = before.findIndex((entry) => entry.id === selected.id);
    if (!["polygon", "ellipse"].includes(selected.type)) return false;
    removeAnnotationById(annotationState.annotations, selected.id);
    if (selected.type === "polygon") {
      interactionState.activeVertex = null;
      clearVertexSelection();
    }

    const after = getAnnotationSequence();
    selectAnnotation(
      after.length === 0
        ? null
        : after[clamp(selectedIndex, 0, after.length - 1)]
    );
    redraw();
    return true;
  }

  function performCancelCreated({ annotationId }) {
    const annotation = getAnnotationById(annotationState.annotations, annotationId);
    if (!annotation) return false;
    removeAnnotationById(annotationState.annotations, annotation.id);
    if (interactionState.selectedAnnotationId === annotation.id) {
      selectAnnotation(null);
    }
    if (annotation.type === "polygon") {
      interactionState.activeVertex = null;
      clearVertexSelection();
    }
    return true;
  }

  function performClearAll() {
    if (annotationState.annotations.some(isLocked)) {
      alertFn("Unlock all shapes before clearing the document.");
      return false;
    }
    closeLabelEditor();
    closeContextMenu();
    clearLabelColors();
    annotationState.annotations = [];
    interactionReset.clearShapeDrafts();
    interactionReset.clearGeometryInteraction();
    selectAnnotation(null);
    clearVertexSelection();
    redraw();
    return true;
  }

  function validateEditorState(request) {
    if (imageState.imageLoadStatus === "loading" || !canChangeEditorState()) {
      throw new Error("Finish the current operation before changing shape review controls.");
    }
    if (!request || typeof request.annotationId !== "string") throw new Error("Select a shape first.");
    const annotation = getAnnotationById(annotationState.annotations, request.annotationId);
    if (!annotation) throw new Error("The shape is no longer available.");
    const next = { ...annotation.editor };
    for (const key of ["hidden", "locked", "reviewStatus"]) {
      if (Object.hasOwn(request, key)) next[key] = request[key];
    }
    const editor = normalizeEditorMetadata(next);
    return { annotation, editor };
  }

  function setEditorState(request) {
    try {
      const { annotation, editor } = validateEditorState(request);
      if (JSON.stringify(annotation.editor) === JSON.stringify(editor)) return false;
      return executeCommand(COMMANDS.ANNOTATION_SET_EDITOR_STATE, { ...request });
    } catch (error) {
      alertFn(error.message);
      return false;
    }
  }

  function performSetEditorState(request) {
    const { annotation, editor } = validateEditorState(request);
    if (JSON.stringify(annotation.editor) === JSON.stringify(editor)) return false;
    if (editor) annotation.editor = editor;
    else delete annotation.editor;
    if (editor?.hidden || editor?.locked) {
      if (interactionState.activeVertex?.annotationId === annotation.id) interactionState.activeVertex = null;
      for (const key of interactionState.selectedVertexKeys) {
        if (key.startsWith(`${annotation.id}|`)) interactionState.selectedVertexKeys.delete(key);
      }
    }
    redrawEditorState();
    return true;
  }

  function loadAnnotationData(data, { preparedDocument } = {}) {
    const imported = preparedDocument || parseAnnotationDocument(data, {
      currentImageName: imageState.imageName,
    });
    // Reject before the history transaction so rollback cannot disturb active edits.
    if (imageState.image && imported.imageSize && (
      imported.imageSize.width !== imageState.image.width ||
      imported.imageSize.height !== imageState.image.height
    )) {
      alertFn("The annotation dimensions do not match the loaded image. Load the matching image before importing these annotations.");
      return false;
    }
    if (imported.annotations.some(annotation => annotation.coco)) {
      validateCatalogAnnotations(getClassCatalog(), imported.annotations, { requireKnownLabels: true });
    }
    return executeCommand(COMMANDS.DOCUMENT_REPLACE, { imported });
  }

  function performLoadAnnotationData({ imported }) {
    // Measurements and calibration must refer to the loaded image's original pixels.
    if (imageState.image && imported.imageSize && (
      imported.imageSize.width !== imageState.image.width ||
      imported.imageSize.height !== imageState.image.height
    )) {
      alertFn("The annotation dimensions do not match the loaded image. Load the matching image before importing these annotations.");
      return false;
    }
    closeLabelEditor();
    closeContextMenu();
    clearLabelColors();
    annotationState.annotations = imported.annotations;
    imageState.calibration = imported.calibration || null;
    annotationState.lastPolygonLabel = imported.lastLabel;
    if (imported.imageSize) {
      imageState.imageSize = imported.imageSize;
      resizeCanvasToImage();
    }
    if (imported.imageName) imageState.imageName = imported.imageName;
    interactionReset.clearShapeDrafts();
    interactionReset.clearGeometryInteraction();
    clearVertexSelection();
    resetViewTransform();
    selectAnnotation(null);
    redraw();
    return true;
  }

  return {
    assignClass,
    loadAnnotationData,
    performAssignClass,
    performCancelCreated,
    performClearAll,
    performDeleteSelected,
    performDuplicateSelected,
    performLoadAnnotationData,
    performRename,
    performRenameCreated,
    performSetSelectedColor,
    performSetEditorState,
    requestRename,
    setSelectedColor,
    setEditorState,
  };
}
