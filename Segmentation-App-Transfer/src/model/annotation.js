import { clonePolygonPoint } from "../geometry/polygon.js";

let fallbackIdSequence = 0;

export function createAnnotationId(type = "annotation") {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  fallbackIdSequence += 1;
  return `${type}-${Date.now().toString(36)}-${fallbackIdSequence.toString(36)}`;
}

export function createPolygonAnnotation({ id, label = "polygon", color = "", points = [] } = {}) {
  if (!Array.isArray(points)) {
    throw new TypeError("Polygon points must be an array.");
  }
  return {
    id: id || createAnnotationId("polygon"),
    type: "polygon",
    label,
    color,
    geometry: {
      points: points.map(clonePolygonPoint),
    },
  };
}

export function createEllipseAnnotation({ id, label = "ellipse", color = "", ellipse = {} } = {}) {
  const { cx = 0, cy = 0, rx = 0, ry = 0, rotation = 0 } = ellipse;
  return {
    id: id || createAnnotationId("ellipse"),
    type: "ellipse",
    label,
    color,
    geometry: { cx, cy, rx, ry, rotation },
  };
}

export function cloneAnnotation(annotation, { preserveId = true } = {}) {
  if (annotation?.type === "polygon") {
    return createPolygonAnnotation({
      id: preserveId ? annotation.id : undefined,
      label: annotation.label,
      color: annotation.color,
      points: annotation.geometry?.points || [],
    });
  }
  if (annotation?.type === "ellipse") {
    return createEllipseAnnotation({
      id: preserveId ? annotation.id : undefined,
      label: annotation.label,
      color: annotation.color,
      ellipse: annotation.geometry || {},
    });
  }
  throw new TypeError("Unsupported annotation type.");
}

export function cloneAnnotations(annotations) {
  if (!Array.isArray(annotations)) return [];
  return annotations.map((annotation) => cloneAnnotation(annotation));
}

export function getAnnotationsByType(annotations, type) {
  if (!Array.isArray(annotations)) return [];
  return annotations.filter((annotation) => annotation.type === type);
}

export function getAnnotationById(annotations, annotationId) {
  if (!annotationId || !Array.isArray(annotations)) return null;
  return annotations.find((annotation) => annotation.id === annotationId) || null;
}

export function getAnnotationAtTypeIndex(annotations, type, index) {
  if (!Number.isInteger(index) || index < 0) return null;
  return getAnnotationsByType(annotations, type)[index] || null;
}

export function getAnnotationTypeIndex(annotations, annotationId) {
  const annotation = getAnnotationById(annotations, annotationId);
  if (!annotation) return -1;
  return getAnnotationsByType(annotations, annotation.type).findIndex((candidate) => candidate.id === annotationId);
}

export function removeAnnotationById(annotations, annotationId) {
  const index = annotations.findIndex((annotation) => annotation.id === annotationId);
  if (index < 0) return null;
  const [removed] = annotations.splice(index, 1);
  return removed || null;
}

export function isAnnotation(value) {
  if (!value || typeof value !== "object" || typeof value.id !== "string") return false;
  if (value.type === "polygon") {
    return Array.isArray(value.geometry?.points);
  }
  if (value.type === "ellipse") {
    const ellipse = value.geometry;
    return [ellipse?.cx, ellipse?.cy, ellipse?.rx, ellipse?.ry].every(Number.isFinite);
  }
  return false;
}
