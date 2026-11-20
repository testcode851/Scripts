import { DEFAULT_IMAGE_DISPLAY } from "../config/settings.js";
import { getNativeBrightnessRange } from "../image/image-processing.js";

/**
 * Owns form synchronization and the application-level render fan-out.
 */
export function createAppPresenter(options) {
  const {
    controls,
    imageState,
    settingsState,
    viewState,
    interactionState,
    defaultSettings,
    normalizeSettings,
    ensureImageAnalysisCaches,
    normalizeSelection,
    renderMetadata,
    renderLoadStatus,
    renderLabels,
    requestCanvasRender,
    requestSelectionCanvasRender = requestCanvasRender,
    onRedraw = () => {},
    onDisplayChange = () => {},
  } = options;
  const displayKeys = Object.keys(DEFAULT_IMAGE_DISPLAY);
  let syncedImage;
  let syncedDisplay = {};

  function syncControlValues() {
    const values = {
      gridToggle: ["checked", settingsState.gridEnabled],
      snapToggle: ["checked", settingsState.snapEnabled],
      smartSnapToggle: ["checked", settingsState.smartSnapEnabled],
      snapBorderToggle: ["checked", settingsState.snapToBorder],
      snapEdgeToggle: ["checked", settingsState.snapToEdge],
      snapExtremaToggle: ["checked", settingsState.snapToExtrema],
      snapExtremaModeSelect: ["value", settingsState.snapExtremaMode],
      gridSizeInput: ["value", String(settingsState.gridSize)],
      gridOpacityInput: ["value", String(settingsState.gridOpacity)],
      gridMajorEveryInput: ["value", String(settingsState.gridMajorEvery)],
      snapRadiusInput: ["value", String(settingsState.snapRadius)],
      snapBorderThresholdInput: ["value", String(settingsState.snapBorderThreshold)],
      snapEdgeThresholdInput: ["value", String(settingsState.snapEdgeThreshold)],
      snapExtremaDeltaInput: ["value", String(settingsState.snapExtremaDelta)],
      sourceEnhancementSelect: ["value", settingsState.sourceEnhancement],
      nativeWindowControls: ["hidden", !imageState?.native],
      blackLevelInput: ["value", String(settingsState.blackLevel)],
      whiteLevelInput: ["value", String(settingsState.whiteLevel)],
      imageContrastInput: ["value", String(settingsState.imageContrast)],
      maskContrastInput: ["value", String(settingsState.maskContrast)],
      maskOpacityInput: ["value", String(settingsState.maskOpacity)],
    };
    Object.entries(values).forEach(([name, [property, value]]) => {
      if (controls[name]) controls[name][property] = value;
    });
    if (controls.blackLevelInput) controls.blackLevelInput.max = String(settingsState.whiteLevel - 1);
    if (controls.whiteLevelInput) controls.whiteLevelInput.min = String(settingsState.blackLevel + 1);
    if (imageState?.native && controls.nativeRangeOutput) {
      const { minimum, maximum } = getNativeBrightnessRange(imageState.native);
      controls.nativeRangeOutput.textContent = `Image brightness range ${minimum}–${maximum}`;
    }
    syncedImage = imageState?.image;
    syncedDisplay = Object.fromEntries(displayKeys.map(key => [key, settingsState[key]]));
  }

  function syncAdjustmentLabels() {
    const text = {
      imageContrastValue: `${settingsState.imageContrast}%`,
      snapEdgeThresholdValue: `${settingsState.snapEdgeThreshold}`,
      gridOpacityValue: `${settingsState.gridOpacity}%`,
      maskContrastValue: `${settingsState.maskContrast}%`,
      maskOpacityValue: `${settingsState.maskOpacity}%`,
      zoomValue: `${Math.round(viewState.viewZoom * 100)}%`,
    };
    Object.entries(text).forEach(([name, value]) => {
      if (controls[name]) controls[name].textContent = value;
    });
  }

  function renderDomPanels() {
    renderMetadata();
    renderLoadStatus();
    if (!interactionState.activeAnnotationDrag) renderLabels();
  }

  function redraw() {
    if (syncedImage !== imageState?.image || displayKeys.some(key => syncedDisplay[key] !== settingsState[key])) {
      syncControlValues();
      syncAdjustmentLabels();
    }
    renderDomPanels();
    normalizeSelection();
    requestCanvasRender();
    onRedraw();
  }

  // Pure shape selection changes the editor display, not measurement inputs.
  function redrawSelection() {
    renderDomPanels();
    normalizeSelection();
    requestSelectionCanvasRender();
  }

  // View/settings changes do not alter sidebar content or measurement inputs.
  function redrawView() {
    renderMetadata();
    renderLoadStatus();
    normalizeSelection();
    requestCanvasRender();
  }

  function applySettings(settingsPatch, options = {}) {
    const normalized = normalizeSettings({ ...settingsState, ...settingsPatch });
    const displayChanged = displayKeys.some(key => settingsState[key] !== normalized[key]);
    Object.keys(defaultSettings).forEach((key) => {
      settingsState[key] = normalized[key];
    });
    ensureImageAnalysisCaches();
    syncControlValues();
    if (controls.snapPresetSelect && options.presetId) {
      controls.snapPresetSelect.value = options.presetId;
    }
    syncAdjustmentLabels();
    redrawView();
    if (displayChanged && imageState?.image) onDisplayChange();
  }

  return {
    applySettings,
    redraw,
    redrawSelection,
    redrawView,
    renderDomPanels,
    syncAdjustmentLabels,
    syncControlValues,
  };
}
