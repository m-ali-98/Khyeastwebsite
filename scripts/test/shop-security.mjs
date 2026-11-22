/* Focused regressions for same-app redirects, customer order projections,
   callback origins, and the refund-to-order boundary. */
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { safeShopNext } from '../../shared/shopRedirect.js';
import { publicOrderView } from '../../server/orderViews.js';
import { checkoutOrderId, clearCheckoutOrderId } from '../../src/shop/orderIntent.js';
import { isTrustedCallbackBase, safeOrigin, trustedCsrfOrigins } from '../../server/siteOrigin.js';
import { originAllowed } from '../../server/accounts.js';
import {
  orderCodeFromTransactionDescription,
  refundTransactionMatchesOrder,
} from '../../server/payment.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let pass = 0;
let fail = 0;
const check = (ok, name, detail = '') => {
  if (ok) pass += 1;
  else {
    fail += 1;
    console.log(`LEAK ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

/* ------------------------------------------ H8: local post-login paths */
{
  const origin = 'https://shop.example.test';
  check(safeShopNext('/shop/checkout', origin) === '/shop/checkout', 'checkout is an allowed post-login destination');
  check(safeShopNext('/shop/order/KY-ABC-123?pay=ok&token=secret', origin) === '/shop/order/KY-ABC-123?pay=ok', 'order destination is same-app and strips legacy tokens');
  check(safeShopNext('/shop/cart#items', origin) === '/shop/cart#items', 'same-app fragments are preserved');
  for (const value of [
    'https://evil.example/shop/cart',
    '//evil.example/shop/cart',
    '/\\\\evil.example/shop/cart',
    '/shop/../admin',
    '/shop/%2e%2e/admin',
    '/shop/login',
    '',
  ]) {
    check(safeShopNext(value, origin) === '/shop/account', `unsafe destination falls back: ${JSON.stringify(value)}`);
  }
}

/* --------------------------------------- H1/H6/H9: public projection */
{
  const source = {
    id: 'internal-id', code: 'KY-ABC-123', token: 'bearer-token', customerId: 'customer-id',
    provider: 'zarinpal', payAuthority: 'authority', payRef: 'reference', adminNote: 'private note',
    paidAt: '2026-09-08T00:00:00.000Z', needsAttention: true,
    items: [{ slug: 'yeast', title: 'Yeast', unit: 'kg', price: 10, qty: 2, sum: 20, internal: 'secret' }],
    customer: { name: 'Customer', phone: '09120000000', city: 'Ahvaz', address: 'A street', addressId: 'private-address' },
    subtotal: 20, shipping: 0, total: 20, currency: 'IRR', status: 'paid', at: '2026-09-08T00:00:00.000Z',
  };
  const view = publicOrderView(source);
  check(!['id', 'token', 'customerId', 'provider', 'payAuthority', 'payRef', 'adminNote', 'paidAt', 'needsAttention'].some((key) => Object.hasOwn(view, key)), 'customer projection excludes internal order and payment fields');
  check(!Object.hasOwn(view.customer, 'addressId') && !Object.hasOwn(view.items[0], 'internal'), 'nested projection excludes internal address and item fields');
}

/* ----------------------------------------------- M3: callback origins */
{
  const req = (host, protocol = 'https') => ({ protocol, get: (name) => name === 'host' ? host : '' });
  const pinned = { NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://shop.example.test' };
  check(safeOrigin(req('attacker.example'), '', pinned) === pinned.PUBLIC_ORIGIN, 'pinned public origin defeats Host-header poisoning');
  check(isTrustedCallbackBase(pinned.PUBLIC_ORIGIN, req('attacker.example'), pinned), 'the pinned callback origin is trusted');
  check(!isTrustedCallbackBase('https://attacker.example', req('shop.example.test'), pinned), 'a foreign callback origin is rejected');
  check(safeOrigin(req('shop.example.test'), 'https://attacker.example', pinned) === '', 'a stale untrusted callback setting fails closed instead of falling back');
  const alias = { ...pinned, TRUSTED_HOSTS: 'www.shop.example.test' };
  check(isTrustedCallbackBase('https://www.shop.example.test', req('shop.example.test'), alias), 'an explicitly allowlisted HTTPS alias is accepted');
  check(!isTrustedCallbackBase('http://www.shop.example.test', req('shop.example.test', 'https'), alias), 'production callback origins must use HTTPS');
  const csrfOrigins = trustedCsrfOrigins(req('shop.example.test'), alias);
  const canonicalOriginRequest = {
    ...req('shop.example.test'),
    get: (name) => name === 'origin' ? 'https://shop.example.test' : name === 'host' ? 'shop.example.test' : '',
  };
  const aliasOriginRequest = {
    ...req('shop.example.test'),
    get: (name) => name === 'origin' ? 'https://www.shop.example.test' : name === 'host' ? 'shop.example.test' : '',
  };
  const insecureAliasRequest = {
    ...req('shop.example.test'),
    get: (name) => name === 'origin' ? 'http://www.shop.example.test' : name === 'host' ? 'shop.example.test' : '',
  };
  check(
    csrfOrigins.includes(pinned.PUBLIC_ORIGIN) && csrfOrigins.includes('https://www.shop.example.test') &&
      originAllowed(canonicalOriginRequest, csrfOrigins) && originAllowed(aliasOriginRequest, csrfOrigins),
    'CSRF accepts the canonical origin and an explicitly trusted HTTPS alias',
  );
  check(
    !originAllowed(insecureAliasRequest, csrfOrigins) &&
      !csrfOrigins.includes('https://attacker.example'),
    'CSRF excludes insecure aliases and unrelated origins',
  );
  const allowlisted = { NODE_ENV: 'production', TRUSTED_HOSTS: 'shop.example.test' };
  check(safeOrigin(req('shop.example.test'), '', allowlisted) === 'https://shop.example.test', 'trusted-host-only production config resolves the matching HTTPS origin');
  check(safeOrigin(req('attacker.example'), '', allowlisted) === '', 'a non-allowlisted production Host is refused');
  check(safeOrigin(req('shop.example.test', 'http'), '', allowlisted) === '', 'production never builds callbacks over HTTP');
  const development = { NODE_ENV: 'development' };
  check(safeOrigin(req('localhost:4175', 'http'), '', development) === 'http://localhost:4175', 'local development may use its validated request origin');
  check(!isTrustedCallbackBase('https://shop.example.test/path', req('shop.example.test'), pinned), 'callback settings cannot contain a path');
}

/* --------------------------------------------- N9: checkout idempotency */
{
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  let lockTail = Promise.resolve();
  const locks = {
    request: (_name, _options, callback) => {
      const run = lockTail.then(callback);
      lockTail = run.then(() => undefined, () => undefined);
      return run;
    },
  };
  const payload = { customerId: 'customer-a', items: [{ slug: 'yeast', qty: 2 }], addressId: 'home', note: '' };
  const [first, concurrent] = await Promise.all([
    checkoutOrderId(payload, { storage, locks, cryptoApi: crypto.webcrypto, now: 1_800_000_000_000 }),
    checkoutOrderId(payload, { storage, locks, cryptoApi: crypto.webcrypto, now: 1_800_000_000_000 }),
  ]);
  const changedIntent = await checkoutOrderId({ ...payload, note: 'leave at the door' }, {
    storage, locks, cryptoApi: crypto.webcrypto, now: 1_800_000_000_000,
  });
  check(first === concurrent, 'same-payload checkout tabs converge on one locked local idempotency key');
  check(first !== changedIntent, 'a materially different checkout intent receives a fresh key');
  clearCheckoutOrderId(changedIntent, storage);
  const renewed = await checkoutOrderId({ ...payload, note: 'leave at the door' }, {
    storage, locks, cryptoApi: crypto.webcrypto, now: 1_800_000_000_001,
  });
  check(renewed !== changedIntent, 'a completed checkout clears its local idempotency key');
}

/* ------------------------------------------------ M8: session association */
{
  const order = { code: 'KY-REFUND-A', total: 910000 };
  const transaction = {
    id: 'session-A',
    status: 'PAID',
    amount: 910000,
    description: 'سفارش KY-REFUND-A — خمیرمایه خوزستان',
  };
  check(orderCodeFromTransactionDescription(transaction.description) === order.code, 'the server-authored gateway description identifies its order');
  check(refundTransactionMatchesOrder(order, 'session-A', transaction), 'the exact terminal session, description and amount match');
  check(!refundTransactionMatchesOrder({ ...order, code: 'KY-REFUND-B' }, 'session-A', transaction), 'a different order code cannot be paired with the session');
  check(!refundTransactionMatchesOrder(order, 'session-B', transaction), 'a different terminal session cannot be paired with the order');
  check(!refundTransactionMatchesOrder({ ...order, total: 1 }, 'session-A', transaction), 'a different transaction amount cannot cancel the order');
}

/* Exercise the real Admin refund route: mismatched order codes must be
   rejected before the gateway is called or inventory is released. */
{
  const dbStore = await import(pathToFileURL(path.join(ROOT, 'server/db.js')).href);
  const { createShopRouter } = await import(pathToFileURL(path.join(ROOT, 'server/shop.js')).href);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ky-refund-link-test-'));
  const database = await dbStore.openDB(path.join(dataDir, 'refund-link.db'));
  dbStore.initializeStore(database, { freshInstall: true });
  const product = dbStore.listProducts(database).find((entry) => entry.active && Number(entry.stock) >= 2);
  let refundCalls = 0;
  const rows = [];
  const transactionOffsets = [];
  let transactionListBehavior = null;
  const addPaidOrder = (code, sessionId) => {
    const now = new Date().toISOString();
    const order = {
      id: crypto.randomUUID(), code, token: crypto.randomBytes(16).toString('hex'),
      items: [{ slug: product.slug, title: product.title, unit: product.unit || '', price: product.price, qty: 1, sum: product.price }],
      customer: {}, subtotal: product.price, shipping: 0, total: product.price, currency: 'IRR',
      status: 'paid', provider: 'zarinpal', payAuthority: `AUTH-${sessionId}`, payRef: `REF-${sessionId}`,
      adminNote: '', at: now, paidAt: now,
    };
    const placed = dbStore.reserveAndInsertOrder(database, order);
    if (!placed.ok) throw new Error(`could not reserve fixture stock: ${placed.error}`);
    rows.push({ id: sessionId, status: 'PAID', amount: order.total, description: `سفارش ${code} — خمیرمایه خوزستان` });
    return order;
  };
  const first = addPaidOrder('KY-REFUND-A', 'session-A');
  const second = addPaidOrder('KY-REFUND-B', 'session-B');
  const partial = addPaidOrder('KY-REFUND-PARTIAL', 'session-C');
  const stockAfterPlacement = dbStore.getProduct(database, product.slug).stock;

  const permit = () => ({ limited: false, retryAfter: 0, finish() {} });
  let reverseCalls = 0;
  let verifyCalls = 0;
  let verifyBehavior = async () => ({ ok: false });
  let reverseBehavior = async () => ({ ok: true });
  let checkoutCustomerId = 'shop-security-customer';
  let origin = '';
  const router = createShopRouter({
    database,
    requireAuth: (_req, _res, next) => next(),
    rateLimiter: { check: permit, reserve: permit },
    selfOrigin: () => origin,
    transactionLister: async (_payment, { limit = 100, offset = 0 } = {}) => {
      transactionOffsets.push(offset);
      if (transactionListBehavior) return transactionListBehavior({ limit, offset });
      return { ok: true, transactions: rows.slice(offset, offset + limit) };
    },
    paymentVerifier: async (...args) => {
      verifyCalls += 1;
      return verifyBehavior(...args);
    },
    paymentReverser: async (...args) => {
      reverseCalls += 1;
      return reverseBehavior(...args);
    },
    refundCreator: async () => { refundCalls += 1; return { ok: true, id: 'refund-ok' }; },
  });
  router.useCustomer((request) => ({ id: request.get('x-test-customer') || checkoutCustomerId }));
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  const sendRefund = (body) => fetch(`${origin}/api/shop-admin/payment/refunds`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const sendReverse = (orderId) => fetch(`${origin}/api/shop-admin/orders/${encodeURIComponent(orderId)}/reverse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const sendAttemptReverse = (orderId, authority) => fetch(
    `${origin}/api/shop-admin/orders/${encodeURIComponent(orderId)}/payment-attempts/${encodeURIComponent(authority)}/reverse`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' } },
  );
  const sendPaymentCallback = (code, authority) => fetch(
    `${origin}/api/shop-pay/zarinpal/callback?code=${encodeURIComponent(code)}&Authority=${encodeURIComponent(authority)}&Status=OK`,
    { redirect: 'manual' },
  );
  const sendComment = (comment, requestOrigin = origin) => fetch(`${origin}/api/shop-public/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: requestOrigin },
    body: JSON.stringify(comment),
  });
  const sendNewOrder = (requestOrigin = origin) => fetch(`${origin}/api/shop-public/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: requestOrigin },
    body: JSON.stringify({}),
  });
  const sendCheckoutOrder = (idempotencyKey, customerId = checkoutCustomerId) => fetch(`${origin}/api/shop-public/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, 'X-Test-Customer': customerId },
    body: JSON.stringify({
      idempotencyKey,
      items: [{ slug: product.slug, qty: 1 }],
      customer: {
        name: 'Shop Security Test',
        phone: '09121234567',
        city: 'اهواز',
        address: 'خیابان تست، پلاک ۱۲۳',
      },
    }),
  });
  try {
    const wrongProviderOrder = {
      id: crypto.randomUUID(),
      code: 'KY-WRONG-PROVIDER-CALLBACK',
      token: crypto.randomBytes(16).toString('hex'),
      items: [],
      customer: {},
      subtotal: 1000,
      shipping: 0,
      total: 1000,
      currency: 'IRR',
      status: 'pending_payment',
      provider: 'offline',
      payAuthority: 'AUTH-WRONG-PROVIDER',
      payRef: null,
      adminNote: '',
      at: new Date().toISOString(),
      paidAt: null,
    };
    dbStore.insertOrder(database, wrongProviderOrder);
    const wrongProviderCallback = await fetch(
      `${origin}/api/shop-pay/zarinpal/callback?code=${encodeURIComponent(wrongProviderOrder.code)}` +
        `&Authority=${encodeURIComponent(wrongProviderOrder.payAuthority)}&Status=OK`,
      { redirect: 'manual' },
    );
    const invalidAuthorityCallback = await fetch(
      `${origin}/api/shop-pay/zarinpal/callback?code=${encodeURIComponent(wrongProviderOrder.code)}` +
        `&Authority=unmapped-authority&Status=OK`,
      { redirect: 'manual' },
    );
    const unknownOrderCallback = await fetch(
      `${origin}/api/shop-pay/zarinpal/callback?code=KY-UNKNOWN-ORDER&Authority=unmapped-authority&Status=OK`,
      { redirect: 'manual' },
    );
    const callbackBodies = await Promise.all([
      wrongProviderCallback.text(),
      invalidAuthorityCallback.text(),
      unknownOrderCallback.text(),
    ]);
    check(
      [wrongProviderCallback, invalidAuthorityCallback, unknownOrderCallback]
        .every((response) => response.status === 302 && response.headers.get('location') === '/shop') &&
        callbackBodies.every((body) => body === callbackBodies[0]) && verifyCalls === 0,
      'unknown order codes and known orders with invalid authority/provider share one non-oracular callback response',
      JSON.stringify([wrongProviderCallback.status, invalidAuthorityCallback.status, unknownOrderCallback.status]),
    );
    const wrongProviderAdminVerify = await fetch(
      `${origin}/api/shop-admin/payment/unverified/${encodeURIComponent(wrongProviderOrder.payAuthority)}/verify`,
      { method: 'POST' },
    );
    check(
      wrongProviderAdminVerify.status === 409 && verifyCalls === 0,
      'the Admin recovery route refuses verification through a mismatched payment provider',
    );

    const commentCountBeforeCsrf = dbStore.listComments(database).length;
    const crossSiteComment = await sendComment({ slug: product.slug, name: 'مهمان', text: 'درخواست بین‌سایتی' }, 'https://evil.example');
    check(
      crossSiteComment.status === 403 && dbStore.listComments(database).length === commentCountBeforeCsrf,
      'a foreign-origin comment submission is rejected before writing public content',
    );

    const previousDisplay = dbStore.getSetting(database, 'shop.display') || {};
    const commentsBeforePause = dbStore.listComments(database).length;
    dbStore.setSetting(database, 'shop.display', { ...previousDisplay, enabled: false });
    const pausedOrder = await sendNewOrder();
    const pausedComment = await sendComment({ slug: product.slug, name: 'مهمان', text: 'نظر هنگام توقف فروشگاه' });
    dbStore.setSetting(database, 'shop.display', { ...previousDisplay, enabled: true });
    check(pausedOrder.status === 403, 'the server rejects new orders while the public storefront is paused');
    check(
      pausedComment.status === 403 && dbStore.listComments(database).length === commentsBeforePause,
      'comment writes are rejected while the storefront is paused without changing comment flags',
    );
    const sameOriginComment = await sendComment({ slug: product.slug, name: 'مهمان', text: 'نظر هم‌مبدأ' });
    check(sameOriginComment.ok, 'same-origin comment writes remain enabled when the storefront is open');

    const mismatched = await sendRefund({ sessionId: 'session-A', orderCode: second.code, amount: first.total });
    check(mismatched.status === 409 && refundCalls === 0, 'wrong orderCode is rejected before the external refund call');
    check(dbStore.getOrderById(database, second.id).status === 'paid', 'a mismatched refund cannot cancel another order');
    check(dbStore.getProduct(database, product.slug).stock === stockAfterPlacement, 'a mismatched refund cannot release inventory');

    const correct = await sendRefund({ sessionId: 'session-A', orderCode: first.code, amount: first.total });
    const correctBody = await correct.json();
    check(correct.ok && correctBody.order?.status === 'cancelled' && refundCalls === 1, 'the exact session/order match refunds and cancels its own order');
    check(dbStore.getProduct(database, product.slug).stock === stockAfterPlacement + 1, 'only the matched refund restores its reserved unit');

    const automatic = await sendRefund({ sessionId: 'session-B', amount: second.total });
    const automaticBody = await automatic.json();
    check(automatic.ok && automaticBody.order?.code === second.code && automaticBody.order.status === 'cancelled', 'a verified gateway description safely auto-links the correct order');
    check(dbStore.getProduct(database, product.slug).stock === stockAfterPlacement + 2, 'the second matched refund restores only its own unit');

    const overRefund = await sendRefund({ sessionId: 'session-C', orderCode: partial.code, amount: partial.total + 1 });
    check(overRefund.status === 400 && refundCalls === 2, 'a refund above the terminal transaction amount is rejected before the gateway call');

    const partialRefund = await sendRefund({ sessionId: 'session-C', orderCode: partial.code, amount: Math.floor(partial.total / 2) });
    const partialBody = await partialRefund.json();
    check(partialRefund.ok && partialBody.order?.status === 'paid' && partialBody.order?.needsAttention, 'a partial refund keeps the order active and flags it for review');
    check(dbStore.getProduct(database, product.slug).stock === stockAfterPlacement + 2, 'a partial refund does not release the full order reservation');

    const unresolvedFullRefund = addPaidOrder('KY-REFUND-UNRESOLVED', 'session-unresolved');
    const unresolvedAuthority = 'AUTH-UNRESOLVED-EXTRA';
    dbStore.recordOrderPaymentAttempt(database, unresolvedFullRefund.id, {
      authority: unresolvedAuthority,
      provider: 'zarinpal',
    });
    dbStore.updateOrderPaymentAttempt(database, unresolvedFullRefund.id, unresolvedAuthority, {
      status: 'reversal_failed',
      lastError: 'still unresolved',
    });
    dbStore.updateOrder(database, unresolvedFullRefund.id, { needsAttention: true });
    const fullRefundWithAlert = await sendRefund({
      sessionId: 'session-unresolved',
      orderCode: unresolvedFullRefund.code,
      amount: unresolvedFullRefund.total,
    });
    const fullRefundAlertBody = await fullRefundWithAlert.json();
    check(
      fullRefundWithAlert.ok && fullRefundAlertBody.order?.status === 'cancelled' && fullRefundAlertBody.order?.needsAttention,
      'a full refund does not clear another unresolved payment-attempt alert',
    );

    const reversing = addPaidOrder('KY-ADMIN-REVERSE-CLAIM', 'session-reverse-claim');
    const stockAtReverseClaim = dbStore.getProduct(database, product.slug).stock;
    let signalReverseStarted;
    let releaseReverse;
    const reverseStarted = new Promise((resolve) => { signalReverseStarted = resolve; });
    const reverseGatewayResult = new Promise((resolve) => { releaseReverse = resolve; });
    reverseBehavior = async () => {
      signalReverseStarted();
      return reverseGatewayResult;
    };
    const firstReversePromise = sendReverse(reversing.id);
    await reverseStarted;
    check(
      dbStore.getOrderById(database, reversing.id)?.needsAttention &&
        dbStore.getOrderPaymentAttempt(database, reversing.id, reversing.payAuthority)?.status === 'reversing',
      'Admin reversal claim is committed and visible before contacting the gateway',
    );
    const duplicateReverse = await sendReverse(reversing.id);
    const duplicateReverseBody = await duplicateReverse.json();
    check(
      duplicateReverse.status === 409 && duplicateReverseBody.code === 'reversal-in-progress' && reverseCalls === 1,
      'a concurrent Admin request cannot issue a second external reversal',
    );
    releaseReverse({ ok: true });
    const firstReverse = await firstReversePromise;
    const firstReverseBody = await firstReverse.json();
    check(
      firstReverse.ok && firstReverseBody.order?.status === 'cancelled' && firstReverseBody.attempt?.status === 'reversed',
      'a successful claimed Admin reversal completes the payment ledger and cancels its order',
    );
    check(
      dbStore.getProduct(database, product.slug).stock === stockAtReverseClaim + 1 &&
        !firstReverseBody.order?.needsAttention,
      'the claimed reversal restores stock once and clears only resolved financial attention',
    );
    const callsAfterSuccess = reverseCalls;
    const duplicateAfterSuccess = await sendReverse(reversing.id);
    const duplicateAfterSuccessBody = await duplicateAfterSuccess.json();
    check(
      duplicateAfterSuccess.ok && duplicateAfterSuccessBody.alreadyReversed && reverseCalls === callsAfterSuccess &&
        dbStore.getProduct(database, product.slug).stock === stockAtReverseClaim + 1,
      'replaying a completed Admin reversal repairs locally without another gateway call or stock credit',
    );

    const retryableReverse = addPaidOrder('KY-ADMIN-REVERSE-RETRY', 'session-reverse-retry');
    const stockAtFailedReverse = dbStore.getProduct(database, product.slug).stock;
    reverseBehavior = async () => ({ ok: false, message: 'temporary gateway outage' });
    const failedReverse = await sendReverse(retryableReverse.id);
    const failedReverseBody = await failedReverse.json();
    check(
      failedReverse.status === 409 &&
        dbStore.getOrderPaymentAttempt(database, retryableReverse.id, retryableReverse.payAuthority)?.status === 'reversal_failed' &&
        dbStore.getOrderById(database, retryableReverse.id)?.needsAttention &&
        failedReverseBody.error === 'temporary gateway outage',
      'a gateway failure records a retryable reversal and keeps the financial warning visible',
    );
    check(
      dbStore.getProduct(database, product.slug).stock === stockAtFailedReverse,
      'a failed reversal does not release reserved inventory',
    );
    reverseBehavior = async () => ({ ok: true });
    const retriedReverse = await sendReverse(retryableReverse.id);
    const retriedReverseBody = await retriedReverse.json();
    check(
      retriedReverse.ok && retriedReverseBody.order?.status === 'cancelled' &&
        dbStore.getProduct(database, product.slug).stock === stockAtFailedReverse + 1,
      'an Admin can retry a failed claim and release stock exactly once after gateway success',
    );

    const stockBeforeLateCallbacks = dbStore.getProduct(database, product.slug).stock;
    const addExpiredLateOrder = (suffix, authority) => {
      const now = new Date().toISOString();
      const code = `KY-LATE-REVERSE-${suffix}`;
      const lateOrder = {
        id: crypto.randomUUID(),
        code,
        items: [{ slug: product.slug, title: product.title, unit: product.unit || '', price: product.price, qty: 1, sum: product.price }],
        customer: {}, subtotal: product.price, shipping: 0, total: product.price, currency: 'IRR',
        status: 'pending_payment', provider: 'zarinpal', payAuthority: authority, payRef: null,
        adminNote: '', at: now, paidAt: null,
      };
      dbStore.insertOrder(database, lateOrder);
      const expired = dbStore.expirePendingOrders(database, new Date(Date.now() + 60_000).toISOString());
      if (!expired.some((entry) => entry.id === lateOrder.id)) throw new Error('late-payment fixture did not expire');
      database.prepare('UPDATE products SET stock = 0 WHERE slug = ?').run(product.slug);
      return lateOrder;
    };

    const failedLateOrder = addExpiredLateOrder('RETRY', 'AUTH-LATE-RETRY-001');
    const verifierCallsBeforeLate = verifyCalls;
    const reversalsBeforeLate = reverseCalls;
    verifyBehavior = async () => ({ ok: true, refId: 'REF-LATE-RETRY' });
    reverseBehavior = async () => ({ ok: false, message: 'temporary late-payment reversal outage' });
    const failedLateCallback = await sendPaymentCallback(failedLateOrder.code, 'AUTH-LATE-RETRY-001');
    const failedLateAttempt = dbStore.getOrderPaymentAttempt(database, failedLateOrder.id, 'AUTH-LATE-RETRY-001');
    const failedLateState = dbStore.getOrderById(database, failedLateOrder.id);
    check(
      failedLateCallback.status === 302 && failedLateAttempt?.status === 'reversal_failed' &&
        failedLateState.autoCancelState === 2 && failedLateState.status === 'cancelled' &&
        reverseCalls === reversalsBeforeLate + 1,
      'a no-stock late payment reverses through the claimed ledger path and retains marker 2 on failure',
    );
    const verifyCallsAfterLateFailure = verifyCalls;
    reverseBehavior = async () => ({ ok: true });
    const retriedLateCallback = await sendPaymentCallback(failedLateOrder.code, 'AUTH-LATE-RETRY-001');
    const retriedLateAttempt = dbStore.getOrderPaymentAttempt(database, failedLateOrder.id, 'AUTH-LATE-RETRY-001');
    const retriedLateState = dbStore.getOrderById(database, failedLateOrder.id);
    check(
      retriedLateCallback.status === 302 && retriedLateAttempt?.status === 'reversed' &&
        retriedLateState.autoCancelState === 0 && !retriedLateState.autoCancelled &&
        verifyCalls === verifyCallsAfterLateFailure && reverseCalls === reversalsBeforeLate + 2 &&
        dbStore.getProduct(database, product.slug).stock === 0,
      'a later callback retries reversal_failed without re-verification or inventory mutation',
    );

    const crashedLateOrder = addExpiredLateOrder('CRASH-RECOVERY', 'AUTH-LATE-CRASH-001');
    const claimBeforeWorkerFailure = dbStore.claimExpiredPayment(database, crashedLateOrder.id, {
      provider: 'zarinpal',
      authority: 'AUTH-LATE-CRASH-001',
      payRef: 'REF-LATE-CRASH',
      paidAt: new Date().toISOString(),
      successNote: 'late payment was verified',
      failureNote: 'late payment awaits reversal',
    });
    check(
      claimBeforeWorkerFailure.ok && !claimBeforeWorkerFailure.reserved &&
        dbStore.getOrderById(database, crashedLateOrder.id).autoCancelState === 2 &&
        dbStore.getOrderPaymentAttempt(database, crashedLateOrder.id, 'AUTH-LATE-CRASH-001')?.status === 'verified',
      'a worker crash after the no-stock claim leaves recoverable verified evidence',
    );

    let signalLateReverseStarted;
    let releaseLateReverse;
    const lateReverseStarted = new Promise((resolve) => { signalLateReverseStarted = resolve; });
    const lateReverseResult = new Promise((resolve) => { releaseLateReverse = resolve; });
    reverseBehavior = async () => {
      signalLateReverseStarted();
      return lateReverseResult;
    };
    const verifyCallsBeforeRecovery = verifyCalls;
    const reversalsBeforeRecovery = reverseCalls;
    const recoveringCallbackPromise = sendPaymentCallback(crashedLateOrder.code, 'AUTH-LATE-CRASH-001');
    await lateReverseStarted;
    const adminRacingReverse = await sendAttemptReverse(crashedLateOrder.id, 'AUTH-LATE-CRASH-001');
    const adminRacingBody = await adminRacingReverse.json();
    check(
      adminRacingReverse.status === 409 && adminRacingBody.code === 'reversal-in-progress' &&
        reverseCalls === reversalsBeforeRecovery + 1,
      'an Admin reverse racing callback recovery cannot issue a second gateway reversal',
    );
    releaseLateReverse({ ok: true });
    const recoveredLateCallback = await recoveringCallbackPromise;
    const recoveredLateState = dbStore.getOrderById(database, crashedLateOrder.id);
    check(
      recoveredLateCallback.status === 302 && recoveredLateState.autoCancelState === 0 &&
        dbStore.getOrderPaymentAttempt(database, crashedLateOrder.id, 'AUTH-LATE-CRASH-001')?.status === 'reversed' &&
        verifyCalls === verifyCallsBeforeRecovery && reverseCalls === reversalsBeforeRecovery + 1 &&
        dbStore.getProduct(database, product.slug).stock === 0,
      'a callback reclaims verified crash-state through the fenced path and atomically clears marker 2',
    );

    const orderLevelLateOrder = addExpiredLateOrder('ORDER-LEVEL-RACE', 'AUTH-LATE-ORDER-LEVEL-001');
    const orderLevelLateClaim = dbStore.claimExpiredPayment(database, orderLevelLateOrder.id, {
      provider: 'zarinpal', authority: 'AUTH-LATE-ORDER-LEVEL-001', payRef: 'REF-LATE-ORDER-LEVEL',
      paidAt: new Date().toISOString(), successNote: 'late success', failureNote: 'late refund needed',
    });
    check(orderLevelLateClaim.ok && !orderLevelLateClaim.reserved, 'order-level reverse race fixture is in recoverable marker 2');
    let signalOrderReverseStarted;
    let releaseOrderReverse;
    const orderReverseStarted = new Promise((resolve) => { signalOrderReverseStarted = resolve; });
    const orderReverseResult = new Promise((resolve) => { releaseOrderReverse = resolve; });
    reverseBehavior = async () => {
      signalOrderReverseStarted();
      return orderReverseResult;
    };
    const orderLevelCallsBefore = reverseCalls;
    const orderLevelCallbackPromise = sendPaymentCallback(orderLevelLateOrder.code, 'AUTH-LATE-ORDER-LEVEL-001');
    await orderReverseStarted;
    const adminOrderReverseRace = await sendReverse(orderLevelLateOrder.id);
    const adminOrderReverseRaceBody = await adminOrderReverseRace.json();
    check(
      adminOrderReverseRace.status === 409 && adminOrderReverseRaceBody.code === 'reversal-in-progress' &&
        reverseCalls === orderLevelCallsBefore + 1,
      'the order-level Admin reverse shares the callback claim and cannot issue a second reversal',
    );
    releaseOrderReverse({ ok: true });
    await orderLevelCallbackPromise;
    check(
      dbStore.getOrderById(database, orderLevelLateOrder.id).autoCancelState === 0 &&
        dbStore.getOrderPaymentAttempt(database, orderLevelLateOrder.id, 'AUTH-LATE-ORDER-LEVEL-001')?.status === 'reversed' &&
        dbStore.getProduct(database, product.slug).stock === 0,
      'callback completion and order-level Admin recovery leave one reversed ledger row and unchanged stock',
    );

    const adminRetryLateOrder = addExpiredLateOrder('ADMIN-RETRY', 'AUTH-LATE-ADMIN-RETRY-001');
    const adminRetryLateClaim = dbStore.claimExpiredPayment(database, adminRetryLateOrder.id, {
      provider: 'zarinpal', authority: 'AUTH-LATE-ADMIN-RETRY-001', payRef: 'REF-LATE-ADMIN-RETRY',
      paidAt: new Date().toISOString(), successNote: 'late payment was verified', failureNote: 'late payment awaits reversal',
    });
    check(adminRetryLateClaim.ok && !adminRetryLateClaim.reserved, 'attempt-level Admin retry fixture retains marker 2 after no-stock claim');
    reverseBehavior = async () => ({ ok: false, message: 'temporary late-payment outage before Admin retry' });
    const failedAdminRetryCallback = await sendPaymentCallback(adminRetryLateOrder.code, 'AUTH-LATE-ADMIN-RETRY-001');
    const adminRetryFailure = dbStore.getOrderPaymentAttempt(database, adminRetryLateOrder.id, 'AUTH-LATE-ADMIN-RETRY-001');
    check(
      failedAdminRetryCallback.status === 302 && adminRetryFailure?.status === 'reversal_failed' &&
        dbStore.getOrderById(database, adminRetryLateOrder.id).autoCancelState === 2,
      'a failed late-payment callback leaves the attempt specifically available to Admin recovery',
    );
    const verifiesBeforeAdminRetry = verifyCalls;
    const reversalsBeforeAdminRetry = reverseCalls;
    reverseBehavior = async () => ({ ok: true });
    const adminLateRetry = await sendAttemptReverse(adminRetryLateOrder.id, 'AUTH-LATE-ADMIN-RETRY-001');
    const adminLateRetryBody = await adminLateRetry.json();
    check(
      adminLateRetry.ok && adminLateRetryBody.attempt?.status === 'reversed' &&
        adminLateRetryBody.order?.autoCancelState === 0 && !adminLateRetryBody.order?.autoCancelled &&
        !adminLateRetryBody.order?.needsAttention && verifyCalls === verifiesBeforeAdminRetry &&
        reverseCalls === reversalsBeforeAdminRetry + 1 && dbStore.getProduct(database, product.slug).stock === 0,
      'the attempt-level Admin retry finalizes marker 2 without re-verification or inventory mutation',
    );

    const postSuccessCrashOrder = addExpiredLateOrder('POST-SUCCESS-CRASH', 'AUTH-LATE-POST-SUCCESS-001');
    const postSuccessClaim = dbStore.claimExpiredPayment(database, postSuccessCrashOrder.id, {
      provider: 'zarinpal', authority: 'AUTH-LATE-POST-SUCCESS-001', payRef: 'REF-LATE-POST-SUCCESS',
      paidAt: new Date().toISOString(), successNote: 'late payment was verified', failureNote: 'late payment awaits reversal',
    });
    const reversalClaimBeforeCrash = dbStore.claimOrderPaymentReversal(database, postSuccessCrashOrder.id, 'AUTH-LATE-POST-SUCCESS-001', {
      refId: 'REF-LATE-POST-SUCCESS', verifiedAt: new Date().toISOString(),
    });
    const ledgerSuccessBeforeCrash = dbStore.finishOrderPaymentReversal(database, postSuccessCrashOrder.id, 'AUTH-LATE-POST-SUCCESS-001', {
      claimedAt: reversalClaimBeforeCrash.attempt?.reversalStartedAt,
      ok: true,
    });
    const reversalsBeforeMarkerRepair = reverseCalls;
    const markerRepairCallback = await sendPaymentCallback(postSuccessCrashOrder.code, 'AUTH-LATE-POST-SUCCESS-001');
    const repairedPostSuccessOrder = dbStore.getOrderById(database, postSuccessCrashOrder.id);
    check(
      postSuccessClaim.ok && !postSuccessClaim.reserved && reversalClaimBeforeCrash.claimed && ledgerSuccessBeforeCrash.finished &&
        markerRepairCallback.status === 302 && repairedPostSuccessOrder.autoCancelState === 0 &&
        dbStore.getOrderPaymentAttempt(database, postSuccessCrashOrder.id, 'AUTH-LATE-POST-SUCCESS-001')?.status === 'reversed' &&
        reverseCalls === reversalsBeforeMarkerRepair && dbStore.getProduct(database, product.slug).stock === 0,
      'a callback repairs the durable marker after gateway success was recorded but the worker crashed before cleanup',
    );
    database.prepare('UPDATE products SET stock = ? WHERE slug = ?').run(stockBeforeLateCallbacks, product.slug);

    const olderLedgerOrder = addPaidOrder('KY-REFUND-OLDER-LEDGER', 'session-older-ledger');
    const olderLedgerRowIndex = rows.findIndex((row) => row.id === 'session-older-ledger');
    const olderLedgerRow = rows.splice(olderLedgerRowIndex, 1)[0];
    rows.push(...Array.from({ length: 110 }, (_unused, index) => ({
      id: `filler-${index}`,
      status: 'ACTIVE',
      amount: 1,
      description: 'unrelated terminal transaction',
    })), olderLedgerRow);
    transactionOffsets.length = 0;
    const olderLedgerRefund = await sendRefund({
      sessionId: 'session-older-ledger',
      orderCode: olderLedgerOrder.code,
      amount: olderLedgerOrder.total,
    });
    const olderLedgerRefundBody = await olderLedgerRefund.json();
    check(
      olderLedgerRefund.ok && olderLedgerRefundBody.order?.status === 'cancelled' &&
        transactionOffsets.includes(100),
      'refund verification paginates beyond the newest 100 terminal transactions',
      JSON.stringify(transactionOffsets),
    );

    transactionOffsets.length = 0;
    transactionListBehavior = ({ limit, offset }) => ({
      ok: true,
      transactions: Array.from({ length: limit }, (_unused, index) => ({
        id: `cap-${offset + index}`,
        status: 'ACTIVE',
        amount: 1,
        description: 'unrelated terminal transaction',
      })),
    });
    const refundCallsBeforeLedgerCap = refundCalls;
    const cappedLedgerRefund = await sendRefund({ sessionId: 'missing-beyond-ledger-cap', amount: 1 });
    const cappedLedgerBody = await cappedLedgerRefund.json();
    check(
      cappedLedgerRefund.status === 409 && cappedLedgerBody.error?.includes('محدوده امن') &&
        transactionOffsets.length === 100 && transactionOffsets.at(-1) === 9900 &&
        refundCalls === refundCallsBeforeLedgerCap,
      'refund matching stops at 100 ledger pages and requests manual review without issuing a refund',
      JSON.stringify({ pages: transactionOffsets.length, lastOffset: transactionOffsets.at(-1), error: cappedLedgerBody.error }),
    );

    transactionOffsets.length = 0;
    transactionListBehavior = ({ limit }) => ({
      ok: true,
      transactions: Array.from({ length: limit }, (_unused, index) => ({
        id: `stuck-page-${index}`,
        status: 'ACTIVE',
        amount: 1,
        description: 'unrelated terminal transaction',
      })),
    });
    const repeatedLedgerRefund = await sendRefund({ sessionId: 'missing-from-repeated-page', amount: 1 });
    const repeatedLedgerBody = await repeatedLedgerRefund.json();
    check(
      repeatedLedgerRefund.status === 409 && !repeatedLedgerBody.error?.includes('محدوده امن') &&
        transactionOffsets.length === 2 && transactionOffsets[0] === 0 && transactionOffsets[1] === 100,
      'refund matching detects a repeated ledger page instead of scanning it 100 times',
      JSON.stringify(transactionOffsets),
    );
    transactionListBehavior = null;

    const orderIdempotencyKey = crypto.randomUUID();
    const stockBeforeIdempotentOrder = dbStore.getProduct(database, product.slug).stock;
    const [firstOrderResponse, replayOrderResponse] = await Promise.all([
      sendCheckoutOrder(orderIdempotencyKey),
      sendCheckoutOrder(orderIdempotencyKey),
    ]);
    const [firstOrderBody, replayOrderBody] = await Promise.all([
      firstOrderResponse.json(),
      replayOrderResponse.json(),
    ]);
    const storedIdempotentOrder = dbStore.getOrderById(database, orderIdempotencyKey);
    const stockAfterIdempotentOrder = dbStore.getProduct(database, product.slug).stock;
    check(
      firstOrderResponse.ok && replayOrderResponse.ok &&
        firstOrderBody.order?.code === replayOrderBody.order?.code &&
        [firstOrderBody.duplicate, replayOrderBody.duplicate].filter(Boolean).length === 1 &&
        storedIdempotentOrder?.customerId === checkoutCustomerId,
      'cross-tab order replays share one server idempotency key and the same order',
      JSON.stringify({ first: firstOrderBody, replay: replayOrderBody }),
    );
    check(
      stockAfterIdempotentOrder === (stockBeforeIdempotentOrder >= 0 ? stockBeforeIdempotentOrder - 1 : stockBeforeIdempotentOrder) &&
        !Object.hasOwn(storedIdempotentOrder || {}, 'token') &&
        database.prepare('SELECT token FROM orders WHERE id = ?').get(orderIdempotencyKey)?.token === '',
      'an idempotent replay reserves stock once and new orders mint no legacy bearer token',
    );
    checkoutCustomerId = 'different-shopper';
    const foreignIdempotencyReplay = await sendCheckoutOrder(orderIdempotencyKey);
    check(foreignIdempotencyReplay.status === 409, 'an idempotency key cannot reveal another customer’s order');

    const contestedIdempotencyKey = crypto.randomUUID();
    const stockBeforeContestedIdempotency = dbStore.getProduct(database, product.slug).stock;
    const [contestedA, contestedB] = await Promise.all([
      sendCheckoutOrder(contestedIdempotencyKey, 'customer-race-a'),
      sendCheckoutOrder(contestedIdempotencyKey, 'customer-race-b'),
    ]);
    const [contestedBodyA, contestedBodyB] = await Promise.all([contestedA.json(), contestedB.json()]);
    const contestedOrder = dbStore.getOrderById(database, contestedIdempotencyKey);
    const contestedSuccessIndex = [contestedA, contestedB].findIndex((response) => response.status === 200);
    check(
      [contestedA.status, contestedB.status].filter((status) => status === 200).length === 1 &&
        [contestedA.status, contestedB.status].filter((status) => status === 409).length === 1 &&
        contestedOrder?.customerId === (contestedSuccessIndex === 0 ? 'customer-race-a' : 'customer-race-b') &&
        !('order' in (contestedSuccessIndex === 0 ? contestedBodyB : contestedBodyA)),
      'simultaneous customers competing for one idempotency key produce one owner and no foreign order disclosure',
      JSON.stringify([contestedA.status, contestedB.status]),
    );
    check(
      dbStore.getProduct(database, product.slug).stock ===
        (stockBeforeContestedIdempotency >= 0 ? stockBeforeContestedIdempotency - 1 : stockBeforeContestedIdempotency),
      'a different-customer idempotency conflict does not reserve inventory a second time',
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

/* Static guards for UI-side fixes that are intentionally kept in their
 * React components rather than duplicated as test-only implementations. */
{
  const source = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
  const shopContext = source('src/shop/ShopContext.jsx');
  check(
    shopContext.includes('const latestCart = latestCartForMutation();') &&
      shopContext.includes('reconcileCart(latestCart, latestProducts'),
    'availability refresh reconciles the latest cross-tab cart at response time',
  );
  check(
    !shopContext.includes(".catch(() => 'offline')") && shopContext.includes('.catch(() => null)'),
    'a payment metadata transport failure is not cached as an offline provider',
  );

  const checkout = source('src/pages/ShopCheckout.jsx');
  check(checkout.includes('if (submitLock.current) return;'), 'checkout ignores same-tick duplicate submissions');
  check(
    checkout.includes('checkoutOrderId(orderIntent)') && checkout.includes('idempotencyKey') &&
      checkout.includes('clearCheckoutOrderId(idempotencyKey)'),
    'checkout sends and clears a cross-tab-safe server idempotency key',
  );
  check(checkout.includes('if (!leavingCheckout)') && checkout.includes('window.location.assign(data.payment.payUrl)'), 'successful navigation keeps the checkout submission locked');

  const layout = source('src/components/Layout.jsx');
  check(layout.includes('className="skip-link" href="#main-content"'), 'keyboard users get a skip-to-content link');
  check(layout.includes('onKeyDown={trapMobileMenuFocus}') && layout.includes('last.focus()'), 'the mobile drawer traps keyboard focus');
  check(layout.includes('burgerRef.current?.focus()'), 'closing the mobile drawer restores focus to its trigger');

  const orderPage = source('src/pages/ShopOrder.jsx');
  check(orderPage.includes("params.get('gateway') === 'error'") && orderPage.includes('role="alert"'), 'gateway creation failures and retry errors are visible to the customer');
  check(orderPage.includes("clean.delete('token')") && orderPage.includes('replace: true'), 'legacy bearer tokens are removed from the browser URL and history');
  check(orderPage.includes('setPayError(data.error || t('), 'payment retry errors are not silently swallowed');
  check(
    orderPage.includes('if (res.status === 401)') && orderPage.includes("setState('unauthenticated')") &&
      orderPage.includes('const loginHref = `/shop/login?next=${encodeURIComponent(loginNext)}`'),
    'Pay Now session expiry restores the login flow with the exact order URL as next',
  );
  check(
    orderPage.includes("const orderPaid = ['paid', 'shipped', 'delivered']") &&
      orderPage.includes('<Icons.clock size={40} />') && orderPage.includes('orderPaid && isNew'),
    'failed and unpaid orders use pending/cancelled hero chrome instead of a success check',
  );
  check(
    orderPage.includes("order.status === 'pending_payment' && paymentProvider !== 'offline'") && orderPage.includes('const payLock = useRef(false)'),
    'pending orders keep Pay Now available when metadata is unknown and ignore same-tick duplicate clicks',
  );

  const authPage = source('src/pages/ShopAuth.jsx');
  check(
    authPage.includes('const actionLock = useRef(false)') && authPage.includes('if (!beginBusyAction()) return;'),
    'authentication submissions use a synchronous lock for all async steps',
  );

  const productPage = source('src/pages/ShopProduct.jsx');
  check(productPage.includes('Number(p.stock) > 0 && Number(p.stock) <= 10'), 'unlimited inventory is not mislabeled as low stock');

  const editors = source('src/admin/editors.jsx');
  check(editors.includes("holder.innerHTML = sanitizeHtml(html || '')"), 'rich-text statistics measure sanitized markup');

  const adminPayment = source('src/admin/shopTabs.jsx');
  const secretFields = adminPayment.match(/type="password"/g) || [];
  check(secretFields.length >= 3, 'payment merchant, access-token and SMS API-key fields mask secrets', String(secretFields.length));
}

console.log(`${pass}/${pass + fail}`);
if (fail) process.exitCode = 1;
