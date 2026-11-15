/* ==========================================================================
   Khuzestan Yeast Co. — SQLite data layer
   --------------------------------------------------------------------------
   Single file database: server/data/khyeast.db  (WAL mode, transactional)

   Stored here : editorial CMS sections and revisions; shop products/display;
                 payment credentials; orders + order items; product comments;
                 contact messages and other operational state.
   Stored as files: server/uploads/* (admin media).

   The public/admin HTTP contract remains unchanged: normalized SQLite rows are
   rebuilt into the same content object clients already consume.
   ========================================================================== */
import { createDatabase } from './sqlite.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import DEFAULT_STATE from '../shared/contentDefaults.js';
import { SHOP_SEED } from './seed.js';
import { sanitizeRichText } from './sanitize.js';
import { normalizeProductImages } from '../shared/productImages.js';

/* ------------------------------------------------------------------ open */
export const DATABASE_APPLICATION_ID = 0x4b485945; // "KHYE"
export const DATABASE_SCHEMA_VERSION = 1;

const schemaError = (detail) => Object.assign(
  new Error(
    'SQLite schema is incompatible and automatic startup upgrades are disabled; ' +
    'run `npm run db:migrate` for a supported older schema, or restore a compatible backup ' +
    `(${detail})`,
  ),
  { code: 'DB_SCHEMA_INCOMPATIBLE' },
);

const pragmaNumber = (db, name) => {
  const row = db.prepare(`PRAGMA ${name}`).get();
  return Number(row?.[name] ?? Object.values(row || {})[0] ?? 0);
};

const REQUIRED_SCHEMA = Object.freeze({
  settings: ['key', 'value'],
  content_meta: ['id', 'revision', 'initialized_at', 'updated_at'],
  content_sections: ['section', 'value_json', 'revision', 'updated_at'],
  rate_limit_hits: ['id', 'kind', 'bucket_hash', 'bucket_version', 'at', 'pending'],
  products: [
    'slug', 'pos', 'title', 'brand', 'product_slug', 'unit', 'image', 'images',
    'price', 'old_price', 'stock', 'active', 'featured', 'comments_locked',
    'short', 'description', 'specs',
  ],
  orders: [
    'id', 'code', 'token', 'customer_id', 'customer', 'subtotal', 'shipping',
    'total', 'currency', 'status', 'provider', 'pay_authority', 'pay_ref',
    'admin_note', 'at', 'paid_at', 'auto_cancelled', 'needs_attention', 'archived',
  ],
  order_payments: [
    'authority', 'order_id', 'provider', 'status', 'ref_id', 'at', 'verified_at',
    'reversal_started_at', 'reversed_at', 'last_error',
  ],
  order_items: ['order_id', 'pos', 'slug', 'title', 'unit', 'price', 'qty', 'sum'],
  comments: ['id', 'slug', 'name', 'text', 'at', 'approved', 'reply', 'reply_at'],
  messages: ['id', 'name', 'phone', 'email', 'subject', 'message', 'at', 'read'],
  sms_log: [
    'id', 'at', 'kind', 'phone', 'text', 'provider', 'environment', 'ok', 'error',
    'message_id', 'ref',
  ],
  customers: ['id', 'phone', 'name', 'email', 'pass_hash', 'at', 'last_login_at', 'blocked'],
  customer_sessions: ['token_hash', 'customer_id', 'at', 'expires_at', 'ua'],
  otps: ['phone', 'purpose', 'code_hash', 'at', 'expires_at', 'attempts'],
  otp_tickets: ['ticket_hash', 'phone', 'purpose', 'expires_at'],
  addresses: [
    'id', 'customer_id', 'pos', 'is_default', 'title', 'receiver', 'phone',
    'province', 'city', 'address', 'plaque', 'unit', 'postal', 'note', 'at',
  ],
});

const REQUIRED_INDEXES = Object.freeze([
  'idx_content_sections_revision',
  'idx_rate_limit_bucket', 'idx_rate_limit_at',
  'idx_products_pos',
  'idx_orders_at', 'idx_orders_status', 'idx_orders_status_at', 'idx_orders_customer',
  'idx_orders_attention_at', 'idx_orders_archived_at', 'idx_orders_pay_authority',
  'idx_order_payments_order', 'idx_items_order',
  'idx_comments_slug', 'idx_comments_at', 'idx_comments_public_page',
  'idx_messages_at', 'idx_sms_at', 'idx_sms_phone',
  'idx_sessions_customer', 'idx_addresses_customer',
]);

export async function openDB(file, { allowCreate = !fs.existsSync(file) } = {}) {
  if (!allowCreate && !fs.existsSync(file)) {
    throw schemaError('database file is missing from an established state tree');
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = await createDatabase(file);
  try {
    ensureSchema(db, { allowCreate });
    db.pragma('journal_mode = WAL'); // safe concurrent readers + one writer
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    return db;
  } catch (error) {
    try { db.close(); } catch {}
    throw error;
  }
}

/** Create the complete schema only for an empty database. Existing databases
 * must already match this release exactly; startup never imports, alters,
 * backfills, or otherwise upgrades persistent state. */
function ensureSchema(db, { allowCreate = false } = {}) {
  const userTableCount = () => Number(db.prepare(
    `SELECT COUNT(*) AS count
       FROM sqlite_schema
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
  ).get()?.count || 0);

  if (allowCreate) {
    db.immediateTransaction(() => {
      if (userTableCount() !== 0) return;
      db.exec(`
    CREATE TABLE settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    /* Mutable editorial content is revisioned by section. One global revision
       identifies the complete content snapshot (including normalized shop
       rows), while per-section revisions show which editorial buckets changed. */
    CREATE TABLE content_meta (
      id             INTEGER PRIMARY KEY CHECK (id = 1),
      revision       INTEGER NOT NULL CHECK (revision >= 1),
      initialized_at TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    );
    CREATE TABLE content_sections (
      section    TEXT PRIMARY KEY,
      value_json TEXT NOT NULL CHECK (json_valid(value_json)),
      revision   INTEGER NOT NULL CHECK (revision >= 1),
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_content_sections_revision
      ON content_sections(revision);

    /* Short-lived abuse counters are shared through SQLite so several
       Passenger workers enforce one real ceiling instead of multiplying it by
       the process count. Bucket keys are secret-keyed before reaching here. */
    CREATE TABLE rate_limit_hits (
      id             TEXT PRIMARY KEY,
      kind           TEXT NOT NULL,
      bucket_hash    TEXT NOT NULL,
      bucket_version INTEGER NOT NULL DEFAULT 2,
      at             INTEGER NOT NULL,
      pending        INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_rate_limit_bucket
      ON rate_limit_hits(kind, bucket_hash, at);
    CREATE INDEX idx_rate_limit_at ON rate_limit_hits(at);

    CREATE TABLE products (
      slug           TEXT PRIMARY KEY,
      pos            INTEGER NOT NULL DEFAULT 0,
      title          TEXT NOT NULL DEFAULT '',
      brand          TEXT NOT NULL DEFAULT '',
      product_slug   TEXT NOT NULL DEFAULT '',
      unit           TEXT NOT NULL DEFAULT '',
      image          TEXT NOT NULL DEFAULT '',
      images         TEXT NOT NULL DEFAULT '[]',
      price          INTEGER NOT NULL DEFAULT 0,
      old_price      INTEGER,
      stock          INTEGER NOT NULL DEFAULT -1,
      active         INTEGER NOT NULL DEFAULT 1,
      featured       INTEGER NOT NULL DEFAULT 0,
      comments_locked INTEGER NOT NULL DEFAULT 0,
      short          TEXT NOT NULL DEFAULT '',
      description    TEXT NOT NULL DEFAULT '',
      specs          TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX idx_products_pos ON products(pos);

    CREATE TABLE orders (
      id         TEXT PRIMARY KEY,
      code       TEXT NOT NULL UNIQUE,
      token      TEXT NOT NULL,
      customer_id TEXT,
      customer   TEXT NOT NULL DEFAULT '{}',
      subtotal   INTEGER NOT NULL DEFAULT 0,
      shipping   INTEGER NOT NULL DEFAULT 0,
      total      INTEGER NOT NULL DEFAULT 0,
      currency   TEXT NOT NULL DEFAULT 'IRR',
      status     TEXT NOT NULL DEFAULT 'pending_payment',
      provider   TEXT NOT NULL DEFAULT 'offline',
      pay_authority TEXT,
      pay_ref    TEXT,
      admin_note TEXT NOT NULL DEFAULT '',
      at         TEXT NOT NULL,
      paid_at    TEXT,
      auto_cancelled INTEGER NOT NULL DEFAULT 0,
      needs_attention INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_orders_at ON orders(at DESC);
    CREATE INDEX idx_orders_status ON orders(status);
    CREATE INDEX idx_orders_status_at ON orders(status, at);
    CREATE INDEX idx_orders_customer ON orders(customer_id);
    CREATE INDEX idx_orders_attention_at ON orders(needs_attention DESC, at DESC);
    CREATE INDEX idx_orders_archived_at ON orders(archived, at DESC);
    CREATE UNIQUE INDEX idx_orders_pay_authority
      ON orders(pay_authority)
      WHERE pay_authority IS NOT NULL AND pay_authority <> '';

    /* Every authority ever issued for an order remains bound to that order.
       orders.pay_authority is only the current/settled pointer; this ledger is
       the durable ownership boundary used by callbacks after payment retries. */
    CREATE TABLE order_payments (
      authority  TEXT PRIMARY KEY CHECK (authority <> ''),
      order_id   TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      provider   TEXT NOT NULL DEFAULT 'zarinpal',
      status     TEXT NOT NULL DEFAULT 'issued',
      ref_id     TEXT,
      at         TEXT NOT NULL,
      verified_at TEXT,
      reversal_started_at TEXT,
      reversed_at TEXT,
      last_error TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX idx_order_payments_order ON order_payments(order_id, at DESC);

    CREATE TABLE order_items (
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      pos      INTEGER NOT NULL DEFAULT 0,
      slug     TEXT NOT NULL DEFAULT '',
      title    TEXT NOT NULL DEFAULT '',
      unit     TEXT NOT NULL DEFAULT '',
      price    INTEGER NOT NULL DEFAULT 0,
      qty      INTEGER NOT NULL DEFAULT 1,
      sum      INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_items_order ON order_items(order_id);

    CREATE TABLE comments (
      id       TEXT PRIMARY KEY,
      slug     TEXT NOT NULL DEFAULT '',
      name     TEXT NOT NULL DEFAULT '',
      text     TEXT NOT NULL DEFAULT '',
      at       TEXT NOT NULL,
      approved INTEGER NOT NULL DEFAULT 0,
      reply    TEXT,
      reply_at TEXT
    );
    CREATE INDEX idx_comments_slug ON comments(slug);
    CREATE INDEX idx_comments_at ON comments(at DESC);
    CREATE INDEX idx_comments_public_page
      ON comments(slug, approved, at DESC, id DESC);

    CREATE TABLE messages (
      id      TEXT PRIMARY KEY,
      name    TEXT NOT NULL DEFAULT '',
      phone   TEXT NOT NULL DEFAULT '',
      email   TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      at      TEXT NOT NULL,
      read    INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_messages_at ON messages(at DESC);

    /* Every send attempt, successful or not. Three jobs: the admin can see
       why a customer says they got nothing, the daily cap is countable, and
       a provider outage leaves evidence. The body is kept because an SMS is
       cheap to store and impossible to reconstruct.

       The phone column holds the canonical 98xxxxxxxxxx form — the same key
       the rest of the system uses, so a customer's messages can be found. */
    CREATE TABLE sms_log (
      id          TEXT PRIMARY KEY,
      at          TEXT NOT NULL,
      kind        TEXT NOT NULL DEFAULT 'other',
      phone       TEXT NOT NULL DEFAULT '',
      text        TEXT NOT NULL DEFAULT '',
      provider    TEXT NOT NULL DEFAULT 'log',
      environment TEXT NOT NULL DEFAULT 'sandbox',
      ok          INTEGER NOT NULL DEFAULT 0,
      error       TEXT NOT NULL DEFAULT '',
      message_id  TEXT,
      ref         TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX idx_sms_at ON sms_log(at DESC);
    CREATE INDEX idx_sms_phone ON sms_log(phone);

    /* ---------------- customer accounts ----------------
       phone is the identity and the login name, always in canonical
       98xxxxxxxxxx form so one person cannot become three accounts by
       typing their number three ways. */
    CREATE TABLE customers (
      id            TEXT PRIMARY KEY,
      phone         TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL DEFAULT '',
      email         TEXT NOT NULL DEFAULT '',
      pass_hash     TEXT NOT NULL,
      at            TEXT NOT NULL,
      last_login_at TEXT,
      blocked       INTEGER NOT NULL DEFAULT 0
    );

    /* Only the SHA-256 of the cookie is stored, so a dump of this table
       cannot be replayed as a login. */
    CREATE TABLE customer_sessions (
      token_hash  TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      at          TEXT NOT NULL,
      expires_at  TEXT NOT NULL,
      ua          TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX idx_sessions_customer ON customer_sessions(customer_id);

    /* One live code per phone+purpose: requesting a new one replaces the
       old, so an attacker cannot keep a pool of valid codes alive. */
    CREATE TABLE otps (
      phone      TEXT NOT NULL,
      purpose    TEXT NOT NULL,
      code_hash  TEXT NOT NULL,
      at         TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attempts   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (phone, purpose)
    );

    /* Proof that a code was verified, exchanged for the actual registration
       or password reset. Short-lived and single use, so the password step
       cannot be replayed later. */
    CREATE TABLE otp_tickets (
      ticket_hash TEXT PRIMARY KEY,
      phone       TEXT NOT NULL,
      purpose     TEXT NOT NULL,
      expires_at  TEXT NOT NULL
    );

    CREATE TABLE addresses (
      id          TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      pos         INTEGER NOT NULL DEFAULT 0,
      is_default  INTEGER NOT NULL DEFAULT 0,
      title       TEXT NOT NULL DEFAULT '',
      receiver    TEXT NOT NULL DEFAULT '',
      phone       TEXT NOT NULL DEFAULT '',
      province    TEXT NOT NULL DEFAULT '',
      city        TEXT NOT NULL DEFAULT '',
      address     TEXT NOT NULL DEFAULT '',
      plaque      TEXT NOT NULL DEFAULT '',
      unit        TEXT NOT NULL DEFAULT '',
      postal      TEXT NOT NULL DEFAULT '',
      note        TEXT NOT NULL DEFAULT '',
      at          TEXT NOT NULL
    );
    CREATE INDEX idx_addresses_customer ON addresses(customer_id);
      `);
      db.exec(`PRAGMA application_id = ${DATABASE_APPLICATION_ID}`);
      db.exec(`PRAGMA user_version = ${DATABASE_SCHEMA_VERSION}`);
    })();
  } else if (userTableCount() === 0) {
    throw schemaError('database has no application schema');
  }

  validateCurrentSchema(db);
}

/** Exact final-schema validator shared by startup and the explicit migration
 * runner. It never creates, alters, backfills, or repairs state. */
export function validateCurrentSchema(db) {
  const applicationId = pragmaNumber(db, 'application_id');
  const schemaVersion = pragmaNumber(db, 'user_version');
  if (applicationId !== DATABASE_APPLICATION_ID || schemaVersion !== DATABASE_SCHEMA_VERSION) {
    throw schemaError(`application_id=${applicationId}, user_version=${schemaVersion}`);
  }

  for (const [table, requiredColumns] of Object.entries(REQUIRED_SCHEMA)) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
    if (!isDeepStrictEqual(columns, requiredColumns)) {
      throw schemaError(`unexpected ${table} columns: ${columns.join(',') || 'none'}`);
    }
  }

  const indexes = new Set(
    db.prepare("SELECT name FROM sqlite_schema WHERE type = 'index'").all().map((row) => row.name),
  );
  const missingIndex = REQUIRED_INDEXES.find((name) => !indexes.has(name));
  if (missingIndex) throw schemaError(`missing index ${missingIndex}`);
  const authorityIndex = db.prepare('PRAGMA index_list(orders)').all()
    .find((index) => index.name === 'idx_orders_pay_authority');
  if (Number(authorityIndex?.unique) !== 1 || Number(authorityIndex?.partial) !== 1) {
    throw schemaError('payment-authority uniqueness index is invalid');
  }
  return { applicationId, schemaVersion };
}

/* ------------------------------------------------------- small utilities */
const J = (v, fallback) => {
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
};
const bool = (v) => (v ? 1 : 0);

/* ==================================================== editorial content */
export const CONTENT_SECTIONS = Object.freeze([
  'texts',
  'media',
  'links',
  'collections',
  'brands',
  'products',
  'posts',
  'i18n',
  'gallery',
]);
const CONTENT_OBJECT_SECTIONS = new Set(['texts', 'media', 'links', 'collections', 'i18n']);
const record = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const cloneJson = (value) => JSON.parse(JSON.stringify(value));
const sectionValueValid = (section, value) => (
  CONTENT_OBJECT_SECTIONS.has(section) ? record(value) : Array.isArray(value)
);
const editorialError = (message, code = 'CONTENT_UNAVAILABLE', cause) => Object.assign(
  new Error(message, cause ? { cause } : undefined),
  { code },
);

/** Acquire SQLite's writer reservation before reading the revision to prevent
 * two Passenger workers from validating the same old state and overwriting one
 * another. The adapter turns nested calls into SAVEPOINTs. */
export function withImmediateTransaction(db, operation) {
  return db.immediateTransaction(operation)();
}

export function validContentState(value) {
  return record(value) && CONTENT_SECTIONS.every(
    (section) => Object.hasOwn(value, section) && sectionValueValid(section, value[section]),
  );
}

const freshDefaultContent = () => Object.fromEntries(
  CONTENT_SECTIONS.map((section) => [section, cloneJson(DEFAULT_STATE[section])]),
);

const contentMeta = (db) => db.prepare(
  `SELECT revision, initialized_at, updated_at,
          (SELECT COUNT(*) FROM content_meta) AS meta_count
     FROM content_meta
    WHERE id = 1`,
).get();

export function getContentMeta(db) {
  const meta = contentMeta(db);
  if (
    !meta || Number(meta.meta_count) !== 1 ||
    !Number.isSafeInteger(Number(meta.revision)) || Number(meta.revision) < 1
  ) {
    throw editorialError('SQLite editorial metadata is missing or invalid');
  }
  return {
    revision: Number(meta.revision),
    initializedAt: meta.initialized_at,
    updatedAt: meta.updated_at,
  };
}

/** A worker's PRAGMA data_version changes when another SQLite connection
 * commits. Combining it with our global content revision invalidates both
 * same-worker and cross-worker caches without polling files or sharing memory. */
export function getContentToken(db) {
  const meta = getContentMeta(db);
  const versionRow = db.prepare('PRAGMA data_version').get();
  const dataVersion = Number(versionRow?.data_version ?? Object.values(versionRow || {})[0] ?? 0);
  return { ...meta, dataVersion, key: `${meta.revision}:${dataVersion}` };
}

/** Strict authority read. Defaults are deliberately not consulted here: a
 * missing/corrupt established store must remain unavailable until recovery. */
export function readContentSections(db) {
  const meta = getContentMeta(db);
  const rows = db.prepare(
    'SELECT section, value_json, revision FROM content_sections',
  ).all();
  const byName = new Map(rows.map((row) => [row.section, row]));
  const state = {};
  for (const section of CONTENT_SECTIONS) {
    const row = byName.get(section);
    const revision = Number(row?.revision);
    if (!row || !Number.isSafeInteger(revision) || revision < 1 || revision > meta.revision) {
      throw editorialError(`SQLite editorial section is missing or has an invalid revision: ${section}`);
    }
    let value;
    try {
      value = JSON.parse(row.value_json);
    } catch (cause) {
      throw editorialError(`SQLite editorial section is not valid JSON: ${section}`, 'CONTENT_UNAVAILABLE', cause);
    }
    if (!sectionValueValid(section, value)) {
      throw editorialError(`SQLite editorial section has the wrong type: ${section}`);
    }
    state[section] = value;
  }
  return state;
}

export function getContentSectionRevisions(db) {
  const rows = db.prepare('SELECT section, revision FROM content_sections').all();
  return Object.fromEntries(rows.map((row) => [row.section, Number(row.revision)]));
}

const persistInitialContent = (db, state) => {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO content_meta (id, revision, initialized_at, updated_at)
     VALUES (1, 1, ?, ?)`,
  ).run(now, now);
  const insert = db.prepare(
    `INSERT INTO content_sections (section, value_json, revision, updated_at)
     VALUES (?, ?, 1, ?)`,
  );
  for (const section of CONTENT_SECTIONS) {
    insert.run(section, JSON.stringify(state[section]), now);
  }
};

/** Initialize exactly once. Defaults may be persisted only when the caller
 * proved the whole deployment tree was genuinely fresh before opening SQLite
 * created the database file. Established missing/corrupt state fails closed. */
export function initializeContentStore(db, { freshInstall = false } = {}) {
  return withImmediateTransaction(db, () => {
    try {
      const state = readContentSections(db);
      const meta = getContentMeta(db);
      return { status: 'ready', revision: meta.revision, state };
    } catch (existingError) {
      const metaRows = Number(db.prepare('SELECT COUNT(*) AS count FROM content_meta').get()?.count || 0);
      const sectionRows = Number(db.prepare('SELECT COUNT(*) AS count FROM content_sections').get()?.count || 0);
      if (metaRows || sectionRows) {
        return { status: 'unavailable', reason: existingError.message };
      }
    }

    if (!freshInstall) {
      return {
        status: 'unavailable',
        reason: 'no authoritative editorial rows exist in an established state tree',
      };
    }

    const initial = freshDefaultContent();
    persistInitialContent(db, initial);
    return { status: 'initialized', revision: 1, state: initial };
  });
}

/** Replace only named sections and bump one coherent global revision. */
export function replaceContentSections(db, changes, { expectedRevision } = {}) {
  if (!record(changes)) throw editorialError('content changes must be an object', 'CONTENT_INVALID');
  const unknown = Object.keys(changes).find((section) => !CONTENT_SECTIONS.includes(section));
  if (unknown) throw editorialError(`unknown editorial section: ${unknown}`, 'CONTENT_INVALID');
  for (const [section, value] of Object.entries(changes)) {
    if (!sectionValueValid(section, value)) {
      throw editorialError(`editorial section has the wrong type: ${section}`, 'CONTENT_INVALID');
    }
  }

  return withImmediateTransaction(db, () => {
    const current = readContentSections(db);
    const meta = getContentMeta(db);
    if (expectedRevision !== undefined && Number(expectedRevision) !== meta.revision) {
      throw editorialError('editorial content changed in another worker', 'CONTENT_CONFLICT');
    }
    /* JSON omits own undefined values. Do not advance a revision for a purely
       in-memory distinction that serializes to the exact persisted document. */
    const changedSections = Object.keys(changes).filter((section) => (
      !isDeepStrictEqual(changes[section], current[section]) &&
      JSON.stringify(changes[section]) !== JSON.stringify(current[section])
    ));
    if (!changedSections.length) {
      return { revision: meta.revision, changedSections, state: current };
    }

    const revision = meta.revision + 1;
    const now = new Date().toISOString();
    const update = db.prepare(
      `UPDATE content_sections
          SET value_json = ?, revision = ?, updated_at = ?
        WHERE section = ?`,
    );
    for (const section of changedSections) {
      const result = update.run(JSON.stringify(changes[section]), revision, now, section);
      if (result.changes !== 1) throw editorialError(`could not update editorial section: ${section}`);
      current[section] = cloneJson(changes[section]);
    }
    const result = db.prepare(
      'UPDATE content_meta SET revision = ?, updated_at = ? WHERE id = 1 AND revision = ?',
    ).run(revision, now, meta.revision);
    if (result.changes !== 1) {
      throw editorialError('editorial revision changed during save', 'CONTENT_CONFLICT');
    }
    return { revision, changedSections, state: current };
  });
}

/** Shop display/catalogue rows live outside content_sections but are part of
 * the same Admin snapshot. Advance the global token after a shop-only content
 * save so a stale full-document PUT cannot overwrite that newer mutation. */
export function advanceContentRevision(db, { expectedRevision } = {}) {
  return withImmediateTransaction(db, () => {
    const meta = getContentMeta(db);
    if (expectedRevision !== undefined && Number(expectedRevision) !== meta.revision) {
      throw editorialError('content changed in another worker', 'CONTENT_CONFLICT');
    }
    const revision = meta.revision + 1;
    const result = db.prepare(
      'UPDATE content_meta SET revision = ?, updated_at = ? WHERE id = 1 AND revision = ?',
    ).run(revision, new Date().toISOString(), meta.revision);
    if (result.changes !== 1) {
      throw editorialError('content revision changed during save', 'CONTENT_CONFLICT');
    }
    return revision;
  });
}

/* ============================================================== settings */
export function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? J(row.value, fallback) : fallback;
}
export function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    JSON.stringify(value),
  );
}

/* ====================================================== shared rate limits */
const rateLimitUsage = (db, kind, bucketHash, cutoff) => {
  const row = db.prepare(
    `SELECT COUNT(*) AS count,
            MIN(CASE WHEN pending = 0 THEN at END) AS oldest_completed
       FROM rate_limit_hits
      WHERE kind = ? AND bucket_hash = ? AND bucket_version = 2 AND at >= ?`,
  ).get(String(kind), String(bucketHash), Number(cutoff));
  return {
    count: Number(row?.count || 0),
    oldestCompleted: row?.oldest_completed == null ? null : Number(row.oldest_completed),
  };
};

export function getRateLimitUsage(db, { kind, bucketHash, cutoff }) {
  return rateLimitUsage(db, kind, bucketHash, cutoff);
}

export function recordRateLimitHit(db, { kind, bucketHash, at = Date.now() }) {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO rate_limit_hits(id, kind, bucket_hash, bucket_version, at, pending)
     VALUES (?, ?, ?, 2, ?, 0)`,
  ).run(id, String(kind), String(bucketHash), Number(at));
  return id;
}

/** Atomically count and reserve one slot. A saturated bucket takes a read-only
 * fast path, so flood traffic does not queue for SQLite's single writer merely
 * to be refused. A request that appears admissible then enters a write
 * transaction, prunes, and re-checks under the lock before inserting; workers
 * therefore cannot over-admit from the optimistic read. */
export function reserveRateLimitHit(db, {
  kind,
  bucketHash,
  cutoff,
  max,
  at = Date.now(),
}) {
  const initialUsage = rateLimitUsage(db, kind, bucketHash, cutoff);
  if (initialUsage.count >= Number(max)) return { limited: true, ...initialUsage };

  return db.transaction(() => {
    db.prepare(
      'DELETE FROM rate_limit_hits WHERE kind = ? AND bucket_hash = ? AND at < ?',
    ).run(String(kind), String(bucketHash), Number(cutoff));
    const usage = rateLimitUsage(db, kind, bucketHash, cutoff);
    if (usage.count >= Number(max)) return { limited: true, ...usage };
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO rate_limit_hits(id, kind, bucket_hash, bucket_version, at, pending)
       VALUES (?, ?, ?, 2, ?, 1)`,
    ).run(id, String(kind), String(bucketHash), Number(at));
    return { limited: false, id, ...usage, count: usage.count + 1 };
  })();
}

export function finishRateLimitReservation(db, id, { record = false } = {}) {
  if (!id) return false;
  const result = record
    ? db.prepare('UPDATE rate_limit_hits SET pending = 0 WHERE id = ? AND pending = 1').run(String(id))
    : db.prepare('DELETE FROM rate_limit_hits WHERE id = ? AND pending = 1').run(String(id));
  return result.changes === 1;
}

/** A successful login clears completed failures but must not erase password
 * checks that another worker still has in flight. */
export function clearRateLimitBucket(db, { kind, bucketHash }) {
  return db.prepare(
    'DELETE FROM rate_limit_hits WHERE kind = ? AND bucket_hash = ? AND pending = 0',
  ).run(String(kind), String(bucketHash)).changes;
}

export function clearRateLimitHits(db) {
  return db.prepare('DELETE FROM rate_limit_hits').run().changes;
}

export function pruneRateLimitHits(db, cutoff) {
  return db.prepare('DELETE FROM rate_limit_hits WHERE at < ?').run(Number(cutoff)).changes;
}

/* ============================================================== products */
const productOut = (r) => {
  const images = normalizeProductImages(J(r.images, []), r.image);
  return {
    slug: r.slug,
    title: r.title,
    brand: r.brand,
    productSlug: r.product_slug,
    unit: r.unit,
    image: images[0] || '',
    images,
    price: r.price,
    oldPrice: r.old_price == null ? null : r.old_price,
    stock: r.stock,
    active: !!r.active,
    featured: !!r.featured,
    commentsLocked: !!r.comments_locked,
    short: r.short,
    description: r.description,
    specs: J(r.specs, []),
  };
};

export function listProducts(db) {
  return db.prepare('SELECT * FROM products ORDER BY pos ASC').all().map(productOut);
}
export function getProduct(db, slug) {
  const r = db.prepare('SELECT * FROM products WHERE slug = ?').get(String(slug));
  return r ? productOut(r) : null;
}

const insertProduct = (db) =>
  db.prepare(`
    INSERT INTO products (slug, pos, title, brand, product_slug, unit, image, images, price, old_price, stock,
                          active, featured, comments_locked, short, description, specs)
    VALUES (@slug, @pos, @title, @brand, @product_slug, @unit, @image, @images, @price, @old_price, @stock,
            @active, @featured, @comments_locked, @short, @description, @specs)
  `);

const productIn = (p, pos) => {
  const images = normalizeProductImages(p.images, p.image);
  return {
    slug: String(p.slug || '').trim(),
    pos,
    title: String(p.title || ''),
    brand: String(p.brand || ''),
    product_slug: String(p.productSlug || ''),
    unit: String(p.unit || ''),
    image: images[0] || '',
    images: JSON.stringify(images),
    price: Math.max(0, Math.round(Number(p.price) || 0)),
    old_price: p.oldPrice == null || p.oldPrice === '' ? null : Math.max(0, Math.round(Number(p.oldPrice) || 0)),
    stock: Number.isFinite(Number(p.stock)) ? Math.round(Number(p.stock)) : -1,
    active: bool(p.active !== false),
    featured: bool(p.featured),
    comments_locked: bool(p.commentsLocked),
    short: String(p.short || ''),
    description: sanitizeRichText(
      p.description || '',
      `shop product ${String(p.slug || '').trim() || `#${pos + 1}`} description`,
    ),
    specs: JSON.stringify(Array.isArray(p.specs) ? p.specs : []),
  };
};

/** Replace the whole product list (admin saves the full array).
 *
 *  With `preserveStock`, the stock column of every product that already exists
 *  is kept at its live database value instead of being overwritten by the
 *  caller's copy. The content panel holds a snapshot from page load, so its
 *  stock figures go stale the moment an order is placed; writing them back
 *  would erase real sales. Products that are new in this payload keep the
 *  stock they were created with. */
export function replaceProducts(db, products, { preserveStock = false } = {}) {
  const ins = insertProduct(db);
  const live = preserveStock
    ? new Map(db.prepare('SELECT slug, stock FROM products').all().map((r) => [r.slug, r.stock]))
    : null;
  const run = db.transaction((list) => {
    db.prepare('DELETE FROM products').run();
    list.forEach((p, i) => {
      const row = productIn(p, i);
      if (!row.slug) return;
      if (live && live.has(row.slug)) row.stock = live.get(row.slug);
      ins.run(row);
    });
  });
  run(Array.isArray(products) ? products : []);
}

/** Collapse repeated product lines before any inventory arithmetic.
 *
 *  This is deliberately repeated at the database boundary even though the
 *  checkout route also canonicalises its payload. reserveStock is also used by
 *  Admin status changes; trusting every caller to remember the invariant is
 *  how duplicate lines once sold ten units out of five. */
export function mergeStockLines(lines) {
  const merged = new Map();
  for (const line of Array.isArray(lines) ? lines : []) {
    const slug = String(line?.slug || '').trim();
    const qty = line?.qty;
    if (!slug) throw new Error('invalid product');
    if (typeof qty !== 'number' || !Number.isSafeInteger(qty) || qty <= 0)
      throw new Error('invalid quantity');
    const total = (merged.get(slug) || 0) + qty;
    if (!Number.isSafeInteger(total)) throw new Error('invalid quantity');
    merged.set(slug, total);
  }
  return [...merged].map(([slug, qty]) => ({ slug, qty }));
}

/** Atomically check + decrement stock for an order. Returns {ok, error}. */
export function reserveStock(db, lines) {
  const get = db.prepare('SELECT stock FROM products WHERE slug = ?');
  /* The quantity appears in the WHERE as well as the subtraction. The earlier
     SELECT gives a useful error, while this predicate is the final invariant
     should another writer ever be introduced around this transaction. */
  const dec = db.prepare('UPDATE products SET stock = stock - ? WHERE slug = ? AND stock >= ?');
  const run = db.transaction((rawItems) => {
    const items = mergeStockLines(rawItems);
    for (const line of items) {
      const row = get.get(line.slug);
      if (!row) throw new Error(`unknown product: ${line.slug}`);
      if (row.stock >= 0 && line.qty > row.stock) throw new Error('insufficient stock');
    }
    for (const line of items) {
      const row = get.get(line.slug);
      if (row.stock < 0) continue; // -1 means unlimited
      if (dec.run(line.qty, line.slug, line.qty).changes !== 1) throw new Error('insufficient stock');
    }
  });
  try {
    run(lines);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Give stock back (cancelled order / deleted order). */
export function restoreStock(db, lines) {
  const inc = db.prepare('UPDATE products SET stock = stock + ? WHERE slug = ? AND stock >= 0');
  db.transaction((rawItems) => {
    for (const line of mergeStockLines(rawItems)) inc.run(line.qty, line.slug);
  })(lines || []);
}

/** Compare-and-set an existing product's stock.
 *
 *  The expected value is the figure the admin actually saw. If an order moved
 *  stock after that page loaded, changes is zero and the UI must refresh rather
 *  than overwrite the sale with a stale absolute number. */
export function updateProductStock(db, slug, stock, expectedStock) {
  const next = Number(stock);
  const expected = Number(expectedStock);
  const key = String(slug || '');
  if ((!Number.isSafeInteger(next) || next < -1) || (!Number.isSafeInteger(expected) || expected < -1)) {
    return { ok: false, error: 'invalid stock' };
  }
  return db.immediateTransaction(() => {
    const current = db.prepare('SELECT stock FROM products WHERE slug = ?').get(key);
    if (!current) return { ok: false, error: 'not found' };
    if (current.stock !== expected) return { ok: false, error: 'stock changed', stock: current.stock };

    /* While stock is unlimited, orders did not deduct units. Do not invent a
       finite baseline until every order that could depend on that unreserved
       stock has been resolved. */
    if (current.stock === -1 && next >= 0) {
      const active = db.prepare(
        `SELECT COUNT(DISTINCT o.id) AS count
           FROM orders o
           JOIN order_items i ON i.order_id = o.id
          WHERE i.slug = ? AND o.status <> 'cancelled'`,
      ).get(key);
      const activeOrders = Number(active?.count || 0);
      if (activeOrders > 0) {
        return { ok: false, error: 'active orders', stock: current.stock, activeOrders };
      }
    }

    const result = db.prepare('UPDATE products SET stock = ? WHERE slug = ? AND stock = ?')
      .run(next, key, expected);
    return result.changes === 1
      ? { ok: true, stock: next }
      : { ok: false, error: 'stock changed' };
  })();
}

/* ================================================================ orders */
const orderOut = (r, items) => ({
  id: r.id,
  code: r.code,
  token: r.token,
  items,
  customer: J(r.customer, {}),
  subtotal: r.subtotal,
  shipping: r.shipping,
  total: r.total,
  currency: r.currency,
  status: r.status,
  provider: r.provider,
  payAuthority: r.pay_authority || null,
  /* payRef is the gateway's post-settlement ref_id. The authority is kept in
     payAuthority for verification, inquiry and reversal. */
  payRef: r.pay_ref || null,
  adminNote: r.admin_note,
  at: r.at,
  paidAt: r.paid_at,
  customerId: r.customer_id || null,
  autoCancelled: Boolean(r.auto_cancelled),
  needsAttention: Boolean(r.needs_attention),
  archived: Boolean(r.archived),
});

const itemsOf = (db, id) =>
  db
    .prepare('SELECT slug, title, unit, price, qty, sum FROM order_items WHERE order_id = ? ORDER BY pos ASC')
    .all(id);

export const PAYMENT_REVERSAL_CLAIM_TTL_MS = 15 * 60 * 1000;

const paymentAttemptOut = (row) => {
  if (!row) return row;
  const reversalStarted = Date.parse(row.reversal_started_at || '');
  const reversalReclaimAt = Number.isFinite(reversalStarted)
    ? reversalStarted + PAYMENT_REVERSAL_CLAIM_TTL_MS
    : 0;
  const reversalReclaimable = row.status === 'reversing' && (
    !reversalReclaimAt || reversalReclaimAt <= Date.now()
  );
  return {
    authority: row.authority,
    orderId: row.order_id,
    provider: row.provider,
    status: row.status,
    refId: row.ref_id || null,
    at: row.at,
    verifiedAt: row.verified_at || null,
    reversalStartedAt: row.reversal_started_at || null,
    reversalReclaimable,
    reversalRetryAfter: row.status === 'reversing' && !reversalReclaimable
      ? Math.max(1, Math.ceil((reversalReclaimAt - Date.now()) / 1000))
      : 0,
    reversedAt: row.reversed_at || null,
    lastError: row.last_error || '',
  };
};

/** Insert an immutable authority → order binding. INSERT OR IGNORE makes a
 * repeated write for the same order idempotent; the ownership check turns a
 * collision with any other order into a transaction failure. */
const ensurePaymentAttempt = (database, orderId, {
  authority,
  provider = 'zarinpal',
  at = new Date().toISOString(),
} = {}) => {
  const value = String(authority || '');
  if (!value) throw new Error('payment authority is required');
  const id = String(orderId || '');
  database.prepare(
    `INSERT OR IGNORE INTO order_payments
       (authority, order_id, provider, status, at)
     VALUES (?, ?, ?, 'issued', ?)`,
  ).run(value, id, String(provider || 'zarinpal'), String(at));
  const owner = database.prepare('SELECT * FROM order_payments WHERE authority = ?').get(value);
  if (!owner || owner.order_id !== id) throw new Error('payment authority already belongs to another order');
  return paymentAttemptOut(owner);
};

export function listOrderPaymentAttempts(database, orderId) {
  return database
    .prepare('SELECT * FROM order_payments WHERE order_id = ? ORDER BY at ASC, authority ASC')
    .all(String(orderId || ''))
    .map(paymentAttemptOut);
}

export function getOrderPaymentAttempt(database, orderId, authority) {
  const value = String(authority || '');
  if (!value) return null;
  return paymentAttemptOut(database.prepare(
    'SELECT * FROM order_payments WHERE order_id = ? AND authority = ?',
  ).get(String(orderId || ''), value));
}

export function getPaymentAttemptByAuthority(database, authority) {
  const value = String(authority || '');
  if (!value) return null;
  return paymentAttemptOut(database.prepare('SELECT * FROM order_payments WHERE authority = ?').get(value));
}

/** Persist a newly-issued attempt before its redirect reaches the customer.
 * It becomes the current pointer only while the order is still pending. Even
 * if an expiry/callback wins that race, the authority remains mapped forever. */
export function recordOrderPaymentAttempt(database, orderId, attempt) {
  return database.transaction(() => {
    const id = String(orderId || '');
    const order = database.prepare('SELECT id FROM orders WHERE id = ?').get(id);
    if (!order) return { ok: false, current: false, attempt: null };
    const saved = ensurePaymentAttempt(database, id, { ...attempt, at: attempt?.at || new Date().toISOString() });
    const current = database.prepare(
      `UPDATE orders SET provider = ?, pay_authority = ?
       WHERE id = ? AND status = 'pending_payment'`,
    ).run(saved.provider, saved.authority, id).changes === 1;
    return { ok: true, current, attempt: saved };
  })();
}

export function updateOrderPaymentAttempt(database, orderId, authority, patch = {}) {
  const map = {
    status: 'status',
    refId: 'ref_id',
    verifiedAt: 'verified_at',
    reversalStartedAt: 'reversal_started_at',
    reversedAt: 'reversed_at',
    lastError: 'last_error',
  };
  const sets = [];
  const values = [];
  for (const [key, column] of Object.entries(map)) {
    if (!(key in patch)) continue;
    sets.push(`${column} = ?`);
    values.push(patch[key]);
  }
  if ('status' in patch && patch.status !== 'reversing' && !('reversalStartedAt' in patch)) {
    sets.push('reversal_started_at = ?');
    values.push(null);
  }
  if (!sets.length) return false;
  values.push(String(orderId || ''), String(authority || ''));
  return database.prepare(
    `UPDATE order_payments SET ${sets.join(', ')} WHERE order_id = ? AND authority = ?`,
  ).run(...values).changes === 1;
}

export function claimOrderPaymentReversal(database, orderId, authority, {
  refId = null,
  verifiedAt = new Date().toISOString(),
  claimedAt = new Date().toISOString(),
  staleBefore = new Date(Date.now() - PAYMENT_REVERSAL_CLAIM_TTL_MS).toISOString(),
} = {}) {
  const id = String(orderId || '');
  const value = String(authority || '');
  if (!value) return { claimed: false, reclaimed: false, attempt: null };
  return database.transaction(() => {
    const previous = getOrderPaymentAttempt(database, id, value);
    const claimed = database.prepare(
      `UPDATE order_payments
          SET status = 'reversing', ref_id = ?, verified_at = ?,
              reversal_started_at = ?, last_error = ''
        WHERE order_id = ? AND authority = ?
          AND (
            status IN ('issued', 'verified', 'reversal_failed')
            OR (
              status = 'reversing'
              AND (reversal_started_at IS NULL OR reversal_started_at <= ?)
            )
          )`,
    ).run(refId || null, verifiedAt, claimedAt, id, value, staleBefore).changes === 1;
    if (claimed) {
      /* Commit the visible alert with the claim. A worker crash after this
         point cannot leave the extra charge hidden from Admin, and a later
         worker may reclaim it after PAYMENT_REVERSAL_CLAIM_TTL_MS. */
      database.prepare('UPDATE orders SET needs_attention = 1, archived = 0 WHERE id = ?').run(id);
    }
    return {
      claimed,
      reclaimed: claimed && previous?.status === 'reversing',
      attempt: getOrderPaymentAttempt(database, id, value),
    };
  })();
}

/** Complete a reversal without allowing an expired worker to overwrite its
 * replacement. A gateway-confirmed success is terminal and may resolve a
 * newer/failed lease, but a failure belongs only to the exact lease that made
 * the request. This is the fencing step paired with the reclaimable claim. */
export function finishOrderPaymentReversal(database, orderId, authority, {
  claimedAt,
  ok,
  reversedAt = new Date().toISOString(),
  lastError = '',
} = {}) {
  const id = String(orderId || '');
  const value = String(authority || '');
  let changes = 0;
  if (ok) {
    /* A real gateway success is stronger than a stale local failure. Never
       overwrite the authority that actually settled the order, though. */
    changes = database.prepare(
      `UPDATE order_payments
          SET status = 'reversed', reversed_at = ?, last_error = '',
              reversal_started_at = NULL
        WHERE order_id = ? AND authority = ?
          AND status IN ('verified', 'reversing', 'reversal_failed')`,
    ).run(reversedAt, id, value).changes;
  } else if (claimedAt) {
    changes = database.prepare(
      `UPDATE order_payments
          SET status = 'reversal_failed', last_error = ?,
              reversal_started_at = NULL
        WHERE order_id = ? AND authority = ?
          AND status = 'reversing' AND reversal_started_at = ?`,
    ).run(String(lastError || '').slice(0, 300), id, value, claimedAt).changes;
  }
  return {
    finished: changes === 1,
    attempt: getOrderPaymentAttempt(database, id, value),
  };
}

export function clearOrderPaymentAttentionIfResolved(database, orderId) {
  return database.prepare(
    `UPDATE orders
        SET needs_attention = 0
      WHERE id = ?
        AND NOT EXISTS (
          SELECT 1 FROM order_payments
           WHERE order_payments.order_id = orders.id
             AND order_payments.status IN ('reversing', 'reversal_failed', 'verified')
        )`,
  ).run(String(orderId || '')).changes === 1;
}

export function appendOrderAdminNote(database, orderId, note, { needsAttention = false } = {}) {
  const value = String(note || '').trim();
  if (!value) return false;
  return database.prepare(
    `UPDATE orders
        SET admin_note = CASE WHEN admin_note = '' THEN ? ELSE admin_note || '\n' || ? END,
            needs_attention = CASE WHEN ? THEN 1 ELSE needs_attention END,
            archived = CASE WHEN ? THEN 0 ELSE archived END
      WHERE id = ?`,
  ).run(
    value,
    value,
    needsAttention ? 1 : 0,
    needsAttention ? 1 : 0,
    String(orderId || ''),
  ).changes === 1;
}

export function listOrders(db) {
  /* Unresolved money movement belongs at the top, not buried by newer routine
     orders. The explicit flag is also returned for badge/detail rendering. */
  const rows = db.prepare(
    'SELECT * FROM orders ORDER BY archived ASC, needs_attention DESC, at DESC',
  ).all();
  return rows.map((r) => orderOut(r, itemsOf(db, r.id)));
}
export function getOrderByCode(db, code) {
  const r = db.prepare('SELECT * FROM orders WHERE code = ?').get(String(code));
  return r ? orderOut(r, itemsOf(db, r.id)) : null;
}
export function getOrderById(db, id) {
  const r = db.prepare('SELECT * FROM orders WHERE id = ?').get(String(id));
  return r ? orderOut(r, itemsOf(db, r.id)) : null;
}
export function getOrderByPaymentAuthority(db, authority) {
  const value = String(authority || '');
  if (!value) return null;
  const r = db.prepare(
    `SELECT orders.*
       FROM order_payments
       JOIN orders ON orders.id = order_payments.order_id
      WHERE order_payments.authority = ?`,
  ).get(value);
  return r ? orderOut(r, itemsOf(db, r.id)) : null;
}

export function insertOrder(db, o) {
  const ins = db.prepare(`
    INSERT INTO orders (id, code, token, customer, subtotal, shipping, total, currency, status,
                        provider, pay_authority, pay_ref, admin_note, at, paid_at, customer_id,
                        auto_cancelled, needs_attention, archived)
    VALUES (@id, @code, @token, @customer, @subtotal, @shipping, @total, @currency, @status,
            @provider, @pay_authority, @pay_ref, @admin_note, @at, @paid_at, @customer_id,
            @auto_cancelled, @needs_attention, @archived)
  `);
  const insItem = db.prepare(`
    INSERT INTO order_items (order_id, pos, slug, title, unit, price, qty, sum)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    ins.run({
      id: o.id,
      code: o.code,
      token: o.token,
      customer: JSON.stringify(o.customer || {}),
      subtotal: o.subtotal,
      shipping: o.shipping,
      total: o.total,
      currency: o.currency || 'IRR',
      status: o.status || 'pending_payment',
      provider: o.provider || 'offline',
      pay_authority: o.payAuthority || null,
      pay_ref: o.payRef || null,
      admin_note: o.adminNote || '',
      at: o.at,
      paid_at: o.paidAt || null,
      customer_id: o.customerId || null,
      auto_cancelled: bool(o.autoCancelled),
      needs_attention: bool(o.needsAttention),
      archived: bool(o.archived),
    });
    if (o.payAuthority) {
      ensurePaymentAttempt(db, o.id, {
        authority: o.payAuthority,
        provider: o.provider,
        at: o.at,
      });
      if (['paid', 'shipped', 'delivered'].includes(o.status)) {
        updateOrderPaymentAttempt(db, o.id, o.payAuthority, {
          status: 'settled',
          refId: o.payRef || null,
          verifiedAt: o.paidAt || o.at,
        });
      }
    }
    (o.items || []).forEach((l, i) =>
      insItem.run(o.id, i, l.slug, l.title, l.unit || '', l.price, l.qty, l.sum),
    );
  })();
  return o;
}

/** Reserve every order line and persist the matching order in one commit.
 *  A process crash can therefore leave either both the stock hold and its
 *  sweepable order, or neither — never an invisible permanent reservation. */
export function reserveAndInsertOrder(db, order) {
  const run = db.transaction(() => {
    const reserved = reserveStock(db, order?.items);
    if (!reserved.ok) {
      const error = new Error(reserved.error || 'stock reservation failed');
      error.inventoryFailure = true;
      throw error;
    }
    insertOrder(db, order);
  });
  try {
    run();
    return { ok: true };
  } catch (error) {
    if (error?.inventoryFailure) return { ok: false, error: error.message };
    throw error;
  }
}

export function updateOrder(db, id, patch = {}) {
  const source = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  /* Financial attention is always visible. Enforce this in the data layer as
     well as the HTTP route so a future caller cannot persist the contradictory
     state needs_attention=1 + archived=1. */
  const effectivePatch = source.needsAttention === true
    ? { ...source, archived: false }
    : source;
  const map = {
    status: 'status',
    provider: 'provider',
    payAuthority: 'pay_authority',
    payRef: 'pay_ref',
    adminNote: 'admin_note',
    paidAt: 'paid_at',
    autoCancelled: 'auto_cancelled',
    needsAttention: 'needs_attention',
    archived: 'archived',
  };
  const sets = [];
  const values = [];
  for (const [key, column] of Object.entries(map)) {
    if (!(key in effectivePatch)) continue;
    sets.push(`${column} = ?`);
    values.push(
      ['autoCancelled', 'needsAttention', 'archived'].includes(key)
        ? bool(effectivePatch[key])
        : effectivePatch[key],
    );
  }
  if (!sets.length) return { ok: true, changed: false };

  const orderId = String(id || '');
  return db.immediateTransaction(() => {
    const current = db.prepare(
      'SELECT status, provider, needs_attention FROM orders WHERE id = ?',
    ).get(orderId);
    if (!current) return { ok: false, error: 'not found' };
    /* Keep the established two-step acknowledgement rule: an order whose
       attention flag was set by another worker cannot be archived in the same
       write that clears the warning. */
    if (effectivePatch.archived === true && current.needs_attention) {
      return { ok: false, error: 'unresolved payment attention' };
    }

    /* A non-cancelled order owns its stock reservation; a cancelled one does
       not. Make each transition across that boundary part of the same
       BEGIN IMMEDIATE transaction as the status write, so even direct callers
       cannot restore twice or revive an order without re-reserving its units. */
    if ('status' in effectivePatch && current.status !== effectivePatch.status) {
      const lines = db.prepare(
        'SELECT slug, qty FROM order_items WHERE order_id = ?',
      ).all(orderId);
      if (current.status === 'cancelled' && effectivePatch.status !== 'cancelled') {
        const reserved = reserveStock(db, lines);
        if (!reserved.ok) {
          return { ok: false, error: 'insufficient stock', detail: reserved.error };
        }
      } else if (current.status !== 'cancelled' && effectivePatch.status === 'cancelled') {
        restoreStock(db, lines);
      }
    }

    if (effectivePatch.payAuthority) {
      ensurePaymentAttempt(db, orderId, {
        authority: effectivePatch.payAuthority,
        provider: effectivePatch.provider || current.provider,
        at: new Date().toISOString(),
      });
    }

    const archiveGuard = effectivePatch.archived === true ? ' AND needs_attention = 0' : '';
    const updated = db.prepare(
      `UPDATE orders SET ${sets.join(', ')} WHERE id = ?${archiveGuard}`,
    ).run(...values, orderId);
    if (updated.changes !== 1) {
      /* With the writer lock and checks above this normally means a database
         trigger or a deliberately incompatible row. Throwing rolls back any
         stock movement instead of committing inventory without its status. */
      throw Object.assign(new Error('order changed during atomic update'), {
        code: 'ORDER_UPDATE_CONFLICT',
      });
    }
    return { ok: true, changed: true };
  })();
}

/** Settle only the still-pending order that owns this authority. The route also
 *  performs a constant-time comparison before contacting the gateway; this
 *  SQL predicate closes the retry/callback race while verification is in
 *  flight. */
export function settlePendingOrder(db, id, authority, {
  provider,
  payRef,
  paidAt,
  adminNote,
}) {
  if (!authority) return false;
  const orderId = String(id);
  const value = String(authority);
  return db.transaction(() => {
    const result = db.prepare(
      `UPDATE orders
          SET status = 'paid', provider = ?, pay_authority = ?, pay_ref = ?, paid_at = ?,
              admin_note = ?, auto_cancelled = 0, needs_attention = 0, archived = 0
        WHERE id = ? AND status = 'pending_payment'
          AND EXISTS (
            SELECT 1 FROM order_payments
             WHERE order_payments.order_id = orders.id
               AND order_payments.authority = ?
          )`,
    ).run(provider, value, payRef || null, paidAt, adminNote || '', orderId, value);
    if (result.changes !== 1) return false;
    updateOrderPaymentAttempt(db, orderId, value, {
      status: 'settled',
      refId: payRef || null,
      verifiedAt: paidAt,
      lastError: '',
    });
    return true;
  })();
}

/** Cancel stale unpaid orders and release their stock in one transaction.
 *
 *  The conditional UPDATE is the race guard: a gateway callback or admin may
 *  have moved an order after the SELECT. Stock is restored only when this
 *  transaction itself changed pending_payment → cancelled, so no sweep can
 *  credit the same units twice. */
export function expirePendingOrders(db, cutoffIso, atIso = new Date().toISOString()) {
  const candidates = db.prepare(
    `SELECT id, code, admin_note FROM orders
     WHERE status = 'pending_payment' AND at <= ?
     ORDER BY at ASC`,
  );
  const items = db.prepare('SELECT slug, qty FROM order_items WHERE order_id = ?');
  const cancel = db.prepare(
    `UPDATE orders
     SET status = 'cancelled', auto_cancelled = 1, admin_note = ?
     WHERE id = ? AND status = 'pending_payment'`,
  );
  const inc = db.prepare('UPDATE products SET stock = stock + ? WHERE slug = ? AND stock >= 0');
  const note = `لغو خودکار: مهلت پرداخت ۳۰ دقیقه‌ای در ${atIso} پایان یافت.`;

  /* Reserve SQLite's writer slot before reading candidates. Otherwise two
     workers can both snapshot the same pending rows, and one may hit a WAL
     busy-snapshot error while trying to cancel and restore stock. */
  return db.immediateTransaction((cutoff) => {
    const expired = [];
    for (const row of candidates.all(String(cutoff))) {
      const adminNote = [row.admin_note, note].filter(Boolean).join('\n');
      if (cancel.run(adminNote, row.id).changes !== 1) continue;
      for (const line of mergeStockLines(items.all(row.id))) inc.run(line.qty, line.slug);
      expired.push({ id: row.id, code: row.code });
    }
    return expired;
  })(cutoffIso);
}

/** Atomically claim a verified payment that arrived after automatic expiry.
 *
 *  A transient auto_cancelled=2 marker is the cross-process compare-and-set:
 *  only one Passenger worker may handle duplicate gateway callbacks. In the
 *  same transaction we try to reserve the released units and move to paid. If
 *  that is no longer possible the marker and urgent note commit, allowing one
 *  worker to refund while the order remains cancelled and does not pretend to
 *  hold inventory. */
export function claimExpiredPayment(db, id, {
  provider,
  authority,
  payRef,
  paidAt,
  successNote,
  failureNote,
}) {
  const claim = db.prepare(
    `UPDATE orders
     SET provider = ?, pay_authority = ?, pay_ref = ?, paid_at = ?, admin_note = ?,
         auto_cancelled = 2, needs_attention = 1, archived = 0
     WHERE id = ? AND status = 'cancelled' AND auto_cancelled = 1
       AND EXISTS (
         SELECT 1 FROM order_payments
          WHERE order_payments.order_id = orders.id
            AND order_payments.authority = ?
       )`,
  );
  const items = db.prepare('SELECT slug, qty FROM order_items WHERE order_id = ?');
  const finishPaid = db.prepare(
    `UPDATE orders
     SET status = 'paid', admin_note = ?, auto_cancelled = 0, needs_attention = 0, archived = 0
     WHERE id = ? AND status = 'cancelled' AND auto_cancelled = 2`,
  );
  const noteFailure = db.prepare(
    `UPDATE orders
     SET admin_note = ?, needs_attention = 1, archived = 0
     WHERE id = ? AND status = 'cancelled' AND auto_cancelled = 2`,
  );

  return db.transaction(() => {
    const orderId = String(id);
    const value = String(authority || '');
    if (!value || claim.run(
      provider,
      value,
      payRef || null,
      paidAt,
      failureNote,
      orderId,
      value,
    ).changes !== 1) {
      return { ok: false, error: 'state or authority changed' };
    }
    updateOrderPaymentAttempt(db, orderId, value, {
      status: 'verified',
      refId: payRef || null,
      verifiedAt: paidAt,
      lastError: '',
    });
    const reserved = reserveStock(db, items.all(orderId));
    if (reserved.ok) {
      finishPaid.run(successNote, orderId);
      updateOrderPaymentAttempt(db, orderId, value, { status: 'settled' });
      return { ok: true, reserved: true };
    }
    noteFailure.run(failureNote, orderId);
    return { ok: true, reserved: false, error: reserved.error };
  })();
}

/** Delete only orders that never received an online payment authority.
 * Payment evidence is deliberately retained: even an issued link may be paid
 * later, and its callback still needs the exact order mapping for settlement
 * or reversal. Inventory restoration and deletion share this transaction so
 * no database state change can race a pre-check and DELETE. */
export function deleteOrder(db, id, { restoreInventory = false } = {}) {
  const orderId = String(id || '');
  return db.transaction(() => {
    const order = db.prepare(
      'SELECT id, status, provider, pay_ref, paid_at FROM orders WHERE id = ?',
    ).get(orderId);
    if (!order) return { ok: false, error: 'not found' };

    /* Even an issued authority can still be open in a customer's browser and
       become a real charge after this request. Keep every online attempt and
       its parent order; otherwise that late callback would have nothing left
       to map, settle, or reverse. */
    const protectedAttempt = db.prepare(
      `SELECT *
         FROM order_payments
        WHERE order_id = ?
        ORDER BY verified_at DESC, at DESC
        LIMIT 1`,
    ).get(orderId);
    const protectedOrder = order.provider !== 'offline' && (
      order.pay_ref ||
      order.paid_at ||
      ['paid', 'shipped', 'delivered'].includes(order.status)
    );
    if (protectedAttempt || protectedOrder) {
      return {
        ok: false,
        error: 'payment history protected',
        attempt: paymentAttemptOut(protectedAttempt),
      };
    }

    if (restoreInventory && order.status !== 'cancelled') {
      const lines = db.prepare('SELECT slug, qty FROM order_items WHERE order_id = ?').all(orderId);
      const increment = db.prepare('UPDATE products SET stock = stock + ? WHERE slug = ? AND stock >= 0');
      for (const line of mergeStockLines(lines)) increment.run(line.qty, line.slug);
    }
    const removed = db.prepare('DELETE FROM orders WHERE id = ?').run(orderId).changes === 1;
    return removed ? { ok: true } : { ok: false, error: 'not found' };
  })();
}

/* ============================================================== comments */
const commentOut = (r) => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  text: r.text,
  at: r.at,
  approved: !!r.approved,
  reply: r.reply,
  replyAt: r.reply_at,
});

export function listComments(db) {
  return db.prepare('SELECT * FROM comments ORDER BY at DESC').all().map(commentOut);
}
export function listApprovedCommentsPage(db, slug, { limit = 8, cursor = null } = {}) {
  const boundedLimit = Math.max(1, Math.min(100, Math.trunc(Number(limit) || 8)));
  const fields = 'id, slug, name, text, at, reply, reply_at';
  const rows = cursor
    ? db.prepare(`
        SELECT ${fields}
          FROM comments
         WHERE slug = ? AND approved = 1
           AND (at < ? OR (at = ? AND id < ?))
         ORDER BY at DESC, id DESC
         LIMIT ?
      `).all(String(slug), cursor.at, cursor.at, cursor.id, boundedLimit)
    : db.prepare(`
        SELECT ${fields}
          FROM comments
         WHERE slug = ? AND approved = 1
         ORDER BY at DESC, id DESC
         LIMIT ?
      `).all(String(slug), boundedLimit);
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    text: r.text,
    at: r.at,
    reply: r.reply,
    replyAt: r.reply_at,
  }));
}
export function insertComment(db, c) {
  db.prepare(`
    INSERT INTO comments (id, slug, name, text, at, approved, reply, reply_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(c.id, c.slug, c.name, c.text, c.at, bool(c.approved), c.reply || null, c.replyAt || null);
  return c;
}
export function getComment(db, id) {
  const r = db.prepare('SELECT * FROM comments WHERE id = ?').get(String(id));
  return r ? commentOut(r) : null;
}
export function updateComment(db, id, patch) {
  const sets = [];
  const vals = [];
  if ('approved' in patch) {
    sets.push('approved = ?');
    vals.push(bool(patch.approved));
  }
  if ('reply' in patch) {
    sets.push('reply = ?', 'reply_at = ?');
    vals.push(patch.reply, patch.replyAt || null);
  }
  if (!sets.length) return;
  vals.push(String(id));
  db.prepare(`UPDATE comments SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}
export function deleteComment(db, id) {
  db.prepare('DELETE FROM comments WHERE id = ?').run(String(id));
}

/* ============================================================== messages */
const messageOut = (r) => ({
  id: r.id,
  name: r.name,
  phone: r.phone,
  email: r.email,
  subject: r.subject,
  message: r.message,
  at: r.at,
  read: !!r.read,
});

export function listMessages(db) {
  return db.prepare('SELECT * FROM messages ORDER BY at DESC').all().map(messageOut);
}
export function insertMessage(db, m) {
  db.prepare(`
    INSERT INTO messages (id, name, phone, email, subject, message, at, read)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(m.id, m.name, m.phone, m.email, m.subject, m.message, m.at, bool(m.read));
  return m;
}
export function updateMessage(db, id, read) {
  const info = db.prepare('UPDATE messages SET read = ? WHERE id = ?').run(bool(read), String(id));
  return info.changes > 0;
}
export function deleteMessage(db, id) {
  db.prepare('DELETE FROM messages WHERE id = ?').run(String(id));
}

/* ================================================= fresh installation */
const INSTALLATION_MARKER = 'installation.initializedAt';

/** Populate operational defaults exactly once and only for a proven empty
 * persistent tree. Existing databases without the marker are incompatible;
 * no file import, inference, or backfill is attempted. */
export function initializeOperationalStore(db, { freshInstall = false } = {}) {
  return withImmediateTransaction(db, () => {
    const initializedAt = getSetting(db, INSTALLATION_MARKER, '');
    if (initializedAt) {
      const display = getSetting(db, 'shop.display');
      const payment = getSetting(db, 'shop.payment');
      return typeof initializedAt === 'string' && record(display) && record(payment)
        ? { status: 'ready', initializedAt }
        : { status: 'unavailable', reason: 'operational initialization metadata is invalid' };
    }

    const counts = Object.fromEntries(
      ['products', 'orders', 'comments', 'messages'].map((table) => [
        table,
        Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count || 0),
      ]),
    );
    const shopSettings = Number(db.prepare(
      "SELECT COUNT(*) AS count FROM settings WHERE key LIKE 'shop.%'",
    ).get()?.count || 0);
    if (!freshInstall || Object.values(counts).some(Boolean) || shopSettings) {
      return {
        status: 'unavailable',
        reason: 'operational initialization marker is missing from an established state tree',
      };
    }

    const initialShop = SHOP_SEED();
    replaceProducts(db, DEFAULT_STATE.shop.products);
    setSetting(db, 'shop.display', cloneJson(DEFAULT_STATE.shop.display));
    setSetting(db, 'shop.payment', cloneJson(initialShop.payment));
    for (const comment of initialShop.comments) insertComment(db, comment);

    const now = new Date().toISOString();
    setSetting(db, INSTALLATION_MARKER, now);
    return {
      status: 'initialized',
      initializedAt: now,
      products: Number(db.prepare('SELECT COUNT(*) AS count FROM products').get().count),
      orders: 0,
      comments: initialShop.comments.length,
      messages: 0,
    };
  });
}

/** Initialize all mutable state under one outer writer transaction. If either
 * half cannot initialize safely, no fresh-install defaults are committed. */
export function initializeStore(db, { freshInstall = false } = {}) {
  return withImmediateTransaction(db, () => {
    const content = initializeContentStore(db, { freshInstall });
    const operational = initializeOperationalStore(db, { freshInstall });
    if (operational.status === 'unavailable') {
      throw Object.assign(new Error(operational.reason), { code: 'DB_INITIALIZATION_UNAVAILABLE' });
    }
    return { content, operational };
  });
}

/* ------------------------------------------------------------------ sms */
export function insertSmsLog(db, row) {
  db.prepare(
    `INSERT INTO sms_log (id, at, kind, phone, text, provider, environment, ok, error, message_id, ref)
     VALUES (@id, @at, @kind, @phone, @text, @provider, @environment, @ok, @error, @message_id, @ref)`
  ).run({
    id: row.id || crypto.randomUUID(),
    at: row.at || new Date().toISOString(),
    kind: row.kind || 'other',
    phone: row.phone || '',
    text: row.text || '',
    provider: row.provider || 'log',
    environment: row.environment || 'sandbox',
    ok: row.ok ? 1 : 0,
    error: row.error || '',
    message_id: row.messageId == null ? null : String(row.messageId),
    ref: row.ref || '',
  });
}

/** Successful sends since an ISO timestamp. Only successes count against the
 *  daily cap: a provider outage must not lock the shop out for the rest of
 *  the day on top of already having failed. */
export function countSmsSince(db, iso) {
  const row = db.prepare('SELECT COUNT(*) AS n FROM sms_log WHERE at >= ? AND ok = 1').get(iso);
  return Number(row?.n || 0);
}

export function listSmsLog(db, limit = 50) {
  return db
    .prepare('SELECT * FROM sms_log ORDER BY at DESC LIMIT ?')
    .all(Math.max(1, Math.min(500, Number(limit) || 50)))
    .map((r) => ({
      id: r.id,
      at: r.at,
      kind: r.kind,
      phone: r.phone,
      text: r.text,
      provider: r.provider,
      environment: r.environment,
      ok: !!r.ok,
      error: r.error,
      messageId: r.message_id,
      ref: r.ref,
    }));
}

/* ------------------------------------------------------------- accounts */
const customerRow = (r) =>
  r && {
    id: r.id,
    phone: r.phone,
    name: r.name,
    email: r.email,
    at: r.at,
    lastLoginAt: r.last_login_at,
    blocked: !!r.blocked,
  };

export function getCustomerByPhone(db, phone) {
  return db.prepare('SELECT * FROM customers WHERE phone = ?').get(String(phone || ''));
}
export function getCustomerById(db, id) {
  return db.prepare('SELECT * FROM customers WHERE id = ?').get(String(id || ''));
}
export const publicCustomer = customerRow;

export function insertCustomer(db, c) {
  db.prepare(
    `INSERT INTO customers (id, phone, name, email, pass_hash, at)
     VALUES (@id, @phone, @name, @email, @pass_hash, @at)`
  ).run({ id: c.id, phone: c.phone, name: c.name || '', email: c.email || '', pass_hash: c.passHash, at: c.at });
  return getCustomerById(db, c.id);
}

export function updateCustomer(db, id, patch) {
  const map = { name: 'name', email: 'email', passHash: 'pass_hash', lastLoginAt: 'last_login_at', blocked: 'blocked' };
  const sets = [];
  const vals = {};
  for (const [k, col] of Object.entries(map)) {
    if (patch[k] === undefined) continue;
    sets.push(`${col} = @${k}`);
    vals[k] = typeof patch[k] === 'boolean' ? (patch[k] ? 1 : 0) : patch[k];
  }
  if (!sets.length) return getCustomerById(db, id);
  db.prepare(`UPDATE customers SET ${sets.join(', ')} WHERE id = @id`).run({ ...vals, id });
  return getCustomerById(db, id);
}

export function updateCustomerPasswordIfCurrent(db, id, expectedHash, passHash) {
  const changed = db.prepare(
    'UPDATE customers SET pass_hash = ? WHERE id = ? AND pass_hash = ?',
  ).run(String(passHash || ''), String(id || ''), String(expectedHash || '')).changes === 1;
  return changed ? getCustomerById(db, id) : null;
}

export function countCustomers(db) {
  return Number(db.prepare('SELECT COUNT(*) AS n FROM customers').get()?.n || 0);
}

export function listCustomers(db, limit = 200) {
  return db
    .prepare('SELECT * FROM customers ORDER BY at DESC LIMIT ?')
    .all(Math.max(1, Math.min(1000, Number(limit) || 200)))
    .map(customerRow);
}

/* -------- sessions -------- */
export function insertSession(db, { tokenHash, customerId, expiresAt, ua }) {
  db.prepare(
    `INSERT INTO customer_sessions (token_hash, customer_id, at, expires_at, ua)
     VALUES (?, ?, ?, ?, ?)`
  ).run(tokenHash, customerId, new Date().toISOString(), expiresAt, String(ua || '').slice(0, 200));
}

export function getSession(db, tokenHash) {
  const row = db.prepare('SELECT * FROM customer_sessions WHERE token_hash = ?').get(String(tokenHash || ''));
  if (!row) return null;
  /* Expiry is enforced on read as well as by the sweep: a session must not
     stay usable just because the cleanup has not run yet. */
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    deleteSession(db, tokenHash);
    return null;
  }
  return row;
}

export function deleteSession(db, tokenHash) {
  db.prepare('DELETE FROM customer_sessions WHERE token_hash = ?').run(String(tokenHash || ''));
}

export function deleteSessionsFor(db, customerId) {
  db.prepare('DELETE FROM customer_sessions WHERE customer_id = ?').run(String(customerId || ''));
}

export function sweepSessions(db) {
  db.prepare('DELETE FROM customer_sessions WHERE expires_at <= ?').run(new Date().toISOString());
  db.prepare('DELETE FROM otps WHERE expires_at <= ?').run(new Date(Date.now() - 3600_000).toISOString());
  db.prepare('DELETE FROM otp_tickets WHERE expires_at <= ?').run(new Date().toISOString());
}

/* -------- otp -------- */
export function putOtp(db, { phone, purpose, codeHash, expiresAt }) {
  db.prepare(
    `INSERT INTO otps (phone, purpose, code_hash, at, expires_at, attempts)
     VALUES (@phone, @purpose, @code_hash, @at, @expires_at, 0)
     ON CONFLICT(phone, purpose) DO UPDATE SET
       code_hash = @code_hash, at = @at, expires_at = @expires_at, attempts = 0`
  ).run({ phone, purpose, code_hash: codeHash, at: new Date().toISOString(), expires_at: expiresAt });
}

export function getOtp(db, phone, purpose) {
  return db.prepare('SELECT * FROM otps WHERE phone = ? AND purpose = ?').get(String(phone), String(purpose));
}

export function bumpOtpAttempts(db, phone, purpose) {
  db.prepare('UPDATE otps SET attempts = attempts + 1 WHERE phone = ? AND purpose = ?').run(String(phone), String(purpose));
}

export function deleteOtp(db, phone, purpose) {
  db.prepare('DELETE FROM otps WHERE phone = ? AND purpose = ?').run(String(phone), String(purpose));
}

export function putTicket(db, { ticketHash, phone, purpose, expiresAt }) {
  db.prepare('INSERT OR REPLACE INTO otp_tickets (ticket_hash, phone, purpose, expires_at) VALUES (?, ?, ?, ?)').run(
    ticketHash,
    phone,
    purpose,
    expiresAt
  );
}

/** Single use: the row is deleted as it is read, so the same proof cannot
 *  register two accounts or reset a password twice. */
export function consumeTicket(db, ticketHash, purpose) {
  const row = db.prepare('SELECT * FROM otp_tickets WHERE ticket_hash = ?').get(String(ticketHash || ''));
  if (!row) return null;
  db.prepare('DELETE FROM otp_tickets WHERE ticket_hash = ?').run(String(ticketHash));
  if (row.purpose !== purpose) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  return row;
}

/** Successful OTP sends to one phone since a timestamp — the per-phone
 *  throttle, which is the one that protects the customer's inbox and the
 *  SMS credit at the same time. */
export function countOtpSends(db, phone, sinceIso) {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM sms_log WHERE phone = ? AND kind = 'otp' AND at >= ?")
    .get(String(phone), sinceIso);
  return Number(row?.n || 0);
}

/* -------- addresses -------- */
const addressRow = (r) =>
  r && {
    id: r.id,
    isDefault: !!r.is_default,
    title: r.title,
    receiver: r.receiver,
    phone: r.phone,
    province: r.province,
    city: r.city,
    address: r.address,
    plaque: r.plaque,
    unit: r.unit,
    postal: r.postal,
    note: r.note,
    at: r.at,
  };

export function listAddresses(db, customerId) {
  return db
    .prepare('SELECT * FROM addresses WHERE customer_id = ? ORDER BY is_default DESC, pos ASC, at ASC')
    .all(String(customerId))
    .map(addressRow);
}

export function getAddress(db, customerId, id) {
  return addressRow(db.prepare('SELECT * FROM addresses WHERE id = ? AND customer_id = ?').get(String(id), String(customerId)));
}

export function insertAddress(db, customerId, a, makeDefault) {
  const id = crypto.randomUUID();
  const first = listAddresses(db, customerId).length === 0;
  db.prepare(
    `INSERT INTO addresses (id, customer_id, pos, is_default, title, receiver, phone, province, city, address, plaque, unit, postal, note, at)
     VALUES (@id, @customer_id, @pos, @is_default, @title, @receiver, @phone, @province, @city, @address, @plaque, @unit, @postal, @note, @at)`
  ).run({
    id,
    customer_id: customerId,
    pos: Date.now() % 100000,
    is_default: makeDefault || first ? 1 : 0,
    title: a.title,
    receiver: a.receiver,
    phone: a.phone,
    province: a.province,
    city: a.city,
    address: a.address,
    plaque: a.plaque,
    unit: a.unit,
    postal: a.postal,
    note: a.note,
    at: new Date().toISOString(),
  });
  if (makeDefault || first) setDefaultAddress(db, customerId, id);
  return getAddress(db, customerId, id);
}

export function updateAddress(db, customerId, id, a) {
  const existing = getAddress(db, customerId, id);
  if (!existing) return null;
  db.prepare(
    `UPDATE addresses SET title=@title, receiver=@receiver, phone=@phone, province=@province, city=@city,
       address=@address, plaque=@plaque, unit=@unit, postal=@postal, note=@note
     WHERE id=@id AND customer_id=@customer_id`
  ).run({ ...a, id, customer_id: customerId });
  return getAddress(db, customerId, id);
}

export function deleteAddress(db, customerId, id) {
  const row = getAddress(db, customerId, id);
  if (!row) return false;
  db.prepare('DELETE FROM addresses WHERE id = ? AND customer_id = ?').run(String(id), String(customerId));
  /* Never leave a customer with addresses but no default. */
  if (row.isDefault) {
    const next = listAddresses(db, customerId)[0];
    if (next) setDefaultAddress(db, customerId, next.id);
  }
  return true;
}

export function setDefaultAddress(db, customerId, id) {
  const tx = db.transaction(() => {
    db.prepare('UPDATE addresses SET is_default = 0 WHERE customer_id = ?').run(String(customerId));
    db.prepare('UPDATE addresses SET is_default = 1 WHERE id = ? AND customer_id = ?').run(String(id), String(customerId));
  });
  tx();
  return listAddresses(db, customerId);
}

/* -------- orders by customer -------- */
export function listOrdersForCustomer(db, customerId) {
  const rows = db.prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY at DESC').all(String(customerId));
  return rows.map((r) => orderOut(r, itemsOf(db, r.id)));
}
