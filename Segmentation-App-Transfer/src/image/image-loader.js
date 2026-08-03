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
    labelColorAssignments.clear();
    render.resetTimer();
    const requestId = ++activeRequestId;
    const isCurrentRequest = () => requestId === activeRequestId;
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
      if (!isCurrentRequest()) return;
      render.setLoadState("error", 100, "Could not read the image file.");
      alertFn("Could not read the selected PNG file.");
    };
    reader.onload = (event) => {
      if (!isCurrentRequest()) return;
      const imageDataUrl = event.target?.result;
      if (typeof imageDataUrl !== "string") {
        render.setLoadState("error", 100, "Image read failed.");
        alertFn("Could not decode image file contents.");
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
          render.redraw();
          render.setLoadState("success", 100, "Image ready.");
          render.timer();
        } catch (error) {
          if (!isCurrentRequest()) return;
          const message =
            error instanceof Error ? error.message : String(error);
          render.setLoadState("error", 100, "Image processing failed.");
          alertFn(`Could not process image: ${message}`);
        }
      };
      image.onerror = () => {
        if (!isCurrentRequest()) return;
        render.setLoadState("error", 100, "PNG decode failed.");
        alertFn("Could not decode the selected PNG. The file may be corrupt.");
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
