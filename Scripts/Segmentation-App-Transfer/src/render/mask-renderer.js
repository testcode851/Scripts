import { flattenPolygon } from "../geometry/polygon.js";
import { getSamplingPoints } from "../geometry/curve-sampling.js";
import { getAnnotationsByType } from "../model/annotation.js";

/** Draw one flattened polygon path into a mask context. */
export function drawMaskPolygon(context, points) {
  const flattenedPoints = flattenPolygon(points);
  if (flattenedPoints.length === 0) return;
  context.beginPath();
  flattenedPoints.forEach((point, index) => {
    if (index === 0) {
      context.moveTo(point.x, point.y);
    } else {
      context.lineTo(point.x, point.y);
    }
  });
  context.closePath();
  context.fill();
}

/** Draw one ellipse into a mask context. */
export function drawMaskEllipse(context, ellipse) {
  context.beginPath();
  context.ellipse(
    ellipse.cx,
    ellipse.cy,
    ellipse.rx,
    ellipse.ry,
    ellipse.rotation,
    0,
    Math.PI * 2
  );
  context.fill();
}

/** Force every rendered mask pixel to opaque black or white. */
export function enforceBinaryMask(context, width, height) {
  const imageData = context.getImageData(0, 0, width, height);
  const { data } = imageData;
  for (let index = 0; index < data.length; index += 4) {
    const value = data[index] > 127 ? 255 : 0;
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
    data[index + 3] = 255;
  }
  context.putImageData(imageData, 0, 0);
}

/** Own creation and binary rasterization of full-resolution segmentation masks. */
export function createMaskRenderer({ documentRoot }) {
  if (!documentRoot || typeof documentRoot.createElement !== "function") {
    throw new TypeError("Mask renderer requires a document-compatible root.");
  }

  function render({ imageSize, annotations, inverted = false }) {
    if (!imageSize) return null;
    const canvas = documentRoot.createElement("canvas");
    canvas.width = imageSize.width;
    canvas.height = imageSize.height;
    const context = canvas.getContext("2d");
    if (!context) return null;

    context.fillStyle = inverted ? "white" : "black";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = inverted ? "black" : "white";
    getAnnotationsByType(annotations, "polygon").forEach((annotation) => {
      drawMaskPolygon(context, getSamplingPoints(annotation.geometry));
    });
    getAnnotationsByType(annotations, "ellipse").forEach((annotation) => {
      drawMaskEllipse(context, annotation.geometry);
    });
    enforceBinaryMask(context, canvas.width, canvas.height);
    return canvas;
  }

  return Object.freeze({ render });
}
