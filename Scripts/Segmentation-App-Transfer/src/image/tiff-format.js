const knownTags = new Set([
  256, 257, 258, 259, 262, 266, 270, 273, 274, 277, 278, 279, 284, 297, 317,
  322, 323, 324, 325, 330, 338, 339, 32997, 32998,
]);
const fieldSize = { 1: 1, 2: 1, 3: 2, 4: 4, 13: 4, 16: 8, 18: 8 };

/** Read just the image-layout fields. Private instrument metadata stays in the original file. */
export function inspectTiff(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const littleEndian = bytes[0] === 73;
  function requireRange(pos, size) {
    if (!Number.isSafeInteger(pos) || !Number.isSafeInteger(size) || pos < 0 || size < 0 || pos > bytes.length - size) {
      throw new Error("The TIFF contains a truncated directory or image block.");
    }
  }
  requireRange(0, 8);
  const short = pos => view.getUint16(pos, littleEndian);
  const long = pos => view.getUint32(pos, littleEndian);
  const long8 = pos => {
    const value = Number(view.getBigUint64(pos, littleEndian));
    if (!Number.isSafeInteger(value)) throw new Error("The TIFF contains an unsupported 64-bit offset or count.");
    return value;
  };
  const version = short(2);
  const big = version === 43;
  if (version !== 42 && !big) throw new Error("The TIFF file header is invalid.");
  if (big) {
    requireRange(0, 16);
    if (short(4) !== 8 || short(6) !== 0) throw new Error("Unsupported BigTIFF offset format.");
  }
  const offsetValue = big ? long8 : long;
  const ifd = big ? long8(8) : long(4);
  const countSize = big ? 8 : 2;
  const entrySize = big ? 20 : 12;
  const pointerSize = big ? 8 : 4;
  requireRange(ifd, countSize);
  const count = big ? long8(ifd) : short(ifd);
  const entries = ifd + countSize;
  requireRange(entries, count * entrySize + pointerSize);
  const stackError = () => new Error("TIFF stacks, pyramids, and volumes are unsupported. Choose a single-page image.");
  if (offsetValue(entries + count * entrySize)) throw stackError();
  const tags = new Map();
  for (let i = 0; i < count; i += 1) {
    const entry = entries + i * entrySize;
    const id = short(entry);
    if (!knownTags.has(id)) continue;
    const type = short(entry + 2);
    if (id === 270 && type !== 2) continue;
    const size = fieldSize[type];
    if (!size) throw new Error("The TIFF has an unsupported data type for tag " + id + ".");
    const length = offsetValue(entry + 4);
    const field = entry + (big ? 12 : 8);
    const data = length * size <= pointerSize ? field : offsetValue(field);
    requireRange(data, length * size);
    if (id === 270) {
      // ImageJ can describe multiple contiguous planes using just one directory.
      // Instrument writers may also include a second, unrelated description.
      const text = new TextDecoder().decode(bytes.subarray(data, data + Math.min(2048, length)));
      if (/^ImageJ=/.test(text) && Number(/^images=(\d+)/m.exec(text)?.[1]) > 1) throw stackError();
      continue;
    }
    if (tags.has(id)) throw new Error("The TIFF has duplicate image layout tags.");
    tags.set(id, { type, length, data, size });
  }
  function value(tag, index) {
    const pos = tag.data + index * tag.size;
    switch (tag.type) {
      case 1: return bytes[pos];
      case 3: return short(pos);
      case 4: case 13: return long(pos);
      case 16: case 18: return long8(pos);
      default: throw new Error("The TIFF image layout requires integer values.");
    }
  }
  function scalar(id, fallback) {
    const tag = tags.get(id);
    if (!tag) return fallback;
    if (tag.length !== 1) throw new Error("TIFF tag " + id + " must contain one value.");
    return value(tag, 0);
  }
  const page = tags.get(297);
  if (tags.get(330)?.length || scalar(32997, 1) !== 1 || scalar(32998, 1) !== 1 ||
      (page?.length === 2 && value(page, 1) > 1)) throw stackError();
  if (scalar(277, 1) !== 1 || tags.get(338)?.length || tags.get(258)?.length > 1 ||
      ![0, 1].includes(scalar(262))) throw new Error("Choose a single-channel grayscale TIFF.");
  if (scalar(258, 1) !== 16 || scalar(339, 1) !== 1) throw new Error("Choose an unsigned 16-bit grayscale TIFF.");
  const sourceWidth = scalar(256), sourceHeight = scalar(257);
  if (!Number.isSafeInteger(sourceWidth * sourceHeight) || !sourceWidth || !sourceHeight) throw new Error("The TIFF image dimensions are invalid.");
  const orientation = scalar(274, 1);
  if (orientation < 1 || orientation > 8) throw new Error("The TIFF orientation is invalid.");
  const compression = scalar(259, 1);
  if (![1, 5, 8, 32946, 32773].includes(compression)) throw new Error("Unsupported TIFF compression (" + compression + "). Use uncompressed, LZW, Deflate, or PackBits.");
  const predictor = scalar(317, 1);
  if (![1, 2].includes(predictor)) throw new Error("The TIFF predictor is unsupported.");
  const fillOrder = scalar(266, 1);
  if (![1, 2].includes(fillOrder)) throw new Error("The TIFF bit order is invalid.");
  if (![1, 2].includes(scalar(284, 1))) throw new Error("The TIFF planar configuration is invalid.");

  const tiled = tags.has(324) || tags.has(325);
  const blockWidth = tiled ? scalar(322) : sourceWidth;
  const blockHeight = tiled ? scalar(323) : Math.min(scalar(278, sourceHeight), sourceHeight);
  if (!blockWidth || !blockHeight || !Number.isSafeInteger(blockWidth * blockHeight * 2)) throw new Error("The TIFF strip or tile size is invalid.");
  const blocksAcross = Math.ceil(sourceWidth / blockWidth);
  const blockCount = blocksAcross * Math.ceil(sourceHeight / blockHeight);
  const offsetsTag = tags.get(tiled ? 324 : 273);
  const lengthsTag = tags.get(tiled ? 325 : 279);
  if (offsetsTag?.length !== blockCount || lengthsTag?.length !== blockCount) throw new Error("The TIFF strip or tile count does not match the image dimensions.");
  const offsets = new Float64Array(blockCount);
  const lengths = new Float64Array(blockCount);
  for (let i = 0; i < blockCount; i += 1) {
    offsets[i] = value(offsetsTag, i);
    lengths[i] = value(lengthsTag, i);
    if (!lengths[i]) throw new Error("The TIFF contains an empty image block.");
    requireRange(offsets[i], lengths[i]);
    if (compression === 1) {
      const rows = tiled ? blockHeight : Math.min(blockHeight, sourceHeight - i * blockHeight);
      if (lengths[i] !== rows * blockWidth * 2) throw new Error("An uncompressed TIFF block has the wrong byte count.");
    }
  }
  return {
    format: "tiff", mimeType: "image/tiff", bitDepth: 16, sourceWidth, sourceHeight,
    width: orientation > 4 ? sourceHeight : sourceWidth,
    height: orientation > 4 ? sourceWidth : sourceHeight,
    whiteIsZero: scalar(262) === 0, littleEndian, orientation, compression, predictor, fillOrder,
    tiled, blockWidth, blockHeight, blocksAcross, offsets, lengths,
  };
}
