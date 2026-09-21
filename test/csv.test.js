import test from "node:test";
import assert from "node:assert/strict";
import { parseBenchInventory } from "../src/csv.js";

test("parses quoted commas and adopted bench details", () => {
  const csv = `bench_id,number,area,feature,status,public_name,dedication,start_date,end_date,duration_months\nL-001,1,"Lake, East",Water,adopted,The Rivera Family,"Love, always",2026-01-01,2029-01-01,36`;
  const [bench] = parseBenchInventory(csv);
  assert.equal(bench.area, "Lake, East");
  assert.equal(bench.adoption.dedication, "Love, always");
  assert.equal(bench.adoption.durationMonths, 36);
});

test("rejects missing columns, duplicates, and incomplete adoptions", () => {
  assert.throws(() => parseBenchInventory("bench_id,number\nL-1,1"), /area/);
  assert.throws(() => parseBenchInventory("bench_id,number,area\nL-1,1,Lake\nL-1,2,Trail"), /duplicate/);
  assert.throws(() => parseBenchInventory("bench_id,number,area,status\nL-1,1,Lake,adopted"), /require start_date/);
});
