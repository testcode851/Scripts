import { parseCocoSegment } from "../geometry/polygon.js";
import { createEllipseAnnotation, createPolygonAnnotation } from "../model/annotation.js";

const DEFAULT_POLYGON_LABEL = "polygon";
const DEFAULT_ELLIPSE_LABEL = "ellipse";

function sanitizeLabel(value, fallback = DEFAULT_POLYGON_LABEL) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || fallback;
}

function normalizeColor(value) {
  const match = /^#?([0-9a-f]{6})$/i.exec(typeof value === "string" ? value.trim() : "");
  return match ? `#${match[1].toLowerCase()}` : "";
}

function parsePointTuple(tuple) {
  if (!Array.isArray(tuple) || tuple.length < 2) {
    throw new Error("Polygon points must be [x, y] pairs.");
  }
  const x = Number(tuple[0]);
  const y = Number(tuple[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("Polygon coordinates must be finite numbers.");
  }
  return { x, y };
}

function parsePolygonPoints(sourcePoints) {
  if (!Array.isArray(sourcePoints) || sourcePoints.length < 3) {
    throw new Error("Each polygon must contain at least three points.");
  }
  return sourcePoints.map(parsePointTuple);
}

function parseEllipse(source) {
  const candidate = source?.ellipse || (() => {
    if (!Array.isArray(source?.points) || source.points.length < 2) return null;
    return {
      cx: source.points[0]?.[0],
      cy: source.points[0]?.[1],
      rx: source.points[1]?.[0],
      ry: source.points[1]?.[1],
      rotation: 0,
    };
  })();
  const ellipse = {
    cx: Number(candidate?.cx),
    cy: Number(candidate?.cy),
    rx: Number(candidate?.rx),
    ry: Number(candidate?.ry),
    rotation: Number(candidate?.rotation ?? 0),
  };
  if (![ellipse.cx, ellipse.cy, ellipse.rx, ellipse.ry, ellipse.rotation].every(Number.isFinite)) {
    throw new Error("Ellipse coordinates must be finite numbers.");
  }
  return ellipse;
}

function parseNativeDocument(data) {
  const annotations = data.shapes.map((shape) => {
    if (shape?.shape_type === "polygon") {
      const points = parsePolygonPoints(
        Array.isArray(shape.path_points) ? shape.path_points : shape.points
      );
      if (Array.isArray(shape.curves)) {
        shape.curves.forEach((curve) => {
          const pointIndex = Number(curve?.to);
          if (!Number.isInteger(pointIndex) || !points[pointIndex] || !Array.isArray(curve.control)) {
            return;
          }
          points[pointIndex].curveFrom = parsePointTuple(curve.control);
        });
      }
      return createPolygonAnnotation({
        label: sanitizeLabel(shape.label),
        color: normalizeColor(shape.color),
        points,
      });
    }
    if (shape?.shape_type === "ellipse") {
      return createEllipseAnnotation({
        label: sanitizeLabel(shape.label, DEFAULT_ELLIPSE_LABEL),
        color: normalizeColor(shape.color),
        ellipse: parseEllipse(shape),
      });
    }
    return null;
  }).filter(Boolean);

  return {
    annotations,
    imageSize:
      Number.isFinite(data.imageWidth) && Number.isFinite(data.imageHeight)
        ? { width: data.imageWidth, height: data.imageHeight }
        : null,
    imageName: typeof data.imagePath === "string" ? data.imagePath : null,
  };
}

function parseLegacyDocument(data) {
  const polygons = Array.isArray(data.polygons) ? data.polygons : [];
  const ellipses = Array.isArray(data.ellipses) ? data.ellipses : [];
  const polygonLabels = Array.isArray(data.polygonLabels) ? data.polygonLabels : [];
  const polygonColors = Array.isArray(data.polygonColors) ? data.polygonColors : [];
  const ellipseLabels = Array.isArray(data.ellipseLabels) ? data.ellipseLabels : [];
  const ellipseColors = Array.isArray(data.ellipseColors) ? data.ellipseColors : [];
  const annotations = [
    ...polygons.map((polygon, index) =>
      createPolygonAnnotation({
        label: sanitizeLabel(polygonLabels[index]),
        color: normalizeColor(polygonColors[index]),
        points: parsePolygonPoints(polygon),
      })
    ),
    ...ellipses.map((ellipse, index) =>
      createEllipseAnnotation({
        label: sanitizeLabel(ellipseLabels[index] || ellipse?.label, DEFAULT_ELLIPSE_LABEL),
        color: normalizeColor(ellipseColors[index] || ellipse?.color),
        ellipse: parseEllipse({ ellipse }),
      })
    ),
  ];
  const size = data.imageSize;
  return {
    annotations,
    imageSize:
      Number.isFinite(size?.width) && Number.isFinite(size?.height)
        ? { width: size.width, height: size.height }
        : null,
    imageName: null,
  };
}

function selectCocoImage(images, currentImageName) {
  const validImages = Array.isArray(images)
    ? images.filter((image) => image && typeof image === "object")
    : [];
  return validImages.find((image) => image.file_name === currentImageName) || validImages[0] || null;
}

function parseCocoDocument(data, currentImageName) {
  const image = selectCocoImage(data.images, currentImageName);
  if (!image) throw new Error("COCO import requires at least one entry in images[].");
  if (!Number.isFinite(image.width) || !Number.isFinite(image.height)) {
    throw new Error("COCO import requires selected image width and height.");
  }
  const names = new Map(
    (Array.isArray(data.categories) ? data.categories : [])
      .filter((category) => Number.isFinite(Number(category?.id)))
      .map((category) => [Number(category.id), sanitizeLabel(category.name)])
  );
  const annotations = [];
  (Array.isArray(data.annotations) ? data.annotations : [])
    .filter((annotation) => image.id === undefined || annotation?.image_id === image.id)
    .forEach((annotation) => {
      (Array.isArray(annotation?.segmentation) ? annotation.segmentation : []).forEach((segment) => {
        const points = parseCocoSegment(segment);
        if (points) {
          annotations.push(createPolygonAnnotation({
            label: names.get(Number(annotation.category_id)) || DEFAULT_POLYGON_LABEL,
            points,
          }));
        }
      });
    });
  if (annotations.length === 0) {
    throw new Error("COCO import failed: no usable polygon segmentations found for the selected image.");
  }
  return {
    annotations,
    imageSize: { width: image.width, height: image.height },
    imageName: typeof image.file_name === "string" ? image.file_name : null,
  };
}

export function parseAnnotationDocument(data, { currentImageName = "" } = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Annotation JSON must contain an object at the top level.");
  }
  let parsed;
  if (Array.isArray(data.images) && Array.isArray(data.annotations)) {
    parsed = parseCocoDocument(data, currentImageName);
  } else if (Array.isArray(data.shapes)) {
    parsed = parseNativeDocument(data);
  } else {
    parsed = parseLegacyDocument(data);
  }
  const lastAnnotation = parsed.annotations[parsed.annotations.length - 1];
  return {
    ...parsed,
    lastLabel: lastAnnotation?.label || DEFAULT_POLYGON_LABEL,
  };
}
