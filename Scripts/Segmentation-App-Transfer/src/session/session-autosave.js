/** Coordinates recovery and scheduled saves without changing document state. */
export function createSessionAutosave({
  store,
  capture,
  restore,
  canSave = () => true,
  onStatus = () => {},
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
  delay = 30000,
  maxDelay = 30000,
  now = () => Date.now(),
  enabled = true,
}) {
  let initialized = false;
  let initializing = null;
  let disposed = false;
  let revision = null;
  let generation = 0;
  let savedGeneration = 0;
  let timer = null;
  let writing = null;
  let activeEntry = null;
  let pending = null;
  let firstUnsavedAt = null;
  let lastEditAt = null;
  let failure = null;
  let lastStatus = null;

  const dirty = () => generation > savedGeneration;
  function status(state, message, canRetry = false) {
    if (disposed || (lastStatus?.state === state && lastStatus.message === message && lastStatus.canRetry === canRetry)) return;
    lastStatus = { state, message, canRetry };
    onStatus(lastStatus);
  }
  function cancelTimer() {
    if (timer !== null) clearTimeoutFn(timer);
    timer = null;
  }
  function schedule() {
    cancelTimer();
    if (disposed || !initialized || initializing || failure || revision === null || !dirty() || firstUnsavedAt === null || !canSave()) return;
    const due = Math.min(lastEditAt + delay, firstUnsavedAt + maxDelay);
    timer = setTimeoutFn(() => { timer = null; void flush(); }, Math.max(0, due - now()));
  }
  function unavailable(kind) {
    failure = kind;
    status("unavailable", kind === "restore"
      ? "The saved session could not be restored. Export your work to keep a separate copy."
      : "Autosave is unavailable. Export your work to keep a separate copy, then retry.", true);
  }
  function conflict() {
    failure = "conflict";
    pending = null;
    cancelTimer();
    status("conflict", "Another tab has saved a session. Export your work before reloading to avoid overwriting it.");
  }

  function recover() {
    if (disposed) return Promise.resolve(false);
    if (!enabled) {
      initialized = true;
      status("temporary", "Temporary session. Autosave is off; export your work or create a project to save it.");
      return Promise.resolve(true);
    }
    if (initializing) return initializing;
    cancelTimer();
    status("recovering", "Checking for a saved session…");
    initializing = (async () => {
      let saved;
      try {
        saved = await store.read();
        if (!Number.isSafeInteger(saved?.revision) || saved.revision < 0) throw new Error("Invalid session revision.");
      } catch {
        if (!disposed) {
          revision = null;
          unavailable("read");
        }
        return false;
      }
      if (disposed) return false;
      revision = saved.revision;
      let current;
      try { current = capture(); } catch { unavailable("capture"); return false; }
      // Recovery must never silently replace work created while storage was unavailable.
      if ((current || dirty()) && saved.value) {
        if (!dirty()) generation += 1;
        conflict();
        return false;
      }
      if (saved.value) {
        try { await restore(saved.value); } catch { unavailable("restore"); return false; }
        if (disposed) return false;
        failure = null;
        savedGeneration = generation;
        firstUnsavedAt = null;
        lastEditAt = null;
        status("saved", "Session restored. Changes are saved automatically in the project folder.");
      } else if (current || dirty()) {
        failure = null;
        if (!dirty()) generation += 1;
        firstUnsavedAt ??= now();
        lastEditAt ??= firstUnsavedAt;
        status("dirty", "Unsaved");
      } else {
        failure = null;
        status("idle", "Autosave on");
      }
      return true;
    })().finally(() => {
      initialized = true;
      initializing = null;
      schedule();
    });
    return initializing;
  }

  async function drain() {
    while (pending && !disposed) {
      const entry = pending;
      pending = null;
      activeEntry = entry;
      status("saving", "Saving…");
      try {
        const nextRevision = entry.value === null
          ? await store.clear(revision)
          : await store.write(entry.value, revision);
        if (disposed) return false;
        revision = nextRevision;
      } catch (error) {
        if (!disposed) {
          pending = null;
          if (error?.name === "SessionConflictError") conflict();
          else unavailable("write");
        }
        return false;
      } finally {
        activeEntry = null;
      }
      savedGeneration = Math.max(savedGeneration, entry.generation);
      if (failure) return false;
      if (!dirty()) status("saved", "Saved");
      else if (!pending) status("dirty", "Unsaved");
    }
    return !dirty();
  }

  // Deliberately not async: capture happens before yielding, including pagehide flushes.
  function flush() {
    cancelTimer();
    if (disposed || !initialized || initializing || failure || revision === null || !dirty() || !canSave()) {
      return writing || Promise.resolve(false);
    }
    if (pending?.generation === generation || activeEntry?.generation === generation) return writing;
    let captured;
    try { captured = capture(); } catch { unavailable("capture"); return Promise.resolve(false); }
    pending = { generation, value: captured === null ? null : { ...captured, schemaVersion: 1, savedAt: now() } };
    // Later edits get a new checkpoint window while this snapshot is being written.
    firstUnsavedAt = null;
    lastEditAt = null;
    if (!writing) {
      writing = Promise.resolve().then(drain).finally(() => {
        writing = null;
        schedule();
      });
    }
    return writing;
  }

  return {
    initialize() {
      if (initialized) return Promise.resolve(false);
      return recover();
    },
    notifyChange() {
      if (disposed || !initialized || initializing) return;
      generation += 1;
      if (!enabled) return;
      lastEditAt = now();
      firstUnsavedAt ??= lastEditAt;
      if (failure === "restore") failure = null;
      if (!failure) status("dirty", "Unsaved");
      schedule();
    },
    flush,
    retry() {
      if (disposed || failure === "conflict") return Promise.resolve(false);
      if (revision === null || failure === "read" || failure === "restore") return recover();
      failure = null;
      return flush();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelTimer();
      pending = null;
      store.close();
    },
    get hasUnsavedChanges() { return dirty(); },
  };
}
