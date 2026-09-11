import { bindFeatureFileEvents } from "./feature-file-events.js";
import { bindFeatureModalEvents } from "./feature-modal-events.js";
import { bindFeatureSelectionEvents } from "./feature-selection-events.js";
import { bindFeatureSettingsEvents } from "./feature-settings-events.js";
import { bindFeatureTimerEvents } from "./feature-timer-events.js";
import { bindFeatureWindowEvents } from "./feature-window-events.js";
import { createListenerLifecycle } from "../utils/listener-lifecycle.js";

/**
 * Compose feature-level DOM event binders behind one lifecycle facade.
 */
export function createFeatureController(options) {
  const {
    elements = {},
    windowRoot = globalThis.window,
    FileReaderType = globalThis.FileReader,
    alertFn = globalThis.alert,
    settingsState,
    actions,
  } = options;
  const listenerLifecycle = createListenerLifecycle();
  const shared = {
    elements,
    listen: listenerLifecycle.listen,
    actions,
  };
  function bind() {
    if (listenerLifecycle.hasListeners()) return controller;
    bindFeatureFileEvents({ ...shared, FileReaderType, alertFn });
    bindFeatureTimerEvents(shared);
    bindFeatureSettingsEvents({ ...shared, settingsState });
    bindFeatureWindowEvents({ ...shared, windowRoot });
    bindFeatureModalEvents(shared);
    bindFeatureSelectionEvents({ ...shared, alertFn });
    return controller;
  }

  function destroy() {
    listenerLifecycle.clear();
  }

  const controller = { bind, destroy };
  return controller;
}
