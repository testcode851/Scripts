import { parseCocoSegment } from "../geometry/polygon.js";
import { parseCurveSampling, restoreCurveSamplingPoints } from "../geometry/curve-sampling.js";
import { normalizeCalibration } from "../analytics/analytics-data.js";
import { createAnnotationId, createEllipseAnnotation, createPolygonAnnotation } from "../model/annotation.js";

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
  if (!Array.isArray(tuple) || tuple.length !== 2) {
    throw new Error("Polygon points must be [x, y] pairs.");
  }
  const [x, y] = tuple;
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
  const candidate = source?.ellipse !== undefined ? source.ellipse : (() => {
    if (!Array.isArray(source?.points) || source.points.length !== 2) {
      throw new Error("Ellipse points must contain one center pair and one radius pair.");
    }
    const center = parsePointTuple(source.points[0]);
    const radii = parsePointTuple(source.points[1]);
    return {
      cx: center.x,
      cy: center.y,
      rx: radii.x,
      ry: radii.y,
      rotation: 0,
    };
  })();
  const ellipse = {
    cx: candidate?.cx,
    cy: candidate?.cy,
    rx: candidate?.rx,
    ry: candidate?.ry,
    rotation: candidate?.rotation === undefined ? 0 : candidate.rotation,
  };
  if (![ellipse.cx, ellipse.cy, ellipse.rx, ellipse.ry, ellipse.rotation].every(Number.isFinite)) {
    throw new Error("Ellipse coordinates must be finite numbers.");
  }
  if (ellipse.rx <= 0 || ellipse.ry <= 0) {
    throw new Error("Ellipse radii must be greater than zero.");
  }
  return ellipse;
}

function validateImageSize(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Annotation image width and height must be positive finite numbers.");
  }
}

function parseNativeDocument(data) {
  if (Object.hasOwn(data, "imageWidth") || Object.hasOwn(data, "imageHeight")) {
    validateImageSize(data.imageWidth, data.imageHeight);
  }
  const annotations = data.shapes.map((shape) => {
    if (shape?.shape_type === "polygon") {
      if (Object.hasOwn(shape, "path_points") && !Array.isArray(shape.path_points)) {
        throw new Error("Polygon path_points must be an array of [x, y] pairs.");
      }
      const points = parsePolygonPoints(
        Array.isArray(shape.path_points) ? shape.path_points : shape.points
      );
      if (Object.hasOwn(shape, "curves")) {
        if (!Array.isArray(shape.curves)) {
          throw new Error("Polygon curves must be an array.");
        }
        const curvedPoints = new Set();
        shape.curves.forEach((curve) => {
          const pointIndex = curve?.to;
          if (!Number.isInteger(pointIndex) || !points[pointIndex] || curvedPoints.has(pointIndex)) {
            throw new Error("Each polygon curve must refer to a unique valid vertex index.");
          }
          points[pointIndex].curveFrom = parsePointTuple(curve.control);
          curvedPoints.add(pointIndex);
        });
      }
      const curveSampling = Object.hasOwn(shape, "curve_sampling")
        ? parseCurveSampling(shape.curve_sampling, points)
        : undefined;
      return createPolygonAnnotation({
        label: sanitizeLabel(shape.label),
        color: normalizeColor(shape.color),
        points: curveSampling ? restoreCurveSamplingPoints(points, curveSampling) : points,
        curveSampling,
      });
    }
    if (shape?.shape_type === "ellipse") {
      return createEllipseAnnotation({
        label: sanitizeLabel(shape.label, DEFAULT_ELLIPSE_LABEL),
        color: normalizeColor(shape.color),
        ellipse: parseEllipse(shape),
      });
    }
    throw new Error("Unsupported annotation shape: only polygons and ellipses can be imported.");
  });

  return {
    annotations,
    imageSize:
      Number.isFinite(data.imageWidth) && Number.isFinite(data.imageHeight)
        ? { width: data.imageWidth, height: data.imageHeight }
        : null,
    imageName: typeof data.imagePath === "string" ? data.imagePath : null,
    calibration: normalizeCalibration(data.calibration, { width: data.imageWidth, height: data.imageHeight }),
  };
}

function parseLegacyDocument(data) {
  for (const key of ["polygons", "ellipses"]) {
    if (Object.hasOwn(data, key) && !Array.isArray(data[key])) {
      throw new Error(`Legacy annotation ${key} must be an array.`);
    }
  }
  if (Object.hasOwn(data, "imageSize")) {
    validateImageSize(data.imageSize?.width, data.imageSize?.height);
  }
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
    calibration: null,
  };
}

function selectCocoImage(images, currentImageName) {
  const validImages = Array.isArray(images)
    ? images.filter((image) => image && typeof image === "object")
    : [];
  if (validImages.length === 0) return null;
  const matches = currentImageName
    ? validImages.filter((image) => image.file_name === currentImageName)
    : [validImages[0]];
  if (matches.length !== 1) {
    throw new Error("COCO import requires exactly one image filename matching the current image.");
  }
  const image = matches[0];
  if (!(Number.isFinite(image.id) || (typeof image.id === "string" && image.id.trim()))) {
    throw new Error("COCO import requires a valid image ID for the selected image.");
  }
  if (validImages.filter((entry) => entry.id === image.id).length !== 1) {
    throw new Error("COCO import requires a unique ID for the selected image.");
  }
  return image;
}

function parseCocoDocument(data, currentImageName, allowEmptyCoco) {
  const image = selectCocoImage(data.images, currentImageName);
  if (!image) throw new Error("COCO import requires at least one entry in images[].");
  validateImageSize(image.width, image.height);
  const partsByInstance = [];
  const imageIds = new Set(data.images.map((entry) => entry?.id));
  (Array.isArray(data.annotations) ? data.annotations : [])
    .forEach((annotation) => {
      const imageId = annotation?.image_id;
      if (!(Number.isFinite(imageId) || (typeof imageId === "string" && imageId.trim())) || !imageIds.has(imageId)) {
        throw new Error("Each COCO annotation must reference a valid image ID in images[].");
      }
      if (imageId !== image.id) return;
      if (!Array.isArray(annotation.segmentation) || annotation.segmentation.length === 0) {
        throw new Error("COCO import requires polygon segmentations for the selected image.");
      }
      const parts = annotation.segmentation.map((segment) => {
        if (!Array.isArray(segment) || !segment.every(Number.isFinite)) {
          throw new Error("COCO polygon coordinates must be finite numbers.");
        }
        const points = parseCocoSegment(segment);
        if (!points) {
          throw new Error("COCO import failed: no usable polygon segmentation; each segment needs at least three coordinate pairs.");
        }
        return points;
      });
      partsByInstance.push({ annotation, parts });
    });
  if (partsByInstance.length === 0 && !(allowEmptyCoco && data.annotations.length === 0)) {
    throw new Error("COCO import failed: no usable polygon segmentations found for the selected image.");
  }
  // Keep source classes and multipart membership separate from editable shape IDs.
  const categories = parseCocoCategories(data.categories);
  const instanceIds = new Set();
  const annotations = partsByInstance.flatMap(({ annotation, parts }) => {
    const categoryId = parseCocoId(annotation.category_id, "category reference");
    const category = categories.get(categoryId);
    if (!category) throw new Error("Each COCO annotation must reference a category defined in categories[].");
    let annotationId;
    if (Object.hasOwn(annotation, "id")) {
      annotationId = parseCocoId(annotation.id, "annotation ID");
      if (instanceIds.has(annotationId)) throw new Error("COCO annotation IDs must be unique for the selected image.");
      instanceIds.add(annotationId);
    }
    const coco = {
      instanceKey: createAnnotationId("coco-instance"),
      ...(annotationId === undefined ? {} : { annotationId }),
      categoryId,
      categoryName: category.name,
      ...(category.supercategory === undefined ? {} : { supercategory: category.supercategory }),
    };
    return parts.map(points => createPolygonAnnotation({ label: category.name, points, coco }));
  });
  return {
    annotations,
    imageSize: { width: image.width, height: image.height },
    imageName: typeof image.file_name === "string" ? image.file_name : null,
    calibration: normalizeCalibration(image.calibration, { width: image.width, height: image.height }),
  };
}

function parseCocoId(value, description) {
  // Older inputs may encode numeric IDs as strings. Normalize those explicitly,
  // without accepting null, booleans or empty strings as category zero.
  const id = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value;
  if (!Number.isSafeInteger(id) || id < 0) {
    throw new Error(`COCO ${description} must be a nonnegative safe integer.`);
  }
  return id;
}

function parseCocoCategories(value) {
  if (!Array.isArray(value)) throw new Error("COCO import requires categories[] with defined class IDs and names.");
  const categories = new Map();
  for (const category of value) {
    const id = parseCocoId(category?.id, "category ID");
    if (categories.has(id)) throw new Error("COCO category IDs must be unique.");
    if (typeof category.name !== "string" || !category.name.trim()) {
      throw new Error("Each COCO category must have a nonempty class name.");
    }
    if (Object.hasOwn(category, "supercategory") && typeof category.supercategory !== "string") {
      throw new Error("COCO category supercategory must be text.");
    }
    categories.set(id, { name: category.name.trim(), supercategory: category.supercategory });
  }
  return categories;
}

export function parseAnnotationDocument(data, { currentImageName = "", allowEmptyCoco = false } = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Annotation JSON must contain an object at the top level.");
  }
  let parsed;
  if (Object.hasOwn(data, "images") || Object.hasOwn(data, "annotations")) {
    if (!Array.isArray(data.images) || !Array.isArray(data.annotations)) {
      throw new Error("COCO import requires images[] and annotations[] arrays.");
    }
    parsed = parseCocoDocument(data, currentImageName, allowEmptyCoco);
  } else if (Object.hasOwn(data, "shapes")) {
    if (!Array.isArray(data.shapes)) throw new Error("Annotation shapes must be an array.");
    parsed = parseNativeDocument(data);
  } else if (Object.hasOwn(data, "polygons") || Object.hasOwn(data, "ellipses")) {
    parsed = parseLegacyDocument(data);
  } else {
    throw new Error("Unrecognized annotation JSON. Expected shapes[], legacy polygons/ellipses, or COCO images[] and annotations[].");
  }
  const lastAnnotation = parsed.annotations[parsed.annotations.length - 1];
  return {
    ...parsed,
    lastLabel: lastAnnotation?.label || DEFAULT_POLYGON_LABEL,
  };
}
