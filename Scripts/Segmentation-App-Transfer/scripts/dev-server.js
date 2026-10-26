import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAnalyticsHandler } from "./analytics-service.js";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
]);

/** Share the development request handler with API integration tests. */
export function createAppServer(options = {}) {
  const appRoot = options.root || root;
  const analytics = createAnalyticsHandler({ ...options, root: appRoot });
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://" + (request.headers.host || "localhost"));
      if (url.pathname === "/api/analytics/widths" || url.pathname === "/api/analytics/figure") {
        await analytics(request, response);
        return;
      }
      const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
      const filePath = path.resolve(appRoot, "." + pathname);
      if (filePath !== appRoot && !filePath.startsWith(appRoot + path.sep)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) throw new Error("Not a file");
      const body = await readFile(filePath);
      response.writeHead(200, {
        "Content-Type": contentTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      response.end(body);
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  createAppServer().listen(port, "127.0.0.1", () => {
    console.log("Segmentation Annotator: http://127.0.0.1:" + port);
  });
}
