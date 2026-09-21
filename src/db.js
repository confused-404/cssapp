import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createSeedData } from "./data.js";
import { parseBenchInventory } from "./csv.js";
import { validateAdoption } from "./domain.js";
import { MAX_IMAGES_PER_BENCH } from "./images.js";

const STOCK_ROOT = fileURLToPath(new URL("../assets/stock/", import.meta.url));
const STOCK_IMAGES = [
  { id: "IMG-DEMO-L-001", benchId: "L-001", filename: "eagle-lake-bench.jpg", caption: "Sample gallery photo — bench beside a wooded path." },
  { id: "IMG-DEMO-P-001", benchId: "P-001", filename: "lake-meridian-bench.jpg", caption: "Sample gallery photo — adopted bench in a community park." },
  { id: "IMG-DEMO-A-001", benchId: "A-001", filename: "seneca-lake-bench.jpg", caption: "Sample gallery photo — bench overlooking a lake." }
];

export function openDatabase(filename) {
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS benches (
      id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE, area TEXT NOT NULL, feature TEXT NOT NULL DEFAULT '',
      condition TEXT NOT NULL DEFAULT 'Good', status TEXT NOT NULL CHECK(status IN ('available','pending','adopted')),
      donor_name TEXT, public_name TEXT, dedication TEXT, start_date TEXT, end_date TEXT, duration_months INTEGER
    );
    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY, bench_id TEXT NOT NULL REFERENCES benches(id), donor_name TEXT NOT NULL, email TEXT NOT NULL,
      duration_months INTEGER NOT NULL, dedication TEXT NOT NULL DEFAULT '', show_name INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')), submitted_at TEXT NOT NULL, reviewed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS bench_images (
      id TEXT PRIMARY KEY, bench_id TEXT NOT NULL REFERENCES benches(id) ON DELETE CASCADE,
      filename TEXT NOT NULL, content_type TEXT NOT NULL, caption TEXT NOT NULL DEFAULT '',
      image_data BLOB NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS requests_status_idx ON requests(status);
    CREATE INDEX IF NOT EXISTS bench_images_bench_idx ON bench_images(bench_id, created_at);
  `);
  if (db.prepare("SELECT COUNT(*) AS count FROM benches").get().count === 0) seedDemo(db);
  else if (db.prepare("SELECT value FROM meta WHERE key='data_source'").get()?.value === "demo" && !db.prepare("SELECT value FROM meta WHERE key='stock_images_seeded'").get()) {
    db.exec("BEGIN IMMEDIATE");
    try { seedStockImages(db); db.exec("COMMIT"); }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  return db;
}

function setMeta(db, key, value) {
  db.prepare("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
}

function insertBench(db, bench) {
  db.prepare(`INSERT INTO benches(id,number,area,feature,condition,status,donor_name,public_name,dedication,start_date,end_date,duration_months)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      bench.id, bench.number, bench.area, bench.feature || "", bench.condition || "Good", bench.status,
      bench.adoption?.donorName || null, bench.adoption?.publicName || null, bench.adoption?.dedication || null,
      bench.adoption?.startDate || null, bench.adoption?.endDate || null, bench.adoption?.durationMonths || null
    );
}

export function seedDemo(db) {
  const seed = createSeedData();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("DELETE FROM requests; DELETE FROM benches;");
    seed.benches.forEach((bench) => insertBench(db, bench));
    setMeta(db, "stock_images_seeded", "0");
    seedStockImages(db);
    setMeta(db, "data_source", "demo");
    setMeta(db, "source_name", "Generated evaluation dataset");
    setMeta(db, "updated_at", new Date().toISOString());
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

function seedStockImages(db) {
  for (const image of STOCK_IMAGES) {
    const path = join(STOCK_ROOT, image.filename);
    if (!existsSync(path) || !db.prepare("SELECT 1 FROM benches WHERE id=?").get(image.benchId)) continue;
    db.prepare(`INSERT OR IGNORE INTO bench_images(id,bench_id,filename,content_type,caption,image_data,created_at)
      VALUES(?,?,?,'image/jpeg',?,?,?)`).run(image.id, image.benchId, image.filename, image.caption, readFileSync(path), new Date().toISOString());
  }
  setMeta(db, "stock_images_seeded", "1");
}

function rowToBench(row) {
  return {
    id: row.id, number: row.number, area: row.area, feature: row.feature, condition: row.condition, status: row.status,
    adoption: row.status === "adopted" ? {
      publicName: row.public_name || "Anonymous donor", dedication: row.dedication || "",
      startDate: row.start_date, endDate: row.end_date, durationMonths: row.duration_months
    } : null
  };
}

function rowToRequest(row) {
  return { id: row.id, benchId: row.bench_id, donorName: row.donor_name, email: row.email, durationMonths: row.duration_months,
    dedication: row.dedication, showName: Boolean(row.show_name), status: row.status, submittedAt: row.submitted_at, reviewedAt: row.reviewed_at };
}

export function getState(db) {
  const meta = Object.fromEntries(db.prepare("SELECT key,value FROM meta").all().map((row) => [row.key, row.value]));
  const imageGroups = new Map();
  for (const image of db.prepare("SELECT id,bench_id,filename,content_type,caption,created_at FROM bench_images ORDER BY created_at").all()) {
    const list = imageGroups.get(image.bench_id) || [];
    list.push({ id: image.id, filename: image.filename, contentType: image.content_type, caption: image.caption, createdAt: image.created_at, url: `/api/images/${image.id}` });
    imageGroups.set(image.bench_id, list);
  }
  return {
    benches: db.prepare("SELECT * FROM benches ORDER BY number").all().map((row) => ({ ...rowToBench(row), images: imageGroups.get(row.id) || [] })),
    requests: db.prepare("SELECT * FROM requests ORDER BY submitted_at DESC").all().map(rowToRequest),
    meta
  };
}

export function addBenchImage(db, benchId, { data, contentType, filename, caption = "" }, now = new Date()) {
  if (!db.prepare("SELECT 1 FROM benches WHERE id=?").get(benchId)) throw Object.assign(new Error("That bench could not be found."), { statusCode: 404 });
  const count = db.prepare("SELECT COUNT(*) AS count FROM bench_images WHERE bench_id=?").get(benchId).count;
  if (count >= MAX_IMAGES_PER_BENCH) throw Object.assign(new Error(`A bench can have up to ${MAX_IMAGES_PER_BENCH} photos.`), { statusCode: 409 });
  if (!data?.length) throw Object.assign(new Error("Choose an image to upload."), { statusCode: 400 });
  if (caption.length > 160) throw Object.assign(new Error("Image captions must be 160 characters or fewer."), { statusCode: 400 });
  const id = `IMG-${randomUUID()}`;
  db.prepare("INSERT INTO bench_images(id,bench_id,filename,content_type,caption,image_data,created_at) VALUES(?,?,?,?,?,?,?)")
    .run(id, benchId, String(filename || "bench-photo").slice(0, 200), contentType, caption.trim(), data, now.toISOString());
  return { id, benchId, filename, contentType, caption: caption.trim(), createdAt: now.toISOString(), url: `/api/images/${id}` };
}

export function getBenchImage(db, imageId) {
  const image = db.prepare("SELECT id,bench_id,filename,content_type,caption,image_data,created_at FROM bench_images WHERE id=?").get(imageId);
  if (!image) throw Object.assign(new Error("That image could not be found."), { statusCode: 404 });
  return image;
}

export function deleteBenchImage(db, benchId, imageId) {
  const result = db.prepare("DELETE FROM bench_images WHERE id=? AND bench_id=?").run(imageId, benchId);
  if (!result.changes) throw Object.assign(new Error("That image could not be found for this bench."), { statusCode: 404 });
}

function effectiveStatus(row, now = new Date()) {
  if (row.status === "adopted" && row.end_date && new Date(`${row.end_date}T23:59:59`) < now) return "available";
  return row.status;
}

export function submitRequest(db, input, now = new Date()) {
  const errors = validateAdoption(input);
  if (Object.keys(errors).length) return { errors };
  db.exec("BEGIN IMMEDIATE");
  try {
    const bench = db.prepare("SELECT * FROM benches WHERE id=?").get(input.benchId);
    if (!bench) throw Object.assign(new Error("That bench could not be found."), { statusCode: 404 });
    if (effectiveStatus(bench, now) !== "available") throw Object.assign(new Error("This bench is no longer available."), { statusCode: 409 });
    const id = `REQ-${randomUUID()}`;
    db.prepare(`INSERT INTO requests(id,bench_id,donor_name,email,duration_months,dedication,show_name,status,submitted_at)
      VALUES(?,?,?,?,?,?,?,'pending',?)`).run(id, bench.id, input.donorName.trim(), input.email.trim().toLocaleLowerCase(), Number(input.durationMonths), input.dedication?.trim() || "", input.showName ? 1 : 0, now.toISOString());
    db.prepare("UPDATE benches SET status='pending', donor_name=NULL, public_name=NULL, dedication=NULL, start_date=NULL, end_date=NULL, duration_months=NULL WHERE id=?").run(bench.id);
    setMeta(db, "updated_at", now.toISOString());
    db.exec("COMMIT");
    return { request: rowToRequest(db.prepare("SELECT * FROM requests WHERE id=?").get(id)) };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function reviewRequest(db, requestId, decision, now = new Date()) {
  if (!["approve", "reject"].includes(decision)) throw Object.assign(new Error("Decision must be approve or reject."), { statusCode: 400 });
  db.exec("BEGIN IMMEDIATE");
  try {
    const request = db.prepare("SELECT * FROM requests WHERE id=?").get(requestId);
    if (!request || request.status !== "pending") throw Object.assign(new Error("This request is no longer pending."), { statusCode: 409 });
    const bench = db.prepare("SELECT * FROM benches WHERE id=?").get(request.bench_id);
    if (!bench || bench.status !== "pending") throw Object.assign(new Error("The bench record changed before review."), { statusCode: 409 });
    if (decision === "approve") {
      const end = new Date(now);
      end.setMonth(end.getMonth() + request.duration_months);
      db.prepare(`UPDATE benches SET status='adopted',donor_name=?,public_name=?,dedication=?,start_date=?,end_date=?,duration_months=? WHERE id=?`).run(
        request.donor_name, request.show_name ? request.donor_name : "Anonymous donor", request.dedication,
        now.toISOString().slice(0, 10), end.toISOString().slice(0, 10), request.duration_months, bench.id
      );
    } else db.prepare("UPDATE benches SET status='available' WHERE id=?").run(bench.id);
    db.prepare("UPDATE requests SET status=?,reviewed_at=? WHERE id=?").run(decision === "approve" ? "approved" : "rejected", now.toISOString(), requestId);
    setMeta(db, "updated_at", now.toISOString());
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function importInventory(db, csvText, sourceName = "bench-inventory.csv") {
  const benches = parseBenchInventory(csvText);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("DELETE FROM requests; DELETE FROM benches;");
    benches.forEach((bench) => insertBench(db, bench));
    setMeta(db, "data_source", "imported");
    setMeta(db, "source_name", sourceName);
    setMeta(db, "updated_at", new Date().toISOString());
    db.exec("COMMIT");
    return benches.length;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
