import test from "node:test";
import assert from "node:assert/strict";
import { authenticateAdmin, createAdmin, createAdminSession, deleteAdminSession, getAdminForSession } from "../src/auth.js";
import { openDatabase } from "../src/db.js";

test("demo database includes the requested test administrator", () => {
  const db = openDatabase(":memory:");
  assert.equal(authenticateAdmin(db, { email: "TEST@gmail.com", password: "test" }).email, "test@gmail.com");
  assert.equal(authenticateAdmin(db, { email: "test@gmail.com", password: "wrong" }), null);
  db.close();
});

test("signup validates and hashes credentials", () => {
  const db = openDatabase(":memory:");
  const admin = createAdmin(db, { email: "new@example.com", password: "safe-pass" });
  assert.equal(admin.email, "new@example.com");
  const stored = db.prepare("SELECT * FROM admins WHERE id=?").get(admin.id);
  assert.notEqual(stored.password_hash, "safe-pass");
  assert.throws(() => createAdmin(db, { email: "NEW@example.com", password: "again" }), /already exists/);
  assert.throws(() => createAdmin(db, { email: "bad", password: "safe-pass" }), /valid email/);
  db.close();
});

test("server-side sessions can be created, resolved, and revoked", () => {
  const db = openDatabase(":memory:");
  const admin = authenticateAdmin(db, { email: "test@gmail.com", password: "test" });
  const session = createAdminSession(db, admin.id, new Date("2026-09-21T12:00:00Z"));
  assert.equal(getAdminForSession(db, session.token, new Date("2026-09-22T12:00:00Z")).email, admin.email);
  assert.equal(getAdminForSession(db, session.token, new Date("2026-10-01T12:00:00Z")), null);
  deleteAdminSession(db, session.token);
  assert.equal(getAdminForSession(db, session.token, new Date("2026-09-22T12:00:00Z")), null);
  db.close();
});
