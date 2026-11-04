/** Present the image queue; document changes and storage belong to the caller. */
export function createProjectDrawer({
  documentRoot = document,
  onToggle = () => {},
  onSelect = () => {},
  onAddFiles = () => {},
  onComplete = () => {},
  onExport = () => {},
  onRename = () => {},
  onRetry = () => {},
  onClose = () => {},
  onRemove = () => {},
  onClear = () => {},
} = {}) {
  const find = id => documentRoot.getElementById(id);
  const ids = ["DrawerToggle", "Drawer", "DrawerCollapse", "Navigation", "Prev", "Next",
    "Position", "CurrentName", "Complete", "Export", "Retry", "Status", "DrawerStatus", "Name",
    "ImageCount", "Progress", "ImportProgress", "ImportLabel", "ImportBar", "ImportFile",
    "Search", "Filter", "ImageList", "EmptyList", "AddImages",
    "ImageInput", "ExportDialog", "ExportForm", "ExportScope", "ExportFormat", "ExportImages",
    "ExportMasks", "ExportJson", "ExportCocoNote", "ExportError", "ExportCancel", "ExportConfirm",
    "Actions", "ActionsSummary", "CloseCurrent", "ClearBatch", "CleanupDialog", "CleanupForm",
    "CleanupTitle", "CleanupSummary", "CleanupWarning", "CleanupCancel", "CleanupExport", "CleanupConfirm"];
  const elements = Object.fromEntries(ids.map(id => [id, find(`project${id}`)]));
  const workspace = find("annotationPage");
  const rows = new Map();
  const listeners = [];
  let state = { project: null, activeId: null, busy: false, saving: false, error: "", expanded: false };
  let visibleIds = [];
  let disposed = false;
  let rendered = false;
  let summary = { index: -1, current: null, complete: 0 };
  let cleanup = null;

  function listen(element, type, handler) {
    if (!element) return;
    element.addEventListener(type, handler);
    listeners.push(() => element.removeEventListener(type, handler));
  }

  function set(element, key, value) {
    if (element && element[key] !== value) element[key] = value;
  }

  function setStatus(text = "", isError = false, hideDrawerStatus = false) {
    const routineSave = !isError && ["Saved", "Unsaved", "Saving…"].includes(text);
    for (const element of [elements.Status, elements.DrawerStatus]) {
      const visibleText = (element === elements.Status && routineSave)
        || (element === elements.DrawerStatus && hideDrawerStatus) ? "" : String(text || "");
      set(element, "textContent", visibleText);
      set(element, "hidden", !visibleText);
      element?.setAttribute("data-error", String(Boolean(isError)));
    }
  }

  function renderImportProgress() {
    const progress = state.busy && !state.error ? state.importProgress : null;
    set(elements.ImportProgress, "hidden", !progress);
    if (!progress) {
      set(elements.ImportLabel, "textContent", "");
      set(elements.ImportFile, "textContent", "");
      elements.ImportBar?.removeAttribute("value");
      return false;
    }
    const total = Number.isSafeInteger(progress.total) && progress.total > 0 ? progress.total : 0;
    const completed = Number.isSafeInteger(progress.completed)
      ? Math.max(0, Math.min(progress.completed, total)) : 0;
    const determinate = total > 0 && ["preparing", "checking", "saving"].includes(progress.phase);
    const labels = { preparing: "Preparing images", opening: "Preparing first image", checking: "Checking images", saving: "Saving batch" };
    const label = labels[progress.phase] || "Preparing images";
    set(elements.ImportLabel, "textContent", determinate
      ? `${label}: ${completed} of ${total} (${Math.round(completed / total * 100)}%)` : `${label}…`);
    set(elements.ImportFile, "textContent", progress.fileName || "");
    set(elements.ImportFile, "hidden", !progress.fileName);
    if (determinate) {
      elements.ImportBar?.setAttribute("max", String(total));
      elements.ImportBar?.setAttribute("value", String(completed));
    } else {
      elements.ImportBar?.removeAttribute("value");
    }
    return true;
  }

  async function invoke(callback, ...args) {
    if (disposed) return;
    try { await callback(...args); }
    catch (error) { if (!disposed) setStatus(error?.message || "The image batch could not be updated.", true); }
  }

  const items = () => state.project?.items || [];
  const activeIndex = () => items().findIndex(item => item.id === state.activeId);
  const activeItem = () => items()[activeIndex()] || null;
  const isBusy = () => Boolean(state.busy);

  function makeRow(item) {
    const entry = documentRoot.createElement("div");
    entry.className = "project-image-entry";
    const button = documentRoot.createElement("button");
    button.type = "button";
    button.className = "project-image-row";
    button.dataset.imageId = item.id;
    const thumbnail = documentRoot.createElement("img");
    thumbnail.className = "project-thumbnail";
    thumbnail.alt = "";
    thumbnail.loading = "lazy";
    thumbnail.hidden = true;
    const placeholder = documentRoot.createElement("span");
    placeholder.className = "project-thumbnail project-thumbnail-placeholder";
    placeholder.setAttribute("aria-hidden", "true");
    const copy = documentRoot.createElement("span");
    copy.className = "project-image-copy";
    const name = documentRoot.createElement("span");
    name.className = "project-image-name";
    const detail = documentRoot.createElement("span");
    detail.className = "project-image-detail";
    copy.append(name, detail);
    button.append(thumbnail, placeholder, copy);
    button.addEventListener("click", () => {
      if (!isBusy() && item.id !== state.activeId) void invoke(onSelect, item.id);
    });
    const remove = documentRoot.createElement("button");
    remove.type = "button";
    remove.className = "project-image-remove";
    remove.dataset.removeImageId = item.id;
    remove.textContent = "×";
    remove.addEventListener("click", event => {
      event.stopPropagation();
      showCleanup("remove", item.id, remove);
    });
    entry.append(button, remove);
    return { entry, button, remove, thumbnail, placeholder, name, detail };
  }

  function renderList() {
    const search = (elements.Search?.value || "").trim().toLocaleLowerCase();
    const filter = elements.Filter?.value || "all";
    const all = items();
    const positions = new Map(all.map((item, index) => [item.id, index + 1]));
    const existing = new Set(all.map(item => item.id));
    for (const id of rows.keys()) if (!existing.has(id)) rows.delete(id);
    const shown = all.filter(item => (filter === "all" || (filter === "complete") === (item.status === "complete"))
      && String(item.name || "").toLocaleLowerCase().includes(search));
    const nextIds = [];
    for (const item of shown) {
      let row = rows.get(item.id);
      if (!row) { row = makeRow(item); rows.set(item.id, row); }
      const selected = item.id === state.activeId;
      const status = item.status === "complete" ? "Complete" : item.status === "in-progress" ? "In progress" : "Not started";
      const count = Number.isSafeInteger(item.annotationCount) && item.annotationCount >= 0 ? item.annotationCount : 0;
      const detail = `${status} · ${count} ${count === 1 ? "shape" : "shapes"}`;
      set(row.name, "textContent", item.name || "Unnamed image");
      set(row.button, "title", item.name || "Unnamed image");
      set(row.detail, "textContent", detail);
      set(row.button, "disabled", isBusy());
      set(row.remove, "disabled", isBusy());
      set(row.remove, "title", `Remove ${item.name || "Unnamed image"} from batch`);
      row.remove.setAttribute("aria-label", `Remove ${item.name || "Unnamed image"} from batch`);
      row.button.setAttribute("aria-current", String(selected));
      row.button.setAttribute("aria-label", `${item.name || "Unnamed image"}, ${detail}`);
      const thumbnailUrl = item.thumbnailUrl || state.thumbnails?.get?.(item.id) || state.thumbnails?.[item.id];
      set(row.thumbnail, "hidden", !thumbnailUrl);
      set(row.placeholder, "hidden", Boolean(thumbnailUrl));
      set(row.placeholder, "textContent", String(positions.get(item.id)));
      if (thumbnailUrl) set(row.thumbnail, "src", thumbnailUrl);
      else row.thumbnail.removeAttribute("src");
      nextIds.push(item.id);
    }
    if (nextIds.length !== visibleIds.length || nextIds.some((id, index) => id !== visibleIds[index])) {
      elements.ImageList?.replaceChildren(...nextIds.map(id => rows.get(id).entry));
      visibleIds = nextIds;
    }
    set(elements.EmptyList, "hidden", shown.length > 0);
    set(elements.EmptyList, "textContent", all.length
      ? "No images match this search and filter."
      : "Add PNG images or JSON files containing an embedded image to begin a batch.");
  }

  function render(nextState = {}) {
    if (disposed) return;
    const previous = state;
    state = { ...state, ...nextState };
    // Status notifications do not change queue contents. Callers can supply a
    // revision for metadata updates, or replace the project when it changes.
    const contentChanged = !rendered || (state.contentRevision === undefined
      ? state.project !== previous.project
      : state.contentRevision !== previous.contentRevision || state.project?.id !== previous.project?.id);
    const activeChanged = state.activeId !== previous.activeId;
    const listChanged = contentChanged || activeChanged || state.busy !== previous.busy
      || state.thumbnails !== previous.thumbnails;
    const all = items();
    if (contentChanged || activeChanged) {
      const index = activeIndex();
      summary = { index, current: all[index] || null,
        complete: contentChanged ? all.filter(item => item.status === "complete").length : summary.complete };
    }
    const { index, current, complete } = summary;
    const expanded = Boolean(state.expanded);
    const hasProject = all.length > 0;
    workspace?.classList.toggle("project-drawer-open", expanded);
    documentRoot.body?.classList.toggle("has-image-project", hasProject);
    set(elements.Drawer, "hidden", !expanded);
    set(elements.Navigation, "hidden", !hasProject);
    elements.DrawerToggle?.setAttribute("aria-expanded", String(expanded));
    elements.DrawerToggle?.classList.toggle("active", expanded);
    set(elements.DrawerToggle, "title", expanded ? "Hide image queue" : "Show image queue");
    set(elements.Prev, "disabled", isBusy() || index <= 0);
    set(elements.Next, "disabled", isBusy() || index < 0 || index >= all.length - 1);
    set(elements.Complete, "disabled", isBusy() || !current);
    set(elements.Complete, "textContent", current?.status === "complete" ? "Reopen image" : "Mark complete");
    set(elements.Export, "disabled", isBusy() || all.length === 0);
    set(elements.Actions, "hidden", !hasProject);
    set(elements.CloseCurrent, "disabled", isBusy() || !current);
    set(elements.ClearBatch, "disabled", isBusy() || all.length === 0);
    set(elements.CleanupConfirm, "disabled", isBusy());
    set(elements.CleanupExport, "disabled", isBusy());
    set(elements.Retry, "hidden", !state.canRetry);
    set(elements.Retry, "disabled", isBusy() || Boolean(state.saving));
    set(elements.AddImages, "disabled", isBusy());
    set(elements.ImageInput, "disabled", isBusy());
    set(elements.Name, "disabled", isBusy());
    if (documentRoot.activeElement !== elements.Name) set(elements.Name, "value", state.project?.name || "Image batch");
    set(elements.Position, "textContent", index < 0 && hasProject ? `No image open · ${all.length} images` : `Image ${index < 0 ? 0 : index + 1} of ${all.length}`);
    set(elements.CurrentName, "textContent", current?.name || "");
    set(elements.CurrentName, "title", current?.name || "");
    set(elements.ImageCount, "textContent", String(all.length));
    set(elements.Progress, "textContent", hasProject ? `${complete} of ${all.length} complete` : "No images yet");
    elements.Drawer?.setAttribute("aria-busy", String(isBusy()));
    const showingImportProgress = renderImportProgress();
    setStatus(state.error || (state.saving ? "Saving…" : state.message || (state.dirty ? "Unsaved" : hasProject ? "Saved" : "")), Boolean(state.error), showingImportProgress);
    if (listChanged) renderList();
    rendered = true;
  }

  function closeExport() {
    elements.ExportDialog?.close();
    elements.Export?.focus();
  }

  function showExport(scope) {
    if (isBusy() || items().length === 0) return;
    if (scope) set(elements.ExportScope, "value", scope);
    set(elements.ExportFormat, "value", state.outputFormat === "coco" ? "coco" : "llnl");
    set(elements.ExportCocoNote, "hidden", elements.ExportFormat?.value !== "coco");
    set(elements.ExportError, "hidden", true);
    elements.ExportDialog?.showModal();
    elements.ExportScope?.focus();
  }

  function closeCleanup({ restoreFocus = true } = {}) {
    const pending = cleanup;
    cleanup = null;
    elements.CleanupDialog?.close();
    if (restoreFocus) {
      const triggerAvailable = pending?.trigger && items().length > 0
        && (pending.kind !== "remove" || items().some(item => item.id === pending.id));
      (triggerAvailable ? pending.trigger : state.expanded ? elements.AddImages : elements.DrawerToggle)?.focus();
    }
  }

  function showCleanup(kind, id, trigger) {
    if (disposed || isBusy()) return;
    const affected = kind === "clear" ? items() : items().filter(item => item.id === id);
    if (!affected.length) return;
    const shapes = affected.reduce((count, item) => count + (Number.isSafeInteger(item.annotationCount) && item.annotationCount >= 0 ? item.annotationCount : 0), 0);
    cleanup = { kind, id, trigger };
    set(elements.CleanupTitle, "textContent", kind === "clear" ? "Clear image batch?" : "Remove image from batch?");
    set(elements.CleanupSummary, "textContent", kind === "clear"
      ? `Remove ${affected.length} ${affected.length === 1 ? "image" : "images"} and ${shapes} ${shapes === 1 ? "annotation" : "annotations"} from this batch? The canvas will be empty.`
      : `Remove “${affected[0].name || "Unnamed image"}” and its ${shapes} ${shapes === 1 ? "annotation" : "annotations"} from this batch?${id === state.activeId ? " The canvas will be empty." : ""}`);
    set(elements.CleanupConfirm, "textContent", kind === "clear" ? "Clear batch" : "Remove image");
    elements.CleanupDialog?.showModal();
    elements.CleanupCancel?.focus();
  }

  listen(elements.DrawerToggle, "click", () => void invoke(onToggle, !state.expanded));
  listen(elements.DrawerCollapse, "click", () => {
    void invoke(onToggle, false);
    elements.DrawerToggle?.focus();
  });
  listen(elements.Prev, "click", () => { if (!isBusy() && activeIndex() > 0) void invoke(onSelect, items()[activeIndex() - 1].id); });
  listen(elements.Next, "click", () => {
    const next = items()[activeIndex() + 1];
    if (!isBusy() && activeIndex() >= 0 && next) void invoke(onSelect, next.id);
  });
  listen(elements.Complete, "click", () => {
    const current = activeItem();
    if (!isBusy() && current) void invoke(onComplete, current.id, current.status !== "complete");
  });
  listen(elements.Name, "change", () => { if (!isBusy()) void invoke(onRename, elements.Name.value.trim() || "Image batch"); });
  listen(elements.AddImages, "click", () => { if (!isBusy()) elements.ImageInput?.click(); });
  listen(elements.ImageInput, "change", () => {
    const files = Array.from(elements.ImageInput?.files || []);
    set(elements.ImageInput, "value", "");
    if (!isBusy() && files.length) void invoke(onAddFiles, files);
  });
  listen(elements.Filter, "change", renderList);
  listen(elements.Search, "input", renderList);
  listen(elements.Export, "click", () => showExport());
  listen(elements.CloseCurrent, "click", () => {
    if (!isBusy() && activeItem()) {
      set(elements.Actions, "open", false);
      elements.ActionsSummary?.focus();
      void invoke(onClose);
    }
  });
  listen(elements.ClearBatch, "click", () => showCleanup("clear", null, elements.ClearBatch));
  listen(elements.CleanupCancel, "click", () => closeCleanup());
  listen(elements.CleanupDialog, "cancel", event => { event.preventDefault(); closeCleanup(); });
  listen(elements.CleanupExport, "click", () => {
    if (!cleanup || isBusy()) return;
    closeCleanup({ restoreFocus: false });
    showExport("all");
  });
  listen(elements.CleanupForm, "submit", event => {
    event.preventDefault();
    if (!cleanup || isBusy()) return;
    const pending = cleanup;
    closeCleanup({ restoreFocus: false });
    set(elements.Actions, "open", false);
    elements.ActionsSummary?.focus();
    void invoke(async () => {
      if (pending.kind === "clear") await onClear();
      else if (items().some(item => item.id === pending.id)) await onRemove(pending.id);
      if (!disposed && items().length === 0) (state.expanded ? elements.AddImages : elements.DrawerToggle)?.focus();
    });
  });
  listen(elements.Retry, "click", () => { if (!isBusy() && !state.saving) void invoke(onRetry); });
  listen(elements.ExportCancel, "click", closeExport);
  listen(elements.ExportFormat, "change", () => set(elements.ExportCocoNote, "hidden", elements.ExportFormat.value !== "coco"));
  listen(elements.ExportDialog, "cancel", () => elements.Export?.focus());
  listen(elements.ExportForm, "submit", event => {
    event.preventDefault();
    if (isBusy()) return;
    const options = {
      format: elements.ExportFormat.value === "coco" ? "coco" : "llnl",
      scope: elements.ExportScope.value,
      includeImages: Boolean(elements.ExportImages.checked),
      includeMasks: Boolean(elements.ExportMasks.checked),
      includeJson: Boolean(elements.ExportJson.checked),
    };
    const message = !options.includeImages && !options.includeMasks && !options.includeJson
      ? "Choose at least one file type to include."
      : options.scope === "complete" && !items().some(item => item.status === "complete")
        ? "There are no completed images to export."
        : options.scope === "current" && !activeItem() ? "Choose an image to export." : "";
    if (message) {
      set(elements.ExportError, "textContent", message);
      set(elements.ExportError, "hidden", false);
      return;
    }
    closeExport();
    void invoke(onExport, options);
  });

  render();
  return {
    render,
    setStatus,
    dispose() {
      disposed = true;
      for (const remove of listeners) remove();
      rows.clear();
    },
  };
}
