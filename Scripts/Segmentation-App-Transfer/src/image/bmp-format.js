// Inspect the layout before the browser expands the palette or reorders the rows.
// The file header is followed by a DIB header, an optional palette, and the pixels.
export function inspectBmp(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 18) throw new Error("The BMP file header is incomplete.");
  const dibSize = view.getUint32(14, true);
  const coreHeader = dibSize === 12;
  if (![12, 40, 52, 56, 108, 124].includes(dibSize)) {
    throw new Error("This BMP header is unsupported. Choose an uncompressed Windows BMP.");
  }
  const headerEnd = 14 + dibSize;
  if (headerEnd > bytes.length) throw new Error("The BMP image header is incomplete.");
  const width = coreHeader ? view.getUint16(18, true) : view.getInt32(18, true);
  const storedHeight = coreHeader ? view.getUint16(20, true) : view.getInt32(22, true);
  const height = Math.abs(storedHeight); // A negative height means the top row is stored first.
  const planes = view.getUint16(coreHeader ? 22 : 26, true);
  const bitDepth = view.getUint16(coreHeader ? 24 : 28, true);
  const compression = coreHeader ? 0 : view.getUint32(30, true);
  if (planes !== 1 || ![8, 24].includes(bitDepth) || compression !== 0) {
    throw new Error("Choose an uncompressed 8-bit palette or 24-bit RGB BMP.");
  }
  if (width <= 0 || !height) throw new Error("The BMP image dimensions are invalid.");

  const fileSize = view.getUint32(2, true) || bytes.length;
  const pixelOffset = view.getUint32(10, true);
  // Scanlines are padded to four-byte boundaries, even for 24-bit RGB.
  const stride = 4 * Math.ceil(width * (bitDepth / 8) / 4);
  const rasterSize = stride * height;
  if (!Number.isSafeInteger(rasterSize) || fileSize > bytes.length || pixelOffset > fileSize - rasterSize) {
    throw new Error("The BMP pixel data is truncated or exceeds the declared file size.");
  }
  if (width * height * 4 > 512 * 1024 * 1024) {
    throw new Error("The decoded BMP raster exceeds the 512 MiB limit.");
  }
  const imageSize = coreHeader ? 0 : view.getUint32(34, true);
  if (imageSize && (imageSize < rasterSize || imageSize > fileSize - pixelOffset)) {
    throw new Error("The declared BMP pixel data size is invalid.");
  }

  // An 8-bit image with no explicit color count uses the entire 256-entry
  // table. A 24-bit image can carry an optional palette for display devices.
  const colorsUsed = coreHeader ? 0 : view.getUint32(46, true);
  const paletteSize = colorsUsed || (bitDepth === 8 ? 256 : 0);
  const paletteEnd = headerEnd + paletteSize * (coreHeader ? 3 : 4);
  if ((bitDepth === 8 && paletteSize > 256) || paletteEnd > pixelOffset) {
    throw new Error("The BMP color table or pixel offset is invalid.");
  }
  if (bitDepth === 8 && paletteSize < 256) {
    for (let row = pixelOffset; row < pixelOffset + rasterSize; row += stride) {
      for (let pos = row; pos < row + width; pos++) {
        if (bytes[pos] >= paletteSize) throw new Error("A BMP pixel refers to a missing palette color.");
      }
    }
  }
  return { format: "bmp", mimeType: "image/bmp", width, height, bitDepth };
}
