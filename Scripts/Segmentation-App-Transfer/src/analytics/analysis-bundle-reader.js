import { measurementUnits, normalizeCalibration, resultsCsv } from "./analytics-data.js";

const MiB = 1024 * 1024;
const MAX_ARCHIVE_BYTES = 256 * MiB;
const FILE_TYPES = {
  "mask.png": "image/png",
  "results.csv": "text/csv",
  "analysis.json": "application/json",
  "report.png": "image/png",
};
const FILE_LIMITS = {
  "mask.png": 12 * MiB,
  "results.csv": 24 * MiB,
  "analysis.json": 192 * MiB,
  "report.png": 96 * MiB,
};
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isText = (value, maximum = 4096) => typeof value === "string" && value.length > 0 && value.length <= maximum;
const isCount = (value, maximum = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= 0 && value <= maximum;
const isFinitePositive = (value) => Number.isFinite(value) && value > 0;
const isHash = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

function fail(message) {
  throw new Error(`Invalid analysis bundle: ${message}`);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

function decode(bytes, name) {
  try {
    return decoder.decode(bytes);
  } catch {
    fail(`${name} is not valid UTF-8 text.`);
  }
}

function equalBytes(a, b) {
  return a.byteLength === b.byteLength && a.every((byte, index) => byte === b[index]);
}

function sameValue(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => sameValue(value, b[index]));
  }
  if (!isObject(a) || !isObject(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key]));
}

function readStoredFiles(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const within = (offset, length, end = bytes.length) => {
    if (!isCount(offset) || !isCount(length) || offset > end - length) fail("the ZIP is truncated or has invalid offsets.");
  };
  const u16 = (offset) => { within(offset, 2); return view.getUint16(offset, true); };
  const u32 = (offset) => { within(offset, 4); return view.getUint32(offset, true); };
  const end = bytes.length - 22;
  within(end, 22);
  if (u32(end) !== 0x06054b50 || u16(end + 20) !== 0) {
    fail("use the original exported ZIP; ZIP comments, trailing content, and repacked archives are unsupported.");
  }
  if (u16(end + 4) !== 0 || u16(end + 6) !== 0 || u16(end + 8) !== 4 || u16(end + 10) !== 4) {
    fail("the ZIP must contain exactly the four exported files in one archive.");
  }
  const directorySize = u32(end + 12);
  const directoryStart = u32(end + 16);
  if (directoryStart + directorySize !== end) fail("the ZIP directory size is inconsistent.");
  within(directoryStart, directorySize, end);
  const files = {};
  let directory = directoryStart;
  let expectedLocal = 0;
  for (let index = 0; index < 4; index += 1) {
    within(directory, 46, end);
    if (u32(directory) !== 0x02014b50) fail("the ZIP directory is damaged.");
    if (u16(directory + 10) !== 0 || u16(directory + 8) !== 0x0800) {
      fail("compressed or encrypted ZIP entries are unsupported. Use the original exported ZIP.");
    }
    if (u16(directory + 4) !== 20 || u16(directory + 6) !== 20 ||
        u16(directory + 30) !== 0 || u16(directory + 32) !== 0 ||
        u16(directory + 34) !== 0 || u16(directory + 36) !== 0 ||
        u32(directory + 38) !== 0) {
      fail("repacked ZIP entries are unsupported. Use the original exported ZIP.");
    }
    const length = u32(directory + 24);
    const nameLength = u16(directory + 28);
    const local = u32(directory + 42);
    const checksum = u32(directory + 16);
    within(directory + 46, nameLength, end);
    const encodedName = bytes.subarray(directory + 46, directory + 46 + nameLength);
    const name = decode(encodedName, "ZIP filename");
    if (!Object.hasOwn(FILE_TYPES, name) || Object.hasOwn(files, name) || !equalBytes(encodedName, encoder.encode(name))) {
      fail("the ZIP contains an unexpected or duplicate filename.");
    }
    if (length > FILE_LIMITS[name]) fail(`${name} exceeds its supported size limit.`);
    if (u32(directory + 20) !== length) fail("stored ZIP sizes are inconsistent.");
    if (local !== expectedLocal) fail("ZIP file entries overlap or have unrecognized content between them.");
    within(local, 30 + nameLength, directoryStart);
    if (u32(local) !== 0x04034b50 || u16(local + 4) !== 20 ||
        u16(local + 6) !== 0x0800 || u16(local + 8) !== 0 ||
        u16(local + 10) !== u16(directory + 12) ||
        u16(local + 12) !== u16(directory + 14) ||
        u32(local + 14) !== checksum || u32(local + 18) !== length ||
        u32(local + 22) !== length || u16(local + 26) !== nameLength ||
        u16(local + 28) !== 0 ||
        !equalBytes(bytes.subarray(local + 30, local + 30 + nameLength), encodedName)) {
      fail("the local ZIP headers do not match the directory.");
    }
    const dataStart = local + 30 + nameLength;
    within(dataStart, length, directoryStart);
    const data = bytes.subarray(dataStart, dataStart + length);
    if (crc32(data) !== checksum) fail(`${name} has a damaged ZIP checksum.`);
    files[name] = data;
    expectedLocal = dataStart + length;
    directory += 46 + nameLength;
  }
  if (directory !== end || expectedLocal !== directoryStart) fail("the ZIP has unrecognized or overlapping content.");
  return files;
}

function validatePng(bytes, name, expectedSize = null) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 45 || !signature.every((value, index) => bytes[index] === value)) fail(`${name} is not a PNG image.`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) fail(`${name} has an invalid PNG header.`);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const dimensionLimit = expectedSize ? 12000 : 20000;
  const pixelLimit = expectedSize ? 25_000_000 : 40_000_000;
  if (!width || !height || width > dimensionLimit || height > dimensionLimit || width * height > pixelLimit) {
    fail(`${name} exceeds the supported image dimensions.`);
  }
  if (expectedSize && (width !== expectedSize.width || height !== expectedSize.height)) {
    fail("the mask dimensions do not match the saved analysis.");
  }
  let offset = 8;
  let hasPixels = false;
  while (offset < bytes.length) {
    if (offset > bytes.length - 12) fail(`${name} is truncated.`);
    const length = view.getUint32(offset);
    const type = view.getUint32(offset + 4);
    if (length > bytes.length - offset - 12) fail(`${name} has an invalid PNG chunk.`);
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== view.getUint32(offset + 8 + length)) {
      fail(`${name} has a damaged PNG checksum.`);
    }
    if ([0x6163544c, 0x6663544c, 0x66644154].includes(type)) {
      fail(`${name} is animated. Analysis bundles require static PNG images.`);
    }
    if (type === 0x49484452 && offset !== 8) fail(`${name} contains duplicate PNG headers.`);
    if (type === 0x49444154) hasPixels = true;
    offset += length + 12;
    if (type === 0x49454e44) {
      if (length !== 0 || offset !== bytes.length || !hasPixels) fail(`${name} has an invalid PNG ending.`);
      return;
    }
  }
  fail(`${name} is missing its PNG ending.`);
}

function validateProvenance(value) {
  if (!isObject(value) || value.schema_version !== 1 ||
      !isObject(value.method) || !["name", "callable", "runner"].every((key) => isText(value.method[key])) ||
      !isObject(value.settings) || !isObject(value.benchmark) || !isObject(value.adapter) || !isObject(value.environment)) {
    fail("software and measurement settings are incomplete or unsupported.");
  }
  const settings = value.settings;
  if (!isCount(settings.sampling_stride) || settings.sampling_stride < 1 ||
      !isFinitePositive(settings.maximum_half_walk_px) || !isFinitePositive(settings.benchmark_resolution_um_per_px) ||
      !isFinitePositive(settings.benchmark_result_to_px_divisor) ||
      !Number.isFinite(settings.outlier_tolerance_fraction) || settings.outlier_tolerance_fraction < 0 ||
      !isCount(settings.low_transect_count_threshold) || settings.reported_measurement_unit !== "px" ||
      settings.input_mask_processing !== "none" || settings.low_transect_count_action !== "flag_only") {
    fail("the saved measurement settings are invalid.");
  }
  const benchmark = value.benchmark;
  if (!isText(benchmark.name) || (benchmark.version !== null && !isText(benchmark.version)) ||
      benchmark.version_basis !== "source_sha256" || !isHash(benchmark.sha256) ||
      !isText(benchmark.runner_policy_source, 262144) || !isText(benchmark.method_policy_source, 262144) ||
      !Array.isArray(benchmark.sources) || !benchmark.sources.length || benchmark.sources.length > 10000) {
    fail("the saved benchmark fingerprint is incomplete.");
  }
  const paths = new Set();
  for (const source of benchmark.sources) {
    if (!isObject(source) || !isText(source.path, 1024) || !/^[a-zA-Z0-9_./-]+\.py$/.test(source.path) ||
        source.path.startsWith("/") || source.path.split("/").some((part) => !part || part === "." || part === "..") ||
        paths.has(source.path) || !isHash(source.sha256)) fail("the benchmark source manifest is invalid.");
    paths.add(source.path);
  }
  if (!isText(value.adapter.path, 1024) || !isHash(value.adapter.sha256)) fail("the adapter fingerprint is invalid.");
  const environment = value.environment;
  if (!["python", "python_implementation", "system", "machine"].every((key) => isText(environment[key], 256)) ||
      !isObject(environment.dependencies) ||
      !["numpy", "scipy", "scikit-image", "Pillow"].every((key) => isText(environment.dependencies[key], 256))) {
    fail("the saved software versions are incomplete.");
  }
}

function validateMeasurements(metadata) {
  const result = metadata.measurements;
  const image = metadata.image;
  if (!isObject(result) || !isText(result.image_id) || result.unit !== "px" ||
      result.width !== image.width || result.height !== image.height ||
      !isObject(result.summary) || !Array.isArray(result.per_strand) || result.per_strand.length > 125000) {
    fail("the saved measurements do not match the image.");
  }
  const ids = new Set();
  let total = 0;
  let low = 0;
  for (const strand of result.per_strand) {
    if (!isObject(strand) || !isCount(strand.strand_id) || strand.strand_id < 1 || ids.has(strand.strand_id) ||
        !isCount(strand.n_measurements, 25_000_000) || strand.n_measurements < 1 ||
        !Array.isArray(strand.measurements_px) || strand.measurements_px.length !== strand.n_measurements ||
        !strand.measurements_px.every(isFinitePositive) ||
        !Array.isArray(strand.segments) || strand.segments.length !== strand.n_measurements ||
        !strand.segments.every((segment) => Array.isArray(segment) && segment.length === 2 &&
          segment.every((point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)))) {
      fail("strand IDs, measurements, or transect coordinates are inconsistent.");
    }
    if (!["mean_px", "median_px", "min_px", "max_px"].every((key) => isFinitePositive(strand[key])) ||
        !Number.isFinite(strand.std_px) || strand.std_px < 0 ||
        strand.min_px > strand.max_px || strand.mean_px < strand.min_px - 1e-8 ||
        strand.mean_px > strand.max_px + 1e-8 || strand.median_px < strand.min_px - 1e-8 ||
        strand.median_px > strand.max_px + 1e-8 ||
        !Number.isFinite(strand.centroid_x_px) || strand.centroid_x_px < 0 || strand.centroid_x_px >= image.width ||
        !Number.isFinite(strand.centroid_y_px) || strand.centroid_y_px < 0 || strand.centroid_y_px >= image.height ||
        !isCount(strand.strand_area_px, image.width * image.height) || strand.strand_area_px < 1 ||
        !isCount(strand.skeleton_interior_px, strand.strand_area_px) ||
        !Number.isFinite(strand.solidity) || strand.solidity < 0 || strand.solidity > 1 + 1e-12 ||
        typeof strand.low_transect_count !== "boolean" ||
        strand.low_transect_count !== (strand.n_measurements < metadata.provenance.settings.low_transect_count_threshold)) {
      fail("a strand has invalid statistics or review flags.");
    }
    ids.add(strand.strand_id);
    total += strand.n_measurements;
    if (strand.low_transect_count) low += 1;
  }
  const summary = result.summary;
  if (summary.n_strands !== result.per_strand.length || summary.n_measurements_total !== total ||
      summary.n_low_transect !== low || !Number.isFinite(summary.runtime_s) || summary.runtime_s < 0) {
    fail("the summary counts do not match the saved strands.");
  }
  for (const name of ["image_mean_px", "image_std_px", "image_cv_pct", "pooled_mean_px", "pooled_std_px"]) {
    if (total ? (!Number.isFinite(summary[name]) || summary[name] < 0) : summary[name] !== null) {
      fail("the measurement summary has invalid statistics.");
    }
  }
  if (metadata.selected_strand_id !== null && !ids.has(metadata.selected_strand_id)) fail("the selected strand is missing.");
}

function validateMetadata(value) {
  if (!isObject(value) || value.schema_version !== 1) fail("the analysis metadata version is unsupported.");
  if (![value.analyzed_at, value.exported_at].every((date) =>
    isText(date, 128) && Number.isFinite(Date.parse(date)))) fail("the saved dates are invalid.");
  const image = value.image;
  if (!isObject(image) || !isText(image.name) ||
      !isCount(image.width, 12000) || !image.width || !isCount(image.height, 12000) || !image.height ||
      image.width * image.height > 25_000_000 ||
      (image.file_size_bytes != null && !isCount(image.file_size_bytes)) ||
      (image.last_modified_ms != null && (!Number.isSafeInteger(image.last_modified_ms) ||
        Math.abs(image.last_modified_ms) > 8.64e15)) ||
      (image.media_type != null && !isText(image.media_type, 256))) fail("the saved image details are invalid.");
  if (value.label_filter !== null && !isText(value.label_filter)) fail("the saved class filter is invalid.");
  if (value.calibration !== null) {
    let normalized = null;
    try { normalized = normalizeCalibration(value.calibration, image); } catch { /* Reject malformed reference points. */ }
    if (!normalized || !sameValue(normalized, value.calibration)) fail("the saved calibration is invalid or inconsistent.");
  }
  if (!sameValue(measurementUnits(value.calibration), value.units)) fail("the saved units disagree with the calibration.");
  validateProvenance(value.provenance);
  validateMeasurements(value);
  const names = ["mask.png", "results.csv", "report.png"];
  if (!isObject(value.files) || Object.keys(value.files).length !== names.length ||
      !names.every((name) => isObject(value.files[name]) && isHash(value.files[name].sha256) &&
        isCount(value.files[name].bytes, FILE_LIMITS[name]))) fail("file verification details are incomplete.");
}

function validateNesting(value, depth = 0) {
  if (typeof value === "number" && !Number.isFinite(value)) fail("the saved metadata contains a non-finite number.");
  if (value === null || typeof value !== "object") return;
  if (depth > 64) fail("the saved metadata is nested too deeply.");
  if (Array.isArray(value)) {
    for (const item of value) validateNesting(item, depth + 1);
  } else {
    for (const key of Object.keys(value)) validateNesting(value[key], depth + 1);
  }
}

async function sha256(bytes) {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Read an original exported bundle without running analytics or changing any document state. */
export async function readAnalysisBundle(file) {
  if (!(file instanceof Blob) || file.size < 22) fail("choose an exported analysis ZIP file.");
  if (file.size > MAX_ARCHIVE_BYTES) fail("the ZIP exceeds the 256 MiB supported size limit.");
  if (!globalThis.crypto?.subtle) fail("file verification is unavailable in this browser.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const contents = readStoredFiles(bytes);
  let metadata;
  try {
    metadata = JSON.parse(decode(contents["analysis.json"], "analysis.json"));
  } catch (error) {
    if (error.message.startsWith("Invalid analysis bundle:")) throw error;
    fail("analysis.json is not valid JSON.");
  }
  validateNesting(metadata);
  validateMetadata(metadata);
  validatePng(contents["mask.png"], "mask.png", metadata.image);
  validatePng(contents["report.png"], "report.png");
  await Promise.all(["mask.png", "results.csv", "report.png"].map(async (name) => {
    const record = metadata.files[name];
    if (record.bytes !== contents[name].byteLength || record.sha256 !== await sha256(contents[name])) {
      fail(`${name} does not match its saved fingerprint.`);
    }
  }));
  const manifest = metadata.provenance.benchmark.sources.map(({ path, sha256: hash }) => ({ path, sha256: hash }));
  if (await sha256(encoder.encode(JSON.stringify(manifest))) !== metadata.provenance.benchmark.sha256) {
    fail("the benchmark source manifest does not match its fingerprint.");
  }
  if (!equalBytes(encoder.encode(resultsCsv(metadata.measurements, metadata.calibration)), contents["results.csv"])) {
    fail("results.csv disagrees with the saved measurements or calibration.");
  }
  return {
    metadata,
    files: Object.fromEntries(Object.entries(contents).map(([name, data]) =>
      [name, new Blob([data], { type: FILE_TYPES[name] })])),
  };
}
