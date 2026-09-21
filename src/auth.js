import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

const SESSION_DAYS = 7;

export function initializeAuth(db, { seedDemoAdmin = false } = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS admin_sessions_expiry_idx ON admin_sessions(expires_at);
  `);
  db.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").run(new Date().toISOString());
  if (seedDemoAdmin && !db.prepare("SELECT 1 FROM admins WHERE email=?").get("test@gmail.com")) {
    createAdmin(db, { email: "test@gmail.com", password: "test" });
  }
}

function normalizeEmail(value) { return String(value || "").trim().toLocaleLowerCase(); }

function validateCredentials({ email, password }) {
  const normalizedEmail = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw Object.assign(new Error("Enter a valid email address."), { statusCode: 400 });
  if (typeof password !== "string" || password.length < 4) throw Object.assign(new Error("Password must be at least 4 characters."), { statusCode: 400 });
  if (password.length > 200) throw Object.assign(new Error("Password is too long."), { statusCode: 400 });
  return normalizedEmail;
}

function passwordDigest(password, salt) { return scryptSync(password, salt, 64).toString("hex"); }
function sessionDigest(token) { return createHash("sha256").update(token).digest("hex"); }
function safeAdmin(row) { return row ? { id: row.id, email: row.email, createdAt: row.created_at } : null; }

export function createAdmin(db, credentials, now = new Date()) {
  const email = validateCredentials(credentials);
  if (db.prepare("SELECT 1 FROM admins WHERE email=?").get(email)) throw Object.assign(new Error("An account with that email already exists."), { statusCode: 409 });
  const id = `ADMIN-${randomUUID()}`;
  const salt = randomBytes(16).toString("hex");
  db.prepare("INSERT INTO admins(id,email,password_hash,password_salt,created_at) VALUES(?,?,?,?,?)")
    .run(id, email, passwordDigest(credentials.password, salt), salt, now.toISOString());
  return safeAdmin(db.prepare("SELECT * FROM admins WHERE id=?").get(id));
}

export function authenticateAdmin(db, credentials) {
  const email = validateCredentials(credentials);
  const row = db.prepare("SELECT * FROM admins WHERE email=?").get(email);
  if (!row) return null;
  const actual = Buffer.from(row.password_hash, "hex");
  const candidate = Buffer.from(passwordDigest(credentials.password, row.password_salt), "hex");
  return actual.length === candidate.length && timingSafeEqual(actual, candidate) ? safeAdmin(row) : null;
}

export function createAdminSession(db, adminId, now = new Date()) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(now);
  expires.setDate(expires.getDate() + SESSION_DAYS);
  db.prepare("INSERT INTO admin_sessions(token_hash,admin_id,expires_at,created_at) VALUES(?,?,?,?)")
    .run(sessionDigest(token), adminId, expires.toISOString(), now.toISOString());
  return { token, expiresAt: expires.toISOString() };
}

export function getAdminForSession(db, token, now = new Date()) {
  if (!token) return null;
  const row = db.prepare(`SELECT a.* FROM admin_sessions s JOIN admins a ON a.id=s.admin_id
    WHERE s.token_hash=? AND s.expires_at>?`).get(sessionDigest(token), now.toISOString());
  return safeAdmin(row);
}

export function deleteAdminSession(db, token) {
  if (token) db.prepare("DELETE FROM admin_sessions WHERE token_hash=?").run(sessionDigest(token));
}
