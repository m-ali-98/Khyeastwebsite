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
import { createPayment, verifyPayment, normalizePayment, publicPayment, mergePayment } from './payment.js';
import { formatAddress } from './accounts.js';
import {
  sendSms,
  normalizeSms,
  mergeSmsSettings,
  publicSmsSettings,
  smsReadiness,
  normalizePhone,
  toLocalPhone,
  orderStatusUrl,
  orderSmsText,
} from './sms.js';
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

/* Tiny in-memory rate limit, per IP.

   Two things here are deliberate and were both bugs before:

   1. Orders and comments get SEPARATE buckets. Sharing one counter meant a
      shopper who asked five questions on product pages could no longer place
      an order at all — the checkout answered "rate limited" with no
      explanation.
   2. `check()` only reports; `record()` is called by the route *after* the
      request is known to be valid. Counting on entry meant five mistyped
      phone numbers locked a real customer out of checkout for ten minutes.

   Limits differ by intent: comments are chatter, orders are revenue, so
   ordering is far more permissive. */
/* The ceiling is overridable so an end-to-end run, which drives the same
   flows from one address far faster than any person, is not throttled into
   false failures. Unset — i.e. in production — the published limit applies. */
const RL_WINDOW = 10 * 60 * 1000;
const RL_MAX = {
  comment: Number(process.env.RL_MAX_COMMENT) || 5,
  order: Number(process.env.RL_MAX_ORDER) || 12,
};
const hits = { comment: new Map(), order: new Map() };

const recentFor = (kind, ip) => {
  const now = Date.now();
  return (hits[kind].get(ip) || []).filter((t) => now - t < RL_WINDOW);
};

/** True when this IP has already used up the bucket. Does not consume it. */
function rateLimited(kind, ip) {
  return recentFor(kind, ip).length >= RL_MAX[kind];
}

/** Consume one slot. Call only for requests that actually did something. */
function recordHit(kind, ip) {
  hits[kind].set(ip, [...recentFor(kind, ip), Date.now()]);
}

/* Sweep expired entries — otherwise every IP that ever posted stays in memory
   for the lifetime of the process. */
setInterval(() => {
  const cut = Date.now() - RL_WINDOW;
  for (const map of Object.values(hits)) {
    for (const [ip, times] of map) {
      const keep = times.filter((t) => t > cut);
      if (keep.length) map.set(ip, keep);
      else map.delete(ip);
    }
  }
}, RL_WINDOW).unref();

/* Tell the client how long to wait instead of showing a generic failure. */
const tooMany = (res) => {
  res.setHeader('Retry-After', Math.ceil(RL_WINDOW / 1000));
  return res.status(429).json({ error: 'rate limited', retryAfter: Math.ceil(RL_WINDOW / 1000) });
};

export function createShopRouter({ database, requireAuth }) {
  /* Set by index.js once the account router exists. The two routers need
     each other — orders need the signed-in customer, accounts need the
     logged-and-capped SMS sender — so one of the two links is late-bound
     rather than making them a single 1200-line file. */
  let getCustomer = () => null;
  const r = express.Router();
  const D = database;

  const display = () => ({ ...DEFAULT_STATE.shop.display, ...(db.getSetting(D, 'shop.display') || {}) });
  const payment = () => normalizePayment(db.getSetting(D, 'shop.payment') || {});
  const smsCfg = () => normalizeSms(db.getSetting(D, 'shop.sms') || {});

  /* One place where an SMS is attempted, logged and capped.
     Deliberately not awaited by the order path: a message that takes four
     seconds to send must not add four seconds to checkout, and a provider
     outage must not turn a paid order into an error page. Every outcome,
     including a refusal by the cap, is written to sms_log. */
  function dispatchSms(msg) {
    const cfg = smsCfg();
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);

    const log = (row) => {
      try {
        db.insertSmsLog(D, row);
      } catch (e) {
        console.error('[sms] could not log:', e.message);
      }
    };

    if (cfg.dailyCap > 0 && db.countSmsSince(D, midnight.toISOString()) >= cfg.dailyCap) {
      log({ ...msg, provider: cfg.provider, environment: cfg.environment, ok: false, error: 'daily cap reached' });
      return Promise.resolve({ ok: false, error: 'daily cap reached' });
    }

    return sendSms(cfg, msg)
      .then((out) => {
        log({ ...out, phone: out.to, ref: msg.ref || '' });
        /* With no provider configured the message exists only in the
           database, which is no use to someone developing the signup flow
           and waiting for a code. Print it. */
        if (cfg.provider === 'log') console.log(`[sms:log] → ${out.to}\n${out.text}`);
        if (!out.ok) console.error('[sms] send failed:', out.error);
        return out;
      })
      .catch((e) => {
        /* sendSms is written not to throw; this is the belt to its braces. */
        log({ ...msg, provider: cfg.provider, environment: cfg.environment, ok: false, error: String(e?.message || e) });
        return { ok: false, error: String(e?.message || e) };
      });
  }

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
    if (rateLimited('comment', req.ip)) return tooMany(res);
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
    recordHit('comment', req.ip);
    res.json({ ok: true, id: item.id, pending: !item.approved });
  });

  r.post('/api/shop-public/orders', async (req, res) => {
    if (rateLimited('order', req.ip)) return tooMany(res);
    const { items, customer } = req.body || {};
    const d = display();
    if (!d.enabled) return res.status(403).json({ error: 'shop disabled' });
    if (!Array.isArray(items) || !items.length || items.length > 50)
      return res.status(400).json({ error: 'invalid items' });
    /* Ordering requires an account with a verified phone. That is the whole
       point of the phone being verified: the order confirmation, the
       tracking link and any delivery call all go to a number somebody has
       actually proved they hold. */
    const account = getCustomer(req);
    if (!account) return res.status(401).json({ error: 'برای ثبت سفارش وارد حساب خود شوید.' });

    const c = customer || {};
    /* A saved address is copied into the order as a snapshot. Pointing at
       the address row instead would mean that editing an address later
       silently rewrites where past orders were sent. */
    const saved = c.addressId ? db.getAddress(D, account.id, c.addressId) : null;
    if (c.addressId && !saved) return res.status(400).json({ error: 'نشانی انتخاب‌شده پیدا نشد.' });

    const src = saved
      ? { name: saved.receiver, phone: saved.phone, city: `${saved.province}، ${saved.city}`, address: formatAddress(saved), postal: saved.postal, note: c.note }
      : c;

    const name = String(src.name || '').trim();
    const phone = String(src.phone || '').trim();
    const city = String(src.city || '').trim();
    const address = String(src.address || '').trim();
    if (name.length < 3 || city.length < 2 || address.length < 10)
      return res.status(400).json({ error: 'customer fields required' });
    /* normalizePhone, not a regex: an Iranian visitor typing on a Persian
       keyboard produces ۰۹۱۲۳۴۵۶۷۸۹, which the old ASCII pattern rejected
       outright — a valid customer with a valid number was told their phone
       was invalid. It also folds +98 / 0098 / 0912 / 912 into one value, so
       the number the SMS goes to is the number the account system will key
       on later. Stored in the readable 09xxxxxxxxx form for the admin and
       the shipping label; canonical 98… is derived wherever it is compared. */
    const canonicalPhone = normalizePhone(phone);
    if (!canonicalPhone) return res.status(400).json({ error: 'invalid phone' });
    const localPhone = toLocalPhone(canonicalPhone);

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
      customerId: account.id,
      items: lines,
      customer: {
        name: name.slice(0, 200),
        phone: localPhone,
        city: city.slice(0, 100),
        address: address.slice(0, 600),
        postal: String(src.postal || '').slice(0, 20),
        note: String(src.note || c.note || '').slice(0, 1000),
        addressId: saved ? saved.id : null,
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
    recordHit('order', req.ip);

    /* After the commit, and not awaited: the order exists whatever the SMS
       does. The status link carries the order's private token, which is the
       only thing that makes the tracking page readable — so this message is
       the customer's key to their own order, and it is sent to the number
       they just proved they can be reached at. */
    const sms = smsCfg();
    if (sms.onOrder) {
      const url = orderStatusUrl(origin, order);
      dispatchSms({
        kind: 'order',
        /* the account's verified number, not whatever was typed into the
           delivery address — the latter may be a neighbour's */
        to: account.phone,
        ref: order.code,
        text: orderSmsText(order, url),
        templateId: sms.orderTemplateId || 0,
        params: [
          { name: 'CODE', value: order.code },
          { name: 'LINK', value: url },
        ],
      });
    }
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
        /* The unit differs by provider — ZarinPal is billed in rial, IDPay
           settles in toman — so the log says which, or the number is
           unreadable at 3am. */
        const unit = provider === 'idpay' ? 'toman' : 'rial';
        console.error(
          `[shop] REJECTED payment for ${order.code}: gateway settled ` +
            `${out.amountMismatch.paid} ${unit} but the order is ${out.amountMismatch.expected} ${unit}`,
        );
      }
      /* A repeat callback for an order already settled is normal — the
         customer pressed back, or the gateway retried. Worth a line, not an
         error. */
      if (out.alreadyVerified) console.log(`[shop] ${order.code}: gateway reports this payment was already verified`);
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
    if (Array.isArray(b.products)) {
      /* Validate the WHOLE list before touching the database. replaceProducts
         deletes every row and re-inserts, skipping any entry without a usable
         slug — so a single mistyped slug used to delete that product and still
         answer 200. Rejecting up front means a bad save changes nothing and
         the admin is told exactly which row is wrong.

         The duplicate check matters just as much: the slug is the primary key
         and the URL, so two rows sharing one makes the second unreachable.
         It also used to hit a UNIQUE constraint and surface as HTTP 500. */
      const problems = [];
      const seen = new Set();
      b.products.forEach((p, i) => {
        const slug = typeof p?.slug === 'string' ? p.slug.trim() : '';
        const where = `ردیف ${i + 1}`;
        if (!slug) problems.push(`${where}: شناسه (slug) خالی است`);
        else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
          problems.push(`${where}: شناسه «${slug}» باید فقط حروف کوچک انگلیسی، عدد و خط تیره باشد`);
        else if (seen.has(slug)) problems.push(`${where}: شناسه «${slug}» تکراری است`);
        else seen.add(slug);
      });
      if (problems.length) return res.status(400).json({ error: 'invalid products', problems });
      db.replaceProducts(D, b.products);
    }
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
      /* The invariant: an order holds its reserved stock for as long as it is
         not cancelled. Only the transition ACROSS that line may move stock, and
         it has to move in both directions.

         Restoring on cancel but never re-reserving on un-cancel let an admin
         mint inventory: cancel (stock back) then set the order live again and
         the units are counted as sellable while still owed to a real customer.
         Deleting that order then credited them a second time, because DELETE
         judges by the current status — so 10 units became 13. */
      const wasHolding = order.status !== 'cancelled';
      const willHold = b.status !== 'cancelled';

      if (wasHolding && !willHold) db.restoreStock(D, order.items);
      else if (!wasHolding && willHold) {
        /* Re-reserving can legitimately fail: the units may have been sold
           while the order sat cancelled. Refuse the change rather than let the
           catalogue go negative or oversell — the admin gets a clear 409. */
        const again = db.reserveStock(D, order.items);
        if (!again.ok)
          return res.status(409).json({
            error: 'insufficient stock',
            detail: 'موجودی برای بازگرداندن این سفارش کافی نیست؛ ابتدا موجودی محصول را افزایش دهید.',
          });
      }

      patch.status = b.status;
      if (b.status === 'paid' && !order.paidAt) patch.paidAt = new Date().toISOString();
    }
    if ('adminNote' in b) patch.adminNote = String(b.adminNote || '').slice(0, 1000);
    db.updateOrder(D, order.id, patch);
    res.json({ ok: true });
  });

  r.delete('/api/shop-admin/orders/:id', requireAuth, (req, res) => {
    /* Deleting an order that still holds stock has to release it, exactly as
       cancelling does. Without this, tidying up the order list quietly
       destroys sellable inventory: the units were deducted when the order was
       placed and nothing ever gives them back.

       Cancelled orders have already been credited, so they are skipped —
       otherwise deleting one would mint stock that never existed.

       This is only correct because PATCH keeps "not cancelled" and "holds
       stock" in lockstep. When un-cancelling did not re-reserve, the status
       lied: a resurrected order looked like it held stock it had already
       given back, and deleting it credited the same units twice. */
    const order = db.getOrderById(D, req.params.id);
    if (order && order.status !== 'cancelled') db.restoreStock(D, order.items);
    db.deleteOrder(D, req.params.id);
    res.json({ ok: true });
  });

  /* ---------------- SMS settings ---------------- */

  /* The API key is never sent back — only a mask and a boolean. An admin
     session is not a licence to read the credential out of the browser. */
  r.get('/api/shop-admin/sms', requireAuth, (_req, res) =>
    res.json({ sms: publicSmsSettings(smsCfg()), readiness: smsReadiness(smsCfg()), log: db.listSmsLog(D, 50) })
  );

  r.put('/api/shop-admin/sms', requireAuth, (req, res) => {
    /* merge, not replace: a form that posts the mask back must keep the
       stored key rather than wipe it */
    const next = mergeSmsSettings(smsCfg(), req.body || {});
    db.setSetting(D, 'shop.sms', next);
    res.json({ ok: true, sms: publicSmsSettings(next), readiness: smsReadiness(next) });
  });

  /* Prove the credentials work without placing a real order. */
  r.post('/api/shop-admin/sms/test', requireAuth, async (req, res) => {
    const to = String(req.body?.phone || '').trim();
    if (!normalizePhone(to)) return res.status(400).json({ error: 'invalid phone' });
    const out = await dispatchSms({
      kind: 'test',
      to,
      text: 'خمیرمایه خوزستان — پیامک آزمایشی. تنظیمات پنل درست است.',
    });
    res.json({ ok: !!out.ok, error: out.error || '', sent: out.ok });
  });

  /* Masked, like the SMS settings: the merchant id and the IDPay key stay
     on the server. They used to be returned in full to the admin tab. */
  r.get('/api/shop-admin/payment', requireAuth, (_req, res) => res.json(publicPayment(payment())));

  r.put('/api/shop-admin/payment', requireAuth, (req, res) => {
    /* merge, not replace: a form that posts the mask back keeps the stored
       credential instead of wiping it */
    const next = mergePayment(payment(), req.body || {});
    db.setSetting(D, 'shop.payment', next);
    res.json({ ok: true, payment: publicPayment(next) });
  });

  r.dispatchSms = dispatchSms;
  r.smsSettings = smsCfg;
  r.useCustomer = (fn) => {
    getCustomer = fn;
  };

  return r;
}
