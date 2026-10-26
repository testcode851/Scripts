const WIDTH_FIELDS = ["mean", "median", "std", "min", "max"];

/** Accept calibration only for the image dimensions it was recorded against. */
export function normalizeCalibration(value, imageSize) {
  if (!value || !["manual", "reference", "benchmark"].includes(value.source)) return null;
  const scale = Number(value.umPerPixel);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  if (!imageSize || value.imageWidth !== imageSize.width || value.imageHeight !== imageSize.height) return null;
  const calibration = {
    version: 1, source: value.source, umPerPixel: scale,
    imageWidth: imageSize.width, imageHeight: imageSize.height,
  };
  if (value.source === "reference") {
    const reference = value.reference;
    if (!reference || !["current", "upload"].includes(reference.source)) return null;
    if (reference.source === "upload" && reference.sameAcquisition !== true) return null;
    const points = reference.points;
    if (!Array.isArray(points) || points.length !== 2 ||
        !points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) return null;
    const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
    const known = Number(reference.knownDistanceUm);
    if (!(distance > 0) || !Number.isFinite(known) || known <= 0 ||
        Math.abs(known / distance - scale) > Math.max(scale * 1e-8, 1e-12)) return null;
    calibration.reference = {
      source: reference.source, imageName: String(reference.imageName || ""),
      points: points.map(({ x, y }) => ({ x, y })),
      pixelDistance: distance, knownDistanceUm: known,
      sameAcquisition: reference.source === "current" || reference.sameAcquisition === true,
    };
  }
  return calibration;
}

export function measurementUnits(calibration) {
  const scale = calibration?.umPerPixel;
  return Number.isFinite(scale) && scale > 0
    ? { scale, suffix: "um", symbol: "µm" }
    : { scale: 1, suffix: "px", symbol: "px" };
}

export function scaleWidth(value, calibration) {
  return Number.isFinite(value) ? value * measurementUnits(calibration).scale : null;
}

export function resultColumns(calibration) {
  const { suffix } = measurementUnits(calibration);
  return ["image_id", "strand_id", "n_measurements", "low_transect_count",
    ...WIDTH_FIELDS.map((name) => `${name}_${suffix}`),
    "centroid_y_px", "centroid_x_px", "strand_area_px"];
}

export function resultRows(result, calibration) {
  return (result?.per_strand || []).map((strand) => [
    result.image_id, strand.strand_id, strand.n_measurements,
    strand.low_transect_count ? "TRUE" : "FALSE",
    ...WIDTH_FIELDS.map((name) => scaleWidth(strand[`${name}_px`], calibration)),
    strand.centroid_y_px, strand.centroid_x_px, strand.strand_area_px,
  ]);
}

export function csvCell(value) {
  if (value == null || (typeof value === "number" && !Number.isFinite(value))) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function resultsCsv(result, calibration) {
  return [resultColumns(calibration), ...resultRows(result, calibration)]
    .map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function referenceCalibration({ points, knownDistanceUm, imageSize, source, imageName, sameAcquisition }) {
  const pixelDistance = points.length === 2
    ? Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) : 0;
  return normalizeCalibration({
    source: "reference", umPerPixel: Number(knownDistanceUm) / pixelDistance,
    imageWidth: imageSize?.width, imageHeight: imageSize?.height,
    reference: { source, imageName, sameAcquisition, points, pixelDistance, knownDistanceUm: Number(knownDistanceUm) },
  }, imageSize);
}

export function displayNumber(value, digits = 3) {
  return Number.isFinite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: digits }) : "—";
}

/** Geometry and labels affect the selected mask; UI selection and annotation colors do not. */
export function measurementKey(imageState, annotations, label) {
  return JSON.stringify([imageState.revision ?? 0, imageState.imageName, imageState.imageSize, label,
    annotations.filter((item) => !label || item.label === label)
      .map(({ type, label: annotationLabel, geometry }) => [type, annotationLabel, geometry])]);
}
