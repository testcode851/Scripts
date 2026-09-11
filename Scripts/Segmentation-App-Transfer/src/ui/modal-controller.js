function createElementGuard(documentRoot) {
  const HTMLElementType = documentRoot?.defaultView?.HTMLElement;
  return (value) => typeof HTMLElementType === "function" && value instanceof HTMLElementType;
}

/** Own modal visibility, pending image confirmation, focus restoration, and focus traps. */
export function createModalController({ documentRoot, elements }) {
  const {
    shortcutsModal,
    closeShortcutsButton,
    newImageConfirmModal,
    confirmNewImageLoadButton,
  } = elements;
  const isHTMLElement = createElementGuard(documentRoot);
  let pendingImageFile = null;
  let lastFocusedBeforeShortcuts = null;
  let lastFocusedBeforeNewImage = null;

  const isOpen = (modal) => Boolean(modal && !modal.hasAttribute("hidden"));
  const isNewImageConfirmOpen = () => isOpen(newImageConfirmModal);
  const isShortcutsOpen = () => isOpen(shortcutsModal);

  function openNewImageConfirm(file) {
    if (!newImageConfirmModal) {
      return false;
    }
    pendingImageFile = file;
    if (isHTMLElement(documentRoot.activeElement)) {
      lastFocusedBeforeNewImage = documentRoot.activeElement;
    }
    newImageConfirmModal.removeAttribute("hidden");
    newImageConfirmModal.setAttribute("aria-hidden", "false");
    documentRoot.body.classList.add("modal-open");
    confirmNewImageLoadButton?.focus();
    return true;
  }

  function closeNewImageConfirm() {
    if (!newImageConfirmModal || !isNewImageConfirmOpen()) {
      pendingImageFile = null;
      return;
    }
    newImageConfirmModal.setAttribute("hidden", "");
    newImageConfirmModal.setAttribute("aria-hidden", "true");
    if (!isShortcutsOpen()) {
      documentRoot.body.classList.remove("modal-open");
    }
    pendingImageFile = null;
    if (isHTMLElement(lastFocusedBeforeNewImage)) {
      lastFocusedBeforeNewImage.focus();
    }
  }

  function openShortcuts() {
    if (!shortcutsModal || isShortcutsOpen()) {
      return;
    }
    if (isHTMLElement(documentRoot.activeElement)) {
      lastFocusedBeforeShortcuts = documentRoot.activeElement;
    }
    shortcutsModal.removeAttribute("hidden");
    shortcutsModal.setAttribute("aria-hidden", "false");
    documentRoot.body.classList.add("modal-open");
    closeShortcutsButton?.focus();
  }

  function closeShortcuts() {
    if (!shortcutsModal || !isShortcutsOpen()) {
      return;
    }
    shortcutsModal.setAttribute("hidden", "");
    shortcutsModal.setAttribute("aria-hidden", "true");
    documentRoot.body.classList.remove("modal-open");
    if (isHTMLElement(lastFocusedBeforeShortcuts)) {
      lastFocusedBeforeShortcuts.focus();
    }
  }

  function handleTab(event, modal) {
    if (!modal) return;
    const focusable = Array.from(
      modal.querySelectorAll(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
      )
    ).filter((element) => isHTMLElement(element) && !element.hasAttribute("disabled"));
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = documentRoot.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return Object.freeze({
    isNewImageConfirmOpen,
    openNewImageConfirm,
    closeNewImageConfirm,
    getPendingImageFile: () => pendingImageFile,
    isShortcutsOpen,
    openShortcuts,
    closeShortcuts,
    handleNewImageTab: (event) => handleTab(event, newImageConfirmModal),
    handleShortcutsTab: (event) => handleTab(event, shortcutsModal),
  });
}
