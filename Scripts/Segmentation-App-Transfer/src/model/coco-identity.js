let fallbackInstanceSequence = 0;

function createInstanceKey() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  fallbackInstanceSequence += 1;
  return `coco-instance-${Date.now().toString(36)}-${fallbackInstanceSequence.toString(36)}`;
}

const validId = (value) => Number.isSafeInteger(value) && value >= 0;
const invalid = (message) => { throw new Error(`Invalid COCO identity: ${message}`); };

/** Keep imported COCO identity separate from the editor's per-shape identity. */
export function cloneCocoIdentity(value, { preserveInstance = true } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("metadata must be an object.");
  if (typeof value.instanceKey !== "string" || !value.instanceKey.trim()) invalid("the instance key is missing.");
  if (!validId(value.categoryId)) invalid("the category ID must be a nonnegative safe integer.");
  if (typeof value.categoryName !== "string" || !value.categoryName.trim()
    || value.categoryName !== value.categoryName.trim()) invalid("the category name must be nonempty trimmed text.");
  if (Object.hasOwn(value, "annotationId") && !validId(value.annotationId)) {
    invalid("the annotation ID must be a nonnegative safe integer.");
  }
  if (Object.hasOwn(value, "supercategory") && typeof value.supercategory !== "string") {
    invalid("the supercategory must be text.");
  }
  return {
    instanceKey: preserveInstance ? value.instanceKey : createInstanceKey(),
    ...(preserveInstance && Object.hasOwn(value, "annotationId") ? { annotationId: value.annotationId } : {}),
    categoryId: value.categoryId,
    categoryName: value.categoryName,
    ...(Object.hasOwn(value, "supercategory") ? { supercategory: value.supercategory } : {}),
  };
}

/** A shared instance and category must mean the same thing throughout a document. */
export function validateCocoIdentityCollection(annotations) {
  const instances = new Map();
  const annotationIds = new Map();
  const categories = new Map();
  for (const annotation of annotations) {
    if (!Object.hasOwn(annotation, "coco")) continue;
    if (annotation.type !== "polygon") invalid("only polygon components can carry COCO identity.");
    const identity = cloneCocoIdentity(annotation.coco);
    const previousInstance = instances.get(identity.instanceKey);
    if (previousInstance && ["annotationId", "categoryId", "categoryName", "supercategory"]
      .some((key) => previousInstance[key] !== identity[key])) {
      invalid("components of one instance disagree about its identity or category.");
    }
    instances.set(identity.instanceKey, identity);
    if (Object.hasOwn(identity, "annotationId")) {
      const instanceKey = annotationIds.get(identity.annotationId);
      if (instanceKey !== undefined && instanceKey !== identity.instanceKey) {
        invalid("different instances cannot share an annotation ID.");
      }
      annotationIds.set(identity.annotationId, identity.instanceKey);
    }
    const previousCategory = categories.get(identity.categoryId);
    if (previousCategory && (previousCategory.categoryName !== identity.categoryName
      || previousCategory.supercategory !== identity.supercategory)) {
      invalid("a category ID has conflicting names or supercategories.");
    }
    categories.set(identity.categoryId, identity);
  }
}
