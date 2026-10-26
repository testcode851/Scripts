/** Conservative image-space viewport for saved shapes and their editable handles. */
export function getCanvasViewport(canvas, coordinates, context) {
  if (!canvas || !Number.isFinite(canvas.width) || !Number.isFinite(canvas.height) ||
      canvas.width <= 0 || canvas.height <= 0 || typeof coordinates?.unscalePoint !== "function") {
    return null;
  }
  // The emphasis stroke is 3.5px wide. Allow its full miter limit, the largest
  // rotated control handle (10px), and an extra pixel for antialiasing.
  const miterLimit = Number.isFinite(context?.miterLimit) ? Math.max(1, context.miterLimit) : 10;
  const padding = Math.max(8, 3.5 * miterLimit) + 1;
  const first = coordinates.unscalePoint({ x: -padding, y: -padding });
  const last = coordinates.unscalePoint({ x: canvas.width + padding, y: canvas.height + padding });
  if (![first?.x, first?.y, last?.x, last?.y].every(Number.isFinite) ||
      first.x >= last.x || first.y >= last.y) return null;
  return {
    minX: first.x, minY: first.y, maxX: last.x, maxY: last.y,
  };
}

/** Quadratic segments stay inside the bounds of their endpoints and controls. */
export function polygonIntersectsViewport(points, viewport) {
  if (!viewport) return true;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of points) {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return true;
    minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
    if (point.curveFrom) {
      const control = point.curveFrom;
      if (!Number.isFinite(control.x) || !Number.isFinite(control.y)) return true;
      minX = Math.min(minX, control.x); minY = Math.min(minY, control.y);
      maxX = Math.max(maxX, control.x); maxY = Math.max(maxY, control.y);
    }
  }
  return !(maxX < viewport.minX || minX > viewport.maxX ||
    maxY < viewport.minY || minY > viewport.maxY);
}

/** The larger radius encloses every rotation and the current axis-aligned handles. */
export function ellipseIntersectsViewport(ellipse, viewport) {
  if (!viewport || ![ellipse.cx, ellipse.cy, ellipse.rx, ellipse.ry, ellipse.rotation].every(Number.isFinite) ||
      ellipse.rx < 0 || ellipse.ry < 0) return true;
  const radius = Math.max(ellipse.rx, ellipse.ry);
  return !(ellipse.cx + radius < viewport.minX || ellipse.cx - radius > viewport.maxX ||
    ellipse.cy + radius < viewport.minY || ellipse.cy - radius > viewport.maxY);
}

/** Integer canvas bounds containing a saved shape, its stroke, and its handles. */
export function getAnnotationCanvasRegion(annotation, canvas, view, context) {
  const scale = view.imageScale * view.viewZoom;
  if (!Number.isFinite(scale) || scale <= 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  if (annotation.type === "polygon") {
    for (const point of annotation.geometry.points) {
      for (const value of point.curveFrom ? [point, point.curveFrom] : [point]) {
        if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) return null;
        minX = Math.min(minX, value.x); minY = Math.min(minY, value.y);
        maxX = Math.max(maxX, value.x); maxY = Math.max(maxY, value.y);
      }
    }
  } else if (annotation.type === "ellipse") {
    const { cx, cy, rx, ry, rotation } = annotation.geometry;
    if (![cx, cy, rx, ry, rotation].every(Number.isFinite) || rx < 0 || ry < 0) return null;
    const radius = Math.max(rx, ry);
    minX = cx - radius; maxX = cx + radius;
    minY = cy - radius; maxY = cy + radius;
  } else return null;
  if (![minX, minY, maxX, maxY, view.viewOffsetX, view.viewOffsetY].every(Number.isFinite)) return null;
  const miterLimit = Number.isFinite(context.miterLimit) ? Math.max(1, context.miterLimit) : 10;
  const padding = Math.max(8, 3.5 * miterLimit) + 1;
  return {
    minX: Math.max(0, Math.floor(minX * scale + view.viewOffsetX - padding)),
    minY: Math.max(0, Math.floor(minY * scale + view.viewOffsetY - padding)),
    maxX: Math.min(canvas.width, Math.ceil(maxX * scale + view.viewOffsetX + padding)),
    maxY: Math.min(canvas.height, Math.ceil(maxY * scale + view.viewOffsetY + padding)),
  };
}

/** Expand a pixel clip region for conservative image-space shape rejection. */
export function getRegionViewport(region, view, context) {
  const scale = view.imageScale * view.viewZoom;
  const miterLimit = Number.isFinite(context.miterLimit) ? Math.max(1, context.miterLimit) : 10;
  const padding = Math.max(8, 3.5 * miterLimit) + 1;
  return {
    minX: (region.minX - padding - view.viewOffsetX) / scale,
    minY: (region.minY - padding - view.viewOffsetY) / scale,
    maxX: (region.maxX + padding - view.viewOffsetX) / scale,
    maxY: (region.maxY + padding - view.viewOffsetY) / scale,
  };
}
