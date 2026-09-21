import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { addBenchImage, deleteBenchImage, getBenchImage, getState, importInventory, openDatabase, reviewRequest, seedDemo, submitRequest } from "./src/db.js";
import { detectImageType, MAX_IMAGE_BYTES } from "./src/images.js";
import { authenticateAdmin, createAdmin, createAdminSession, deleteAdminSession, getAdminForSession } from "./src/auth.js";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT) || 4173;
const db = openDatabase(process.env.DATABASE_PATH || join(ROOT, "data", "benches.db"));
const ALLOW_OPEN_SIGNUP = process.env.ALLOW_OPEN_SIGNUP === "true";
const PUBLIC_FILES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/styles.css", "styles.css"],
  ["/src/app.js", "src/app.js"],
  ["/src/domain.js", "src/domain.js"],
  ["/assets/stock/van-cortlandt-lake-hero.jpg", "assets/stock/van-cortlandt-lake-hero.jpg"]
]);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" };

function json(response, status, value, headers = {}) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  response.end(JSON.stringify(value));
}

function sessionToken(request) {
  const cookies = Object.fromEntries(String(request.headers.cookie || "").split(";").map((part) => part.trim().split(/=(.*)/s).slice(0, 2)).filter(([key]) => key));
  return cookies.bench_session ? decodeURIComponent(cookies.bench_session) : null;
}

function requireAdmin(request) {
  const admin = getAdminForSession(db, sessionToken(request));
  if (!admin) throw Object.assign(new Error("Log in to access the staff workspace."), { statusCode: 401 });
  return admin;
}

function sessionCookie(token, maxAge = 60 * 60 * 24 * 7) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `bench_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
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
  if (request.method === "POST" && url.pathname === "/api/auth/signup") {
    if (!ALLOW_OPEN_SIGNUP) throw Object.assign(new Error("Open staff signup is disabled. Ask an administrator for an account."), { statusCode: 403 });
    const credentials = JSON.parse(await readBody(request));
    const admin = createAdmin(db, credentials);
    const session = createAdminSession(db, admin.id);
    return json(response, 201, { admin }, { "set-cookie": sessionCookie(session.token) });
  }
  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    const credentials = JSON.parse(await readBody(request));
    const admin = authenticateAdmin(db, credentials);
    if (!admin) throw Object.assign(new Error("Email or password is incorrect."), { statusCode: 401 });
    const session = createAdminSession(db, admin.id);
    return json(response, 200, { admin }, { "set-cookie": sessionCookie(session.token) });
  }
  if (request.method === "GET" && url.pathname === "/api/auth/session") return json(response, 200, { admin: getAdminForSession(db, sessionToken(request)) });
  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    deleteAdminSession(db, sessionToken(request));
    return json(response, 200, { ok: true }, { "set-cookie": sessionCookie("", 0) });
  }
  if (request.method === "GET" && url.pathname === "/api/state") {
    const { benches, meta } = getState(db);
    return json(response, 200, { benches, requests: [], meta });
  }
  if (request.method === "GET" && url.pathname === "/api/admin/state") {
    requireAdmin(request);
    return json(response, 200, getState(db));
  }
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
    requireAdmin(request);
    const { decision } = JSON.parse(await readBody(request));
    reviewRequest(db, decodeURIComponent(reviewMatch[1]), decision);
    return json(response, 200, { ok: true });
  }
  if (request.method === "POST" && url.pathname === "/api/admin/import") {
    requireAdmin(request);
    const sourceName = request.headers["x-source-name"] || "bench-inventory.csv";
    const count = importInventory(db, await readBody(request), String(sourceName).slice(0, 200));
    return json(response, 200, { ok: true, count });
  }
  const uploadMatch = url.pathname.match(/^\/api\/admin\/benches\/([^/]+)\/images$/);
  if (request.method === "POST" && uploadMatch) {
    requireAdmin(request);
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
    requireAdmin(request);
    deleteBenchImage(db, decodeURIComponent(deleteImageMatch[1]), decodeURIComponent(deleteImageMatch[2]));
    return json(response, 200, { ok: true });
  }
  if (request.method === "POST" && url.pathname === "/api/admin/reset-demo") {
    requireAdmin(request);
    if (getState(db).meta.data_source === "imported") throw Object.assign(new Error("Demo reset is unavailable while imported inventory is active."), { statusCode: 409 });
    seedDemo(db);
    const state = getState(db);
    return json(response, 200, { ok: true, pendingRequests: state.requests.filter((item) => item.status === "pending").length });
  }
  return json(response, 404, { error: "API endpoint not found." });
}

function staticFile(request, response, url) {
  const relativePath = PUBLIC_FILES.get(url.pathname);
  const file = relativePath ? join(ROOT, relativePath) : null;
  if (!file || !existsSync(file) || !statSync(file).isFile()) {
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
