import { createInteractionReset } from "../state/interaction-reset.js";

/** Own image replacement workflow, asynchronous loading, decoding, and processing. */
export function createImageLoader({
  elements,
  imageState,
  annotationState,
  interactionState,
  labelColorAssignments,
  imageProcessing,
  imageCache,
  commandRegistry,
  replaceCommand,
  modal,
  ui,
  selection,
  render,
  view,
  FileReaderType = globalThis.FileReader,
  ImageType = globalThis.Image,
  alertFn = globalThis.alert,
  nextFrame = () =>
    new Promise((resolve) => globalThis.requestAnimationFrame(resolve)),
}) {
  const { imageInput, emptyState } = elements;
  const interactionReset = createInteractionReset(interactionState);
  let activeRequestId = 0;
  let pendingRollback = null;

  function hasAnnotationState() {
    return (
      annotationState.annotations.length > 0 ||
      interactionState.currentPolygon.length > 0 ||
      Boolean(interactionState.currentCurveControl) ||
      Boolean(interactionState.rectangleDraft) ||
      Boolean(interactionState.ellipseDraft)
    );
  }

  function clearAnnotations() {
    labelColorAssignments.clear();
    annotationState.annotations = [];
    interactionReset.clearShapeDrafts();
    interactionReset.clearGeometryInteraction();
    selection.selectAnnotation(null);
    selection.clearVertexSelection();
  }

  function load(file) {
    ui.closeLabelEditor();
    ui.closeContextMenu();
    if (hasAnnotationState()) return modal.openConfirm(file);
    return start(file);
  }

  const confirmPending = () => commandRegistry.execute(replaceCommand);

  function replacePending() {
    const file = modal.getPendingFile();
    if (!file) {
      modal.closeConfirm();
      return false;
    }
    modal.closeConfirm();
    pendingRollback ||= {
      image: { ...imageState },
      annotations: annotationState.annotations,
      labelColors: new Map(labelColorAssignments),
    };
    clearAnnotations();
    return start(file);
  }

  function cancelPending() {
    modal.closeConfirm();
    if (imageInput) imageInput.value = "";
  }

  function start(file) {
    if (typeof FileReaderType !== "function" || typeof ImageType !== "function") {
      throw new Error("Image loading requires FileReader and Image constructors.");
    }
    pendingRollback ||= {
      image: { ...imageState },
      annotations: annotationState.annotations,
      labelColors: new Map(labelColorAssignments),
    };
    labelColorAssignments.clear();
    render.resetTimer();
    const requestId = ++activeRequestId;
    const isCurrentRequest = () => requestId === activeRequestId;
    function fail(message, detail) {
      if (!isCurrentRequest()) return;
      const revision = imageState.revision;
      Object.assign(imageState, pendingRollback.image, { revision: revision + 1 });
      annotationState.annotations = pendingRollback.annotations;
      labelColorAssignments.clear();
      for (const [label, color] of pendingRollback.labelColors) labelColorAssignments.set(label, color);
      pendingRollback = null;
      render.setLoadState("error", 100, message);
      render.metadata();
      render.redraw();
      render.onImageError?.(detail);
      alertFn(detail);
    }
    imageState.calibration = null;
    imageState.revision = (imageState.revision || 0) + 1;
    imageState.imageName = file.name || "";
    imageState.imageFileSizeBytes = Number.isFinite(file.size) ? file.size : null;
    imageState.imageFileType = file.type || "image/png";
    imageState.imageLastModified = Number.isFinite(file.lastModified)
      ? file.lastModified
      : null;
    render.metadata();
    render.setLoadState("loading", 0, "Reading image file...", {
      autoHideSuccess: false,
    });
    render.timer();

    render.redraw();

    const reader = new FileReaderType();
    reader.onloadstart = () => {
      if (!isCurrentRequest()) return;
      render.setLoadState("loading", 5, "Reading image file...", {
        autoHideSuccess: false,
      });
    };
    reader.onprogress = (progressEvent) => {
      if (!isCurrentRequest()) return;
      if (progressEvent.lengthComputable && progressEvent.total > 0) {
        const ratio = progressEvent.loaded / progressEvent.total;
        render.setLoadState(
          "loading",
          5 + ratio * 60,
          "Reading image file...",
          { autoHideSuccess: false }
        );
      }
    };
    reader.onerror = () => {
      fail("Could not read the image file.", "Could not read the selected PNG file.");
    };
    reader.onload = (event) => {
      if (!isCurrentRequest()) return;
      const imageDataUrl = event.target?.result;
      if (typeof imageDataUrl !== "string") {
        fail("Image read failed.", "Could not decode image file contents.");
        return;
      }
      const image = new ImageType();
      image.onload = async () => {
        if (!isCurrentRequest()) return;
        try {
          render.setLoadState("loading", 72, "Decoding PNG...", {
            autoHideSuccess: false,
          });
          await nextFrame();
          const equalizedImage =
            imageProcessing.buildHistogramEqualizedCanvas(image);
          if (!isCurrentRequest()) return;

          render.setLoadState("loading", 86, "Analyzing image...", {
            autoHideSuccess: false,
          });
          await nextFrame();
          const originalAnalysis =
            imageProcessing.buildImageAnalysisData(image);
          const equalizedAnalysis = equalizedImage
            ? imageProcessing.buildImageAnalysisData(equalizedImage)
            : null;
          if (!isCurrentRequest()) return;

          render.setLoadState("loading", 98, "Rendering image...", {
            autoHideSuccess: false,
          });
          await nextFrame();
          if (!isCurrentRequest()) return;
          imageCache.install({
            image,
            equalizedImage,
            originalAnalysis,
            equalizedAnalysis,
          });
          imageState.imageName = file.name;
          imageState.imageSize = {
            width: image.width,
            height: image.height,
          };
          view.resizeCanvasToImage();
          view.resetViewTransform();
          if (emptyState) emptyState.style.display = "none";
          render.metadata();
          render.setLoadState("success", 100, "Image ready.");
          render.onImageReady?.(file);
          render.redraw();
          render.timer();
          pendingRollback = null;
        } catch (error) {
          if (!isCurrentRequest()) return;
          const message =
            error instanceof Error ? error.message : String(error);
          fail("Image processing failed.", `Could not process image: ${message}`);
        }
      };
      image.onerror = () => {
        fail("PNG decode failed.", "Could not decode the selected PNG. The file may be corrupt.");
      };
      render.setLoadState("loading", 70, "Decoding PNG...", {
        autoHideSuccess: false,
      });
      image.src = imageDataUrl;
    };
    reader.readAsDataURL(file);
    return true;
  }

  function cancelActive() {
    activeRequestId += 1;
  }

  return Object.freeze({
    cancelActive,
    cancelPending,
    clearAnnotations,
    confirmPending,
    hasAnnotationState,
    load,
    replacePending,
    start,
  });
}
