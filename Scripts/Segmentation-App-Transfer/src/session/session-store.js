const HEAD_STORE = "session";
const IMAGE_STORE = "images";
const RECORD_KEY = "current";

function storageError(name, message) {
  const error = new Error(message);
  error.name = name;
  return error;
}

/** Stores one recoverable session; metadata and image bytes commit together. */
export function createSessionStore({
  indexedDB = globalThis.indexedDB,
  databaseName = "segmentation-annotator-session",
} = {}) {
  let connection = null;
  let opening = null;
  let closed = false;

  function open() {
    if (closed) return Promise.reject(storageError("SessionStorageClosedError", "Session storage is closed."));
    if (connection) return Promise.resolve(connection);
    if (opening) return opening;
    if (!indexedDB) {
      return Promise.reject(storageError("SessionStorageUnavailableError", "Session recovery storage is unavailable in this browser."));
    }
    opening = new Promise((resolve, reject) => {
      let request;
      let abandoned = false;
      function fail(error) {
        abandoned = true;
        reject(error);
      }
      try {
        request = indexedDB.open(databaseName, 1);
      } catch (error) {
        fail(error);
        return;
      }
      request.onupgradeneeded = () => {
        try {
          const database = request.result;
          if (!database.objectStoreNames.contains(HEAD_STORE)) database.createObjectStore(HEAD_STORE);
          if (!database.objectStoreNames.contains(IMAGE_STORE)) database.createObjectStore(IMAGE_STORE);
        } catch (error) {
          fail(error);
          request.transaction?.abort();
        }
      };
      request.onblocked = () => fail(storageError("SessionStorageBlockedError", "Session recovery storage is blocked by another open tab."));
      request.onerror = () => fail(request.error || storageError("SessionStorageUnavailableError", "Session recovery storage could not be opened."));
      request.onsuccess = () => {
        const database = request.result;
        if (abandoned || closed) {
          database.close();
          if (closed) fail(storageError("SessionStorageClosedError", "Session storage is closed."));
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

  async function transaction(mode, operation) {
    const database = await open();
    if (closed) throw storageError("SessionStorageClosedError", "Session storage is closed.");
    return new Promise((resolve, reject) => {
      let tx;
      let result;
      let failure;
      try {
        tx = database.transaction([HEAD_STORE, IMAGE_STORE], mode);
      } catch (error) {
        reject(error);
        return;
      }
      const fail = error => {
        failure = error;
        try { tx.abort(); } catch { reject(error); }
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => { failure ||= tx.error; };
      tx.onabort = () => reject(failure || tx.error || storageError("AbortError", "Session recovery storage was not saved."));
      try {
        operation(tx, value => { result = value; }, fail);
      } catch (error) {
        fail(error);
      }
    });
  }

  function read() {
    return transaction("readonly", (tx, done, fail) => {
      const request = tx.objectStore(HEAD_STORE).get(RECORD_KEY);
      request.onsuccess = () => {
        try {
          const head = request.result;
          if (!head?.value) {
            done({ revision: head?.revision || 0, value: null });
            return;
          }
          if (head.value.image === null) {
            done({ revision: head.revision, value: head.value });
            return;
          }
          const imageRequest = tx.objectStore(IMAGE_STORE).get(RECORD_KEY);
          imageRequest.onsuccess = () => {
            const image = imageRequest.result;
            if (!image || image.id !== head.value.image?.id || !image.blob) {
              fail(storageError("SessionStorageDataError", "The saved session image is missing or does not match the document."));
              return;
            }
            done({ revision: head.revision, value: { ...head.value, image: { ...head.value.image, blob: image.blob } } });
          };
        } catch (error) {
          fail(error);
        }
      };
    });
  }

  function update(value, expectedRevision) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      return Promise.reject(new TypeError("An expected session revision is required."));
    }
    if (value !== null && value?.image !== null && (!value?.image || typeof value.image.id !== "string" || !value.image.id || !value.image.blob)) {
      return Promise.reject(new TypeError("A session image identity and Blob are required."));
    }
    return transaction("readwrite", (tx, done, fail) => {
      const heads = tx.objectStore(HEAD_STORE);
      const images = tx.objectStore(IMAGE_STORE);
      const request = heads.get(RECORD_KEY);
      request.onsuccess = () => {
        try {
          const previous = request.result;
          if ((previous?.revision || 0) !== expectedRevision) {
            fail(storageError("SessionConflictError", "Another tab changed the saved session. Reload before saving over it."));
            return;
          }
          const revision = expectedRevision + 1;
          if (!Number.isSafeInteger(revision)) throw new RangeError("The session revision is too large.");
          let metadata = null;
          if (value !== null) {
            if (value.image === null) {
              metadata = { ...value };
              if (previous?.value?.image) images.delete(RECORD_KEY);
            } else {
              const { blob, ...image } = value.image;
              metadata = { ...value, image };
              // Image identities are immutable. Editing annotations must not copy image bytes.
              if (previous?.value?.image?.id !== image.id) images.put({ id: image.id, blob }, RECORD_KEY);
            }
          } else {
            images.delete(RECORD_KEY);
          }
          heads.put({ revision, value: metadata }, RECORD_KEY);
          done(revision);
        } catch (error) {
          fail(error);
        }
      };
    });
  }

  return {
    read,
    write(value, expectedRevision) {
      if (value === null) return Promise.reject(new TypeError("Use clear() to remove a saved session."));
      return update(value, expectedRevision);
    },
    clear: expectedRevision => update(null, expectedRevision),
    close() {
      closed = true;
      connection?.close();
      connection = null;
    },
  };
}
