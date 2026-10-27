import { createAppState } from "../state/create-app-state.js";
import { captureSessionSnapshot, validateSessionSnapshot } from "../session/session-snapshot.js";
import { createEmbeddedImageImporter } from "./embedded-image-import.js";

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

/** Reuse the existing embedded-import validation in a detached, disposable editor state. */
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
    const source = await readImageDataUrl(file);
    data = { version: "1.0", imagePath: file.name, image_base64: source.slice(source.indexOf(",") + 1), shapes: [] };
  }
  const state = createAppState({});
  let entry;
  const importer = createEmbeddedImageImporter({
    imageState: state.image, annotationState: state.annotations, interactionState: state.interaction,
    getClassCatalog,
    imageProcessing: { buildHistogramEqualizedCanvas: () => null, buildImageAnalysisData: () => null },
    nextFrame: () => Promise.resolve(),
    loadAnnotationData: () => { throw new Error("An embedded image is required when adding JSON to a batch."); },
    commitEmbeddedImage: ({ imported, image, file: embeddedFile }) => {
      // The importer already copied and validated these exact PNG bytes. Do not
      // keep a disk-backed File that may become unreadable before the batch saves.
      const original = isJson ? embeddedFile : new File([embeddedFile], file.name,
        { type: file.type, lastModified: file.lastModified });
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
    },
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
