import { formatBytes, formatImageTimestamp } from "../utils/formatting.js";

/** Create the image metadata renderer with explicit state and element dependencies. */
export function createImageMetadataPanel({ elements, imageState, renderInvalidation }) {
  const {
    metaImageName,
    metaImageDimensions,
    metaImageSize,
    metaImageType,
    metaImageUpdated,
  } = elements;

  function render() {
    const name = imageState.imageName || "-";
    const dimensions = imageState.imageSize
      ? `${imageState.imageSize.width} x ${imageState.imageSize.height}px`
      : "-";
    const fileSize = formatBytes(imageState.imageFileSizeBytes);
    const fileType = imageState.imageFileType || (imageState.image ? "image/png" : "-");
    const updated = formatImageTimestamp(imageState.imageLastModified);
    const nextKey = [name, dimensions, fileSize, fileType, updated].join("|");
    if (!renderInvalidation.hasChanged("image-metadata", nextKey)) {
      return;
    }
    if (metaImageName) metaImageName.textContent = name;
    if (metaImageDimensions) metaImageDimensions.textContent = dimensions;
    if (metaImageSize) metaImageSize.textContent = fileSize;
    if (metaImageType) metaImageType.textContent = fileType;
    if (metaImageUpdated) metaImageUpdated.textContent = updated;
  }

  return Object.freeze({ render });
}
