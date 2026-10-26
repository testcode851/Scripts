import { clamp, round } from "../geometry/math.js";
import { normalizeCalibration } from "../analytics/analytics-data.js";
import { cloneCurveSampling, getSamplingPoints, getValidCurveSampling } from "../geometry/curve-sampling.js";
import { polygonUnionArea } from "../geometry/polygon-union-area.js";
import { validateCocoIdentityCollection } from "../model/coco-identity.js";
import { normalizeClassCatalog, validateCatalogAnnotations } from "../model/class-catalog.js";
import {
  clonePolygonPoint,
  flattenPolygon,
  getPolygonCurveMetadata,
  polygonArea,
  polygonBoundingBox,
} from "../geometry/polygon.js";

function fitPolygonForExport(points, imageSize) {
  const maxX = Math.max(0, imageSize.width - 1);
  const maxY = Math.max(0, imageSize.height - 1);
  return points.map((point) => {
    const clone = clonePolygonPoint(point);
    clone.x = clamp(clone.x, 0, maxX);
    clone.y = clamp(clone.y, 0, maxY);
    if (clone.curveFrom) {
      clone.curveFrom.x = clamp(clone.curveFrom.x, 0, maxX);
      clone.curveFrom.y = clamp(clone.curveFrom.y, 0, maxY);
    }
    return clone;
  });
}

function fitEllipseForExport(source, imageSize) {
  const ellipse = { ...source };
  const maxX = Math.max(0, imageSize.width - 1);
  const maxY = Math.max(0, imageSize.height - 1);
  const maxRx = maxX / 2;
  const maxRy = maxY / 2;
  if (ellipse.rx > maxRx || ellipse.ry > maxRy) {
    const scaleX = ellipse.rx > 0 ? maxRx / ellipse.rx : 1;
    const scaleY = ellipse.ry > 0 ? maxRy / ellipse.ry : 1;
    const scale = Math.min(1, scaleX, scaleY);
    ellipse.rx *= scale;
    ellipse.ry *= scale;
  }
  ellipse.cx = clamp(ellipse.cx, ellipse.rx, maxX - ellipse.rx);
  ellipse.cy = clamp(ellipse.cy, ellipse.ry, maxY - ellipse.ry);
  return ellipse;
}

function polygonAnnotations(annotations) {
  return annotations.filter((annotation) => annotation.type === "polygon");
}

export function exportLlnlDocument({
  annotations,
  imageName,
  imageBase64 = null,
  imageSize,
  displaySize,
  annotationTiming,
  calibration,
}) {
  // Preserve the original payload order: all polygons, then all ellipses.
  const orderedAnnotations = [
    ...polygonAnnotations(annotations),
    ...annotations.filter((annotation) => annotation.type === "ellipse"),
  ];
  return {
    version: "1.0",
    imagePath: imageName,
    image_base64: imageBase64,
    imageWidth: imageSize.width,
    imageHeight: imageSize.height,
    displaySize,
    annotationTiming,
    calibration: normalizeCalibration(calibration, imageSize),
    shapes: orderedAnnotations.map((annotation) => {
      if (annotation.type === "polygon") {
        const points = fitPolygonForExport(annotation.geometry.points, imageSize);
        const sampledPoints = fitPolygonForExport(getSamplingPoints(annotation.geometry), imageSize);
        const curveSampling = cloneCurveSampling(getValidCurveSampling({ ...annotation.geometry, points }));
        return {
          label: annotation.label,
          points: flattenPolygon(sampledPoints).map((point) => [round(point.x), round(point.y)]),
          path_points: points.map((point) => [round(point.x), round(point.y)]),
          group_id: null,
          shape_type: "polygon",
          color: annotation.color,
          curves: getPolygonCurveMetadata(points),
          ...(curveSampling.length ? { curve_sampling: curveSampling } : {}),
          flags: {},
        };
      }
      if (annotation.type === "ellipse") {
        const ellipse = fitEllipseForExport(annotation.geometry, imageSize);
        return {
          label: annotation.label,
          points: [[round(ellipse.cx), round(ellipse.cy)], [round(ellipse.rx), round(ellipse.ry)]],
          group_id: null,
          shape_type: "ellipse",
          color: annotation.color,
          flags: {},
          ellipse: {
            cx: round(ellipse.cx),
            cy: round(ellipse.cy),
            rx: round(ellipse.rx),
            ry: round(ellipse.ry),
            rotation: ellipse.rotation,
          },
        };
      }
      throw new TypeError(`Unsupported annotation type: ${annotation.type}`);
    }),
  };
}

export function exportCocoDocument({ annotations, imageName, imageBase64 = null, imageSize, annotationTiming, calibration, classCatalog }) {
  const reusableCatalog = classCatalog == null ? null : normalizeClassCatalog(classCatalog);
  validateCatalogAnnotations(reusableCatalog, annotations, { requireKnownLabels: true });
  const registeredCategories = reusableCatalog?.enabled
    ? new Map(reusableCatalog.classes.map(category => [category.name, category])) : null;
  const validPolygons = polygonAnnotations(annotations).filter((annotation) => {
    const points = annotation.geometry.points;
    return (
      Array.isArray(points) &&
      points.length >= 3 &&
      points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    );
  });
  validateCocoIdentityCollection(validPolygons);
  const sourceCategories = new Map();
  const usedInstanceIds = new Set();
  for (const { coco } of validPolygons) {
    if (!coco) continue;
    sourceCategories.set(coco.categoryId, {
      id: coco.categoryId, name: coco.categoryName, supercategory: coco.supercategory ?? "annotation",
    });
    if (coco.annotationId !== undefined) usedInstanceIds.add(coco.annotationId);
  }
  const usedCategoryIds = new Set(sourceCategories.keys());
  const generatedCategories = new Map();
  const categories = new Map();
  function nextId(used) {
    let id = 1;
    while (used.has(id)) id += 1;
    used.add(id);
    return id;
  }
  function categoryFor(annotation) {
    if (registeredCategories) {
      const registered = registeredCategories.get(annotation.label.trim());
      return { ...registered,
        supercategory: registered.supercategory ?? sourceCategories.get(registered.id)?.supercategory ?? "annotation" };
    }
    const source = annotation.coco;
    if (source && annotation.label === source.categoryName) return sourceCategories.get(source.categoryId);
    const matches = [...sourceCategories.values()].filter(category => category.name === annotation.label);
    if (matches.length > 1) {
      throw new Error(`Class "${annotation.label}" matches multiple COCO category IDs. Use a distinct label for this new or renamed shape before exporting.`);
    }
    if (matches.length === 1) return matches[0];
    if (!generatedCategories.has(annotation.label)) {
      generatedCategories.set(annotation.label, {
        id: nextId(usedCategoryIds), name: annotation.label, supercategory: "annotation",
      });
    }
    return generatedCategories.get(annotation.label);
  }
  const groups = [];
  const instanceGroups = new Map();
  for (const annotation of validPolygons) {
    const category = categoryFor(annotation);
    categories.set(category.id, category);
    const key = annotation.coco?.instanceKey || annotation;
    if (!instanceGroups.has(key)) instanceGroups.set(key, new Map());
    const byCategory = instanceGroups.get(key);
    if (!byCategory.has(category.id)) {
      const group = { categoryId: category.id, source: annotation.coco, parts: [] };
      byCategory.set(category.id, group);
      groups.push(group);
    }
    byCategory.get(category.id).parts.push(annotation);
  }
  // Relabeling one editable part must not relabel the rest of its instance.
  // Keep the source ID on the original class, or the first remaining group.
  for (const byCategory of instanceGroups.values()) {
    const first = byCategory.values().next().value;
    if (first.source?.annotationId === undefined) continue;
    const owner = byCategory.get(first.source.categoryId) || first;
    owner.id = first.source.annotationId;
  }
  const cocoAnnotations = groups.map(group => {
    const parts = group.parts.map(annotation => flattenPolygon(
      fitPolygonForExport(getSamplingPoints(annotation.geometry), imageSize)
    ));
    const bounds = polygonBoundingBox(parts.flat());
    return {
      id: group.id ?? nextId(usedInstanceIds),
      image_id: 1,
      category_id: group.categoryId,
      segmentation: parts.map(points => points.map(point => [round(point.x), round(point.y)]).flat()),
      area: round(parts.length === 1 ? polygonArea(parts[0])
        : polygonUnionArea(parts.map(points => points.flatMap(point => [point.x, point.y])))),
      bbox: [round(bounds.x), round(bounds.y), round(bounds.width), round(bounds.height)],
      iscrowd: 0,
    };
  });
  return {
    info: { version: "1.0", description: "Exported from Image Annotation Starter" },
    image_base64: imageBase64,
    licenses: [],
    images: [{
      id: 1,
      file_name: imageName,
      width: imageSize.width,
      height: imageSize.height,
      annotationTiming,
      calibration: normalizeCalibration(calibration, imageSize),
    }],
    annotations: cocoAnnotations,
    categories:
      categories.size > 0
        ? [...categories.values()]
        : registeredCategories ? [] : [{ id: 1, name: "polygon", supercategory: "annotation" }],
  };
}
