import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";

const MAX_REQUEST_BYTES = 20 * 1024 * 1024;
const MAX_RENDER_REQUEST_BYTES = 160 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_PNG_BYTES = 12 * 1024 * 1024;
const MAX_PIXELS = 25_000_000;
const MAX_DIMENSION = 12_000;
const PNG_PREFIX = "data:image/png;base64,";

export class AnalyticsError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Use an executable path, never shell activation or interpolation. */
export async function findAnalyticsPython(root, environment = process.env) {
  if (environment.ANALYTICS_PYTHON) return environment.ANALYTICS_PYTHON;
  const executable = process.platform === "win32"
    ? ["Scripts", "python.exe"] : ["bin", "python"];
  const candidates = [
    path.join(root, "diw_width_extraction_benchmark", ".venv", ...executable),
    path.join(root, ".venv", ...executable),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch { /* Try the next project environment. */ }
  }
  throw new AnalyticsError(503, "PYTHON_NOT_FOUND",
    "Create the benchmark Python environment, or set ANALYTICS_PYTHON to its Python executable.");
}

export function validateRequest(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AnalyticsError(400, "INVALID_REQUEST", "The analysis request must be a JSON object.");
  }
  const { image_id: imageId, width, height, mask_png: maskPng } = payload;
  if (typeof imageId !== "string" || !imageId.length || imageId.length > 1024
      || !Number.isInteger(width) || !Number.isInteger(height)
      || width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION
      || width * height > MAX_PIXELS) {
    throw new AnalyticsError(400, "INVALID_REQUEST",
      "Supply an image ID and valid mask dimensions (at most 25 million pixels).");
  }
  if (typeof maskPng !== "string" || !maskPng.startsWith(PNG_PREFIX)) {
    throw new AnalyticsError(400, "INVALID_MASK", "mask_png must be a base64 PNG data URL.");
  }
  const encoded = maskPng.slice(PNG_PREFIX.length);
  if (!encoded.length || encoded.length % 4 !== 0
      || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new AnalyticsError(400, "INVALID_MASK", "The mask contains invalid base64 data.");
  }
  const png = Buffer.from(encoded, "base64");
  if (png.length > MAX_PNG_BYTES) {
    throw new AnalyticsError(413, "MASK_TOO_LARGE", "The PNG mask must be at most 12 MiB.");
  }
  if (png.length < 33 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      || png.toString("ascii", 12, 16) !== "IHDR"
      || png.readUInt32BE(16) !== width || png.readUInt32BE(20) !== height) {
    throw new AnalyticsError(400, "INVALID_MASK", "PNG dimensions must match the analysis request.");
  }
  return { image_id: imageId, width, height, mask_png: maskPng };
}

export function validateFigureRequest(payload) {
  const base = validateRequest(payload);
  const source = payload.raw_png;
  if (typeof source !== "string" || !source.startsWith(PNG_PREFIX)) {
    throw new AnalyticsError(400, "INVALID_IMAGE", "The original image must be a PNG data URL.");
  }
  const encoded = source.slice(PNG_PREFIX.length);
  if (!encoded.length || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new AnalyticsError(400, "INVALID_IMAGE", "The original image contains invalid base64 data.");
  }
  const png = Buffer.from(encoded, "base64");
  if (png.length > 100 * 1024 * 1024) {
    throw new AnalyticsError(413, "IMAGE_TOO_LARGE", "The original PNG must be at most 100 MiB.");
  }
  if (png.length < 33 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      || png.toString("ascii", 12, 16) !== "IHDR"
      || png.readUInt32BE(16) !== base.width || png.readUInt32BE(20) !== base.height) {
    throw new AnalyticsError(400, "INVALID_IMAGE", "The original image dimensions must match the analysis.");
  }
  const { result, resolution_um_per_px: resolution } = payload;
  if (!Number.isFinite(resolution) || resolution <= 0 || !result || result.schema_version !== 1
      || result.unit !== "px" || result.image_id !== base.image_id
      || result.width !== base.width || result.height !== base.height
      || !Array.isArray(result.per_strand) || result.per_strand.length > 125000
      || !result.summary || typeof result.summary !== "object") {
    throw new AnalyticsError(400, "INVALID_RESULT", "Matching measurements and a valid scale are required for the benchmark figure.");
  }
  return { ...base, operation: "render", raw_png: source, result, resolution_um_per_px: resolution };
}

async function readRequest(request, renderOnly = false) {
  const limit = renderOnly ? MAX_RENDER_REQUEST_BYTES : MAX_REQUEST_BYTES;
  if ((request.headers["content-type"] || "").split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new AnalyticsError(415, "CONTENT_TYPE", "Use application/json for analysis requests.");
  }
  if (Number(request.headers["content-length"]) > limit) {
    request.resume();
    throw new AnalyticsError(413, "REQUEST_TOO_LARGE", "The analysis request is too large.");
  }
  const body = await new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    const timer = setTimeout(() => fail(new AnalyticsError(408, "REQUEST_TIMEOUT",
      "The mask upload took too long. Try again.")), 30_000);
    function clean() {
      clearTimeout(timer);
      request.removeListener("data", data);
      request.removeListener("end", end);
      request.removeListener("error", fail);
      request.removeListener("aborted", aborted);
    }
    function fail(error) {
      clean();
      request.resume();
      reject(error);
    }
    function data(chunk) {
      bytes += chunk.length;
      if (bytes > limit) {
        fail(new AnalyticsError(413, "REQUEST_TOO_LARGE", "The analysis request is too large."));
      } else chunks.push(chunk);
    }
    function end() {
      clean();
      resolve(Buffer.concat(chunks).toString("utf8"));
    }
    function aborted() {
      fail(new AnalyticsError(499, "CANCELLED", "Analysis was cancelled."));
    }
    request.on("data", data);
    request.once("end", end);
    request.once("error", fail);
    request.once("aborted", aborted);
  });
  try {
    return (renderOnly ? validateFigureRequest : validateRequest)(JSON.parse(body));
  } catch (error) {
    if (error instanceof AnalyticsError) throw error;
    throw new AnalyticsError(400, "INVALID_JSON", "The analysis request contains invalid JSON.");
  }
}

function assertLocalOrigin(request) {
  const port = request.socket.localPort;
  const allowedHosts = new Set(["127.0.0.1:" + port, "localhost:" + port, "[::1]:" + port]);
  const host = request.headers.host;
  if (!allowedHosts.has(host)
      || (request.headers.origin && request.headers.origin !== "http://" + host)
      || request.headers["sec-fetch-site"] === "cross-site") {
    throw new AnalyticsError(403, "ORIGIN_NOT_ALLOWED", "Analysis requests must come from this local app.");
  }
}

/** Run one child per job so cancellation releases Python memory. */
export function runAdapter({ root, pythonPath, payload, signal, timeoutMs = 180_000, spawnProcess = spawn }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AnalyticsError(499, "CANCELLED", "Analysis was cancelled."));
      return;
    }
    let child;
    try {
      child = spawnProcess(pythonPath, ["-X", "utf8", path.join(root, "scripts", "analytics_adapter.py")], {
        cwd: root, windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      reject(new AnalyticsError(503, "PYTHON_NOT_FOUND", "The configured Analytics Python executable could not be started."));
      return;
    }
    let finished = false;
    let outputBytes = 0;
    let diagnostics = "";
    const output = [];
    function finish(error, value) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      if (error) reject(error);
      else resolve(value);
    }
    function stop(error) {
      child.kill();
      finish(error);
    }
    function cancel() {
      stop(new AnalyticsError(499, "CANCELLED", "Analysis was cancelled."));
    }
    const timer = setTimeout(() => stop(new AnalyticsError(504, "ANALYSIS_TIMEOUT",
      "Analysis took too long. Try a smaller image or fewer selected strands.")), timeoutMs);
    signal?.addEventListener("abort", cancel, { once: true });
    child.on("error", () => finish(new AnalyticsError(503, "PYTHON_NOT_FOUND",
      "The configured Analytics Python executable could not be started.")));
    child.stdout.on("data", (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        stop(new AnalyticsError(502, "RESULT_TOO_LARGE", "The analysis result is too large. Try fewer strands."));
      } else output.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      if (diagnostics.length < 8192) diagnostics += chunk.toString().slice(0, 8192 - diagnostics.length);
    });
    child.stdin.on("error", () => { /* The close/error handler reports failed processes. */ });
    child.on("close", (code) => {
      if (finished) return;
      let result;
      try {
        result = JSON.parse(Buffer.concat(output).toString("utf8"));
      } catch {
        if (diagnostics) console.error("Analytics Python:", diagnostics.trim());
        finish(new AnalyticsError(502, "INVALID_RESULT", "Python did not return valid analysis results."));
        return;
      }
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        finish(new AnalyticsError(502, "INVALID_RESULT", "Python returned an incomplete analysis result."));
      } else if (result.error) {
        const status = result.error.code === "INVALID_MASK" ? 400
          : result.error.code === "PYTHON_DEPENDENCIES" ? 503 : 500;
        if (diagnostics) console.error("Analytics Python:", diagnostics.trim());
        finish(new AnalyticsError(status, result.error.code, result.error.message));
      } else if (code !== 0 || result.schema_version !== 1 || (payload.operation === "render"
        ? (result.resolution_um_per_px !== payload.resolution_um_per_px
          || (result.figure_png === null ? result.reason !== "no_measurements"
            : typeof result.figure_png !== "string" || !result.figure_png.startsWith(PNG_PREFIX)))
        : result.unit !== "px" || !Array.isArray(result.per_strand) || !result.summary)) {
        finish(new AnalyticsError(502, "INVALID_RESULT", "Python returned an incomplete analysis result."));
      } else finish(null, result);
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

export function sendAnalyticsError(response, error) {
  const status = error instanceof AnalyticsError ? error.status : 500;
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    ...(status === 429 ? { "Retry-After": "3" } : {}),
  });
  response.end(JSON.stringify({ error: {
    code: error instanceof AnalyticsError ? error.code : "ANALYSIS_FAILED",
    message: error instanceof AnalyticsError ? error.message : "The analysis request could not be completed.",
  } }));
}

export function createAnalyticsHandler({ root, pythonPath, timeoutMs, runner = runAdapter, maxConcurrent = 1 } = {}) {
  let activeJobs = 0;
  return async function handleAnalytics(request, response) {
    const controller = new AbortController();
    const disconnect = () => {
      if (!response.writableEnded) controller.abort();
    };
    response.on("close", disconnect);
    let acquired = false;
    try {
      assertLocalOrigin(request);
      if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        throw new AnalyticsError(405, "METHOD_NOT_ALLOWED", "Use POST to analyze a mask.");
      }
      if (activeJobs >= maxConcurrent) {
        request.resume();
        throw new AnalyticsError(429, "ANALYTICS_BUSY", "Another image is being analyzed. Try again when it finishes.");
      }
      activeJobs += 1;
      acquired = true;
      const renderOnly = new URL(request.url, "http://localhost").pathname === "/api/analytics/figure";
      const payload = await readRequest(request, renderOnly);
      const executable = pythonPath || await findAnalyticsPython(root);
      const result = await runner({ root, pythonPath: executable, payload, signal: controller.signal, timeoutMs });
      if (controller.signal.aborted || response.destroyed) return;
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify(result));
    } catch (error) {
      if (!response.destroyed && !response.writableEnded) sendAnalyticsError(response, error);
    } finally {
      if (acquired) activeJobs -= 1;
      response.removeListener("close", disconnect);
    }
  };
}
