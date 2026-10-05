/* ==========================================================================
   Khuzestan Yeast Co. — SQLite data layer
   --------------------------------------------------------------------------
   Single file database: server/data/khyeast.db  (WAL mode, transactional)

   Stored here : shop products, shop display settings, payment credentials,
                 orders + order items, product comments, contact messages.
   Stored as files (unchanged): server/data/content.json (site texts, media,
                 links, brands, catalog products, blog posts) and
                 server/uploads/* (admin uploads).

   The public/admin HTTP contract is IDENTICAL to the previous JSON storage —
   objects are converted back to the same shapes on read.
   ========================================================================== */
import { createDatabase } from './sqlite.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import DEFAULT_STATE from '../shared/contentDefaults.js';
import { SHOP_SEED } from './seed.js';

/* ------------------------------------------------------------------ open */
export async function openDB(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = await createDatabase(file);
  db.pragma('journal_mode = WAL'); // safe concurrent readers + one writer
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      slug           TEXT PRIMARY KEY,
      pos            INTEGER NOT NULL DEFAULT 0,
      title          TEXT NOT NULL DEFAULT '',
      brand          TEXT NOT NULL DEFAULT '',
      product_slug   TEXT NOT NULL DEFAULT '',
      unit           TEXT NOT NULL DEFAULT '',
      image          TEXT NOT NULL DEFAULT '',
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
    CREATE INDEX IF NOT EXISTS idx_products_pos ON products(pos);

    CREATE TABLE IF NOT EXISTS orders (
      id         TEXT PRIMARY KEY,
      code       TEXT NOT NULL UNIQUE,
      token      TEXT NOT NULL,
      customer   TEXT NOT NULL DEFAULT '{}',
      subtotal   INTEGER NOT NULL DEFAULT 0,
      shipping   INTEGER NOT NULL DEFAULT 0,
      total      INTEGER NOT NULL DEFAULT 0,
      currency   TEXT NOT NULL DEFAULT 'IRR',
      status     TEXT NOT NULL DEFAULT 'pending_payment',
      provider   TEXT NOT NULL DEFAULT 'offline',
      pay_ref    TEXT,
      admin_note TEXT NOT NULL DEFAULT '',
      at         TEXT NOT NULL,
      paid_at    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_orders_at ON orders(at DESC);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

    CREATE TABLE IF NOT EXISTS order_items (
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      pos      INTEGER NOT NULL DEFAULT 0,
      slug     TEXT NOT NULL DEFAULT '',
      title    TEXT NOT NULL DEFAULT '',
      unit     TEXT NOT NULL DEFAULT '',
      price    INTEGER NOT NULL DEFAULT 0,
      qty      INTEGER NOT NULL DEFAULT 1,
      sum      INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);

    CREATE TABLE IF NOT EXISTS comments (
      id       TEXT PRIMARY KEY,
      slug     TEXT NOT NULL DEFAULT '',
      name     TEXT NOT NULL DEFAULT '',
      text     TEXT NOT NULL DEFAULT '',
      at       TEXT NOT NULL,
      approved INTEGER NOT NULL DEFAULT 0,
      reply    TEXT,
      reply_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_comments_slug ON comments(slug);
    CREATE INDEX IF NOT EXISTS idx_comments_at ON comments(at DESC);

    CREATE TABLE IF NOT EXISTS messages (
      id      TEXT PRIMARY KEY,
      name    TEXT NOT NULL DEFAULT '',
      phone   TEXT NOT NULL DEFAULT '',
      email   TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      at      TEXT NOT NULL,
      read    INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_messages_at ON messages(at DESC);

    /* Every send attempt, successful or not. Three jobs: the admin can see
       why a customer says they got nothing, the daily cap is countable, and
       a provider outage leaves evidence. The body is kept because an SMS is
       cheap to store and impossible to reconstruct.

       The phone column holds the canonical 98xxxxxxxxxx form — the same key
       the rest of the system uses, so a customer's messages can be found. */
    CREATE TABLE IF NOT EXISTS sms_log (
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
    CREATE INDEX IF NOT EXISTS idx_sms_at ON sms_log(at DESC);
    CREATE INDEX IF NOT EXISTS idx_sms_phone ON sms_log(phone);

    /* ---------------- customer accounts ----------------
       phone is the identity and the login name, always in canonical
       98xxxxxxxxxx form so one person cannot become three accounts by
       typing their number three ways. */
    CREATE TABLE IF NOT EXISTS customers (
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
    CREATE TABLE IF NOT EXISTS customer_sessions (
      token_hash  TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      at          TEXT NOT NULL,
      expires_at  TEXT NOT NULL,
      ua          TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_customer ON customer_sessions(customer_id);

    /* One live code per phone+purpose: requesting a new one replaces the
       old, so an attacker cannot keep a pool of valid codes alive. */
    CREATE TABLE IF NOT EXISTS otps (
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
    CREATE TABLE IF NOT EXISTS otp_tickets (
      ticket_hash TEXT PRIMARY KEY,
      phone       TEXT NOT NULL,
      purpose     TEXT NOT NULL,
      expires_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS addresses (
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
    CREATE INDEX IF NOT EXISTS idx_addresses_customer ON addresses(customer_id);
  `);

  /* orders.customer_id is added separately: the table predates accounts and
     ALTER TABLE ... ADD COLUMN throws if it is already there. */
  const orderCols = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
  if (!orderCols.includes('customer_id')) {
    db.exec('ALTER TABLE orders ADD COLUMN customer_id TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id)');
  }
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

/* ============================================================== products */
const productOut = (r) => ({
  slug: r.slug,
  title: r.title,
  brand: r.brand,
  productSlug: r.product_slug,
  unit: r.unit,
  image: r.image,
  price: r.price,
  oldPrice: r.old_price == null ? null : r.old_price,
  stock: r.stock,
  active: !!r.active,
  featured: !!r.featured,
  commentsLocked: !!r.comments_locked,
  short: r.short,
  description: r.description,
  specs: J(r.specs, []),
});

export function listProducts(db) {
  return db.prepare('SELECT * FROM products ORDER BY pos ASC').all().map(productOut);
}
export function getProduct(db, slug) {
  const r = db.prepare('SELECT * FROM products WHERE slug = ?').get(String(slug));
  return r ? productOut(r) : null;
}

const insertProduct = (db) =>
  db.prepare(`
    INSERT INTO products (slug, pos, title, brand, product_slug, unit, image, price, old_price, stock,
                          active, featured, comments_locked, short, description, specs)
    VALUES (@slug, @pos, @title, @brand, @product_slug, @unit, @image, @price, @old_price, @stock,
            @active, @featured, @comments_locked, @short, @description, @specs)
  `);

const productIn = (p, pos) => ({
  slug: String(p.slug || '').trim(),
  pos,
  title: String(p.title || ''),
  brand: String(p.brand || ''),
  product_slug: String(p.productSlug || ''),
  unit: String(p.unit || ''),
  image: String(p.image || ''),
  price: Math.max(0, Math.round(Number(p.price) || 0)),
  old_price: p.oldPrice == null || p.oldPrice === '' ? null : Math.max(0, Math.round(Number(p.oldPrice) || 0)),
  stock: Number.isFinite(Number(p.stock)) ? Math.round(Number(p.stock)) : -1,
  active: bool(p.active !== false),
  featured: bool(p.featured),
  comments_locked: bool(p.commentsLocked),
  short: String(p.short || ''),
  description: String(p.description || ''),
  specs: JSON.stringify(Array.isArray(p.specs) ? p.specs : []),
});

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

/** Atomically check + decrement stock for an order. Returns {ok, error}. */
export function reserveStock(db, lines) {
  const get = db.prepare('SELECT stock FROM products WHERE slug = ?');
  const dec = db.prepare('UPDATE products SET stock = MAX(0, stock - ?) WHERE slug = ? AND stock >= 0');
  const run = db.transaction((items) => {
    for (const l of items) {
      const row = get.get(l.slug);
      if (!row) throw new Error(`unknown product: ${l.slug}`);
      if (row.stock >= 0 && l.qty > row.stock) throw new Error('insufficient stock');
    }
    for (const l of items) dec.run(l.qty, l.slug);
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
  db.transaction((items) => items.forEach((l) => inc.run(l.qty, l.slug)))(lines || []);
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
  payRef: r.pay_ref,
  adminNote: r.admin_note,
  at: r.at,
  paidAt: r.paid_at,
  customerId: r.customer_id || null,
});

const itemsOf = (db, id) =>
  db
    .prepare('SELECT slug, title, unit, price, qty, sum FROM order_items WHERE order_id = ? ORDER BY pos ASC')
    .all(id);

export function listOrders(db) {
  const rows = db.prepare('SELECT * FROM orders ORDER BY at DESC').all();
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

export function insertOrder(db, o) {
  const ins = db.prepare(`
    INSERT INTO orders (id, code, token, customer, subtotal, shipping, total, currency, status,
                        provider, pay_ref, admin_note, at, paid_at, customer_id)
    VALUES (@id, @code, @token, @customer, @subtotal, @shipping, @total, @currency, @status,
            @provider, @pay_ref, @admin_note, @at, @paid_at, @customer_id)
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
      pay_ref: o.payRef || null,
      admin_note: o.adminNote || '',
      at: o.at,
      paid_at: o.paidAt || null,
      customer_id: o.customerId || null,
    });
    (o.items || []).forEach((l, i) =>
      insItem.run(o.id, i, l.slug, l.title, l.unit || '', l.price, l.qty, l.sum),
    );
  })();
  return o;
}

export function updateOrder(db, id, patch) {
  const map = {
    status: 'status',
    provider: 'provider',
    payRef: 'pay_ref',
    adminNote: 'admin_note',
    paidAt: 'paid_at',
  };
  const sets = [];
  const vals = [];
  for (const [k, col] of Object.entries(map)) {
    if (k in patch) {
      sets.push(`${col} = ?`);
      vals.push(patch[k]);
    }
  }
  if (!sets.length) return;
  vals.push(String(id));
  db.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function deleteOrder(db, id) {
  db.prepare('DELETE FROM orders WHERE id = ?').run(String(id));
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
export function listApprovedComments(db) {
  return db
    .prepare('SELECT id, slug, name, text, at, reply, reply_at FROM comments WHERE approved = 1 ORDER BY at DESC')
    .all()
    .map((r) => ({ id: r.id, slug: r.slug, name: r.name, text: r.text, at: r.at, reply: r.reply, replyAt: r.reply_at }));
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

/* ========================================================= seed & import */
/**
 * First run / empty DB: pull data from the legacy JSON files when present,
 * otherwise from the shipped defaults. Runs only once (settings.seeded).
 */
export function seedFromLegacy(db, { CONTENT_FILE, SHOP_FILE, MESSAGES_FILE }) {
  if (getSetting(db, 'seeded')) return { skipped: true };
  const report = { products: 0, orders: 0, comments: 0, messages: 0, from: [] };

  const readJSON = (f) => {
    try {
      return JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch {
      return null;
    }
  };

  /* --- shop products + display settings (content.json → DB) --- */
  const content = readJSON(CONTENT_FILE);
  const shop = content?.shop || DEFAULT_STATE.shop;
  replaceProducts(db, shop.products || DEFAULT_STATE.shop.products);
  setSetting(db, 'shop.display', { ...DEFAULT_STATE.shop.display, ...(shop.display || {}) });
  report.products = db.prepare('SELECT COUNT(*) n FROM products').get().n;
  if (content?.shop) report.from.push('content.json');

  /* --- orders, comments, payment (shop.json → DB) --- */
  const legacyShop = readJSON(SHOP_FILE) || SHOP_SEED();
  if (readJSON(SHOP_FILE)) report.from.push('shop.json');
  for (const o of legacyShop.orders || []) {
    insertOrder(db, o);
    report.orders++;
  }
  for (const c of legacyShop.comments || []) {
    insertComment(db, c);
    report.comments++;
  }
  setSetting(db, 'shop.payment', legacyShop.payment || SHOP_SEED().payment);

  /* --- contact messages (messages.json → DB) --- */
  const legacyMessages = readJSON(MESSAGES_FILE);
  if (Array.isArray(legacyMessages)) {
    report.from.push('messages.json');
    for (const m of legacyMessages) {
      insertMessage(db, { ...m, id: m.id || crypto.randomUUID(), at: m.at || new Date().toISOString() });
      report.messages++;
    }
  }

  setSetting(db, 'seeded', new Date().toISOString());
  return report;
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
