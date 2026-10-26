import { flattenPolygon } from "../geometry/polygon.js";
import { getSamplingPoints } from "../geometry/curve-sampling.js";
import { polygonUnionArea } from "../geometry/polygon-union-area.js";
import { inspectAnnotationPairs } from "./annotation-pairs.js";

// Image pixels squared, independent of zoom, calibration, and export rounding.
// This is a review hint: positive areas strictly below this value are flagged.
export const SMALL_REGION_AREA_PX2 = 4;

const finitePoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);
const validVertex = point => finitePoint(point) && (!point.curveFrom || finitePoint(point.curveFrom));
const samePoint = (first, second) => first.x === second.x && first.y === second.y;
const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

function outlinePoints(geometry) {
  if (!Array.isArray(geometry?.points) || !geometry.points.every(validVertex)) {
    throw new TypeError("Polygon vertices must be finite coordinates.");
  }
  const sampled = getSamplingPoints(geometry);
  if (!Array.isArray(sampled) || !sampled.every(validVertex)) {
    throw new TypeError("Polygon sampling must contain finite coordinates.");
  }
  const points = [];
  for (const point of flattenPolygon(sampled)) {
    if (!finitePoint(point)) throw new TypeError("Polygon outline must be finite.");
    if (!points.length || !samePoint(point, points.at(-1))) points.push({ x: point.x, y: point.y });
  }
  if (points.length > 1 && samePoint(points[0], points.at(-1))) points.pop();
  return points;
}

function normalizedOutline(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new RangeError("Polygon bounds exceed the supported numeric range.");
  }
  return {
    points: points.map(point => ({ x: (point.x - minX) / (width || 1), y: (point.y - minY) / (height || 1) })),
    width,
    height,
  };
}

function edgesIntersect(first, second, edgeCount) {
  if (first.maxY < second.minY || second.maxY < first.minY) return false;
  const a = cross(first.start, first.end, second.start);
  const b = cross(first.start, first.end, second.end);
  const c = cross(second.start, second.end, first.start);
  const d = cross(second.start, second.end, first.end);
  const adjacent = Math.abs(first.index - second.index) === 1
    || Math.abs(first.index - second.index) === edgeCount - 1;
  if (adjacent) {
    // Adjacent edges normally share just their endpoint. Backtracking covers
    // a positive length of the preceding edge and deserves review instead.
    if (a !== 0 || b !== 0) return false;
    return Math.min(first.maxX, second.maxX) > Math.max(first.minX, second.minX)
      || Math.min(first.maxY, second.maxY) > Math.max(first.minY, second.minY);
  }
  return (a === 0 || b === 0 || Math.sign(a) !== Math.sign(b))
    && (c === 0 || d === 0 || Math.sign(c) !== Math.sign(d));
}

function hasSelfIntersection(points) {
  const edges = points.map((start, index) => {
    const end = points[(index + 1) % points.length];
    return { start, end, index, minX: Math.min(start.x, end.x), maxX: Math.max(start.x, end.x),
      minY: Math.min(start.y, end.y), maxY: Math.max(start.y, end.y) };
  }).sort((first, second) => first.minX - second.minX);
  // Stop each scan beyond its x extent; separated edges need no orientation checks.
  for (let first = 0; first < edges.length; first += 1) {
    for (let second = first + 1; second < edges.length && edges[second].minX <= edges[first].maxX; second += 1) {
      if (edgesIntersect(edges[first], edges[second], edges.length)) return true;
    }
  }
  return false;
}

function simpleArea({ points, width, height }) {
  if (width === 0 || height === 0) return 0;
  let sum = 0;
  let compensation = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const contribution = current.x * next.y - next.x * current.y - compensation;
    const updated = sum + contribution;
    compensation = (updated - sum) - contribution;
    sum = updated;
  }
  return (Math.abs(sum) / 2 * width) * height;
}

function inspectPolygon(geometry) {
  const points = outlinePoints(geometry);
  if (points.length < 3) return { area: 0, codes: [] };
  const normalized = normalizedOutline(points);
  const selfIntersection = hasSelfIntersection(normalized.points);
  // Signed shoelace area cancels the two lobes of a bowtie. Use the same
  // nonzero fill rule as masks when a contour crosses or retraces itself.
  const area = selfIntersection
    ? polygonUnionArea([points.flatMap(point => [point.x, point.y])])
    : simpleArea(normalized);
  return { area, codes: selfIntersection ? ["self-intersection"] : [] };
}

function inspectEllipse(geometry) {
  const { cx, cy, rx, ry, rotation = 0 } = geometry || {};
  if (![cx, cy, rx, ry, rotation].every(Number.isFinite) || rx < 0 || ry < 0) {
    throw new TypeError("Ellipse geometry must contain finite coordinates and nonnegative radii.");
  }
  return { area: rx * ry * Math.PI, codes: [] };
}

/**
 * Inspect committed annotations without changing geometry, labels, or metadata.
 * Issues follow document order; typeIndex is the existing zero-based shape index.
 * Curves follow the same preserved sampling as exported masks. Overlap between
 * separate annotations is intentionally allowed; pair hints are explicit options.
 * This performs no raster edits.
 */
export function inspectAnnotationQuality(annotations, {
  smallRegionArea = SMALL_REGION_AREA_PX2, includeEllipses = true,
  includeDuplicates = false, includeOverlaps = false, pairOptions = {},
} = {}) {
  if (!Number.isFinite(smallRegionArea) || smallRegionArea < 0) {
    throw new RangeError("The small-region threshold must be a finite nonnegative area.");
  }
  const issues = [];
  const typeCounts = { polygon: 0, ellipse: 0 };
  const knownAreas = includeDuplicates || includeOverlaps ? new Map() : null;
  let checkedCount = 0;
  for (const annotation of Array.isArray(annotations) ? annotations : []) {
    const type = annotation?.type;
    if (type !== "polygon" && type !== "ellipse") continue;
    const typeIndex = typeCounts[type]++;
    if (type === "ellipse" && !includeEllipses) continue;
    checkedCount += 1;
    let area = null;
    let codes;
    try {
      ({ area, codes } = type === "polygon" ? inspectPolygon(annotation.geometry) : inspectEllipse(annotation.geometry));
      if (!Number.isFinite(area)) throw new RangeError("Annotation area exceeds the supported numeric range.");
      if (area === 0) codes.push("zero-area");
      else if (area < smallRegionArea) codes.push("small-region");
    } catch {
      area = null;
      codes = ["invalid-geometry"];
    }
    knownAreas?.set(annotation, area);
    if (codes.length) issues.push({ annotationId: annotation.id, type, typeIndex, label: annotation.label, codes, area });
  }
  if (includeDuplicates || includeOverlaps) {
    const pairs = inspectAnnotationPairs(annotations, { ...pairOptions, includeDuplicates, includeOverlaps, includeEllipses, knownAreas });
    const byId = new Map(issues.map(issue => [issue.annotationId, issue]));
    for (const pairIssue of pairs.issues) {
      const existing = byId.get(pairIssue.annotationId);
      if (existing) Object.assign(existing, pairIssue, { codes: [...existing.codes, ...pairIssue.codes] });
      else byId.set(pairIssue.annotationId, pairIssue);
    }
    const ordered = (Array.isArray(annotations) ? annotations : []).filter(annotation => byId.has(annotation?.id)).map(annotation => byId.get(annotation.id));
    return { checkedCount, issues: ordered, pairSummary: pairs.pairSummary };
  }
  return { checkedCount, issues };
}
