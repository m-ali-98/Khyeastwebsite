/* ==========================================================================
   Online shop routes — products, orders, comments & payment callbacks.
   --------------------------------------------------------------------------
   Storage: SQLite (server/data/khyeast.db) through server/db.js.
   Shop products, display settings, orders, comments and payment credentials
   all live in the database; credentials are never exposed to the public API.
   ========================================================================== */
import express from 'express';
import crypto from 'node:crypto';
import DEFAULT_STATE from '../shared/contentDefaults.js';
import { createPayment, verifyPayment, normalizePayment } from './payment.js';
import * as db from './db.js';

/* ---------------------------------------------------------------------------
   Trusted origin for payment callback URLs.

   `req.get('host')` is whatever the client sent. An attacker can point the
   gateway's return URL at a host they control, which leaks the order token in
   the callback query string. So: prefer the admin-configured callbackBase,
   then PUBLIC_ORIGIN from the environment, and only fall back to the request
   host when it is in the allowlist (or when no allowlist is configured, which
   is the local-development case).
--------------------------------------------------------------------------- */
const PUBLIC_ORIGIN = String(process.env.PUBLIC_ORIGIN || '').trim().replace(/\/+$/, '');
const TRUSTED_HOSTS = String(process.env.TRUSTED_HOSTS || '')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

function safeOrigin(req, configuredBase) {
  if (configuredBase) return configuredBase;
  if (PUBLIC_ORIGIN) return PUBLIC_ORIGIN;
  const host = String(req.get('host') || '').toLowerCase();
  if (TRUSTED_HOSTS.length && !TRUSTED_HOSTS.includes(host)) return '';
  if (!/^[a-z0-9.\-]+(:\d+)?$/.test(host)) return '';
  return `${req.protocol}://${host}`;
}

export { SHOP_SEED } from './seed.js';

const ORDER_STATUS = ['pending_payment', 'paid', 'shipped', 'delivered', 'cancelled'];
const rand = (n) => crypto.randomBytes(n).toString('hex');
const orderCode = () => `KY-${Date.now().toString(36).slice(-5).toUpperCase()}${rand(2).toUpperCase()}`;

/* tiny in-memory rate limit: max 5 public writes / 10 min / ip */
const RL_WINDOW = 10 * 60 * 1000;
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < RL_WINDOW);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > 5;
}

/* Sweep expired entries — otherwise every IP that ever posted stays in memory
   for the lifetime of the process. */
setInterval(() => {
  const cut = Date.now() - RL_WINDOW;
  for (const [ip, times] of hits) {
    const keep = times.filter((t) => t > cut);
    if (keep.length) hits.set(ip, keep);
    else hits.delete(ip);
  }
}, RL_WINDOW).unref();

export function createShopRouter({ database, requireAuth }) {
  const r = express.Router();
  const D = database;

  const display = () => ({ ...DEFAULT_STATE.shop.display, ...(db.getSetting(D, 'shop.display') || {}) });
  const payment = () => normalizePayment(db.getSetting(D, 'shop.payment') || {});

  /* ---------------- public ---------------- */
  r.get('/api/shop-public', (_req, res) => {
    res.json({
      display: display(),
      paymentProvider: payment().provider,
      comments: db.listApprovedComments(D),
    });
  });

  /** Public product catalogue (shop products live in the DB now). */
  r.get('/api/shop-products', (_req, res) => {
    res.json({ products: db.listProducts(D).filter((p) => p.active) });
  });

  r.post('/api/shop-public/comments', (req, res) => {
    if (rateLimited(req.ip)) return res.status(429).json({ error: 'rate limited' });
    const { slug, name, text } = req.body || {};
    if (!slug || !name || !text) return res.status(400).json({ error: 'fields required' });
    const product = db.getProduct(D, slug);
    if (!product || !product.active) return res.status(404).json({ error: 'product not found' });
    const d = display();
    if (!d.commentsEnabled || product.commentsLocked) return res.status(403).json({ error: 'comments closed' });
    const item = {
      id: `c-${rand(6)}`,
      slug: product.slug,
      name: String(name).slice(0, 120),
      text: String(text).slice(0, 1500),
      at: new Date().toISOString(),
      approved: !d.commentsRequireApproval,
      reply: null,
      replyAt: null,
    };
    db.insertComment(D, item);
    res.json({ ok: true, id: item.id, pending: !item.approved });
  });

  r.post('/api/shop-public/orders', async (req, res) => {
    if (rateLimited(req.ip)) return res.status(429).json({ error: 'rate limited' });
    const { items, customer } = req.body || {};
    const d = display();
    if (!d.enabled) return res.status(403).json({ error: 'shop disabled' });
    if (!Array.isArray(items) || !items.length || items.length > 50)
      return res.status(400).json({ error: 'invalid items' });
    const c = customer || {};
    const name = String(c.name || '').trim();
    const phone = String(c.phone || '').trim();
    const city = String(c.city || '').trim();
    const address = String(c.address || '').trim();
    if (name.length < 3 || city.length < 2 || address.length < 10)
      return res.status(400).json({ error: 'customer fields required' });
    if (!/^(\+98|0098|0)?9\d{9}$/.test(phone.replace(/[\s-]/g, '')))
      return res.status(400).json({ error: 'invalid phone' });

    /* price strictly server-side */
    const lines = [];
    let subtotal = 0;
    for (const it of items) {
      const product = db.getProduct(D, it?.slug);
      if (!product || !product.active) return res.status(400).json({ error: `unknown product: ${it?.slug}` });
      const qty = Math.max(1, Math.min(999, parseInt(it?.qty, 10) || 1));
      if (Number(product.stock) >= 0 && qty > Number(product.stock))
        return res.status(409).json({ error: 'insufficient stock' });
      const price = Math.max(0, Math.round(Number(product.price) || 0));
      lines.push({ slug: product.slug, title: product.title, unit: product.unit || '', price, qty, sum: price * qty });
      subtotal += price * qty;
    }
    const freeOver = Number(d.freeShippingOver) || 0;
    const shipping = freeOver > 0 && subtotal >= freeOver ? 0 : Math.max(0, Math.round(Number(d.shippingCost) || 0));
    const total = subtotal + shipping;

    /* atomic stock check + decrement (transaction) */
    const reserved = db.reserveStock(D, lines);
    if (!reserved.ok) {
      const status = reserved.error === 'insufficient stock' ? 409 : 400;
      return res.status(status).json({ error: reserved.error });
    }

    const order = {
      id: crypto.randomUUID(),
      code: orderCode(),
      token: rand(16),
      items: lines,
      customer: {
        name: name.slice(0, 200),
        phone: phone.slice(0, 20),
        city: city.slice(0, 100),
        address: address.slice(0, 600),
        postal: String(c.postal || '').slice(0, 20),
        note: String(c.note || '').slice(0, 1000),
      },
      subtotal,
      shipping,
      total,
      currency: 'IRR',
      status: 'pending_payment',
      provider: 'offline',
      payRef: null,
      adminNote: '',
      at: new Date().toISOString(),
      paidAt: null,
    };

    /* payment */
    const pm = payment();
    const origin = safeOrigin(req, pm.callbackBase);
    let pay = { provider: 'offline', ref: null, payUrl: null };
    if (pm.provider !== 'offline') {
      try {
        pay = await createPayment(pm, order, { origin });
      } catch (e) {
        console.error('[shop] gateway error:', e.message);
        pay = { provider: 'offline', ref: null, payUrl: null, gatewayError: true };
      }
    }
    order.provider = pay.provider;
    order.payRef = pay.ref;

    db.insertOrder(D, order);
    res.json({
      ok: true,
      order: { code: order.code, token: order.token, total: order.total, status: order.status, provider: order.provider },
      payment: { provider: pay.provider, payUrl: pay.payUrl || null, gatewayError: !!pay.gatewayError },
    });
  });

  /* retry payment for a pending order */
  r.post('/api/shop-public/orders/:code/pay', async (req, res) => {
    const order = db.getOrderByCode(D, req.params.code);
    if (!order) return res.status(404).json({ error: 'not found' });
    if (req.body?.token !== order.token) return res.status(403).json({ error: 'invalid token' });
    if (order.status !== 'pending_payment') return res.status(409).json({ error: 'order already processed' });
    const pm = payment();
    if (pm.provider === 'offline') return res.status(409).json({ error: 'online payment disabled' });
    const origin = safeOrigin(req, pm.callbackBase);
    try {
      const pay = await createPayment(pm, order, { origin });
      db.updateOrder(D, order.id, { provider: pay.provider, payRef: pay.ref });
      res.json({ ok: true, payment: { provider: pay.provider, payUrl: pay.payUrl } });
    } catch {
      res.status(502).json({ error: 'gateway error' });
    }
  });

  /* order tracking (needs the private order token) */
  r.get('/api/shop-public/orders/:code', (req, res) => {
    const order = db.getOrderByCode(D, req.params.code);
    if (!order || req.query.token !== order.token) return res.status(404).json({ error: 'not found' });
    const { token, ...rest } = order;
    res.json({ order: rest });
  });

  /* ---------------- gateway callbacks ---------------- */
  r.get('/api/shop-pay/:provider/callback', async (req, res) => {
    const provider = req.params.provider;
    if (!['zarinpal', 'idpay'].includes(provider)) return res.status(404).send('unknown gateway');
    const code = provider === 'zarinpal' ? String(req.query.code || '') : String(req.query.order_id || '');
    const order = db.getOrderByCode(D, code);
    if (!order) return res.status(404).send('unknown order');
    let ok = false;
    let ref = '';
    try {
      const out = await verifyPayment(payment(), provider, req.query, order.total);
      ok = out.ok;
      ref = out.ref;
      if (out.amountMismatch) {
        console.error(
          `[shop] REJECTED payment for ${order.code}: gateway settled ` +
            `${out.amountMismatch.paid} toman but the order is ${out.amountMismatch.expected} toman`,
        );
      }
    } catch (e) {
      console.error('[shop] verify error:', e.message);
    }
    if (ok && order.status === 'pending_payment') {
      db.updateOrder(D, order.id, {
        status: 'paid',
        provider,
        payRef: ref || order.payRef,
        paidAt: new Date().toISOString(),
      });
    }
    res.redirect(`/shop/order/${encodeURIComponent(order.code)}?pay=${ok ? 'ok' : 'fail'}`);
  });

  /* ---------------- admin ---------------- */
  r.get('/api/shop-admin', requireAuth, (_req, res) => {
    res.json({ orders: db.listOrders(D), comments: db.listComments(D) });
  });

  /* products + display settings (admin panel) */
  r.get('/api/shop-admin/products', requireAuth, (_req, res) => {
    res.json({ products: db.listProducts(D), display: display() });
  });

  r.put('/api/shop-admin/products', requireAuth, (req, res) => {
    const b = req.body || {};
    if (Array.isArray(b.products)) db.replaceProducts(D, b.products);
    if (b.display && typeof b.display === 'object')
      db.setSetting(D, 'shop.display', { ...display(), ...b.display });
    res.json({ ok: true, products: db.listProducts(D), display: display() });
  });

  r.patch('/api/shop-admin/comments/:id', requireAuth, (req, res) => {
    const item = db.getComment(D, req.params.id);
    if (!item) return res.status(404).json({ error: 'not found' });
    const b = req.body || {};
    const patch = {};
    if ('approved' in b) patch.approved = Boolean(b.approved);
    if ('reply' in b) {
      const reply = b.reply === null || String(b.reply).trim() === '' ? null : String(b.reply).slice(0, 2000);
      patch.reply = reply;
      patch.replyAt = reply ? new Date().toISOString() : null;
    }
    db.updateComment(D, item.id, patch);
    res.json({ ok: true });
  });

  r.delete('/api/shop-admin/comments/:id', requireAuth, (req, res) => {
    db.deleteComment(D, req.params.id);
    res.json({ ok: true });
  });

  r.patch('/api/shop-admin/orders/:id', requireAuth, (req, res) => {
    const order = db.getOrderById(D, req.params.id);
    if (!order) return res.status(404).json({ error: 'not found' });
    const b = req.body || {};
    const patch = {};
    if ('status' in b && ORDER_STATUS.includes(b.status)) {
      patch.status = b.status;
      if (b.status === 'paid' && !order.paidAt) patch.paidAt = new Date().toISOString();
      /* cancelling a not-yet-cancelled order returns the reserved stock */
      if (b.status === 'cancelled' && order.status !== 'cancelled') db.restoreStock(D, order.items);
    }
    if ('adminNote' in b) patch.adminNote = String(b.adminNote || '').slice(0, 1000);
    db.updateOrder(D, order.id, patch);
    res.json({ ok: true });
  });

  r.delete('/api/shop-admin/orders/:id', requireAuth, (req, res) => {
    db.deleteOrder(D, req.params.id);
    res.json({ ok: true });
  });

  r.get('/api/shop-admin/payment', requireAuth, (_req, res) => res.json(payment()));

  r.put('/api/shop-admin/payment', requireAuth, (req, res) => {
    const next = normalizePayment(req.body || {});
    db.setSetting(D, 'shop.payment', next);
    res.json({ ok: true, payment: next });
  });

  return r;
}
