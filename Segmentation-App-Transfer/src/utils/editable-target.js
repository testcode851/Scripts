export function isEditableTarget(target, windowRoot = globalThis.window) {
  return Boolean(
    target instanceof windowRoot.HTMLInputElement ||
      target instanceof windowRoot.HTMLTextAreaElement ||
      target instanceof windowRoot.HTMLSelectElement ||
      target instanceof windowRoot.HTMLButtonElement ||
      target?.isContentEditable
  );
}
