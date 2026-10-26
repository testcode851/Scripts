import { displayNumber, measurementUnits } from "./analytics-data.js";

export function fitCanvas(canvas, width, height, maximumWidth = 1100) {
  const scale = Math.min(1, maximumWidth / width, 1100 / height);
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  return scale;
}

function drawScaleBar(context, canvas, imageWidth, calibration) {
  if (!calibration) return;
  const { scale } = measurementUnits(calibration);
  const target = imageWidth * scale * 0.2;
  const power = 10 ** Math.floor(Math.log10(target));
  const length = [1, 2, 5].map((factor) => factor * power).filter((value) => value <= target).pop() || power / 2;
  const pixels = length / scale * canvas.width / imageWidth;
  const displayScale = canvas.width / (canvas.clientWidth || canvas.width);
  const x = canvas.width - pixels - 20 * displayScale;
  const y = canvas.height - 24 * displayScale;
  context.fillStyle = "rgba(0,0,0,.75)";
  context.fillRect(x - 10 * displayScale, y - 27 * displayScale, pixels + 20 * displayScale, 41 * displayScale);
  context.strokeStyle = "#fff";
  context.lineWidth = 3 * displayScale;
  context.beginPath(); context.moveTo(x, y); context.lineTo(x + pixels, y); context.stroke();
  context.fillStyle = "#fff"; context.font = `${12 * displayScale}px Segoe UI`; context.textAlign = "center";
  context.fillText(`${displayNumber(length)} µm`, x + pixels / 2, y - 8 * displayScale);
}

export function drawImageCanvas(canvas, image, imageSize, calibration = null) {
  fitCanvas(canvas, imageSize.width, imageSize.height);
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.fillStyle = "#111"; context.fillRect(0, 0, canvas.width, canvas.height);
  if (image) context.drawImage(image, 0, 0, canvas.width, canvas.height);
  drawScaleBar(context, canvas, imageSize.width, calibration);
}
