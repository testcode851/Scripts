import {
  exportCocoDocument,
  exportLlnlDocument,
} from "./annotation-export.js";
import {
  cloneAnnotation,
  getAnnotationTypeIndex,
} from "../model/annotation.js";

/**
 * Owns browser downloads for annotation documents and segmentation masks.
 * State and browser APIs are injected so the behavior can be tested without
 * starting the complete application.
 */
export function createDownloadService(options) {
  const {
    documentRoot = globalThis.document,
    URLType = globalThis.URL,
    BlobType = globalThis.Blob,
    alertFn = globalThis.alert,
    imageState,
    annotationState,
    settingsState,
    canvas,
    maskRenderer,
    stopAnnotationTimer,
    getAnnotationTimingMetadata,
    getAnnotationColorHex,
    sanitizeAnnotationLabel,
  } = options;

  function getBaseName() {
    return imageState.imageName.replace(/\.png$/i, "") || "annotation";
  }

  function getAnnotationsForExport() {
    return annotationState.annotations.map((annotation) => {
      const clone = cloneAnnotation(annotation);
      const index = getAnnotationTypeIndex(annotationState.annotations, annotation.id);
      clone.color = getAnnotationColorHex(annotation.type, index);
      clone.label = sanitizeAnnotationLabel(annotation.label);
      return clone;
    });
  }

  function buildLlnlPayload() {
    return exportLlnlDocument({
      annotations: getAnnotationsForExport(),
      imageName: imageState.imageName,
      imageSize: imageState.imageSize,
      displaySize: { width: canvas.width, height: canvas.height },
      annotationTiming: getAnnotationTimingMetadata(),
    });
  }

  function buildCocoPayload() {
    return exportCocoDocument({
      annotations: getAnnotationsForExport(),
      imageName: imageState.imageName,
      imageSize: imageState.imageSize,
      annotationTiming: getAnnotationTimingMetadata(),
    });
  }

  function exportJson() {
    if (!imageState.imageName) {
      alertFn("Upload a PNG before exporting.");
      return null;
    }

    const outputFormat = settingsState.outputFormat;
    const hasEllipses = annotationState.annotations.some(
      (annotation) => annotation.type === "ellipse"
    );
    if (outputFormat === "coco" && hasEllipses) {
      alertFn("MS COCO export includes polygons only. Ellipses will not be exported.");
    }

    stopAnnotationTimer({ markEnded: true });
    const payload = outputFormat === "coco" ? buildCocoPayload() : buildLlnlPayload();
    const blob = new BlobType([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URLType.createObjectURL(blob);
    const link = documentRoot.createElement("a");
    link.href = url;
    link.download = `${getBaseName()}${outputFormat === "coco" ? "-coco" : ""}.json`;
    link.click();
    URLType.revokeObjectURL(url);
    return payload;
  }

  function exportMask(options = {}) {
    if (!imageState.imageSize) {
      alertFn("Upload a PNG before exporting a mask.");
      return null;
    }

    const inverted = Boolean(options.inverted);
    const maskCanvas = maskRenderer.render({
      imageSize: imageState.imageSize,
      annotations: annotationState.annotations,
      inverted,
    });
    if (!maskCanvas) {
      alertFn("Mask rendering is not available in this browser.");
      return null;
    }

    const link = documentRoot.createElement("a");
    link.href = maskCanvas.toDataURL("image/png");
    link.download = `${getBaseName()}${inverted ? "-inverted-mask" : "-mask"}.png`;
    link.click();
    return maskCanvas;
  }

  return {
    buildCocoPayload,
    buildLlnlPayload,
    exportJson,
    exportMask,
    getAnnotationsForExport,
  };
}
