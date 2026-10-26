import { rgbToCss } from "../utils/colors.js";

/** Paint polygon, rectangle, and ellipse creation drafts. */
export function createCanvasDraftLayer({
  context,
  interactionState,
  coordinates,
  drawPolygon,
  drawEllipse,
  createPreviewPolygonPoint,
  createEllipseFromDraft,
  createRectangleFromDraft,
  polygonBaseColor,
  closeSnapRadius = 10,
}) {
  const { scalePoint } = coordinates;

  function isNearFirstVertex(imagePoint) {
    if (interactionState.currentPolygon.length < 3) return false;
    const first = scalePoint(interactionState.currentPolygon[0]);
    const cursor = scalePoint(imagePoint);
    return (
      (first.x - cursor.x) ** 2 + (first.y - cursor.y) ** 2 <=
      closeSnapRadius ** 2
    );
  }

  function drawPolygonDraft() {
    if (interactionState.currentPolygon.length === 0) return;
    const rawCursorPoint = interactionState.cursorImagePos;
    const clampedCursor = rawCursorPoint && coordinates.clampPointToImage(rawCursorPoint);
    const outsidePreview = rawCursorPoint && (
      rawCursorPoint.x !== clampedCursor.x || rawCursorPoint.y !== clampedCursor.y
    ) ? createPreviewPolygonPoint(rawCursorPoint, interactionState.currentCurveControl) : null;
    const cursorPoint = outsidePreview || rawCursorPoint;
    const readyToClose =
      cursorPoint &&
      interactionState.currentPolygon.length >= 3 &&
      isNearFirstVertex(cursorPoint);
    const draftStroke = rgbToCss(polygonBaseColor);
    const draftFillStrong = rgbToCss(polygonBaseColor, 0.45);
    const draftFillSoft = rgbToCss(polygonBaseColor, 0.15);
    const draftClosingStroke = rgbToCss(polygonBaseColor, 0.35);

    if (readyToClose) {
      drawPolygon(interactionState.currentPolygon, {
        closed: true,
        stroke: "rgba(255, 255, 255, 0.9)",
        fill: draftFillStrong,
        lineWidth: 2.5,
        opacity: 1,
        polygonIndex: -1,
        noVertices: true,
      });
      interactionState.currentPolygon.forEach((point) => {
        const scaledPoint = scalePoint(point);
        context.save();
        context.beginPath();
        context.arc(scaledPoint.x, scaledPoint.y, 5, 0, Math.PI * 2);
        context.fillStyle = "#ffffff";
        context.fill();
        context.restore();
      });
      const firstPoint = scalePoint(interactionState.currentPolygon[0]);
      context.save();
      context.beginPath();
      context.arc(firstPoint.x, firstPoint.y, closeSnapRadius, 0, Math.PI * 2);
      context.fillStyle = "rgba(255, 255, 255, 0.85)";
      context.fill();
      context.restore();
      return;
    }

    if (cursorPoint && interactionState.currentPolygon.length >= 2) {
      drawPolygon(
        [
          ...interactionState.currentPolygon,
          outsidePreview || createPreviewPolygonPoint(rawCursorPoint, interactionState.currentCurveControl),
        ],
        {
          closed: true,
          stroke: "transparent",
          fill: draftFillSoft,
          opacity: 1,
          polygonIndex: -1,
          noVertices: true,
        }
      );
    }
    drawPolygon(interactionState.currentPolygon, {
      closed: false,
      stroke: draftStroke,
      opacity: 1,
      polygonIndex: -1,
    });

    if (!cursorPoint) return;
    const lastPoint = scalePoint(
      interactionState.currentPolygon[interactionState.currentPolygon.length - 1]
    );
    const scaledCursor = scalePoint(cursorPoint);
    context.save();
    context.beginPath();
    context.moveTo(lastPoint.x, lastPoint.y);
    if (interactionState.currentCurveControl) {
      const scaledControl = scalePoint(interactionState.currentCurveControl);
      context.quadraticCurveTo(
        scaledControl.x,
        scaledControl.y,
        scaledCursor.x,
        scaledCursor.y
      );
    } else {
      context.lineTo(scaledCursor.x, scaledCursor.y);
    }
    context.strokeStyle = draftStroke;
    context.lineWidth = 2;
    context.setLineDash([6, 4]);
    context.stroke();
    context.restore();

    if (interactionState.curveSegmentMode && !interactionState.currentCurveControl) {
      context.save();
      context.beginPath();
      context.moveTo(lastPoint.x, lastPoint.y);
      context.lineTo(scaledCursor.x, scaledCursor.y);
      context.strokeStyle = "#f59e0b";
      context.lineWidth = 1.5;
      context.setLineDash([2, 5]);
      context.stroke();
      context.restore();
    }

    if (interactionState.currentCurveControl) {
      const scaledControl = scalePoint(interactionState.currentCurveControl);
      context.save();
      context.beginPath();
      context.moveTo(lastPoint.x, lastPoint.y);
      context.lineTo(scaledControl.x, scaledControl.y);
      context.lineTo(scaledCursor.x, scaledCursor.y);
      context.strokeStyle = "rgba(245, 158, 11, 0.75)";
      context.lineWidth = 1;
      context.setLineDash([4, 4]);
      context.stroke();
      context.translate(scaledControl.x, scaledControl.y);
      context.rotate(Math.PI / 4);
      context.beginPath();
      context.rect(-4, -4, 8, 8);
      context.fillStyle = "#f59e0b";
      context.fill();
      context.restore();
    }

    if (interactionState.currentPolygon.length >= 2) {
      const firstPoint = scalePoint(interactionState.currentPolygon[0]);
      context.save();
      context.beginPath();
      context.moveTo(scaledCursor.x, scaledCursor.y);
      context.lineTo(firstPoint.x, firstPoint.y);
      context.strokeStyle = draftClosingStroke;
      context.lineWidth = 1.5;
      context.setLineDash([4, 6]);
      context.stroke();
      context.restore();
    }
  }

  function drawDrafts() {
    drawPolygonDraft();
    if (interactionState.ellipseDraft) {
      drawEllipse(createEllipseFromDraft(interactionState.ellipseDraft), {
        stroke: "#22c55e",
        fill: "rgba(34, 197, 94, 0.1)",
        opacity: 1,
        showHandles: true,
      });
    }
    if (interactionState.rectangleDraft) {
      drawPolygon(createRectangleFromDraft(interactionState.rectangleDraft), {
        closed: true,
        stroke: rgbToCss(polygonBaseColor),
        fill: rgbToCss(polygonBaseColor, 0.1),
        opacity: 1,
        polygonIndex: -2,
      });
    }
  }

  return Object.freeze({ drawDrafts });
}
