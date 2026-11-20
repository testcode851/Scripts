import { readSource, prepareSource } from "./prepare-source.js";
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
    return start(file);
  }

  function cancelPending() {
    modal.closeConfirm();
    if (imageInput) imageInput.value = "";
  }

  function start(file) {
    const requestId = ++activeRequestId;
    const isCurrent = () => requestId === activeRequestId;
    render.setLoadState("loading", 5, "Reading image file...", { autoHideSuccess: false });
    // Keep the previous document, including its timer and drafts, until the
    // complete replacement has decoded and passed validation.
    async function prepareAndInstall() {
      const source = await readSource(file);
      if (!isCurrent()) return;
      render.setLoadState("loading", 65, "Decoding and analyzing image...", { autoHideSuccess: false });
      await nextFrame();
      if (!isCurrent()) return;
      const prepared = await prepareSource(source, imageProcessing, { ImageType });
      if (!isCurrent()) return;
      render.resetTimer();
      clearAnnotations();
      imageCache.install(prepared);
      const original = prepared.originalFile;
      Object.assign(imageState, {
        calibration: null,
        revision: (imageState.revision || 0) + 1,
        imageName: original.name,
        imageSize: { width: prepared.image.width, height: prepared.image.height },
        imageFileSizeBytes: original.size,
        imageFileType: original.type,
        imageLastModified: original.lastModified,
      });
      view.resizeCanvasToImage();
      view.resetViewTransform();
      if (emptyState) emptyState.style.display = "none";
      render.metadata();
      render.setLoadState("success", 100, "Image ready.");
      render.onImageReady?.(original);
      render.redraw();
      render.timer();
    }
    void prepareAndInstall().catch(error => {
      if (!isCurrent()) return;
      const detail = error instanceof Error ? error.message : String(error);
      render.setLoadState("error", 100, "Could not open the image.");
      render.onImageError?.(detail);
      alertFn(detail);
    }).finally(() => {
      if (isCurrent() && imageInput) imageInput.value = "";
    });
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
