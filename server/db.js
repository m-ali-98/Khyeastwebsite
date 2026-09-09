/* ==========================================================================
   Khuzestan Yeast Co. — SQLite data layer (better-sqlite3)
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
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import DEFAULT_STATE from '../shared/contentDefaults.js';
import { SHOP_SEED } from './seed.js';

/* ------------------------------------------------------------------ open */
export function openDB(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
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
  `);
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

/** Replace the whole product list (admin saves the full array). */
export function replaceProducts(db, products) {
  const ins = insertProduct(db);
  const run = db.transaction((list) => {
    db.prepare('DELETE FROM products').run();
    list.forEach((p, i) => {
      const row = productIn(p, i);
      if (row.slug) ins.run(row);
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
                        provider, pay_ref, admin_note, at, paid_at)
    VALUES (@id, @code, @token, @customer, @subtotal, @shipping, @total, @currency, @status,
            @provider, @pay_ref, @admin_note, @at, @paid_at)
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
