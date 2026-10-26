const ACTIVE_CLASS_KEY = "segmentation-annotator-active-class";

/** Class choices and batch targets are UI preferences, separate from document history. */
export function createClassWorkflow({
  annotationState,
  interactionState,
  imageState,
  getCatalog,
  getCatalogError = () => "",
  isLabelEditorOpen = () => false,
  getStorage = () => globalThis.localStorage,
}) {
  let activeChoice = null;
  let documentAnnotations = annotationState.annotations;
  const checkedIds = new Set();
  try {
    const saved = JSON.parse(getStorage()?.getItem(ACTIVE_CLASS_KEY) || "null");
    if (saved?.version === 1 && Number.isSafeInteger(saved.id) && saved.id >= 0
      && typeof saved.name === "string" && saved.name.trim() === saved.name && saved.name
      && Object.keys(saved).every(key => ["version", "id", "name"].includes(key))) {
      activeChoice = { id: saved.id, name: saved.name };
    }
  } catch { /* An unavailable preference store must not prevent annotation. */ }

  function saveChoice() {
    try {
      const storage = getStorage();
      if (activeChoice) storage?.setItem(ACTIVE_CLASS_KEY, JSON.stringify({ version: 1, ...activeChoice }));
      else storage?.removeItem(ACTIVE_CLASS_KEY);
    } catch { /* The current choice still works when preferences cannot be saved. */ }
  }

  function isClassAvailable(choice) {
    if (!choice || getCatalogError()) return false;
    const catalog = getCatalog();
    return Boolean(catalog?.enabled && catalog.classes.some(entry =>
      entry.id === choice.id && entry.name === choice.name));
  }

  function getActiveClass() {
    // A loading/stale catalog suspends the choice until its definitions are known.
    if (getCatalogError()) return null;
    if (activeChoice && !isClassAvailable(activeChoice)) {
      activeChoice = null;
      saveChoice();
    }
    return activeChoice ? { ...activeChoice } : null;
  }

  function chooseClass(id) {
    if (getCatalogError()) return false;
    const catalog = getCatalog();
    if (!catalog?.enabled) return false;
    const entry = id === null ? null : catalog.classes.find(value => value.id === id);
    if (id !== null && !entry) return false;
    activeChoice = entry ? { id: entry.id, name: entry.name } : null;
    saveChoice();
    return true;
  }

  function synchronizeChecks() {
    if (documentAnnotations !== annotationState.annotations) {
      documentAnnotations = annotationState.annotations;
      checkedIds.clear();
    }
    if (!getCatalogError() && !getCatalog()?.enabled) checkedIds.clear();
    if (checkedIds.size) {
      const present = new Set(annotationState.annotations.map(annotation => annotation.id));
      for (const id of checkedIds) if (!present.has(id)) checkedIds.delete(id);
    }
  }

  function toggleChecked(id, checked) {
    synchronizeChecks();
    if (getCatalogError() || !getCatalog()?.enabled) return false;
    if (!annotationState.annotations.some(annotation => annotation.id === id)) return false;
    if (checked) checkedIds.add(id);
    else checkedIds.delete(id);
    return true;
  }

  function getTargetIds() {
    synchronizeChecks();
    if (checkedIds.size) return [...checkedIds];
    const selected = interactionState.selectedAnnotationId;
    return selected && annotationState.annotations.some(annotation => annotation.id === selected) ? [selected] : [];
  }

  function getAssignmentBlock() {
    if (imageState.imageLoadStatus === "loading") return "Wait for the image to finish loading.";
    if (isLabelEditorOpen()) return "Finish naming the current shape first.";
    if (interactionState.isDrawing && (interactionState.activeVertex || interactionState.activeAnnotationDrag)) {
      return "Finish dragging the shape first.";
    }
    return "";
  }

  function getView() {
    const activeClass = getActiveClass();
    const catalog = getCatalog();
    const enabled = Boolean(!getCatalogError() && catalog?.enabled);
    if (!enabled) {
      synchronizeChecks();
      return { enabled: false, classes: [], activeClass: null, checkedIds: new Set(),
        canAssign: false, canAssignTargets: false, assignmentMessage: "" };
    }
    const targets = getTargetIds();
    const blocked = getAssignmentBlock();
    const message = blocked || (!activeClass ? "Choose a class for new shapes."
      : !targets.length ? "Select a shape, or check shapes to assign together." : "");
    return {
      enabled,
      classes: enabled ? catalog.classes : [],
      activeClass,
      checkedIds: new Set(checkedIds),
      canAssign: enabled && Boolean(activeClass) && targets.length > 0 && !blocked,
      canAssignTargets: targets.length > 0 && !blocked,
      assignmentMessage: blocked,
      message,
    };
  }

  return Object.freeze({
    getActiveClass, isClassAvailable, chooseClass, toggleChecked, getTargetIds, getView,
    clearChecked: () => checkedIds.clear(),
    canAssignClass: () => !getAssignmentBlock(),
  });
}
