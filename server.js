import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { addBenchImage, deleteBenchImage, getBenchImage, getState, importInventory, openDatabase, reviewRequest, seedDemo, submitRequest } from "./src/db.js";
import { detectImageType, MAX_IMAGE_BYTES } from "./src/images.js";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT) || 4173;
const db = openDatabase(process.env.DATABASE_PATH || join(ROOT, "data", "benches.db"));
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json" };

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

async function readBuffer(request, limit = 2_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Request body is too large."), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readBody(request, limit) { return (await readBuffer(request, limit)).toString("utf8"); }

async function api(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/state") return json(response, 200, getState(db));
  const publicImageMatch = url.pathname.match(/^\/api\/images\/([^/]+)$/);
  if (request.method === "GET" && publicImageMatch) {
    const image = getBenchImage(db, decodeURIComponent(publicImageMatch[1]));
    response.writeHead(200, { "content-type": image.content_type, "content-length": image.image_data.length, "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" });
    return response.end(image.image_data);
  }
  if (request.method === "POST" && url.pathname === "/api/requests") {
    const result = submitRequest(db, JSON.parse(await readBody(request)));
    return json(response, result.errors ? 422 : 201, result);
  }
  const reviewMatch = url.pathname.match(/^\/api\/requests\/([^/]+)$/);
  if (request.method === "PATCH" && reviewMatch) {
    const { decision } = JSON.parse(await readBody(request));
    reviewRequest(db, decodeURIComponent(reviewMatch[1]), decision);
    return json(response, 200, { ok: true });
  }
  if (request.method === "POST" && url.pathname === "/api/admin/import") {
    const sourceName = request.headers["x-source-name"] || "bench-inventory.csv";
    const count = importInventory(db, await readBody(request), String(sourceName).slice(0, 200));
    return json(response, 200, { ok: true, count });
  }
  const uploadMatch = url.pathname.match(/^\/api\/admin\/benches\/([^/]+)\/images$/);
  if (request.method === "POST" && uploadMatch) {
    const data = await readBuffer(request, MAX_IMAGE_BYTES);
    const contentType = detectImageType(data);
    if (!contentType) throw Object.assign(new Error("Upload a JPEG, PNG, WebP, or GIF image."), { statusCode: 415 });
    const image = addBenchImage(db, decodeURIComponent(uploadMatch[1]), {
      data, contentType, filename: url.searchParams.get("filename") || "bench-photo", caption: url.searchParams.get("caption") || ""
    });
    return json(response, 201, { image });
  }
  const deleteImageMatch = url.pathname.match(/^\/api\/admin\/benches\/([^/]+)\/images\/([^/]+)$/);
  if (request.method === "DELETE" && deleteImageMatch) {
    deleteBenchImage(db, decodeURIComponent(deleteImageMatch[1]), decodeURIComponent(deleteImageMatch[2]));
    return json(response, 200, { ok: true });
  }
  if (request.method === "POST" && url.pathname === "/api/admin/reset-demo") {
    seedDemo(db);
    const state = getState(db);
    return json(response, 200, { ok: true, pendingRequests: state.requests.filter((item) => item.status === "pending").length });
  }
  return json(response, 404, { error: "API endpoint not found." });
}

function staticFile(request, response, url) {
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const file = join(ROOT, safePath);
  if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    return response.end("Not found");
  }
  response.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
  if (request.method === "HEAD") return response.end();
  createReadStream(file).pipe(response);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) await api(request, response, url);
    else staticFile(request, response, url);
  } catch (error) {
    console.error(error);
    json(response, error.statusCode || (error instanceof SyntaxError ? 400 : 500), { error: error.message || "Unexpected server error." });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`Bench Adoption running at http://localhost:${PORT}`));
