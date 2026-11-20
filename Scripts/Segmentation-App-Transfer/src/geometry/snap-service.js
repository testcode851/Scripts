import { clamp, getFittedGridAxis } from "./math.js";
import { findNativeEdge } from "./native-edge-snap.js";

/** Own the configurable image-space snapping pipeline. */
export function createSnapService({
  settingsState,
  coordinates,
  getActiveImageAnalysis,
}) {
  function applyGridSnap(point) {
    if (!settingsState.gridSize) return point;
    const bounds = coordinates.getImageBounds();
    if (!bounds) {
      return {
        x: Math.round(point.x / settingsState.gridSize) * settingsState.gridSize,
        y: Math.round(point.y / settingsState.gridSize) * settingsState.gridSize,
      };
    }
    const horizontalGrid = getFittedGridAxis(
      bounds.maxX - bounds.minX + 1,
      settingsState.gridSize,
      settingsState.gridMajorEvery
    );
    const verticalGrid = getFittedGridAxis(
      bounds.maxY - bounds.minY + 1,
      settingsState.gridSize,
      settingsState.gridMajorEvery
    );
    return {
      x:
        Math.round((point.x - bounds.minX) / horizontalGrid.spacing) *
          horizontalGrid.spacing +
        bounds.minX,
      y:
        Math.round((point.y - bounds.minY) / verticalGrid.spacing) *
          verticalGrid.spacing +
        bounds.minY,
    };
  }

  function applyBorderSnap(point) {
    const bounds = coordinates.getImageBounds();
    if (!bounds) return point;
    const threshold = Math.max(0, settingsState.snapBorderThreshold);
    let { x, y } = point;
    if (x <= threshold) x = bounds.minX;
    else if (x >= bounds.maxX - threshold) x = bounds.maxX;
    if (y <= threshold) y = bounds.minY;
    else if (y >= bounds.maxY - threshold) y = bounds.maxY;
    return { x, y };
  }

  function applyEdgeSnap(point, analysis) {
    const radius = Math.max(1, Math.round(settingsState.snapRadius));
    const anchorX = clamp(Math.round(point.x), 0, analysis.width - 1);
    const anchorY = clamp(Math.round(point.y), 0, analysis.height - 1);
    const minX = Math.max(1, anchorX - radius);
    const maxX = Math.min(analysis.width - 2, anchorX + radius);
    const minY = Math.max(1, anchorY - radius);
    const maxY = Math.min(analysis.height - 2, anchorY + radius);
    const threshold = settingsState.snapEdgeThreshold;
    if (analysis.bitDepth === 16) {
      return findNativeEdge(point, analysis, { minX, maxX, minY, maxY, anchorX, anchorY }, threshold);
    }
    let bestX = anchorX;
    let bestY = anchorY;
    let bestScore = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const score = analysis.gradient[y * analysis.width + x];
        if (score < threshold) continue;
        const distance = Math.hypot(x - anchorX, y - anchorY);
        if (
          score > bestScore ||
          (score === bestScore && distance < bestDistance)
        ) {
          bestScore = score;
          bestDistance = distance;
          bestX = x;
          bestY = y;
        }
      }
    }
    return bestScore < 0 ? point : { x: bestX, y: bestY };
  }

  function applyExtremaSnap(point, analysis) {
    const radius = Math.max(1, Math.round(settingsState.snapRadius));
    const anchorX = clamp(Math.round(point.x), 0, analysis.width - 1);
    const anchorY = clamp(Math.round(point.y), 0, analysis.height - 1);
    const minX = Math.max(0, anchorX - radius);
    const maxX = Math.min(analysis.width - 1, anchorX + radius);
    const minY = Math.max(0, anchorY - radius);
    const maxY = Math.min(analysis.height - 1, anchorY + radius);
    const anchorValue = analysis.gray[anchorY * analysis.width + anchorX];
    const mode = settingsState.snapExtremaMode === "max" ? "max" : "min";
    let bestX = anchorX;
    let bestY = anchorY;
    let bestValue = anchorValue;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const value = analysis.gray[y * analysis.width + x];
        const distance = Math.hypot(x - anchorX, y - anchorY);
        const isBetter =
          mode === "max" ? value > bestValue : value < bestValue;
        const sameValueCloser =
          value === bestValue && distance < bestDistance;
        if (isBetter || sameValueCloser) {
          bestValue = value;
          bestDistance = distance;
          bestX = x;
          bestY = y;
        }
      }
    }
    const delta = Math.abs(bestValue - anchorValue);
    if (
      (bestX === anchorX && bestY === anchorY) ||
      delta < settingsState.snapExtremaDelta * (analysis.thresholdScale ?? 1)
    ) {
      return point;
    }
    return { x: bestX, y: bestY };
  }

  function applySnap(point) {
    let snappedPoint = coordinates.clampPointToImage(point);
    if (!settingsState.snapEnabled) return snappedPoint;
    if (settingsState.smartSnapEnabled) {
      if (settingsState.snapToBorder) {
        snappedPoint = applyBorderSnap(snappedPoint);
      }
      const analysis = getActiveImageAnalysis();
      if (analysis && settingsState.snapToEdge) {
        snappedPoint = applyEdgeSnap(snappedPoint, analysis);
      }
      if (analysis && settingsState.snapToExtrema) {
        snappedPoint = applyExtremaSnap(snappedPoint, analysis);
      }
    }
    if (settingsState.gridEnabled) {
      snappedPoint = applyGridSnap(snappedPoint);
    }
    if (settingsState.smartSnapEnabled && settingsState.snapToBorder) {
      snappedPoint = applyBorderSnap(snappedPoint);
    }
    return coordinates.clampPointToImage(snappedPoint);
  }

  return Object.freeze({
    applyBorderSnap,
    applyEdgeSnap,
    applyExtremaSnap,
    applyGridSnap,
    applySnap,
  });
}
