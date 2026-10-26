import { createStoredZip } from "../analytics/analysis-bundle.js";
import { createAnnotationCatalog } from "../model/annotation-catalog.js";
import { DEFAULT_ANNOTATION_LABELS } from "../model/annotation-labels.js";
import { normalizeClassCatalog } from "../model/class-catalog.js";
import { inspectAnnotationQuality } from "../quality/annotation-quality.js";
import { validateSessionSnapshot } from "../session/session-snapshot.js";
import { createAnnotationTimer } from "../ui/annotation-timer.js";
import { exportCocoDocument, exportLlnlDocument } from "./annotation-export.js";

const encoder = new TextEncoder();
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

function safeName(value, fallback, length = 80) {
  const name = String(value || "").normalize("NFC")
    .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, "_")
    .replace(/^[. ]+|[. ]+$/g, "").slice(0, length).replace(/[. ]+$/g, "");
  return name || fallback;
}

function imageFilename(value) {
  if (typeof value !== "string" || !value || value.length > 255 || value === "." || value === ".."
    || /[<>:"/\\|?*\x00-\x1f\x7f]/.test(value) || /[. ]$/.test(value) || /\p{Surrogate}/u.test(value)
    || /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(value)) {
    throw new Error(`Image "${value}" has an unsafe filename for a batch ZIP. Import annotations with a safe image filename before exporting.`);
  }
  return value;
}

function timingMetadata(timer) {
  return createAnnotationTimer({
    elements: {}, imageState: {},
    annotationState: {
      annotationStartedAt: timer.startedAt, annotationEndedAt: timer.endedAt,
      annotationElapsedMs: timer.elapsedMs, annotationTimerRunning: false,
    },
  }).getMetadata();
}

function exportAnnotations(snapshot, colorPalette) {
  const catalog = createAnnotationCatalog({
    annotationState: { annotations: snapshot.annotations }, interactionState: {},
    labels: DEFAULT_ANNOTATION_LABELS, baseColors: {},
    colorAssignments: new Map(snapshot.labelColorAssignments), colorPalette,
  });
  return snapshot.annotations.map(annotation => {
    // Resolve the original label's display color before normalizing its text,
    // in the same order as the individual-image download service.
    const colorLabel = catalog.sanitizeLabel(annotation.label || DEFAULT_ANNOTATION_LABELS[annotation.type]);
    if (!annotation.color && !catalog.colorAssignments.has(colorLabel) && !colorPalette.length) {
      throw new Error("The image's saved label colors are unavailable for export.");
    }
    const color = catalog.getAnnotationColorHex(annotation.type, 0, annotation);
    return { ...annotation, color, label: catalog.sanitizeLabel(annotation.label) };
  });
}

function prepareExport({
  project = {}, documents, format = "llnl", includeImages = true, includeJson = true,
  includeMasks = true, colorPalette = [], getClassCatalog,
}) {
  if (!["llnl", "coco"].includes(format)) throw new Error("Choose LLNL or COCO for the batch export.");
  if (![includeImages, includeJson, includeMasks].every(value => typeof value === "boolean")) {
    throw new Error("Batch export selections must be true or false.");
  }
  if (!includeImages && !includeJson && !includeMasks) throw new Error("Choose at least one file type to export.");
  if (!Array.isArray(documents) || !documents.length) throw new Error("Choose at least one image to export.");
  if (1 + documents.length * (Number(includeImages) + Number(includeJson) + Number(includeMasks)) >= 0xffff) {
    throw new Error("This batch contains too many files for one ZIP. Export a smaller selection.");
  }
  const catalogValue = getClassCatalog ? getClassCatalog() : project.classCatalog;
  const classCatalog = includeJson && format === "coco" && catalogValue != null
    ? normalizeClassCatalog(catalogValue) : null;
  const ids = new Set();
  const prepared = documents.map((record, index) => {
    if (typeof record?.id !== "string" || !record.id.trim() || ids.has(record.id)) {
      throw new Error("Each exported image must have a unique project image ID.");
    }
    ids.add(record.id);
    const session = record.session;
    const image = session?.image;
    if (session?.schemaVersion !== 1 || !(image?.blob instanceof Blob)
      || !Number.isSafeInteger(image.width) || image.width <= 0
      || !Number.isSafeInteger(image.height) || image.height <= 0) {
      throw new Error("An exported image is missing its saved PNG or dimensions.");
    }
    const snapshot = validateSessionSnapshot(session.snapshot, image);
    const imageName = snapshot.imageName || image.fileName || "image.png";
    const displaySize = record.displaySize || snapshot.imageSize;
    if (!Number.isSafeInteger(displaySize.width) || displaySize.width <= 0
      || !Number.isSafeInteger(displaySize.height) || displaySize.height <= 0) {
      throw new Error("An exported image has invalid display dimensions.");
    }
    const folder = `${String(index + 1).padStart(3, "0")}_${safeName(record.id, "image", 40)}`;
    // Keep each image beside its JSON with the exact filename referenced by the
    // existing serializer. Separate folders make repeated source names unambiguous.
    const originalName = imageFilename(imageName);
    const usedNames = new Set([originalName.normalize("NFC").toLowerCase()]);
    function roleName(stem, extension) {
      let candidate = `${stem}.${extension}`;
      let suffix = 2;
      while (usedNames.has(candidate.normalize("NFC").toLowerCase())) candidate = `${stem}-${suffix++}.${extension}`;
      usedNames.add(candidate.normalize("NFC").toLowerCase());
      return `${folder}/${candidate}`;
    }
    const files = {
      ...(includeImages ? { image: `${folder}/${originalName}` } : {}),
      ...(includeJson ? { annotations: roleName("annotations", "json") } : {}),
      ...(includeMasks ? { mask: roleName("mask", "png") } : {}),
    };
    let payload = null;
    if (includeJson) {
      const serialize = format === "coco" ? exportCocoDocument : exportLlnlDocument;
      payload = serialize({
        annotations: exportAnnotations(snapshot, colorPalette), imageName,
        imageSize: snapshot.imageSize, displaySize: { ...displaySize },
        annotationTiming: timingMetadata(snapshot.timer), calibration: snapshot.calibration, classCatalog,
      });
    }
    const quality = includeJson || includeMasks
      ? inspectAnnotationQuality(snapshot.annotations, {
        includeDuplicates: true, includeEllipses: includeMasks || format !== "coco",
      }) : { checkedCount: 0, issues: [] };
    const omittedEllipses = includeJson && format === "coco"
      ? snapshot.annotations.filter(annotation => annotation.type === "ellipse").length : 0;
    return {
      id: record.id, imageName, blob: image.blob, snapshot, files, payload, quality, omittedEllipses,
      complete: record.complete === true || record.status === "complete",
    };
  });
  const inspection = {
    imageCount: prepared.length,
    warningCount: prepared.reduce((sum, item) => sum + item.quality.issues.length, 0),
    omittedEllipseCount: prepared.reduce((sum, item) => sum + item.omittedEllipses, 0),
    incompleteQualityCheckCount: prepared.filter(item => item.quality.pairSummary?.truncated).length,
    documents: prepared.map(({ id, imageName, quality, omittedEllipses }) => ({ id, imageName, quality, omittedEllipses })),
  };
  return {
    prepared, inspection,
    project: { id: typeof project.id === "string" ? project.id : null, name: typeof project.name === "string" ? project.name : "Image batch" },
    format, includeImages, includeJson, includeMasks,
  };
}

/** Inspect the captured batch before asking the user to export any warnings. */
export function inspectProjectExport(options) {
  return prepareExport(options).inspection;
}

function verifyPng(bytes, size, name) {
  if (bytes.length < 33 || !pngSignature.every((value, index) => bytes[index] === value)) {
    throw new Error(`${name} is not a PNG image.`);
  }
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (header.getUint32(8) !== 13 || header.getUint32(12) !== 0x49484452
    || header.getUint32(16) !== size.width || header.getUint32(20) !== size.height) {
    throw new Error(`${name} does not match the saved image dimensions.`);
  }
}

function rawBase64(bytes) {
  // Whole three-byte chunks avoid padding between chunks and large argument lists.
  const parts = [];
  for (let start = 0; start < bytes.length; start += 24576) {
    parts.push(btoa(String.fromCharCode(...bytes.subarray(start, start + 24576))));
  }
  return parts.join("");
}

function maskBytes(canvas, size) {
  if (!canvas || typeof canvas.toDataURL !== "function") {
    throw new Error("Mask rendering is not available in this browser.");
  }
  const url = canvas.toDataURL("image/png");
  const prefix = "data:image/png;base64,";
  if (typeof url !== "string" || !url.startsWith(prefix)) throw new Error("The segmentation mask could not be encoded as PNG.");
  const bytes = Uint8Array.from(atob(url.slice(prefix.length)), character => character.charCodeAt(0));
  verifyPng(bytes, size, "The segmentation mask");
  return bytes;
}

/** Build a download without modifying the editor, saved documents, or original image bytes. */
export async function buildProjectExport(options) {
  // Snapshot and validate every document before the first asynchronous read.
  const batch = prepareExport(options);
  const { maskRenderer } = options;
  if (batch.includeMasks && typeof maskRenderer?.render !== "function") {
    throw new Error("Mask rendering is not available in this browser.");
  }
  const entries = [];
  const manifest = {
    format: "segmentation-image-batch", version: 1, project: batch.project,
    annotationFormat: batch.includeJson ? batch.format : null,
    images: [],
  };
  for (const item of batch.prepared) {
    const bytes = new Uint8Array(await item.blob.arrayBuffer());
    verifyPng(bytes, item.snapshot.imageSize, `Image "${item.imageName}"`);
    if (batch.includeImages) entries.push({ name: item.files.image, data: bytes });
    if (batch.includeJson) {
      item.payload.image_base64 = rawBase64(bytes);
      entries.push({ name: item.files.annotations, data: encoder.encode(JSON.stringify(item.payload, null, 2)) });
    }
    if (batch.includeMasks) {
      const canvas = maskRenderer.render({
        imageSize: item.snapshot.imageSize, annotations: item.snapshot.annotations, inverted: false,
      });
      entries.push({ name: item.files.mask, data: maskBytes(canvas, item.snapshot.imageSize) });
    }
    manifest.images.push({
      id: item.id, imageName: item.imageName, width: item.snapshot.imageSize.width,
      height: item.snapshot.imageSize.height, annotationCount: item.snapshot.annotations.length,
      complete: item.complete, files: item.files,
      qualityWarningCount: item.quality.issues.length,
      omittedEllipseCount: item.omittedEllipses,
    });
  }
  entries.push({ name: "manifest.json", data: encoder.encode(JSON.stringify(manifest, null, 2)) });
  return { blob: createStoredZip(entries, { allowFolders: true }), manifest, inspection: batch.inspection };
}
