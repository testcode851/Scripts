import { round } from "./math.js";

export const DEFAULT_CURVE_SEGMENT_SAMPLES = 20;

export function clonePolygonPoint(point) {
  const clone = { x: point.x, y: point.y };
  if (point.curveFrom) {
    clone.curveFrom = { x: point.curveFrom.x, y: point.curveFrom.y };
  }
  return clone;
}

export function getQuadraticPoint(start, control, end, t) {
  const oneMinusT = 1 - t;
  return {
    x: oneMinusT * oneMinusT * start.x + 2 * oneMinusT * t * control.x + t * t * end.x,
    y: oneMinusT * oneMinusT * start.y + 2 * oneMinusT * t * control.y + t * t * end.y,
  };
}

export function flattenPolygon(points, options = {}) {
  if (!Array.isArray(points) || points.length === 0) {
    return [];
  }
  const closed = options.closed !== false;
  const samples = options.samples || DEFAULT_CURVE_SEGMENT_SAMPLES;
  const flattened = [clonePolygonPoint(points[0])];
  const edgeCount = closed ? points.length : points.length - 1;

  for (let edgeIndex = 0; edgeIndex < edgeCount; edgeIndex += 1) {
    const start = points[edgeIndex];
    const endIndex = (edgeIndex + 1) % points.length;
    const end = points[endIndex];
    if (!end) continue;

    if (end.curveFrom) {
      for (let step = 1; step <= samples; step += 1) {
        const curvePoint = getQuadraticPoint(start, end.curveFrom, end, step / samples);
        if (!closed || endIndex !== 0 || step < samples) {
          flattened.push(curvePoint);
        }
      }
    } else if (!closed || endIndex !== 0) {
      flattened.push(clonePolygonPoint(end));
    }
  }

  return flattened;
}

export function getPolygonCurveMetadata(points) {
  if (!Array.isArray(points)) return [];
  return points
    .map((point, pointIndex) =>
      point.curveFrom
        ? {
            to: pointIndex,
            control: [round(point.curveFrom.x), round(point.curveFrom.y)],
          }
        : null
    )
    .filter(Boolean);
}

export function polygonBoundingBox(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

export function polygonArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current.x * next.y - next.x * current.y;
  }
  return Math.abs(sum) / 2;
}

export function parseCocoSegment(segment) {
  if (!Array.isArray(segment) || segment.length < 6 || segment.length % 2 !== 0) {
    return null;
  }

  const points = [];
  for (let index = 0; index < segment.length; index += 2) {
    const x = Number(segment[index]);
    const y = Number(segment[index + 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    points.push({ x, y });
  }
  return points;
}
