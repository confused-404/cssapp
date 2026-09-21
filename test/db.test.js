import test from "node:test";
import assert from "node:assert/strict";
import { addBenchImage, deleteBenchImage, getBenchImage, getState, importInventory, openDatabase, reviewRequest, submitRequest } from "../src/db.js";

const inventory = `bench_id,number,area,feature,condition,status,donor_name,public_name,dedication,start_date,end_date,duration_months
REAL-01,1,Van Cortlandt Lake,Lake views,Good,available,,,,,,
REAL-02,2,Putnam Trail,Paved path,Good,adopted,Jamie Donor,Jamie Donor,For the park,2026-01-01,2029-01-01,36`;
const input = { benchId: "REAL-01", donorName: "Taylor Doe", email: "taylor@example.com", durationMonths: 12, dedication: "For my neighbors", showName: false, agreed: true };

test("imported inventory becomes the live source of truth", () => {
  const db = openDatabase(":memory:");
  assert.equal(importInventory(db, inventory, "real-benches.csv"), 2);
  const state = getState(db);
  assert.equal(state.benches.length, 2);
  assert.equal(state.meta.data_source, "imported");
  assert.equal(state.meta.source_name, "real-benches.csv");
  db.close();
});

test("an empty database is automatically populated before reads", () => {
  const db = openDatabase(":memory:");
  const state = getState(db);
  assert.ok(state.benches.length > 0);
  assert.equal(state.meta.data_source, "demo");
  assert.equal(state.benches.reduce((count, bench) => count + bench.images.length, 0), 3);
  assert.equal(state.meta.stock_images_seeded, "1");
  const pendingBenches = state.benches.filter((bench) => bench.status === "pending");
  const pendingRequests = state.requests.filter((request) => request.status === "pending");
  assert.ok(pendingBenches.length > 0);
  assert.equal(pendingRequests.length, pendingBenches.length);
  assert.deepEqual(new Set(pendingRequests.map((request) => request.benchId)), new Set(pendingBenches.map((bench) => bench.id)));
  db.close();
});

test("request and approval update the same persisted bench record", () => {
  const db = openDatabase(":memory:");
  importInventory(db, inventory);
  const { request } = submitRequest(db, input, new Date("2026-09-21T12:00:00Z"));
  assert.equal(getState(db).benches[0].status, "pending");
  assert.throws(() => submitRequest(db, input), /no longer available/);
  reviewRequest(db, request.id, "approve", new Date("2026-09-22T12:00:00Z"));
  const bench = getState(db).benches[0];
  assert.equal(bench.status, "adopted");
  assert.equal(bench.adoption.publicName, "Anonymous donor");
  assert.equal(bench.adoption.endDate, "2027-09-22");
  db.close();
});

test("bench images are stored, listed without blobs, and removed", () => {
  const db = openDatabase(":memory:");
  importInventory(db, inventory);
  const image = addBenchImage(db, "REAL-01", { data: Buffer.from([0xff, 0xd8, 0xff]), contentType: "image/jpeg", filename: "lake.jpg", caption: "View toward the lake" });
  const publicImage = getState(db).benches[0].images[0];
  assert.equal(publicImage.caption, "View toward the lake");
  assert.equal(publicImage.url, `/api/images/${image.id}`);
  assert.equal(getBenchImage(db, image.id).image_data.length, 3);
  deleteBenchImage(db, "REAL-01", image.id);
  assert.equal(getState(db).benches[0].images.length, 0);
  db.close();
});
