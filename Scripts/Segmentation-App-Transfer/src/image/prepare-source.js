import { inspectSource } from "./source-format.js";
import { decodeNativeSamples } from "./source-decoder.js";

// Snapshot the source bytes once. Readers, display adjustments and exports can
// then share an image identity even if the selected file later changes on disk.
export function sourceFromBytes(bytes, { name, lastModified }, info = inspectSource(bytes)) {
  const originalFile = new File([bytes], name || `image.${info.format}`, {
    type: info.mimeType, lastModified,
  });
  return { bytes, info, originalFile };
}

export async function readSource(file) {
  return sourceFromBytes(new Uint8Array(await file.arrayBuffer()), file);
}

async function decodeBrowserImage(file, ImageType) {
  const url = URL.createObjectURL(file);
  try {
    const image = new ImageType();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Prepare the original-resolution drawable and analysis without mutating the editor. */
export async function prepareSource(source, imageProcessing, { analyze = true, ImageType = globalThis.Image } = {}) {
  const { bytes, info, originalFile } = source;
  const native = await decodeNativeSamples(bytes, info);
  // A color profile can affect the unadjusted PNG view in an existing project.
  // Windowing and analysis always have access to the original 16-bit samples.
  const image = !native || info.hasColorProfile
    ? await decodeBrowserImage(originalFile, ImageType) : imageProcessing.buildNativeCanvas(native);
  if (image.width !== info.width || image.height !== info.height) {
    throw new Error("The decoded image dimensions do not match its header.");
  }
  const prepared = { image, native, originalFile };
  if (!analyze) return prepared;
  if (native) {
    prepared.originalAnalysis = imageProcessing.buildNativeAnalysis(native);
  } else {
    prepared.equalizedImage = imageProcessing.buildHistogramEqualizedCanvas(image);
    prepared.originalAnalysis = imageProcessing.buildImageAnalysisData(image);
    prepared.equalizedAnalysis = prepared.equalizedImage
      ? imageProcessing.buildImageAnalysisData(prepared.equalizedImage) : null;
  }
  return prepared;
}
