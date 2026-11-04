import { createAppState } from "../state/create-app-state.js";
import { captureSessionSnapshot, validateSessionSnapshot } from "../session/session-snapshot.js";
import { createEmbeddedImageImporter, validatePngBytes } from "./embedded-image-import.js";

/** Keep the bytes already read by the loader, independent of later disk-file changes. */
export function preserveLoadedImageFile(file, dataUrl) {
  const prefix = typeof dataUrl === "string" && /^data:[^,]*;base64,/i.exec(dataUrl);
  if (!prefix) throw new Error("The loaded image bytes are unavailable.");
  const binary = atob(dataUrl.slice(prefix[0].length));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], file.name, { type: file.type, lastModified: file.lastModified });
}

export function readImageDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read the image file."));
    reader.readAsDataURL(blob);
  });
}

export function projectThumbnail(image) {
  const canvas = document.createElement("canvas");
  const ratio = Math.min(56 / image.width, 56 / image.height, 1);
  canvas.width = Math.max(1, Math.round(image.width * ratio));
  canvas.height = Math.max(1, Math.round(image.height * ratio));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

/** Validate batch images in a detached, disposable editor state. */
export async function prepareProjectFile(file, { getClassCatalog = () => null } = {}) {
  let data;
  const isJson = /\.json$/i.test(file.name) || file.type === "application/json";
  if (isJson) {
    data = JSON.parse(await file.text());
    if (data?.image_base64 == null) {
      throw new Error(`${file.name}: Add images accepts PNGs or JSON with an embedded image. Use Open JSON to apply annotation-only JSON to the current image.`);
    }
  } else {
    if (file.type !== "image/png" && !/\.png$/i.test(file.name)) throw new Error("Add PNG images or JSON files containing an embedded PNG.");
  }
  const state = createAppState({});
  let entry;
  const commitEmbeddedImage = ({ imported, image, file: original }) => {
    Object.assign(state.image, { image, imageName: imported.imageName, imageSize: imported.imageSize, calibration: imported.calibration });
    state.annotations.annotations = imported.annotations;
    entry = {
      session: { schemaVersion: 1, savedAt: Date.now(),
        image: { id: crypto.randomUUID(), blob: original, fileName: original.name,
          fileType: "image/png", lastModified: original.lastModified,
          width: image.width, height: image.height },
        snapshot: captureSessionSnapshot({ imageState: state.image, annotationState: state.annotations,
          interactionState: state.interaction, labelColorAssignments: new Map() }) },
      displaySize: { width: image.width, height: image.height },
      thumbnailUrl: projectThumbnail(image),
    };
    return true;
  };
  if (!isJson) {
    // Read once, retaining independent original bytes without a Base64 round trip.
    let buffer;
    try { buffer = await file.arrayBuffer(); }
    catch (cause) { throw new Error("Could not read the image file.", { cause }); }
    const dimensions = validatePngBytes(new Uint8Array(buffer));
    const original = new File([buffer], file.name, { type: file.type, lastModified: file.lastModified });
    // A .png file may have an empty or incorrect MIME type. Decode it as PNG,
    // while preserving the original File metadata for storage and export.
    const image = new Image();
    const url = URL.createObjectURL(original.slice(0, original.size, "image/png"));
    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("Could not decode the embedded PNG image. The current document has not been changed."));
        image.src = url;
      });
      if (image.naturalWidth !== dimensions.width || image.naturalHeight !== dimensions.height) {
        throw new Error("The decoded embedded image dimensions do not match the annotation document.");
      }
      commitEmbeddedImage({ image, file: original, imported: {
        annotations: [], imageName: file.name.trim() ? file.name : "embedded-image.png",
        imageSize: dimensions, calibration: null,
      } });
    } finally {
      URL.revokeObjectURL(url);
      image.onload = null;
      image.onerror = null;
      image.removeAttribute("src");
    }
    return entry;
  }
  const importer = createEmbeddedImageImporter({
    imageState: state.image, annotationState: state.annotations, interactionState: state.interaction,
    getClassCatalog,
    imageProcessing: { buildHistogramEqualizedCanvas: () => null, buildImageAnalysisData: () => null },
    nextFrame: () => Promise.resolve(),
    loadAnnotationData: () => { throw new Error("An embedded image is required when adding JSON to a batch."); },
    commitEmbeddedImage,
  });
  await importer.load(data);
  return entry;
}

/** Decode and derive smart-snap/display caches before touching the current editor. */
export async function prepareProjectDocument(entry, imageProcessing) {
  const metadata = entry?.session?.image;
  if (!(metadata?.blob instanceof Blob) || metadata.blob.size === 0) throw new Error("The saved batch image is missing.");
  const snapshot = validateSessionSnapshot(entry.session.snapshot, metadata);
  const image = new Image();
  image.src = await readImageDataUrl(metadata.blob);
  await image.decode();
  if (image.naturalWidth !== metadata.width || image.naturalHeight !== metadata.height) {
    throw new Error("The saved image dimensions do not match its annotations.");
  }
  const equalizedImage = imageProcessing.buildHistogramEqualizedCanvas(image);
  return { snapshot, image, equalizedImage,
    originalAnalysis: imageProcessing.buildImageAnalysisData(image),
    equalizedAnalysis: equalizedImage ? imageProcessing.buildImageAnalysisData(equalizedImage) : null };
}
