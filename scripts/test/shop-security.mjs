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
import { isTrustedCallbackBase, safeOrigin } from '../../server/siteOrigin.js';
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
  const allowlisted = { NODE_ENV: 'production', TRUSTED_HOSTS: 'shop.example.test' };
  check(safeOrigin(req('shop.example.test'), '', allowlisted) === 'https://shop.example.test', 'trusted-host-only production config resolves the matching HTTPS origin');
  check(safeOrigin(req('attacker.example'), '', allowlisted) === '', 'a non-allowlisted production Host is refused');
  check(safeOrigin(req('shop.example.test', 'http'), '', allowlisted) === '', 'production never builds callbacks over HTTP');
  const development = { NODE_ENV: 'development' };
  check(safeOrigin(req('localhost:4175', 'http'), '', development) === 'http://localhost:4175', 'local development may use its validated request origin');
  check(!isTrustedCallbackBase('https://shop.example.test/path', req('shop.example.test'), pinned), 'callback settings cannot contain a path');
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
  const router = createShopRouter({
    database,
    requireAuth: (_req, _res, next) => next(),
    rateLimiter: { check: permit, reserve: permit },
    transactionLister: async () => ({ ok: true, transactions: rows }),
    refundCreator: async () => { refundCalls += 1; return { ok: true, id: 'refund-ok' }; },
  });
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const sendRefund = (body) => fetch(`${origin}/api/shop-admin/payment/refunds`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  try {
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

  const checkout = source('src/pages/ShopCheckout.jsx');
  check(checkout.includes('if (submitLock.current) return;'), 'checkout ignores same-tick duplicate submissions');
  check(checkout.includes('if (!leavingCheckout)') && checkout.includes('window.location.assign(data.payment.payUrl)'), 'successful navigation keeps the checkout submission locked');

  const layout = source('src/components/Layout.jsx');
  check(layout.includes('className="skip-link" href="#main-content"'), 'keyboard users get a skip-to-content link');
  check(layout.includes('onKeyDown={trapMobileMenuFocus}') && layout.includes('last.focus()'), 'the mobile drawer traps keyboard focus');
  check(layout.includes('burgerRef.current?.focus()'), 'closing the mobile drawer restores focus to its trigger');

  const orderPage = source('src/pages/ShopOrder.jsx');
  check(orderPage.includes("params.get('gateway') === 'error'") && orderPage.includes('role="alert"'), 'gateway creation failures and retry errors are visible to the customer');
  check(orderPage.includes("clean.delete('token')") && orderPage.includes('replace: true'), 'legacy bearer tokens are removed from the browser URL and history');
  check(orderPage.includes('setPayError(data.error || t('), 'payment retry errors are not silently swallowed');

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
