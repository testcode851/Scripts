/** Bind selected-shape rename and color controls. */
export function bindFeatureSelectionEvents({ elements, listen, alertFn, actions }) {
  listen(elements.renameSelectedPolygonButton, "click", () => {
    actions.normalizeSelectedAnnotation();
    const selectedAnnotation = actions.getSelectedAnnotation();
    if (!selectedAnnotation) {
      alertFn("Select a shape first.");
      return;
    }
    actions.renameAnnotationLabel(actions.getAnnotationReference(selectedAnnotation));
  });
  listen(elements.selectedShapeColorInput, "input", (event) => {
    const nextColor =
      event?.target && "value" in event.target
        ? String(event.target.value)
        : elements.selectedShapeColorInput.value;
    actions.setSelectedAnnotationColor(nextColor);
  });
}
