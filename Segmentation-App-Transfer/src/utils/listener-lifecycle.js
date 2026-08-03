/**
 * Tracks DOM event listeners so an owning controller can remove them together.
 */
export function createListenerLifecycle() {
  const removers = [];

  function listen(target, type, handler, options) {
    if (!target) return false;
    target.addEventListener(type, handler, options);
    removers.push(() => target.removeEventListener(type, handler, options));
    return true;
  }

  function clear() {
    removers.splice(0).forEach((remove) => remove());
  }

  function hasListeners() {
    return removers.length > 0;
  }

  return {
    listen,
    clear,
    hasListeners,
  };
}
