import { parseAnnotationDocument } from "./annotation-document.js";
import { validateCatalogAnnotations } from "../model/class-catalog.js";
import { inspectSource } from "../image/source-format.js";
import { prepareSource, sourceFromBytes } from "../image/prepare-source.js";

function validateCatalog(imported, getClassCatalog) {
  if (imported.annotations.some(annotation => annotation.coco)) {
    validateCatalogAnnotations(getClassCatalog(), imported.annotations, { requireKnownLabels: true });
  }
}

export function readEmbeddedDocument(data, getClassCatalog = () => null) {
  const value = data.image_base64;
  if (typeof value !== "string" || !value.length || value.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error("image_base64 must contain raw Base64 image bytes without a data URL prefix.");
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const info = inspectSource(bytes);
  if ((Object.hasOwn(data, "images") || Object.hasOwn(data, "annotations"))
    && (!Array.isArray(data.images) || data.images.length !== 1)) {
    throw new Error("An embedded COCO image requires exactly one entry in images[].");
  }
  const imported = parseAnnotationDocument(data, { currentImageName: "", allowEmptyCoco: true });
  if (imported.imageSize && (imported.imageSize.width !== info.width || imported.imageSize.height !== info.height)) {
    throw new Error("The embedded image dimensions do not match the annotation document.");
  }
  imported.imageSize ||= { width: info.width, height: info.height };
  if (!imported.imageName?.trim()) imported.imageName = `embedded-image.${info.format}`;
  validateCatalog(imported, getClassCatalog);
  return { source: sourceFromBytes(bytes, { name: imported.imageName }, info), imported };
}

async function matchesOriginal(file, bytes) {
  if (!file || file.size !== bytes.length) return false;
  const previous = new Uint8Array(await file.arrayBuffer());
  return previous.every((value, index) => value === bytes[index]);
}

/** Stage an embedded image and annotations before replacing any live document state. */
export function createEmbeddedImageImporter({
  imageState, annotationState, interactionState, imageProcessing,
  getClassCatalog = () => null, loadAnnotationData, commitEmbeddedImage,
}) {
  let activeRequest = 0;

  function documentFingerprint() {
    return JSON.stringify({
      annotations: annotationState.annotations,
      calibration: imageState.calibration,
      imageName: imageState.imageName,
      imageSize: imageState.imageSize,
      currentPolygon: interactionState.currentPolygon,
      currentPolygonClass: interactionState.currentPolygonClass,
      currentCurveControl: interactionState.currentCurveControl,
      curveSegmentMode: interactionState.curveSegmentMode,
      rectangleDraft: interactionState.rectangleDraft,
      ellipseDraft: interactionState.ellipseDraft,
    });
  }

  async function load(data, { addNewImage } = {}) {
    const request = ++activeRequest;
    if (data?.image_base64 == null) return loadAnnotationData(data);
    if (imageState.imageLoadStatus === "loading") {
      throw new Error("Wait for the image to finish loading before importing an embedded image.");
    }
    const { source, imported } = readEmbeddedDocument(data, getClassCatalog);
    const original = { image: imageState.image, revision: imageState.revision, fingerprint: documentFingerprint() };
    function unchanged() {
      if (request !== activeRequest) return false;
      if (imageState.imageLoadStatus === "loading" || imageState.image !== original.image
        || imageState.revision !== original.revision || documentFingerprint() !== original.fingerprint) {
        throw new Error("The current document changed while the embedded image was loading. Import the JSON again.");
      }
      return true;
    }

    try {
      const same = await matchesOriginal(imageState.originalFile, source.bytes);
      if (!unchanged()) return false;
      if (same) return loadAnnotationData(null, { preparedDocument: imported });
      if (addNewImage) return addNewImage({ source, imported });
      const prepared = await prepareSource(source, imageProcessing);
      if (!unchanged()) return false;
      validateCatalog(imported, getClassCatalog);
      return commitEmbeddedImage({ imported, file: prepared.originalFile, ...prepared }) !== false;
    } catch (error) {
      if (request !== activeRequest) return false;
      throw error;
    }
  }

  return Object.freeze({ load, cancelPending: () => { activeRequest += 1; } });
}
