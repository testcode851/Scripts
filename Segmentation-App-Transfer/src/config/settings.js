import { clamp } from "../geometry/math.js";

export const DEFAULT_SETTINGS = Object.freeze({
  gridEnabled: false,
  snapEnabled: true,
  smartSnapEnabled: true,
  snapToBorder: true,
  snapToEdge: true,
  snapToExtrema: false,
  snapExtremaMode: "min",
  snapRadius: 8,
  snapBorderThreshold: 5,
  snapEdgeThreshold: 40,
  snapExtremaDelta: 12,
  gridSize: 20,
  gridOpacity: 40,
  gridMajorEvery: 5,
  sourceEnhancement: "none",
  imageContrast: 100,
  maskContrast: 100,
  maskOpacity: 100,
});

export const SNAP_PRESETS = Object.freeze({
  balanced: Object.freeze({ ...DEFAULT_SETTINGS }),
  "coarse-trace": Object.freeze({
    ...DEFAULT_SETTINGS,
    gridEnabled: true,
    gridSize: 12,
    snapRadius: 8,
    snapEdgeThreshold: 30,
  }),
  "fine-boundary": Object.freeze({
    ...DEFAULT_SETTINGS,
    gridEnabled: true,
    gridSize: 4,
    snapRadius: 4,
    snapBorderThreshold: 2,
    snapEdgeThreshold: 65,
  }),
  "low-contrast-edge": Object.freeze({
    ...DEFAULT_SETTINGS,
    gridEnabled: true,
    gridSize: 6,
    sourceEnhancement: "hist-eq",
    imageContrast: 125,
    snapRadius: 5,
    snapEdgeThreshold: 45,
  }),
  "manual-cleanup": Object.freeze({
    ...DEFAULT_SETTINGS,
    gridEnabled: false,
    snapEnabled: false,
    smartSnapEnabled: false,
    gridSize: 4,
    maskOpacity: 80,
  }),
});

/**
 * Normalize untrusted UI or persisted settings into the supported ranges.
 * This function is intentionally pure so it can be tested without a browser.
 */
export function normalizeSettings(inputSettings = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...inputSettings };
  const toNumber = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };

  return {
    gridEnabled: Boolean(settings.gridEnabled),
    snapEnabled: Boolean(settings.snapEnabled),
    smartSnapEnabled: Boolean(settings.smartSnapEnabled),
    snapToBorder: Boolean(settings.snapToBorder),
    snapToEdge: Boolean(settings.snapToEdge),
    snapToExtrema: Boolean(settings.snapToExtrema),
    snapExtremaMode: settings.snapExtremaMode === "max" ? "max" : "min",
    snapRadius: clamp(Math.round(toNumber(settings.snapRadius, DEFAULT_SETTINGS.snapRadius)), 1, 40),
    snapBorderThreshold: clamp(
      Math.round(toNumber(settings.snapBorderThreshold, DEFAULT_SETTINGS.snapBorderThreshold)),
      0,
      40
    ),
    snapEdgeThreshold: clamp(
      Math.round(toNumber(settings.snapEdgeThreshold, DEFAULT_SETTINGS.snapEdgeThreshold)),
      0,
      255
    ),
    snapExtremaDelta: clamp(
      Math.round(toNumber(settings.snapExtremaDelta, DEFAULT_SETTINGS.snapExtremaDelta)),
      0,
      255
    ),
    gridSize: clamp(Math.round(toNumber(settings.gridSize, DEFAULT_SETTINGS.gridSize)), 4, 200),
    gridOpacity: clamp(Math.round(toNumber(settings.gridOpacity, DEFAULT_SETTINGS.gridOpacity)), 10, 100),
    gridMajorEvery: clamp(
      Math.round(toNumber(settings.gridMajorEvery, DEFAULT_SETTINGS.gridMajorEvery)),
      2,
      20
    ),
    sourceEnhancement: settings.sourceEnhancement === "hist-eq" ? "hist-eq" : "none",
    imageContrast: clamp(
      Math.round(toNumber(settings.imageContrast, DEFAULT_SETTINGS.imageContrast)),
      50,
      200
    ),
    maskContrast: clamp(
      Math.round(toNumber(settings.maskContrast, DEFAULT_SETTINGS.maskContrast)),
      50,
      200
    ),
    maskOpacity: clamp(Math.round(toNumber(settings.maskOpacity, DEFAULT_SETTINGS.maskOpacity)), 0, 100),
  };
}
