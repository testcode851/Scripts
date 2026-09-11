import { clamp, round } from "../geometry/math.js";
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
  imageSize,
  displaySize,
  annotationTiming,
}) {
  // Preserve the original payload order: all polygons, then all ellipses.
  const orderedAnnotations = [
    ...polygonAnnotations(annotations),
    ...annotations.filter((annotation) => annotation.type === "ellipse"),
  ];
  return {
    version: "1.0",
    imagePath: imageName,
    imageWidth: imageSize.width,
    imageHeight: imageSize.height,
    displaySize,
    annotationTiming,
    shapes: orderedAnnotations.map((annotation) => {
      if (annotation.type === "polygon") {
        const points = fitPolygonForExport(annotation.geometry.points, imageSize);
        return {
          label: annotation.label,
          points: flattenPolygon(points).map((point) => [round(point.x), round(point.y)]),
          path_points: points.map((point) => [round(point.x), round(point.y)]),
          group_id: null,
          shape_type: "polygon",
          color: annotation.color,
          curves: getPolygonCurveMetadata(points),
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

export function exportCocoDocument({ annotations, imageName, imageSize, annotationTiming }) {
  const categoryIdByLabel = new Map();
  const categories = [];
  const validPolygons = polygonAnnotations(annotations).filter((annotation) => {
    const points = annotation.geometry.points;
    return (
      Array.isArray(points) &&
      points.length >= 3 &&
      points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    );
  });
  const cocoAnnotations = validPolygons.map((annotation, index) => {
    const points = flattenPolygon(fitPolygonForExport(annotation.geometry.points, imageSize));
    if (!categoryIdByLabel.has(annotation.label)) {
      const id = categoryIdByLabel.size + 1;
      categoryIdByLabel.set(annotation.label, id);
      categories.push({ id, name: annotation.label, supercategory: "annotation" });
    }
    const bounds = polygonBoundingBox(points);
    return {
      id: index + 1,
      image_id: 1,
      category_id: categoryIdByLabel.get(annotation.label),
      segmentation: [points.map((point) => [round(point.x), round(point.y)]).flat()],
      area: round(polygonArea(points)),
      bbox: [round(bounds.x), round(bounds.y), round(bounds.width), round(bounds.height)],
      iscrowd: 0,
    };
  });
  return {
    info: { version: "1.0", description: "Exported from Image Annotation Starter" },
    licenses: [],
    images: [{
      id: 1,
      file_name: imageName,
      width: imageSize.width,
      height: imageSize.height,
      annotationTiming,
    }],
    annotations: cocoAnnotations,
    categories:
      categories.length > 0
        ? categories
        : [{ id: 1, name: "polygon", supercategory: "annotation" }],
  };
}
