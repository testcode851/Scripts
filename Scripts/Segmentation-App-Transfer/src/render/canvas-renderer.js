import { createCanvasAnnotationLayer } from "./canvas-annotation-layer.js";
import { createCanvasBackgroundLayer } from "./canvas-background-layer.js";
import { createCanvasDraftLayer } from "./canvas-draft-layer.js";
import { createCanvasSelectionLayer } from "./canvas-selection-layer.js";
import { createCanvasShapeLayer } from "./canvas-shape-layer.js";
import { getAnnotationCanvasRegion, getRegionViewport } from "./canvas-visibility.js";

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
  createCanvas = () => canvas.ownerDocument?.createElement("canvas"),
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
  let fullRenderPending = false;
  let lastPainted = null;
  let selectionBuffer = null;

  function getSelectionBuffer() {
    if (!selectionBuffer) {
      const buffer = createCanvas();
      const bufferContext = buffer?.getContext("2d", context.getContextAttributes?.());
      if (!bufferContext) return null;
      const background = createCanvasBackgroundLayer({
        canvas: buffer, context: bufferContext, imageState, viewState, settingsState, getActiveImageSource,
      });
      const shapes = createCanvasShapeLayer({
        context: bufferContext, interactionState, settingsState, coordinates,
        getPolygonBaseColor, isVertexSelected, ellipseBaseColor,
      });
      const annotations = createCanvasAnnotationLayer({
        canvas: buffer, context: bufferContext, coordinates, annotationState,
        interactionState, settingsState, uiState, ...shapes, getEllipseBaseColor, polygonBaseColor,
      });
      selectionBuffer = { canvas: buffer, context: bufferContext,
        drawImage: background.drawImage, drawAnnotations: annotations.drawAnnotations };
    }
    if (selectionBuffer.canvas.width !== canvas.width) selectionBuffer.canvas.width = canvas.width;
    if (selectionBuffer.canvas.height !== canvas.height) selectionBuffer.canvas.height = canvas.height;
    selectionBuffer.context.miterLimit = context.miterLimit;
    selectionBuffer.context.lineJoin = context.lineJoin;
    selectionBuffer.context.lineCap = context.lineCap;
    return selectionBuffer;
  }

  function hasTransientDrawing() {
    return Boolean(interactionState.currentPolygon.length || interactionState.currentCurveControl ||
      interactionState.ellipseDraft || interactionState.rectangleDraft || interactionState.isDrawing ||
      interactionState.activeVertex || interactionState.activeAnnotationDrag ||
      interactionState.selectedVertexKeys.size || interactionState.selectionBox ||
      interactionState.isPanning || uiState.activeLabelEdit);
  }

  // Only explicit selection requests may reuse pixels. Geometry/label edits still
  // request a full render, including when they mutate an annotation in place.
  function captureScene() {
    return [annotationState.annotations, annotationState.annotations.length,
      canvas.width, canvas.height, imageState.image, imageState.equalizedImage,
      imageState.revision, imageState.imageSize?.width, imageState.imageSize?.height,
      imageState.imageLoadStatus, viewState.imageScale, viewState.viewZoom,
      uiState.annotationClassFilter,
      viewState.viewOffsetX, viewState.viewOffsetY, context.miterLimit, context.lineJoin,
      ...Object.values(settingsState)];
  }

  function capturePaintedSelection(scene = captureScene()) {
    const selectedId = interactionState.selectedAnnotationId;
    const selected = selectedId == null ? null :
      annotationState.annotations.find(annotation => annotation.id === selectedId);
    const region = selected ? getAnnotationCanvasRegion(selected, canvas, viewState, context) : null;
    lastPainted = {
      scene, region, selectedId,
      safe: !hasTransientDrawing() && (selectedId == null || Boolean(region)),
    };
  }

  function render() {
    drawImage();
    if (settingsState.gridEnabled) drawGrid();
    drawAnnotations();
    drawDrafts();
    drawSelectionBox();
    syncCursor();
    capturePaintedSelection();
  }

  function renderSelection() {
    const scene = captureScene();
    const transform = context.getTransform?.();
    // Clipping grid strokes can change their antialiasing at fractional views.
    // Keep the complete pass for grids so every channel stays identical.
    if (!lastPainted?.safe || hasTransientDrawing() || settingsState.gridEnabled || !imageState.image ||
        imageState.imageLoadStatus === "loading" || canvas.width <= 0 || canvas.height <= 0 ||
        !Number.isFinite(viewState.imageScale * viewState.viewZoom) ||
        viewState.imageScale * viewState.viewZoom <= 0 ||
        scene.length !== lastPainted.scene.length || scene.some((value, index) => value !== lastPainted.scene[index]) ||
        typeof context.clip !== "function" ||
        (transform && (transform.a !== 1 || transform.b !== 0 || transform.c !== 0 ||
          transform.d !== 1 || transform.e !== 0 || transform.f !== 0)) ||
        (context.globalAlpha !== undefined && context.globalAlpha !== 1) ||
        (context.globalCompositeOperation && context.globalCompositeOperation !== "source-over") ||
        (context.filter && context.filter !== "none") || context.shadowBlur > 0 ||
        context.shadowOffsetX || context.shadowOffsetY || context.getLineDash?.()?.length) {
      render();
      return;
    }
    const selectedId = interactionState.selectedAnnotationId;
    const selected = selectedId == null ? null :
      annotationState.annotations.find(annotation => annotation.id === selectedId);
    const region = selected ? getAnnotationCanvasRegion(selected, canvas, viewState, context) : null;
    if (selectedId != null && !region) {
      render();
      return;
    }
    if (selectedId === lastPainted.selectedId) {
      syncCursor();
      capturePaintedSelection(scene);
      return;
    }
    const regions = [lastPainted.region, region].filter(value => value &&
      value.minX < value.maxX && value.minY < value.maxY);
    if (regions.length === 2) {
      const [first, second] = regions;
      if (first.minX <= second.maxX && first.maxX >= second.minX &&
          first.minY <= second.maxY && first.maxY >= second.minY) {
        // A concave union clip can change native raster rounding. One rectangle
        // preserves the full-render pixels and paints their overlap only once.
        regions.splice(0, 2, {
          minX: Math.min(first.minX, second.minX), minY: Math.min(first.minY, second.minY),
          maxX: Math.max(first.maxX, second.maxX), maxY: Math.max(first.maxY, second.maxY),
        });
      }
    }
    if (regions.length) {
      const buffer = getSelectionBuffer();
      if (!buffer) {
        render();
        return;
      }
      // Cutting a path with a native clip can change its edge rasterization.
      // Draw the affected shapes uncut at the original origin, then copy pixels.
      buffer.drawImage();
      buffer.drawAnnotations(regions.map(bounds => getRegionViewport(bounds, viewState, context)));
      for (const bounds of regions) {
        context.save();
        try {
          context.beginPath();
          context.rect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
          context.clip();
          context.clearRect(0, 0, canvas.width, canvas.height);
          context.drawImage(buffer.canvas, 0, 0);
        } finally {
          context.restore();
        }
      }
    }
    syncCursor();
    capturePaintedSelection(scene);
  }

  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestFrame(() => {
      renderScheduled = false;
      const full = fullRenderPending;
      fullRenderPending = false;
      if (full) render();
      else renderSelection();
    });
  }

  function requestRender() {
    fullRenderPending = true;
    scheduleRender();
  }

  function requestSelectionRender() {
    scheduleRender();
  }

  return Object.freeze({
    drawEllipse,
    drawGrid,
    drawImage,
    drawPolygon,
    render,
    requestRender,
    requestSelectionRender,
  });
}
