const PNG_PREFIX = "data:image/png;base64,";
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function originalPng(source) {
  if (typeof source !== "string" || !source.startsWith(PNG_PREFIX)) {
    throw new Error("The benchmark did not return a PNG figure.");
  }
  const encoded = source.slice(PNG_PREFIX.length);
  if (!encoded || encoded.length > 128 * 1024 * 1024 || encoded.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error("The benchmark returned an invalid PNG figure.");
  }
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  if (bytes.length < 33 || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    throw new Error("The benchmark returned an invalid PNG figure.");
  }
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = header.getUint32(16);
  const height = header.getUint32(20);
  if (header.getUint32(8) !== 13 || header.getUint32(12) !== 0x49484452 ||
      width === 0 || height === 0 || width > 20_000 || height > 20_000 ||
      width * height > 40_000_000) {
    throw new Error("The benchmark returned an invalid PNG figure size.");
  }
  return new Blob([bytes], { type: "image/png" });
}

/** Display and export the Python renderer's original PNG without redrawing it. */
export function createBenchmarkFigure({ root, onChange = () => {}, fetchImpl = (...args) => fetch(...args) }) {
  const documentRoot = root.ownerDocument;
  const host = root.querySelector("#analyticsBenchmarkFigureHost");
  const figure = documentRoot.createElement("img");
  figure.id = "analyticsBenchmarkFigure";
  figure.alt = "Original benchmark figure: raw image, segmentation mask, and measured perpendicular transects.";
  figure.hidden = true;
  const status = documentRoot.createElement("p");
  status.id = "analyticsBenchmarkFigureStatus";
  status.className = "analytics-help";
  status.setAttribute("role", "status");
  status.textContent = "Run an analysis to generate the original benchmark figure.";
  const retry = documentRoot.createElement("button");
  retry.id = "analyticsRetryFigure";
  retry.type = "button";
  retry.textContent = "Retry figure";
  retry.hidden = true;
  host?.append(figure, status, retry);

  let destroyed = false;
  let generation = 0;
  let controller = null;
  let request = null;
  let task = null;
  let ready = null;
  let state = "idle";

  function notify(nextState, message) {
    state = nextState;
    status.textContent = message;
    retry.hidden = nextState !== "error";
    host?.setAttribute("aria-busy", String(nextState === "loading"));
    onChange();
  }

  function cancel() {
    generation += 1;
    controller?.abort();
    controller = null;
    task = null;
    ready = null;
    figure.hidden = true;
    figure.removeAttribute("src");
  }

  async function decode(source) {
    const image = documentRoot.createElement("img");
    if (typeof image.decode === "function") {
      image.src = source;
      await image.decode();
      return;
    }
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("The benchmark PNG figure could not be decoded."));
      image.src = source;
    });
  }

  function update({ result, snapshot, calibration = null, resolutionUmPerPixel = null } = {}) {
    if (destroyed) return Promise.resolve();
    const calibrationKey = JSON.stringify(calibration);
    if (request?.result === result && request?.snapshot === snapshot &&
        request?.calibrationKey === calibrationKey && request?.resolutionUmPerPixel === resolutionUmPerPixel) {
      return task || Promise.resolve();
    }
    cancel();
    request = { result, snapshot, calibration: JSON.parse(calibrationKey), calibrationKey, resolutionUmPerPixel };
    if (!result || !snapshot) {
      notify("idle", "Run an analysis to generate the original benchmark figure.");
      return Promise.resolve();
    }
    if (!result.per_strand?.length) {
      notify("empty", "No measurable strands were found. The benchmark renderer requires at least one measured strand.");
      return Promise.resolve();
    }
    if (!Number.isFinite(resolutionUmPerPixel) || resolutionUmPerPixel <= 0) {
      notify("requires-calibration", "Set a known measurement calibration to generate the benchmark figure in micrometers.");
      return Promise.resolve();
    }
    if (!snapshot.rawImagePng || !snapshot.inputMaskPng) {
      notify("error", "The original image and analyzed mask are unavailable. Run analytics again to generate the benchmark figure.");
      return Promise.resolve();
    }
    const currentGeneration = generation;
    const currentRequest = request;
    controller = new AbortController();
    const signal = controller.signal;
    const current = () => !destroyed && generation === currentGeneration && !signal.aborted;
    const { schema_version, unit, image_id, width, height, summary, per_strand } = result;
    const payload = JSON.stringify({
      image_id, width, height, mask_png: snapshot.inputMaskPng, raw_png: snapshot.rawImagePng,
      result: { schema_version, unit, image_id, width, height, summary, per_strand },
      resolution_um_per_px: resolutionUmPerPixel,
    });
    notify("loading", "Generating the original benchmark figure…");
    task = (async () => {
      try {
        const response = await fetchImpl("/api/analytics/figure", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: payload, signal,
        });
        if (!current()) return;
        if (response.status === 404) {
          throw new Error("The figure service is unavailable. Restart the segmentation app server, then click Retry figure. Your measurements are still available.");
        }
        let output;
        try {
          output = await response.json();
        } catch {
          const statusCode = Number.isInteger(response.status) ? ` (HTTP ${response.status})` : "";
          throw new Error(response.ok
            ? "The server returned an unreadable benchmark figure response. Click Retry figure to try again."
            : `The benchmark figure could not be generated${statusCode}. Click Retry figure to try again.`);
        }
        if (!current()) return;
        if (!response.ok) throw new Error(output?.error?.message || "The benchmark figure could not be generated.");
        if (output?.schema_version !== 1 || output.resolution_um_per_px !== resolutionUmPerPixel ||
            typeof output.renderer !== "string" || typeof output.aggregation !== "string" ||
            !output.rendering_provenance || typeof output.rendering_provenance !== "object") {
          throw new Error("The benchmark returned incomplete figure details.");
        }
        const blob = originalPng(output.figure_png);
        await decode(output.figure_png);
        if (!current()) return;
        ready = {
          blob, dataUrl: output.figure_png, renderingProvenance: output.rendering_provenance,
          calibrationKey, calibration: currentRequest.calibration, resolutionUmPerPixel,
          result, renderer: output.renderer, aggregation: output.aggregation, labelMode: output.label_mode,
        };
        figure.src = output.figure_png;
        figure.hidden = false;
        notify("ready", currentRequest.calibration?.source === "benchmark"
          ? `Original benchmark figure using the benchmark default ${resolutionUmPerPixel} µm/pixel. This is a nominal scale, not a calibration of your image.`
          : "Original benchmark figure. Downloads preserve this PNG exactly.");
      } catch (error) {
        if (!current()) return;
        ready = null;
        figure.hidden = true;
        figure.removeAttribute("src");
        notify("error", error?.message || "The benchmark figure could not be generated.");
      } finally {
        if (current()) controller = null;
      }
    })();
    return task;
  }

  function retryFigure() {
    if (destroyed || !request || state !== "error") return;
    const previous = request;
    request = null;
    void update(previous);
  }

  function clear() {
    if (destroyed) return;
    cancel();
    request = null;
    notify("idle", "Run an analysis to generate the original benchmark figure.");
  }

  retry.addEventListener("click", retryFigure);
  return {
    update,
    clear,
    getSnapshot: () => ready,
    get pending() { return state === "loading"; },
    get state() { return state; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancel();
      request = null;
      state = "idle";
      retry.removeEventListener("click", retryFigure);
    },
  };
}
