import { createCanvasAnnotationLayer } from "./canvas-annotation-layer.js";
import { createCanvasBackgroundLayer } from "./canvas-background-layer.js";
import { createCanvasDraftLayer } from "./canvas-draft-layer.js";
import { createCanvasSelectionLayer } from "./canvas-selection-layer.js";
import { createCanvasShapeLayer } from "./canvas-shape-layer.js";

export {
  getEllipseHandles,
  getMaskPreviewStyle,
} from "./canvas-shape-layer.js";

/** Compose visible canvas layers and own animation-frame scheduling. */
export function createCanvasRenderer({
  canvas,
  context,
  imageState,
  annotationState,
  interactionState,
  viewState,
  settingsState,
  uiState,
  coordinates,
  getActiveImageSource,
  getPolygonBaseColor,
  getEllipseBaseColor,
  isVertexSelected,
  createPreviewPolygonPoint,
  createEllipseFromDraft,
  createRectangleFromDraft,
  syncCursor,
  polygonBaseColor,
  ellipseBaseColor,
  closeSnapRadius = 10,
  requestFrame = globalThis.requestAnimationFrame,
}) {
  if (!canvas || !context || typeof requestFrame !== "function") {
    throw new TypeError("Canvas renderer requires a canvas, context, and frame scheduler.");
  }

  const { drawGrid, drawImage } = createCanvasBackgroundLayer({
    canvas,
    context,
    imageState,
    viewState,
    settingsState,
    getActiveImageSource,
  });
  const { drawEllipse, drawPolygon } = createCanvasShapeLayer({
    context,
    interactionState,
    settingsState,
    coordinates,
    getPolygonBaseColor,
    isVertexSelected,
    ellipseBaseColor,
  });
  const { drawAnnotations } = createCanvasAnnotationLayer({
    annotationState,
    interactionState,
    settingsState,
    uiState,
    drawPolygon,
    drawEllipse,
    getEllipseBaseColor,
    polygonBaseColor,
  });
  const { drawDrafts } = createCanvasDraftLayer({
    context,
    interactionState,
    coordinates,
    drawPolygon,
    drawEllipse,
    createPreviewPolygonPoint,
    createEllipseFromDraft,
    createRectangleFromDraft,
    polygonBaseColor,
    closeSnapRadius,
  });
  const { drawSelectionBox } = createCanvasSelectionLayer({
    context,
    interactionState,
  });
  let renderScheduled = false;

  function render() {
    drawImage();
    if (settingsState.gridEnabled) drawGrid();
    drawAnnotations();
    drawDrafts();
    drawSelectionBox();
    syncCursor();
  }

  function requestRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestFrame(() => {
      renderScheduled = false;
      render();
    });
  }

  return Object.freeze({
    drawEllipse,
    drawGrid,
    drawImage,
    drawPolygon,
    render,
    requestRender,
  });
}
