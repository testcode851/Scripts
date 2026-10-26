import {
  exportCocoDocument,
  exportLlnlDocument,
} from "./annotation-export.js";
import {
  cloneAnnotation,
  getAnnotationTypeIndex,
} from "../model/annotation.js";
import { inspectAnnotationQuality } from "../quality/annotation-quality.js";
import { validateCatalogAnnotations } from "../model/class-catalog.js";

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
    requestQualityReview,
    getClassCatalog = () => null,
    qualityOptions = {},
  } = options;
  let exportRequest = 0;

  function qualityContext(kind) {
    return {
      image: imageState.image,
      document: JSON.stringify({
        kind,
        imageName: imageState.imageName,
        imageSize: imageState.imageSize,
        calibration: imageState.calibration,
        annotations: annotationState.annotations.map(({ editor, ...annotation }) => annotation),
        ...(kind === "coco" ? { classCatalog: getClassCatalog() } : {}),
      }),
    };
  }

  function reviewBeforeExport(kind, reviewed, request, continueExport) {
    if (typeof requestQualityReview !== "function") return false;
    const context = qualityContext(kind);
    if (reviewed?.image === context.image && reviewed?.document === context.document) return false;
    const report = inspectAnnotationQuality(annotationState.annotations, { ...qualityOptions, includeEllipses: kind !== "coco" });
    if (!report.issues.length && !report.pairSummary?.truncated && !reviewed) return false;
    let active = true;
    requestQualityReview({
      report,
      includeEllipses: kind !== "coco",
      inverted: kind === "inverted-mask",
      exportLabel: kind === "mask" ? "Export Mask" : kind === "inverted-mask" ? "Export Inverted Mask"
        : kind === "coco" ? "Export MS COCO JSON" : "Export LLNL JSON",
      stale: Boolean(reviewed),
      onCancel: () => { active = false; },
      onExport: () => {
        if (!active || request !== exportRequest) return null;
        active = false;
        // Recheck readiness and the reviewed document before any export side effects.
        return continueExport(context, request);
      },
    });
    return true;
  }

  function getBaseName() {
    return imageState.imageName.replace(/\.png$/i, "") || "annotation";
  }

  function getImageBase64() {
    // The loader keeps the original file data URL; avoid canvas re-encoding or display adjustments.
    const source = imageState.image?.src;
    if (typeof source !== "string") return null;
    const prefix = /^data:[^,]*;base64,/i.exec(source);
    return prefix ? source.slice(prefix[0].length) : null;
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
      imageBase64: getImageBase64(),
      imageSize: imageState.imageSize,
      displaySize: { width: canvas.width, height: canvas.height },
      annotationTiming: getAnnotationTimingMetadata(),
      calibration: imageState.calibration,
    });
  }

  function buildCocoPayload() {
    return exportCocoDocument({
      annotations: getAnnotationsForExport(),
      imageName: imageState.imageName,
      imageBase64: getImageBase64(),
      imageSize: imageState.imageSize,
      annotationTiming: getAnnotationTimingMetadata(),
      calibration: imageState.calibration,
      classCatalog: getClassCatalog(),
    });
  }

  function exportJson() {
    return performJsonExport(null, ++exportRequest);
  }

  function performJsonExport(reviewed, request) {
    if (imageState.imageLoadStatus === "loading") {
      alertFn("Wait for the image to finish loading before exporting.");
      return null;
    }
    if (!imageState.imageName) {
      alertFn("Upload a PNG before exporting.");
      return null;
    }

    const outputFormat = settingsState.outputFormat;
    if (outputFormat === "coco") {
      try {
        validateCatalogAnnotations(getClassCatalog(), annotationState.annotations, { requireKnownLabels: true });
      } catch (error) {
        alertFn(error instanceof Error ? error.message : String(error));
        return null;
      }
    }
    if (reviewBeforeExport(outputFormat === "coco" ? "coco" : "llnl", reviewed, request, performJsonExport)) return null;
    const hasEllipses = annotationState.annotations.some(
      (annotation) => annotation.type === "ellipse"
    );
    if (outputFormat === "coco" && hasEllipses) {
      alertFn("MS COCO export includes polygons only. Ellipses will not be exported.");
    }

    stopAnnotationTimer({ markEnded: true });
    let payload;
    try {
      payload = outputFormat === "coco" ? buildCocoPayload() : buildLlnlPayload();
    } catch (error) {
      alertFn(error instanceof Error ? error.message : String(error));
      return null;
    }
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
    return performMaskExport(Boolean(options.inverted), null, ++exportRequest);
  }

  function performMaskExport(inverted, reviewed, request) {
    if (imageState.imageLoadStatus === "loading") {
      alertFn("Wait for the image to finish loading before exporting.");
      return null;
    }
    if (!imageState.imageSize) {
      alertFn("Upload a PNG before exporting a mask.");
      return null;
    }

    if (reviewBeforeExport(inverted ? "inverted-mask" : "mask", reviewed, request,
      (context, currentRequest) => performMaskExport(inverted, context, currentRequest))) return null;
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
