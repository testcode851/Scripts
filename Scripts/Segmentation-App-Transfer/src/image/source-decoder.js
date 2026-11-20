import { inspectSource } from "./source-format.js";

// Bound memory before creating native sample planes or expanding a compressed block.
const maxRasterBytes = 512 * 1024 * 1024;
function checkSize(size) {
  if (!Number.isSafeInteger(size) || size <= 0 || size > maxRasterBytes) {
    throw new Error("The decoded 16-bit raster or image block exceeds the 512 MiB limit.");
  }
}

async function inflate(parts, size) {
  checkSize(size);
  const output = new Uint8Array(size);
  const stream = new Blob(parts).stream().pipeThrough(new DecompressionStream("deflate"));
  const reader = stream.getReader();
  let pos = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.length > size - pos) throw new Error("The decompressed image data exceeds its declared dimensions.");
      output.set(value, pos);
      pos += value.length;
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw new Error("Invalid compressed image data: " + error.message, { cause: error });
  } finally {
    reader.releaseLock();
  }
  if (pos !== size) throw new Error("The decompressed image data is incomplete.");
  return output;
}

function unpackBits(input, size) {
  const output = new Uint8Array(size);
  let pos = 0, written = 0;
  while (pos < input.length) {
    const code = input[pos++];
    if (code === 128) continue;
    const literal = code < 128;
    const count = literal ? code + 1 : 257 - code;
    if (count > size - written || pos + (literal ? count : 1) > input.length) throw new Error("Invalid TIFF PackBits run.");
    if (literal) {
      output.set(input.subarray(pos, pos + count), written);
      pos += count;
    } else {
      output.fill(input[pos++], written, written + count);
    }
    written += count;
  }
  if (written !== size) throw new Error("The TIFF PackBits block is incomplete.");
  return output;
}

function unpackLzw(input, size) {
  const output = new Uint8Array(size);
  const prefix = new Uint16Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4096);
  let pos = 0, written = 0, bits = 0, buffer = 0;
  let width = 9, next = 258, previous = -1;
  while (true) {
    while (bits < width) {
      if (pos === input.length) throw new Error("The TIFF LZW block is missing its end code.");
      buffer = (buffer << 8) | input[pos++];
      bits += 8;
    }
    bits -= width;
    const code = (buffer >>> bits) & ((1 << width) - 1);
    if (code === 256) {
      width = 9; next = 258; previous = -1;
      continue;
    }
    if (code === 257) break;
    if (code > next || (code >= 258 && previous === -1)) throw new Error("Invalid TIFF LZW dictionary code.");
    let current = code === next ? previous : code;
    let depth = 0;
    while (current >= 258) {
      stack[depth++] = suffix[current];
      current = prefix[current];
    }
    const first = current;
    const length = depth + 1 + Number(code === next);
    if (length > size - written) throw new Error("The TIFF LZW output exceeds the block dimensions.");
    output[written++] = first;
    while (depth) output[written++] = stack[--depth];
    if (code === next) output[written++] = first;
    if (previous >= 0 && next < 4096) {
      prefix[next] = previous;
      suffix[next++] = first;
      // TIFF advances the code width one entry earlier than GIF's LZW variant.
      if (width < 12 && next === (1 << width) - 1) width++;
    }
    previous = code;
  }
  if (written !== size) throw new Error("The TIFF LZW block is incomplete.");
  return output;
}

const reversedBits = Uint8Array.from({ length: 256 }, (_, byte) => {
  let result = 0;
  for (let bit = 0; bit < 8; bit++) result = (result << 1) | ((byte >>> bit) & 1);
  return result;
});

// Destination index of source (0,0), step for source x, step for source y.
// Both TIFF Orientation and PNG eXIf use the same eight transforms.
function orientedSteps({ width, height, orientation }) {
  const n = width * height;
  return [
    [0, 1, width], [width - 1, -1, width], [n - 1, -1, -width], [n - width, 1, -width],
    [0, width, 1], [width - 1, width, -1], [n - 1, -width, -1], [n - width, -width, 1],
  ][orientation - 1];
}

async function decodeTiff(bytes, info) {
  const { width, height, sourceWidth, sourceHeight, blockWidth, blockHeight } = info;
  const n = width * height;
  checkSize(n * 2);
  const samples = new Uint16Array(n);
  const [origin, dx, dy] = orientedSteps(info);
  for (let i = 0; i < info.offsets.length; i++) {
    const x = (i % info.blocksAcross) * blockWidth;
    const y = Math.floor(i / info.blocksAcross) * blockHeight;
    const rows = Math.min(blockHeight, sourceHeight - y);
    const cols = Math.min(blockWidth, sourceWidth - x);
    const size = (info.tiled ? blockHeight : rows) * blockWidth * 2;
    checkSize(size);
    let raw = bytes.subarray(info.offsets[i], info.offsets[i] + info.lengths[i]);
    if (info.fillOrder === 2) raw = raw.map(byte => reversedBits[byte]);
    switch (info.compression) {
      case 5: raw = unpackLzw(raw, size); break;
      case 8: case 32946: raw = await inflate([raw], size); break;
      case 32773: raw = unpackBits(raw, size); break;
    }
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    for (let row = 0; row < rows; row++) {
      let dest = origin + x * dx + (y + row) * dy;
      let previous = 0;
      let pos = row * blockWidth * 2;
      for (let col = 0; col < cols; col++, dest += dx, pos += 2) {
        let value = view.getUint16(pos, info.littleEndian);
        if (info.predictor === 2) value = previous = (value + previous) & 0xffff;
        samples[dest] = info.whiteIsZero ? 65535 - value : value;
      }
    }
  }
  return { width, height, samples };
}

const adam7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];

function paeth(a, b, c) {
  const estimate = a + b - c;
  const da = Math.abs(estimate - a), db = Math.abs(estimate - b), dc = Math.abs(estimate - c);
  if (da <= db && da <= dc) return a;
  return db <= dc ? b : c;
}

function unfilter(row, previous, pixelBytes, mode) {
  if (!mode) return;
  if (mode > 4) throw new Error("The PNG image contains an invalid scanline filter.");
  for (let i = 0; i < row.length; i++) {
    const left = i >= pixelBytes ? row[i - pixelBytes] : 0;
    const above = previous ? previous[i] : 0;
    const upperLeft = previous && i >= pixelBytes ? previous[i - pixelBytes] : 0;
    switch (mode) {
      case 1: row[i] += left; break;
      case 2: row[i] += above; break;
      case 3: row[i] += (left + above) >>> 1; break;
      case 4: row[i] += paeth(left, above, upperLeft); break;
    }
  }
}

async function decodePng(bytes, info) {
  const { width, height, sourceWidth, sourceHeight, colorType, transparentColor } = info;
  const color = colorType === 2 || colorType === 6;
  const hasAlpha = colorType === 4 || colorType === 6;
  const channels = (color ? 3 : 1) + Number(hasAlpha);
  const pixelBytes = channels * 2;
  checkSize(width * height * pixelBytes);
  const passes = (info.interlaced ? adam7 : [[0, 0, 1, 1]]).map(([x, y, dx, dy]) => ({
    x, y, dx, dy, cols: Math.ceil((sourceWidth - x) / dx), rows: Math.ceil((sourceHeight - y) / dy),
  })).filter(pass => pass.cols > 0 && pass.rows > 0);
  const size = passes.reduce((sum, pass) => sum + pass.rows * (1 + pass.cols * pixelBytes), 0);
  const raw = await inflate(info.idat.map(({ start, end }) => bytes.subarray(start, end)), size);
  const view = new DataView(raw.buffer);
  const samples = new Uint16Array(width * height);
  const rgb = color ? new Uint16Array(width * height * 3) : null;
  const alpha = hasAlpha || transparentColor ? new Uint16Array(width * height) : null;
  const [origin, dx, dy] = orientedSteps(info);
  let pos = 0;
  for (const pass of passes) {
    let previous = null;
    for (let row = 0; row < pass.rows; row++) {
      const mode = raw[pos++];
      const scanline = raw.subarray(pos, pos + pass.cols * pixelBytes);
      unfilter(scanline, previous, pixelBytes, mode);
      previous = scanline;
      let pixel = origin + (pass.y + row * pass.dy) * dy + pass.x * dx;
      for (let col = 0; col < pass.cols; col++, pixel += pass.dx * dx, pos += pixelBytes) {
        const r = view.getUint16(pos);
        let transparent = Boolean(transparentColor && r === transparentColor[0]);
        if (color) {
          const g = view.getUint16(pos + 2), b = view.getUint16(pos + 4);
          rgb[pixel * 3] = r; rgb[pixel * 3 + 1] = g; rgb[pixel * 3 + 2] = b;
          samples[pixel] = Math.round((299 * r + 587 * g + 114 * b) / 1000);
          transparent = transparent && g === transparentColor[1] && b === transparentColor[2];
        } else {
          samples[pixel] = r;
        }
        if (alpha) alpha[pixel] = hasAlpha ? view.getUint16(pos + pixelBytes - 2) : transparent ? 0 : 65535;
      }
    }
  }
  return { width, height, samples, ...(rgb && { rgb }), ...(alpha && { alpha }) };
}

/** Native brightness and optional color/alpha planes on the original image grid. */
export async function decodeNativeSamples(bytes, info = inspectSource(bytes)) {
  if (info.bitDepth !== 16) return null;
  return info.format === "tiff" ? decodeTiff(bytes, info) : decodePng(bytes, info);
}
