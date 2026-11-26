// Local static server for development: `npm run serve` -> http://localhost:8000
// (Python's http.server only queues 5 connections and drops some of the ~60 parallel
//  module requests the 4D globe makes; this one doesn't.)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = +(process.env.PORT || 8000);
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".wasm": "application/wasm", ".tflite": "application/octet-stream", ".md": "text/plain; charset=utf-8" };

const server = createServer(async (req, res) => {
  let path;
  try { path = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch { res.writeHead(400).end(); return; }
  if (path.endsWith("/")) path += "index.html";
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT + sep)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(body);
  } catch { res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found"); }
});
server.listen({ port: PORT, host: "127.0.0.1", backlog: 512 }, () => console.log(`Food Safety Watch: http://localhost:${PORT}`));
