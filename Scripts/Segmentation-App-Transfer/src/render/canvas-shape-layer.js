import { clamp } from "../geometry/math.js";
import { rgbToCss } from "../utils/colors.js";
import { ellipseIntersectsViewport, polygonIntersectsViewport } from "./canvas-visibility.js";

/** Build the contrast-adjusted stroke and fill used by annotation previews. */
export function getMaskPreviewStyle(baseColor, maskContrast, fillAlpha = 0.12) {
  const contrastFactor = clamp(maskContrast / 100, 0.5, 2);
  const strokeR = clamp(Math.round((baseColor.r - 128) * contrastFactor + 128), 0, 255);
  const strokeG = clamp(Math.round((baseColor.g - 128) * contrastFactor + 128), 0, 255);
  const strokeB = clamp(Math.round((baseColor.b - 128) * contrastFactor + 128), 0, 255);
  const adjustedFillAlpha = clamp(fillAlpha * contrastFactor, 0.04, 0.35);
  return {
    stroke: `rgb(${strokeR}, ${strokeG}, ${strokeB})`,
    fill: `rgba(${strokeR}, ${strokeG}, ${strokeB}, ${adjustedFillAlpha})`,
  };
}

/** Return the center and four resize handles for an ellipse. */
export function getEllipseHandles(ellipse) {
  return [
    { type: "center", x: ellipse.cx, y: ellipse.cy },
    { type: "right", x: ellipse.cx + ellipse.rx, y: ellipse.cy },
    { type: "left", x: ellipse.cx - ellipse.rx, y: ellipse.cy },
    { type: "top", x: ellipse.cx, y: ellipse.cy - ellipse.ry },
    { type: "bottom", x: ellipse.cx, y: ellipse.cy + ellipse.ry },
  ];
}

/** Paint polygon and ellipse primitives, including editable handles. */
export function createCanvasShapeLayer({
  context,
  interactionState,
  settingsState,
  coordinates,
  getPolygonBaseColor,
  isVertexSelected,
  ellipseBaseColor,
}) {
  const { scaleEllipse, scalePoint } = coordinates;

  function drawPolygon(points, options = {}) {
    if (points.length === 0) return;
    const overlayOpacity = options.opacity ?? settingsState.maskOpacity / 100;
    const baseColor = options.baseColor || getPolygonBaseColor(options.polygonIndex, options.annotation);
    // Resolve colors first: even offscreen labels must keep their palette order.
    if (!polygonIntersectsViewport(points, options.viewport)) return;
    if (options.regions && !options.regions.some(region => polygonIntersectsViewport(points, region))) return;
    const previewStyle = getMaskPreviewStyle(baseColor, settingsState.maskContrast);
    const isSelectedAnnotation = Boolean(options.selectedAnnotation);
    context.save();
    context.globalAlpha = overlayOpacity;
    context.strokeStyle = options.stroke ?? previewStyle.stroke;
    context.lineWidth = options.lineWidth ?? (isSelectedAnnotation ? 3 : 2);
    context.fillStyle = options.fill ?? previewStyle.fill;
    context.beginPath();
    const scaledPoints = points.map((point) => ({
      ...scalePoint(point),
      curveFrom: point.curveFrom ? scalePoint(point.curveFrom) : null,
    }));
    scaledPoints.forEach((point, index) => {
      if (index === 0) {
        context.moveTo(point.x, point.y);
      } else if (point.curveFrom) {
        context.quadraticCurveTo(point.curveFrom.x, point.curveFrom.y, point.x, point.y);
      } else {
        context.lineTo(point.x, point.y);
      }
    });
    if (options.closed && scaledPoints.length > 1) {
      const firstPoint = scaledPoints[0];
      if (firstPoint.curveFrom) {
        context.quadraticCurveTo(
          firstPoint.curveFrom.x,
          firstPoint.curveFrom.y,
          firstPoint.x,
          firstPoint.y
        );
      }
      context.closePath();
      context.fill();
    }
    context.stroke();
    if (!options.noVertices) {
      context.globalAlpha = 1;
      let handleColor;
      scaledPoints.forEach((scaledPoint, index) => {
        const isActive =
          interactionState.activeVertex?.polygonIndex === options.polygonIndex &&
          interactionState.activeVertex?.pointIndex === index;
        // Saved shapes already provide their owner; drafts retain index-based selection.
        const isSelected = options.annotation
          ? interactionState.selectedVertexKeys.has(options.annotation.id ? `${options.annotation.id}|${index}` : "")
          : isVertexSelected(options.polygonIndex, index);
        context.beginPath();
        context.arc(scaledPoint.x, scaledPoint.y, isActive ? 6 : 4, 0, Math.PI * 2);
        context.fillStyle = isActive
          ? "#16a34a"
          : isSelected
            ? "#0ea5e9"
            : (handleColor ??= rgbToCss(baseColor));
        context.fill();
      });
      scaledPoints.forEach((point, index) => {
        if (!point.curveFrom) return;
        const controlPoint = point.curveFrom;
        const isActive =
          interactionState.activeVertex?.polygonIndex === options.polygonIndex &&
          interactionState.activeVertex?.pointIndex === index &&
          interactionState.activeVertex?.controlType === "curveFrom";
        context.save();
        context.translate(controlPoint.x, controlPoint.y);
        context.rotate(Math.PI / 4);
        context.beginPath();
        const handleSize = isActive ? 10 : 8;
        context.rect(-handleSize / 2, -handleSize / 2, handleSize, handleSize);
        context.fillStyle = isActive ? "#16a34a" : "#f59e0b";
        context.fill();
        context.restore();
      });
    }
    context.restore();
  }

  function drawEllipse(ellipse, options = {}) {
    const overlayOpacity = options.opacity ?? settingsState.maskOpacity / 100;
    const baseColor = options.baseColor || ellipseBaseColor;
    if (!ellipseIntersectsViewport(ellipse, options.viewport)) return;
    if (options.regions && !options.regions.some(region => ellipseIntersectsViewport(ellipse, region))) return;
    const scaledEllipse = scaleEllipse(ellipse);
    const previewStyle = getMaskPreviewStyle(baseColor, settingsState.maskContrast);
    const isSelectedAnnotation = Boolean(options.selectedAnnotation);
    context.save();
    context.globalAlpha = overlayOpacity;
    context.strokeStyle =
      options.stroke ?? (isSelectedAnnotation ? "#0284c7" : previewStyle.stroke);
    context.lineWidth = options.lineWidth ?? (isSelectedAnnotation ? 3 : 2);
    context.fillStyle = options.fill ?? previewStyle.fill;
    context.beginPath();
    context.ellipse(
      scaledEllipse.cx,
      scaledEllipse.cy,
      scaledEllipse.rx,
      scaledEllipse.ry,
      scaledEllipse.rotation,
      0,
      Math.PI * 2
    );
    context.fill();
    context.stroke();

    const showHandles =
      !options.noVertices &&
      (options.showHandles !== undefined
        ? options.showHandles
        : options.ellipseIndex != null || interactionState.vertexEditEnabled);
    if (showHandles) {
      context.globalAlpha = 1;
      let handleColor;
      getEllipseHandles(scaledEllipse).forEach((handle) => {
        const isActive =
          interactionState.activeVertex?.ellipseIndex === options.ellipseIndex &&
          interactionState.activeVertex?.handleType === handle.type;
        context.beginPath();
        context.arc(handle.x, handle.y, isActive ? 6 : 4, 0, Math.PI * 2);
        context.fillStyle = isActive ? "#16a34a" : (handleColor ??= rgbToCss(baseColor));
        context.fill();
      });
    }
    context.restore();
  }

  return Object.freeze({ drawEllipse, drawPolygon });
}
