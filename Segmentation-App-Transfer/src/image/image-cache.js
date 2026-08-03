/** Own derived image sources and smart-snap analysis cache selection. */
export function createImageCache({
  imageState,
  settingsState,
  imageProcessing,
}) {
  function getActiveImageSource() {
    return settingsState.sourceEnhancement === "hist-eq" &&
      imageState.equalizedImage
      ? imageState.equalizedImage
      : imageState.image;
  }

  function getActiveAnalysis() {
    return settingsState.sourceEnhancement === "hist-eq" &&
      imageState.imageAnalysisEqualized
      ? imageState.imageAnalysisEqualized
      : imageState.imageAnalysisOriginal;
  }

  function ensure() {
    if (!imageState.image) return;
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
    equalizedImage,
    originalAnalysis,
    equalizedAnalysis,
  }) {
    imageState.image = image;
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
