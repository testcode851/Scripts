import {
  getAnnotationAtTypeIndex,
  getAnnotationById,
  getAnnotationTypeIndex,
  getAnnotationsByType,
} from "../model/annotation.js";

/** Paint saved annotations and the selected-polygon emphasis layer. */
export function createCanvasAnnotationLayer({
  annotationState,
  interactionState,
  settingsState,
  uiState,
  drawPolygon,
  drawEllipse,
  getEllipseBaseColor,
  polygonBaseColor,
}) {
  function drawAnnotations() {
    const creationPreviewPolygonIndex =
      uiState.activeLabelEdit?.reason === "creation" &&
      uiState.activeLabelEdit?.annotationType !== "ellipse" &&
      Number.isInteger(uiState.activeLabelEdit?.annotationIndex)
        ? uiState.activeLabelEdit.annotationIndex
        : -1;
    const polygons = getAnnotationsByType(annotationState.annotations, "polygon");
    polygons.forEach((annotation, index) => {
      drawPolygon(annotation.geometry.points, {
        closed: true,
        polygonIndex: index,
        opacity: settingsState.maskOpacity / 100,
        selectedAnnotation:
          getAnnotationAtTypeIndex(annotationState.annotations, "polygon", index)?.id ===
          interactionState.selectedAnnotationId,
        baseColor: index === creationPreviewPolygonIndex ? polygonBaseColor : null,
      });
    });

    const selectedAnnotation = getAnnotationById(
      annotationState.annotations,
      interactionState.selectedAnnotationId
    );
    if (selectedAnnotation?.type === "polygon") {
      const selectedPolygon = selectedAnnotation.geometry.points;
      if (Array.isArray(selectedPolygon) && selectedPolygon.length > 0) {
        drawPolygon(selectedPolygon, {
          closed: true,
          polygonIndex: getAnnotationTypeIndex(
            annotationState.annotations,
            selectedAnnotation.id
          ),
          opacity: 1,
          stroke: "#0284c7",
          fill: "rgba(2, 132, 199, 0.08)",
          lineWidth: 3.5,
          noVertices: true,
        });
      }
    }

    getAnnotationsByType(annotationState.annotations, "ellipse").forEach(
      (annotation, index) => {
        drawEllipse(annotation.geometry, {
          opacity: settingsState.maskOpacity / 100,
          selectedAnnotation:
            getAnnotationAtTypeIndex(annotationState.annotations, "ellipse", index)?.id ===
            interactionState.selectedAnnotationId,
          ellipseIndex: index,
          baseColor: getEllipseBaseColor(index),
          showHandles: true,
        });
      }
    );
  }

  return Object.freeze({ drawAnnotations });
}
