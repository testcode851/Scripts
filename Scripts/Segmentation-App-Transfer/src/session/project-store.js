import { localProjectClient } from "./local-project-client.js";
import { validateSessionSnapshot } from "./session-snapshot.js";





const STATUSES = new Set(["not-started", "in-progress", "complete"]);

function storageError(name, message) {
  return Object.assign(new Error(message), { name });
}

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const validId = value => typeof value === "string" && value.trim().length > 0;
const validSize = value => isObject(value) && Number.isFinite(value.width) && value.width > 0
  && Number.isFinite(value.height) && value.height > 0;

function validateProject(value) {
  if (!isObject(value) || value.version !== 1 || !validId(value.id) || !validId(value.name)
    || !Array.isArray(value.items)) throw new TypeError("The project identity, name and image list are required.");
  const ids = new Set();
  for (const item of value.items) {
    if (!isObject(item) || !validId(item.id) || !validId(item.name) || ids.has(item.id)
      || !STATUSES.has(item.status) || !Number.isSafeInteger(item.annotationCount) || item.annotationCount < 0
      || (Object.hasOwn(item, "thumbnailUrl") && (typeof item.thumbnailUrl !== "string" || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(item.thumbnailUrl)))) {
      throw new TypeError("Project images need unique identities, names, valid statuses and annotation counts.");
    }
    ids.add(item.id);
  }
  if (value.activeId !== null && !ids.has(value.activeId)) {
    throw new TypeError("The active project image must be in the image list.");
  }
  return value;
}

function validateDocument(value, requireBlob = true) {
  if (!isObject(value) || !validId(value.id) || !isObject(value.session)
    || value.session.schemaVersion !== 1 || !Number.isFinite(value.session.savedAt) || value.session.savedAt < 0
    || !validSize(value.displaySize)) {
    throw new TypeError("A project document needs an identity, saved session and display dimensions.");
  }
  const { image, snapshot } = value.session;
  if (!validSize(image) || !validId(image.id) || !validId(image.fileName)
    || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height)
    || (requireBlob && (!(image.blob instanceof Blob) || image.blob.size === 0))) {
    throw new TypeError("A project document needs a valid image identity, dimensions and Blob.");
  }
  // Reuse the existing editor's validation and retain its full-precision snapshot.
  validateSessionSnapshot(snapshot, image);
  return value;
}

function dataError(error) {
  return storageError("ProjectStorageDataError", `The saved project is invalid: ${error.message}`);
}

/** Saves a batch through the local server; the browser retains only active image data. */
export function createProjectStore({ client = localProjectClient } = {}) {
  let closed = false;
  function checkOpen() {
    if (closed) throw storageError("ProjectStorageClosedError", "Project storage is closed.");
  }
  function validateHead(head) {
    if (!head || !Number.isSafeInteger(head.revision) || head.revision < 0
      || (head.value !== null && head.revision < 1)) throw new TypeError("The project revision is invalid.");
    if (head.value !== null) validateProject(head.value);
    return head;
  }
  async function read() {
    checkOpen();
    const head = await client.json("batch");
    try { return validateHead(head); } catch (error) { throw dataError(error); }
  }
  async function readDocument(id) {
    checkOpen();
    if (!validId(id)) throw new TypeError("A project document identity is required.");
    const record = await client.json(`documents/${encodeURIComponent(id)}`);
    try {
      validateDocument(record, false);
      if (record.id !== id || !/^[a-f0-9]{64}$/.test(record.imageDigest)) throw new Error("The requested image document is invalid.");
      const blob = await client.readImage(record.session.image, record.imageDigest);
      const { imageDigest, ...value } = record;
      return { ...value, session: { ...value.session, image: { ...value.session.image, blob } } };
    } catch (error) { throw dataError(error); }
  }
  async function stageDocument(document) {
    checkOpen();
    validateDocument(document);
    const { blob, ...image } = document.session.image;
    // Release each imported original after upload, retaining only its small snapshot.
    const metadata = structuredClone({ ...document, session: { ...document.session, image } });
    const digest = await client.digest(blob);
    checkOpen();
    await client.uploadImage({ ...image, blob }, digest);
    metadata.imageDigest = digest;
    return metadata;
  }
  async function write(project, expectedRevision, documents = [], { onProgress } = {}) {
    checkOpen();
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new TypeError("An expected project revision is required.");
    if (!Number.isSafeInteger(expectedRevision + 1)) throw new RangeError("The project revision is too large.");
    validateProject(project);
    if (!Array.isArray(documents)) throw new TypeError("Project documents must be an array.");
    const ids = new Set();
    const items = new Map(project.items.map(item => [item.id, item]));
    for (const document of documents) {
      const staged = !Object.hasOwn(document?.session?.image || {}, "blob")
        && /^[a-f0-9]{64}$/.test(document?.imageDigest);
      validateDocument(document, !staged);
      if (ids.has(document.id) || !items.has(document.id)) throw new TypeError("Saved documents must appear exactly once in the project image list.");
      if (document.session.snapshot.annotations.length !== items.get(document.id).annotationCount) {
        throw new TypeError("The project annotation count does not match its image document.");
      }
      ids.add(document.id);
    }
    // Detach metadata before yielding. Later edits must not alter this checkpoint.
    const value = structuredClone(project);
    const prepared = documents.map(document => {
      const { blob, ...image } = document.session.image;
      return { blob, digest: blob ? null : document.imageDigest,
        metadata: structuredClone({ ...document, session: { ...document.session, image } }) };
    });
    const identities = new Map();
    for (let index = 0; index < prepared.length; index += 1) {
      const item = prepared[index];
      const fileName = item.metadata.session.image.fileName;
      await onProgress?.({ phase: "checking", completed: index, total: prepared.length, fileName });
      try { if (item.blob) item.digest = await client.digest(item.blob); }
      catch (cause) {
        if (!onProgress) throw cause;
        const error = new Error(`Could not check “${fileName}”. ${cause.message || String(cause)}`, { cause });
        error.name = cause.name || "Error";
        throw error;
      }
      const image = item.metadata.session.image;
      const signature = `${item.digest}:${image.width}:${image.height}`;
      if (identities.has(image.id) && identities.get(image.id) !== signature) {
        throw storageError("ProjectImageIdentityError", "An image identity cannot be reused for different image bytes or dimensions.");
      }
      identities.set(image.id, signature);
      await onProgress?.({ phase: "checking", completed: index + 1, total: prepared.length, fileName });
    }
    // Upload one original at a time. Only the final metadata commit publishes the queue.
    for (let index = 0; index < prepared.length; index += 1) {
      checkOpen();
      const { metadata, blob, digest } = prepared[index];
      const fileName = metadata.session.image.fileName;
      await onProgress?.({ phase: "saving", completed: index, total: prepared.length, fileName });
      if (blob) await client.uploadImage({ ...metadata.session.image, blob }, digest);
      metadata.imageDigest = digest;
      await onProgress?.({ phase: "saving", completed: index + 1, total: prepared.length, fileName });
    }
    checkOpen();
    const saved = await client.json("batch", { method: "PUT", value: {
      expectedRevision, value, documents: prepared.map(item => item.metadata),
    } });
    if (saved.revision !== expectedRevision + 1) throw new Error("Invalid saved project revision.");
    return saved.revision;
  }
  return { read, readDocument, stageDocument, write, close() { closed = true; } };
}
