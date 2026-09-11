/** Bind shortcut and pending-image modal controls. */
export function bindFeatureModalEvents({ elements, listen, actions }) {
  listen(elements.openShortcutsButton, "click", actions.openShortcutsModal);
  listen(elements.closeShortcutsButton, "click", actions.closeShortcutsModal);
  listen(elements.shortcutsModal, "click", (event) => {
    if (event.target === elements.shortcutsModal) {
      actions.closeShortcutsModal();
    }
  });
  listen(elements.confirmNewImageLoadButton, "click", actions.confirmPendingImageLoad);
  listen(elements.cancelNewImageLoadButton, "click", actions.cancelPendingImageLoad);
  listen(elements.cancelNewImageLoadTopButton, "click", actions.cancelPendingImageLoad);
  listen(elements.newImageConfirmModal, "click", (event) => {
    if (event.target === elements.newImageConfirmModal) {
      actions.cancelPendingImageLoad();
    }
  });
}
