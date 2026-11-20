import { DEFAULT_SETTINGS, SNAP_PRESETS } from "../config/settings.js";

/** Bind settings, adjustment ranges, presets, and output-format controls. */
export function bindFeatureSettingsEvents({
  elements,
  listen,
  settingsState,
  actions,
}) {
  function bindPositiveNumber(input, settingName, { allowZero = false, minimum = 0 } = {}) {
    listen(input, "change", (event) => {
      const value = Number(event.target.value);
      const valid = Number.isFinite(value) && (allowZero ? value >= minimum : value > minimum);
      if (valid) {
        actions.applySettings({ [settingName]: value });
      }
    });
  }

  function bindRangeInput(input, settingName, { display = false } = {}) {
    const handleUpdate = (event) => {
      const value = Number(event.target.value);
      if (!Number.isFinite(value)) return;
      if (display) {
        if (value !== settingsState[settingName]) actions.applySettings({ [settingName]: value });
        return;
      }
      settingsState[settingName] = value;
      actions.syncAdjustmentLabels();
      actions.redraw();
    };
    listen(input, "input", handleUpdate);
    listen(input, "change", handleUpdate);
  }

  function bindWindowLevel(input, settingName) {
    listen(input, "change", () => {
      const value = input.valueAsNumber;
      if (!Number.isInteger(value) || value < Number(input.min) || value > Number(input.max)) {
        input.value = String(settingsState[settingName]);
        return;
      }
      actions.applySettings({ [settingName]: value });
    });
  }

  bindWindowLevel(elements.blackLevelInput, "blackLevel");
  bindWindowLevel(elements.whiteLevelInput, "whiteLevel");

  listen(elements.gridToggle, "change", (event) => {
    actions.applySettings({ gridEnabled: event.target.checked });
  });
  listen(elements.snapToggle, "change", (event) => {
    actions.applySettings({ snapEnabled: event.target.checked });
  });
  [
    [elements.smartSnapToggle, "smartSnapEnabled"],
    [elements.snapBorderToggle, "snapToBorder"],
    [elements.snapEdgeToggle, "snapToEdge"],
    [elements.snapExtremaToggle, "snapToExtrema"],
  ].forEach(([element, settingName]) => {
    listen(element, "change", (event) => {
      actions.applySettings({ [settingName]: event.target.checked });
    });
  });
  listen(elements.snapExtremaModeSelect, "change", (event) => {
    actions.applySettings({ snapExtremaMode: event.target.value });
  });

  bindPositiveNumber(elements.gridSizeInput, "gridSize");
  bindPositiveNumber(elements.gridMajorEveryInput, "gridMajorEvery", {
    allowZero: true,
    minimum: 2,
  });
  bindPositiveNumber(elements.snapRadiusInput, "snapRadius");
  bindPositiveNumber(elements.snapBorderThresholdInput, "snapBorderThreshold", {
    allowZero: true,
  });
  bindPositiveNumber(elements.snapExtremaDeltaInput, "snapExtremaDelta", {
    allowZero: true,
  });

  listen(elements.applyPresetButton, "click", () => {
    const presetId = elements.snapPresetSelect?.value || "balanced";
    const preset = SNAP_PRESETS[presetId];
    if (preset) {
      actions.applySettings({ ...preset, blackLevel: settingsState.blackLevel, whiteLevel: settingsState.whiteLevel }, { presetId });
    }
  });
  listen(elements.resetSettingsButton, "click", () => {
    actions.applySettings(DEFAULT_SETTINGS, { presetId: "balanced" });
  });

  bindRangeInput(elements.imageContrastInput, "imageContrast", { display: true });
  bindRangeInput(elements.gridOpacityInput, "gridOpacity");
  bindRangeInput(elements.snapEdgeThresholdInput, "snapEdgeThreshold");
  bindRangeInput(elements.maskContrastInput, "maskContrast", { display: true });
  bindRangeInput(elements.maskOpacityInput, "maskOpacity", { display: true });

  if (elements.outputFormatSelect) {
    settingsState.outputFormat =
      elements.outputFormatSelect.value || settingsState.outputFormat;
    listen(elements.outputFormatSelect, "change", (event) => {
      settingsState.outputFormat = event.target.value;
      actions.redraw();
    });
    elements.outputFormatSelect.value = settingsState.outputFormat;
  }
  listen(elements.sourceEnhancementSelect, "change", (event) => {
    actions.applySettings({ sourceEnhancement: event.target.value });
  });
  if (elements.snapPresetSelect) {
    elements.snapPresetSelect.value = "balanced";
  }
}
