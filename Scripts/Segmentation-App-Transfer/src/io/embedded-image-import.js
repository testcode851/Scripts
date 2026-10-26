import { parseAnnotationDocument } from "./annotation-document.js";
import { validateCatalogAnnotations } from "../model/class-catalog.js";

const pngCrcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function pngCrc(bytes, start, end) {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) crc = (crc >>> 8) ^ pngCrcTable[(crc ^ bytes[index]) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

function decodePng(value, atobFn) {
  if (typeof value !== "string" || !value.length || value.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error("image_base64 must contain raw Base64 PNG data without a data URL prefix.");
  }
  let binary;
  try {
    binary = atobFn(value);
  } catch {
    throw new Error("The embedded image contains invalid Base64 data.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 33 || signature.some((byte, index) => bytes[index] !== byte)
    || bytes[12] !== 73 || bytes[13] !== 72 || bytes[14] !== 68 || bytes[15] !== 82) {
    throw new Error("The embedded image must be a PNG image with a valid image header.");
  }
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = header.getUint32(16);
  const height = header.getUint32(20);
  if (header.getUint32(8) !== 13 || !width || !height || width > 0x7fffffff || height > 0x7fffffff) {
    throw new Error("The embedded PNG image dimensions are invalid.");
  }
  // Browsers can report onload for a truncated PNG after reading its header.
  // Verify the whole file before trusting the decoded image or installing it.
  let offset = 8;
  let imageDataBytes = 0;
  let ended = false;
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) throw new Error("The embedded PNG contains a truncated chunk.");
    const length = header.getUint32(offset);
    if (length > 0x7fffffff || length > bytes.length - offset - 12) {
      throw new Error("The embedded PNG contains a truncated or invalid chunk.");
    }
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (!/^[A-Za-z]{4}$/.test(type) || (type === "IHDR" && offset !== 8)) {
      throw new Error("The embedded PNG contains an invalid chunk header.");
    }
    const chunkEnd = offset + 8 + length;
    if (pngCrc(bytes, offset + 4, chunkEnd) !== header.getUint32(chunkEnd)) {
      throw new Error("The embedded PNG contains a corrupted chunk (checksum mismatch).");
    }
    if (type === "IDAT") imageDataBytes += length;
    if (type === "IEND") {
      if (length !== 0 || chunkEnd + 4 !== bytes.length) {
        throw new Error("The embedded PNG has an invalid end-of-image chunk.");
      }
      ended = true;
    }
    offset = chunkEnd + 4;
  }
  if (!ended || imageDataBytes === 0) {
    throw new Error("The embedded PNG is incomplete: image data and an end-of-image chunk are required.");
  }
  return { bytes, binary, width, height };
}

/** Stage an embedded image and annotations before replacing any live document state. */
export function createEmbeddedImageImporter({
  imageState,
  annotationState,
  interactionState,
  imageProcessing,
  getClassCatalog = () => null,
  loadAnnotationData,
  commitEmbeddedImage,
  ImageType = globalThis.Image,
  FileType = globalThis.File,
  atobFn = globalThis.atob,
  nextFrame = () => typeof globalThis.requestAnimationFrame === "function"
    ? new Promise(resolve => globalThis.requestAnimationFrame(resolve)) : Promise.resolve(),
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

  function validateCatalog(imported) {
    if (imported.annotations.some(annotation => annotation.coco)) {
      validateCatalogAnnotations(getClassCatalog(), imported.annotations, { requireKnownLabels: true });
    }
  }

  function load(data) {
    const request = ++activeRequest;
    if (data?.image_base64 == null) return loadAnnotationData(data);
    if (imageState.imageLoadStatus === "loading") {
      throw new Error("Wait for the image to finish loading before importing an embedded image.");
    }
    const decoded = decodePng(data.image_base64, atobFn);
    if ((Object.hasOwn(data, "images") || Object.hasOwn(data, "annotations"))
      && (!Array.isArray(data.images) || data.images.length !== 1)) {
      throw new Error("An embedded COCO image requires exactly one entry in images[].");
    }
    const imported = parseAnnotationDocument(data, { currentImageName: "", allowEmptyCoco: true });
    if (imported.imageSize && (imported.imageSize.width !== decoded.width
      || imported.imageSize.height !== decoded.height)) {
      throw new Error("The embedded image dimensions do not match the annotation document.");
    }
    imported.imageSize ||= { width: decoded.width, height: decoded.height };
    if (!imported.imageName?.trim()) imported.imageName = "embedded-image.png";
    validateCatalog(imported);

    const source = imageState.image?.src;
    const prefix = typeof source === "string" ? /^data:[^,]*;base64,/i.exec(source) : null;
    if (prefix) {
      const currentBase64 = source.slice(prefix[0].length);
      let sameBytes = currentBase64 === data.image_base64;
      if (!sameBytes) {
        try { sameBytes = atobFn(currentBase64) === decoded.binary; } catch { /* A non-file source cannot use the fast path. */ }
      }
      if (sameBytes) return loadAnnotationData(null, { preparedDocument: imported });
    }

    const original = { image: imageState.image, revision: imageState.revision, fingerprint: documentFingerprint() };
    const isCurrent = () => request === activeRequest;
    function unchanged() {
      if (!isCurrent()) return false;
      if (imageState.imageLoadStatus === "loading" || imageState.image !== original.image
        || imageState.revision !== original.revision || documentFingerprint() !== original.fingerprint) {
        throw new Error("The current document changed while the embedded image was loading. Import the JSON again.");
      }
      return true;
    }

    return (async () => {
      try {
        const image = await new Promise((resolve, reject) => {
          const candidate = new ImageType();
          candidate.onload = () => resolve(candidate);
          candidate.onerror = () => reject(new Error("Could not decode the embedded PNG image. The current document has not been changed."));
          candidate.src = `data:image/png;base64,${data.image_base64}`;
        });
        if (!unchanged()) return false;
        if ((image.naturalWidth ?? image.width) !== decoded.width
          || (image.naturalHeight ?? image.height) !== decoded.height) {
          throw new Error("The decoded embedded image dimensions do not match the annotation document.");
        }
        await nextFrame();
        if (!unchanged()) return false;
        const equalizedImage = imageProcessing.buildHistogramEqualizedCanvas(image);
        await nextFrame();
        if (!unchanged()) return false;
        const originalAnalysis = imageProcessing.buildImageAnalysisData(image);
        const equalizedAnalysis = equalizedImage ? imageProcessing.buildImageAnalysisData(equalizedImage) : null;
        const file = new FileType([decoded.bytes], imported.imageName, { type: "image/png" });
        if (!unchanged()) return false;
        validateCatalog(imported);
        return commitEmbeddedImage({ imported, file, image, equalizedImage, originalAnalysis, equalizedAnalysis }) !== false;
      } catch (error) {
        if (!isCurrent()) return false;
        throw error;
      }
    })();
  }

  return Object.freeze({ load, cancelPending: () => { activeRequest += 1; } });
}
