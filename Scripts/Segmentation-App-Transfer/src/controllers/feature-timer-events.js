/** Bind annotation timer controls. */
export function bindFeatureTimerEvents({ elements, listen, actions }) {
  listen(elements.annotationTimerStart, "click", actions.startAnnotationTimer);
  listen(elements.annotationTimerStop, "click", () => actions.stopAnnotationTimer());
  listen(elements.annotationTimerReset, "click", actions.resetAnnotationTimer);
}
