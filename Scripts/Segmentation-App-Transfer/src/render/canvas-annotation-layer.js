import {
  getAnnotationById,
  getAnnotationsByType,
} from "../model/annotation.js";
import { getCanvasViewport } from "./canvas-visibility.js";
import { isAnnotationVisible } from "../model/annotation-visibility.js";

/** Paint saved annotations and the selected-polygon emphasis layer. */
export function createCanvasAnnotationLayer({
  canvas,
  context,
  coordinates,
  annotationState,
  interactionState,
  settingsState,
  uiState,
  drawPolygon,
  drawEllipse,
  getEllipseBaseColor,
  polygonBaseColor,
}) {
  function drawAnnotations(regions) {
    const viewport = getCanvasViewport(canvas, coordinates, context);
    const creationPreviewPolygonIndex =
      uiState.activeLabelEdit?.reason === "creation" &&
      uiState.activeLabelEdit?.annotationType !== "ellipse" &&
      Number.isInteger(uiState.activeLabelEdit?.annotationIndex)
        ? uiState.activeLabelEdit.annotationIndex
        : -1;
    const polygons = getAnnotationsByType(annotationState.annotations, "polygon");
    polygons.forEach((annotation, index) => {
      if (!isAnnotationVisible(annotation, uiState.annotationClassFilter)) return;
      drawPolygon(annotation.geometry.points, {
        viewport,
        regions,
        closed: true,
        polygonIndex: index,
        annotation,
        ...(annotation.editor?.locked ? { noVertices: true } : {}),
        opacity: settingsState.maskOpacity / 100,
        selectedAnnotation: annotation.id === interactionState.selectedAnnotationId,
        baseColor: index === creationPreviewPolygonIndex ? polygonBaseColor : null,
      });
    });

    const selectedAnnotation = getAnnotationById(
      annotationState.annotations,
      interactionState.selectedAnnotationId
    );
    if (selectedAnnotation?.type === "polygon" && isAnnotationVisible(selectedAnnotation, uiState.annotationClassFilter)) {
      const selectedPolygon = selectedAnnotation.geometry.points;
      if (Array.isArray(selectedPolygon) && selectedPolygon.length > 0) {
        drawPolygon(selectedPolygon, {
          viewport,
          regions,
          closed: true,
          polygonIndex: polygons.indexOf(selectedAnnotation),
          annotation: selectedAnnotation,
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
        if (!isAnnotationVisible(annotation, uiState.annotationClassFilter)) return;
        drawEllipse(annotation.geometry, {
          viewport,
          regions,
          opacity: settingsState.maskOpacity / 100,
          selectedAnnotation: annotation.id === interactionState.selectedAnnotationId,
          ellipseIndex: index,
          baseColor: getEllipseBaseColor(index, annotation),
          showHandles: !annotation.editor?.locked,
        });
      }
    );
  }

  return Object.freeze({ drawAnnotations });
}
