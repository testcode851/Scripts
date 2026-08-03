export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

/** Divide an axis into complete cell groups while staying near the requested size. */
export function getFittedGridAxis(length, targetSpacing, groupSize = 1) {
  if (!Number.isFinite(length) || length <= 0) {
    return { divisions: 0, spacing: 0 };
  }
  if (!Number.isFinite(targetSpacing) || targetSpacing <= 0) {
    return { divisions: 0, spacing: 0 };
  }
  const normalizedGroupSize = Number.isFinite(groupSize)
    ? Math.max(1, Math.round(groupSize))
    : 1;
  const groupCount = Math.max(
    1,
    Math.round(length / targetSpacing / normalizedGroupSize)
  );
  const divisions = groupCount * normalizedGroupSize;
  return {
    divisions,
    spacing: length / divisions,
  };
}
