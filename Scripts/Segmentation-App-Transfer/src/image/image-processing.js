import { clamp } from "../geometry/math.js";
import { DEFAULT_IMAGE_DISPLAY } from "../config/settings.js";

const nativeDistributions = new WeakMap();

function nativeDistribution(native) {
  let distribution = nativeDistributions.get(native);
  if (!distribution) {
    const histogram = new Uint32Array(65536);
    let minimum = 65535;
    let maximum = 0;
    for (let i = 0; i < native.samples.length; i++) {
      if (native.alpha?.[i] === 0) continue;
      const value = native.samples[i];
      histogram[value]++;
      if (value < minimum) minimum = value;
      if (value > maximum) maximum = value;
    }
    distribution = { histogram, minimum: Math.min(minimum, maximum), maximum };
    nativeDistributions.set(native, distribution);
  }
  return distribution;
}

export function getNativeBrightnessRange(native) {
  const { minimum, maximum } = nativeDistribution(native);
  return { minimum, maximum };
}

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

  /** Window/equalize the original samples, quantizing only the final display pixels. */
  function buildNativeCanvas(native, display = DEFAULT_IMAGE_DISPLAY, surface = {}) {
    const { samples, rgb, alpha, width, height } = native;
    const { blackLevel, whiteLevel, imageContrast, sourceEnhancement } = display;
    // The adjustable preview supplies a persistent surface during slider drags.
    // A one-time default drawable releases its temporary pixel and mapping buffers.
    const canvas = surface.canvas ??= createCanvas(width, height);
    const context = canvas.getContext("2d");
    const pixels = surface.pixels ??= context.createImageData(width, height);
    const output = pixels.data;
    const lookup = surface.lookup ??= new Uint8ClampedArray(65536);
    const gain = imageContrast / 100;
    const histogram = sourceEnhancement === "hist-eq" ? nativeDistribution(native).histogram : null;
    let firstCount = 0;
    let total = 0;
    if (histogram) {
      for (let value = blackLevel; value <= whiteLevel; value++) {
        if (!firstCount) firstCount = histogram[value];
        total += histogram[value];
      }
    }
    const equalize = total > firstCount;
    let cumulative = 0;
    for (let value = blackLevel; value <= whiteLevel; value++) {
      let fraction;
      if (equalize) {
        cumulative += histogram[value];
        fraction = Math.max(0, cumulative - firstCount) / (total - firstCount);
      } else {
        fraction = (value - blackLevel) / (whiteLevel - blackLevel);
      }
      lookup[value] = ((fraction - 0.5) * gain + 0.5) * 255;
    }
    lookup.fill(lookup[blackLevel], 0, blackLevel);
    lookup.fill(lookup[whiteLevel], whiteLevel + 1);
    for (let i = 0, out = 0; i < samples.length; i++, out += 4) {
      if (!rgb) {
        const gray = lookup[samples[i]];
        output[out] = output[out + 1] = output[out + 2] = gray;
      } else if (equalize) {
        const light = samples[i];
        const scale = light > 0 ? lookup[light] / light : 0;
        output[out] = rgb[3 * i] * scale;
        output[out + 1] = rgb[3 * i + 1] * scale;
        output[out + 2] = rgb[3 * i + 2] * scale;
      } else {
        output[out] = lookup[rgb[3 * i]];
        output[out + 1] = lookup[rgb[3 * i + 1]];
        output[out + 2] = lookup[rgb[3 * i + 2]];
      }
      output[out + 3] = alpha ? alpha[i] / 257 : 255;
    }
    context.putImageData(pixels, 0, 0);
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

    const gradient = new Uint8ClampedArray(gray.length);
    fillSobel(gray, width, height, gradient, true);
    return { width, height, gray, gradient };
  }

  function fillSobel(gray, width, height, gradient, roundToByte) {
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
        const strength = Math.hypot(gx, gy) / 4;
        gradient[center] = roundToByte ? Math.round(strength) : strength;
      }
    }
  }

  function buildNativeAnalysis(native) {
    const { width, height, samples, alpha } = native;
    if (width < 3 || height < 3) return null;
    let gray = samples;
    if (alpha?.includes(0)) {
      // A fully transparent PNG pixel can contain arbitrary hidden RGB/gray.
      // Match the canvas treatment of that pixel without modifying the source.
      gray = samples.slice();
      for (let i = 0; i < gray.length; i++) if (alpha[i] === 0) gray[i] = 0;
    }
    const { minimum, maximum } = nativeDistribution(native);
    let gradient;
    return {
      width, height, gray, bitDepth: 16,
      // Brightest/darkest snapping uses the occupied range for its 0–255 control.
      thresholdScale: Math.max(1, maximum - minimum) / 255,
      // Keep the raw Sobel map available to analysis callers. Interactive edge
      // snapping only reads a neighborhood and needs no full-image gradient.
      get gradient() {
        if (!gradient) {
          gradient = new Float32Array(gray.length);
          fillSobel(gray, width, height, gradient, false);
        }
        return gradient;
      },
    };
  }

  return Object.freeze({
    buildNativeCanvas,
    buildNativeAnalysis,
    buildHistogramEqualizedCanvas,
    buildImageAnalysisData,
  });
}
