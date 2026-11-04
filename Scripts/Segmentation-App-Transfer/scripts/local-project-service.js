import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { pickProjectFolder } from "./project-folder-picker.js";
import { normalizeClassCatalog } from "../src/model/class-catalog.js";
import { validateSessionSnapshot } from "../src/session/session-snapshot.js";
import { validatePngBytes } from "../src/io/embedded-image-import.js";

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const validId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value)
  && !["__proto__", "constructor", "prototype"].includes(value);
const validFolderName = value => typeof value === "string" && value.length > 0 && value.length <= 120
  && value === value.trim() && !/[<>:"/\\|?*\u0000-\u001f\u007f]/.test(value) && !/[. ]$/.test(value)
  && !/^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(value)
  && ![".", "..", ".server-lock", "projects.json"].includes(value.toLowerCase());
const validDigest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const own = (object, key) => Object.hasOwn(object, key) ? object[key] : undefined;
const validSize = value => isObject(value) && Number.isSafeInteger(value.width) && value.width > 0
  && Number.isSafeInteger(value.height) && value.height > 0;
const inside = (root, target) => target === root || target.startsWith(root + path.sep);
const failure = (status, name, message) => Object.assign(new Error(message), { status, name });
const invalid = message => { throw failure(400, "ProjectStorageDataError", message); };
const checked = (validate, ...values) => {
  try { return validate(...values); } catch (error) { invalid(error.message); }
};
const requireRevision = value => {
  if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(value + 1)) invalid("A valid expected revision is required.");
};

function validateSession(value, { allowEmpty = true } = {}) {
  if (!isObject(value) || value.schemaVersion !== 1 || !Number.isFinite(value.savedAt) || value.savedAt < 0) {
    invalid("The saved session metadata is invalid.");
  }
  if (value.image === null && allowEmpty) {
    checked(validateSessionSnapshot, value.snapshot);
    return;
  }
  const image = value.image;
  if (!validSize(image) || !validId(image.id) || typeof image.fileName !== "string" || !image.fileName.trim()
    || typeof image.fileType !== "string" || !Number.isFinite(image.lastModified) || Object.hasOwn(image, "blob")) {
    invalid("The saved image metadata is invalid.");
  }
  checked(validateSessionSnapshot, value.snapshot, image);
}

function validateBatch(value) {
  const statuses = new Set(["not-started", "in-progress", "complete"]);
  if (!isObject(value) || value.version !== 1 || !validId(value.id) || typeof value.name !== "string"
    || !value.name.trim() || value.name.length > 160 || !Array.isArray(value.items)) invalid("The image batch is invalid.");
  const ids = new Set();
  for (const item of value.items) {
    if (!isObject(item) || !validId(item.id) || ids.has(item.id) || typeof item.name !== "string" || !item.name.trim()
      || !statuses.has(item.status) || !Number.isSafeInteger(item.annotationCount) || item.annotationCount < 0
      || (Object.hasOwn(item, "thumbnailUrl") && (typeof item.thumbnailUrl !== "string" || item.thumbnailUrl.length > 100000
        || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(item.thumbnailUrl)))) invalid("The image queue is invalid.");
    ids.add(item.id);
  }
  if (value.activeId !== null && !ids.has(value.activeId)) invalid("The active image is missing from the queue.");
}

function validateDocument(document) {
  if (!isObject(document) || !validId(document.id) || !validSize(document.displaySize) || !validDigest(document.imageDigest)) {
    invalid("The saved image document is invalid.");
  }
  validateSession(document.session, { allowEmpty: false });
}

function validateCatalog(value) {
  if (!isObject(value) || value.schemaVersion !== 1 || value.image !== null
    || Object.keys(value).some(key => !["schemaVersion", "image", "catalog"].includes(key))) invalid("The saved class catalog is invalid.");
  checked(normalizeClassCatalog, value.catalog);
}

function initialManifest(id, name) {
  return { format: "segmentation-local-project", version: 1, id, name,
    batch: { revision: 0, value: null }, session: { revision: 0, value: null },
    catalog: { revision: 0, value: null }, preferences: { activeClass: null }, documents: {}, images: {} };
}

function validateCleanupManifest(manifest) {
  // Cleanup may remove only files proven unreferenced by a fully readable document set.
  // A damaged manifest is kept intact so a separate healthy project can still open.
  const references = new Set();
  const check = (image, digest) => {
    const record = own(manifest.images, image.id);
    if (!record || !validId(image.id) || record.id !== image.id || !validDigest(digest)
      || record.digest !== digest || record.width !== image.width || record.height !== image.height
      || !Number.isSafeInteger(record.size) || record.size < 1) invalid("The project's image references are invalid.");
    references.add(image.id);
  };
  if (manifest.batch.value !== null) validateBatch(manifest.batch.value);
  const items = new Map((manifest.batch.value?.items || []).map(item => [item.id, item]));
  for (const [id, document] of Object.entries(manifest.documents)) {
    validateDocument(document);
    if (document.id !== id || !items.has(id) || document.session.snapshot.annotations.length !== items.get(id).annotationCount) {
      invalid("The project's saved documents are inconsistent.");
    }
    check(document.session.image, document.imageDigest);
  }
  if (items.size !== Object.keys(manifest.documents).length) invalid("The project's saved documents are incomplete.");
  if (manifest.session.value !== null) {
    validateSession(manifest.session.value);
    if (manifest.session.value.image) check(manifest.session.value.image, manifest.session.value.image.digest);
  }
  if (Object.keys(manifest.images).some(id => !references.has(id))) invalid("The project's saved images are inconsistent.");
}

/** Local project files are authoritative; browser storage is never used here. */
export function createLocalProjectService(options = {}) {
  const token = randomBytes(32).toString("hex");
  const nonce = randomUUID();
  const maxImageBytes = options.maxProjectImageBytes || 256 * 1024 * 1024;
  const projects = new Map();
  const folders = new Map();
  const locks = new Map();
  let currentId = null;
  let closed = false;
  let closing;
  const queues = new Map();
  const staged = new Map();

  function serial(key, operation) {
    if (closed) return Promise.reject(failure(503, "ProjectStorageClosedError", "Local project storage is closed."));
    const next = (queues.get(key) || Promise.resolve()).catch(() => {}).then(operation);
    queues.set(key, next);
    next.finally(() => { if (queues.get(key) === next) queues.delete(key); }).catch(() => {});
    return next;
  }

  async function plainPath(target, directory = false, root = [...projects.values()].find(project => inside(project.folder, target))?.folder) {
    const info = await lstat(target);
    if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())) {
      throw failure(400, "ProjectStorageDataError", "Project files must stay inside their designated folder.");
    }
    if (!root || !inside(root, await realpath(target))) invalid("The project path leaves its designated folder.");
    return target;
  }

  async function atomicJson(target, value) {
    const temporary = `${target}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await open(temporary, "wx");
      await handle.writeFile(JSON.stringify(value));
      await handle.sync();
      await handle.close(); handle = null;
      await options.beforeProjectCommit?.(target, value);
      await rename(temporary, target);
    } finally {
      await handle?.close().catch(() => {});
      await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
    }
  }

  async function acquireLock(directory) {
    const target = path.join(directory, ".server-lock");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const lock = await open(target, "wx");
        locks.set(directory, lock);
        try { await lock.writeFile(JSON.stringify({ pid: process.pid, nonce })); }
        catch (error) { await lock.close(); locks.delete(directory); await unlink(target); throw error; }
        return;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        let stale = false;
        try {
          await plainPath(target, false, directory);
          const owner = JSON.parse(await readFile(target, "utf8"));
          if (Number.isSafeInteger(owner.pid) && owner.pid > 0) {
            try { process.kill(owner.pid, 0); } catch (error) { stale = error.code === "ESRCH"; }
          }
        } catch { /* An unreadable lock must not be removed. */ }
        if (!stale || attempt) throw failure(503, "ProjectStorageLockedError", "Another app server is using this project folder. Stop that server before opening it here.");
        await unlink(target);
      }
    }
  }

  async function releaseLock(directory) {
    const owned = locks.get(directory);
    if (!owned) return;
    locks.delete(directory);
    await owned.close();
    const target = path.join(directory, ".server-lock");
    try {
      if (JSON.parse(await readFile(target, "utf8")).nonce === nonce) await unlink(target);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }

  function folder(id) {
    const project = projects.get(id);
    if (!validId(id) || !project) {
      throw failure(404, "ProjectNotFoundError", "The local project was not found.");
    }
    return project.folder;
  }

  async function manifestAt(directory, expectedId) {
    await plainPath(directory, true, directory);
    const target = await plainPath(path.join(directory, "project.json"), false, directory);
    const value = JSON.parse(await readFile(target, "utf8"));
    if (value.format !== "segmentation-local-project" || value.version !== 1 || !validId(value.id)
      || (expectedId && value.id !== expectedId)
      || !isObject(value.documents) || !isObject(value.images)) invalid("The local project manifest is invalid.");
    for (const section of ["batch", "session", "catalog"]) {
      if (!isObject(value[section]) || !Number.isSafeInteger(value[section].revision) || value[section].revision < 0) invalid("The saved revision is invalid.");
    }
    return value;
  }

  async function readManifest(id) {
    return manifestAt(folder(id), projects.get(id).manifestId);
  }

  const folderKey = directory => process.platform === "win32" ? directory.toLowerCase() : directory;
  const publicEntry = project => ({ id: project.id, name: path.basename(project.folder), folder: project.folder });

  async function selectedDirectory(value) {
    if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")) {
      invalid("Choose an absolute folder location.");
    }
    const resolved = path.resolve(value);
    const info = await lstat(resolved);
    if (info.isSymbolicLink() || !info.isDirectory()) invalid("Choose a regular folder, not a file or folder link.");
    return realpath(resolved);
  }

  async function checkProjectLocation(directory) {
    const appRoot = options.root ? await realpath(options.root) : null;
    if (appRoot && (inside(appRoot, directory) || inside(directory, appRoot))) {
      throw failure(400, "ProjectStorageConfigurationError", "Choose a project folder separate from the app's code folder.");
    }
  }

  async function openProject(selected) {
    const directory = await selectedDirectory(selected);
    await checkProjectLocation(directory);
    const existing = folders.get(folderKey(directory));
    if (existing) {
      await readManifest(existing);
      currentId = existing;
      return publicEntry(projects.get(existing));
    }
    // Validate before taking ownership; unrelated directories are never modified.
    let manifest = await manifestAt(directory);
    await plainPath(path.join(directory, "images"), true, directory);
    await acquireLock(directory);
    try {
      manifest = await manifestAt(directory, manifest.id);
      const project = { id: randomUUID(), manifestId: manifest.id, folder: directory };
      projects.set(project.id, project);
      folders.set(folderKey(directory), project.id);
      // Only remove abandoned uploads when every document/reference is readable.
      try {
        validateCleanupManifest(manifest);
        const images = await plainPath(path.join(directory, "images"), true, directory);
        for (const entry of await readdir(images, { withFileTypes: true })) {
          if (entry.isFile() && /^[A-Za-z0-9_-]{1,100}\.png$/.test(entry.name)
            && !Object.hasOwn(manifest.images, entry.name.slice(0, -4))) await unlink(path.join(images, entry.name));
          if (entry.isFile() && /^upload-[a-f0-9-]+\.tmp$/.test(entry.name)) await unlink(path.join(images, entry.name));
        }
      } catch { /* Preserve damaged projects and their image files for repair. */ }
      currentId = project.id;
      return publicEntry(project);
    } catch (error) { await releaseLock(directory); throw error; }
  }

  async function createProject(name, location) {
    if (!validFolderName(name)) invalid("Choose a valid folder name of at most 120 characters, without reserved names, path characters, or a trailing period or space.");
    const parent = await selectedDirectory(location);
    const directory = path.join(parent, name);
    await checkProjectLocation(directory);
    const duplicate = () => failure(409, "ProjectFolderExistsError", "A folder with this name already exists. Open the existing project or choose a different folder name.");
    if (folders.has(folderKey(directory))
      || (await readdir(parent)).some(entry => entry.toLowerCase() === name.toLowerCase())) throw duplicate();
    try { await mkdir(directory); }
    catch (error) { if (error.code === "EEXIST") throw duplicate(); throw error; }
    const manifest = initialManifest(randomUUID(), name);
    try {
      await mkdir(path.join(directory, "images"));
      await atomicJson(path.join(directory, "project.json"), manifest);
      return await openProject(directory);
    } catch (error) {
      // A failed creation must permit retrying the same folder name. Remove only
      // this operation's unchanged manifest and empty folders, never other files.
      try {
        await plainPath(directory, true, directory);
        const children = await readdir(directory);
        if (children.every(child => ["images", "project.json"].includes(child))) {
          const images = path.join(directory, "images");
          const target = path.join(directory, "project.json");
          const imageFiles = children.includes("images") ? await readdir(await plainPath(images, true, directory)) : [];
          const unchanged = !children.includes("project.json")
            || await readFile(await plainPath(target, false, directory), "utf8") === JSON.stringify(manifest);
          if (!imageFiles.length && unchanged) {
            if (children.includes("project.json")) await unlink(target);
            if (children.includes("images")) await rmdir(images);
            await rmdir(directory);
          }
        }
      } catch { /* Preserve anything that changed or could not be safely removed. */ }
      throw error;
    }
  }

  async function imageRecord(id, imageId, manifest) {
    const record = own(manifest.images, imageId) || staged.get(id)?.get(imageId);
    if (!record || record.id !== imageId || !validDigest(record.digest) || !validSize(record)
      || !Number.isSafeInteger(record.size) || record.size < 1) invalid("The saved image is missing or invalid.");
    const target = await plainPath(path.join(await plainPath(path.join(folder(id), "images"), true), `${imageId}.png`));
    if ((await lstat(target)).size !== record.size) invalid("The saved image size no longer matches its document.");
    return record;
  }

  async function checkImage(id, image, digest, manifest) {
    if (!validDigest(digest)) invalid("A saved image checksum is required.");
    const record = await imageRecord(id, image.id, manifest);
    if (record.digest !== digest || record.width !== image.width || record.height !== image.height) {
      throw failure(400, "ProjectImageIdentityError", "The image bytes or dimensions do not match the saved document.");
    }
    return record;
  }

  async function publish(id, previous, next) {
    const references = new Map();
    for (const document of Object.values(next.documents)) references.set(document.session.image.id,
      await checkImage(id, document.session.image, document.imageDigest, previous));
    if (next.session.value?.image) references.set(next.session.value.image.id,
      await checkImage(id, next.session.value.image, next.session.value.image.digest, previous));
    next.images = Object.fromEntries(references);
    await atomicJson(path.join(folder(id), "project.json"), next);
    for (const imageId of references.keys()) staged.get(id)?.delete(imageId);
    for (const imageId of Object.keys(previous.images)) {
      if (!references.has(imageId)) {
        // Removal is after publication and restricted to a validated generated filename.
        if (validId(imageId)) await unlink(path.join(folder(id), "images", `${imageId}.png`)).catch(() => {});
      }
    }
  }

  async function upload(request, id, imageId) {
    if (!validId(imageId)) invalid("The image identity is invalid.");
    const width = Number(request.headers["x-image-width"]);
    const height = Number(request.headers["x-image-height"]);
    const expected = request.headers["x-image-digest"];
    if (!validSize({ width, height }) || !validDigest(expected)) invalid("Image dimensions and checksum are required.");
    const length = Number(request.headers["content-length"] || 0);
    if (length > maxImageBytes) throw failure(413, "ProjectImageTooLargeError", "This image exceeds the local project upload limit.");
    const directory = await plainPath(path.join(folder(id), "images"), true);
    const temporary = path.join(directory, `upload-${randomUUID()}.tmp`);
    let handle;
    let size = 0;
    const hash = createHash("sha256");
    try {
      handle = await open(temporary, "wx");
      for await (const chunk of request) {
        size += chunk.length;
        if (size > maxImageBytes) throw failure(413, "ProjectImageTooLargeError", "This image exceeds the local project upload limit.");
        hash.update(chunk);
        let offset = 0;
        while (offset < chunk.length) offset += (await handle.write(chunk, offset, chunk.length - offset)).bytesWritten;
      }
      await handle.sync();
      await handle.close(); handle = null;
      const digest = hash.digest("hex");
      if (!size || digest !== expected) invalid("The uploaded image checksum does not match its original bytes.");
      // At most one encoded image is materialized for the shared PNG integrity check.
      const dimensions = checked(validatePngBytes, await readFile(temporary));
      if (dimensions.width !== width || dimensions.height !== height) invalid("The PNG dimensions do not match its metadata.");
      const manifest = await readManifest(id);
      const previous = own(manifest.images, imageId) || staged.get(id)?.get(imageId);
      if (previous) {
        if (previous.digest !== digest || previous.size !== size || previous.width !== width || previous.height !== height) {
          throw failure(409, "ProjectImageIdentityError", "An image identity cannot be reused for different bytes or dimensions.");
        }
        await imageRecord(id, imageId, manifest);
      } else {
        const target = path.join(directory, `${imageId}.png`);
        // An orphan from an interrupted upload may exist; only identical bytes may reuse it.
        try {
          await plainPath(target);
          if (createHash("sha256").update(await readFile(target)).digest("hex") !== digest) {
            throw failure(409, "ProjectImageIdentityError", "An image identity cannot be reused for different image bytes.");
          }
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          await rename(temporary, target);
        }
        if (!staged.has(id)) staged.set(id, new Map());
        staged.get(id).set(imageId, { id: imageId, digest, size, width, height });
      }
      return { digest, size };
    } finally {
      await handle?.close().catch(() => {});
      await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
    }
  }

  async function jsonBody(request) {
    if (!String(request.headers["content-type"] || "").startsWith("application/json")) {
      throw failure(415, "ProjectRequestError", "Send project metadata as application/json.");
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 64 * 1024 * 1024) throw failure(413, "ProjectRequestTooLargeError", "The project metadata request is too large.");
      chunks.push(chunk);
    }
    try {
      const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!isObject(value)) invalid("Project request metadata must be an object.");
      return value;
    } catch (error) {
      if (error.status) throw error;
      invalid("Project request metadata is not valid JSON.");
    }
  }

  function checkRequest(request) {
    let host;
    try { host = new URL(`http://${request.headers.host}`); } catch { throw failure(403, "ProjectAccessError", "Invalid local app host."); }
    const address = request.socket.remoteAddress;
    if (!["127.0.0.1", "localhost", "[::1]"].includes(host.hostname)
      || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address)) throw failure(403, "ProjectAccessError", "Project files are available only to the local app.");
    if (request.headers.origin && request.headers.origin !== host.origin) throw failure(403, "ProjectAccessError", "Project requests must come from this app.");
    if (["cross-site", "same-site"].includes(request.headers["sec-fetch-site"])) throw failure(403, "ProjectAccessError", "Project requests must come from this app.");
    if (request.method !== "GET" && request.headers["x-project-token"] !== token) {
      throw failure(403, "ProjectAccessError", "Reload the app before saving local project files.");
    }
  }

  function send(response, status, value) {
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    response.end(JSON.stringify(value));
  }

  async function handle(request, response) {
    try {
      checkRequest(request);
      if (closed) throw failure(503, "ProjectStorageClosedError", "Local project storage is closed.");
      const url = new URL(request.url, "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length === 2) {
        if (request.method === "GET") {
          const entries = [];
          for (const item of projects.values()) {
            const entry = publicEntry(item);
            try {
              await readManifest(item.id);
            } catch (error) {
              entry.error = error.message || "This project's saved files could not be read.";
            }
            entries.push(entry);
          }
          send(response, 200, { token, currentId, projects: entries });
        } else if (request.method === "POST") {
          const body = await jsonBody(request);
          send(response, 201, await serial("registry", () => createProject(body.name, body.location)));
        } else throw failure(405, "ProjectRequestError", "Unsupported project operation.");
        return;
      }
      const [, , id, section, imageId] = parts;
      if (parts.length === 3 && ["browse", "open"].includes(id) && request.method === "POST") {
        const body = await jsonBody(request);
        if (id === "browse") {
          if (!["create", "open"].includes(body.purpose)) invalid("Choose whether to create or open a project.");
          const selected = await serial("picker", () => (options.pickProjectFolder || pickProjectFolder)({ purpose: body.purpose }));
          send(response, 200, { folder: selected == null ? null : await selectedDirectory(selected) });
        } else send(response, 200, await serial("registry", () => openProject(body.folder)));
        return;
      }
      folder(id);
      if (parts.length > 5) throw failure(404, "ProjectNotFoundError", "The project resource was not found.");
      if (section === "activate" && parts.length === 4 && request.method === "POST") {
        await jsonBody(request);
        await serial("registry", async () => {
          await readManifest(id);
          currentId = id;
        });
        send(response, 200, { id }); return;
      }
      if (section === "images" && parts.length === 5 && validId(imageId)) {
        if (request.method === "PUT") send(response, 200, await serial(id, () => upload(request, id, imageId)));
        else if (request.method === "GET" || request.method === "HEAD") {
          await serial(id, async () => {
            const manifest = await readManifest(id);
            if (request.method === "HEAD" && !own(manifest.images, imageId) && !staged.get(id)?.has(imageId)) {
              throw failure(404, "ProjectStorageDataError", "The saved image is missing.");
            }
            const image = await imageRecord(id, imageId, manifest);
            response.writeHead(200, { "Content-Type": "image/png", "Content-Length": image.size,
              "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Image-Digest": image.digest });
            if (request.method === "HEAD") response.end();
            else await pipeline(createReadStream(path.join(folder(id), "images", `${imageId}.png`)), response);
          });
        } else throw failure(405, "ProjectRequestError", "Unsupported image operation.");
        return;
      }
      if (section === "documents" && parts.length === 5 && validId(imageId) && request.method === "GET") {
        const manifest = await readManifest(id);
        const document = own(manifest.documents, imageId);
        if (!document) throw failure(404, "ProjectStorageDataError", "The requested image document is missing.");
        validateDocument(document);
        await checkImage(id, document.session.image, document.imageDigest, manifest);
        send(response, 200, document); return;
      }
      if (!["batch", "session", "catalog", "preferences"].includes(section) || parts.length !== 4) {
        throw failure(404, "ProjectNotFoundError", "The project resource was not found.");
      }
      if (request.method === "GET") {
        const manifest = await readManifest(id);
        if (section === "batch" && manifest.batch.value) validateBatch(manifest.batch.value);
        // The catalog reader needs the observed revision to explicitly replace a corrupt catalog.
        // Writes remain validated; a read never repairs or resets data implicitly.
        if (section === "session" && manifest.session.value) {
          validateSession(manifest.session.value);
          if (manifest.session.value.image) await checkImage(id, manifest.session.value.image, manifest.session.value.image.digest, manifest);
        }
        send(response, 200, section === "preferences" ? { value: manifest.preferences || { activeClass: null } } : manifest[section]); return;
      }
      if (request.method !== "PUT" && !(section === "session" && request.method === "DELETE")) {
        throw failure(405, "ProjectRequestError", "Unsupported project operation.");
      }
      const body = await jsonBody(request);
      const result = await serial(id, async () => {
        const manifest = await readManifest(id);
        if (section === "preferences") {
          const value = body.value;
          if (!isObject(value) || Object.keys(value).some(key => key !== "activeClass")
            || (value.activeClass !== null && (typeof value.activeClass !== "string" || value.activeClass.length > 1024))) invalid("Invalid active class preference.");
          if (value.activeClass !== null) {
            let choice;
            try { choice = JSON.parse(value.activeClass); } catch { invalid("Invalid active class preference."); }
            if (!isObject(choice) || choice.version !== 1 || !Number.isSafeInteger(choice.id) || choice.id < 0
              || typeof choice.name !== "string" || !choice.name.trim()) invalid("Invalid active class preference.");
          }
          await atomicJson(path.join(folder(id), "project.json"), { ...manifest, preferences: value });
          return { value };
        }
        requireRevision(body.expectedRevision);
        if (manifest[section].revision !== body.expectedRevision) {
          throw failure(409, section === "batch" ? "ProjectConflictError" : "SessionConflictError", "Another tab changed the saved project. Reload before saving over it.");
        }
        const value = request.method === "DELETE" ? null : body.value;
        const next = structuredClone(manifest);
        if (section === "batch") {
          validateBatch(value);
          if (!Array.isArray(body.documents || [])) invalid("Project documents must be an array.");
          const supplied = new Map();
          const items = new Map(value.items.map(item => [item.id, item]));
          for (const document of body.documents || []) {
            validateDocument(document);
            if (!items.has(document.id) || supplied.has(document.id)) invalid("Saved documents must appear exactly once in the image list.");
            supplied.set(document.id, document);
          }
          const documents = {};
          for (const item of value.items) {
            const document = supplied.get(item.id) || own(manifest.documents, item.id);
            if (!document) invalid("A document is missing from the image batch.");
            validateDocument(document);
            if (document.session.snapshot.annotations.length !== item.annotationCount) invalid("The image queue's annotation count does not match the document.");
            documents[item.id] = document;
          }
          next.documents = documents;
        } else if (section === "session" && value !== null) validateSession(value);
        else if (section === "catalog") validateCatalog(value);
        const revision = body.expectedRevision + 1;
        next[section] = { revision, value };
        await publish(id, manifest, next);
        return { revision };
      });
      send(response, 200, result);
    } catch (error) {
      if (response.headersSent) { response.destroy(error); return; }
      const status = error.status || (error.code === "ENOENT" ? 404 : error instanceof SyntaxError || error instanceof TypeError ? 400 : 503);
      send(response, status, { error: { name: error.name || "ProjectStorageError", message: error.message || "Local project files could not be saved." } });
    }
  }

  return {
    handle,
    async isProtectedPath(target) {
      if (["project.json", "projects.json", ".server-lock"].includes(path.basename(target).toLowerCase())) return true;
      if ([...projects.values()].some(project => inside(project.folder, target))) return true;
      // An unopened project reached through a static-folder junction is private too.
      for (let directory = path.dirname(target);;) {
        try { await lstat(path.join(directory, "project.json")); return true; }
        catch (error) { if (error.code !== "ENOENT") return true; }
        const parent = path.dirname(directory);
        if (parent === directory) return false;
        directory = parent;
      }
    },
    close() {
      if (closing) return closing;
      closed = true;
      closing = (async () => {
        await Promise.allSettled([...queues.values()]);
        await Promise.all([...locks.keys()].map(releaseLock));
        projects.clear(); folders.clear(); staged.clear(); currentId = null;
      })();
      return closing;
    },
  };
}
