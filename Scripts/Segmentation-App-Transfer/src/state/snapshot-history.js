export function createSnapshotHistory({ capture, restore, maxEntries = 50, onRestore = () => {}, canRestore = () => true }) {
  if (typeof capture !== "function" || typeof restore !== "function") {
    throw new TypeError("History requires capture and restore functions.");
  }

  const undoStack = [];
  const redoStack = [];
  let transactionDepth = 0;

  function recordSnapshot(snapshot) {
    undoStack.push(snapshot);
    if (undoStack.length > maxEntries) undoStack.shift();
    redoStack.length = 0;
  }

  return {
    record(snapshot = capture()) {
      recordSnapshot(snapshot);
    },
    transaction(mutate, options = {}) {
      if (typeof mutate !== "function") {
        throw new TypeError("A history transaction requires a mutation function.");
      }
      if (transactionDepth > 0) {
        return mutate();
      }
      const checkpoint = capture();
      transactionDepth += 1;
      try {
        const result = mutate();
        if (result === false) {
          restore(checkpoint);
          onRestore();
          return false;
        }
        if (options.record !== false) {
          recordSnapshot(checkpoint);
        }
        return result;
      } catch (error) {
        restore(checkpoint);
        onRestore();
        throw error;
      } finally {
        transactionDepth -= 1;
      }
    },
    undo() {
      if (!canRestore() || undoStack.length === 0) return false;
      redoStack.push(capture());
      restore(undoStack.pop());
      onRestore();
      return true;
    },
    redo() {
      if (!canRestore() || redoStack.length === 0) return false;
      undoStack.push(capture());
      restore(redoStack.pop());
      onRestore();
      return true;
    },
    clear() {
      undoStack.length = 0;
      redoStack.length = 0;
    },
    discardLatest() {
      if (undoStack.length === 0) return false;
      undoStack.pop();
      return true;
    },
    get canUndo() {
      return canRestore() && undoStack.length > 0;
    },
    get canRedo() {
      return canRestore() && redoStack.length > 0;
    },
    get undoDepth() {
      return undoStack.length;
    },
    get redoDepth() {
      return redoStack.length;
    },
  };
}
