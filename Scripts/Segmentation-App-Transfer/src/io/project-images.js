import { createAppState } from "../state/create-app-state.js";
import { captureSessionSnapshot, validateSessionSnapshot } from "../session/session-snapshot.js";
import { prepareSource, readSource } from "../image/prepare-source.js";
import { inspectSource } from "../image/source-format.js";
import { readEmbeddedDocument } from "./embedded-image-import.js";

export function projectThumbnail(image) {
  const canvas = document.createElement("canvas");
  const ratio = Math.min(56 / image.width, 56 / image.height, 1);
  canvas.width = Math.max(1, Math.round(image.width * ratio));
  canvas.height = Math.max(1, Math.round(image.height * ratio));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

export function imageMetadata(file, image) {
  return { id: crypto.randomUUID(), blob: file, fileName: file.name,
    fileType: file.type, lastModified: file.lastModified, width: image.width, height: image.height };
}

/** Prepare a thumbnail and a saved document without replacing the active editor. */
export async function prepareProjectEntry({ source, imported }, imageProcessing) {
  const { image, originalFile } = await prepareSource(source, imageProcessing, { analyze: false });
  const state = createAppState({});
  Object.assign(state.image, { image, imageName: originalFile.name,
    imageSize: { width: image.width, height: image.height }, calibration: imported?.calibration || null });
  state.annotations.annotations = imported?.annotations || [];
  return {
    session: { schemaVersion: 1, savedAt: Date.now(), image: imageMetadata(originalFile, image),
      snapshot: captureSessionSnapshot({ imageState: state.image, annotationState: state.annotations,
        interactionState: state.interaction, labelColorAssignments: new Map() }) },
    displaySize: state.image.imageSize,
    thumbnailUrl: projectThumbnail(image),
  };
}

export async function prepareProjectFile(file, { imageProcessing, getClassCatalog = () => null }) {
  if (/\.json$/i.test(file.name) || file.type === "application/json") {
    const data = JSON.parse(await file.text());
    if (data?.image_base64 == null) {
      throw new Error("Use Open JSON to apply annotation-only JSON to the current image.");
    }
    return prepareProjectEntry(readEmbeddedDocument(data, getClassCatalog), imageProcessing);
  }
  return prepareProjectEntry({ source: await readSource(file) }, imageProcessing);
}

/** Validate dimensions and decode before touching annotations or their calibration. */
export async function prepareProjectDocument(entry, imageProcessing) {
  const metadata = entry?.session?.image;
  if (!(metadata?.blob instanceof Blob) || !metadata.blob.size) throw new Error("The saved image is missing.");
  const snapshot = validateSessionSnapshot(entry.session.snapshot, metadata);
  const bytes = new Uint8Array(await metadata.blob.arrayBuffer());
  const info = inspectSource(bytes);
  if (info.width !== metadata.width || info.height !== metadata.height) {
    throw new Error("The saved image dimensions do not match its annotations.");
  }
  const originalFile = new File([metadata.blob], metadata.fileName, {
    type: info.mimeType, lastModified: metadata.lastModified,
  });
  return { snapshot, ...await prepareSource({ bytes, info, originalFile }, imageProcessing) };
}
