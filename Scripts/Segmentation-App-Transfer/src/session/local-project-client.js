/** All durable editor state lives in a local project served by the app's Node process. */
export function createLocalProjectClient({
  fetchFn = (...args) => globalThis.fetch(...args),
  projectId = new URLSearchParams(globalThis.location?.search || "").get("project"),
} = {}) {
  let opening = null;
  let info = null;
  let token = "";
  let preference = null;
  let preferenceGeneration = 0;
  let savedPreferenceGeneration = 0;
  let preferenceWriting = null;
  let preferenceFailure = null;
  const digests = new WeakMap();
  const uploaded = new Map();
  const idPath = id => encodeURIComponent(id);

  async function call(path, { method = "GET", value, body, headers = {} } = {}) {
    let response;
    try {
      response = await fetchFn(`/api/projects${path}`, {
        method, cache: "no-store", credentials: "same-origin",
        headers: { ...(method !== "GET" ? { "X-Project-Token": token } : {}),
          ...(value !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
        ...(value !== undefined ? { body: JSON.stringify(value) } : body !== undefined ? { body } : {}),
      });
    } catch (cause) {
      throw new Error("The local project server is unavailable. Keep the app server running and retry saving.", { cause });
    }
    if (!response.ok) {
      const failure = await response.json().catch(() => null);
      const error = new Error(failure?.error?.message || `Local project request failed (${response.status}).`);
      error.name = failure?.error?.name || failure?.error?.code || "ProjectStorageError";
      error.status = response.status;
      throw error;
    }
    return response;
  }

  function initialize() {
    // A bare app URL is an empty editor, never the server's last-used project.
    if (!projectId) return Promise.resolve(null);
    if (opening) return opening;
    opening = (async () => {
      const data = await (await call("")).json();
      token = data.token;
      const selected = data.projects?.find(item => item.id === projectId);
      if (!selected || typeof token !== "string" || !token) throw new Error("The selected local project could not be opened.");
      projectId = selected.id;
      const saved = await (await call(`/${idPath(projectId)}/preferences`)).json();
      preference = saved.value?.activeClass || null;
      info = { ...selected };
      return info;
    })().catch(error => { opening = null; throw error; });
    return opening;
  }

  async function request(resource, options) {
    if (!projectId) throw new Error("Open or create a project before saving images or annotations.");
    await initialize();
    return call(`/${idPath(projectId)}/${resource}`, options);
  }
  async function json(resource, options) { return (await request(resource, options)).json(); }
  function digest(blob) {
    if (!digests.has(blob)) {
      const pending = (async () => {
        const hash = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
        return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
      })();
      digests.set(blob, pending);
      pending.catch(() => digests.delete(blob));
    }
    return digests.get(blob);
  }
  async function uploadImage(image, knownDigest) {
    const hash = knownDigest || await digest(image.blob);
    const signature = `${hash}:${image.width}:${image.height}:${image.blob.size}`;
    if (uploaded.get(image.id) === signature) {
      // Clear/remove can release a file still held by Undo. Check before reusing it.
      try {
        const existing = await request(`images/${idPath(image.id)}`, { method: "HEAD" });
        if (existing.headers.get("X-Image-Digest") === hash
          && Number(existing.headers.get("Content-Length")) === image.blob.size) return hash;
      } catch (error) { if (error.status !== 404) throw error; }
      uploaded.delete(image.id);
    }
    if (uploaded.get(image.id) !== signature) {
      const result = await json(`images/${idPath(image.id)}`, { method: "PUT", body: image.blob,
        headers: { "Content-Type": "image/png", "X-Image-Width": String(image.width),
          "X-Image-Height": String(image.height), "X-Image-Digest": hash } });
      if (result.digest !== hash || result.size !== image.blob.size) throw new Error("The saved image failed byte verification.");
      uploaded.set(image.id, signature);
    }
    return hash;
  }
  async function readImage(image, expectedDigest) {
    const blob = await (await request(`images/${idPath(image.id)}`)).blob();
    const hash = await digest(blob);
    if (hash !== expectedDigest) throw new Error("The saved image bytes do not match the project document.");
    uploaded.set(image.id, `${hash}:${image.width}:${image.height}:${blob.size}`);
    return blob;
  }

  function flushPreferences() {
    if (!info) return Promise.resolve();
    if (preferenceWriting) return preferenceWriting;
    if (savedPreferenceGeneration === preferenceGeneration) return Promise.resolve();
    preferenceWriting = (async () => {
      while (savedPreferenceGeneration !== preferenceGeneration) {
        const generation = preferenceGeneration;
        const activeClass = preference;
        await json("preferences", { method: "PUT", value: { value: { activeClass } } });
        savedPreferenceGeneration = generation;
      }
      preferenceFailure = null;
    })().catch(error => { preferenceFailure = error; throw error; }).finally(() => { preferenceWriting = null; });
    return preferenceWriting;
  }
  function changePreference(value) {
    preference = value;
    preferenceGeneration += 1;
    void flushPreferences().catch(() => {});
  }
  async function list() {
    // Project selection must remain available when the current project's files
    // cannot be read. Listing does not require loading that project's preferences.
    const data = await (await call("")).json();
    token = data.token;
    return data;
  }
  return {
    initialize, request, json, digest, uploadImage, readImage, flushPreferences,
    get info() { return info; },
    get preferenceError() { return preferenceFailure; },
    get hasUnsavedPreferences() { return preferenceGeneration !== savedPreferenceGeneration; },
    preferenceStorage: {
      getItem: () => preference,
      setItem: (_key, value) => changePreference(value),
      removeItem: () => changePreference(null),
    },
    list,
    async browse(purpose) {
      await list();
      const result = await (await call("/browse", { method: "POST", value: { purpose } })).json();
      if (result.folder === null || typeof result.folder === "string") return result.folder;
      throw new Error("The folder browser did not return a folder. Enter a folder path instead.");
    },
    async create(name, location) { await list(); return (await call("", { method: "POST", value: { name, location } })).json(); },
    async openFolder(folder) { await list(); return (await call("/open", { method: "POST", value: { folder } })).json(); },
    async activate(id) { await list(); await call(`/${idPath(id)}/activate`, { method: "POST", value: {} }); },
  };
}

export const localProjectClient = createLocalProjectClient();
