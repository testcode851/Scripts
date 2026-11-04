import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const helper = fileURLToPath(new URL("./project-folder-picker.ps1", import.meta.url));

/** Show a native folder dialog on the same Windows computer running the app. */
export async function pickProjectFolder({ purpose }, options = {}) {
  if (!["create", "open"].includes(purpose)) throw new TypeError("Invalid project folder selection.");
  if ((options.platform || process.platform) !== "win32") {
    throw Object.assign(new Error("Folder browsing is available on Windows. Enter the folder's full path instead."),
      { name: "ProjectFolderPickerError" });
  }
  const run = options.execFile || execFile;
  let result;
  try {
    result = await new Promise((resolve, reject) => {
      run("powershell.exe", ["-NoProfile", "-STA", "-NonInteractive", "-File", helper, "-Purpose", purpose],
        { windowsHide: true, encoding: "utf8", maxBuffer: 1024 * 1024 },
        (error, stdout) => error ? reject(error) : resolve(stdout));
    });
    const value = JSON.parse(String(result).replace(/^\uFEFF/, "").trim());
    if (!value || !Object.hasOwn(value, "folder") || (value.folder !== null && typeof value.folder !== "string")) {
      throw new Error("Invalid folder selection response.");
    }
    return value.folder;
  } catch (cause) {
    throw Object.assign(new Error("The folder browser could not open. Enter the folder's full path instead.", { cause }),
      { name: "ProjectFolderPickerError" });
  }
}
