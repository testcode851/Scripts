import { measurementUnits, normalizeCalibration, resultsCsv } from "./analytics-data.js";

const encoder = new TextEncoder();
const ZIP32_LIMIT = 0xffffffff;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 255];
  return (value ^ 0xffffffff) >>> 0;
}

/** Store already-compressed PNGs and small text files without an external ZIP dependency. */
export function createStoredZip(entries, { allowFolders = false } = {}) {
  if (typeof allowFolders !== "boolean") throw new TypeError("Archive folder support must be true or false.");
  if (!Array.isArray(entries) || !entries.length || entries.length >= 0xffff) {
    throw new Error("The analysis archive must contain between 1 and 65,534 files.");
  }
  const names = new Set();
  const files = Array.from(entries, (entry) => {
    const { name, data } = entry || {};
    if (allowFolders) {
      const segments = typeof name === "string" ? name.split("/") : [];
      if (!segments.length || segments.some(segment => !segment || segment.length > 255 || segment === "." || segment === ".."
        || /[<>:"\\|?*\x00-\x1f\x7f]/.test(segment) || /[. ]$/.test(segment) || /\p{Surrogate}/u.test(segment)
        || /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(segment))) {
        throw new Error("Archive paths must contain safe relative folder and filenames.");
      }
    } else if (typeof name !== "string" || !name || name === "." || name === ".." ||
        /[\/\\:\x00-\x1f\x7f]/.test(name) || /[. ]$/.test(name)) {
      throw new Error("Archive filenames must be safe filenames without folders.");
    }
    const encodedName = encoder.encode(name);
    if (encodedName.length > 0xffff) throw new Error("An archive filename is too long.");
    const normalizedName = name.normalize("NFC").toLowerCase();
    if (names.has(normalizedName)) throw new Error("Archive filenames must be unique.");
    names.add(normalizedName);
    if (!(data instanceof Uint8Array)) throw new Error("Archive file contents must be bytes.");
    if (data.byteLength >= ZIP32_LIMIT) throw new Error("An archive file exceeds the ZIP size limit.");
    return { encodedName, data };
  });
  if (allowFolders) {
    for (const name of names) {
      const segments = name.split("/");
      for (let length = 1; length < segments.length; length += 1) {
        if (names.has(segments.slice(0, length).join("/"))) {
          throw new Error("An archive path cannot be both a file and a folder.");
        }
      }
    }
  }

  // Validate all sizes before computing checksums or constructing any Blob.
  const directorySize = files.reduce((size, file) => size + 46 + file.encodedName.length, 0);
  const directoryOffset = files.reduce((size, file) => size + 30 + file.encodedName.length + file.data.byteLength, 0);
  if (directorySize >= ZIP32_LIMIT || directoryOffset + directorySize + 22 >= ZIP32_LIMIT) {
    throw new Error("The analysis archive exceeds the ZIP size limit.");
  }
  const contents = [];
  const directory = [];
  let offset = 0;
  for (const { encodedName, data } of files) {
    const checksum = crc32(data);
    const local = new Uint8Array(30 + encodedName.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true); // UTF-8 filenames, stored entries.
    localView.setUint16(12, 0x0021, true); // January 1, 1980; timestamps are recorded in JSON.
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, data.byteLength, true);
    localView.setUint32(22, data.byteLength, true);
    localView.setUint16(26, encodedName.length, true);
    local.set(encodedName, 30);
    contents.push(local, data);

    const central = new Uint8Array(46 + encodedName.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(14, 0x0021, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, data.byteLength, true);
    centralView.setUint32(24, data.byteLength, true);
    centralView.setUint16(28, encodedName.length, true);
    centralView.setUint32(42, offset, true);
    central.set(encodedName, 46);
    directory.push(central);
    offset += local.byteLength + data.byteLength;
  }
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, directorySize, true);
  endView.setUint32(16, directoryOffset, true);
  return new Blob([...contents, ...directory, end], { type: "application/zip" });
}

function validatePng(bytes, name, size = null) {
  if (bytes.length < 33 || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    throw new Error(`The ${name} is not a PNG image.`);
  }
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (header.getUint32(8) !== 13 || header.getUint32(12) !== 0x49484452 ||
      header.getUint32(16) === 0 || header.getUint32(20) === 0) {
    throw new Error(`The ${name} has an invalid PNG header.`);
  }
  if (size && (header.getUint32(16) !== size.width || header.getUint32(20) !== size.height)) {
    throw new Error("The analyzed mask dimensions do not match this analysis.");
  }
}

function maskBytes(source, size) {
  if (typeof source !== "string" || !source.startsWith("data:image/png;base64,")) {
    throw new Error("The exact analyzed mask PNG is unavailable.");
  }
  const encoded = source.slice("data:image/png;base64,".length);
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error("The analyzed mask PNG has invalid base64 data.");
  }
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  validatePng(bytes, "analyzed mask", size);
  return bytes;
}

async function fileRecord(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error("File verification is unavailable in this browser.");
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  return {
    sha256: Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""),
    bytes: bytes.byteLength,
  };
}

/** Build a manual download from one captured analysis; this function never saves browser state. */
export async function createAnalysisBundle({
  result, inputMaskPng, image, label, calibration, analyzedAt, exportedAt,
  selectedStrand = null, reportPng, renderingProvenance = null,
}) {
  if (!result || result.schema_version !== 1 || result.unit !== "px" ||
      !Array.isArray(result.per_strand) || !result.summary ||
      !image || !Number.isInteger(image.width) || image.width <= 0 ||
      !Number.isInteger(image.height) || image.height <= 0 ||
      result.width !== image.width || result.height !== image.height) {
    throw new Error("A complete, matching analysis is required to export a bundle.");
  }
  if (!result.provenance || typeof result.provenance !== "object" ||
      Array.isArray(result.provenance) || !Object.keys(result.provenance).length) {
    throw new Error("Software and settings details are unavailable. Run analytics again before exporting a bundle.");
  }
  if (![analyzedAt, exportedAt].every((value) => typeof value === "string" && Number.isFinite(Date.parse(value)))) {
    throw new Error("The analysis and export dates are required.");
  }
  if (label != null && typeof label !== "string") throw new Error("The analysis label filter is invalid.");
  if (!(reportPng instanceof Blob) || reportPng.type !== "image/png") {
    throw new Error("The analysis report PNG is unavailable.");
  }
  const normalizedCalibration = calibration == null ? null : normalizeCalibration(calibration, image);
  if (calibration != null && !normalizedCalibration) throw new Error("The analysis calibration is invalid.");

  // Snapshot metadata and formatted results before the first asynchronous operation.
  const metadata = JSON.parse(JSON.stringify({
    schema_version: 1,
    analyzed_at: analyzedAt,
    exported_at: exportedAt,
    image,
    label_filter: label || null,
    calibration: normalizedCalibration,
    units: measurementUnits(normalizedCalibration),
    selected_strand_id: selectedStrand,
    provenance: renderingProvenance
      ? { ...result.provenance, rendering: renderingProvenance } : result.provenance,
    measurements: {
      image_id: result.image_id, width: result.width, height: result.height, unit: result.unit,
      summary: result.summary, per_strand: result.per_strand,
    },
  }));
  const mask = maskBytes(inputMaskPng, image);
  const csv = encoder.encode(resultsCsv(result, normalizedCalibration));
  const report = new Uint8Array(await reportPng.arrayBuffer());
  validatePng(report, "analysis report");
  const [maskRecord, csvRecord, reportRecord] = await Promise.all([
    fileRecord(mask), fileRecord(csv), fileRecord(report),
  ]);
  metadata.files = { "mask.png": maskRecord, "results.csv": csvRecord, "report.png": reportRecord };
  return createStoredZip([
    { name: "mask.png", data: mask },
    { name: "results.csv", data: csv },
    { name: "analysis.json", data: encoder.encode(`${JSON.stringify(metadata, null, 2)}\n`) },
    { name: "report.png", data: report },
  ]);
}
