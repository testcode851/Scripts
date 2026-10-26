/**
 * Owns form synchronization and the application-level render fan-out.
 */
export function createAppPresenter(options) {
  const {
    controls,
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
  } = options;

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
      imageContrastInput: ["value", String(settingsState.imageContrast)],
      maskContrastInput: ["value", String(settingsState.maskContrast)],
      maskOpacityInput: ["value", String(settingsState.maskOpacity)],
    };
    Object.entries(values).forEach(([name, [property, value]]) => {
      if (controls[name]) controls[name][property] = value;
    });
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
