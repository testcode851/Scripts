import { readAnalysisBundle } from "./analysis-bundle-reader.js";
import { displayNumber, measurementUnits, resultColumns, resultRows, scaleWidth } from "./analytics-data.js";

const PAGE_SIZE = 100;
const TEMPLATE = `
  <div class="analytics-saved-launch">
    <button type="button" id="analyticsOpenBundle">Open saved analysis</button>
    <input type="file" id="analyticsBundleFile" accept=".zip,application/zip" hidden>
  </div>
  <dialog id="analyticsSavedDialog" class="analytics-saved-dialog" aria-labelledby="analyticsSavedTitle">
    <header class="analytics-saved-header">
      <div><h2 id="analyticsSavedTitle">Saved analysis</h2><p class="analytics-help">Review saved results, their mask, and the settings used.</p></div>
      <button type="button" id="analyticsSavedClose" autofocus>Close</button>
    </header>
    <div class="analytics-saved-body">
      <p id="analyticsSavedStatus" class="analytics-status" role="status" aria-live="polite"></p>
      <div id="analyticsSavedContent" hidden>
        <h3 id="analyticsSavedImageName"></h3>
        <dl id="analyticsSavedFacts" class="analytics-saved-facts"></dl>
        <div id="analyticsSavedSummary" class="analytics-summary"></div>
        <figure class="analytics-saved-report"><figcaption>Saved report</figcaption>
          <img id="analyticsSavedReport" alt="Saved analysis report">
          <p id="analyticsSavedReportNote" class="analytics-help"></p>
        </figure>
        <details class="analytics-saved-mask">
          <summary>Exact analyzed mask</summary>
          <p id="analyticsSavedMaskDimensions" class="analytics-help"></p>
          <img id="analyticsSavedMask" alt="Exact binary mask used for the saved analysis">
        </details>
        <section class="analytics-saved-results" aria-labelledby="analyticsSavedResultsTitle">
          <h3 id="analyticsSavedResultsTitle">Per-strand results</h3>
          <p id="analyticsSavedUnits" class="analytics-help"></p>
          <div class="analytics-saved-table-wrap" tabindex="0" aria-label="Saved per-strand results. Scroll horizontally to see all columns."><table id="analyticsSavedTable"><thead></thead><tbody></tbody></table></div>
          <p id="analyticsSavedEmpty" class="analytics-table-empty" hidden>No measurable strands were found in this mask.</p>
          <div id="analyticsSavedPagination" class="analytics-inline">
            <button type="button" id="analyticsSavedPrevious">Previous</button>
            <span id="analyticsSavedPage" class="analytics-help" aria-live="polite"></span>
            <button type="button" id="analyticsSavedNext">Next</button>
          </div>
        </section>
        <details id="analyticsSavedMetadata" class="analytics-saved-metadata">
          <summary>Software, settings, and file checks</summary>
          <p class="analytics-help">The file checks confirm that the files match the saved record. They do not verify who created the bundle or rerun the measurements.</p>
          <pre></pre>
        </details>
      </div>
    </div>
    <footer class="analytics-saved-footer">
      <span class="analytics-help">Saved results · Read only</span>
      <button type="button" id="analyticsSavedReplace">Open another bundle</button>
    </footer>
  </dialog>`;

function decodeImage(documentRoot, url, signal) {
  return new Promise((resolve, reject) => {
    const image = documentRoot.createElement("img");
    function finish(error) {
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(image);
    }
    function abort() {
      image.removeAttribute("src");
      finish(new DOMException("Opening the saved analysis was canceled.", "AbortError"));
    }
    image.onload = () => finish();
    image.onerror = () => finish(new Error("A saved PNG image could not be decoded."));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else image.src = url;
  });
}

function validateMask(documentRoot, image, size) {
  if (image.naturalWidth !== size.width || image.naturalHeight !== size.height ||
      size.width > 12000 || size.height > 12000 || size.width * size.height > 25_000_000) {
    throw new Error("The decoded mask dimensions do not match the saved analysis.");
  }
  const canvas = documentRoot.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  try {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("This browser could not check the saved mask.");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, size.width, size.height).data;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const value = pixels[offset];
      if ((value !== 0 && value !== 255) || pixels[offset + 1] !== value ||
          pixels[offset + 2] !== value || pixels[offset + 3] !== 255) {
        throw new Error("The saved mask must contain only opaque black and white pixels.");
      }
    }
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

function savedDate(value) {
  return new Date(value).toLocaleString();
}

/** Review a verified snapshot without reading or modifying the active document. */
export function createSavedAnalysisViewer({ root }) {
  const host = root.querySelector("#analyticsSavedAnalysis");
  const documentRoot = root.ownerDocument;
  if (!host || !documentRoot?.createElement) return { destroy() {} };
  host.innerHTML = TEMPLATE;
  const find = (suffix) => host.querySelector(`#analytics${suffix}`);
  const dialog = find("SavedDialog");
  // The controller's lightweight test DOM does not implement native dialogs.
  if (typeof dialog?.showModal !== "function") return { destroy() { host.replaceChildren(); } };

  const input = find("BundleFile");
  const opener = find("OpenBundle");
  const closeButton = find("SavedClose");
  const content = find("SavedContent");
  const status = find("SavedStatus");
  const listeners = [];
  let generation = 0;
  let pending = null;
  let destroyed = false;
  let current = null;
  let currentUrls = [];
  let page = 0;

  function listen(target, type, handler) {
    target.addEventListener(type, handler);
    listeners.push(() => target.removeEventListener(type, handler));
  }
  function setStatus(message, kind) {
    status.textContent = message;
    status.dataset.kind = kind;
  }
  function revoke(urls) {
    for (const url of urls) URL.revokeObjectURL(url);
  }
  function cancelPending() {
    generation += 1;
    pending?.abort();
    pending = null;
    dialog.setAttribute("aria-busy", "false");
  }
  function close() {
    cancelPending();
    if (dialog.open) dialog.close();
    find("SavedReport").removeAttribute("src");
    find("SavedMask").removeAttribute("src");
    revoke(currentUrls);
    currentUrls = [];
    current = null;
    content.hidden = true;
    if (!destroyed && opener.isConnected) opener.focus();
  }
  function chooseFile() {
    if (destroyed) return;
    input.value = "";
    input.click();
  }
  function renderTable() {
    const { measurements, calibration } = current;
    const table = find("SavedTable");
    const heading = documentRoot.createElement("tr");
    for (const name of resultColumns(calibration)) {
      const cell = documentRoot.createElement("th");
      cell.scope = "col";
      cell.textContent = name;
      heading.append(cell);
    }
    table.querySelector("thead").replaceChildren(heading);
    const body = documentRoot.createDocumentFragment();
    const start = page * PAGE_SIZE;
    const strands = measurements.per_strand.slice(start, start + PAGE_SIZE);
    const rows = resultRows({ ...measurements, per_strand: strands }, calibration);
    rows.forEach((values, index) => {
      const row = documentRoot.createElement("tr");
      row.dataset.strandId = String(strands[index].strand_id);
      if (strands[index].low_transect_count) row.className = "analytics-low-count";
      values.forEach((value, column) => {
        const cell = documentRoot.createElement("td");
        cell.textContent = typeof value === "number" && column >= 4
          ? displayNumber(value, 8) : value == null ? "—" : String(value);
        cell.title = value == null ? "No value" : String(value);
        row.append(cell);
      });
      body.append(row);
    });
    table.querySelector("tbody").replaceChildren(body);
    const count = measurements.per_strand.length;
    find("SavedEmpty").hidden = count !== 0;
    find("SavedPagination").hidden = count <= PAGE_SIZE;
    find("SavedPage").textContent = count ? `Rows ${start + 1}–${Math.min(start + PAGE_SIZE, count)} of ${count}` : "";
    find("SavedPrevious").disabled = page === 0;
    find("SavedNext").disabled = start + PAGE_SIZE >= count;
  }
  function render(metadata, filename, urls) {
    // Finish serialization before changing the displayed snapshot.
    const details = JSON.stringify({
      provenance: metadata.provenance, calibration: metadata.calibration, files: metadata.files,
    }, null, 2);
    const { image, measurements, calibration } = metadata;
    const unit = measurementUnits(calibration).symbol;
    const summary = measurements.summary;
    find("SavedImageName").textContent = image.name || measurements.image_id;
    const facts = documentRoot.createDocumentFragment();
    const entries = [
      ["Bundle", filename],
      ["Image size", `${image.width} × ${image.height} px`],
      ["Analyzed", savedDate(metadata.analyzed_at)],
      ["Saved", savedDate(metadata.exported_at)],
      ["Labels measured", metadata.label_filter || "All labels"],
      ["Scale", calibration ? `${displayNumber(calibration.umPerPixel, 10)} µm per pixel${calibration.source === "benchmark" ? " (benchmark default)" : ""}` : "Pixels only"],
    ];
    for (const [label, value] of entries) {
      const term = documentRoot.createElement("dt");
      const definition = documentRoot.createElement("dd");
      term.textContent = label;
      definition.textContent = value;
      facts.append(term, definition);
    }
    find("SavedFacts").replaceChildren(facts);
    const cards = documentRoot.createDocumentFragment();
    const values = [
      ["Mean of strand medians", summary.image_mean_px == null ? "—" : `${displayNumber(scaleWidth(summary.image_mean_px, calibration))} ${unit}`],
      ["Measured strands", displayNumber(summary.n_strands, 0)],
      ["Width measurements", displayNumber(summary.n_measurements_total, 0)],
      ["Between-strand CV", summary.image_cv_pct == null ? "—" : `${displayNumber(summary.image_cv_pct, 2)}%`],
      ["Low transect count", displayNumber(summary.n_low_transect, 0)],
    ];
    for (const [label, value] of values) {
      const card = documentRoot.createElement("div");
      card.className = "analytics-card";
      const caption = documentRoot.createElement("span");
      const number = documentRoot.createElement("strong");
      caption.textContent = label;
      number.textContent = value;
      card.append(caption, number);
      cards.append(card);
    }
    find("SavedSummary").replaceChildren(cards);
    find("SavedReport").src = urls[1];
    find("SavedMask").src = urls[0];
    find("SavedReportNote").textContent = metadata.selected_strand_id == null
      ? "The report is shown exactly as saved."
      : `The report was saved with strand ${metadata.selected_strand_id} highlighted. The table includes all measured strands.`;
    find("SavedMaskDimensions").textContent = `${image.width} × ${image.height} pixels. The preview fits this panel; the saved mask keeps its original resolution.`;
    find("SavedUnits").textContent = `Widths are in ${unit}; coordinates and area remain in pixels. Values use the saved calibration.`;
    find("SavedMetadata").querySelector("pre").textContent = details;
    current = metadata;
    page = 0;
    renderTable();
    content.hidden = false;
  }

  async function openFile(file) {
    cancelPending();
    const token = generation;
    const controller = new AbortController();
    pending = controller;
    let urls = [];
    if (!dialog.open) dialog.showModal();
    dialog.setAttribute("aria-busy", "true");
    setStatus(`Checking ${file.name}…`, "working");
    const isCurrent = () => !destroyed && token === generation && dialog.open;
    try {
      const { metadata, files } = await readAnalysisBundle(file);
      if (!isCurrent()) return;
      urls.push(URL.createObjectURL(files["mask.png"]));
      urls.push(URL.createObjectURL(files["report.png"]));
      const [mask, report] = await Promise.all(urls.map((url) => decodeImage(documentRoot, url, controller.signal)));
      if (!isCurrent()) return;
      validateMask(documentRoot, mask, metadata.image);
      if (!report.naturalWidth || !report.naturalHeight ||
          report.naturalWidth > 20000 || report.naturalHeight > 20000 ||
          report.naturalWidth * report.naturalHeight > 40_000_000) {
        throw new Error("The saved report image dimensions are unsupported.");
      }
      if (!isCurrent()) return;
      render(metadata, file.name, urls);
      revoke(currentUrls);
      currentUrls = urls;
      urls = [];
      setStatus("Saved analysis opened. File checksums and contents match the saved record.", "success");
    } catch (error) {
      controller.abort();
      if (isCurrent()) {
        const unchanged = current ? " The previous saved analysis is still shown." : "";
        setStatus(`Unable to open this bundle: ${error?.message || "The file could not be read."}${unchanged}`, "error");
      }
    } finally {
      revoke(urls);
      if (token === generation) {
        pending = null;
        dialog.setAttribute("aria-busy", "false");
      }
    }
  }

  listen(opener, "click", chooseFile);
  listen(find("SavedReplace"), "click", chooseFile);
  listen(input, "change", () => {
    const file = input.files?.[0];
    if (file && !destroyed) void openFile(file);
  });
  listen(closeButton, "click", close);
  listen(dialog, "cancel", (event) => { event.preventDefault(); close(); });
  listen(dialog, "close", () => { if (!dialog.open) close(); });
  // Keep editor shortcuts out of this separate, read-only review.
  for (const type of ["keydown", "keyup"]) listen(dialog, type, (event) => event.stopPropagation());
  listen(find("SavedPrevious"), "click", () => {
    if (current && page > 0) { page -= 1; renderTable(); }
  });
  listen(find("SavedNext"), "click", () => {
    if (current && (page + 1) * PAGE_SIZE < current.measurements.per_strand.length) { page += 1; renderTable(); }
  });

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelPending();
      listeners.forEach((remove) => remove());
      if (dialog.open) dialog.close();
      revoke(currentUrls);
      currentUrls = [];
      current = null;
      host.replaceChildren();
    },
  };
}
