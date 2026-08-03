/** Format raw bytes as a compact human-readable value for the metadata panel. */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "-";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = value >= 10 ? value.toFixed(0) : value.toFixed(1);
  return `${rounded} ${units[unitIndex]}`;
}

/** Format an epoch timestamp using the user's browser locale. */
export function formatImageTimestamp(epochMs) {
  if (!Number.isFinite(epochMs)) {
    return "-";
  }
  return new Date(epochMs).toLocaleString();
}
