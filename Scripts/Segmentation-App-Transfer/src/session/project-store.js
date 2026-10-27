import { validateSessionSnapshot } from "./session-snapshot.js";

const HEAD_STORE = "projects";
const DOCUMENT_STORE = "documents";
const IMAGE_STORE = "images";
const RECORD_KEY = "current";
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

/** Separate from single-session recovery; image bytes are immutable and documents commit with the queue. */
export function createProjectStore({
  indexedDB = globalThis.indexedDB,
  databaseName = "segmentation-annotator-projects",
} = {}) {
  let connection = null;
  let opening = null;
  let closed = false;
  const blobDigests = new WeakMap();

  function open() {
    if (closed) return Promise.reject(storageError("ProjectStorageClosedError", "Project storage is closed."));
    if (connection) return Promise.resolve(connection);
    if (opening) return opening;
    if (!indexedDB) return Promise.reject(storageError("ProjectStorageUnavailableError", "Project storage is unavailable in this browser."));
    opening = new Promise((resolve, reject) => {
      let request;
      let abandoned = false;
      const fail = error => { abandoned = true; reject(error); };
      try { request = indexedDB.open(databaseName, 1); }
      catch (error) { fail(error); return; }
      request.onupgradeneeded = () => {
        try {
          const database = request.result;
          for (const name of [HEAD_STORE, DOCUMENT_STORE, IMAGE_STORE]) {
            if (!database.objectStoreNames.contains(name)) database.createObjectStore(name);
          }
        } catch (error) { fail(error); request.transaction?.abort(); }
      };
      request.onblocked = () => fail(storageError("ProjectStorageBlockedError", "Project storage is blocked by another open tab."));
      request.onerror = () => fail(request.error || storageError("ProjectStorageUnavailableError", "Project storage could not be opened."));
      request.onsuccess = () => {
        const database = request.result;
        if (abandoned || closed) {
          database.close();
          if (closed) fail(storageError("ProjectStorageClosedError", "Project storage is closed."));
          return;
        }
        connection = database;
        database.onversionchange = () => {
          database.close();
          if (connection === database) connection = null;
        };
        resolve(database);
      };
    }).finally(() => { opening = null; });
    return opening;
  }

  async function transaction(names, mode, operation) {
    const database = await open();
    if (closed) throw storageError("ProjectStorageClosedError", "Project storage is closed.");
    return new Promise((resolve, reject) => {
      let tx;
      let result;
      let failure;
      try { tx = database.transaction(names, mode); }
      catch (error) { reject(error); return; }
      const fail = error => {
        failure = error;
        try { tx.abort(); } catch { reject(error); }
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => { failure ||= tx.error; };
      tx.onabort = () => reject(failure || tx.error || storageError("AbortError", "The project was not saved."));
      try { operation(tx, value => { result = value; }, fail); }
      catch (error) { fail(error); }
    });
  }

  function validateHead(head) {
    if (head === undefined) return { revision: 0, value: null };
    if (!isObject(head) || !Number.isSafeInteger(head.revision) || head.revision < 1) {
      throw new TypeError("The project revision is invalid.");
    }
    validateProject(head.value);
    return head;
  }

  function read() {
    // Loading the queue must not materialize every image Blob.
    return transaction([HEAD_STORE], "readonly", (tx, done, fail) => {
      const request = tx.objectStore(HEAD_STORE).get(RECORD_KEY);
      request.onsuccess = () => {
        try { done(validateHead(request.result)); }
        catch (error) { fail(dataError(error)); }
      };
    });
  }

  function readDocument(id) {
    if (!validId(id)) return Promise.reject(new TypeError("A project document identity is required."));
    return transaction([DOCUMENT_STORE, IMAGE_STORE], "readonly", (tx, done, fail) => {
      const request = tx.objectStore(DOCUMENT_STORE).get(id);
      request.onsuccess = () => {
        try {
          const record = request.result;
          if (!record || record.id !== id) throw new Error("The requested image document is missing.");
          validateDocument(record, false);
          const imageRequest = tx.objectStore(IMAGE_STORE).get(record.session.image.id);
          imageRequest.onsuccess = () => {
            try {
              const image = imageRequest.result;
              if (!image || image.id !== record.session.image.id || image.digest !== record.imageDigest
                || image.width !== record.session.image.width || image.height !== record.session.image.height
                || !(image.blob instanceof Blob) || image.blob.size !== image.size || !validId(image.digest)) {
                throw new Error("The saved image is missing or does not match its document.");
              }
              blobDigests.set(image.blob, Promise.resolve(image.digest));
              const { imageDigest, ...value } = record;
              done({ ...value, session: { ...value.session, image: { ...value.session.image, blob: image.blob } } });
            } catch (error) { fail(dataError(error)); }
          };
        } catch (error) { fail(dataError(error)); }
      };
    });
  }

  function imageDigest(blob) {
    if (!blobDigests.has(blob)) {
      const digest = (async () => {
        if (!globalThis.crypto?.subtle) throw storageError("ProjectStorageUnavailableError", "Secure image identification is unavailable in this browser.");
        const bytes = await blob.arrayBuffer();
        const result = await globalThis.crypto.subtle.digest("SHA-256", bytes);
        return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, "0")).join("");
      })();
      blobDigests.set(blob, digest);
      digest.catch(() => { blobDigests.delete(blob); });
    }
    return blobDigests.get(blob);
  }

  async function write(project, expectedRevision, documents = [], { onProgress } = {}) {
    if (closed) throw storageError("ProjectStorageClosedError", "Project storage is closed.");
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new TypeError("An expected project revision is required.");
    if (!Number.isSafeInteger(expectedRevision + 1)) throw new RangeError("The project revision is too large.");
    validateProject(project);
    if (!Array.isArray(documents)) throw new TypeError("Project documents must be an array.");
    const supplied = new Map();
    const items = new Map(project.items.map(item => [item.id, item]));
    for (const document of documents) {
      validateDocument(document);
      if (supplied.has(document.id) || !items.has(document.id)) throw new TypeError("Saved documents must appear exactly once in the project image list.");
      if (document.session.snapshot.annotations.length !== items.get(document.id).annotationCount) {
        throw new TypeError("The project annotation count does not match its image document.");
      }
      supplied.set(document.id, document);
    }
    // Capture metadata before asynchronous hashing; later caller edits must not enter this save.
    const value = structuredClone(project);
    const prepared = documents.map(document => {
      const { blob, ...image } = document.session.image;
      const metadata = structuredClone({ ...document, session: { ...document.session, image } });
      return { metadata, blob };
    });
    // Hash one new image at a time so a large batch does not materialize all encoded bytes together.
    for (let index = 0; index < prepared.length; index += 1) {
      const item = prepared[index];
      const fileName = item.metadata.session.image.fileName;
      if (onProgress) await onProgress({ phase: "checking", completed: index, total: prepared.length, fileName });
      try { item.digest = await imageDigest(item.blob); }
      catch (error) {
        if (!onProgress) throw error;
        const failure = new Error(`Could not check “${fileName}”. ${error?.message || String(error)}`, { cause: error });
        failure.name = error?.name || "Error";
        throw failure;
      }
      if (onProgress) await onProgress({ phase: "checking", completed: index + 1, total: prepared.length, fileName });
    }
    const imageIdentities = new Map();
    for (const { metadata, digest } of prepared) {
      const image = metadata.session.image;
      const previous = imageIdentities.get(image.id);
      if (previous && (previous.digest !== digest || previous.width !== image.width || previous.height !== image.height)) {
        throw storageError("ProjectImageIdentityError", "An image identity cannot be reused for different image bytes or dimensions.");
      }
      imageIdentities.set(image.id, { digest, width: image.width, height: image.height });
    }
    const preparedById = new Map(prepared.map(item => [item.metadata.id, item]));
    if (onProgress) await onProgress({ phase: "saving", completed: 0, total: prepared.length, fileName: "" });
    return transaction([HEAD_STORE, DOCUMENT_STORE, IMAGE_STORE], "readwrite", (tx, done, fail) => {
      const heads = tx.objectStore(HEAD_STORE);
      const savedDocuments = tx.objectStore(DOCUMENT_STORE);
      const images = tx.objectStore(IMAGE_STORE);
      const request = heads.get(RECORD_KEY);
      request.onsuccess = () => {
        try {
          const previous = validateHead(request.result);
          if (previous.revision !== expectedRevision) {
            fail(storageError("ProjectConflictError", "Another tab changed the saved project. Reload before saving over it."));
            return;
          }
          const previousItems = new Map((previous.value?.items || []).map(item => [item.id, item]));
          const removedIds = [...previousItems.keys()].filter(id => !items.has(id));
          let remaining = value.items.length;
          let finishing = false;
          const finish = () => {
            if (remaining !== 0 || finishing) return;
            finishing = true;
            const commit = () => {
              heads.put({ revision: expectedRevision + 1, value }, RECORD_KEY);
              done(expectedRevision + 1);
            };
            if (!removedIds.length) { commit(); return; }
            // Cleanup is part of the same transaction as the new queue. Read only
            // document metadata, preserving immutable image bytes still in use.
            const retainedImages = new Set();
            const removedImages = new Set();
            const documentIds = new Set([...removedIds, ...value.items.map(item => item.id)]);
            let pending = documentIds.size;
            for (const id of documentIds) {
              const cleanupRequest = savedDocuments.get(id);
              cleanupRequest.onsuccess = () => {
                try {
                  const record = cleanupRequest.result;
                  validateDocument(record, false);
                  if (record.id !== id) throw new Error("The saved document identity does not match its queue entry.");
                  (items.has(id) ? retainedImages : removedImages).add(record.session.image.id);
                  pending -= 1;
                  if (pending) return;
                  for (const removedId of removedIds) savedDocuments.delete(removedId);
                  for (const imageId of removedImages) if (!retainedImages.has(imageId)) images.delete(imageId);
                  commit();
                } catch (error) { fail(dataError(error)); }
              };
            }
          };
          for (const item of value.items) {
            const preparedDocument = preparedById.get(item.id);
            if (!preparedDocument) {
              // Previous queue references were committed atomically with their documents.
              // Retaining them must not reload every image's full annotation snapshot on each edit.
              if (previousItems.get(item.id)?.annotationCount === item.annotationCount) {
                remaining -= 1;
                finish();
                continue;
              }
              const existingRequest = savedDocuments.get(item.id);
              existingRequest.onsuccess = () => {
                try {
                  const record = existingRequest.result;
                  validateDocument(record, false);
                  if (record.id !== item.id || record.session.snapshot.annotations.length !== item.annotationCount) {
                    throw new Error("The project image list does not match its saved document.");
                  }
                  remaining -= 1;
                  finish();
                } catch (error) { fail(dataError(error)); }
              };
              continue;
            }
            const { metadata, blob, digest } = preparedDocument;
            const image = metadata.session.image;
            const imageRequest = images.get(image.id);
            imageRequest.onsuccess = () => {
              try {
                const savedImage = imageRequest.result;
                if (savedImage) {
                  if (savedImage.id !== image.id || savedImage.digest !== digest || savedImage.size !== blob.size
                    || savedImage.width !== image.width || savedImage.height !== image.height
                    || !(savedImage.blob instanceof Blob) || savedImage.blob.size !== savedImage.size) {
                    throw storageError("ProjectImageIdentityError", "An image identity cannot be reused for different image bytes or dimensions.");
                  }
                } else {
                  images.put({ id: image.id, blob, digest, size: blob.size, width: image.width, height: image.height }, image.id);
                }
                savedDocuments.put({ ...metadata, imageDigest: digest }, metadata.id);
                remaining -= 1;
                finish();
              } catch (error) { fail(error); }
            };
          }
          if (!value.items.length) finish();
        } catch (error) { fail(error); }
      };
    });
  }

  return {
    read, readDocument, write,
    close() {
      closed = true;
      connection?.close();
      connection = null;
    },
  };
}
