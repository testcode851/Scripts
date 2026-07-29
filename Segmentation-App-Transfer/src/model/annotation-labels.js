export const DEFAULT_ANNOTATION_LABELS = Object.freeze({
  polygon: "polygon",
  ellipse: "ellipse",
});

export const DEFAULT_TOOL_LABELS = Object.freeze({
  polygon: "polygon",
  rectangle: "rectangle",
  ellipse: "ellipse",
});

/** New shapes always start with the selected tool's semantic name. */
export function getDefaultLabelForTool(tool) {
  const label = DEFAULT_TOOL_LABELS[tool];
  if (!label) throw new TypeError(`Unsupported drawing tool: ${tool}`);
  return label;
}

function getLabelStateKey(annotationType) {
  if (annotationType === "polygon") return "lastPolygonLabel";
  if (annotationType === "ellipse") return "lastEllipseLabel";
  throw new TypeError(`Unsupported annotation type: ${annotationType}`);
}

/** Return the most recent label for one shape type without crossing type boundaries. */
export function getRememberedAnnotationLabel(labelState, annotationType) {
  const stateKey = getLabelStateKey(annotationType);
  return labelState[stateKey] || DEFAULT_ANNOTATION_LABELS[annotationType];
}

/** Remember a committed label only for annotations of the same type. */
export function rememberAnnotationLabel(labelState, annotationType, label) {
  const stateKey = getLabelStateKey(annotationType);
  const fallback = DEFAULT_ANNOTATION_LABELS[annotationType];
  labelState[stateKey] = typeof label === "string" && label.trim() ? label.trim() : fallback;
  return labelState[stateKey];
}
