export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}
