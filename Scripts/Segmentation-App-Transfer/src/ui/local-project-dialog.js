/** Local project selection UI; the caller saves and opens project documents. */
export function createLocalProjectDialog({
  documentRoot = document,
  onCreate = async () => {},
  onOpen = async () => {},
  onBrowse = async () => null,
  canChange = () => "",
} = {}) {
  const ids = ["Manage", "Name", "Folder", "Dialog", "OpenFolder", "BrowseOpen",
    "NewName", "Location", "BrowseLocation", "Destination", "CreateForm", "Create",
    "Open", "Cancel", "Error", "Status"];
  const elements = Object.fromEntries(ids.map(id => [id, documentRoot.getElementById(`localProject${id}`)]));
  const listeners = [];
  let working = false;
  let externalBusy = false;
  let disposed = false;
  let generation = 0;
  let previousFocus = null;

  function listen(element, type, handler) {
    if (!element) return;
    element.addEventListener(type, handler);
    listeners.push(() => element.removeEventListener(type, handler));
  }

  function error(message = "") {
    if (!elements.Error) return;
    elements.Error.textContent = String(message);
    elements.Error.hidden = !message;
  }

  function destination() {
    const name = elements.NewName?.value.trim();
    let location = elements.Location?.value.trim();
    if (!name || !location) return "";
    const windowsPath = /^[A-Za-z]:[\\/]/.test(location) || location.includes("\\");
    if (windowsPath) location = location.replaceAll("/", "\\");
    return `${location.replace(/[\\/]+$/, "")}${windowsPath ? "\\" : "/"}${name}`;
  }

  function controls() {
    const busy = working || externalBusy;
    for (const id of ["OpenFolder", "NewName", "Location", "BrowseOpen", "BrowseLocation"]) {
      if (elements[id]) elements[id].disabled = busy;
    }
    if (elements.Create) elements.Create.disabled = busy || !elements.NewName?.value.trim() || !elements.Location?.value.trim();
    if (elements.Open) elements.Open.disabled = busy || !elements.OpenFolder?.value.trim();
    if (elements.Cancel) elements.Cancel.disabled = working;
    if (elements.Manage) elements.Manage.disabled = externalBusy;
    if (elements.Destination) {
      elements.Destination.textContent = destination();
      elements.Destination.hidden = !elements.Destination.textContent;
    }
    elements.Dialog?.setAttribute("aria-busy", String(working));
  }

  function close() {
    if (working || !elements.Dialog?.open) return;
    generation++;
    elements.Dialog.close();
    previousFocus?.focus?.();
  }

  function open() {
    if (disposed || !elements.Dialog || elements.Dialog.open || externalBusy) return;
    previousFocus = documentRoot.activeElement;
    for (const id of ["NewName", "Location", "OpenFolder"]) if (elements[id]) elements[id].value = "";
    error();
    elements.Status.textContent = "";
    elements.Dialog.showModal();
    generation++;
    controls();
    const reason = canChange();
    if (reason) error(reason);
    elements.OpenFolder?.focus();
  }

  async function browse(purpose, field) {
    if (disposed || working || externalBusy || !elements.Dialog?.open) return;
    const request = ++generation;
    working = true;
    error();
    elements.Status.textContent = "Choose a folder…";
    controls();
    try {
      const folder = await onBrowse(purpose);
      if (disposed || request !== generation) return;
      if (typeof folder === "string" && folder) elements[field].value = folder;
    } catch (failure) {
      if (!disposed && request === generation) {
        error(failure?.message || "The folder browser is unavailable. Enter a folder path instead.");
      }
    } finally {
      if (!disposed && request === generation) {
        working = false;
        elements.Status.textContent = "";
        controls();
        elements[field]?.focus();
      }
    }
  }

  async function change(callback, value) {
    if (disposed || working || externalBusy || !elements.Dialog?.open) return;
    const reason = canChange();
    if (reason) { error(reason); return; }
    working = true;
    error();
    elements.Status.textContent = "Opening project…";
    controls();
    try {
      await callback(value);
      if (disposed) return;
      working = false;
      close();
    } catch (failure) {
      if (!disposed) error(failure?.message || "The project could not be opened. Your current work is unchanged.");
    } finally {
      if (!disposed) {
        working = false;
        elements.Status.textContent = "";
        controls();
      }
    }
  }

  listen(elements.CreateForm, "submit", event => {
    event.preventDefault();
    const name = elements.NewName?.value.trim();
    const location = elements.Location?.value.trim();
    if (name && location) void change(onCreate, { name, location });
  });
  for (const id of ["NewName", "Location", "OpenFolder"]) listen(elements[id], "input", controls);
  listen(elements.BrowseLocation, "click", () => { void browse("create", "Location"); });
  listen(elements.BrowseOpen, "click", () => { void browse("open", "OpenFolder"); });
  listen(elements.Open, "click", () => {
    const folder = elements.OpenFolder?.value.trim();
    if (folder) void change(onOpen, folder);
  });
  listen(elements.Cancel, "click", close);
  listen(elements.Dialog, "cancel", event => { event.preventDefault(); close(); });

  function render({ name = "No project open", folder = "", busy = false } = {}) {
    if (disposed) return;
    if (elements.Name) elements.Name.textContent = name;
    if (elements.Folder) {
      elements.Folder.textContent = folder;
      elements.Folder.hidden = !folder;
      elements.Folder.title = folder;
    }
    externalBusy = Boolean(busy);
    controls();
  }

  render();
  return {
    open,
    render,
    isOpen: () => Boolean(elements.Dialog?.open),
    dispose() {
      disposed = true;
      generation++;
      for (const remove of listeners) remove();
      if (elements.Dialog?.open) elements.Dialog.close();
    },
  };
}
