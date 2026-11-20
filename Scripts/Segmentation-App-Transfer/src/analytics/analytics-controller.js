import {
  displayNumber, measurementKey, measurementUnits, normalizeCalibration,
  referenceCalibration, resultColumns, resultRows, resultsCsv, scaleWidth,
} from "./analytics-data.js";
import { drawImageCanvas, fitCanvas } from "./analytics-renderer.js";
import { createAnalysisBundle } from "./analysis-bundle.js";
import { createSavedAnalysisViewer } from "./saved-analysis-viewer.js";
import { createBenchmarkFigure } from "./benchmark-figure.js";
import { prepareSource, readSource } from "../image/prepare-source.js";

const TEMPLATE = `
  <div class="analytics-heading"><div>
    <h1>Strand width analytics</h1><p id="analyticsImageName">Load an image and create or import annotations to begin.</p></div>
    <div class="analytics-heading-actions"><span class="analytics-unit-badge" id="analyticsUnitBadge">Benchmark default</span>
      <div id="analyticsSavedAnalysis"></div></div></div>
  <div class="analytics-controls analytics-card">
    <div class="analytics-control"><label for="analyticsLabel">Measure annotations</label><select id="analyticsLabel"><option value="">All labels</option></select></div>
    <div class="analytics-control"><label for="analyticsCalibrationMode">Measurement units</label><select id="analyticsCalibrationMode">
      <option value="pixels">Benchmark default</option><option value="manual">Enter µm per pixel</option><option value="reference">Calibrate from a known distance</option></select></div>
    <button type="button" id="analyticsRun" class="analytics-primary">Analyze widths</button>
    <button type="button" id="analyticsCancel" hidden>Cancel</button>
  </div>
  <div id="analyticsManual" class="analytics-card analytics-calibration" hidden>
    <div><label for="analyticsScale">Micrometers per original image pixel</label>
      <div class="analytics-inline"><input id="analyticsScale" type="number" min="0" step="any" placeholder="Enter a known calibration"><button type="button" id="analyticsApplyScale">Apply calibration</button></div>
      <p class="analytics-help">Use the calibration for the image's acquisition settings and pixel dimensions. Display zoom does not change this value.</p></div>
  </div>
  <div id="analyticsReference" class="analytics-card analytics-calibration" hidden>
    <div class="analytics-reference-intro"><div><h2>Calibrate a known distance</h2><p class="analytics-help">Choose two points on a distance you know, then enter its length in micrometers.</p></div>
      <div class="analytics-inline"><button type="button" id="analyticsUseCurrent">Use current image</button><label class="analytics-file-button">Choose reference image<input id="analyticsReferenceFile" type="file" accept="image/*,.tif,.tiff"></label></div></div>
    <p id="analyticsReferenceName" class="analytics-help">No reference selected.</p>
    <div class="analytics-reference-layout"><canvas id="analyticsReferenceCanvas" aria-label="Calibration reference. Click two endpoints or enter their coordinates below." hidden></canvas>
      <div class="analytics-reference-fields">
        <div class="analytics-point-inputs"><label>X1<input id="analyticsX1" type="number" step="any" min="0"></label><label>Y1<input id="analyticsY1" type="number" step="any" min="0"></label><label>X2<input id="analyticsX2" type="number" step="any" min="0"></label><label>Y2<input id="analyticsY2" type="number" step="any" min="0"></label></div>
        <label for="analyticsKnownDistance">Known length (µm)</label><input id="analyticsKnownDistance" type="number" min="0" step="any" placeholder="For example, 100">
        <p id="analyticsReferenceDistance" class="analytics-help">Select two endpoints.</p>
        <label id="analyticsSameAcquisitionLabel" class="analytics-check" hidden><input id="analyticsSameAcquisition" type="checkbox">This reference uses the same acquisition settings and pixel scaling as the analyzed image.</label>
        <div class="analytics-inline"><button type="button" id="analyticsApplyReference">Apply calibration</button><button type="button" id="analyticsResetReference">Reset points</button></div>
      </div></div>
  </div>
  <p id="analyticsCalibrationMessage" class="analytics-help" role="status"></p>
  <div id="analyticsStatus" class="analytics-status" role="status" aria-live="polite">Ready when an image and annotations are loaded.</div>
  <div class="analytics-summary" id="analyticsSummary">
    <div class="analytics-card"><span>Mean of strand medians</span><strong id="analyticsMean">—</strong></div>
    <div class="analytics-card"><span>Measured strands</span><strong id="analyticsStrands">—</strong></div>
    <div class="analytics-card"><span>Width measurements</span><strong id="analyticsMeasurements">—</strong></div>
    <div class="analytics-card"><span>Between-strand CV</span><strong id="analyticsCv">—</strong></div>
    <div class="analytics-card"><span>Low transect count</span><strong id="analyticsLowCount">—</strong></div>
  </div>
  <section class="analytics-card analytics-figure-section"><div class="analytics-section-heading"><div><h2>Diameter figures</h2><p id="analyticsFigureNote" class="analytics-help">The selected annotations form the binary mask used for measurement.</p></div>
    <div class="analytics-inline"><button type="button" id="analyticsShowAll" hidden>Clear row selection</button><button type="button" id="analyticsExportPng" disabled>Export figure PNG</button></div></div>
    <div id="analyticsPreviewFigures" class="analytics-figures"><figure><figcaption>Original image preview</figcaption><canvas id="analyticsOriginalCanvas" aria-label="Original image" hidden></canvas><p class="analytics-image-placeholder">No image loaded</p></figure>
      <figure><figcaption>Segmentation mask preview</figcaption><canvas id="analyticsMaskCanvas" aria-label="Selected binary segmentation mask" hidden></canvas><p class="analytics-image-placeholder">No mask available</p></figure>
      <figure class="analytics-transect-preview"><figcaption>Perpendicular transects</figcaption><p id="analyticsTransectPlaceholder" class="analytics-image-placeholder">Run an analysis to see measurements.</p></figure></div>
    <div id="analyticsBenchmarkFigureHost"></div>
    <p class="analytics-help">The benchmark figure labels show median width and solidity. Row selection leaves the original figure unchanged. Touching or crossing strands can form a single connected component.</p>
  </section>
  <section class="analytics-card analytics-results-section"><div class="analytics-section-heading"><div><h2>Per-strand results</h2><p id="analyticsResultsNote" class="analytics-help">CSV columns are shown in their export order. Coordinates and area remain in pixels.</p></div><div class="analytics-inline"><button type="button" id="analyticsExportCsv" disabled>Export CSV</button><button type="button" id="analyticsExportBundle" title="Download the exact analyzed mask, results, settings, and report in one ZIP file." disabled>Export analysis bundle</button></div></div>
    <p id="analyticsBundleStatus" class="analytics-status" role="status" hidden></p>
    <div class="analytics-table-wrap" tabindex="0" aria-label="Per-strand results. Scroll horizontally to see all columns."><table id="analyticsTable"><thead></thead><tbody></tbody></table></div>
    <p id="analyticsTableEmpty" class="analytics-table-empty">Run an analysis to populate the results.</p>
    <p id="analyticsDetails" class="analytics-help"></p>
  </section>`;

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The image could not be decoded."));
    image.src = source;
  });
}

function download(documentRoot, blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = documentRoot.createElement("a");
  link.href = url; link.download = filename;
  documentRoot.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeFilename(name) {
  return String(name || "image").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 160);
}

function fileStem(name) {
  return safeFilename(String(name || "image").replace(/\.[^.]+$/, ""));
}

/** Connect the current annotation mask to local Python measurements and presentation. */
export function createAnalyticsController({ root, imageState, annotationState, maskRenderer, imageProcessing,
  getCurrentReferenceImage = () => imageState.image, onCalibrationChange }) {
  const documentRoot = root.ownerDocument;
  const windowRoot = documentRoot.defaultView;
  root.classList.add("analytics-page");
  root.innerHTML = TEMPLATE;
  const savedAnalysisViewer = createSavedAnalysisViewer({ root });
  const element = (id) => root.querySelector(`#analytics${id}`);
  const originalCanvas = element("OriginalCanvas");
  const maskCanvas = element("MaskCanvas");
  const referenceCanvas = element("ReferenceCanvas");
  const coordinateInputs = ["X1", "Y1", "X2", "Y2"].map(element);
  const listeners = [];
  let active = false;
  let destroyed = false;
  let currentKey = "";
  let currentImage = null;
  let currentRevision = null;
  let resizeFrame = null;
  let calibrationKey = "";
  let requestNumber = 0;
  let pendingRequest = null;
  let result = null;
  let analyzedMask = null;
  let processedMask = null;
  let analysisSnapshot = null;
  let bundleRequest = 0;
  let pendingBundle = false;
  let selectedStrand = null;
  let reference = null;
  let referencePoints = [];
  let referenceRequest = 0;
  let statusText = "Ready when an image and annotations are loaded.";
  let statusKind = "info";
  const benchmarkFigure = createBenchmarkFigure({ root, onChange: () => {
    if (!destroyed) renderHeader();
  } });

  function on(target, event, handler) {
    target.addEventListener(event, handler);
    listeners.push(() => target.removeEventListener(event, handler));
  }

  function calibration() {
    return normalizeCalibration(imageState.calibration, imageState.imageSize);
  }

  function resultCalibration() {
    const chosen = calibration();
    if (chosen) return chosen;
    const scale = result?.provenance?.settings?.benchmark_resolution_um_per_px;
    return normalizeCalibration({
      source: "benchmark", umPerPixel: scale,
      imageWidth: result?.width, imageHeight: result?.height,
    }, imageState.imageSize);
  }

  function readyFigure() {
    const figure = benchmarkFigure.getSnapshot();
    return figure?.result === result && figure.calibrationKey === JSON.stringify(resultCalibration())
      ? figure : null;
  }

  function annotations() {
    const label = element("Label").value;
    return annotationState.annotations.filter((annotation) => !label || annotation.label === label);
  }

  function setStatus(text, kind = "info") {
    statusText = text; statusKind = kind;
    element("Status").textContent = text;
    element("Status").dataset.kind = kind;
  }

  function setCanvasVisible(canvas, visible) {
    canvas.hidden = !visible;
    const placeholder = canvas.parentElement.querySelector(".analytics-image-placeholder");
    if (placeholder) placeholder.hidden = visible;
  }

  function renderHeader() {
    const size = imageState.imageSize;
    element("ImageName").textContent = imageState.image && size
      ? `${imageState.imageName || "Current image"} · ${size.width} × ${size.height} px`
      : "Load an image and create or import annotations to begin.";
    const currentCalibration = resultCalibration();
    element("UnitBadge").textContent = currentCalibration
      ? `${currentCalibration.source === "benchmark" ? "Benchmark default: " : ""}${displayNumber(currentCalibration.umPerPixel, 8)} µm / px` : "Benchmark default";
    const count = annotations().length;
    const loading = imageState.imageLoadStatus === "loading";
    element("Run").disabled = loading || !imageState.image || !size || count === 0 || Boolean(pendingRequest) || benchmarkFigure.pending;
    element("Run").textContent = pendingRequest ? "Analyzing…" : benchmarkFigure.pending ? "Rendering figure…" : "Analyze widths";
    element("Cancel").hidden = !pendingRequest;
    root.setAttribute("aria-busy", String(Boolean(pendingRequest) || benchmarkFigure.pending));
    element("ExportCsv").disabled = !result || Boolean(pendingRequest);
    element("ExportPng").disabled = loading || !readyFigure() || Boolean(pendingRequest);
    element("ExportBundle").disabled = loading || !readyFigure() || !analysisSnapshot || Boolean(pendingRequest) || pendingBundle;
    element("ExportBundle").textContent = pendingBundle ? "Preparing bundle…" : "Export analysis bundle";
    element("ShowAll").hidden = selectedStrand == null;
    element("UseCurrent").disabled = loading || !imageState.image;
    element("ApplyScale").disabled = loading || !imageState.image;
    element("ApplyReference").disabled = loading || !imageState.image || !reference;
  }

  function renderTable() {
    const currentCalibration = resultCalibration();
    const head = element("Table").querySelector("thead");
    const body = element("Table").querySelector("tbody");
    head.replaceChildren(); body.replaceChildren();
    const headingRow = documentRoot.createElement("tr");
    for (const name of resultColumns(currentCalibration)) {
      const cell = documentRoot.createElement("th"); cell.scope = "col"; cell.textContent = name;
      headingRow.append(cell);
    }
    head.append(headingRow);
    resultRows(result, currentCalibration).forEach((values, index) => {
      const strand = result.per_strand[index];
      const row = documentRoot.createElement("tr");
      row.tabIndex = 0; row.dataset.strandId = String(strand.strand_id);
      row.setAttribute("aria-label", `Strand ${strand.strand_id}. Select this results row.`);
      row.setAttribute("aria-selected", String(selectedStrand === strand.strand_id));
      if (strand.low_transect_count) row.classList.add("analytics-low-count");
      values.forEach((value, column) => {
        const cell = documentRoot.createElement("td");
        cell.textContent = typeof value === "number" && column >= 4 ? displayNumber(value, 8) : value == null ? "—" : String(value);
        cell.title = value == null ? "No value" : String(value);
        row.append(cell);
      });
      body.append(row);
    });
    element("TableEmpty").hidden = Boolean(result?.per_strand.length);
    element("TableEmpty").textContent = result ? "No measurable strands were found in this mask." : "Run an analysis to populate the results.";
    element("ResultsNote").textContent = `CSV columns are shown in their export order. Widths are in ${measurementUnits(currentCalibration).symbol}; coordinates and area remain in pixels.`;
  }

  function renderSummary() {
    const summary = result?.summary;
    const currentCalibration = resultCalibration();
    const unit = measurementUnits(currentCalibration).symbol;
    element("Mean").textContent = summary && Number.isFinite(summary.image_mean_px)
      ? `${displayNumber(scaleWidth(summary.image_mean_px, currentCalibration))} ${unit}` : "—";
    element("Strands").textContent = summary ? displayNumber(summary.n_strands, 0) : "—";
    element("Measurements").textContent = summary ? displayNumber(summary.n_measurements_total, 0) : "—";
    element("Cv").textContent = summary && Number.isFinite(summary.image_cv_pct) ? `${displayNumber(summary.image_cv_pct, 2)}%` : "—";
    element("LowCount").textContent = summary ? displayNumber(summary.n_low_transect, 0) : "—";
    element("Details").textContent = summary
      ? `Between-strand standard deviation: ${displayNumber(scaleWidth(summary.image_std_px, currentCalibration))} ${unit} · Pooled mean: ${displayNumber(scaleWidth(summary.pooled_mean_px, currentCalibration))} ${unit} · Pooled standard deviation: ${displayNumber(scaleWidth(summary.pooled_std_px, currentCalibration))} ${unit} · Measurement time: ${displayNumber(summary.runtime_s, 2)} s. Low transect count flags strands with fewer than 30 measurements.`
      : "";
  }

  function renderFigures() {
    const size = imageState.imageSize;
    const hasImage = Boolean(imageState.image && size);
    element("PreviewFigures").hidden = Boolean(result);
    setCanvasVisible(originalCanvas, hasImage && !result);
    setCanvasVisible(maskCanvas, hasImage && !result);
    if (hasImage && !result) {
      drawImageCanvas(originalCanvas, imageState.image, size, calibration());
      const preview = analyzedMask || maskRenderer.render({ imageSize: size, annotations: annotations() });
      drawImageCanvas(maskCanvas, preview, size);
    }
    if (result && analysisSnapshot) {
      const currentCalibration = resultCalibration();
      benchmarkFigure.update({ result, snapshot: analysisSnapshot, calibration: currentCalibration,
        resolutionUmPerPixel: currentCalibration?.umPerPixel ?? null });
    }
    element("FigureNote").textContent = result
      ? "The unchanged annotation mask and Global PCA measurements are shown by the benchmark's original Python renderer."
      : "The selected annotations form the binary mask used for measurement.";
  }

  function renderResults() {
    renderHeader(); renderSummary(); renderTable();
    if (active) renderFigures();
  }

  function cancel(clearMessage = false) {
    requestNumber += 1;
    pendingRequest?.abort(); pendingRequest = null;
    if (clearMessage) setStatus("Analysis canceled. You can run it again.");
    renderHeader();
  }

  function invalidate(message) {
    cancel(); result = null; analyzedMask = null; processedMask = null; selectedStrand = null;
    benchmarkFigure.clear();
    analysisSnapshot = null; resetBundle();
    setStatus(message);
    renderResults();
  }

  function calibrationVisibility() {
    const mode = element("CalibrationMode").value;
    element("Manual").hidden = mode !== "manual";
    element("Reference").hidden = mode !== "reference";
  }

  function updateCalibration() {
    const value = calibration();
    const key = JSON.stringify(value);
    if (key === calibrationKey) return false;
    resetBundle();
    benchmarkFigure.clear();
    calibrationKey = key;
    element("CalibrationMode").value = value?.source || "pixels";
    element("Scale").value = value ? String(value.umPerPixel) : "";
    calibrationVisibility();
    element("CalibrationMessage").textContent = value
      ? `Using ${value.source} calibration. Widths are converted from the original pixel measurements; no new analysis is needed.`
      : "Using the benchmark's default scale when results are available. This is not an image-specific calibration.";
    return true;
  }

  function saveCalibration(value) {
    onCalibrationChange(value);
    updateCalibration(); renderResults();
  }

  function refresh() {
    if (destroyed) return;
    const labelSelect = element("Label");
    const selectedLabel = labelSelect.value;
    const labels = [...new Set(annotationState.annotations.map((item) => item.label))].sort();
    const currentLabels = [...labelSelect.options].slice(1).map((option) => option.value);
    if (JSON.stringify(labels) !== JSON.stringify(currentLabels)) {
      labelSelect.replaceChildren(new Option("All labels", ""), ...labels.map((label) => new Option(label || "(Unlabeled)", label)));
      labelSelect.value = labels.includes(selectedLabel) ? selectedLabel : "";
    }
    const key = measurementKey(imageState, annotationState.annotations, labelSelect.value);
    const revision = imageState.revision ?? 0;
    const imageChanged = currentImage !== imageState.image || currentRevision !== revision;
    const changed = imageChanged || key !== currentKey;
    if (imageChanged) {
      currentImage = imageState.image;
      currentRevision = revision;
      calibrationKey = "";
      referenceRequest += 1; reference = null; referencePoints = [];
      element("ReferenceFile").value = ""; element("SameAcquisition").checked = false;
      element("KnownDistance").value = "";
      drawReference();
    }
    const calibrationChanged = updateCalibration();
    if (changed) {
      const hadResult = result || pendingRequest;
      currentKey = key;
      invalidate(imageState.imageLoadStatus === "loading" ? "Loading the new image. Analysis will be available when it is ready."
        : hadResult ? "The image or annotations changed. Run analysis again to update the results."
        : !imageState.image ? "Load an image in the Annotation tab to begin."
        : !annotations().length ? "Create or import annotations in the Annotation tab to measure their widths."
        : "Ready to analyze the selected annotations.");
    } else if (calibrationChanged) renderResults();
    else renderHeader();
  }

  async function analyze() {
    refresh();
    if (element("Run").disabled) return;
    const imageSize = { ...imageState.imageSize };
    const capturedKey = currentKey;
    const capturedImage = imageState.image;
    const request = ++requestNumber;
    const controller = new AbortController();
    pendingRequest = controller;
    result = null; processedMask = null; selectedStrand = null; analysisSnapshot = null;
    benchmarkFigure.clear();
    resetBundle();
    setStatus("Measuring widths with the local Python engine. This may take a moment.", "working");
    renderResults();
    try {
      const inputMask = maskRenderer.render({ imageSize, annotations: annotations() });
      if (!inputMask) throw new Error("The segmentation mask could not be created.");
      analyzedMask = inputMask;
      const rawCanvas = documentRoot.createElement("canvas");
      rawCanvas.width = imageSize.width;
      rawCanvas.height = imageSize.height;
      const rawContext = rawCanvas.getContext("2d");
      rawContext.fillStyle = "#000";
      rawContext.fillRect(0, 0, rawCanvas.width, rawCanvas.height);
      rawContext.drawImage(capturedImage, 0, 0, rawCanvas.width, rawCanvas.height);
      const rawImagePng = rawCanvas.toDataURL("image/png");
      rawCanvas.width = rawCanvas.height = 0;
      const snapshot = {
        inputMaskPng: inputMask.toDataURL("image/png"),
        rawImagePng,
        analyzedAt: new Date().toISOString(),
        image: {
          name: imageState.imageName, ...imageSize,
          file_size_bytes: imageState.imageFileSizeBytes ?? null,
          media_type: imageState.imageFileType || null,
          last_modified_ms: imageState.imageLastModified ?? null,
        },
        label: element("Label").value,
      };
      const response = await fetch("/api/analytics/widths", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ mask_png: snapshot.inputMaskPng, image_id: fileStem(imageState.imageName), ...imageSize }),
      });
      let data;
      try { data = await response.json(); } catch { throw new Error("The local server returned an unreadable response. Restart the app with its updated development server."); }
      if (!response.ok) throw new Error(data?.error?.message || `Analysis failed (${response.status}).`);
      if (data.schema_version !== 1 || data.unit !== "px" || !Array.isArray(data.per_strand) || !data.summary || data.width !== imageSize.width || data.height !== imageSize.height) {
        throw new Error("The measurement response did not match this image.");
      }
      const decodedMask = await loadImage(data.processed_mask_png);
      if (destroyed || request !== requestNumber || capturedKey !== currentKey || capturedImage !== imageState.image) return;
      result = data; processedMask = decodedMask; analysisSnapshot = snapshot; pendingRequest = null;
      setStatus(data.per_strand.length
        ? `Analysis complete. ${data.summary.n_strands} strands measured${data.summary.n_low_transect ? `; ${data.summary.n_low_transect} have a low transect count` : ""}.`
        : "No measurable strands were found. Check that the selected mask contains sufficiently large, connected strands.",
      data.per_strand.length ? "success" : "info");
      renderResults();
    } catch (error) {
      if (request !== requestNumber || destroyed) return;
      pendingRequest = null;
      setStatus(error.name === "AbortError" ? "Analysis canceled." : error.message, error.name === "AbortError" ? "info" : "error");
      renderResults();
    }
  }

  function drawReference(syncInputs = true) {
    referenceCanvas.hidden = !reference;
    element("SameAcquisitionLabel").hidden = reference?.source !== "upload";
    element("ReferenceName").textContent = reference ? `${reference.imageName} · ${reference.width} × ${reference.height} px` : "No reference selected.";
    if (syncInputs) coordinateInputs.forEach((input, index) => { input.value = referencePoints[Math.floor(index / 2)]?.[index % 2 ? "y" : "x"] ?? ""; });
    if (reference) {
      fitCanvas(referenceCanvas, reference.width, reference.height, 900);
      const context = referenceCanvas.getContext("2d");
      context.drawImage(reference.image, 0, 0, referenceCanvas.width, referenceCanvas.height);
      const scaleX = referenceCanvas.width / reference.width;
      const scaleY = referenceCanvas.height / reference.height;
      context.strokeStyle = "#00eaff"; context.fillStyle = "#00eaff"; context.lineWidth = 2;
      if (referencePoints.length === 2) {
        context.beginPath(); context.moveTo(referencePoints[0].x * scaleX, referencePoints[0].y * scaleY);
        context.lineTo(referencePoints[1].x * scaleX, referencePoints[1].y * scaleY); context.stroke();
      }
      referencePoints.forEach((point, index) => {
        const x = point.x * scaleX; const y = point.y * scaleY;
        context.beginPath(); context.arc(x, y, 5, 0, Math.PI * 2); context.fill();
        context.font = "bold 16px Segoe UI"; context.fillText(String(index + 1), x + 10, y - 8);
      });
    }
    const distance = referencePoints.length === 2 ? Math.hypot(referencePoints[1].x - referencePoints[0].x, referencePoints[1].y - referencePoints[0].y) : 0;
    element("ReferenceDistance").textContent = distance > 0 ? `Reference distance: ${displayNumber(distance, 4)} original pixels.` : "Select two endpoints.";
    renderHeader();
  }

  function chooseCurrentReference() {
    if (!imageState.image || !imageState.imageSize) return;
    referenceRequest += 1;
    reference = { image: getCurrentReferenceImage(), imageName: imageState.imageName, ...imageState.imageSize, source: "current" };
    referencePoints = []; drawReference();
  }

  on(element("Run"), "click", analyze);
  on(element("Cancel"), "click", () => cancel(true));
  on(element("Label"), "change", refresh);
  on(element("CalibrationMode"), "change", () => {
    calibrationVisibility();
    if (element("CalibrationMode").value === "pixels") saveCalibration(null);
    else element("CalibrationMessage").textContent = "Apply a valid calibration to update the measurements. The current measurement scale remains in effect until then.";
  });
  on(element("ApplyScale"), "click", () => {
    const value = normalizeCalibration({ source: "manual", umPerPixel: Number(element("Scale").value), imageWidth: imageState.imageSize?.width, imageHeight: imageState.imageSize?.height }, imageState.imageSize);
    if (!value) { element("CalibrationMessage").textContent = "Enter a micrometers-per-pixel value greater than zero."; return; }
    saveCalibration(value);
  });
  on(element("UseCurrent"), "click", chooseCurrentReference);
  on(element("ReferenceFile"), "change", async () => {
    const file = element("ReferenceFile").files[0];
    if (!file) return;
    const token = ++referenceRequest;
    let url;
    try {
      let image;
      if (file.type === "image/tiff" || /\.tiff?$/i.test(file.name)) {
        const prepared = await prepareSource(await readSource(file), imageProcessing, { analyze: false });
        image = prepared.image;
      } else {
        url = URL.createObjectURL(file);
        image = await loadImage(url);
      }
      if (destroyed || token !== referenceRequest) return;
      reference = { image, imageName: file.name, width: image.width, height: image.height, source: "upload" };
      referencePoints = []; element("SameAcquisition").checked = false; drawReference();
    } catch (error) {
      if (token === referenceRequest) element("CalibrationMessage").textContent = error.message;
    } finally { if (url) URL.revokeObjectURL(url); }
  });
  on(referenceCanvas, "click", (event) => {
    if (!reference) return;
    const bounds = referenceCanvas.getBoundingClientRect();
    const point = {
      x: Math.max(0, Math.min(reference.width, (event.clientX - bounds.left - referenceCanvas.clientLeft) * reference.width / referenceCanvas.clientWidth)),
      y: Math.max(0, Math.min(reference.height, (event.clientY - bounds.top - referenceCanvas.clientTop) * reference.height / referenceCanvas.clientHeight)),
    };
    if (referencePoints.length === 2) referencePoints = [];
    referencePoints.push(point); drawReference();
  });
  coordinateInputs.forEach((input) => on(input, "change", () => {
    if (!reference) return;
    const values = coordinateInputs.map((field) => field.value.trim() === "" ? NaN : Number(field.value));
    if (values.every(Number.isFinite) && values.every((value, index) => value >= 0 && value <= (index % 2 ? reference.height : reference.width))) {
      referencePoints = [{ x: values[0], y: values[1] }, { x: values[2], y: values[3] }]; drawReference();
    } else {
      referencePoints = [];
      element("ReferenceDistance").textContent = "Enter all four endpoint coordinates within the reference image.";
    }
  }));
  on(element("ResetReference"), "click", () => { referencePoints = []; drawReference(); });
  on(element("ApplyReference"), "click", () => {
    if (!reference) return;
    const value = referenceCalibration({ points: referencePoints, knownDistanceUm: element("KnownDistance").value, imageSize: imageState.imageSize, source: reference.source, imageName: reference.imageName, sameAcquisition: element("SameAcquisition").checked });
    if (!value) {
      element("CalibrationMessage").textContent = reference.source === "upload" && !element("SameAcquisition").checked
        ? "Confirm that the reference uses the same acquisition settings and pixel scaling."
        : "Select two distinct points and enter a known length greater than zero.";
      return;
    }
    saveCalibration(value);
  });
  function selectRow(event) {
    const row = event.target.closest("tr[data-strand-id]");
    if (!row || !result) return;
    selectedStrand = Number(row.dataset.strandId);
    renderResults();
    element("Table").querySelector(`tr[data-strand-id="${selectedStrand}"]`)?.focus({ preventScroll: true });
  }
  on(element("Table"), "click", selectRow);
  on(element("Table"), "keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectRow(event); }
  });
  on(element("ShowAll"), "click", () => { selectedStrand = null; renderResults(); });
  on(element("ExportCsv"), "click", () => {
    if (!result) return;
    download(documentRoot, new Blob([resultsCsv(result, resultCalibration())], { type: "text/csv;charset=utf-8" }), `${safeFilename(result.image_id)}_strand_widths_${measurementUnits(resultCalibration()).suffix}.csv`);
  });
  on(element("ExportPng"), "click", () => {
    const figure = readyFigure();
    if (!figure || element("ExportPng").disabled) return;
    const filename = `${safeFilename(result.image_id)}_width_analysis.png`;
    download(documentRoot, figure.blob, filename);
  });
  function resetBundle() {
    bundleRequest += 1;
    pendingBundle = false;
    element("BundleStatus").hidden = true;
    element("BundleStatus").textContent = "";
  }

  function bundleStatus(message, kind = "info") {
    element("BundleStatus").textContent = message;
    element("BundleStatus").dataset.kind = kind;
    element("BundleStatus").hidden = false;
  }

  on(element("ExportBundle"), "click", async () => {
    refresh();
    if (element("ExportBundle").disabled) return;
    const token = ++bundleRequest;
    const capturedResult = result;
    const capturedSnapshot = analysisSnapshot;
    const capturedCalibration = resultCalibration();
    const capturedFigure = readyFigure();
    const capturedImage = imageState.image;
    const capturedKey = currentKey;
    const exportedAt = new Date().toISOString();
    pendingBundle = true;
    bundleStatus("Preparing your analysis bundle…", "working");
    renderHeader();
    try {
      const reportPng = capturedFigure.blob;
      if (destroyed || token !== bundleRequest) return;
      const bundle = await createAnalysisBundle({
        ...capturedSnapshot, result: capturedResult, calibration: capturedCalibration,
        selectedStrand: null, exportedAt, reportPng,
        renderingProvenance: capturedFigure.renderingProvenance,
      });
      if (destroyed || token !== bundleRequest) return;
      // Reject stale exports even if a state change has not yet reached the presenter.
      if (result !== capturedResult || imageState.image !== capturedImage ||
          imageState.imageLoadStatus === "loading" ||
          capturedKey !== measurementKey(imageState, annotationState.annotations, element("Label").value) ||
          readyFigure() !== capturedFigure ||
          JSON.stringify(capturedCalibration) !== JSON.stringify(resultCalibration())) {
        bundleStatus("The image, annotations, or calibration changed. Export the updated analysis again.");
        return;
      }
      download(documentRoot, bundle, `${safeFilename(capturedResult.image_id)}_analysis_bundle.zip`);
      bundleStatus("Analysis bundle download started. Keep the ZIP file with your project.", "success");
    } catch (error) {
      if (!destroyed && token === bundleRequest) {
        bundleStatus(`The analysis bundle could not be created. ${error.message} Try exporting again.`, "error");
      }
    } finally {
      if (!destroyed && token === bundleRequest) {
        pendingBundle = false;
        renderHeader();
      }
    }
  });
  on(windowRoot, "resize", () => {
    if (!active || destroyed || resizeFrame != null) return;
    resizeFrame = windowRoot.requestAnimationFrame(() => {
      resizeFrame = null;
      if (!active || destroyed) return;
      renderFigures();
      if (reference) drawReference(false);
    });
  });

  refresh();
  element("CalibrationMessage").textContent ||= "Using the benchmark's default scale until an image calibration is supplied.";
  return Object.freeze({
    refresh,
    activate() { active = true; refresh(); renderResults(); setStatus(statusText, statusKind); },
    deactivate() { active = false; },
    destroy() {
      destroyed = true; referenceRequest += 1; resetBundle(); analysisSnapshot = null; cancel();
      savedAnalysisViewer.destroy();
      benchmarkFigure.destroy();
      if (resizeFrame != null) windowRoot.cancelAnimationFrame(resizeFrame);
      listeners.forEach((remove) => remove()); root.replaceChildren();
    },
  });
}
