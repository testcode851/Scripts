import { clamp, getFittedGridAxis } from "../geometry/math.js";

/** Paint the source image and optional alignment grid. */
export function createCanvasBackgroundLayer({
  canvas,
  context,
  imageState,
  viewState,
  settingsState,
  getActiveImageSource,
}) {
  function drawImage() {
    if (!imageState.image) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const imageSource = getActiveImageSource();
    const scale = viewState.imageScale * viewState.viewZoom;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.imageSmoothingEnabled = false;
    context.filter = imageState.native ? "none" : `contrast(${settingsState.imageContrast}%)`;
    context.drawImage(
      imageSource,
      viewState.viewOffsetX,
      viewState.viewOffsetY,
      imageState.imageSize.width * scale,
      imageState.imageSize.height * scale
    );
    context.restore();
  }

  function drawGrid() {
    if (!imageState.imageSize || !settingsState.gridSize) return;
    const scale = viewState.imageScale * viewState.viewZoom;
    const majorEvery = Math.max(2, Math.round(settingsState.gridMajorEvery));
    const horizontalGrid = getFittedGridAxis(
      imageState.imageSize.width,
      settingsState.gridSize,
      majorEvery
    );
    const verticalGrid = getFittedGridAxis(
      imageState.imageSize.height,
      settingsState.gridSize,
      majorEvery
    );
    if (!horizontalGrid.divisions || !verticalGrid.divisions) return;
    const horizontalSpacing = horizontalGrid.spacing * scale;
    const verticalSpacing = verticalGrid.spacing * scale;
    const spacing = Math.min(horizontalSpacing, verticalSpacing);
    context.save();
    const baseOpacity = clamp(settingsState.gridOpacity / 100, 0.1, 1);
    const lineStepMultiplier = Math.max(1, Math.ceil(2 / Math.max(spacing, 0.001)));
    const showMinorLines = spacing >= 4 && lineStepMultiplier === 1;
    const minorLineWidth = spacing < 10 ? 1 : 1.1;
    const majorLineWidth = showMinorLines ? (spacing < 10 ? 1.4 : 1.8) : 1.3;
    const minorColor = `rgba(71, 85, 105, ${baseOpacity})`;
    const majorColor = `rgba(15, 23, 42, ${clamp(baseOpacity * 1.9, 0.2, 1)})`;
    const width = imageState.imageSize.width * scale;
    const height = imageState.imageSize.height * scale;
    const startX = viewState.viewOffsetX;
    const startY = viewState.viewOffsetY;
    for (
      let verticalIndex = 0;
      verticalIndex <= horizontalGrid.divisions;
      verticalIndex += 1
    ) {
      const isBoundary =
        verticalIndex === 0 || verticalIndex === horizontalGrid.divisions;
      const isMajor = isBoundary || verticalIndex % majorEvery === 0;
      const isSampled = verticalIndex % lineStepMultiplier === 0;
      if (!isBoundary && (!isSampled || (!showMinorLines && !isMajor))) continue;
      const x = startX + (width * verticalIndex) / horizontalGrid.divisions;
      context.strokeStyle = isMajor ? majorColor : minorColor;
      context.lineWidth = isMajor ? majorLineWidth : minorLineWidth;
      context.beginPath();
      context.moveTo(x, startY);
      context.lineTo(x, startY + height);
      context.stroke();
    }
    for (
      let horizontalIndex = 0;
      horizontalIndex <= verticalGrid.divisions;
      horizontalIndex += 1
    ) {
      const isBoundary =
        horizontalIndex === 0 || horizontalIndex === verticalGrid.divisions;
      const isMajor = isBoundary || horizontalIndex % majorEvery === 0;
      const isSampled = horizontalIndex % lineStepMultiplier === 0;
      if (!isBoundary && (!isSampled || (!showMinorLines && !isMajor))) continue;
      const y = startY + (height * horizontalIndex) / verticalGrid.divisions;
      context.strokeStyle = isMajor ? majorColor : minorColor;
      context.lineWidth = isMajor ? majorLineWidth : minorLineWidth;
      context.beginPath();
      context.moveTo(startX, y);
      context.lineTo(startX + width, y);
      context.stroke();
    }
    context.restore();
  }

  return Object.freeze({ drawGrid, drawImage });
}
