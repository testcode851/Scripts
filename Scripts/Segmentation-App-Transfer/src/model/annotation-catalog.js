import {
  getAnnotationAtTypeIndex,
  getAnnotationById,
  getAnnotationTypeIndex,
  getAnnotationsByType,
} from "./annotation.js";
import {
  getRememberedAnnotationLabel,
  rememberAnnotationLabel,
} from "./annotation-labels.js";
import { hexToRgb, rgbToHex } from "../utils/colors.js";

/**
 * Owns annotation lookup, label normalization, label-color assignment, and
 * view references derived from the unified annotation collection.
 */
export function createAnnotationCatalog(options) {
  const {
    annotationState,
    interactionState,
    labels,
    baseColors,
    colorPalette,
    colorAssignments = new Map(),
  } = options;

  function sanitizeLabel(value) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    return trimmed || labels.polygon;
  }

  function getByType(type) {
    return getAnnotationsByType(annotationState.annotations, type);
  }

  function getAt(type, index) {
    return getAnnotationAtTypeIndex(annotationState.annotations, type, index);
  }

  function getPolygonAnnotations() {
    return getByType("polygon");
  }

  function getEllipseAnnotations() {
    return getByType("ellipse");
  }

  function getPolygonAnnotation(index) {
    return getAt("polygon", index);
  }

  function getEllipseAnnotation(index) {
    return getAt("ellipse", index);
  }

  function getSelectedAnnotation() {
    return getAnnotationById(
      annotationState.annotations,
      interactionState.selectedAnnotationId
    );
  }

  function getReference(annotation) {
    if (!annotation) return null;
    return {
      id: annotation.id,
      type: annotation.type,
      index: getAnnotationTypeIndex(annotationState.annotations, annotation.id),
    };
  }

  function getReferenceAt(type, index) {
    return getReference(getAt(type, index));
  }

  function getNextPaletteColor() {
    return colorPalette[colorAssignments.size % colorPalette.length];
  }

  function getColorForLabel(label) {
    const safeLabel = sanitizeLabel(label);
    if (!colorAssignments.has(safeLabel)) {
      colorAssignments.set(safeLabel, getNextPaletteColor());
    }
    return colorAssignments.get(safeLabel);
  }

  function getAnnotationColor(type, index) {
    const annotation = getAt(type, index);
    const fallbackLabel = type === "ellipse" ? labels.ellipse : labels.polygon;
    const label = annotation?.label || fallbackLabel;
    return annotation?.color
      ? hexToRgb(annotation.color) || getColorForLabel(label)
      : getColorForLabel(label);
  }

  function getAnnotationColorHex(type, index) {
    return rgbToHex(getAnnotationColor(type, index));
  }

  function getBaseColor(type, index) {
    if (!Number.isInteger(index) || index < 0) {
      return type === "ellipse" ? baseColors.ellipse : baseColors.polygon;
    }
    return getAnnotationColor(type, index);
  }

  function normalizeLabels() {
    rememberAnnotationLabel(
      annotationState,
      "polygon",
      getRememberedAnnotationLabel(annotationState, "polygon")
    );
    rememberAnnotationLabel(
      annotationState,
      "ellipse",
      getRememberedAnnotationLabel(annotationState, "ellipse")
    );
  }

  function getLabel(type, index) {
    normalizeLabels();
    const fallback = type === "ellipse" ? labels.ellipse : labels.polygon;
    return sanitizeLabel(getAt(type, index)?.label || fallback);
  }

  function getAnchorPoint(type, index) {
    const annotation = getAt(type, index);
    if (type === "polygon") {
      const points = annotation?.geometry?.points;
      return Array.isArray(points) && points.length > 0
        ? points[points.length - 1]
        : null;
    }
    const ellipse = annotation?.geometry;
    return ellipse ? { x: ellipse.cx, y: ellipse.cy } : null;
  }

  function getKnownLabels() {
    normalizeLabels();
    const countByLabel = new Map();
    annotationState.annotations.forEach((annotation) => {
      const label = sanitizeLabel(annotation.label);
      countByLabel.set(label, (countByLabel.get(label) || 0) + 1);
    });
    return [...countByLabel.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([label]) => label);
  }

  return {
    colorAssignments,
    clearLabelColors: () => colorAssignments.clear(),
    getAnnotationColor,
    getAnnotationColorHex,
    getAt,
    getBaseColor,
    getColorForLabel,
    getDefaultShapeColor: () => annotationState.lastShapeColor || "",
    getEllipseAnnotations,
    getKnownLabels,
    getLabel,
    getRememberedLabel: (type) =>
      getRememberedAnnotationLabel(annotationState, type),
    getPolygonAnnotations,
    getReference,
    getReferenceAt,
    getSelectedAnnotation,
    getAnchorPoint,
    isSelected: (type, index) =>
      getAt(type, index)?.id === interactionState.selectedAnnotationId,
    normalizeLabels,
    sanitizeLabel,
  };
}
