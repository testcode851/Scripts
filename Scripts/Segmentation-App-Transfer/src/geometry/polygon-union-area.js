function cross(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

function intersectionX(first, second) {
  if (first.maxX < second.minX || second.maxX < first.minX
    || first.maxY < second.minY || second.maxY < first.minY) return null;
  const denominator = cross(first.dx, first.dy, second.dx, second.dy);
  if (denominator === 0) return null;
  const qx = second.x - first.x;
  const qy = second.y - first.y;
  const t = cross(qx, qy, second.dx, second.dy) / denominator;
  const u = cross(qx, qy, first.dx, first.dy) / denominator;
  const tolerance = Number.EPSILON * 8;
  if (t < -tolerance || t > 1 + tolerance || u < -tolerance || u > 1 + tolerance
    || !Number.isFinite(t) || !Number.isFinite(u)) return null;
  // Keep intersection rounding inside the edges' overlapping x range.
  return Math.max(first.minX, second.minX,
    Math.min(first.maxX, second.maxX, first.x + t * first.dx));
}

function polygonIntervals(edges, left, right) {
  const crossings = [];
  for (const edge of edges) {
    if (edge.minX > left || edge.maxX < right) continue;
    const leftY = edge.y + ((left - edge.x) / edge.dx) * edge.dy;
    const rightY = edge.y + ((right - edge.x) / edge.dx) * edge.dy;
    crossings.push({ y: (leftY + rightY) / 2, winding: edge.dx > 0 ? 1 : -1 });
  }
  crossings.sort((a, b) => a.y - b.y);
  const intervals = [];
  let winding = 0;
  let start = 0;
  for (let index = 0; index < crossings.length;) {
    const y = crossings[index].y;
    const previous = winding;
    do { winding += crossings[index++].winding; } while (index < crossings.length && crossings[index].y === y);
    if (previous === 0 && winding !== 0) start = y;
    else if (previous !== 0 && winding === 0 && y > start) intervals.push([start, y]);
  }
  return intervals;
}

function unionLength(intervals) {
  intervals.sort((a, b) => a[0] - b[0]);
  let length = 0;
  let start = 0;
  let end = 0;
  let first = true;
  for (const interval of intervals) {
    if (first) {
      [start, end] = interval;
      first = false;
    } else if (interval[0] <= end) {
      end = Math.max(end, interval[1]);
    } else {
      length += end - start;
      [start, end] = interval;
    }
  }
  return first ? 0 : length + end - start;
}

/**
 * Geometric union area of flattened polygon arrays, using nonzero fill per polygon.
 * Slab boundaries include vertices and edge intersections, so covered height is
 * linear inside each slab and midpoint integration is exact apart from rounding.
 * Export-only: pairwise intersections are quadratic, and rescanning every slab
 * can be cubic for heavily self-intersecting inputs. Input arrays stay untouched.
 */
export function polygonUnionArea(polygons) {
  if (!Array.isArray(polygons)) throw new TypeError("Polygons must be an array of coordinate arrays.");
  const components = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length % 2 !== 0) {
      throw new TypeError("Polygon coordinates must be finite x/y pairs.");
    }
    for (const value of polygon) if (!Number.isFinite(value)) throw new TypeError("Polygon coordinates must be finite x/y pairs.");
    if (polygon.length < 6) continue;
    components.push(polygon);
    for (let index = 0; index < polygon.length; index += 2) {
      minX = Math.min(minX, polygon[index]);
      maxX = Math.max(maxX, polygon[index]);
      minY = Math.min(minY, polygon[index + 1]);
      maxY = Math.max(maxY, polygon[index + 1]);
    }
  }
  if (!components.length || minX === maxX || minY === maxY) return 0;
  const width = maxX - minX;
  const height = maxY - minY;
  if (!Number.isFinite(width) || !Number.isFinite(height)) throw new RangeError("Polygon bounds exceed the supported numeric range.");

  // Translation and axis normalization keep cross products stable for image coordinates.
  const breakpoints = new Set();
  const allEdges = [];
  const edgeGroups = components.map(polygon => {
    const edges = [];
    for (let index = 0; index < polygon.length; index += 2) {
      const next = (index + 2) % polygon.length;
      const x = (polygon[index] - minX) / width;
      const y = (polygon[index + 1] - minY) / height;
      const endX = (polygon[next] - minX) / width;
      const endY = (polygon[next + 1] - minY) / height;
      breakpoints.add(x);
      // A vertical edge cannot cross a slab interior; its x is already a boundary.
      if (x === endX) continue;
      const edge = { x, y, dx: endX - x, dy: endY - y,
        minX: Math.min(x, endX), maxX: Math.max(x, endX),
        minY: Math.min(y, endY), maxY: Math.max(y, endY) };
      edges.push(edge);
      allEdges.push(edge);
    }
    return edges;
  });
  allEdges.sort((a, b) => a.minX - b.minX);
  for (let first = 0; first < allEdges.length; first += 1) {
    for (let second = first + 1; second < allEdges.length && allEdges[second].minX <= allEdges[first].maxX; second += 1) {
      const x = intersectionX(allEdges[first], allEdges[second]);
      if (x !== null) breakpoints.add(x);
    }
  }
  // Do not epsilon-merge nearby x values: narrow valid components must retain area.
  const positions = [...breakpoints].sort((a, b) => a - b);
  let normalizedArea = 0;
  let compensation = 0;
  for (let index = 1; index < positions.length; index += 1) {
    const left = positions[index - 1];
    const right = positions[index];
    const intervals = [];
    for (const edges of edgeGroups) {
      for (const interval of polygonIntervals(edges, left, right)) intervals.push(interval);
    }
    const contribution = (right - left) * unionLength(intervals) - compensation;
    const nextArea = normalizedArea + contribution;
    compensation = (nextArea - normalizedArea) - contribution;
    normalizedArea = nextArea;
  }
  const area = (Math.max(0, Math.min(1, normalizedArea)) * width) * height;
  if (!Number.isFinite(area)) throw new RangeError("Polygon area exceeds the supported numeric range.");
  return area;
}
