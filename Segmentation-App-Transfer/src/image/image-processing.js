import { clamp } from "../geometry/math.js";

/** Create state-independent image enhancement and analysis operations. */
export function createImageProcessing({ documentRoot }) {
  if (!documentRoot || typeof documentRoot.createElement !== "function") {
    throw new TypeError("Image processing requires a document-compatible canvas factory.");
  }

  function createCanvas(width, height) {
    const canvas = documentRoot.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  function buildHistogramEqualizedCanvas(image) {
    if (!image) return null;
    const width = image.width;
    const height = image.height;
    const sourceCanvas = createCanvas(width, height);
    const sourceContext = sourceCanvas.getContext("2d");
    if (!sourceContext) return null;
    sourceContext.drawImage(image, 0, 0, width, height);
    const imageData = sourceContext.getImageData(0, 0, width, height);
    const data = imageData.data;
    const histogram = new Uint32Array(256);
    const luminance = new Uint8Array(width * height);

    for (
      let index = 0, pixelIndex = 0;
      index < data.length;
      index += 4, pixelIndex += 1
    ) {
      const value = Math.round(
        0.299 * data[index] +
          0.587 * data[index + 1] +
          0.114 * data[index + 2]
      );
      luminance[pixelIndex] = value;
      histogram[value] += 1;
    }

    let cdfMin = 0;
    let foundMin = false;
    const cumulative = new Uint32Array(256);
    let running = 0;
    for (let level = 0; level < 256; level += 1) {
      running += histogram[level];
      cumulative[level] = running;
      if (!foundMin && histogram[level] > 0) {
        cdfMin = running;
        foundMin = true;
      }
    }

    const denominator = width * height - cdfMin;
    if (denominator <= 0) return sourceCanvas;
    const remap = new Uint8Array(256);
    for (let level = 0; level < 256; level += 1) {
      const normalized = ((cumulative[level] - cdfMin) / denominator) * 255;
      remap[level] = clamp(Math.round(normalized), 0, 255);
    }

    for (
      let index = 0, pixelIndex = 0;
      index < data.length;
      index += 4, pixelIndex += 1
    ) {
      const originalLuminance = luminance[pixelIndex];
      const mappedLuminance = remap[originalLuminance];
      const scale =
        originalLuminance === 0 ? 0 : mappedLuminance / originalLuminance;
      data[index] = clamp(Math.round(data[index] * scale), 0, 255);
      data[index + 1] = clamp(
        Math.round(data[index + 1] * scale),
        0,
        255
      );
      data[index + 2] = clamp(
        Math.round(data[index + 2] * scale),
        0,
        255
      );
    }
    sourceContext.putImageData(imageData, 0, 0);
    return sourceCanvas;
  }

  function buildImageAnalysisData(imageSource) {
    if (!imageSource) return null;
    const width = imageSource.width;
    const height = imageSource.height;
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width < 3 ||
      height < 3
    ) {
      return null;
    }
    const analysisCanvas = createCanvas(width, height);
    const analysisContext = analysisCanvas.getContext("2d");
    if (!analysisContext) return null;
    analysisContext.drawImage(imageSource, 0, 0, width, height);
    const data = analysisContext.getImageData(0, 0, width, height).data;
    const gray = new Uint8Array(width * height);
    const gradient = new Uint8Array(width * height);

    for (
      let index = 0, pixelIndex = 0;
      index < data.length;
      index += 4, pixelIndex += 1
    ) {
      gray[pixelIndex] = Math.round(
        0.299 * data[index] +
          0.587 * data[index + 1] +
          0.114 * data[index + 2]
      );
    }

    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const center = y * width + x;
        const top = center - width;
        const bottom = center + width;
        const gx =
          -gray[top - 1] -
          2 * gray[center - 1] -
          gray[bottom - 1] +
          gray[top + 1] +
          2 * gray[center + 1] +
          gray[bottom + 1];
        const gy =
          gray[top - 1] +
          2 * gray[top] +
          gray[top + 1] -
          gray[bottom - 1] -
          2 * gray[bottom] -
          gray[bottom + 1];
        gradient[center] = clamp(
          Math.round(Math.hypot(gx, gy) / 4),
          0,
          255
        );
      }
    }
    return { width, height, gray, gradient };
  }

  return Object.freeze({
    buildHistogramEqualizedCanvas,
    buildImageAnalysisData,
  });
}
