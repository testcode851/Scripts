/** Editor-only flags. Their absence preserves the original document behavior. */
export function normalizeEditorMetadata(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Annotation editor metadata must be an object.");
  }
  if (Object.keys(value).some(key => !["hidden", "locked", "reviewStatus"].includes(key))) {
    throw new Error("Annotation editor metadata contains an unsupported field.");
  }
  const result = {};
  for (const key of ["hidden", "locked"]) {
    if (!Object.hasOwn(value, key)) continue;
    if (typeof value[key] !== "boolean") throw new Error(`Annotation ${key} must be true or false.`);
    if (value[key]) result[key] = true;
  }
  if (Object.hasOwn(value, "reviewStatus")) {
    if (!["unreviewed", "needs-review", "approved"].includes(value.reviewStatus)) {
      throw new Error("Annotation review status is invalid.");
    }
    if (value.reviewStatus !== "unreviewed") result.reviewStatus = value.reviewStatus;
  }
  return Object.keys(result).length ? result : undefined;
}

export const getReviewStatus = annotation => annotation?.editor?.reviewStatus || "unreviewed";
export const isLocked = annotation => annotation?.editor?.locked === true;

/** An explicit needs-review marker survives editing; approval does not. */
export function invalidateReview(annotation) {
  if (getReviewStatus(annotation) !== "approved") return false;
  delete annotation.editor.reviewStatus;
  if (!Object.keys(annotation.editor).length) delete annotation.editor;
  return true;
}
