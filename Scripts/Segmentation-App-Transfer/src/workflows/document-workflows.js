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
    alertFn = globalThis.alert,
  } = options;
  const interactionReset = createInteractionReset(interactionState);

  function requestRename(reference) {
    if (!reference || !["polygon", "ellipse"].includes(reference.type)) return false;
    const annotation = reference.id
      ? getAnnotationById(annotationState.annotations, reference.id)
      : catalog.getAt(reference.type, Number(reference.index));
    if (!annotation) return false;

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

  function performRename({ annotationId, label }) {
    const annotation = getAnnotationById(annotationState.annotations, annotationId);
    if (!annotation) return false;
    const nextLabel = catalog.sanitizeLabel(label);
    if (annotation.label === nextLabel) {
      rememberAnnotationLabel(annotationState, annotation.type, nextLabel);
      return false;
    }
    annotation.label = nextLabel;
    rememberAnnotationLabel(annotationState, annotation.type, nextLabel);
    return true;
  }

  function setSelectedColor(hexColor) {
    return executeCommand(COMMANDS.ANNOTATION_SET_COLOR, { hexColor });
  }

  function performSetSelectedColor({ hexColor }) {
    normalizeSelectedAnnotation();
    const selected = catalog.getSelectedAnnotation();
    if (!selected) return false;
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

  function loadAnnotationData(data) {
    const imported = parseAnnotationDocument(data, {
      currentImageName: imageState.imageName,
    });
    return executeCommand(COMMANDS.DOCUMENT_REPLACE, { imported });
  }

  function performLoadAnnotationData({ imported }) {
    closeLabelEditor();
    closeContextMenu();
    clearLabelColors();
    annotationState.annotations = imported.annotations;
    annotationState.lastPolygonLabel = imported.lastLabel;
    if (imported.imageSize) {
      imageState.imageSize = imported.imageSize;
      resizeCanvasToImage();
    }
    if (imported.imageName) imageState.imageName = imported.imageName;
    interactionReset.clearPolygonDraft();
    interactionReset.clearGeometryInteraction();
    clearVertexSelection();
    resetViewTransform();
    selectAnnotation(null);
    redraw();
    return true;
  }

  return {
    loadAnnotationData,
    performCancelCreated,
    performClearAll,
    performDeleteSelected,
    performDuplicateSelected,
    performLoadAnnotationData,
    performRename,
    performSetSelectedColor,
    requestRename,
    setSelectedColor,
  };
}
