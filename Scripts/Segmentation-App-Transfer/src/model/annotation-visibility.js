/** Editor visibility never changes the document supplied to exports or analytics. */
export function matchesAnnotationFilter(annotation, label = null) {
  return label === null || label === undefined || annotation?.label === label;
}

export function isAnnotationVisible(annotation, label = null) {
  return Boolean(annotation && !annotation.editor?.hidden && matchesAnnotationFilter(annotation, label));
}

export function isAnnotationEditable(annotation, label = null) {
  return isAnnotationVisible(annotation, label) && !annotation.editor?.locked;
}
