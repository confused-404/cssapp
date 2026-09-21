import test from "node:test";
import assert from "node:assert/strict";
import { getState, importInventory, openDatabase, reviewRequest, submitRequest } from "../src/db.js";

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
