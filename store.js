'use strict';
/**
 * Tiny JSON-file data store.
 *
 * Deliberately boring: one JSON document, loaded into memory on first use and
 * written back atomically (write temp file, then rename). That is enough for a
 * single-bakery shop and it removes any dependency on a database server, which
 * matters when the site is hosted on the cheapest tier you can find.
 *
 * When order volume grows, replace the four functions at the bottom of this
 * file with real SQL — nothing else in the codebase touches the file directly.
 */

const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

const EMPTY_DB = {
  users: [],
  sessions: [],
  otpChallenges: [],
  resetTokens: [],
  orders: [],
  contactMessages: [],
  rateLimits: [],
  counters: {},
  meta: { createdAt: null, version: 1 }
};

let db = null;
let writeTimer = null;
let dirty = false;

function ensureDir() {
  fs.mkdirSync(config.DATA_DIR, { recursive: true });
}

function load() {
  if (db) return db;
  ensureDir();
  if (fs.existsSync(config.DB_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(config.DB_FILE, 'utf8'));
      db = { ...structuredClone(EMPTY_DB), ...parsed };
    } catch (err) {
      // A corrupt file must never take the shop offline: move it aside and start clean.
      const backup = `${config.DB_FILE}.corrupt-${Date.now()}`;
      fs.renameSync(config.DB_FILE, backup);
      console.error(`[store] db.json was unreadable, moved to ${backup}:`, err.message);
      db = structuredClone(EMPTY_DB);
    }
  } else {
    db = structuredClone(EMPTY_DB);
  }
  db.meta = db.meta || {};
  db.meta.createdAt = db.meta.createdAt || new Date().toISOString();
  return db;
}

/** Atomic write: a reader never sees a half-written file. */
function flush() {
  if (!dirty) return;
  dirty = false;
  ensureDir();
  const tmp = `${config.DB_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, config.DB_FILE);
}

/** Coalesce bursts of writes (an order can touch five collections at once). */
function save() {
  dirty = true;
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      flush();
    } catch (err) {
      console.error('[store] failed to persist db:', err.message);
    }
  }, 25);
  if (typeof writeTimer.unref === 'function') writeTimer.unref();
}

/** Force an immediate write — used by tests and by process shutdown. */
function saveNow() {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  dirty = true;
  flush();
}

function data() {
  return load();
}

/** Monotonic per-day sequence, used for readable order numbers. */
function nextSequence(key) {
  const d = load();
  d.counters[key] = (d.counters[key] || 0) + 1;
  save();
  return d.counters[key];
}

/** Drop expired sessions, challenges and reset tokens. Cheap enough to run on demand. */
function prune(now = Date.now()) {
  const d = load();
  const before =
    d.sessions.length +
    d.otpChallenges.length +
    d.resetTokens.length +
    d.rateLimits.length;

  d.sessions = d.sessions.filter((s) => s.expiresAt > now);
  d.otpChallenges = d.otpChallenges.filter((c) => c.expiresAt > now - 60_000);
  d.resetTokens = d.resetTokens.filter((t) => t.expiresAt > now && !t.usedAt);
  d.rateLimits = d.rateLimits.filter((r) => r.windowStart > now - 24 * 60 * 60 * 1000);

  const after =
    d.sessions.length +
    d.otpChallenges.length +
    d.resetTokens.length +
    d.rateLimits.length;

  if (after !== before) save();
}

function findUser(predicate) {
  return load().users.find(predicate);
}

function findUserByPhone(phone) {
  return findUser((u) => u.phone === phone);
}

function findUserByEmail(email) {
  if (!email) return undefined;
  const needle = String(email).trim().toLowerCase();
  return findUser((u) => u.email === needle);
}

function insertUser(user) {
  const d = load();
  d.users.push(user);
  save();
  return user;
}

module.exports = {
  data,
  save,
  saveNow,
  prune,
  nextSequence,
  findUser,
  findUserByPhone,
  findUserByEmail,
  insertUser,
  EMPTY_DB
};
