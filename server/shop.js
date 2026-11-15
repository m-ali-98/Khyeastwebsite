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
import { CONTENT_REVISION_HEADER, parseContentRevision } from '../shared/contentRevision.js';
import {
  createPayment,
  verifyPayment,
  paymentAuthorityMatches,
  normalizePayment,
  publicPayment,
  mergePayment,
  inquirePayment,
  listUnverified,
  reversePayment,
  listTransactions,
  createRefund,
  listRefunds,
  refundStatus,
  calculateFee,
} from './payment.js';
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
  shipmentSmsText,
  shouldSendShipmentSms,
} from './sms.js';
import * as db from './db.js';
import { rateLimitResponse } from './rateLimits.js';
import { isRichTextValidationError } from './sanitize.js';
import {
  productImagesProblem,
  productImagesProblemMessage,
  productNeedsImageValidation,
} from '../shared/productImages.js';

/* ---------------------------------------------------------------------------
   Trusted origin for payment callback URLs.

   `req.get('host')` is whatever the client sent. An attacker can point the
   gateway's return URL at a host they control, which leaks the order token in
   the callback query string. So: prefer the admin-configured callbackBase,
   then PUBLIC_ORIGIN from the environment, and only fall back to the request
   host when it is in the allowlist (or when no allowlist is configured, which
   is the local-development case).
--------------------------------------------------------------------------- */
function safeOrigin(req, configuredBase) {
  if (configuredBase) return configuredBase;
  /* index.js loads the optional .env after ESM imports are evaluated, so read
     these values at request time rather than freezing empty module constants. */
  const publicOrigin = String(process.env.PUBLIC_ORIGIN || '').trim().replace(/\/+$/, '');
  if (publicOrigin) return publicOrigin;
  const trustedHosts = String(process.env.TRUSTED_HOSTS || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const host = String(req.get('host') || '').toLowerCase();
  if (trustedHosts.length && !trustedHosts.includes(host)) return '';
  if (!/^[a-z0-9.\-]+(:\d+)?$/.test(host)) return '';
  return `${req.protocol}://${host}`;
}

export { SHOP_SEED } from './seed.js';

const ORDER_STATUS = ['pending_payment', 'paid', 'shipped', 'delivered', 'cancelled'];
const rand = (n) => crypto.randomBytes(n).toString('hex');
const PUBLIC_COMMENT_PAGE_SIZE = 8;
const PUBLIC_COMMENT_PAGE_MAX = 20;

/**
 * A tracking token authorizes only the customer-facing order view. Build that
 * view from explicit root and nested allowlists so adding a future internal
 * database field cannot silently publish it to every token holder.
 */
export const publicTrackingOrder = (order = {}) => ({
  code: order.code,
  items: Array.isArray(order.items)
    ? order.items.map((item) => ({
        slug: item?.slug,
        title: item?.title,
        unit: item?.unit,
        price: item?.price,
        qty: item?.qty,
        sum: item?.sum,
      }))
    : [],
  customer: {
    name: order.customer?.name,
    phone: order.customer?.phone,
    city: order.customer?.city,
    address: order.customer?.address,
    postal: order.customer?.postal,
    note: order.customer?.note,
  },
  subtotal: order.subtotal,
  shipping: order.shipping,
  total: order.total,
  currency: order.currency,
  status: order.status,
  at: order.at,
});

const encodeCommentCursor = (comment) => Buffer.from(
  JSON.stringify([comment.at, comment.id]),
  'utf8',
).toString('base64url');

const decodeCommentCursor = (raw) => {
  const value = String(raw || '');
  if (!value) return null;
  if (value.length > 500) throw new Error('invalid cursor');
  const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  if (
    !Array.isArray(parsed) || parsed.length !== 2 ||
    typeof parsed[0] !== 'string' || parsed[0].length > 40 || Number.isNaN(Date.parse(parsed[0])) ||
    typeof parsed[1] !== 'string' || !parsed[1] || parsed[1].length > 160
  ) throw new Error('invalid cursor');
  return { at: parsed[0], id: parsed[1] };
};

export const PAYMENT_VERIFICATION_AUTO_RETRY_LIMIT = 6;
const PAYMENT_VERIFICATION_RETRY_PARAM = '_kyVerifyRetry';
const htmlAttribute = (value) => String(value || '')
  .replaceAll('&', '&amp;')
  .replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

/** Preserve the order code, authority and gateway status while carrying one
 * private retry counter. Returning only path + search prevents a hostile Host
 * or absolute-looking input from becoming an off-site refresh destination. */
export function paymentVerificationRetryPlan(originalUrl = '/') {
  const parsed = new URL(String(originalUrl || '/'), 'http://internal.invalid');
  const supplied = Number.parseInt(parsed.searchParams.get(PAYMENT_VERIFICATION_RETRY_PARAM) || '0', 10);
  const attempt = Number.isSafeInteger(supplied) && supplied >= 0 ? supplied : 0;
  parsed.searchParams.delete(PAYMENT_VERIFICATION_RETRY_PARAM);
  const manualUrl = `${parsed.pathname}${parsed.search}`;
  if (attempt >= PAYMENT_VERIFICATION_AUTO_RETRY_LIMIT) {
    return { attempt, autoUrl: '', manualUrl };
  }
  parsed.searchParams.set(PAYMENT_VERIFICATION_RETRY_PARAM, String(attempt + 1));
  return { attempt, autoUrl: `${parsed.pathname}${parsed.search}`, manualUrl };
}

/** An upstream verification timeout is ambiguous: the customer may already be
 * charged. Release callback capacity and retry the same authority a bounded
 * number of times; never call a timeout a failed payment or refresh forever. */
export function retryablePaymentVerificationResponse(res, {
  releaseReservation = () => {},
  error = null,
  logger = console,
  retryPlan = { attempt: PAYMENT_VERIFICATION_AUTO_RETRY_LIMIT, autoUrl: '', manualUrl: '/shop/account' },
} = {}) {
  releaseReservation();
  logger.error?.('[shop] verify error:', error?.message || error || 'gateway transport failed');
  const autoRetry = Boolean(retryPlan.autoUrl) && retryPlan.attempt < PAYMENT_VERIFICATION_AUTO_RETRY_LIMIT;
  if (autoRetry) res.setHeader('Retry-After', '5');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const refresh = autoRetry
    ? `<meta http-equiv="refresh" content="5;url=${htmlAttribute(retryPlan.autoUrl)}">`
    : '';
  const detail = autoRetry
    ? `<p>تلاش خودکار ${retryPlan.attempt + 1} از ${PAYMENT_VERIFICATION_AUTO_RETRY_LIMIT} تا پنج ثانیه دیگر انجام می‌شود.</p>`
    : `<p>بررسی خودکار پس از ${PAYMENT_VERIFICATION_AUTO_RETRY_LIMIT} تلاش متوقف شد. اتصال یا وضعیت سفارش را بررسی کنید و سپس فقط نتیجه همین پرداخت را دوباره بررسی کنید.</p>`;
  return res.status(503).type('html').send(`<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refresh}<title>در حال بررسی پرداخت</title></head>
<body><main><h1>در حال بررسی نتیجه پرداخت</h1><p>ارتباط با درگاه موقتاً کامل نشد.</p>${detail}<p><strong>لطفاً دوباره پرداخت نکنید.</strong></p><p><a href="${htmlAttribute(retryPlan.manualUrl)}">بررسی دوباره همین پرداخت</a> · <a href="/shop/account">مشاهده سفارش‌ها</a></p></main></body></html>`);
}
const orderCode = () => `KY-${Date.now().toString(36).slice(-5).toUpperCase()}${rand(2).toUpperCase()}`;

/* Thirty minutes is long enough to complete an ordinary gateway round trip
   and short enough that abandoned baskets cannot hold scarce inventory all
   day. The environment hooks make the sweeper testable without a 30-minute
   sleep; production defaults remain fixed and safe. */
/* Hashing both sides first gives timingSafeEqual equal-length buffers even for
   a malformed candidate. The order token is secret, so ordinary === is an
   avoidable timing oracle on both retry and tracking endpoints. */
const secretEqual = (candidate, expected) => {
  const digest = (value) => crypto.createHash('sha256').update(String(value ?? '')).digest();
  return crypto.timingSafeEqual(digest(candidate), digest(expected));
};

export const shopProductProblems = (products) => {
  const problems = [];
  const seen = new Set();
  (Array.isArray(products) ? products : []).forEach((product, index) => {
    const slug = typeof product?.slug === 'string' ? product.slug.trim() : '';
    const where = `ردیف ${index + 1}`;
    if (!slug) problems.push(`${where}: شناسه (slug) خالی است`);
    else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
      problems.push(`${where}: شناسه «${slug}» باید فقط حروف کوچک انگلیسی، عدد و خط تیره باشد`);
    else if (seen.has(slug)) problems.push(`${where}: شناسه «${slug}» تکراری است`);
    else seen.add(slug);

    const price = Number(product?.price);
    if (product?.active !== false && (!Number.isSafeInteger(price) || price <= 0))
      problems.push(`${where}: محصول فعال باید قیمت صحیح بیشتر از صفر داشته باشد`);
    const stock = Number(product?.stock);
    if (product?.stock !== undefined && (!Number.isSafeInteger(stock) || stock < -1))
      problems.push(`${where}: موجودی باید ۱- (نامحدود) یا عددی نامنفی باشد`);
  });
  return problems;
};

export function createShopRouter({
  database,
  requireAuth,
  rateLimiter,
  trustedImageOrigins = () => [],
  contentMutation = (operation) => Promise.resolve().then(operation),
  assertContentAvailable = () => {},
  paymentVerifier = verifyPayment,
}) {
  /* Set by index.js once the account router exists. The two routers need
     each other — orders need the signed-in customer, accounts need the
     logged-and-capped SMS sender — so one of the two links is late-bound
     rather than making them a single 1200-line file. */
  let getCustomer = () => null;
  const r = express.Router();
  const D = database;
  /* Like the origin settings above, evaluate after index.js has loaded .env. */
  const pendingOrderTtlMs = Math.max(60_000, Number(process.env.PENDING_ORDER_TTL_MS) || 30 * 60 * 1000);
  const orderSweepIntervalMs = Math.max(30_000, Number(process.env.ORDER_SWEEP_INTERVAL_MS) || 60 * 1000);

  const display = () => ({ ...DEFAULT_STATE.shop.display, ...(db.getSetting(D, 'shop.display') || {}) });
  const payment = () => normalizePayment(db.getSetting(D, 'shop.payment') || {});
  const smsCfg = () => normalizeSms(db.getSetting(D, 'shop.sms') || {});
  /* Receiver numbers belong on the shipping label, but only the account phone
     has passed OTP ownership verification. Notifications therefore resolve
     the account at send time and fail closed when no verified account exists. */
  const verifiedCustomerPhone = (order) => (
    order?.customerId ? db.getCustomerById(D, order.customerId)?.phone || '' : ''
  );

  /* Query by order, never by the attacker-supplied authority, then compare
     every mapped attempt with fixed-length digests. This keeps hit/miss work
     independent of which authority was supplied while the table primary key
     enforces global one-authority/one-order ownership. */
  const mappedPaymentAttempt = (orderId, candidate) => {
    const attempts = db.listOrderPaymentAttempts(D, orderId);
    let matched = null;
    for (const attempt of attempts) {
      if (paymentAuthorityMatches(candidate, attempt.authority)) matched = attempt;
    }
    if (!attempts.length) paymentAuthorityMatches(candidate, '');
    return matched;
  };

  const limited = (kind, key, res) => {
    const check = rateLimiter.check(kind, key);
    return check.limited ? rateLimitResponse(res, check.retryAfter) : null;
  };

  const sweepExpiredOrders = () => {
    const cutoff = new Date(Date.now() - pendingOrderTtlMs).toISOString();
    try {
      const expired = db.expirePendingOrders(D, cutoff);
      if (expired.length) console.log(`[shop] expired ${expired.length} unpaid order(s): ${expired.map((order) => order.code).join(', ')}`);
      return expired;
    } catch (error) {
      console.error('[shop] unpaid-order sweep failed:', error.message);
      return [];
    }
  };

  /* Run once on boot for orders left behind while the process was down, then
     often enough that the practical hold is about thirty minutes rather than
     thirty minutes plus a deployment cycle. */
  sweepExpiredOrders();
  setInterval(sweepExpiredOrders, orderSweepIntervalMs).unref?.();

  /* One place where an SMS is attempted, logged and capped.
     Deliberately not awaited by customer and payment paths: a message that
     takes four seconds to send must not delay checkout or the gateway return,
     and a provider outage must not turn a paid order into an error page. Every outcome,
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

  /** Send the «order registered» message only after this request has confirmed
   * payment: either an atomic gateway settlement or the first Admin-confirmed
   * `paidAt` on an offline order. Creation and idempotent saves stay silent. */
  function dispatchPaidOrderSms(order, req) {
    const sms = smsCfg();
    if (!sms.onOrder || !order?.paidAt || !['paid', 'shipped', 'delivered'].includes(order.status)) return;
    const url = orderStatusUrl(safeOrigin(req, payment().callbackBase), order);
    dispatchSms({
      kind: 'order',
      /* The delivery recipient may be a neighbour, so the address snapshot
         must never choose who receives a private tracking token. */
      to: verifiedCustomerPhone(order),
      ref: order.code,
      text: orderSmsText(order, url),
      templateId: sms.orderTemplateId || 0,
      params: [
        { name: 'CODE', value: order.code },
        { name: 'LINK', value: url },
      ],
    });
  }

  /** A second authority for an already-paid/cancelled order represents a real
   * extra charge, not an idempotent callback. Reverse that exact authority and
   * leave a durable Admin alert when the gateway cannot do so automatically. */
  async function reverseUnusablePayment(order, authority, refId, reason) {
    const attempt = db.getOrderPaymentAttempt(D, order.id, authority);
    if (!attempt) return { ok: false, error: 'payment attempt is not mapped' };
    if (attempt.status === 'reversed') return { ok: true, alreadyReversed: true };

    /* Only one process may call the external reversal endpoint. A duplicate
       callback sees `reversing` and waits for that owner instead of issuing a
       second money-moving request. */
    const claim = db.claimOrderPaymentReversal(D, order.id, authority, {
      refId: refId || attempt.refId,
      verifiedAt: attempt.verifiedAt || new Date().toISOString(),
    });
    if (!claim.claimed) {
      if (claim.attempt?.status === 'reversed') return { ok: true, alreadyReversed: true };
      if (claim.attempt?.status === 'reversing') {
        const started = new Date(claim.attempt.reversalStartedAt || 0).getTime();
        const retryAfter = Number.isFinite(started)
          ? Math.max(1, Math.ceil((started + db.PAYMENT_REVERSAL_CLAIM_TTL_MS - Date.now()) / 1000))
          : Math.ceil(db.PAYMENT_REVERSAL_CLAIM_TTL_MS / 1000);
        return { ok: false, pending: true, retryAfter, error: 'reversal in progress' };
      }
      db.appendOrderAdminNote(
        D,
        order.id,
        `${reason} وضعیت تلاش پرداخت ${authority} با reverse خودکار سازگار نیست؛ پیگیری لازم است.`,
        { needsAttention: true },
      );
      return { ok: false, error: 'payment attempt cannot be reversed automatically' };
    }

    /* If the worker dies during the gateway call, this pre-call marker keeps
       the order visible to Admin instead of leaving an invisible extra charge. */
    db.appendOrderAdminNote(
      D,
      order.id,
      `${reason} ${claim.reclaimed ? 'ادامه' : 'آغاز'} بازگرداندن خودکار تلاش پرداخت ${authority}.`,
      { needsAttention: true },
    );

    const claimedAt = claim.attempt?.reversalStartedAt;
    const reversed = await reversePayment(payment(), authority);
    if (reversed.ok) {
      /* Success is terminal financial evidence. It may safely finish after a
         lease was reclaimed, while the failed stale owner below is fenced by
         its exact claimedAt token and cannot overwrite this result. */
      const finished = db.finishOrderPaymentReversal(D, order.id, authority, {
        claimedAt,
        ok: true,
        reversedAt: new Date().toISOString(),
      });
      if (!finished.finished && finished.attempt?.status !== 'reversed') {
        db.appendOrderAdminNote(
          D,
          order.id,
          `${reason} درگاه موفقیت reverse تلاش ${authority} را اعلام کرد اما وضعیت ledger تغییر نکرد؛ بررسی فوری لازم است.`,
          { needsAttention: true },
        );
        return { ok: false, error: 'reversal succeeded but ledger completion was refused', code: 'ledger-conflict' };
      }
      if (finished.finished) {
        db.appendOrderAdminNote(
          D,
          order.id,
          `${reason} وجهِ تلاش پرداخت اضافه با شناسه ${authority} خودکار بازگردانده شد.`,
        );
      }
      db.clearOrderPaymentAttentionIfResolved(D, order.id);
      return {
        ok: true,
        reversed: true,
        alreadyReversed: !finished.finished,
        reclaimed: claim.reclaimed,
      };
    }

    const error = String(reversed.message || reversed.error || `gateway code ${reversed.code ?? 'unknown'}`);
    const finished = db.finishOrderPaymentReversal(D, order.id, authority, {
      claimedAt,
      ok: false,
      lastError: error,
    });
    if (!finished.finished) {
      /* This request outlived its lease. Its failure says nothing about the
         replacement worker and must not turn that worker's success into a
         false reversal_failed alert. */
      if (finished.attempt?.status === 'reversed') {
        db.clearOrderPaymentAttentionIfResolved(D, order.id);
        return { ok: true, reversed: true, alreadyReversed: true, reclaimed: claim.reclaimed };
      }
      if (finished.attempt?.status === 'reversing') {
        const started = new Date(finished.attempt.reversalStartedAt || 0).getTime();
        const retryAfter = Number.isFinite(started)
          ? Math.max(1, Math.ceil((started + db.PAYMENT_REVERSAL_CLAIM_TTL_MS - Date.now()) / 1000))
          : Math.ceil(db.PAYMENT_REVERSAL_CLAIM_TTL_MS / 1000);
        return { ok: false, pending: true, retryAfter, error: 'reversal lease was superseded' };
      }
      return {
        ok: false,
        error: finished.attempt?.lastError || error,
        code: reversed.code,
        superseded: true,
      };
    }
    db.appendOrderAdminNote(
      D,
      order.id,
      `${reason} بازگرداندن تلاش پرداخت ${authority} ناموفق بود؛ پیگیری فوری لازم است.`,
      { needsAttention: true },
    );
    return { ok: false, error, code: reversed.code };
  }

  /* ---------------- public ---------------- */
  /* Backward-compatible lightweight bootstrap. Product comments and payment
     metadata have route-local endpoints below and are no longer shipped at
     application boot. */
  r.get('/api/shop-public', (_req, res) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.json({ display: display() });
  });

  r.get('/api/shop-public/payment', (_req, res) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.json({ paymentProvider: payment().provider });
  });

  r.get('/api/shop-public/comments', (req, res) => {
    const slug = String(req.query.slug || '').trim();
    if (!slug || slug.length > 120) return res.status(400).json({ error: 'valid slug required' });
    const product = db.getProduct(D, slug);
    if (!product || !product.active) return res.status(404).json({ error: 'product not found' });

    const suppliedLimit = req.query.limit;
    const parsedLimit = suppliedLimit == null || suppliedLimit === ''
      ? PUBLIC_COMMENT_PAGE_SIZE
      : Number(suppliedLimit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
      return res.status(400).json({ error: 'invalid limit' });
    }
    const limit = Math.min(parsedLimit, PUBLIC_COMMENT_PAGE_MAX);

    let cursor;
    try {
      cursor = decodeCommentCursor(req.query.cursor);
    } catch {
      return res.status(400).json({ error: 'invalid cursor', code: 'invalid-cursor' });
    }

    const rows = db.listApprovedCommentsPage(D, slug, { limit: limit + 1, cursor });
    const comments = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    return res.json({
      comments,
      hasMore,
      nextCursor: hasMore && comments.length ? encodeCommentCursor(comments.at(-1)) : null,
      limit,
    });
  });

  /** Public product catalogue (shop products live in the DB now). Inventory is
   * re-read immediately before checkout, so neither a browser nor a proxy may
   * reuse an older stock snapshot. */
  r.get('/api/shop-products', (_req, res) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.json({ products: db.listProducts(D).filter((p) => p.active) });
  });

  r.post('/api/shop-public/comments', (req, res) => {
    const blocked = limited('comment', req.ip, res);
    if (blocked) return blocked;
    const { slug, name, text } = req.body || {};
    if (!slug || !name || !text) return res.status(400).json({ error: 'fields required' });
    const product = db.getProduct(D, slug);
    if (!product || !product.active) return res.status(404).json({ error: 'product not found' });
    const d = display();
    if (!d.commentsEnabled || product.commentsLocked) return res.status(403).json({ error: 'comments closed' });
    const attempt = rateLimiter.reserve('comment', req.ip);
    if (attempt.limited) return rateLimitResponse(res, attempt.retryAfter);
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
    try {
      db.insertComment(D, item);
      attempt.finish(true);
    } catch (error) {
      attempt.finish(false);
      throw error;
    }
    res.json({ ok: true, id: item.id, pending: !item.approved });
  });

  r.post('/api/shop-public/orders', async (req, res) => {
    const blocked = limited('order', req.ip, res);
    if (blocked) return blocked;
    const { items, customer } = req.body || {};
    const d = display();
    if (!d.enabled) return res.status(403).json({ error: 'shop disabled' });
    if (!Array.isArray(items) || !items.length || items.length > 50)
      return res.status(400).json({ error: 'invalid items' });
    /* Ordering requires an account with a verified phone. Private order and
       shipment notifications go to that account identity. The delivery
       snapshot below may name a different receiver phone for the courier, but
       that typed contact is never treated as proof of ownership. */
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

    /* Canonicalise the cart BEFORE looking at stock. A hostile client can send
       the same slug in several lines even though the normal UI stores one map
       entry per product. Checking five + five separately against stock five
       approved both lines; reserveStock then deducted ten. */
    const quantities = new Map();
    for (const item of items) {
      const slug = String(item?.slug || '').trim();
      if (!slug) return res.status(400).json({ error: 'invalid product' });
      const qty = item?.qty === undefined ? 1 : item.qty;
      /* JSON numbers only. Number(...) made [1], true and "3" indistinguishable
         from a real numeric quantity before validation. */
      if (typeof qty !== 'number' || !Number.isSafeInteger(qty) || qty <= 0)
        return res.status(400).json({ error: 'invalid quantity' });
      const totalQty = (quantities.get(slug) || 0) + qty;
      if (!Number.isSafeInteger(totalQty) || totalQty > 999)
        return res.status(400).json({ error: 'invalid quantity' });
      quantities.set(slug, totalQty);
    }

    /* Price is strictly server-side and every sellable line must cost at least
       one rial. This prevents a stale/mistyped zero-price product from reaching
       either an offline order or a payment gateway with total zero. */
    const lines = [];
    let subtotal = 0;
    for (const [slug, qty] of quantities) {
      const product = db.getProduct(D, slug);
      if (!product || !product.active) return res.status(400).json({ error: `unknown product: ${slug}` });
      if (Number(product.stock) >= 0 && qty > Number(product.stock))
        return res.status(409).json({ error: 'insufficient stock' });
      const price = Math.round(Number(product.price));
      if (!Number.isSafeInteger(price) || price <= 0)
        return res.status(409).json({ error: 'product is not available for purchase' });
      const sum = price * qty;
      if (!Number.isSafeInteger(sum)) return res.status(400).json({ error: 'invalid order total' });
      lines.push({ slug: product.slug, title: product.title, unit: product.unit || '', price, qty, sum });
      subtotal += sum;
    }
    const freeOver = Number(d.freeShippingOver) || 0;
    const shipping = freeOver > 0 && subtotal >= freeOver ? 0 : Math.max(0, Math.round(Number(d.shippingCost) || 0));
    const total = subtotal + shipping;
    if (!Number.isSafeInteger(total) || subtotal <= 0 || total <= 0)
      return res.status(400).json({ error: 'invalid order total' });

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
      payAuthority: null,
      payRef: null,
      adminNote: '',
      at: new Date().toISOString(),
      paidAt: null,
      autoCancelled: false,
    };

    /* Hold one shared limiter slot while stock and the sweepable order are
       committed. This final reservation closes the race after the cheap early
       check without charging malformed carts or failed stock reservations. */
    const orderAttempt = rateLimiter.reserve('order', req.ip);
    if (orderAttempt.limited) return rateLimitResponse(res, orderAttempt.retryAfter);
    let placed;
    try {
      placed = db.reserveAndInsertOrder(D, order);
      orderAttempt.finish(placed.ok);
    } catch (error) {
      orderAttempt.finish(false);
      throw error;
    }
    if (!placed.ok) {
      const status = placed.error === 'insufficient stock' ? 409 : 400;
      return res.status(status).json({ error: placed.error });
    }

    /* payment */
    const pm = payment();
    const origin = safeOrigin(req, pm.callbackBase);
    let pay = { provider: 'offline', authority: null, payUrl: null };
    if (pm.provider !== 'offline') {
      try {
        pay = await createPayment(pm, order, { origin });
      } catch (e) {
        console.error('[shop] gateway error:', e.message);
        pay = { provider: 'offline', authority: null, payUrl: null, gatewayError: true };
      }
    }
    /* Persist every issued authority before its redirect URL reaches the
       browser. recordOrderPaymentAttempt keeps old attempts in the ledger and
       moves only the pending order's current pointer, so a retry can never
       orphan an earlier callback. */
    if (pay.authority) {
      try {
        const recorded = db.recordOrderPaymentAttempt(D, order.id, {
          provider: pay.provider,
          authority: pay.authority,
        });
        if (!recorded.current) pay = { ...pay, payUrl: null, gatewayError: true };
      } catch (error) {
        console.error('[shop] refused duplicate payment authority:', error.message);
        const latest = db.getOrderById(D, order.id);
        if (latest?.status === 'pending_payment') db.updateOrder(D, order.id, { provider: 'offline' });
        pay = { provider: 'offline', authority: null, payUrl: null, gatewayError: true };
      }
    } else {
      db.updateOrder(D, order.id, { provider: pay.provider });
    }

    const afterGateway = db.getOrderById(D, order.id);
    if (afterGateway) {
      order.status = afterGateway.status;
      order.provider = afterGateway.provider;
      order.payAuthority = afterGateway.payAuthority;
      order.payRef = afterGateway.payRef;
    }

    /* Creating an unpaid order is intentionally silent. The «order registered»
       SMS is dispatched only after the gateway has verified the payment and
       the order has atomically reached `paid`; see the callback paths below. */
    res.json({
      ok: true,
      order: { code: order.code, token: order.token, total: order.total, status: order.status, provider: order.provider },
      payment: { provider: pay.provider, payUrl: pay.payUrl || null, gatewayError: !!pay.gatewayError },
    });
  });

  /* Retry payment for a pending order. Both the address and the order get a
     bucket: rotating order codes must not multiply gateway calls, while one
     leaked token must not be hammered from a botnet without a per-order cap. */
  r.post('/api/shop-public/orders/:code/pay', async (req, res) => {
    sweepExpiredOrders();
    const ipKey = `ip:${req.ip || 'unknown'}`;
    const orderKey = `order:${String(req.params.code || '')}`;
    const ipLimit = rateLimiter.check('paymentRetry', ipKey);
    const orderLimit = rateLimiter.check('paymentRetry', orderKey);
    if (ipLimit.limited || orderLimit.limited)
      return rateLimitResponse(res, Math.max(ipLimit.retryAfter, orderLimit.retryAfter));

    /* Reserve the IP bucket before looking up the private token. Invalid probes
       are counted too, and concurrent Passenger workers cannot each admit a
       full batch between a separate check and record. */
    const ipAttempt = rateLimiter.reserve('paymentRetry', ipKey);
    if (ipAttempt.limited) return rateLimitResponse(res, ipAttempt.retryAfter);
    let order;
    try {
      order = db.getOrderByCode(D, req.params.code);
    } catch (error) {
      ipAttempt.finish(false);
      throw error;
    }
    if (!order) {
      ipAttempt.finish(true);
      return res.status(404).json({ error: 'not found' });
    }
    if (!secretEqual(req.body?.token, order.token)) {
      ipAttempt.finish(true);
      return res.status(403).json({ error: 'invalid token' });
    }
    if (order.status !== 'pending_payment') {
      ipAttempt.finish(false);
      return res.status(409).json({ error: 'order already processed' });
    }
    const pm = payment();
    if (pm.provider === 'offline') {
      ipAttempt.finish(false);
      return res.status(409).json({ error: 'online payment disabled' });
    }
    let orderAttempt;
    try {
      orderAttempt = rateLimiter.reserve('paymentRetry', orderKey);
    } catch (error) {
      ipAttempt.finish(false);
      throw error;
    }
    if (orderAttempt.limited) {
      ipAttempt.finish(false);
      return rateLimitResponse(res, orderAttempt.retryAfter);
    }
    ipAttempt.finish(true);
    orderAttempt.finish(true);
    const origin = safeOrigin(req, pm.callbackBase);
    try {
      const pay = await createPayment(pm, order, { origin });
      if (!pay.authority || !pay.payUrl) return res.status(502).json({ error: 'gateway unavailable' });
      const recorded = db.recordOrderPaymentAttempt(D, order.id, {
        provider: pay.provider,
        authority: pay.authority,
      });
      if (!recorded.current) return res.status(409).json({ error: 'order already processed' });
      res.json({ ok: true, payment: { provider: pay.provider, payUrl: pay.payUrl } });
    } catch (error) {
      console.error('[shop] payment retry failed:', error.message);
      res.status(502).json({ error: 'gateway error' });
    }
  });

  /* Order tracking (needs the private order token). Use the same constant-time
     comparison as payment retry so this second token gate is not weaker. */
  r.get('/api/shop-public/orders/:code', (req, res) => {
    sweepExpiredOrders();
    const order = db.getOrderByCode(D, req.params.code);
    if (!order || !secretEqual(req.query.token, order.token)) return res.status(404).json({ error: 'not found' });
    res.json({ order: publicTrackingOrder(order) });
  });

  /* ---------------- gateway callbacks ---------------- */
  r.get('/api/shop-pay/:provider/callback', async (req, res) => {
    /* ZarinPal is the only gateway; an unknown provider in the path is not
       a route we should be running verification for. */
    if (req.params.provider !== 'zarinpal') return res.redirect(302, '/shop');
    const provider = req.params.provider;
    if (provider !== 'zarinpal') return res.status(404).send('unknown gateway');
    const code = provider === 'zarinpal' ? String(req.query.code || '') : String(req.query.order_id || '');
    const order = db.getOrderByCode(D, code);
    if (!order) return res.status(404).send('unknown order');
    const callbackAuthority = String(req.query.Authority || req.query.authority || '');
    /* Equal totals do not bind a payment to an order. Ownership comes from the
       database-enforced attempt ledger; the explicit digest comparison stays
       constant-time even for malformed callback lengths. */
    const attempt = mappedPaymentAttempt(order.id, callbackAuthority);
    if (!attempt) {
      console.warn(`[shop] rejected payment authority mismatch for ${order.code}`);
      return res.redirect(`/shop/order/${encodeURIComponent(order.code)}?pay=fail`);
    }

    /* Refreshing the browser after this exact attempt already settled is a
       local idempotent read: no gateway call and no limiter budget are needed.
       This keeps a paid customer on the success page even after many refreshes. */
    if (
      attempt.status === 'settled' &&
      ['paid', 'shipped', 'delivered'].includes(order.status) &&
      paymentAuthorityMatches(callbackAuthority, order.payAuthority)
    ) {
      return res.redirect(`/shop/order/${encodeURIComponent(order.code)}?pay=ok`);
    }
    if (attempt.status === 'reversed') {
      return res.redirect(`/shop/order/${encodeURIComponent(order.code)}?pay=fail`);
    }

    /* Do not let a callback URL become an unbounded gateway-verification
       proxy. Scope the bucket to the successfully mapped immutable authority:
       random probes cannot consume a real payment's allowance, while normal
       browser/gateway retries retain a bounded dedicated budget. reserve() is
       SQLite-backed, so this count is atomic across Passenger workers. */
    const callbackLimitKey = `${order.id}:${attempt.authority}`;
    const callbackLimit = rateLimiter.reserve('paymentCallback', callbackLimitKey);
    if (callbackLimit.limited) {
      return rateLimitResponse(res, callbackLimit.retryAfter, 'payment callback rate limited');
    }

    let ok = false;
    let paidNow = false;
    let refId = '';
    let paymentNote = '';
    try {
      const out = await paymentVerifier(payment(), provider, req.query, order.total, attempt.authority);
      /* Only a completed gateway response consumes callback budget. A network
         timeout is infrastructure failure, not another customer attempt; its
         reservation is released below so the same authority can retry. */
      callbackLimit.finish(true);
      ok = out.ok;
      refId = out.refId;
      if (out.amountMismatch) {
        console.error(
          `[shop] REJECTED payment for ${order.code}: gateway settled ` +
            `${out.amountMismatch.paid} rial but the order is ${out.amountMismatch.expected} rial`,
        );
      }
      /* A repeat callback for an order already settled is normal — the
         customer pressed back, or the gateway retried. It is accepted only
         because the authority above is still bound to this same order. */
      if (out.alreadyVerified) console.log(`[shop] ${order.code}: gateway reports this payment was already verified`);
      /* The masked card and the fee only exist on this one response. The
         customer quotes the card when they ring about a payment and the
         fee is what reconciliation needs, so they are written onto the
         order rather than left in a log line that rotates away. */
      if (out.ok && (out.cardPan || out.fee)) {
        paymentNote = [
          out.cardPan ? `کارت: ${out.cardPan}` : '',
          out.fee ? `کارمزد درگاه: ${Number(out.fee).toLocaleString('en-US')} ریال${out.feeType === 'Payer' ? ' (پرداخت‌کننده: مشتری)' : ''}` : '',
        ]
          .filter(Boolean)
          .join(' · ');
      }
    } catch (e) {
      /* Do not tell a possibly charged customer that payment failed merely
         because our gateway verification transport timed out. Nginx may
         replace this retryable 503 with the branded static equivalent during
         a process cutover. */
      return retryablePaymentVerificationResponse(res, {
        releaseReservation: () => callbackLimit.finish(false),
        error: e,
        retryPlan: paymentVerificationRetryPlan(req.originalUrl),
      });
    }
    if (ok) {
      /* Verification awaited the gateway, so expiry, a retry, or another
         callback may have changed the order. The authority-to-order mapping is
         immutable; conditional writes decide which verified attempt settles. */
      let current = db.getOrderById(D, order.id);
      const currentAttempt = mappedPaymentAttempt(order.id, callbackAuthority);
      if (!current || !currentAttempt) {
        ok = false;
      } else {
        let resolved = false;
        /* At most two state transitions are expected (pending → expired or
           pending → paid); a third pass is a conservative race retry without
           turning the callback into an unbounded loop. */
        for (let pass = 0; pass < 3 && !resolved; pass += 1) {
          if (!current) {
            ok = false;
            resolved = true;
            break;
          }

          if (current.status === 'pending_payment') {
            const settled = db.settlePendingOrder(D, order.id, callbackAuthority, {
              provider,
              payRef: refId || current.payRef,
              paidAt: new Date().toISOString(),
              adminNote: [current.adminNote, paymentNote].filter(Boolean).join('\n'),
            });
            if (settled) {
              ok = true;
              paidNow = true;
              resolved = true;
              break;
            }
            current = db.getOrderById(D, order.id);
            continue;
          }

          if (['paid', 'shipped', 'delivered'].includes(current.status)) {
            if (paymentAuthorityMatches(callbackAuthority, current.payAuthority)) {
              /* Same settled attempt: an ordinary idempotent callback. */
              ok = true;
            } else {
              /* A different retry won settlement. This authority is a second
                 real charge and must be reversed using the authority itself. */
              await reverseUnusablePayment(
                current,
                callbackAuthority,
                refId,
                'هشدار: سفارش پیش‌تر با تلاش پرداخت دیگری تسویه شده است.',
              );
              ok = false;
            }
            resolved = true;
            break;
          }

          if (current.status === 'cancelled' && current.autoCancelled) {
            /* The customer completed payment on the expiry boundary. Claim the
               callback and re-reserve in one database transaction so duplicate
               workers cannot deduct the same units twice. */
            const lateSuccess = [
              current.adminNote,
              'پرداخت پس از انقضا تأیید و موجودی دوباره رزرو شد.',
              paymentNote,
            ].filter(Boolean).join('\n');
            const lateFailure = [
              current.adminNote,
              'هشدار فوری: پرداخت پس از انقضا تأیید شد اما موجودی کافی نبود؛ بازگرداندن خودکار وجه در حال انجام است.',
              paymentNote,
            ].filter(Boolean).join('\n');
            const claimed = db.claimExpiredPayment(D, current.id, {
              provider,
              authority: callbackAuthority,
              payRef: refId || current.payRef,
              paidAt: new Date().toISOString(),
              successNote: lateSuccess,
              failureNote: lateFailure,
            });

            if (!claimed.ok) {
              /* Another worker may have completed the state transition. If it
                 still holds the transient claim, it alone owns refund work. */
              current = db.getOrderById(D, current.id);
              if (current?.status === 'cancelled' && current.autoCancelled) {
                ok = false;
                resolved = true;
              }
              continue;
            }

            if (claimed.reserved) {
              ok = true;
              paidNow = true;
              resolved = true;
              break;
            }

            const reversed = await reversePayment(payment(), callbackAuthority);
            if (reversed.ok) {
              db.updateOrderPaymentAttempt(D, current.id, callbackAuthority, {
                status: 'reversed',
                reversedAt: new Date().toISOString(),
                lastError: '',
              });
              db.updateOrder(D, current.id, {
                status: 'cancelled',
                autoCancelled: false,
                needsAttention: false,
                adminNote: [lateFailure, 'پرداخت دیرهنگام خودکار بازگردانده شد.'].join('\n'),
              });
            } else {
              const reversalError = String(reversed.message || reversed.error || 'automatic reversal failed');
              db.updateOrderPaymentAttempt(D, current.id, callbackAuthority, {
                status: 'reversal_failed',
                lastError: reversalError.slice(0, 300),
              });
              db.updateOrder(D, current.id, {
                /* Inventory could not be reclaimed, so this order must remain
                   cancelled and visibly require Admin attention. */
                status: 'cancelled',
                autoCancelled: false,
                needsAttention: true,
                adminNote: [lateFailure, 'بازگرداندن خودکار وجه ناموفق بود؛ پیگیری فوری لازم است.'].join('\n'),
              });
            }
            ok = false;
            resolved = true;
            break;
          }

          /* A verified payment cannot silently attach to a manually-cancelled
             or otherwise ineligible order. Reverse it or raise an alert. */
          await reverseUnusablePayment(
            current,
            callbackAuthority,
            refId,
            'هشدار: وضعیت سفارش اجازه تسویه این پرداخت را نمی‌دهد.',
          );
          ok = false;
          resolved = true;
        }
        if (!resolved) ok = false;
      }
    }
    if (ok && paidNow) dispatchPaidOrderSms(db.getOrderById(D, order.id), req);
    res.redirect(`/shop/order/${encodeURIComponent(order.code)}?pay=${ok ? 'ok' : 'fail'}`);
  });

  /* ---------------- admin ---------------- */
  r.get('/api/shop-admin', requireAuth, (_req, res) => {
    sweepExpiredOrders();
    const orders = db.listOrders(D).map((order) => ({
      ...order,
      paymentAttempts: db.listOrderPaymentAttempts(D, order.id),
    }));
    res.json({ orders, comments: db.listComments(D) });
  });

  /* products + display settings (admin panel) */
  r.get('/api/shop-admin/products', requireAuth, (_req, res) => {
    const snapshot = D.transaction(() => ({
      revision: db.getContentMeta(D).revision,
      products: db.listProducts(D),
      display: display(),
    }))();
    res.setHeader(CONTENT_REVISION_HEADER, String(snapshot.revision));
    res.json({ products: snapshot.products, display: snapshot.display });
  });

  r.put('/api/shop-admin/products', requireAuth, (req, res, next) => {
    return contentMutation(() => {
      /* Shop galleries are part of upload-reference accounting. Refuse this
         Admin write too when authoritative CMS sections cannot be read. */
      const authoritativeContent = assertContentAvailable();
      const initialRevision = db.getContentMeta(D).revision;
      res.setHeader(CONTENT_REVISION_HEADER, String(initialRevision));
      const revisionHeader = req.get(CONTENT_REVISION_HEADER);
      const expectedRevision = parseContentRevision(revisionHeader);
      if (revisionHeader === undefined) {
        return res.status(428).json({
          error: 'content revision is required; reload before saving',
          code: 'content-revision-required',
          revision: initialRevision,
        });
      }
      if (expectedRevision === null) {
        return res.status(400).json({
          error: 'invalid content revision',
          code: 'invalid-content-revision',
          revision: initialRevision,
        });
      }
      if (expectedRevision !== initialRevision) {
        return res.status(409).json({
          error: 'content changed in another editor; reload and review the latest version',
          code: 'content-conflict',
          revision: initialRevision,
        });
      }
      const b = req.body || {};
      let productsChanged = false;
      if (Array.isArray(b.products)) {
        const previousProducts = db.listProducts(D);
        const previousBySlug = new Map(previousProducts.map((product) => [product.slug, product]));
        /* Whole-list clients also send stale operational stock. Ignore that field
           when deciding whether editorial data changed; order still matters
           because replaceProducts persists list position. */
        productsChanged = b.products.length !== previousProducts.length ||
          b.products.some((product, index) => (
            product?.slug !== previousProducts[index]?.slug ||
            productNeedsImageValidation(product, previousBySlug.get(product?.slug), { ignore: ['stock'] })
          ));

        if (productsChanged) {
          /* Validate list-wide identity/price invariants before replaceProducts
             deletes/re-inserts it. Gallery policy is narrower: a legacy row that
             was not edited cannot block an unrelated product or display save. */
          const problems = shopProductProblems(b.products);
          if (problems.length) return res.status(400).json({ error: 'invalid products', problems });
          const brandList = Array.isArray(authoritativeContent?.brands)
            ? authoritativeContent.brands
            : db.readContentSections(D).brands;
          const knownBrandIds = new Set(brandList.map((brand) => brand.id));
          const unknownBrandIndex = b.products.findIndex((product) => {
            const brand = String(product?.brand || '').trim();
            return brand && !knownBrandIds.has(brand);
          });
          if (unknownBrandIndex >= 0) {
            const brand = String(b.products[unknownBrandIndex]?.brand || '').trim();
            return res.status(400).json({
              error: 'invalid products',
              code: 'unknown-brand',
              field: `products[${unknownBrandIndex}].brand`,
              problems: [`محصول فروشگاه به برند ناشناخته «${brand}» اشاره می‌کند`],
            });
          }
          const imageOrigins = trustedImageOrigins();
          for (let index = 0; index < b.products.length; index += 1) {
            const product = b.products[index];
            if (!productNeedsImageValidation(product, previousBySlug.get(product?.slug), { ignore: ['stock'] })) continue;
            const problem = productImagesProblem(product, imageOrigins);
            if (!problem) continue;
            const usesGallery = Array.isArray(product?.images) && product.images.length > 0;
            const imageField = problem.index >= 0
              ? (usesGallery ? `.images[${problem.index}]` : '.image')
              : '';
            return res.status(400).json({
              error: 'invalid product gallery',
              code: problem.code,
              field: `products[${index}]${imageField}`,
              detail: productImagesProblemMessage(problem),
            });
          }
          try {
            db.replaceProducts(D, b.products, { preserveStock: true });
          } catch (error) {
            if (isRichTextValidationError(error)) {
              return res.status(400).json({
                error: error.message,
                code: error.code,
                field: error.field,
                limit: error.limit,
              });
            }
            throw error;
          }
        }
      }
      const previousDisplay = display();
      const nextDisplay = b.display && typeof b.display === 'object'
        ? { ...previousDisplay, ...b.display }
        : previousDisplay;
      const displayChanged = JSON.stringify(nextDisplay) !== JSON.stringify(previousDisplay);
      if (displayChanged) db.setSetting(D, 'shop.display', nextDisplay);
      const revision = productsChanged || displayChanged
        ? db.advanceContentRevision(D, { expectedRevision })
        : initialRevision;
      res.setHeader(CONTENT_REVISION_HEADER, String(revision));
      return res.json({ ok: true, revision, products: db.listProducts(D), display: display() });
    }).catch((error) => {
      if (error?.code === 'CONTENT_UNAVAILABLE') {
        res.setHeader('Retry-After', '60');
        return res.status(503).json({
          error: 'persisted SQLite content is unavailable; restore a verified database backup before writing',
          code: 'content-unavailable',
        });
      }
      if (error?.code === 'CONTENT_CONFLICT') {
        const revision = db.getContentMeta(D).revision;
        res.setHeader(CONTENT_REVISION_HEADER, String(revision));
        return res.status(409).json({
          error: 'content changed in another editor; reload and review the latest version',
          code: 'content-conflict',
          revision,
        });
      }
      return next(error);
    });
  });

  /* Existing inventory is an operational value, not ordinary page content.
     Require the value the admin saw so a sale made in another tab turns into a
     clear 409 instead of being overwritten by a stale absolute count. */
  r.patch('/api/shop-admin/products/:slug/stock', requireAuth, (req, res) => {
    if (!Object.hasOwn(req.body || {}, 'stock') || !Object.hasOwn(req.body || {}, 'expectedStock'))
      return res.status(400).json({ error: 'stock and expectedStock are required' });
    const result = db.updateProductStock(D, req.params.slug, req.body.stock, req.body.expectedStock);
    if (result.ok) return res.json({ ok: true, stock: result.stock });
    if (result.error === 'not found') return res.status(404).json({ error: 'not found' });
    if (result.error === 'stock changed') {
      return res.status(409).json({
        error: 'stock changed',
        currentStock: result.stock,
        detail: 'موجودی پس از باز شدن این صفحه تغییر کرده است؛ اطلاعات را بروزرسانی و دوباره تلاش کنید.',
      });
    }
    if (result.error === 'active orders') {
      return res.status(409).json({
        error: 'active orders',
        activeOrders: result.activeOrders,
        currentStock: result.stock,
        detail: 'تا زمان تعیین‌تکلیف سفارش‌های فعال این محصول، موجودی نامحدود را نمی‌توان به مقدار محدود تغییر داد.',
      });
    }
    return res.status(400).json({ error: result.error });
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
    const changesAttention = Object.hasOwn(b, 'needsAttention');
    if (changesAttention && typeof b.needsAttention !== 'boolean') {
      return res.status(400).json({ error: 'invalid attention state' });
    }
    if (Object.hasOwn(b, 'archived')) {
      if (typeof b.archived !== 'boolean') {
        return res.status(400).json({ error: 'invalid archive state' });
      }
      if (b.archived && (order.needsAttention || b.needsAttention === true)) {
        return res.status(409).json({
          error: 'unresolved payment attention',
          code: 'attention-order-cannot-be-archived',
          detail: 'تا زمانی که هشدار مالی سفارش حل نشده است، سفارش قابل بایگانی نیست.',
        });
      }
      patch.archived = b.archived;
    }
    if ('status' in b && ORDER_STATUS.includes(b.status)) {
      /* The database enforces that non-cancelled orders hold stock, and moves
         status plus inventory together in one immediate transaction. */
      patch.status = b.status;
      if (b.status !== order.status) patch.archived = false;
      /* A real admin transition supersedes an automatic timeout marker. Merely
         saving a note while the select still says cancelled must not erase why
         the timeout happened (late gateway callbacks rely on that fact). */
      if (b.status !== order.status) patch.autoCancelled = false;
      if (b.status === 'paid' && !order.paidAt) patch.paidAt = new Date().toISOString();
    }
    if ('adminNote' in b) patch.adminNote = String(b.adminNote || '').slice(0, 1000);
    /* Acknowledgement is intentionally explicit: changing status or editing a
       note must never make unresolved refund work disappear by accident. */
    if (changesAttention) patch.needsAttention = b.needsAttention;
    const updateResult = db.updateOrder(D, order.id, patch);
    if (!updateResult.ok) {
      if (updateResult.error === 'not found') return res.status(404).json({ error: 'not found' });
      if (updateResult.error === 'insufficient stock') {
        return res.status(409).json({
          error: 'insufficient stock',
          detail: 'موجودی برای بازگرداندن این سفارش کافی نیست؛ ابتدا موجودی محصول را افزایش دهید.',
        });
      }
      if (updateResult.error === 'unresolved payment attention' || patch.archived === true) {
        return res.status(409).json({
          error: 'unresolved payment attention',
          code: 'attention-order-cannot-be-archived',
          detail: 'هشدار مالی هم‌زمان فعال شد؛ سفارش بایگانی نشد.',
        });
      }
      return res.status(409).json({ error: updateResult.error || 'order changed' });
    }
    const updated = updateResult.changed;

    /* Online payment sends this message from the verified callback. Offline
       payment has no callback, so the first deliberate Admin transition that
       sets `paidAt` is its proof of payment and must provide the same tracking
       link. A later status cycle cannot resend because `paidAt` is durable. */
    const firstOfflinePayment = Boolean(
      updated &&
      order.provider === 'offline' &&
      !order.paidAt &&
      patch.status === 'paid' &&
      patch.paidAt,
    );
    if (firstOfflinePayment) dispatchPaidOrderSms(db.getOrderById(D, order.id), req);

    /* The separate status follow-up remains shipped-only. Paid, delivered,
       cancelled, note edits, and repeated shipped saves do not trigger it. */
    const sms = smsCfg();
    if (updated && shouldSendShipmentSms(order.status, patch.status, sms)) {
      dispatchSms({
        kind: 'shipped',
        /* The receiver snapshot is an unverified delivery contact. Shipment
           updates, like tracking links, go only to the OTP-verified account. */
        to: verifiedCustomerPhone(order),
        ref: order.code,
        text: shipmentSmsText(order),
        templateId: sms.statusTemplateId || 0,
        params: [{ name: 'CODE', value: order.code }],
      });
    }
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
    const result = db.deleteOrder(D, req.params.id, { restoreInventory: true });
    if (!result.ok && result.error === 'not found') return res.status(404).json({ error: 'not found' });
    if (!result.ok && result.error === 'payment history protected') {
      return res.status(409).json({
        error: 'سفارش دارای تلاش پرداخت آنلاین است و برای حفظ نگاشت درگاه قابل حذف نیست.',
        detail: 'حتی authority صادرشده ممکن است بعداً پرداخت شود؛ این سفارش برای تسویه، استعلام یا بازگرداندن وجه باید نگهداری شود.',
        code: 'payment-history-protected',
      });
    }
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

  /* Masked, like the SMS settings: the merchant id and the access token
     stay on the server. They used to be returned in full to the admin tab. */
  r.get('/api/shop-admin/payment', requireAuth, (_req, res) => res.json(publicPayment(payment())));

  r.put('/api/shop-admin/payment', requireAuth, (req, res) => {
    /* merge, not replace: a form that posts the mask back keeps the stored
       credential instead of wiping it */
    const next = mergePayment(payment(), req.body || {});
    db.setSetting(D, 'shop.payment', next);
    res.json({ ok: true, payment: publicPayment(next) });
  });

  /* ---------------- gateway operations ----------------
     Everything below is admin-only and read-or-recover: look up what the
     gateway thinks happened, settle money that was paid but never
     verified, hand money back, and see the terminal ledger. */

  /** Payments the customer completed that were never verified — a dropped
   *  callback, a closed tab, a restart at the wrong moment. Each one is
   *  matched to the order that started it, so the admin sees "this
   *  customer, this order", not a bare authority string. */
  r.get('/api/shop-admin/payment/unverified', requireAuth, async (_req, res) => {
    const out = await listUnverified(payment());
    const rows = out.authorities.map((a) => {
      const authority = String(a.authority || a.Authority || a);
      const order = db.getOrderByPaymentAuthority(D, authority);
      return {
        authority,
        amount: Number(a.amount ?? 0),
        callbackUrl: String(a.callback_url || ''),
        referer: String(a.referer || ''),
        at: String(a.date || ''),
        order: order ? { id: order.id, code: order.code, total: order.total, status: order.status, customer: order.customer?.name || '' } : null,
      };
    });
    res.json({ ok: out.ok, error: out.error || '', unverified: rows });
  });

  /** Settle one of them. The amount comes from OUR order, never from the
   *  gateway's listing — the same rule as the checkout callback, for the
   *  same reason. */
  r.post('/api/shop-admin/payment/unverified/:authority/verify', requireAuth, async (req, res) => {
    const authority = String(req.params.authority || '');
    const order = db.getOrderByPaymentAuthority(D, authority);
    const attempt = order ? mappedPaymentAttempt(order.id, authority) : null;
    if (!order || !attempt) {
      if (!order) paymentAuthorityMatches(authority, '');
      return res.status(404).json({ error: 'سفارشی با این کد پرداخت پیدا نشد.' });
    }

    const out = await paymentVerifier(
      payment(),
      'zarinpal',
      { Authority: authority, Status: 'OK' },
      order.total,
      attempt.authority,
    );
    if (!out.ok) return res.status(409).json({ error: out.message || out.error || 'تأیید پرداخت ممکن نشد.', code: out.gatewayCode });

    let paidNow = false;
    if (order.status === 'pending_payment') {
      const settled = db.settlePendingOrder(D, order.id, authority, {
        provider: 'zarinpal',
        payRef: out.refId || order.payRef,
        paidAt: new Date().toISOString(),
        adminNote: order.adminNote,
      });
      paidNow = settled;
      if (!settled) {
        const latest = db.getOrderById(D, order.id);
        if (!latest || !['paid', 'shipped', 'delivered'].includes(latest.status)) {
          return res.status(409).json({ error: 'وضعیت سفارش هنگام تأیید تغییر کرد؛ دوباره بررسی کنید.' });
        }
        if (!paymentAuthorityMatches(authority, latest.payAuthority)) {
          const reversed = await reverseUnusablePayment(
            latest,
            authority,
            out.refId,
            'هشدار: سفارش هم‌زمان با تلاش پرداخت دیگری تسویه شد.',
          );
          return res.status(409).json({
            error: reversed.ok
              ? 'این پرداخت اضافه بود و مبلغ آن بازگردانده شد.'
              : 'این پرداخت اضافه است و بازگرداندن خودکار آن نیاز به پیگیری دارد.',
            reversed: !!reversed.ok,
          });
        }
      }
    } else if (['paid', 'shipped', 'delivered'].includes(order.status)) {
      if (!paymentAuthorityMatches(authority, order.payAuthority)) {
        const reversed = await reverseUnusablePayment(
          order,
          authority,
          out.refId,
          'هشدار: سفارش پیش‌تر با تلاش پرداخت دیگری تسویه شده است.',
        );
        return res.status(409).json({
          error: reversed.ok
            ? 'این پرداخت اضافه بود و مبلغ آن بازگردانده شد.'
            : 'این پرداخت اضافه است و بازگرداندن خودکار آن نیاز به پیگیری دارد.',
          reversed: !!reversed.ok,
        });
      }
    } else {
      const reversed = await reverseUnusablePayment(
        order,
        authority,
        out.refId,
        'هشدار: وضعیت سفارش اجازه تسویه پرداخت بازیابی‌شده را نمی‌دهد.',
      );
      return res.status(409).json({
        error: reversed.ok
          ? 'سفارش قابل تسویه نبود و مبلغ بازگردانده شد.'
          : 'سفارش قابل تسویه نیست و بازگرداندن مبلغ نیاز به پیگیری دارد.',
        reversed: !!reversed.ok,
      });
    }
    const paidOrder = db.getOrderById(D, order.id);
    if (paidNow) dispatchPaidOrderSms(paidOrder, req);
    res.json({ ok: true, ref: out.refId, order: paidOrder });
  });

  /** Retry reversal for one specific extra payment attempt. The order-level
   * reverse action intentionally targets the settled authority; this route is
   * what lets Admin recover a stale/crashed reversal claim without touching
   * the payment that legitimately settled the order. */
  r.post('/api/shop-admin/orders/:id/payment-attempts/:authority/reverse', requireAuth, async (req, res) => {
    const order = db.getOrderById(D, req.params.id);
    if (!order) return res.status(404).json({ error: 'not found' });
    const authority = String(req.params.authority || '');
    const attempt = mappedPaymentAttempt(order.id, authority);
    if (!attempt) return res.status(404).json({ error: 'تلاش پرداخت برای این سفارش پیدا نشد.' });
    if (attempt.provider !== 'zarinpal') {
      return res.status(409).json({ error: 'بازگرداندن خودکار برای این درگاه پشتیبانی نمی‌شود.' });
    }
    if (attempt.status === 'settled' || paymentAuthorityMatches(authority, order.payAuthority)) {
      return res.status(409).json({
        error: 'این authority پرداخت اصلی سفارش است؛ از دکمه بازگرداندن وجه سفارش استفاده کنید.',
      });
    }
    if (attempt.status === 'issued') {
      return res.status(409).json({ error: 'این تلاش هنوز پرداخت تأییدشده‌ای برای reverse ندارد.' });
    }

    const out = await reverseUnusablePayment(
      order,
      authority,
      attempt.refId,
      'اقدام مدیر برای بازیابی reverse متوقف‌شده:',
    );
    if (!out.ok) {
      if (out.pending) {
        res.setHeader('Retry-After', String(out.retryAfter || 1));
        return res.status(409).json({
          error: `reverse هنوز در حال اجراست؛ حدود ${out.retryAfter || 1} ثانیه دیگر دوباره تلاش کنید.`,
          code: 'reversal-in-progress',
          retryAfter: out.retryAfter || 1,
        });
      }
      return res.status(409).json({
        error: out.error || 'بازگرداندن این تلاش پرداخت ممکن نشد؛ هشدار سفارش فعال ماند.',
        code: out.code,
      });
    }
    res.json({
      ok: true,
      reversed: true,
      reclaimed: !!out.reclaimed,
      attempt: db.getOrderPaymentAttempt(D, order.id, authority),
      order: db.getOrderById(D, order.id),
    });
  });

  /** What does the gateway say happened to this order's payment? */
  r.post('/api/shop-admin/orders/:id/inquire', requireAuth, async (req, res) => {
    const order = db.getOrderById(D, req.params.id);
    if (!order) return res.status(404).json({ error: 'not found' });
    if (!order.payAuthority) return res.status(400).json({ error: 'این سفارش کد پرداخت ندارد.' });
    res.json(await inquirePayment(payment(), order.payAuthority));
  });

  /** Give the money back, inside ZarinPal's 30-minute window. */
  r.post('/api/shop-admin/orders/:id/reverse', requireAuth, async (req, res) => {
    const order = db.getOrderById(D, req.params.id);
    if (!order) return res.status(404).json({ error: 'not found' });
    if (!order.payAuthority) return res.status(400).json({ error: 'این سفارش کد پرداخت ندارد.' });

    const out = await reversePayment(payment(), order.payAuthority);
    if (!out.ok) return res.status(409).json({ error: out.message || out.error || 'بازگرداندن مبلغ ممکن نشد.', code: out.code });
    db.updateOrderPaymentAttempt(D, order.id, order.payAuthority, {
      status: 'reversed',
      reversedAt: new Date().toISOString(),
      lastError: '',
    });

    /* A reversed payment is a cancelled order, and cancelling is what puts
       the stock back — doing one without the other leaves the shop holding
       reserved stock for an order nobody paid for. */
    db.updateOrder(D, order.id, {
      status: 'cancelled',
      autoCancelled: false,
      needsAttention: false,
      adminNote: `${order.adminNote || ''}\nمبلغ از طریق زرین‌پال بازگردانده شد.`.trim(),
    });
    res.json({ ok: true, order: db.getOrderById(D, order.id) });
  });

  r.get('/api/shop-admin/payment/transactions', requireAuth, async (req, res) => {
    const { filter, limit, offset } = req.query;
    res.json(await listTransactions(payment(), { filter, limit, offset }));
  });

  /* Refunds are the after-the-fact counterpart to a reversal: no time
     limit, but they need the ledger credentials and a session id from the
     transaction list rather than a callback authority. */
  r.get('/api/shop-admin/payment/refunds', requireAuth, async (req, res) => {
    res.json(await listRefunds(payment(), { limit: req.query.limit, offset: req.query.offset }));
  });

  r.post('/api/shop-admin/payment/refunds', requireAuth, async (req, res) => {
    const out = await createRefund(payment(), req.body || {});
    if (!out.ok) return res.status(409).json({ error: out.error || 'برگشت وجه ممکن نشد.' });

    /* If the refund belongs to an order we know about, the order has to
       follow: money returned while the shop still holds reserved stock for
       it is a slow inventory leak nobody notices. The link is best-effort —
       a refund can legitimately be for something with no order behind it. */
    const code = String(req.body?.orderCode || '').trim();
    const order = code ? db.getOrderByCode(D, code) : null;
    if (order) {
      db.updateOrder(D, order.id, {
        status: 'cancelled',
        autoCancelled: false,
        needsAttention: false,
        adminNote: `${order.adminNote || ''}\nمبلغ از طریق زرین‌پال برگشت داده شد.`.trim(),
      });
    }
    res.json({ ...out, order: order ? db.getOrderByCode(D, code) : null });
  });

  /* "Did the customer actually get their money" — the documented answer,
     from the session timeline rather than the undocumented refunds list. */
  r.get('/api/shop-admin/payment/refunds/:sessionId', requireAuth, async (req, res) => {
    res.json(await refundStatus(payment(), req.params.sessionId));
  });

  r.get('/api/shop-admin/payment/fee', requireAuth, async (req, res) => {
    res.json(await calculateFee(payment(), req.query.amount));
  });

  r.dispatchSms = dispatchSms;
  r.smsSettings = smsCfg;
  r.useCustomer = (fn) => {
    getCustomer = fn;
  };

  return r;
}
