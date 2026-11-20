/** A batch owns saved documents; the existing editor owns only its active image. */
export function createProjectController({
  store, capture, summarizeDocument, prepareDocument, commitDocument, prepareFile,
  clearDocument = () => {},
  legacyAutosave, canLeave = () => "", canComplete = canLeave, canSave = canLeave,
  onState = () => {}, onBusy = () => {}, onLayout = () => {},
  exportDocuments = async () => {}, createId = () => crypto.randomUUID(),
  setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout, delay = 30000,
  maxDelay = 30000, now = () => Date.now(), initialName = "Image batch",
  yieldToUi = () => new Promise(resolve => setTimeout(resolve, 0)),
}) {
  let project = null;
  let revision = 0;
  let busy = false;
  let expanded = false;
  let initialized = false;
  let available = true;
  let generation = 0;
  let savedGeneration = 0;
  let timer = null;
  let firstUnsavedAt = null;
  let lastChangeAt = null;
  let writing = null;
  let drainRequested = false;
  let savingGeneration = null;
  let pendingForced = null;
  let disposed = false;
  let contentRevision = 0;
  let failure = null;
  let message = "";
  let contentKey = "";
  let importProgress = null;

  const dirty = () => generation !== savedGeneration;
  const clone = value => structuredClone(value);
  function key(entry) {
    const snapshot = entry?.session?.snapshot;
    if (!snapshot) return "";
    const { annotations, imageSize, imageName, calibration, polygonDraft } = snapshot;
    return JSON.stringify({ imageSize, imageName, calibration, polygonDraft,
      annotations: annotations.map(({ editor, ...annotation }) => annotation) });
  }
  function publish() {
    if (disposed) return;
    onState({ project, contentRevision, activeId: project?.activeId, busy, expanded,
      saving: Boolean(writing), error: failure?.message || "", message, importProgress,
      canRetry: Boolean(failure && failure.name !== "ProjectConflictError"), dirty: dirty() });
  }
  function cancelTimer() { if (timer !== null) clearTimeoutFn(timer); timer = null; }
  function schedule() {
    cancelTimer();
    if (project?.activeId && dirty() && !disposed && !busy && !writing && !failure && !canSave()) {
      const timestamp = now();
      firstUnsavedAt ??= timestamp;
      lastChangeAt ??= timestamp;
      const remaining = Math.max(0, Math.min(lastChangeAt + delay, firstUnsavedAt + maxDelay) - timestamp);
      timer = setTimeoutFn(() => { timer = null; void save(false); }, remaining);
    }
  }
  function fail(error) {
    failure = error instanceof Error ? error : new Error(String(error));
    message = failure.name === "ProjectConflictError"
      ? "Another tab changed this batch. Export your current image before reloading."
      : "Batch changes could not be saved. Your current image is still open. Retry saving before switching.";
    cancelTimer(); publish(); return false;
  }
  function captured() {
    const entry = capture();
    if (!entry?.session?.image) throw new Error("Load an image before adding it to a batch.");
    return { ...entry, id: project?.activeId || entry.id || createId() };
  }
  function updateSummary({ name, annotationCount, hasDraft }, reopen = false) {
    const item = project.items.find(item => item.id === project.activeId);
    let status = item.status;
    if (reopen || (status === "not-started" && (annotationCount || hasDraft))) status = "in-progress";
    if (item.name === name && item.annotationCount === annotationCount && item.status === status) return false;
    project = { ...project, items: project.items.map(value => value.id === item.id
      ? { ...value, name, annotationCount, status } : value) };
    contentRevision += 1;
    return true;
  }
  function updateItem(entry) {
    const item = project.items.find(item => item.id === entry.id);
    const nextKey = key(entry);
    const changed = updateSummary({ name: entry.session.snapshot.imageName,
      annotationCount: entry.session.snapshot.annotations.length,
      hasDraft: entry.session.snapshot.polygonDraft.currentPolygon.length > 0 },
    item.status === "complete" && nextKey !== contentKey);
    contentKey = nextKey;
    return changed;
  }
  function notifyChange() {
    if (disposed) return;
    if (!project) { legacyAutosave.notifyChange(); return; }
    if (busy || !initialized || !project.activeId) return;
    const wasDirty = dirty();
    generation += 1;
    lastChangeAt = now();
    firstUnsavedAt ??= lastChangeAt;
    let changed;
    try {
      // Only completed images need an immediate content comparison to reopen on edits.
      // Ordinary drawing updates lightweight counts; the full snapshot waits for a save.
      changed = summarizeDocument && project.items.find(item => item.id === project.activeId).status !== "complete"
        ? updateSummary(summarizeDocument()) : updateItem(captured());
    } catch (error) { fail(error); return; }
    const previousMessage = message;
    if (!failure && !writing) message = "Unsaved";
    if (!wasDirty || changed || message !== previousMessage) publish();
    schedule();
  }
  function captureSave() {
    const entry = captured();
    updateItem(entry);
    const checkpoint = { entry, project: clone(project), generation };
    firstUnsavedAt = null;
    lastChangeAt = null;
    return checkpoint;
  }
  // Explicit flushes capture synchronously, even during an earlier write/pagehide.
  function save(force) {
    if (disposed) return Promise.resolve(false);
    if (!project) return legacyAutosave.flush();
    cancelTimer();
    if (!project.activeId) return Promise.resolve(!failure && available);
    if (writing) {
      drainRequested ||= force;
      if (force && !failure && !canSave() && generation !== savingGeneration && generation !== pendingForced?.generation) {
        try { pendingForced = captureSave(); } catch (error) { fail(error); }
      }
      return writing;
    }
    if (failure || !available || canSave()) return Promise.resolve(false);
    if (!dirty()) return Promise.resolve(true);
    let first;
    try { first = captureSave(); } catch (error) { return Promise.resolve(fail(error)); }
    drainRequested = force;
    writing = (async () => {
      let checkpoint = first;
      while (true) {
        savingGeneration = checkpoint.generation;
        message = "Saving…";
        revision = await store.write(checkpoint.project, revision, [checkpoint.entry]);
        if (disposed) return false;
        savedGeneration = checkpoint.generation;
        if (failure) return false;
        if (!dirty()) break;
        if (!drainRequested) { message = "Unsaved"; return false; }
        if (pendingForced) {
          checkpoint = pendingForced;
          pendingForced = null;
        } else {
          if (canSave()) { message = "Unsaved"; return false; }
          checkpoint = captureSave();
        }
      }
      message = "Saved";
      return true;
    })().catch(fail).finally(() => {
      writing = null; savingGeneration = null; pendingForced = null; drainRequested = false;
      publish(); schedule();
    });
    publish();
    return writing;
  }
  function flush() { return save(true); }
  async function saveBeforeLeaving() {
    const reason = canLeave();
    if (reason) throw new Error(reason);
    if (project) {
      // Include the latest timer checkpoint and viewport-dependent export metadata.
      if (project.activeId) generation += 1;
      if (!await flush()) throw failure || new Error("Wait for the current image to be saved before switching.");
    } else {
      await legacyAutosave.flush();
      if (legacyAutosave.hasUnsavedChanges) throw new Error("Save the current session successfully before starting a batch.");
    }
  }
  async function exclusive(operation) {
    if (busy || !initialized) return false;
    const reason = canLeave();
    if (reason) { message = reason; publish(); return false; }
    busy = true; onBusy(true); publish();
    try { return await operation(); }
    catch (error) {
      if (error?.name === "ProjectConflictError") return fail(error);
      const detail = error instanceof Error ? error.message || error.name || "Unknown error" : String(error);
      message = importProgress?.phase === "saving" ? `Could not save the image batch. ${detail}` : detail;
      publish(); return false;
    } finally { importProgress = null; busy = false; onBusy(false); publish(); schedule(); }
  }
  function adopt(next, entry, prepared) {
    project = next;
    contentRevision += 1;
    publish();
    commitDocument(prepared, entry);
    contentKey = key(entry);
    savedGeneration = generation;
    firstUnsavedAt = null;
    lastChangeAt = null;
    failure = null;
    message = "Saved";
  }
  function adoptClosed(next) {
    project = next;
    contentRevision += 1;
    publish();
    clearDocument();
    contentKey = "";
    savedGeneration = generation;
    firstUnsavedAt = null;
    lastChangeAt = null;
    failure = null;
    cancelTimer();
  }
  async function initialize() {
    try {
      const saved = await store.read();
      revision = saved.revision;
      if (saved.value) {
        if (saved.value.activeId) {
          const entry = await store.readDocument(saved.value.activeId);
          const prepared = await prepareDocument(entry);
          adopt(saved.value, entry, prepared);
          message = "Batch restored. Changes are saved automatically in the project folder.";
        } else {
          adoptClosed(saved.value);
          message = saved.value.items.length ? "Batch restored. Choose an image to continue." : "The batch is empty. Add images to begin.";
        }
      }
    } catch (error) {
      available = false;
      message = "The saved batch could not be opened. Your existing session has been kept. " + error.message;
    } finally { initialized = true; publish(); }
  }
  function addFiles(files, prepare = prepareFile) {
    const selected = Array.from(files || []);
    if (!selected.length) return Promise.resolve(false);
    return exclusive(async () => {
      if (!available) throw new Error("Batch storage is unavailable. Reload before creating a batch.");
      await saveBeforeLeaving();
      const reportProgress = async progress => {
        importProgress = progress;
        message = progress.phase === "preparing" ? "Preparing images…"
          : progress.phase === "opening" ? "Preparing the first image…"
            : progress.phase === "checking" ? "Checking image files…" : "Saving image batch…";
        publish();
        // Let the browser paint the new count before decoding or checking another image.
        await yieldToUi();
      };
      const additions = [];
      let target = null;
      for (const file of selected) {
        await reportProgress({ phase: "preparing", completed: additions.length, total: selected.length, fileName: file.name || "Unnamed image" });
        let entry;
        try {
          entry = { ...await prepare(file), id: createId() };
          target ||= entry;
          // Local disk storage stages one original at a time; only the first image
          // keeps its Blob for the editor. The queue still publishes atomically.
          additions.push(store.stageDocument ? await store.stageDocument(entry) : entry);
        }
        catch (error) {
          const failure = new Error(`Could not prepare “${file.name || "Unnamed image"}”. ${error?.message || String(error)}`, { cause: error });
          failure.name = error?.name || "Error";
          throw failure;
        }
        await reportProgress({ phase: "preparing", completed: additions.length, total: selected.length, fileName: file.name || "Unnamed image" });
      }
      const previous = !project ? capture() : null;
      const documents = previous?.session?.image
        ? [{ ...previous, id: createId() }, ...additions] : additions;
      const fileName = target.session.image.fileName;
      await reportProgress({ phase: "opening", completed: 0, total: 1, fileName });
      let prepared;
      try { prepared = await prepareDocument(target); }
      catch (error) {
        const failure = new Error(`Could not open “${fileName}”. ${error?.message || String(error)}`, { cause: error });
        failure.name = error?.name || "Error";
        throw failure;
      }
      const next = project ? clone(project) : { version: 1, id: createId(), name: initialName, activeId: target.id, items: [] };
      for (const entry of documents) {
        next.items.push({ id: entry.id, name: entry.session.snapshot.imageName,
          status: entry.session.snapshot.annotations.length || entry.session.snapshot.polygonDraft.currentPolygon.length
            ? "in-progress" : "not-started", annotationCount: entry.session.snapshot.annotations.length,
          ...(entry.thumbnailUrl ? { thumbnailUrl: entry.thumbnailUrl } : {}) });
      }
      next.activeId = target.id;
      revision = await store.write(next, revision, documents, { onProgress: reportProgress });
      importProgress = null;
      adopt(next, target, prepared);
      return true;
    });
  }
  function select(id) {
    if (!project || id === project.activeId || !project.items.some(item => item.id === id)) return Promise.resolve(false);
    return exclusive(async () => {
      await saveBeforeLeaving();
      message = "Opening image…"; publish();
      const entry = await store.readDocument(id);
      const prepared = await prepareDocument(entry);
      const next = { ...clone(project), activeId: id };
      revision = await store.write(next, revision);
      adopt(next, entry, prepared);
      return true;
    });
  }
  function complete(id, value) {
    if (!project?.activeId || id !== project.activeId) return Promise.resolve(false);
    return exclusive(async () => {
      const reason = canComplete();
      if (reason) throw new Error(reason);
      await saveBeforeLeaving();
      const next = clone(project);
      next.items.find(item => item.id === id).status = value ? "complete" : "in-progress";
      revision = await store.write(next, revision);
      project = next; contentRevision += 1; message = value ? "Image marked complete." : "Image reopened for annotation.";
      return true;
    });
  }
  function closeCurrent() {
    if (!project?.activeId) return Promise.resolve(false);
    return exclusive(async () => {
      await saveBeforeLeaving();
      const next = { ...clone(project), activeId: null };
      revision = await store.write(next, revision);
      adoptClosed(next);
      message = "Image closed. Choose it in the drawer to continue annotating.";
      return true;
    });
  }
  function remove(id) {
    if (!project?.items.some(item => item.id === id)) return Promise.resolve(false);
    return exclusive(async () => {
      await saveBeforeLeaving();
      const closesCurrent = project.activeId === id;
      const next = { ...clone(project), items: project.items.filter(item => item.id !== id),
        activeId: closesCurrent ? null : project.activeId };
      revision = await store.write(next, revision);
      if (closesCurrent) adoptClosed(next);
      else { project = next; contentRevision += 1; }
      message = "Image removed from the batch.";
      return true;
    });
  }
  function clearBatch() {
    if (!project?.items.length) return Promise.resolve(false);
    return exclusive(async () => {
      await saveBeforeLeaving();
      const next = { ...clone(project), activeId: null, items: [] };
      revision = await store.write(next, revision);
      adoptClosed(next);
      message = "Batch cleared. Add images to begin.";
      return true;
    });
  }
  function rename(name) {
    const trimmed = String(name || "").trim().slice(0, 120);
    if (!project || !trimmed || trimmed === project.name) return Promise.resolve(false);
    return exclusive(async () => {
      await saveBeforeLeaving();
      const next = { ...clone(project), name: trimmed };
      revision = await store.write(next, revision);
      project = next; contentRevision += 1; message = "Batch name saved."; return true;
    });
  }
  function exportBatch(options) {
    return exclusive(async () => {
      if (!project) return false;
      await saveBeforeLeaving();
      const items = project.items.filter(item => options.scope === "current" ? item.id === project.activeId
        : options.scope === "complete" ? item.status === "complete" : true);
      if (!items.length) throw new Error("There are no images in this export selection.");
      message = "Preparing batch export…"; publish();
      const documents = [];
      for (const item of items) documents.push(await store.readDocument(item.id));
      await exportDocuments({ ...options, project: clone(project), documents });
      message = "Saved"; return true;
    });
  }
  return {
    initialize, addFiles, select, complete, rename, exportBatch, closeCurrent, remove, clearBatch, notifyChange, flush,
    prepareToLeave: () => exclusive(async () => { await saveBeforeLeaving(); return true; }),
    retry() {
      if (!project) return legacyAutosave.retry();
      if (failure?.name === "ProjectConflictError") return Promise.resolve(false);
      failure = null; return flush();
    },
    toggle(value = !expanded) {
      if (busy) return;
      expanded = Boolean(value); publish(); onLayout();
    },
    get active() { return Boolean(project); },
    get busy() { return busy; },
    get hasUnsavedChanges() { return project ? dirty() : legacyAutosave.hasUnsavedChanges; },
    get project() { return project; },
    dispose() { if (disposed) return; disposed = true; cancelTimer(); store.close(); },
  };
}
