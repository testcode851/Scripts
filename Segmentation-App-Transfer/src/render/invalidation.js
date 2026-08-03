export function createRenderInvalidation() {
  const keys = new Map();
  return {
    hasChanged(channel, nextKey) {
      if (keys.get(channel) === nextKey) return false;
      keys.set(channel, nextKey);
      return true;
    },
    invalidate(channel) {
      keys.delete(channel);
    },
    invalidateAll() {
      keys.clear();
    },
  };
}
