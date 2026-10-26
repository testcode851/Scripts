const CATALOG_FORMAT = "segmentation-class-catalog";
const fail = message => { throw new Error(`Invalid class catalog: ${message}`); };
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

function fields(value, required, optional = []) {
  if (!isObject(value)) fail("an object is required.");
  if (required.some(key => !Object.hasOwn(value, key))) fail(`required fields are ${required.join(", ")}.`);
  const allowed = new Set([...required, ...optional]);
  if (Object.keys(value).some(key => !allowed.has(key))) fail("unrecognized fields are not supported.");
}

/** Independent of an image document: disabled until explicitly applied. */
export function emptyClassCatalog() {
  return { version: 1, enabled: false, classes: [] };
}

/** Validate and detach the catalog without changing IDs or merging class names. */
export function normalizeClassCatalog(value) {
  fields(value, ["version", "enabled", "classes"]);
  if (value.version !== 1) fail("the version is unsupported.");
  if (typeof value.enabled !== "boolean") fail("enabled must be true or false.");
  if (!Array.isArray(value.classes)) fail("classes must be an array.");
  const ids = new Set();
  const names = new Set();
  const classes = value.classes.map(entry => {
    fields(entry, ["id", "name"], ["supercategory"]);
    if (!Number.isSafeInteger(entry.id) || entry.id < 0) fail("class IDs must be nonnegative safe integers.");
    if (typeof entry.name !== "string" || !entry.name.trim()) fail("class names must be nonempty text.");
    const name = entry.name.trim();
    if (ids.has(entry.id)) fail(`class ID ${entry.id} is duplicated.`);
    if (names.has(name)) fail(`class name "${name}" is duplicated.`);
    if (Object.hasOwn(entry, "supercategory") && typeof entry.supercategory !== "string") {
      fail("a class supercategory must be text.");
    }
    ids.add(entry.id);
    names.add(name);
    return { id: entry.id, name,
      ...(Object.hasOwn(entry, "supercategory") ? { supercategory: entry.supercategory } : {}) };
  });
  return { version: 1, enabled: value.enabled, classes };
}

export function parseClassCatalogFile(data) {
  fields(data, ["format", "version", "classes"]);
  if (data.format !== CATALOG_FORMAT) fail("this is not a reusable class catalog file.");
  return normalizeClassCatalog({ version: data.version, enabled: true, classes: data.classes });
}

export function exportClassCatalogFile(catalog) {
  const normalized = normalizeClassCatalog(catalog);
  return { format: CATALOG_FORMAT, version: normalized.version, classes: normalized.classes };
}

function unknownLabel(label) {
  fail(`class "${label}" is not in the enabled catalog. Add it in Classes, use a registered label, or disable the catalog.`);
}

export function resolveCatalogCategory(catalog, label) {
  if (catalog == null) return null;
  const normalized = normalizeClassCatalog(catalog);
  if (!normalized.enabled) return null;
  const name = typeof label === "string" ? label.trim() : "";
  const entry = normalized.classes.find(item => item.name === name);
  if (!entry) unknownLabel(name);
  return entry;
}

/** Validate before document replacement or export; never modify annotations. */
export function validateCatalogAnnotations(catalog, annotations, { requireKnownLabels = false } = {}) {
  if (catalog == null) return;
  const normalized = normalizeClassCatalog(catalog);
  if (!normalized.enabled) return;
  if (!Array.isArray(annotations)) fail("annotations must be an array.");
  const byId = new Map(normalized.classes.map(entry => [entry.id, entry]));
  const byName = new Map(normalized.classes.map(entry => [entry.name, entry]));
  for (const annotation of annotations) {
    if (annotation?.type !== "polygon") continue;
    const label = typeof annotation.label === "string" ? annotation.label.trim() : "";
    if (requireKnownLabels && !byName.has(label)) unknownLabel(label);
    const source = annotation.coco;
    if (!source) continue;
    const originalById = byId.get(source.categoryId);
    const originalByName = byName.get(source.categoryName);
    // Original identities still matter after relabeling: undo may restore that class.
    if (originalById && originalById.name !== source.categoryName) {
      fail(`imported COCO class ID ${source.categoryId} names "${source.categoryName}", but the catalog names it "${originalById.name}".`);
    }
    if (originalByName && originalByName.id !== source.categoryId) {
      fail(`imported COCO class "${source.categoryName}" has ID ${source.categoryId}, but the catalog uses ID ${originalByName.id}.`);
    }
    if (originalById && source.supercategory !== undefined && originalById.supercategory !== undefined
      && source.supercategory !== originalById.supercategory) {
      fail(`imported COCO class "${source.categoryName}" has a different supercategory from the catalog.`);
    }
  }
}
