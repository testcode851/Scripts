import { clamp } from "../geometry/math.js";
import { createListenerLifecycle } from "../utils/listener-lifecycle.js";

/**
 * Owns canvas coordinate conversion, viewport transforms, pan state, and the
 * controls that change the viewport. The controller consumes named state
 * slices so it does not depend on the legacy flat state facade.
 */
export function createViewController(options) {
  const {
    imageState,
    interactionState,
    viewState,
    canvas,
    canvasWrap,
    controls = {},
    redraw,
    syncAdjustmentLabels,
  } = options;

  const listenerLifecycle = createListenerLifecycle();
  const { listen } = listenerLifecycle;

  function getCanvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }

  function getImagePoint(event) {
    const point = getCanvasPoint(event);
    const zoom = Math.max(0.01, viewState.viewZoom);
    return {
      x: (point.x - viewState.viewOffsetX) / zoom / viewState.imageScale,
      y: (point.y - viewState.viewOffsetY) / zoom / viewState.imageScale,
    };
  }

  function getDisplayedImageSize() {
    if (!imageState.imageSize) {
      return { width: canvas.width, height: canvas.height };
    }
    return {
      width: imageState.imageSize.width * viewState.imageScale * viewState.viewZoom,
      height: imageState.imageSize.height * viewState.imageScale * viewState.viewZoom,
    };
  }

  function constrainViewTransform() {
    const { width: scaledWidth, height: scaledHeight } = getDisplayedImageSize();

    viewState.viewOffsetX =
      scaledWidth <= canvas.width
        ? (canvas.width - scaledWidth) / 2
        : clamp(viewState.viewOffsetX, canvas.width - scaledWidth, 0);
    viewState.viewOffsetY =
      scaledHeight <= canvas.height
        ? (canvas.height - scaledHeight) / 2
        : clamp(viewState.viewOffsetY, canvas.height - scaledHeight, 0);
  }

  function resizeCanvasToImage() {
    if (!imageState.imageSize) return;
    if (!canvasWrap.clientWidth || !canvasWrap.clientHeight) return;
    const padding = 32;
    const availableWidth = Math.max(1, canvasWrap.clientWidth - padding);
    const availableHeight = Math.max(1, canvasWrap.clientHeight - padding);
    viewState.imageScale = Math.min(
      availableWidth / imageState.imageSize.width,
      availableHeight / imageState.imageSize.height,
      1.5
    );
    canvas.width = Math.round(imageState.imageSize.width * viewState.imageScale);
    canvas.height = Math.round(imageState.imageSize.height * viewState.imageScale);
    constrainViewTransform();
  }

  function resetViewTransform() {
    viewState.viewZoom = 1;
    viewState.viewOffsetX = 0;
    viewState.viewOffsetY = 0;
    constrainViewTransform();
    syncAdjustmentLabels();
  }

  function setViewZoom(nextZoom, anchorPoint = null) {
    const clampedZoom = clamp(nextZoom, 1, 8);
    const previousZoom = viewState.viewZoom;
    if (Math.abs(clampedZoom - previousZoom) < 0.001) return false;

    const anchor = anchorPoint || { x: canvas.width / 2, y: canvas.height / 2 };
    const worldX = (anchor.x - viewState.viewOffsetX) / previousZoom;
    const worldY = (anchor.y - viewState.viewOffsetY) / previousZoom;
    viewState.viewZoom = clampedZoom;
    viewState.viewOffsetX = anchor.x - worldX * clampedZoom;
    viewState.viewOffsetY = anchor.y - worldY * clampedZoom;
    constrainViewTransform();
    syncAdjustmentLabels();
    redraw();
    return true;
  }

  function shouldStartPan(event) {
    return Boolean(interactionState.panModeEnabled || event.button === 1);
  }

  function syncCanvasCursor() {
    if (interactionState.isPanning) {
      canvas.style.cursor = "grabbing";
    } else if (interactionState.panModeEnabled) {
      canvas.style.cursor = "grab";
    } else {
      canvas.style.cursor = "crosshair";
    }
  }

  function startPan(event) {
    interactionState.isPanning = true;
    interactionState.isDrawing = false;
    interactionState.panStartPoint = getCanvasPoint(event);
    interactionState.panStartOffset = {
      x: viewState.viewOffsetX,
      y: viewState.viewOffsetY,
    };
    syncCanvasCursor();
  }

  function updatePan(event) {
    if (
      !interactionState.isPanning ||
      !interactionState.panStartPoint ||
      !interactionState.panStartOffset
    ) {
      return false;
    }
    const previousOffsetX = viewState.viewOffsetX;
    const previousOffsetY = viewState.viewOffsetY;
    const currentPoint = getCanvasPoint(event);
    viewState.viewOffsetX =
      interactionState.panStartOffset.x + (currentPoint.x - interactionState.panStartPoint.x);
    viewState.viewOffsetY =
      interactionState.panStartOffset.y + (currentPoint.y - interactionState.panStartPoint.y);
    constrainViewTransform();
    if (viewState.viewOffsetX !== previousOffsetX || viewState.viewOffsetY !== previousOffsetY) {
      redraw();
    }
    return true;
  }

  function stopPan() {
    interactionState.isPanning = false;
    interactionState.panStartPoint = null;
    interactionState.panStartOffset = null;
    syncCanvasCursor();
  }

  function fitWindow() {
    if (!imageState.imageSize) return;
    const padding = 32;
    const availableWidth = Math.max(1, canvasWrap.clientWidth - padding);
    const availableHeight = Math.max(1, canvasWrap.clientHeight - padding);
    viewState.imageScale = Math.min(
      availableWidth / imageState.imageSize.width,
      availableHeight / imageState.imageSize.height
    );
    canvas.width = Math.round(imageState.imageSize.width * viewState.imageScale);
    canvas.height = Math.round(imageState.imageSize.height * viewState.imageScale);
    resetViewTransform();
    redraw();
  }

  function unfitWindow() {
    if (!imageState.imageSize) return;
    resizeCanvasToImage();
    resetViewTransform();
    redraw();
  }

  function toggleFitWindow() {
    if (!imageState.imageSize) return;
    viewState.fitWindowActive = !viewState.fitWindowActive;
    if (viewState.fitWindowActive) fitWindow();
    else unfitWindow();
    controls.fitWindow?.classList.toggle("active", viewState.fitWindowActive);
  }

  function handleWheel(event) {
    if (!imageState.image) return;
    event.preventDefault();
    const zoomStep = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    setViewZoom(viewState.viewZoom * zoomStep, getCanvasPoint(event));
  }

  function bind() {
    listen(canvas, "wheel", handleWheel, { passive: false });
    listen(controls.fitWindow, "click", toggleFitWindow);
    listen(controls.zoomIn, "click", () => setViewZoom(viewState.viewZoom * 1.25));
    listen(controls.zoomOut, "click", () => setViewZoom(viewState.viewZoom / 1.25));
    listen(controls.zoomReset, "click", () => setViewZoom(1));
    return controller;
  }

  function destroy() {
    listenerLifecycle.clear();
  }

  const controller = {
    bind,
    destroy,
    getCanvasPoint,
    getImagePoint,
    getDisplayedImageSize,
    constrainViewTransform,
    resizeCanvasToImage,
    resetViewTransform,
    setViewZoom,
    shouldStartPan,
    syncCanvasCursor,
    startPan,
    updatePan,
    stopPan,
    toggleFitWindow,
  };
  return controller;
}
