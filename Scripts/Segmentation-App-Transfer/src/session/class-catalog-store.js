import { emptyClassCatalog, normalizeClassCatalog } from "../model/class-catalog.js";
import { createSessionStore } from "./session-store.js";

const validRevision = value => Number.isSafeInteger(value) && value >= 0;

/** Reuse independent atomic revision checks in the local project folder. */
export function createClassCatalogStore({
  client,
  backingStore = createSessionStore({ client, kind: "catalog" }),
} = {}) {
  let closed = false;

  async function access(operation) {
    if (closed) throw new Error("Class catalog storage is closed.");
    try {
      return await operation();
    } catch (error) {
      if (error.name === "ClassCatalogDataError") throw error;
      const message = error instanceof Error ? error.message : String(error);
      const translated = message.replace(/saved session/gi, "saved class catalog")
        .replace(/session recovery/gi, "Class catalog")
        .replace(/session storage/gi, "class catalog storage")
        .replace(/session revision/gi, "class catalog revision");
      if (translated === message) throw error;
      const catalogError = new Error(translated, { cause: error });
      catalogError.name = error.name || "Error";
      throw catalogError;
    }
  }

  async function load() {
    return access(async () => {
      const record = await backingStore.read();
      if (!record || !validRevision(record.revision)) throw new Error("Invalid saved class catalog revision.");
      if (record.value === null) return { revision: record.revision, catalog: emptyClassCatalog() };
      try {
        const value = record.value;
        if (!value || typeof value !== "object" || Array.isArray(value)
          || value.schemaVersion !== 1 || value.image !== null
          || Object.keys(value).some(key => !["schemaVersion", "image", "catalog"].includes(key))) {
          throw new Error("Invalid saved class catalog record.");
        }
        return { revision: record.revision, catalog: normalizeClassCatalog(value.catalog) };
      } catch (cause) {
        const error = new Error(`The saved class catalog is invalid. Import a backup or create a replacement in Classes, then Apply. ${cause.message}`, { cause });
        error.name = "ClassCatalogDataError";
        // Only a successfully read, valid revision permits explicit replacement.
        error.catalogRevision = record.revision;
        throw error;
      }
    });
  }

  async function save(catalog, expectedRevision) {
    if (!validRevision(expectedRevision)) throw new TypeError("An expected class catalog revision is required.");
    const normalized = normalizeClassCatalog(catalog);
    return access(async () => {
      const revision = await backingStore.write({ schemaVersion: 1, image: null, catalog: normalized }, expectedRevision);
      if (!validRevision(revision) || revision !== expectedRevision + 1) {
        throw new Error("Invalid saved class catalog revision.");
      }
      return revision;
    });
  }

  return {
    load,
    save,
    close() {
      if (closed) return;
      closed = true;
      backingStore.close();
    },
  };
}
