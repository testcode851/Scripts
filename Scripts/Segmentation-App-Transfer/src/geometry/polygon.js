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

/** Find the nearest point on a quadratic, including endpoints and every local minimum. */
export function getClosestPointOnQuadratic(start, control, end, point) {
  const ax = end.x - start.x - 2 * (control.x - start.x);
  const ay = end.y - start.y - 2 * (control.y - start.y);
  const bx = 2 * (control.x - start.x);
  const by = 2 * (control.y - start.y);
  const cx = start.x - point.x;
  const cy = start.y - point.y;
  const scale = Math.max(Math.abs(ax), Math.abs(ay), Math.abs(bx), Math.abs(by), Math.abs(cx), Math.abs(cy)) || 1;
  const a = { x: ax / scale, y: ay / scale };
  const b = { x: bx / scale, y: by / scale };
  const c = { x: cx / scale, y: cy / scale };
  // Half the squared-distance derivative is a cubic. Its turning points
  // partition [0, 1] into monotonic intervals, so no nearest-point root is missed.
  const cubic = 2 * (a.x * a.x + a.y * a.y);
  const quadratic = 3 * (a.x * b.x + a.y * b.y);
  const linear = b.x * b.x + b.y * b.y + 2 * (a.x * c.x + a.y * c.y);
  const constant = b.x * c.x + b.y * c.y;
  const derivative = t => ((cubic * t + quadratic) * t + linear) * t + constant;
  const boundaries = [0, 1];
  const discriminant = quadratic * quadratic - 3 * cubic * linear;
  if (cubic > 0 && discriminant >= 0) {
    const root = Math.sqrt(discriminant);
    for (const t of [(-quadratic - root) / (3 * cubic), (-quadratic + root) / (3 * cubic)]) {
      if (t > 0 && t < 1) boundaries.push(t);
    }
  }
  boundaries.sort((left, right) => left - right);
  const candidates = [...boundaries];
  for (let index = 1; index < boundaries.length; index += 1) {
    let low = boundaries[index - 1];
    let high = boundaries[index];
    let lowValue = derivative(low);
    const highValue = derivative(high);
    if (lowValue === 0 || highValue === 0 || Math.sign(lowValue) === Math.sign(highValue)) continue;
    for (let iteration = 0; iteration < 52; iteration += 1) {
      const middle = (low + high) / 2;
      const value = derivative(middle);
      if (value === 0) {
        low = high = middle;
        break;
      }
      if (Math.sign(value) === Math.sign(lowValue)) {
        low = middle;
        lowValue = value;
      } else high = middle;
    }
    candidates.push((low + high) / 2);
  }
  let best = null;
  let bestDistance = Infinity;
  for (const t of candidates) {
    const projected = getQuadraticPoint(start, control, end, t);
    const distance = Math.hypot(projected.x - point.x, projected.y - point.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { point: projected, t };
    }
  }
  return best;
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
