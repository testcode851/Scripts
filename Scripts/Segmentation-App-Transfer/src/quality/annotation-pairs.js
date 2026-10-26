import { flattenPolygon } from "../geometry/polygon.js";
import { getSamplingPoints } from "../geometry/curve-sampling.js";
import { polygonUnionArea } from "../geometry/polygon-union-area.js";

// Review hints only. Crossing strands are often intentional; overlaps are opt-in.
export const SIGNIFICANT_OVERLAP_RATIO = 0.2;
export const PAIR_ELLIPSE_SAMPLES = 64;
export const MAX_REVIEW_PAIRS = 2000;
export const MAX_REPORTED_PAIRS = 200;
export const MAX_PAIR_OUTLINE_POINTS = 512;
export const MAX_PAIR_GEOMETRY_WORK = 2_000_000;

const finitePoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);
const samePoint = (a, b) => a.x === b.x && a.y === b.y;
const validVertex = point => finitePoint(point) && (!point.curveFrom || finitePoint(point.curveFrom));

function redundant(a, b, c) {
  if (b.curveFrom || c.curveFrom) return false;
  return (b.x - a.x) * (c.y - a.y) === (b.y - a.y) * (c.x - a.x)
    && b.x >= Math.min(a.x, c.x) && b.x <= Math.max(a.x, c.x)
    && b.y >= Math.min(a.y, c.y) && b.y <= Math.max(a.y, c.y);
}

function simplifyStraightVertices(points) {
  const result = [];
  for (const point of points) {
    if (result.length && samePoint(point, result.at(-1)) && !point.curveFrom) continue;
    while (result.length > 1 && redundant(result.at(-2), result.at(-1), point)) result.pop();
    result.push(point);
  }
  if (result.length > 1 && samePoint(result[0], result.at(-1)) && !result[0].curveFrom) {
    const closing = result.pop();
    // An explicit final start vertex can own the incoming closing curve.
    if (closing.curveFrom) result[0] = { ...result[0], curveFrom: closing.curveFrom };
  }
  let start = 0;
  while (result.length - start > 2) {
    if (redundant(result.at(-1), result[start], result[start + 1])) start += 1;
    else if (redundant(result.at(-2), result.at(-1), result[start])) result.pop();
    else break;
  }
  return result.slice(start);
}

// A linear least-rotation search keeps long/repeated contours bounded.
function minimumRotation(tokens) {
  const count = tokens.length;
  let first = 0;
  let second = 1;
  let offset = 0;
  while (first < count && second < count && offset < count) {
    const a = tokens[(first + offset) % count];
    const b = tokens[(second + offset) % count];
    if (a === b) offset += 1;
    else {
      if (a > b) { first += offset + 1; if (first === second) first += 1; }
      else { second += offset + 1; if (first === second) second += 1; }
      offset = 0;
    }
  }
  const index = Math.min(first, second);
  return [...tokens.slice(index), ...tokens.slice(0, index)].join(";");
}

function polygonIdentity(points) {
  const simplified = simplifyStraightVertices(points);
  const token = (point, control) => JSON.stringify([point.x, point.y, control?.x ?? null, control?.y ?? null]);
  const forward = simplified.map((point, index) => token(point, simplified[(index + 1) % simplified.length].curveFrom));
  const reverse = [...simplified].reverse().map(point => token(point, point.curveFrom));
  const a = minimumRotation(forward);
  const b = minimumRotation(reverse);
  return a < b ? a : b;
}

function equivalentEllipses(first, second) {
  const normalize = geometry => geometry.rx >= geometry.ry
    ? { rx: geometry.rx, ry: geometry.ry, angle: (geometry.rotation || 0) % Math.PI }
    : { rx: geometry.ry, ry: geometry.rx, angle: ((geometry.rotation || 0) + Math.PI / 2) % Math.PI };
  if (first.cx !== second.cx || first.cy !== second.cy) return false;
  const a = normalize(first);
  const b = normalize(second);
  if (a.rx !== b.rx || a.ry !== b.ry) return false;
  if (a.rx === a.ry) return true;
  const difference = Math.abs(a.angle - b.angle) % Math.PI;
  // Allow only arithmetic rounding from equivalent half-turn/axis representations.
  return Math.min(difference, Math.PI - difference) <= Number.EPSILON * 32;
}

function ellipseOutline({ cx, cy, rx, ry, rotation = 0 }) {
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  return Array.from({ length: PAIR_ELLIPSE_SAMPLES }, (_, index) => {
    const angle = index * 2 * Math.PI / PAIR_ELLIPSE_SAMPLES;
    const x = rx * Math.cos(angle);
    const y = ry * Math.sin(angle);
    return { x: cx + cosine * x - sine * y, y: cy + sine * x + cosine * y };
  });
}

function prepare(annotation, typeIndex, knownArea) {
  const geometry = annotation.geometry;
  let points;
  let identity = null;
  if (annotation.type === "polygon") {
    if (!Array.isArray(geometry?.points) || !geometry.points.every(validVertex)) return null;
    const sampling = getSamplingPoints(geometry);
    if (!sampling.every(validVertex)) return null;
    identity = polygonIdentity(sampling);
    points = flattenPolygon(sampling).map(({ x, y }) => ({ x, y }));
  } else {
    const { cx, cy, rx, ry, rotation = 0 } = geometry || {};
    if (![cx, cy, rx, ry, rotation].every(Number.isFinite) || rx <= 0 || ry <= 0) return null;
    if (!Number.isFinite(Math.PI * rx * ry)) return null;
    points = ellipseOutline({ cx, cy, rx, ry, rotation });
  }
  if (points.length < 3 || !points.every(finitePoint)) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of points) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  if (!(maxX > minX && maxY > minY) || !Number.isFinite((maxX - minX) * (maxY - minY))) return null;
  return { annotation, typeIndex, identity, points, flat: points.flatMap(({ x, y }) => [x, y]),
    minX, minY, maxX, maxY, knownArea, sampledArea: undefined };
}

/**
 * Read-only, explicitly requested pair review. Polygon overlap follows the same
 * preserved curve sampling and nonzero fill as export. Ellipse overlap uses an
 * inscribed 64-segment boundary, so its ratio is an approximation. Duplicates
 * compare exact polygon segments or equivalent ellipse parameters, not labels.
 * Bounding-box sweep, pair/report limits, and a geometry-work budget prevent a
 * dense document from expanding into an unbounded all-pairs area calculation.
 */
export function inspectAnnotationPairs(annotations, {
  includeDuplicates = false,
  includeOverlaps = false,
  includeEllipses = true,
  overlapThreshold = SIGNIFICANT_OVERLAP_RATIO,
  maxPairs = MAX_REVIEW_PAIRS,
  maxReportedPairs = MAX_REPORTED_PAIRS,
  maxGeometryWork = MAX_PAIR_GEOMETRY_WORK,
  knownAreas = null,
} = {}) {
  if (!Number.isFinite(overlapThreshold) || overlapThreshold < 0 || overlapThreshold > 1) throw new RangeError("Overlap threshold must be between zero and one.");
  for (const value of [maxPairs, maxReportedPairs, maxGeometryWork]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("Pair review limits must be nonnegative safe integers.");
  }
  const pairSummary = { checkedPairs: 0, duplicatePairs: 0, overlapPairs: 0, truncated: false,
    skippedComplexShapes: 0, overlapThreshold, ellipseSamples: PAIR_ELLIPSE_SAMPLES };
  if (!includeDuplicates && !includeOverlaps) return { issues: [], pairSummary };
  const sources = Array.isArray(annotations) ? annotations : [];
  const prepared = [];
  const counts = { polygon: 0, ellipse: 0 };
  for (const annotation of sources) {
    if (annotation?.type !== "polygon" && annotation?.type !== "ellipse") continue;
    const typeIndex = counts[annotation.type]++;
    if (annotation.type === "ellipse" && !includeEllipses) continue;
    const knownArea = knownAreas?.get(annotation);
    if (knownAreas && !(knownArea > 0)) continue;
    try {
      const shape = prepare(annotation, typeIndex, knownArea);
      if (!shape) continue;
      if (shape.points.length > MAX_PAIR_OUTLINE_POINTS) {
        pairSummary.skippedComplexShapes += 1;
        pairSummary.truncated = true;
        continue;
      }
      prepared.push(shape);
    } catch { /* Invalid geometry is reported by the ordinary quality checks. */ }
  }
  prepared.sort((a, b) => a.minX - b.minX);
  const issues = new Map();
  let geometryWork = 0;
  let reportedPairs = 0;
  const consumeWork = cost => {
    if (geometryWork + cost > maxGeometryWork) { pairSummary.truncated = true; return false; }
    geometryWork += cost;
    return true;
  };
  const sampledArea = shape => {
    if (shape.sampledArea !== undefined) return shape.sampledArea;
    if (shape.annotation.type === "polygon" && shape.knownArea !== undefined) shape.sampledArea = shape.knownArea;
    else {
      if (!consumeWork(shape.points.length ** 2)) return null;
      shape.sampledArea = polygonUnionArea([shape.flat]);
    }
    return shape.sampledArea;
  };
  const addIssue = (shape, related, code, overlapRatio, approximate) => {
    let issue = issues.get(shape.annotation);
    if (!issue) {
      issue = { annotationId: shape.annotation.id, type: shape.annotation.type, typeIndex: shape.typeIndex,
        label: shape.annotation.label, area: shape.knownArea ?? shape.sampledArea, codes: [], relatedAnnotationIds: [] };
      issues.set(shape.annotation, issue);
    }
    if (!issue.codes.includes(code)) issue.codes.push(code);
    if (!issue.relatedAnnotationIds.includes(related.annotation.id)) issue.relatedAnnotationIds.push(related.annotation.id);
    if (overlapRatio !== undefined) issue.overlapRatio = Math.max(issue.overlapRatio || 0, overlapRatio);
    if (approximate) issue.approximate = true;
  };
  outer: for (let first = 0; first < prepared.length; first += 1) {
    const a = prepared[first];
    for (let second = first + 1; second < prepared.length && prepared[second].minX < a.maxX; second += 1) {
      const b = prepared[second];
      if (pairSummary.checkedPairs >= maxPairs || reportedPairs >= maxReportedPairs) { pairSummary.truncated = true; break outer; }
      pairSummary.checkedPairs += 1;
      if (b.minY >= a.maxY || a.minY >= b.maxY) continue;
      try {
        const duplicate = includeDuplicates && a.annotation.type === b.annotation.type
          && (a.annotation.type === "polygon" ? a.identity === b.identity : equivalentEllipses(a.annotation.geometry, b.annotation.geometry));
        if (!duplicate && !includeOverlaps) continue;
        const areaA = sampledArea(a);
        const areaB = sampledArea(b);
        if (areaA === null || areaB === null) break outer;
        if (!(areaA > 0 && areaB > 0)) continue;
        let overlapRatio;
        if (!duplicate) {
          const smaller = Math.min(areaA, areaB);
          const boxOverlap = (Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX))
            * (Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
          if (boxOverlap <= smaller * overlapThreshold) continue;
          if (!consumeWork((a.points.length + b.points.length) ** 2)) break outer;
          const union = polygonUnionArea([a.flat, b.flat]);
          const intersection = Math.max(0, Math.min(smaller, areaA + areaB - union));
          overlapRatio = intersection / smaller;
          // Subtracting a huge union from two areas can lose a tiny shape's
          // contribution. Require the lower rounding bound to clear the threshold.
          const uncertainty = Number.EPSILON * 64 * Math.max(areaA, areaB, union);
          if ((intersection - uncertainty) / smaller <= overlapThreshold) continue;
        }
        const code = duplicate ? "duplicate-shape" : "overlapping-shapes";
        const approximate = !duplicate && (a.annotation.type === "ellipse" || b.annotation.type === "ellipse");
        addIssue(a, b, code, overlapRatio, approximate);
        addIssue(b, a, code, overlapRatio, approximate);
        if (duplicate) pairSummary.duplicatePairs += 1;
        else pairSummary.overlapPairs += 1;
        reportedPairs += 1;
      } catch {
        // An unsupported numeric range cannot abort review or imply it is complete.
        pairSummary.truncated = true;
      }
    }
  }
  return { issues: sources.filter(annotation => issues.has(annotation)).map(annotation => issues.get(annotation)), pairSummary };
}
