import { clamp } from "./math.js";
import {
  clampPolygonNodesToBounds,
  fitEllipseInsideBounds,
  fitPolygonInsideBounds,
} from "./shape-transform.js";

/** Own conversions between image/canvas space and image-bound geometry fitting. */
export function createCoordinateService({ imageState, viewState }) {
  function getImageBounds() {
    if (!imageState.imageSize) return null;
    const maxX = Math.max(0, imageState.imageSize.width - 1);
    const maxY = Math.max(0, imageState.imageSize.height - 1);
    return {
      minX: 0,
      minY: 0,
      maxX,
      maxY,
      width: maxX,
      height: maxY,
    };
  }

  function clampPointToImage(point) {
    const bounds = getImageBounds();
    if (!bounds || !point) return point;
    return {
      x: clamp(point.x, bounds.minX, bounds.maxX),
      y: clamp(point.y, bounds.minY, bounds.maxY),
    };
  }

  function fitPolygonInsideImage(points) {
    return fitPolygonInsideBounds(points, getImageBounds());
  }

  function clampPolygonNodesToImage(points) {
    return clampPolygonNodesToBounds(points, getImageBounds());
  }

  function fitEllipseInsideImage(ellipse) {
    return fitEllipseInsideBounds(ellipse, getImageBounds());
  }

  function scalePoint(point) {
    const scale = viewState.imageScale * viewState.viewZoom;
    return {
      x: point.x * scale + viewState.viewOffsetX,
      y: point.y * scale + viewState.viewOffsetY,
    };
  }

  function unscalePoint(point) {
    const scale = viewState.imageScale * viewState.viewZoom;
    return {
      x: (point.x - viewState.viewOffsetX) / scale,
      y: (point.y - viewState.viewOffsetY) / scale,
    };
  }

  function scaleEllipse(ellipse) {
    const scale = viewState.imageScale * viewState.viewZoom;
    return {
      cx: ellipse.cx * scale + viewState.viewOffsetX,
      cy: ellipse.cy * scale + viewState.viewOffsetY,
      rx: ellipse.rx * scale,
      ry: ellipse.ry * scale,
      rotation: ellipse.rotation,
    };
  }

  return Object.freeze({
    clampPointToImage,
    clampPolygonNodesToImage,
    fitEllipseInsideImage,
    fitPolygonInsideImage,
    getImageBounds,
    scaleEllipse,
    scalePoint,
    unscalePoint,
  });
}
