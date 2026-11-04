import { localProjectClient } from "./local-project-client.js";

function storageError(name, message) {
  const error = new Error(message);
  error.name = name;
  return error;
}

/** Stores recovery metadata and original image files in the current local project. */
export function createSessionStore({ client = localProjectClient, kind = "session" } = {}) {
  if (!["session", "catalog"].includes(kind)) throw new TypeError("Invalid project record type.");
  let closed = false;
  function checkOpen() {
    if (closed) throw storageError("SessionStorageClosedError", "Session storage is closed.");
  }
  async function read() {
    checkOpen();
    const head = await client.json(kind);
    if (!head || !Number.isSafeInteger(head.revision) || head.revision < 0
      || (head.value !== null && head.revision < 1)) {
      throw storageError("SessionStorageDataError", "The saved project record is invalid.");
    }
    if (kind === "catalog" || !head.value || head.value.image === null) return head;
    const { digest, ...image } = head.value.image || {};
    const blob = await client.readImage(image, digest);
    return { revision: head.revision, value: { ...head.value, image: { ...image, blob } } };
  }
  async function update(value, expectedRevision) {
    checkOpen();
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new TypeError("An expected session revision is required.");
    if (!Number.isSafeInteger(expectedRevision + 1)) throw new RangeError("The session revision is too large.");
    let metadata = value;
    if (value !== null) {
      if (value?.image !== null) {
        if (!value?.image?.id || !(value.image.blob instanceof Blob)) throw new TypeError("A session image identity and Blob are required.");
        const { blob, ...image } = value.image;
        metadata = structuredClone({ ...value, image });
        metadata.image.digest = await client.uploadImage({ ...image, blob });
      } else metadata = structuredClone(value);
    }
    checkOpen();
    const saved = await client.json(kind, { method: value === null ? "DELETE" : "PUT", value: {
      expectedRevision, ...(value === null ? {} : { value: metadata }),
    } });
    if (saved.revision !== expectedRevision + 1) throw new Error("Invalid saved session revision.");
    return saved.revision;
  }
  return {
    read,
    write(value, expectedRevision) {
      if (value === null) return Promise.reject(new TypeError("Use clear() to remove a saved session."));
      return update(value, expectedRevision);
    },
    clear: expectedRevision => update(null, expectedRevision),
    close() { closed = true; },
  };
}
