import { clonePolygonPoint, getQuadraticPoint } from "./polygon.js";
import { round } from "./math.js";

const copyPoint = ({ x, y }) => ({ x, y });
const samePoint = (left, right) => left?.x === right?.x && left?.y === right?.y;
const finitePoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);

export function cloneCurveSampling(records) {
  return records.map(record => ({
    endIndex: record.endIndex,
    source: record.source.map(copyPoint),
    nodes: record.nodes.map(clonePolygonPoint),
    parameters: [...record.parameters],
  }));
}

function getRun(record, points, allowRounded = false) {
  const segmentCount = record?.nodes?.length - 1;
  if (!Number.isInteger(record?.endIndex) || record.endIndex < 0 || record.endIndex >= points.length ||
      !Number.isInteger(segmentCount) || segmentCount < 2 || segmentCount >= points.length) return null;
  const startIndex = (record.endIndex - segmentCount + points.length) % points.length;
  // Insertion appends closing-edge vertices; a run never crosses vertex zero internally.
  if (startIndex + segmentCount > points.length) return null;
  const matches = (actual, expected) => samePoint(actual, expected) || (allowRounded &&
    finitePoint(expected) && samePoint(actual, { x: round(expected.x), y: round(expected.y) }));
  for (let offset = 0; offset <= segmentCount; offset += 1) {
    const actual = points[(startIndex + offset) % points.length];
    const expected = record.nodes[offset];
    if (!matches(actual, expected) || (offset > 0 && !matches(actual.curveFrom, expected.curveFrom))) return null;
  }
  return { record, startIndex, segmentCount };
}

/** Keep only complete, unchanged subdivision runs; ordinary geometry edits invalidate a run. */
export function getValidCurveSampling(geometry) {
  const points = geometry?.points || [];
  const records = Array.isArray(geometry?.curveSampling) ? geometry.curveSampling : [];
  const occupiedEdges = new Set();
  return records.filter(record => {
    const run = getRun(record, points);
    if (!run) return false;
    for (let offset = 0; offset < run.segmentCount; offset += 1) {
      if (occupiedEdges.has(run.startIndex + offset)) return false;
    }
    for (let offset = 0; offset < run.segmentCount; offset += 1) occupiedEdges.add(run.startIndex + offset);
    return true;
  });
}

/** Resolve insertion-only subdivisions before the existing export fitting and sampling steps. */
export function getSamplingPoints(geometry) {
  const points = geometry?.points || [];
  const records = getValidCurveSampling(geometry);
  if (!records.length) return points;
  const resolved = points.map(clonePolygonPoint);
  const omitted = new Set();
  records.forEach(record => {
    const { startIndex, segmentCount } = getRun(record, points);
    Object.assign(resolved[startIndex], record.source[0]);
    Object.assign(resolved[record.endIndex], record.source[2], { curveFrom: copyPoint(record.source[1]) });
    for (let offset = 1; offset < segmentCount; offset += 1) omitted.add(startIndex + offset);
  });
  return resolved.filter((point, index) => !omitted.has(index));
}

/** Capture the original sampling before editable quadratic controls are subdivided. */
export function prepareCurveSamplingInsertion(geometry, index) {
  const points = geometry.points;
  const records = cloneCurveSampling(getValidCurveSampling(geometry));
  const edgeIndex = (index - 1 + points.length) % points.length;
  const existing = records.find(record => {
    const run = getRun(record, points);
    return edgeIndex >= run.startIndex && edgeIndex < run.startIndex + run.segmentCount;
  });
  const start = points[edgeIndex];
  const end = points[index % points.length];
  return {
    records,
    existing,
    offset: existing ? edgeIndex - getRun(existing, points).startIndex + 1 : 1,
    source: end.curveFrom ? [copyPoint(start), copyPoint(end.curveFrom), copyPoint(end)] : null,
  };
}

export function finishCurveSamplingInsertion(geometry, index, t, prepared) {
  const points = geometry.points;
  const { records, existing, offset, source } = prepared;
  records.forEach(record => { if (record.endIndex >= index) record.endIndex += 1; });
  if (t != null && source) {
    const record = existing || {
      endIndex: (index + 1) % points.length,
      source,
      nodes: [],
      parameters: [0, 1],
    };
    const low = record.parameters[offset - 1];
    const high = record.parameters[offset];
    record.parameters.splice(offset, 0, low + (high - low) * t);
    const segmentCount = record.parameters.length - 1;
    const startIndex = (record.endIndex - segmentCount + points.length) % points.length;
    record.nodes = Array.from({ length: segmentCount + 1 }, (_, offset) =>
      offset ? clonePolygonPoint(points[(startIndex + offset) % points.length]) : copyPoint(points[startIndex]));
    if (!existing) records.push(record);
  }
  if (records.length) geometry.curveSampling = records;
  else delete geometry.curveSampling;
}

function sourceMatchesNodes(record) {
  const [start, control, end] = record.source;
  // Sampling metadata retains exact children, so only floating-point arithmetic error is allowed.
  const tolerance = Number.EPSILON * 128 * Math.max(1,
    ...record.source.flatMap(point => [Math.abs(point.x), Math.abs(point.y)]));
  const close = (actual, expected) => finitePoint(actual) && finitePoint(expected) &&
    Math.abs(actual.x - expected.x) <= tolerance && Math.abs(actual.y - expected.y) <= tolerance;
  for (let index = 0; index < record.nodes.length; index += 1) {
    const t = record.parameters[index];
    const point = getQuadraticPoint(start, control, end, t);
    if (!close(record.nodes[index], point)) return false;
    if (index > 0) {
      const low = record.parameters[index - 1];
      const previous = getQuadraticPoint(start, control, end, low);
      const span = t - low;
      const childControl = {
        x: previous.x + span * ((1 - low) * (control.x - start.x) + low * (end.x - control.x)),
        y: previous.y + span * ((1 - low) * (control.y - start.y) + low * (end.y - control.y)),
      };
      if (!close(record.nodes[index].curveFrom, childControl)) return false;
    }
  }
  return true;
}

/** Restore validated insertion geometry without accumulating native export rounding on each reload. */
export function restoreCurveSamplingPoints(points, records) {
  records.forEach(record => {
    const startIndex = (record.endIndex - record.nodes.length + 1 + points.length) % points.length;
    record.nodes.forEach((node, offset) => {
      const point = points[(startIndex + offset) % points.length];
      Object.assign(point, copyPoint(node));
      if (offset) point.curveFrom = copyPoint(node.curveFrom);
    });
  });
  return points;
}

/** Validate optional native metadata rather than trusting an unrelated cached outline. */
export function parseCurveSampling(records, points) {
  const invalid = () => { throw new Error("Polygon curve sampling must describe unchanged subdivisions of its curve."); };
  if (!Array.isArray(records) || records.length > points.length) invalid();
  records.forEach(record => {
    if (!Array.isArray(record?.source) || record.source.length !== 3 || !record.source.every(finitePoint) ||
        !Array.isArray(record.nodes) || record.nodes.length < 3 || record.nodes.length > points.length ||
        !Array.isArray(record.parameters) || record.parameters.length !== record.nodes.length ||
        record.parameters[0] !== 0 || record.parameters.at(-1) !== 1 ||
        !record.parameters.every((t, index, values) => Number.isFinite(t) && t >= 0 && t <= 1 && (!index || t >= values[index - 1])) ||
        !getRun(record, points, true) || !sourceMatchesNodes(record)) invalid();
  });
  // Every shared endpoint must agree at full precision, and two records cannot own the same edge.
  const restored = restoreCurveSamplingPoints(points.map(clonePolygonPoint), records);
  if (getValidCurveSampling({ points: restored, curveSampling: records }).length !== records.length) invalid();
  return cloneCurveSampling(records);
}
