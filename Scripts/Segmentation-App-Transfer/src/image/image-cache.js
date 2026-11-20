import { DEFAULT_IMAGE_DISPLAY } from "../config/settings.js";

/** Own derived image sources and smart-snap analysis cache selection. */
export function createImageCache({
  imageState,
  settingsState,
  imageProcessing,
}) {
  const previews = new WeakMap();

  function getActiveImageSource() {
    const native = imageState.native;
    if (native) {
      const { blackLevel, whiteLevel, imageContrast, sourceEnhancement } = settingsState;
      if (blackLevel === 0 && whiteLevel === 65535 && imageContrast === 100 && sourceEnhancement === "none") {
        return imageState.image;
      }
      const key = [blackLevel, whiteLevel, imageContrast, sourceEnhancement].join("/");
      let preview = previews.get(native);
      if (!preview) {
        preview = {};
        previews.set(native, preview);
      }
      if (preview.key !== key) {
        imageProcessing.buildNativeCanvas(native, settingsState, preview);
        preview.key = key;
      }
      return preview.canvas;
    }
    return settingsState.sourceEnhancement === "hist-eq" &&
      imageState.equalizedImage
      ? imageState.equalizedImage
      : imageState.image;
  }

  function getActiveAnalysis() {
    if (imageState.native) {
      imageState.imageAnalysisOriginal ??= imageProcessing.buildNativeAnalysis(imageState.native);
      return imageState.imageAnalysisOriginal;
    }
    return settingsState.sourceEnhancement === "hist-eq" &&
      imageState.imageAnalysisEqualized
      ? imageState.imageAnalysisEqualized
      : imageState.imageAnalysisOriginal;
  }

  function ensure() {
    if (!imageState.image || imageState.native) return;
    if (!imageState.imageAnalysisOriginal) {
      imageState.imageAnalysisOriginal =
        imageProcessing.buildImageAnalysisData(imageState.image);
    }
    if (
      settingsState.sourceEnhancement === "hist-eq" &&
      !imageState.equalizedImage
    ) {
      imageState.equalizedImage =
        imageProcessing.buildHistogramEqualizedCanvas(imageState.image);
    }
    if (
      imageState.equalizedImage &&
      !imageState.imageAnalysisEqualized
    ) {
      imageState.imageAnalysisEqualized =
        imageProcessing.buildImageAnalysisData(imageState.equalizedImage);
    }
  }

  function install({
    image,
    native = null,
    originalFile = null,
    equalizedImage = null,
    originalAnalysis = null,
    equalizedAnalysis = null,
  }) {
    Object.assign(settingsState, DEFAULT_IMAGE_DISPLAY);
    imageState.image = image;
    imageState.originalFile = originalFile;
    imageState.native = native;
    imageState.equalizedImage = equalizedImage;
    imageState.imageAnalysisOriginal = originalAnalysis;
    imageState.imageAnalysisEqualized = equalizedAnalysis;
  }

  return Object.freeze({
    ensure,
    getActiveAnalysis,
    getActiveImageSource,
    install,
  });
}
