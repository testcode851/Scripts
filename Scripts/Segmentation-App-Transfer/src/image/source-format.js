import { inspectBmp } from "./bmp-format.js";
import { inspectTiff } from "./tiff-format.js";

const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function pngCrc(bytes, start, end) {
  let crc = 0xffffffff;
  for (let pos = start; pos < end; pos += 1) crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[pos]) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

// A PNG eXIf chunk starts at a classic TIFF header. Only the main directory
// describes this raster; a thumbnail can carry a different orientation.
function pngOrientation(bytes) {
  if (bytes.length < 8) return 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const order = view.getUint16(0);
  const little = order === 0x4949;
  if ((!little && order !== 0x4d4d) || view.getUint16(2, little) !== 42) return 1;
  const ifd = view.getUint32(4, little);
  if (ifd < 8 || ifd > bytes.length - 2) return 1;
  const count = view.getUint16(ifd, little);
  if (count > Math.floor((bytes.length - ifd - 2) / 12)) return 1;
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (view.getUint16(entry, little) !== 274 || view.getUint16(entry + 2, little) !== 3
        || view.getUint32(entry + 4, little) !== 1) continue;
    const orientation = view.getUint16(entry + 8, little);
    return orientation >= 1 && orientation <= 8 ? orientation : 1;
  }
  return 1;
}

function inspectPng(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 33 || view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) {
    throw new Error("The PNG image header is invalid.");
  }
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  const interlaced = bytes[28];
  const allowedDepths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
  if (!width || !height || width > 0x7fffffff || height > 0x7fffffff) {
    throw new Error("The PNG image dimensions are invalid.");
  }
  if (!allowedDepths[colorType]?.includes(bitDepth) || bytes[26] || bytes[27] || interlaced > 1) {
    throw new Error("The PNG image has unsupported color, compression, filter, or interlace fields.");
  }

  // Browser Image.onload can succeed on a truncated PNG. Check the complete file
  // (including ancillary metadata) before installing the document or storing it.
  const idat = [];
  let idatBytes = 0;
  let transparentColor = null;
  let hasColorProfile = false;
  let orientation = 1;
  let sawExif = false;
  let ended = false;
  for (let pos = 8; pos < bytes.length;) {
    if (bytes.length - pos < 12) throw new Error("The PNG image contains a truncated chunk.");
    const length = view.getUint32(pos);
    if (length > 0x7fffffff || length > bytes.length - pos - 12) throw new Error("The PNG image contains an invalid chunk length.");
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    const data = pos + 8;
    const end = data + length;
    if (!/^[A-Za-z]{4}$/.test(type) || (type === "IHDR" && pos !== 8)) throw new Error("The PNG image contains an invalid chunk header.");
    if (pngCrc(bytes, pos + 4, end) !== view.getUint32(end)) throw new Error("The PNG image contains a corrupted chunk (checksum mismatch).");
    if (["gAMA", "cHRM", "iCCP", "sRGB", "cICP"].includes(type)) hasColorProfile = true;
    // Chromium applies the specified pre-IDAT profile; late profiles are ignored.
    if (type === "eXIf" && !idat.length) {
      if (sawExif) throw new Error("The PNG has more than one Exif profile.");
      orientation = pngOrientation(bytes.subarray(data, end));
      sawExif = true;
    }
    if (type === "IDAT") {
      idat.push({ start: data, end });
      idatBytes += length;
    }
    if (type === "tRNS" && bitDepth === 16) {
      const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : 0;
      if (!channels || length !== channels * 2 || transparentColor || idat.length) throw new Error("The PNG transparency chunk is invalid.");
      transparentColor = Array.from({ length: channels }, (_, i) => view.getUint16(data + i * 2));
    }
    if (type === "IEND") {
      if (length !== 0 || end + 4 !== bytes.length) throw new Error("The PNG image has an invalid end-of-image chunk.");
      ended = true;
    }
    pos = end + 4;
  }
  if (!ended || !idatBytes) throw new Error("The PNG image is incomplete.");
  return {
    format: "png", mimeType: "image/png", sourceWidth: width, sourceHeight: height,
    width: orientation > 4 ? height : width, height: orientation > 4 ? width : height,
    orientation, bitDepth, colorType, interlaced, hasColorProfile, transparentColor, idat,
  };
}

/** Inspect the encoded bytes, independent of the filename or browser MIME guess. */
export function inspectSource(bytes) {
  if (pngSignature.every((value, i) => value === bytes[i])) return inspectPng(bytes);
  if ((bytes[0] === 73 && bytes[1] === 73) || (bytes[0] === 77 && bytes[1] === 77)) return inspectTiff(bytes);
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return inspectBmp(bytes);
  throw new Error("Choose a PNG, an uncompressed 8-bit or 24-bit BMP, or a single-page unsigned 16-bit grayscale TIFF.");
}
