import { clamp } from "./math.js";

function forEachPolygonNode(points, callback) {
  points.forEach((point) => {
    callback(point);
    if (point.curveFrom) {
      callback(point.curveFrom);
    }
  });
}

/** Measure polygon vertices and curve controls as one set of editable nodes. */
export function getPolygonNodeBounds(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return null;
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  forEachPolygonNode(points, (point) => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return;
    }
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  });
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

/** Translate polygon vertices and curve controls in place. */
export function translatePolygonNodes(points, dx, dy) {
  forEachPolygonNode(points, (point) => {
    point.x += dx;
    point.y += dy;
  });
}

/** Scale polygon vertices and curve controls around a center point in place. */
export function scalePolygonNodes(points, center, scaleValue) {
  forEachPolygonNode(points, (point) => {
    point.x = center.x + (point.x - center.x) * scaleValue;
    point.y = center.y + (point.y - center.y) * scaleValue;
  });
}

function clampNodeToBounds(point, bounds) {
  return {
    x: clamp(point.x, bounds.minX, bounds.maxX),
    y: clamp(point.y, bounds.minY, bounds.maxY),
  };
}

/** Clamp polygon vertices and curve controls to explicit image bounds. */
export function clampPolygonNodesToBounds(points, bounds) {
  if (!Array.isArray(points) || !bounds) {
    return false;
  }
  let changed = false;
  forEachPolygonNode(points, (point) => {
    const clamped = clampNodeToBounds(point, bounds);
    if (clamped.x !== point.x || clamped.y !== point.y) {
      point.x = clamped.x;
      point.y = clamped.y;
      changed = true;
    }
  });
  return changed;
}

/** Scale, translate, and clamp a polygon so every editable node fits the bounds. */
export function fitPolygonInsideBounds(points, bounds) {
  const polygonBounds = getPolygonNodeBounds(points);
  if (!bounds || !polygonBounds) {
    return false;
  }

  let changed = false;
  if (polygonBounds.width > bounds.width || polygonBounds.height > bounds.height) {
    const scaleX = polygonBounds.width > 0 ? bounds.width / polygonBounds.width : 1;
    const scaleY = polygonBounds.height > 0 ? bounds.height / polygonBounds.height : 1;
    const scaleValue = Math.min(1, scaleX, scaleY);
    if (scaleValue < 1) {
      scalePolygonNodes(points, { x: polygonBounds.cx, y: polygonBounds.cy }, scaleValue);
      changed = true;
    }
  }

  const fittedBounds = getPolygonNodeBounds(points);
  if (!fittedBounds) {
    return changed;
  }
  let dx = 0;
  let dy = 0;
  if (fittedBounds.minX < bounds.minX) {
    dx = bounds.minX - fittedBounds.minX;
  } else if (fittedBounds.maxX > bounds.maxX) {
    dx = bounds.maxX - fittedBounds.maxX;
  }
  if (fittedBounds.minY < bounds.minY) {
    dy = bounds.minY - fittedBounds.minY;
  } else if (fittedBounds.maxY > bounds.maxY) {
    dy = bounds.maxY - fittedBounds.maxY;
  }
  if (dx !== 0 || dy !== 0) {
    translatePolygonNodes(points, dx, dy);
    changed = true;
  }

  return clampPolygonNodesToBounds(points, bounds) || changed;
}

/** Scale and reposition an ellipse so it fits explicit image bounds. */
export function fitEllipseInsideBounds(ellipse, bounds) {
  if (!bounds || !ellipse) {
    return false;
  }
  let changed = false;
  const maxRx = bounds.width / 2;
  const maxRy = bounds.height / 2;
  if (ellipse.rx > maxRx || ellipse.ry > maxRy) {
    const scaleX = ellipse.rx > 0 ? maxRx / ellipse.rx : 1;
    const scaleY = ellipse.ry > 0 ? maxRy / ellipse.ry : 1;
    const scaleValue = Math.min(1, scaleX, scaleY);
    ellipse.rx *= scaleValue;
    ellipse.ry *= scaleValue;
    changed = true;
  }
  const nextCx = clamp(ellipse.cx, bounds.minX + ellipse.rx, bounds.maxX - ellipse.rx);
  const nextCy = clamp(ellipse.cy, bounds.minY + ellipse.ry, bounds.maxY - ellipse.ry);
  if (nextCx !== ellipse.cx || nextCy !== ellipse.cy) {
    ellipse.cx = nextCx;
    ellipse.cy = nextCy;
    changed = true;
  }
  return changed;
}
