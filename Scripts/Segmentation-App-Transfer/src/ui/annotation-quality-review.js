const ISSUE_MESSAGES = {
  "self-intersection": "Crossing or overlapping polygon edges.",
  "zero-area": "Zero-area shape.",
  "invalid-geometry": "Invalid geometry.",
  "duplicate-shape": "Duplicate boundary: inspect the related shape before deleting either copy.",
  "overlapping-shapes": "Overlap exceeds 20% of the smaller shape. Crossing strands may be intentional.",
};

const REVIEW_STATUSES = [
  ["unreviewed", "Unreviewed"],
  ["needs-review", "Needs review"],
  ["approved", "Approved"],
];

function issueMessage(code, area) {
  if (code === "small-region") {
    return Number.isFinite(area)
      ? `Small region: ${Number(area.toPrecision(4))} px².`
      : "Small region.";
  }
  return ISSUE_MESSAGES[code] ?? "Geometry needs review.";
}

export function createAnnotationQualityReview({
  documentRoot = document,
  onShowAnnotation = () => {},
  getReport,
  getPreview,
  renderMask,
  getReviewEntries,
  onSetReviewStatus = () => false,
} = {}) {
  const dialog = documentRoot.querySelector("#annotationQualityDialog");
  const summary = documentRoot.querySelector("#annotationQualitySummary");
  const context = documentRoot.querySelector("#annotationQualityContext");
  const issuesList = documentRoot.querySelector("#annotationQualityIssues");
  const backButton = documentRoot.querySelector("#annotationQualityBack");
  const exportButton = documentRoot.querySelector("#annotationQualityExport");
  const find = (suffix) => documentRoot.querySelector(`#annotationQuality${suffix}`);
  const checksTab = find("ChecksTab");
  const maskTab = find("MaskTab");
  const checksPanel = find("ChecksPanel");
  const maskPanel = find("MaskPanel");
  const overlapChecks = find("OverlapChecks");
  const pairNotice = find("PairNotice");
  const reviewSection = find("ReviewSection");
  const statusFilter = find("StatusFilter");
  const reviewEntries = find("ReviewEntries");
  const reviewMessage = find("ReviewMessage");
  const reviewPrevious = find("ReviewPrevious");
  const reviewNext = find("ReviewNext");
  const reviewPageInfo = find("ReviewPageInfo");
  const maskMode = find("MaskMode");
  const compareOriginal = find("CompareOriginal");
  const maskCanvas = find("MaskCanvas");
  const originalCanvas = find("OriginalCanvas");
  const originalFigure = find("OriginalFigure");
  const previewFigures = find("PreviewFigures");
  const previewMessage = find("PreviewMessage");
  const ownerDocument = dialog.ownerDocument;
  let request = null;
  let previewReady = false;
  let reviewPage = 0;
  let statusControls = new Map();
  const reviewPageSize = 25;

  function showAnnotation(id) {
    if (!request) return;
    finish();
    onShowAnnotation(id);
  }

  function showReviewMessage(message = "") {
    if (!reviewMessage) return;
    reviewMessage.textContent = message;
    reviewMessage.hidden = !message;
  }

  function finish(exportRequested = false) {
    const current = request;
    request = null;
    if (dialog.open) dialog.close();
    if (!current) return;
    // Release full-resolution preview buffers while the review is closed.
    previewReady = false;
    for (const canvas of [maskCanvas, originalCanvas]) {
      if (canvas) { canvas.width = 0; canvas.height = 0; }
    }
    if (current.trigger?.isConnected) current.trigger.focus({ preventScroll: true });
    if (exportRequested) current.onExport?.();
    else current.onCancel?.();
  }

  function renderIssue(issue, annotationsById) {
    const row = ownerDocument.createElement("li");
    row.className = "quality-issue";
    row.dataset.annotationId = issue.annotationId;

    const content = ownerDocument.createElement("div");
    content.className = "quality-issue-content";
    const title = ownerDocument.createElement("p");
    title.className = "quality-issue-title";
    const typeName = issue.type === "ellipse" ? "Ellipse" : "Polygon";
    const shapeName = `${issue.type === "ellipse" ? "E" : "P"}#${issue.typeIndex + 1}`;
    title.textContent = issue.label ? `${shapeName} — ${issue.label}` : shapeName;
    content.append(title);

    const reasons = ownerDocument.createElement("ul");
    reasons.className = "quality-issue-reasons";
    for (const code of issue.codes) {
      const reason = ownerDocument.createElement("li");
      reason.textContent = issueMessage(code, issue.area);
      reasons.append(reason);
    }
    content.append(reasons);
    row.append(content);

    const showButton = ownerDocument.createElement("button");
    showButton.type = "button";
    showButton.className = "quality-show-shape";
    showButton.dataset.annotationId = issue.annotationId;
    showButton.textContent = "Select shape";
    showButton.setAttribute("aria-label", `Select ${typeName.toLowerCase()} ${issue.typeIndex + 1}`);
    showButton.addEventListener("click", () => showAnnotation(issue.annotationId));
    row.append(showButton);
    for (const relatedId of new Set(issue.relatedAnnotationIds ?? [])) {
      if (relatedId === issue.annotationId) continue;
      const relatedButton = ownerDocument.createElement("button");
      relatedButton.type = "button";
      relatedButton.className = "quality-show-related";
      relatedButton.dataset.annotationId = relatedId;
      const related = annotationsById.get(relatedId);
      const numbered = related && Number.isInteger(related.typeIndex) && related.typeIndex >= 0;
      relatedButton.textContent = numbered
        ? `Select ${related.type === "ellipse" ? "E" : "P"}#${related.typeIndex + 1}`
        : "Select related shape";
      relatedButton.setAttribute("aria-label", numbered
        ? `Select related ${related.type === "ellipse" ? "ellipse" : "polygon"} ${related.typeIndex + 1}${related.label ? ` — ${related.label}` : ""}`
        : "Select related shape");
      relatedButton.addEventListener("click", () => showAnnotation(relatedId));
      row.append(relatedButton);
    }
    return row;
  }

  function renderReport(report) {
    const { exportLabel, onExport, stale } = request;
    const pendingExport = typeof onExport === "function";
    const issueCount = report.issues.length;
    const shapeCount = report.checkedCount;
    summary.textContent = shapeCount === 0
      ? "No annotations to review."
      : issueCount === 0
        ? `No issues found in ${shapeCount} ${shapeCount === 1 ? "shape" : "shapes"} checked.`
        : `${issueCount} ${issueCount === 1 ? "shape needs" : "shapes need"} review out of ${shapeCount} checked.`;
    context.textContent = pendingExport
      ? `${stale ? "The document changed since the previous review. " : ""}${exportLabel || "Export"} is waiting for review. You can return to editing or export the current annotations.`
      : "Review flagged shapes before exporting. These checks do not change your annotations.";
    const annotationsById = new Map(report.issues.map(issue => [issue.annotationId, issue]));
    if (typeof getReviewEntries === "function") {
      for (const entry of getReviewEntries()) annotationsById.set(entry.id, entry);
    }
    issuesList.replaceChildren(...report.issues.map(issue => renderIssue(issue, annotationsById)));
    issuesList.hidden = issueCount === 0;
    if (pairNotice) {
      const notices = [];
      if (report.pairSummary?.truncated) notices.push("The pair-check limit was reached. Some shape pairs were not checked.");
      if (report.pairSummary?.skippedComplexShapes) notices.push("Some complex or invalid boundaries were skipped by pair checks. Review those shapes manually.");
      pairNotice.textContent = notices.join(" ");
      pairNotice.hidden = notices.length === 0;
    }
    exportButton.hidden = !pendingExport;
    exportButton.textContent = issueCount > 0 ? "Export anyway" : exportLabel || "Export";
  }

  function renderReviewEntries() {
    if (!reviewSection || !reviewEntries) return;
    reviewSection.hidden = typeof getReviewEntries !== "function";
    if (reviewSection.hidden) return;
    const filter = statusFilter?.value || "all";
    const entries = getReviewEntries().filter(entry => request?.includeEllipses !== false || entry.type !== "ellipse");
    const visible = entries.filter(entry => filter === "all" || (entry.status || "unreviewed") === filter);
    reviewPage = Math.min(reviewPage, Math.max(0, Math.ceil(visible.length / reviewPageSize) - 1));
    const pageStart = reviewPage * reviewPageSize;
    if (reviewPrevious) reviewPrevious.disabled = reviewPage === 0;
    if (reviewNext) reviewNext.disabled = pageStart + reviewPageSize >= visible.length;
    if (reviewPageInfo) reviewPageInfo.textContent = visible.length === 0
      ? "0 shapes" : `${pageStart + 1}–${Math.min(pageStart + reviewPageSize, visible.length)} of ${visible.length} shapes`;
    statusControls = new Map();
    const rows = visible.slice(pageStart, pageStart + reviewPageSize).map(entry => {
      const row = ownerDocument.createElement("li");
      row.className = "quality-review-entry";
      row.dataset.annotationId = entry.id;
      const shapeName = `${entry.type === "ellipse" ? "E" : "P"}#${entry.typeIndex + 1}`;
      const title = ownerDocument.createElement("span");
      title.className = "quality-review-entry-title";
      title.textContent = entry.label ? `${shapeName} — ${entry.label}` : shapeName;
      row.append(title);
      const selectButton = ownerDocument.createElement("button");
      selectButton.type = "button";
      selectButton.textContent = "Select shape";
      selectButton.className = "quality-review-show";
      selectButton.addEventListener("click", () => showAnnotation(entry.id));
      row.append(selectButton);
      const status = ownerDocument.createElement("select");
      status.className = "quality-review-status";
      status.dataset.annotationId = entry.id;
      status.setAttribute("aria-label", `Review status for ${shapeName}`);
      for (const [value, label] of REVIEW_STATUSES) {
        const option = ownerDocument.createElement("option");
        option.value = value;
        option.textContent = label;
        status.append(option);
      }
      status.value = entry.status || "unreviewed";
      status.addEventListener("change", () => {
        if (!request) return;
        const next = status.value;
        if (!REVIEW_STATUSES.some(([value]) => value === next)) return;
        try {
          const updated = onSetReviewStatus(entry.id, next);
          showReviewMessage(updated === false ? "" : `${shapeName} marked ${REVIEW_STATUSES.find(([value]) => value === next)[1].toLowerCase()}.`);
        } catch (error) {
          showReviewMessage(error?.message || "The review status could not be saved.");
        }
        renderReviewEntries();
        const refreshed = statusControls.get(entry.id);
        if (refreshed) refreshed.focus({ preventScroll: true });
        else statusFilter?.focus({ preventScroll: true });
      });
      statusControls.set(entry.id, status);
      row.append(status);
      return row;
    });
    if (rows.length === 0) {
      const empty = ownerDocument.createElement("li");
      empty.className = "quality-review-empty";
      empty.textContent = entries.length === 0 ? "No annotations to review." : "No shapes with this review status.";
      rows.push(empty);
    }
    reviewEntries.replaceChildren(...rows);
  }

  function setPreviewMessage(message = "") {
    if (!previewMessage) return;
    previewMessage.textContent = message;
    previewMessage.hidden = !message;
  }

  function updateComparison() {
    if (originalFigure) originalFigure.hidden = !previewReady || !compareOriginal?.checked;
    if (previewFigures) previewFigures.dataset.compare = String(Boolean(previewReady && compareOriginal?.checked));
  }

  function renderPreview() {
    previewReady = false;
    if (previewFigures) previewFigures.hidden = true;
    updateComparison();
    if (!getPreview || !renderMask || !maskCanvas || !originalCanvas) return;
    try {
      const input = getPreview();
      if (input?.loading) {
        setPreviewMessage("Wait for the image to finish loading before previewing its mask.");
        return;
      }
      const { image, imageSize, annotations } = input ?? {};
      if (!image || !imageSize || !(imageSize.width > 0) || !(imageSize.height > 0)) {
        setPreviewMessage("Load an image to preview its mask.");
        return;
      }
      const source = renderMask({ imageSize, annotations, inverted: maskMode?.value === "inverted" });
      if (!source) throw new Error("The mask preview could not be rendered.");
      maskCanvas.width = source.width;
      maskCanvas.height = source.height;
      const maskContext = maskCanvas.getContext("2d");
      if (!maskContext) throw new Error("The mask preview could not be displayed.");
      maskContext.imageSmoothingEnabled = false;
      maskContext.drawImage(source, 0, 0);
      originalCanvas.width = imageSize.width;
      originalCanvas.height = imageSize.height;
      const originalContext = originalCanvas.getContext("2d");
      if (!originalContext) throw new Error("The original image could not be displayed.");
      originalContext.drawImage(image, 0, 0, imageSize.width, imageSize.height);
      previewReady = true;
      if (previewFigures) previewFigures.hidden = false;
      setPreviewMessage();
      updateComparison();
    } catch (error) {
      setPreviewMessage(error?.message || "The mask preview could not be rendered.");
    }
  }

  function showTab(tab) {
    const preview = tab === "mask";
    if (checksPanel) checksPanel.hidden = preview;
    if (maskPanel) maskPanel.hidden = !preview;
    checksTab?.setAttribute("aria-selected", String(!preview));
    maskTab?.setAttribute("aria-selected", String(preview));
    if (checksTab) checksTab.tabIndex = preview ? -1 : 0;
    if (maskTab) maskTab.tabIndex = preview ? 0 : -1;
    if (preview && !previewReady) renderPreview();
  }

  function open({ report, exportLabel, onExport, onCancel, stale = false, includeEllipses = true, inverted = false }) {
    if (request) finish();
    request = { exportLabel, onExport, onCancel, stale, includeEllipses, trigger: ownerDocument.activeElement };
    previewReady = false;
    if (overlapChecks) { overlapChecks.checked = false; overlapChecks.disabled = typeof getReport !== "function"; }
    if (maskMode) maskMode.value = inverted ? "inverted" : "normal";
    if (compareOriginal) compareOriginal.checked = false;
    if (statusFilter) statusFilter.value = "all";
    reviewPage = 0;
    if (maskTab) maskTab.disabled = typeof getPreview !== "function" || typeof renderMask !== "function";
    showReviewMessage();
    showTab("checks");
    renderReport(report);
    renderReviewEntries();
    dialog.showModal();
    backButton.focus({ preventScroll: true });
  }

  checksTab?.addEventListener("click", () => { if (request) showTab("checks"); });
  maskTab?.addEventListener("click", () => { if (request) showTab("mask"); });
  for (const tab of [checksTab, maskTab]) {
    tab?.addEventListener("keydown", event => {
      if (!request || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const target = event.key === "Home" ? checksTab : event.key === "End" ? maskTab : tab === checksTab ? maskTab : checksTab;
      if (target?.disabled) return;
      showTab(target === maskTab ? "mask" : "checks");
      target?.focus({ preventScroll: true });
    });
  }
  maskMode?.addEventListener("change", () => { if (request) renderPreview(); });
  compareOriginal?.addEventListener("change", updateComparison);
  statusFilter?.addEventListener("change", () => { reviewPage = 0; renderReviewEntries(); });
  reviewPrevious?.addEventListener("click", () => {
    if (!request || reviewPage === 0) return;
    reviewPage--;
    renderReviewEntries();
  });
  reviewNext?.addEventListener("click", () => {
    if (!request || reviewNext.disabled) return;
    reviewPage++;
    renderReviewEntries();
  });
  overlapChecks?.addEventListener("change", () => {
    if (!request || typeof getReport !== "function") return;
    try {
      renderReport(getReport({ includeOverlaps: overlapChecks.checked, includeEllipses: request.includeEllipses }));
      showReviewMessage();
    } catch (error) {
      showReviewMessage(error?.message || "The overlap check could not be completed.");
    }
  });

  backButton.addEventListener("click", () => finish());
  exportButton.addEventListener("click", () => {
    if (request && typeof request.onExport === "function") finish(true);
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    finish();
  });
  dialog.addEventListener("close", () => {
    // A close event may arrive after a replacement review has already opened.
    if (!dialog.open) finish();
  });
  for (const type of ["keydown", "keyup"]) {
    dialog.addEventListener(type, (event) => event.stopPropagation());
  }

  return { open, close: () => finish(), isOpen: () => dialog.open };
}
