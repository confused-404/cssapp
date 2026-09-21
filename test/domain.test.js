import test from "node:test";
import assert from "node:assert/strict";
import { approveRequest, createRequest, filterBenches, getEffectiveStatus, rejectRequest, validateAdoption } from "../src/domain.js";

const availableBench = () => ({ id: "L-001", number: 1, area: "Van Cortlandt Lake", feature: "Lake views", status: "available", adoption: null });
const validInput = { donorName: "Avery Park", email: "avery@example.com", durationMonths: 36, dedication: "For Sunday walks.", showName: true, agreed: true };

test("expired adoptions become available", () => {
  const bench = { ...availableBench(), status: "adopted", adoption: { endDate: "2025-01-01" } };
  assert.equal(getEffectiveStatus(bench, new Date("2026-01-01T12:00:00Z")), "available");
});

test("filters by query, area, and effective status", () => {
  const benches = [availableBench(), { ...availableBench(), id: "P-002", number: 2, area: "Parade Ground", feature: "Open lawn", status: "pending" }];
  assert.deepEqual(filterBenches(benches, { search: "lake", area: "all", status: "available" }).map((b) => b.id), ["L-001"]);
  assert.deepEqual(filterBenches(benches, { search: "2", area: "Parade Ground", status: "pending" }).map((b) => b.id), ["P-002"]);
});

test("filters benches with and without gallery photos", () => {
  const benches = [
    { ...availableBench(), images: [{ id: "IMG-1" }] },
    { ...availableBench(), id: "P-002", number: 2, images: [] }
  ];
  assert.deepEqual(filterBenches(benches, { photos: "with" }).map((bench) => bench.id), ["L-001"]);
  assert.deepEqual(filterBenches(benches, { photos: "without" }).map((bench) => bench.id), ["P-002"]);
});

test("adoption validation reports missing and malformed values", () => {
  assert.deepEqual(validateAdoption({ donorName: "", email: "bad", durationMonths: 24, dedication: "x".repeat(161), agreed: false }), {
    donorName: "Enter your name.",
    email: "Enter a valid email address.",
    durationMonths: "Choose an adoption term.",
    dedication: "Keep the dedication to 160 characters or fewer.",
    agreed: "Agree to the program terms to continue."
  });
});

test("creates a normalized request for an available bench", () => {
  const request = createRequest(availableBench(), { ...validInput, donorName: "  Avery Park ", email: " AVery@Example.com " }, new Date("2026-09-21T12:00:00Z"));
  assert.equal(request.id, "REQ-1789992000000");
  assert.equal(request.donorName, "Avery Park");
  assert.equal(request.email, "avery@example.com");
  assert.equal(request.status, "pending");
});

test("prevents a request when the bench is no longer available", () => {
  const bench = { ...availableBench(), status: "pending" };
  assert.throws(() => createRequest(bench, validInput), /no longer available/);
});

test("approving a request creates an adoption and respects donor privacy", () => {
  const bench = { ...availableBench(), status: "pending" };
  const state = { benches: [bench], requests: [{ ...createRequest(availableBench(), { ...validInput, showName: false }, new Date("2026-09-21T12:00:00Z")), status: "pending" }] };
  approveRequest(state, state.requests[0].id, new Date("2026-09-22T12:00:00Z"));
  assert.equal(bench.status, "adopted");
  assert.equal(bench.adoption.publicName, "Anonymous donor");
  assert.equal(bench.adoption.endDate, "2029-09-22");
  assert.equal(state.requests[0].status, "approved");
});

test("rejecting a request releases the bench", () => {
  const bench = { ...availableBench(), status: "pending" };
  const state = { benches: [bench], requests: [{ id: "REQ-1", benchId: bench.id, status: "pending" }] };
  rejectRequest(state, "REQ-1", new Date("2026-09-22T12:00:00Z"));
  assert.equal(bench.status, "available");
  assert.equal(state.requests[0].status, "rejected");
});
