import { clamp } from "../geometry/math.js";

export const DEFAULT_SHAPE_COLOR = Object.freeze({ r: 34, g: 197, b: 94 });

/** Convert an RGB color to a CSS rgb() or rgba() value. */
export function rgbToCss(color, alpha = null) {
  const safeColor = color || DEFAULT_SHAPE_COLOR;
  if (alpha == null) {
    return `rgb(${safeColor.r}, ${safeColor.g}, ${safeColor.b})`;
  }
  return `rgba(${safeColor.r}, ${safeColor.g}, ${safeColor.b}, ${alpha})`;
}

/** Convert an RGB color to a six-digit hexadecimal value. */
export function rgbToHex(color) {
  const safeColor = color || DEFAULT_SHAPE_COLOR;
  const toHex = (value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");
  return `#${toHex(safeColor.r)}${toHex(safeColor.g)}${toHex(safeColor.b)}`;
}

/** Parse a six-digit hexadecimal color, returning null for unsupported input. */
export function hexToRgb(hex) {
  const normalized = typeof hex === "string" ? hex.trim() : "";
  const match = /^#?([0-9a-f]{6})$/i.exec(normalized);
  if (!match) {
    return null;
  }
  const value = match[1];
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}
