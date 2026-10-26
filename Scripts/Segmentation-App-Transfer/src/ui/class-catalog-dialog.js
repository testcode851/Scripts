import {
  emptyClassCatalog,
  normalizeClassCatalog,
  parseClassCatalogFile,
  exportClassCatalogFile,
} from "../model/class-catalog.js";

export function createClassCatalogDialog({
  documentRoot = document,
  getCatalog = emptyClassCatalog,
  getStatus = () => "",
  applyCatalog,
  reloadCatalog,
} = {}) {
  const find = (id) => documentRoot.querySelector(`#${id}`);
  const dialog = find("classCatalogDialog");
  const enabled = find("classCatalogEnabled");
  const rows = find("classCatalogRows");
  const count = find("classCatalogCount");
  const idInput = find("classCatalogId");
  const nameInput = find("classCatalogName");
  const supercategoryInput = find("classCatalogSupercategory");
  const addButton = find("classCatalogAdd");
  const importInput = find("classCatalogImport");
  const importButton = find("classCatalogImportButton");
  const exportButton = find("classCatalogExport");
  const reloadButton = find("classCatalogReload");
  const status = find("classCatalogStatus");
  const error = find("classCatalogError");
  const cancelButton = find("classCatalogCancel");
  const applyButton = find("classCatalogApply");
  const ownerDocument = dialog.ownerDocument;
  const ownerWindow = ownerDocument.defaultView;
  let staged = emptyClassCatalog();
  let generation = 0;
  let busy = "";
  let trigger = null;

  function showError(message = "") {
    error.textContent = message;
    error.hidden = !message;
  }

  function refreshStatus() {
    status.textContent = getStatus() || "";
    status.hidden = !status.textContent;
  }

  function setBusy(value) {
    busy = value;
    for (const control of dialog.querySelectorAll("button, input")) {
      control.disabled = Boolean(value);
    }
    cancelButton.disabled = value === "saving";
    reloadButton.disabled = Boolean(value) || typeof reloadCatalog !== "function";
    applyButton.textContent = value === "saving" ? "Saving…" : "Apply";
    dialog.setAttribute("aria-busy", String(Boolean(value)));
  }

  function nextId() {
    const used = new Set(staged.classes.map((entry) => entry.id));
    let candidate = 1;
    while (used.has(candidate)) candidate += 1;
    return candidate;
  }

  function render() {
    enabled.checked = staged.enabled;
    count.textContent = `${staged.classes.length} ${staged.classes.length === 1 ? "class" : "classes"}`;
    rows.replaceChildren();
    for (const entry of staged.classes) {
      const row = ownerDocument.createElement("tr");
      row.dataset.classId = String(entry.id);
      for (const value of [entry.id, entry.name, entry.supercategory ?? "—"]) {
        const cell = ownerDocument.createElement("td");
        cell.textContent = String(value);
        row.append(cell);
      }
      const actionCell = ownerDocument.createElement("td");
      const removeButton = ownerDocument.createElement("button");
      removeButton.type = "button";
      removeButton.textContent = "Remove";
      removeButton.setAttribute("aria-label", `Remove class ${entry.name}`);
      removeButton.addEventListener("click", () => {
        if (busy || !dialog.open) return;
        staged = { ...staged, classes: staged.classes.filter((item) => item.id !== entry.id) };
        showError();
        render();
      });
      actionCell.append(removeButton);
      row.append(actionCell);
      rows.append(row);
    }
    if (staged.classes.length === 0) {
      const row = ownerDocument.createElement("tr");
      const cell = ownerDocument.createElement("td");
      cell.colSpan = 4;
      cell.className = "class-catalog-empty";
      cell.textContent = "No classes yet. Add a class or import a catalog.";
      row.append(cell);
      rows.append(row);
    }
    idInput.value = String(nextId());
    setBusy(busy);
  }

  function close() {
    if (busy === "saving") return false;
    generation += 1;
    setBusy("");
    if (dialog.open) dialog.close();
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    trigger = null;
    return true;
  }

  function open() {
    if (busy === "saving") return false;
    if (dialog.open) close();
    generation += 1;
    trigger = ownerDocument.activeElement;
    staged = normalizeClassCatalog(getCatalog());
    nameInput.value = "";
    supercategoryInput.value = "";
    importInput.value = "";
    showError();
    refreshStatus();
    setBusy("");
    render();
    dialog.showModal();
    cancelButton.focus({ preventScroll: true });
    return true;
  }

  enabled.addEventListener("change", () => {
    if (!busy) staged = { ...staged, enabled: enabled.checked };
  });

  addButton.addEventListener("click", () => {
    if (busy || !dialog.open) return;
    try {
      const rawId = idInput.value.trim();
      const id = Number(rawId);
      if (rawId === "" || !Number.isSafeInteger(id) || id < 0) {
        throw new Error("Enter a whole-number class ID from 0 to 9007199254740991.");
      }
      const supercategory = supercategoryInput.value.trim();
      const entry = { id, name: nameInput.value };
      if (supercategory) entry.supercategory = supercategory;
      staged = normalizeClassCatalog({ ...staged, classes: [...staged.classes, entry] });
      nameInput.value = "";
      supercategoryInput.value = "";
      showError();
      render();
      nameInput.focus({ preventScroll: true });
    } catch (cause) {
      showError(cause.message || "Unable to add this class.");
    }
  });

  importButton.addEventListener("click", () => {
    if (!busy && dialog.open) importInput.click();
  });

  importInput.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    if (!file || busy || !dialog.open) return;
    const request = generation;
    setBusy("reading");
    showError();
    try {
      const data = JSON.parse(await file.text());
      const imported = parseClassCatalogFile(data);
      if (request !== generation || !dialog.open) return;
      staged = normalizeClassCatalog({ ...staged, enabled: true, classes: imported.classes });
      nameInput.value = "";
      supercategoryInput.value = "";
      render();
    } catch (cause) {
      if (request === generation && dialog.open) {
        showError(cause instanceof SyntaxError ? "This file is not valid JSON." : cause.message || "Unable to import this catalog.");
      }
    } finally {
      if (request === generation && dialog.open) {
        importInput.value = "";
        setBusy("");
      }
    }
  });

  exportButton.addEventListener("click", () => {
    if (busy || !dialog.open) return;
    let url;
    try {
      const payload = exportClassCatalogFile(staged);
      const blob = new ownerWindow.Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      url = ownerWindow.URL.createObjectURL(blob);
      const link = ownerDocument.createElement("a");
      link.href = url;
      link.download = "class-catalog.json";
      ownerDocument.body.append(link);
      link.click();
      link.remove();
      showError();
    } catch (cause) {
      showError(cause.message || "Unable to export this catalog.");
    } finally {
      if (url) ownerWindow.setTimeout(() => ownerWindow.URL.revokeObjectURL(url), 0);
    }
  });

  reloadButton.addEventListener("click", async () => {
    if (busy || !dialog.open || typeof reloadCatalog !== "function") return;
    const request = generation;
    setBusy("reloading");
    showError();
    try {
      const saved = await reloadCatalog();
      if (request !== generation || !dialog.open) return;
      staged = normalizeClassCatalog(saved);
      nameInput.value = "";
      supercategoryInput.value = "";
      render();
      refreshStatus();
    } catch (cause) {
      if (request === generation && dialog.open) {
        showError(cause.message || "Unable to reload the saved catalog.");
        refreshStatus();
      }
    } finally {
      if (request === generation && dialog.open) setBusy("");
    }
  });

  applyButton.addEventListener("click", async () => {
    if (busy || !dialog.open) return;
    const request = generation;
    setBusy("saving");
    showError();
    try {
      await applyCatalog(normalizeClassCatalog(staged));
      if (request !== generation) return;
      setBusy("");
      close();
    } catch (cause) {
      if (request === generation) {
        setBusy("");
        showError(cause.message || "Unable to save this catalog.");
        refreshStatus();
      }
    }
  });

  cancelButton.addEventListener("click", close);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener("close", () => {
    // A delayed close event must not discard a newly opened editing session.
    if (!dialog.open) close();
  });
  for (const type of ["keydown", "keyup"]) {
    dialog.addEventListener(type, (event) => event.stopPropagation());
  }

  return { open, close, isOpen: () => dialog.open };
}
