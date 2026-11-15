/* ==========================================================================
   Behavioural regression checks against a real running server.

   These are not security tests — they guard against the kind of bug that
   quietly costs the business a customer:

   1. Rate limiters must charge for WORK DONE, not for attempts. Counting
      rejected requests meant five mistyped phone numbers locked a real shopper
      out of checkout for ten minutes.
   2. Orders and comments must not share a bucket. They did, so asking a few
      questions on product pages made it impossible to buy anything.
   3. A 429 must be distinguishable by the client, or the UI can only show a
      generic "server error" and the visitor has no idea to wait.
   4. Upload failures must be 4xx with a reason, not 500 "internal error".
   5. Inventory must balance across the order lifecycle.

   Run directly:  node scripts/test/behaviour.mjs
   ========================================================================== */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRateLimiter, rateLimitDefaults } from '../../server/rateLimits.js';
import { CONTENT_REVISION_HEADER, parseContentRevision } from '../../shared/contentRevision.js';
import * as dbStore from '../../server/db.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

const PORT = 8977;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ky-behaviour-test-'));
const DB = path.join(DATA_DIR, 'behaviour.db');
/* Initialize through the production SQLite APIs. The server will therefore
   see an established, complete store without any mutable JSON fixture. */
const fixtureDatabase = await dbStore.openDB(DB);
dbStore.initializeStore(fixtureDatabase, { freshInstall: true });
fixtureDatabase.close();

let pass = 0;
let fail = 0;
const check = (ok, name, detail = '') => {
  if (ok) pass += 1;
  else {
    fail += 1;
    console.log(`LEAK ${name}${detail ? ' — ' + detail : ''}`);
  }
};

let server;
const start = async () => {
  server = spawn('node', ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR,
      UPLOAD_DIR: path.join(DATA_DIR, 'uploads'),
      DB_FILE: DB,
      NODE_ENV: 'development',
      PUBLIC_ORIGIN: BASE,
      /* Reach selected 429 paths quickly while leaving enough order slots for
         the many independent lifecycle fixtures in this one-process suite. */
      RL_MAX_MESSAGE: '5',
      RL_MAX_COMMENT: '5',
      RL_MAX_ORDER: '20',
      RL_MAX_PAYMENT_RETRY: '3',
      RL_MAX_PAYMENT_CALLBACK: '2',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 120; i += 1) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
};

/* Checkout now requires a signed-in customer, so every order below rides on
   a session cookie. It is set once, after registration, and attached by
   default — the alternative was threading a header through forty calls. */
let shopperCookie = '';
let mappedCallbackUrl = '';
let reversalFixture = null;

const jpost = (url, body, headers = {}) =>
  fetch(BASE + url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: BASE,
      ...(shopperCookie ? { Cookie: shopperCookie } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });

const CUSTOMER = {
  name: 'تست کاربر',
  phone: '09121234567',
  city: 'تهران',
  address: 'خیابان آزادی پلاک ۱۲۳ واحد ۴',
};

try {
  const publishedLimits = Object.fromEntries(
    Object.entries(rateLimitDefaults({}).rules).map(([kind, rule]) => [kind, rule.max]),
  );
  const conservativeLimits = {
    message: 5,
    comment: 5,
    order: 12,
    paymentRetry: 5,
    paymentCallback: 12,
    adminLogin: 8,
    otpPhone: 5,
    otpIp: 30,
    customerLogin: 10,
    customerLoginIp: 30,
    register: 40,
  };
  check(
    JSON.stringify(publishedLimits) === JSON.stringify(conservativeLimits),
    'published rate-limit defaults remain at the restored conservative ceilings',
    JSON.stringify(publishedLimits),
  );

  const reservationSettings = {
    enabled: true,
    rules: { customerLogin: { max: 2, windowMs: 60_000 } },
  };
  const reservationDbPath = path.join(DATA_DIR, 'shared-rate-limits.db');
  const reservationDbA = await dbStore.openDB(reservationDbPath);
  dbStore.setSetting(reservationDbA, 'security.rateLimits', reservationSettings);
  const reservationDbB = await dbStore.openDB(reservationDbPath);
  const limiterHashSecret = 'shared-rate-limit-test-secret-0123456789abcdef';
  const limiterA = createRateLimiter({
    database: reservationDbA,
    store: dbStore,
    hashSecret: limiterHashSecret,
  });
  const limiterB = createRateLimiter({
    database: reservationDbB,
    store: dbStore,
    hashSecret: limiterHashSecret,
  });
  const reservedA = limiterA.reserve('customerLogin', 'phone');
  const reservedB = limiterB.reserve('customerLogin', 'phone');
  check(
    !reservedA.limited && !reservedB.limited && limiterA.reserve('customerLogin', 'phone').limited,
    'in-flight password checks share one SQLite ceiling across Passenger workers',
  );
  reservedA.finish(false);
  limiterA.clear('customerLogin', 'phone');
  const reservedC = limiterA.reserve('customerLogin', 'phone');
  check(
    !reservedC.limited && limiterB.reserve('customerLogin', 'phone').limited,
    'clearing completed failures cannot erase another worker’s in-flight password check',
  );
  reservedB.finish(false);
  reservedC.finish(false);
  limiterA.record('customerLogin', 'completed-phone');
  limiterB.record('customerLogin', 'completed-phone');
  check(
    limiterA.check('customerLogin', 'completed-phone').limited,
    'completed rate-limit hits are visible to every process, not multiplied per worker',
  );
  const storedBucket = reservationDbA.prepare(
    "SELECT bucket_hash, bucket_version FROM rate_limit_hits WHERE kind = 'customerLogin' LIMIT 1",
  ).get();
  const expectedHmac = crypto
    .createHmac('sha256', limiterHashSecret)
    .update('khyeast-rate-limit-bucket:v1\u0000')
    .update('customerLogin')
    .update('\u0000')
    .update('completed-phone')
    .digest('hex');
  const reversibleHash = crypto
    .createHash('sha256')
    .update('customerLogin\u0000completed-phone')
    .digest('hex');
  check(
    storedBucket?.bucket_hash === expectedHmac &&
      storedBucket.bucket_hash !== reversibleHash &&
      Number(storedBucket.bucket_version) === 2,
    'rate-limit identifiers use the shared server secret instead of a reversible plain hash',
    JSON.stringify(storedBucket),
  );

  let saturatedReadOnly = false;
  reservationDbA.exec('BEGIN IMMEDIATE');
  try {
    saturatedReadOnly = limiterB.reserve('customerLogin', 'completed-phone').limited;
  } catch {
    saturatedReadOnly = false;
  } finally {
    reservationDbA.exec('ROLLBACK');
  }
  check(
    saturatedReadOnly,
    'an already-limited request stays read-only while another SQLite writer holds the lock',
  );
  limiterA.clearAll();
  reservationDbB.close();
  reservationDbA.close();

  await start();

  const login = await jpost('/api/auth/login', { user: 'admin', pass: 'khyeast-1404' });
  const adminCookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const auth = { Cookie: adminCookie };
  check(Boolean(adminCookie), 'the admin test session is cookie-authenticated');

  /* Build one immutable order/authority mapping directly in the throwaway DB.
     Status=NOK lets the callback exercise routing and limiting without any
     network request to the real gateway. */
  const callbackCode = `KY-CALLBACK-${Date.now()}`;
  const callbackAuthority = `A${crypto.randomBytes(18).toString('hex').slice(0, 35)}`;
  const callbackOrderId = crypto.randomUUID();
  const fixtureDb = await dbStore.openDB(DB);
  dbStore.insertOrder(fixtureDb, {
    id: callbackOrderId,
    code: callbackCode,
    token: crypto.randomBytes(20).toString('hex'),
    customer: {},
    subtotal: 1000,
    shipping: 0,
    total: 1000,
    currency: 'IRR',
    status: 'pending_payment',
    provider: 'zarinpal',
    payAuthority: callbackAuthority,
    payRef: null,
    adminNote: '',
    at: new Date().toISOString(),
    paidAt: null,
    items: [],
  });

  reversalFixture = {
    id: crypto.randomUUID(),
    code: `KY-REVERSAL-${Date.now()}`,
    token: crypto.randomBytes(20).toString('hex'),
    main: `A${crypto.randomBytes(18).toString('hex').slice(0, 35)}`,
    extra: `A${crypto.randomBytes(18).toString('hex').slice(0, 35)}`,
  };
  dbStore.insertOrder(fixtureDb, {
    id: reversalFixture.id,
    code: reversalFixture.code,
    token: reversalFixture.token,
    customer: {},
    subtotal: 2000,
    shipping: 0,
    total: 2000,
    currency: 'IRR',
    status: 'paid',
    provider: 'zarinpal',
    payAuthority: reversalFixture.main,
    payRef: 'REF-MAIN',
    adminNote: '',
    at: new Date().toISOString(),
    paidAt: new Date().toISOString(),
    items: [],
  });
  dbStore.recordOrderPaymentAttempt(fixtureDb, reversalFixture.id, {
    authority: reversalFixture.extra,
    provider: 'zarinpal',
  });
  dbStore.updateOrderPaymentAttempt(fixtureDb, reversalFixture.id, reversalFixture.extra, {
    status: 'reversing',
    refId: 'REF-EXTRA',
    verifiedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    reversalStartedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
  });
  fixtureDb.close();
  mappedCallbackUrl = `/api/shop-pay/zarinpal/callback?code=${encodeURIComponent(callbackCode)}&Authority=${encodeURIComponent(callbackAuthority)}&Status=NOK`;

  /* Sign up the shopper whose orders the rest of this file places. The
     verification code is read back out of the SMS log, exactly as a
     customer reads it off their phone — no test-only shortcut exists in the
     server, and adding one would be a hole in production. */
  {
    await jpost('/api/account/otp', { phone: CUSTOMER.phone, purpose: 'register' });
    const smsLog = await (await fetch(`${BASE}/api/shop-admin/sms`, { headers: auth })).json();
    const code = (smsLog.log || []).find((l) => l.kind === 'otp')?.text.match(/(\d{5})/)?.[1];
    const verified = await (await jpost('/api/account/otp/verify', { phone: CUSTOMER.phone, code, purpose: 'register' })).json();
    const reg = await jpost('/api/account/register', {
      ticket: verified.ticket,
      password: 'behaviour-test-1404',
      name: CUSTOMER.name,
    });
    shopperCookie = (reg.headers.get('set-cookie') || '').split(';')[0];
    check(Boolean(shopperCookie), 'the test shopper has a session', `register returned ${reg.status}`);
  }

  const issuedAttemptDelete = await fetch(`${BASE}/api/shop-admin/orders/${callbackOrderId}`, {
    method: 'DELETE',
    headers: auth,
  });
  const issuedAttemptDeleteBody = await issuedAttemptDelete.json();
  check(
    issuedAttemptDelete.status === 409 && issuedAttemptDeleteBody.code === 'payment-history-protected',
    'Admin cannot delete even an issued authority that may still be paid later',
    JSON.stringify(issuedAttemptDeleteBody),
  );
  const archiveIssued = await fetch(`${BASE}/api/shop-admin/orders/${callbackOrderId}`, {
    method: 'PATCH',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ archived: true }),
  });
  const archivedOrders = await (await fetch(`${BASE}/api/shop-admin`, { headers: auth })).json();
  check(
    archiveIssued.ok && archivedOrders.orders.find((order) => order.id === callbackOrderId)?.archived,
    'an undeletable payment order can be reversibly archived without removing its mapping',
  );
  await fetch(`${BASE}/api/shop-admin/orders/${callbackOrderId}`, {
    method: 'PATCH',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ archived: false }),
  });

  const wrongCallbackUrl = mappedCallbackUrl.replace(/Authority=[^&]+/, `Authority=A${'f'.repeat(35)}`);
  const wrongCallbackStatuses = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    wrongCallbackStatuses.push((await fetch(BASE + wrongCallbackUrl, { redirect: 'manual' })).status);
  }
  const firstMappedCallback = await fetch(BASE + mappedCallbackUrl, { redirect: 'manual' });
  const secondMappedCallback = await fetch(BASE + mappedCallbackUrl, { redirect: 'manual' });
  const limitedMappedCallback = await fetch(BASE + mappedCallbackUrl, { redirect: 'manual' });
  check(
    wrongCallbackStatuses.every((status) => status === 302) &&
      firstMappedCallback.status === 302 && secondMappedCallback.status === 302,
    'unknown callback probes cannot consume a mapped authority’s legitimate allowance',
    JSON.stringify({ wrongCallbackStatuses, first: firstMappedCallback.status, second: secondMappedCallback.status }),
  );
  check(
    limitedMappedCallback.status === 429 && Number(limitedMappedCallback.headers.get('retry-after')) > 0,
    'the dedicated mapped payment-callback bucket returns an actionable 429',
    `got ${limitedMappedCallback.status}`,
  );

  const adminOrdersBeforeReverse = await (await fetch(`${BASE}/api/shop-admin`, { headers: auth })).json();
  const reversalAdminOrder = adminOrdersBeforeReverse.orders.find((order) => order.id === reversalFixture.id);
  check(
    reversalAdminOrder?.paymentAttempts?.length === 2 &&
      reversalAdminOrder.paymentAttempts.some((attempt) =>
        attempt.authority === reversalFixture.extra && attempt.status === 'reversing'),
    'Admin order responses expose the private per-attempt payment history',
  );
  const publicReversalAnon = await fetch(
    `${BASE}/api/shop-public/orders/${encodeURIComponent(reversalFixture.code)}?token=${encodeURIComponent(reversalFixture.token)}`,
  );
  const publicReversalForeign = await fetch(
    `${BASE}/api/shop-public/orders/${encodeURIComponent(reversalFixture.code)}`,
    { headers: { Cookie: shopperCookie } },
  );
  check(publicReversalAnon.status === 401, 'a legacy tracking token in the URL no longer grants order access');
  check(publicReversalForeign.status === 404, 'an authenticated customer cannot read an unowned order by code');
  const settledRefreshUrl =
    `/api/shop-pay/zarinpal/callback?code=${encodeURIComponent(reversalFixture.code)}` +
    `&Authority=${encodeURIComponent(reversalFixture.main)}&Status=OK`;
  const settledRefreshes = [];
  for (let refresh = 0; refresh < 15; refresh += 1) {
    const response = await fetch(BASE + settledRefreshUrl, { redirect: 'manual' });
    settledRefreshes.push({ status: response.status, location: response.headers.get('location') || '' });
  }
  check(
    settledRefreshes.every(({ status, location }) => status === 302 && /[?&]pay=ok/.test(location)),
    'refreshing an already-settled callback stays idempotent and never spends callback quota',
    JSON.stringify(settledRefreshes.slice(-2)),
  );
  const protectedDelete = await fetch(`${BASE}/api/shop-admin/orders/${reversalFixture.id}`, {
    method: 'DELETE',
    headers: auth,
  });
  const protectedDeleteBody = await protectedDelete.json();
  check(
    protectedDelete.status === 409 && protectedDeleteBody.code === 'payment-history-protected',
    'Admin cannot delete an order whose settled attempt evidence must be retained',
    JSON.stringify(protectedDeleteBody),
  );

  const attemptReverse = await fetch(
    `${BASE}/api/shop-admin/orders/${reversalFixture.id}/payment-attempts/${encodeURIComponent(reversalFixture.extra)}/reverse`,
    { method: 'POST', headers: auth },
  );
  const attemptReverseBody = await attemptReverse.json();
  const adminOrdersAfterReverse = await (await fetch(`${BASE}/api/shop-admin`, { headers: auth })).json();
  const failedAttempt = adminOrdersAfterReverse.orders
    .find((order) => order.id === reversalFixture.id)
    ?.paymentAttempts?.find((attempt) => attempt.authority === reversalFixture.extra);
  check(
    attemptReverse.status === 409 && failedAttempt?.status === 'reversal_failed' &&
      failedAttempt.reversalStartedAt === null && failedAttempt.lastError,
    'the per-attempt Admin action reclaims a stale lease and leaves a visible terminal failure',
    JSON.stringify({ response: attemptReverseBody, attempt: failedAttempt }),
  );
  const hideAttentionOrder = await fetch(`${BASE}/api/shop-admin/orders/${reversalFixture.id}`, {
    method: 'PATCH',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ archived: true }),
  });
  check(
    hideAttentionOrder.status === 409,
    'an unresolved payment alert cannot be hidden in the archive',
    String(hideAttentionOrder.status),
  );

  /* The rate-limit checks below place many orders. They use their own product
     with unlimited stock (-1) so a 400 can only ever mean "rate limited",
     never "sold out" — otherwise a stock failure would masquerade as a
     limiter bug. */
  const RL_SLUG = 'rl-test';
  const SLUG = 'inv-test';

  /* PUT /api/shop-admin/products REPLACES the whole catalogue, so every write
     has to carry both fixtures and the revision of the snapshot it follows. */
  let directContentRevision = null;
  const putProducts = async (invStock) => {
    if (directContentRevision === null) {
      const current = await fetch(`${BASE}/api/shop-admin/products`, { headers: auth });
      directContentRevision = parseContentRevision(current.headers.get(CONTENT_REVISION_HEADER));
    }
    const response = await fetch(`${BASE}/api/shop-admin/products`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        [CONTENT_REVISION_HEADER]: String(directContentRevision),
        ...auth,
      },
      body: JSON.stringify({
        products: [
          { slug: RL_SLUG, title: 'تست محدودیت', price: 100000, stock: -1, active: true },
          { slug: SLUG, title: 'تست موجودی', price: 100000, stock: invStock, active: true },
        ],
      }),
    });
    if (response.ok) {
      directContentRevision = parseContentRevision(response.headers.get(CONTENT_REVISION_HEADER));
    }
    return response;
  };

  /* ---- 1. inventory balances across the order lifecycle ------------------
     Runs FIRST: later checks deliberately exhaust the order rate limit, which
     would otherwise make these unreachable. */
  const stockOf = async () => {
    const all = await (await fetch(`${BASE}/api/shop-products`)).json();
    return all.products.find((p) => p.slug === SLUG)?.stock;
  };
  const setStock = async (next) => {
    const current = await stockOf();
    if (current === undefined) return putProducts(next); // creates both fixtures
    return fetch(`${BASE}/api/shop-admin/products/${SLUG}/stock`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ stock: next, expectedStock: current }),
    });
  };
  const orderIdFor = async (code) => {
    const admin = await (await fetch(`${BASE}/api/shop-admin`, { headers: auth })).json();
    return admin.orders.find((o) => o.code === code)?.id;
  };
  const setStatus = (id, status) =>
    fetch(`${BASE}/api/shop-admin/orders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ status }),
    });
  const orderLogs = async (ref) => {
    const payload = await (await fetch(`${BASE}/api/shop-admin/sms`, { headers: auth })).json();
    return (payload.log || []).filter((row) => row.kind === 'order' && row.ref === ref);
  };
  const shipmentLogs = async (ref) => {
    const payload = await (await fetch(`${BASE}/api/shop-admin/sms`, { headers: auth })).json();
    return (payload.log || []).filter((row) => row.kind === 'shipped' && row.ref === ref);
  };
  const waitForOrderLogs = async (ref, count) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const rows = await orderLogs(ref);
      if (rows.length >= count) return rows;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return orderLogs(ref);
  };
  const waitForShipmentLogs = async (ref, count) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const rows = await shipmentLogs(ref);
      if (rows.length >= count) return rows;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return shipmentLogs(ref);
  };

  /* The order message is enabled but must wait for payment: gateway verification
     online, or the first Admin-confirmed `paidAt` for an offline order. */
  const smsSettings = await fetch(`${BASE}/api/shop-admin/sms`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ provider: 'log', onOrder: true, onStatus: true, statusTemplateId: 24680 }),
  });
  const savedSms = await smsSettings.json();
  check(smsSettings.ok && savedSms.sms?.statusTemplateId === 24680, 'shipment SMS template id saves through the admin API');

  /* Public bootstrap stays bounded: route-specific payment metadata and
     product-scoped comments are fetched only where they are consumed. */
  const publicBootstrap = await (await fetch(`${BASE}/api/shop-public`)).json();
  check(
    Boolean(publicBootstrap.display) && !Object.hasOwn(publicBootstrap, 'comments') && !Object.hasOwn(publicBootstrap, 'paymentProvider'),
    'shop bootstrap does not ship comments or payment metadata globally',
    JSON.stringify(Object.keys(publicBootstrap)),
  );
  const publicPayment = await (await fetch(`${BASE}/api/shop-public/payment`)).json();
  check(typeof publicPayment.paymentProvider === 'string', 'checkout payment identity has a route-local endpoint');

  /* Order creation is a cookie-authenticated state change; a foreign browser
     origin must not be able to reserve inventory on the customer's behalf. */
  await setStock(5);
  const csrfOrder = await jpost('/api/shop-public/orders', {
    items: [{ slug: SLUG, qty: 1 }], customer: CUSTOMER,
  }, { Origin: 'https://evil.example' });
  check(csrfOrder.status === 403, 'cross-origin order creation is refused');
  check((await stockOf()) === 5, 'CSRF-rejected order creation leaves inventory untouched');

  /* Duplicate slugs are one inventory claim, not independent lines. */

  /* JSON values that only become integers through JavaScript coercion are not
     cart quantities. Reject them before either stock or rate-limit state moves. */
  for (const qty of [[1], true, '3']) {
    const response = await jpost('/api/shop-public/orders', {
      items: [{ slug: SLUG, qty }],
      customer: CUSTOMER,
    });
    const body = await response.json();
    check(
      response.status === 400 && body.error === 'invalid quantity',
      `coercible quantity ${JSON.stringify(qty)} is refused`,
      `got ${response.status}: ${JSON.stringify(body)}`,
    );
  }
  check((await stockOf()) === 5, 'refused coercible quantities do not reserve inventory');

  const commentsDb = await dbStore.openDB(DB);
  for (let index = 0; index < 7; index += 1) {
    dbStore.insertComment(commentsDb, {
      id: `page-${index}`,
      slug: RL_SLUG,
      name: `کاربر ${index}`,
      text: `دیدگاه صفحه‌بندی ${index}`,
      at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      approved: true,
    });
  }
  dbStore.insertComment(commentsDb, {
    id: 'page-hidden', slug: RL_SLUG, name: 'پنهان', text: 'تأیید نشده',
    at: new Date(Date.UTC(2026, 0, 2)).toISOString(), approved: false,
  });
  dbStore.insertComment(commentsDb, {
    id: 'page-other', slug: SLUG, name: 'محصول دیگر', text: 'نباید نشت کند',
    at: new Date(Date.UTC(2026, 0, 3)).toISOString(), approved: true,
  });
  const publicCommentIndex = commentsDb.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_comments_public_page'",
  ).get();
  commentsDb.close();
  check(Boolean(publicCommentIndex), 'public comments have a composite slug/approval/cursor index');

  const commentPage = async (cursor = '') => {
    const query = new URLSearchParams({ slug: RL_SLUG, limit: '3' });
    if (cursor) query.set('cursor', cursor);
    const response = await fetch(`${BASE}/api/shop-public/comments?${query}`);
    return { response, body: await response.json() };
  };
  const pageOne = await commentPage();
  const pageTwo = await commentPage(pageOne.body.nextCursor);
  const pageThree = await commentPage(pageTwo.body.nextCursor);
  const pagedIds = [pageOne, pageTwo, pageThree].flatMap((page) => page.body.comments || []).map((comment) => comment.id);
  check(
    pageOne.response.ok && pageTwo.response.ok && pageThree.response.ok &&
      JSON.stringify(pagedIds) === JSON.stringify(['page-6', 'page-5', 'page-4', 'page-3', 'page-2', 'page-1', 'page-0']) &&
      pageOne.body.nextCursor && pageTwo.body.nextCursor && pageThree.body.nextCursor === null,
    'approved comments paginate by one product with a stable bounded cursor',
    JSON.stringify({ pagedIds, cursors: [pageOne.body.nextCursor, pageTwo.body.nextCursor, pageThree.body.nextCursor] }),
  );
  const invalidCommentCursor = await fetch(`${BASE}/api/shop-public/comments?slug=${RL_SLUG}&cursor=not-a-cursor`);
  check(invalidCommentCursor.status === 400, 'malformed public comment cursors are refused');

  const duplicateOversell = await jpost('/api/shop-public/orders', {
    items: [{ slug: SLUG, qty: 5 }, { slug: SLUG, qty: 5 }],
    customer: CUSTOMER,
  });
  check(duplicateOversell.status === 409, 'duplicate cart lines cannot oversell stock', `got ${duplicateOversell.status}`);
  check((await stockOf()) === 5, 'a refused duplicate-line order leaves all stock intact');

  const duplicateValid = await jpost('/api/shop-public/orders', {
    items: [{ slug: SLUG, qty: 2 }, { slug: SLUG, qty: 3 }],
    customer: CUSTOMER,
  });
  check(duplicateValid.ok, 'duplicate lines within stock are merged and accepted', `got ${duplicateValid.status}`);
  if (duplicateValid.ok) {
    const duplicateOrder = (await duplicateValid.json()).order;
    const admin = await (await fetch(`${BASE}/api/shop-admin`, { headers: auth })).json();
    const saved = admin.orders.find((entry) => entry.code === duplicateOrder.code);
    check(saved?.items?.length === 1 && saved.items[0].qty === 5, 'the durable order stores one merged product line');
    check((await stockOf()) === 0, 'merged quantity is deducted exactly once');
    if (saved) await fetch(`${BASE}/api/shop-admin/orders/${saved.id}`, { method: 'DELETE', headers: auth });
    check((await stockOf()) === 5, 'deleting the merged order restores the merged quantity');
  }

  await setStock(10);
  const unverifiedReceiverPhone = '09123334444';
  const invOrder = await jpost('/api/shop-public/orders', {
    items: [{ slug: SLUG, qty: 3 }],
    customer: { ...CUSTOMER, phone: unverifiedReceiverPhone },
  });
  check(invOrder.ok, 'inventory test order placed', `status ${invOrder.status}`);

  const { order } = await invOrder.json();
  const trackedResponse = await fetch(`${BASE}/api/shop-public/orders/${encodeURIComponent(order.code)}`, {
    headers: { Cookie: shopperCookie },
  });
  const trackedOrder = await trackedResponse.json();
  const publicCustomerFields = new Set(['name', 'phone', 'city', 'address', 'postal', 'note']);
  check(
    trackedResponse.ok && trackedOrder.order?.customer?.phone === unverifiedReceiverPhone &&
      Object.keys(trackedOrder.order.customer).every((field) => publicCustomerFields.has(field)) &&
      !Object.hasOwn(trackedOrder.order.customer, 'addressId') &&
      !Object.hasOwn(trackedOrder.order, 'token'),
    'session-owned tracking allowlists the receiver snapshot without internal ids or bearer tokens',
    JSON.stringify(trackedOrder.order?.customer),
  );
  check((await orderLogs(order.code)).length === 0, 'creating an unpaid order does not send the order-registered SMS');
  check((await stockOf()) === 7, 'ordering 3 of 10 leaves 7');

  const id = await orderIdFor(order.code);

  await setStatus(id, 'paid');
  const paidOrderRows = await waitForOrderLogs(order.code, 1);
  check(paidOrderRows.length === 1, 'the first Admin-confirmed offline payment sends the order SMS');
  check(
    paidOrderRows[0]?.text.includes(`/shop/order/${order.code}`) &&
      !paidOrderRows[0]?.text.includes('token='),
    'the offline-payment confirmation links to the session-owned order page without a token',
  );
  check(
    paidOrderRows[0]?.phone === '989121234567',
    'the private tracking SMS goes to the OTP-verified account, not the typed receiver',
    String(paidOrderRows[0]?.phone || ''),
  );
  await setStatus(id, 'paid');
  check((await orderLogs(order.code)).length === 1, 'saving the paid offline order again does not duplicate its confirmation');
  await setStatus(id, 'delivered');
  check((await shipmentLogs(order.code)).length === 0, 'paid and delivered status changes do not send the shipment SMS');
  await setStatus(id, 'shipped');
  const sentRows = await waitForShipmentLogs(order.code, 1);
  check(sentRows.length === 1, 'the first transition into shipped sends one SMS', `got ${sentRows.length}`);
  check(sentRows[0]?.text.includes('ارسال شد'), 'the shipped SMS has the customer-facing shipment text');
  check(
    sentRows[0]?.phone === '989121234567' && sentRows[0]?.phone !== '989123334444',
    'shipment SMS uses the OTP-verified account phone instead of the receiver snapshot',
    String(sentRows[0]?.phone || ''),
  );
  const noteEdit = await fetch(`${BASE}/api/shop-admin/orders/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ adminNote: 'یادداشت داخلی بدون تغییر وضعیت' }),
  });
  check(noteEdit.ok, 'an internal note edit succeeds without changing shipment status');
  await setStatus(id, 'shipped');
  await setStatus(id, 'delivered');
  check((await shipmentLogs(order.code)).length === 1, 'note edits, repeated shipped saves and later statuses do not send another SMS');

  await setStatus(id, 'cancelled');
  check((await stockOf()) === 10, 'cancelling returns the reserved stock');

  /* Cancelling twice must not mint inventory that never existed. */
  await setStatus(id, 'cancelled');
  check((await stockOf()) === 10, 'cancelling twice does not inflate stock');

  /* Un-cancelling must RE-RESERVE. Restoring stock on cancel while never
     taking it back made the status a lie: the order was live again but its
     units counted as sellable, so the shop could oversell them. Deleting that
     order then credited the same units a second time (10 -> 13). */
  await setStatus(id, 'pending_payment');
  check((await stockOf()) === 7, 'un-cancelling an order re-reserves its stock');
  await setStatus(id, 'paid');
  check((await stockOf()) === 7, 'moving between live statuses does not touch stock');
  check((await orderLogs(order.code)).length === 1, 'a later return to paid does not resend the offline-payment SMS');
  await setStatus(id, 'cancelled');
  check((await stockOf()) === 10, 're-cancelling returns the stock again');
  await setStatus(id, 'delivered');
  check((await stockOf()) === 7, 'reviving a cancelled order as delivered also re-reserves');
  await fetch(`${BASE}/api/shop-admin/orders/${id}`, { method: 'DELETE', headers: auth });
  check((await stockOf()) === 10, 'deleting a revived order credits its units exactly once');

  /* Re-reserving can fail: the units may have sold while the order sat
     cancelled. The change must be refused rather than driving stock negative
     or silently flipping the status. */
  await setStock(5);
  const tight = await jpost('/api/shop-public/orders', {
    items: [{ slug: SLUG, qty: 4 }],
    customer: CUSTOMER,
  });
  if (tight.ok) {
    const tid = await orderIdFor((await tight.json()).order.code);
    await setStatus(tid, 'cancelled');
    await setStock(2); // admin lowers the catalogue while the order is cancelled
    const refused = await setStatus(tid, 'paid');
    check(refused.status === 409, 'un-cancelling without stock is refused with 409', `got ${refused.status}`);
    check((await stockOf()) === 2, 'a refused revival leaves stock untouched');
    const admin = await (await fetch(`${BASE}/api/shop-admin`, { headers: auth })).json();
    check(
      admin.orders.find((o) => o.id === tid)?.status === 'cancelled',
      'a refused revival leaves the order cancelled',
    );
    await fetch(`${BASE}/api/shop-admin/orders/${tid}`, { method: 'DELETE', headers: auth });
  }

  /* Saving the CONTENT panel must never write stock. That page loads once and
     then holds its snapshot; orders keep moving stock in the database. Writing
     the snapshot back erased every sale made since the page was opened — a
     customer's order simply vanished from inventory. */
  await setStock(10);
  const snapshotResponse = await fetch(`${BASE}/api/content`);
  const snapshot = await snapshotResponse.json();
  const initialContentRevision = parseContentRevision(snapshotResponse.headers.get(CONTENT_REVISION_HEADER));
  let contentRevision = initialContentRevision;
  const writeContent = async (method, body, revision = contentRevision) => {
    const response = await fetch(`${BASE}/api/content`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...auth,
        ...(revision === null ? {} : { [CONTENT_REVISION_HEADER]: String(revision) }),
      },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      const accepted = parseContentRevision(response.headers.get(CONTENT_REVISION_HEADER));
      if (accepted !== null) contentRevision = accepted;
    }
    return response;
  };
  check(initialContentRevision !== null, 'content GET exposes its coherent SQLite revision', String(initialContentRevision));

  const writeProbeDb = await dbStore.openDB(DB);
  writeProbeDb.exec(`
    CREATE TABLE content_write_probe (kind TEXT NOT NULL);
    CREATE TRIGGER content_write_probe_insert AFTER INSERT ON settings
      WHEN NEW.key = 'shop.display'
      BEGIN INSERT INTO content_write_probe(kind) VALUES ('insert'); END;
    CREATE TRIGGER content_write_probe_update AFTER UPDATE ON settings
      WHEN NEW.key = 'shop.display'
      BEGIN INSERT INTO content_write_probe(kind) VALUES ('update'); END;
  `);

  const patchedLinks = { ...snapshot.links, 'home.cta.primary': '/about?partial=1' };
  const revisionsBeforePatch = dbStore.getContentSectionRevisions(writeProbeDb);
  const contentPatch = await writeContent('PATCH', { changes: { links: patchedLinks } });
  const afterContentPatch = await (await fetch(`${BASE}/api/content`)).json();
  const revisionsAfterPatch = dbStore.getContentSectionRevisions(writeProbeDb);
  const revisedSections = dbStore.CONTENT_SECTIONS.filter(
    (section) => revisionsAfterPatch[section] !== revisionsBeforePatch[section],
  );
  check(
    contentPatch.ok &&
      contentRevision === initialContentRevision + 1 &&
      afterContentPatch.links['home.cta.primary'] === '/about?partial=1' &&
      afterContentPatch.texts['global.company.name'] === snapshot.texts['global.company.name'] &&
      (await stockOf()) === 10 &&
      revisedSections.length === 1 && revisedSections[0] === 'links' &&
      Number(writeProbeDb.prepare('SELECT COUNT(*) AS count FROM content_write_probe').get().count) === 0,
    'a top-level content PATCH advances only its SQLite section and returned revision without touching copy, stock, or shop settings',
    `got ${contentPatch.status}`,
  );

  const staleLinks = { ...snapshot.links, 'home.cta.primary': '/stale-editor' };
  const stalePatch = await writeContent('PATCH', { changes: { links: staleLinks } }, initialContentRevision);
  const stalePatchError = await stalePatch.json();
  const staleFullPut = await writeContent('PUT', snapshot, initialContentRevision);
  const staleFullError = await staleFullPut.json();
  const missingRevisionPut = await writeContent('PUT', afterContentPatch, null);
  const missingRevisionError = await missingRevisionPut.json();
  const afterConflict = await (await fetch(`${BASE}/api/content`)).json();
  check(
    stalePatch.status === 409 && stalePatchError.code === 'content-conflict' &&
      staleFullPut.status === 409 && staleFullError.code === 'content-conflict' &&
      missingRevisionPut.status === 428 && missingRevisionError.code === 'content-revision-required' &&
      afterConflict.links['home.cta.primary'] === '/about?partial=1',
    'stale bucket PATCHes, stale full PUTs and revisionless writes cannot overwrite a newer editor',
    JSON.stringify({
      stalePatch: [stalePatch.status, stalePatchError],
      staleFullPut: [staleFullPut.status, staleFullError],
      missing: [missingRevisionPut.status, missingRevisionError],
    }),
  );

  const revisionBeforeShopNoop = dbStore.getContentMeta(writeProbeDb).revision;
  const unchangedShopPatch = await writeContent('PATCH', { changes: { shop: afterContentPatch.shop } });
  const revisionAfterShopNoop = dbStore.getContentMeta(writeProbeDb).revision;
  const probedShopWrites = Number(
    writeProbeDb.prepare('SELECT COUNT(*) AS count FROM content_write_probe').get().count,
  );
  check(
    unchangedShopPatch.ok &&
      revisionAfterShopNoop === revisionBeforeShopNoop &&
      probedShopWrites === 0,
    'an unchanged shop bucket causes neither an editorial revision nor a settings write',
    JSON.stringify({
      status: unchangedShopPatch.status,
      revisionBeforeShopNoop,
      revisionAfterShopNoop,
      probedShopWrites,
    }),
  );

  writeProbeDb.exec(`
    DROP TRIGGER content_write_probe_insert;
    DROP TRIGGER content_write_probe_update;
    DROP TABLE content_write_probe;
  `);
  writeProbeDb.close();

  const unknownPatch = await fetch(`${BASE}/api/content`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ changes: { executable: 'no' } }),
  });
  check(unknownPatch.status === 400, 'content PATCH refuses unknown top-level buckets');

  /* Brand CRUD is shared content, so the persistence boundary must protect
     every catalogue and shop reference even when a caller bypasses Admin. */
  const brandInUse = snapshot.brands.find((brand) => (
    snapshot.products.some((product) => product.brand === brand.id) ||
    snapshot.shop.products.some((product) => product.brand === brand.id)
  ));
  const brandRemovalWhileUsed = await writeContent('PATCH', {
    changes: { brands: snapshot.brands.filter((brand) => brand.id !== brandInUse?.id) },
  });
  const contentAfterBrandRemovalRefusal = await (await fetch(`${BASE}/api/content`)).json();
  check(
    Boolean(brandInUse) && brandRemovalWhileUsed.status === 400 &&
      contentAfterBrandRemovalRefusal.brands.some((brand) => brand.id === brandInUse.id),
    'a brand referenced by catalogue or shop products cannot be removed through the content API',
    `got ${brandRemovalWhileUsed.status}`,
  );

  const brandBeforeCrud = await (await fetch(`${BASE}/api/content`)).json();
  const managedBrand = {
    id: `behaviour-brand-${Date.now().toString(36)}`,
    fa: 'برند آزمون رفتاری',
    en: 'Behaviour Test Brand',
    tagline: 'Temporary validation fixture',
    image: '/assets/products/dezmaye-gold.webp',
  };
  const addManagedBrand = await writeContent('PATCH', {
    changes: { brands: [...brandBeforeCrud.brands, managedBrand] },
  });
  const afterManagedBrandAdd = await (await fetch(`${BASE}/api/content`)).json();
  check(
    addManagedBrand.ok && afterManagedBrandAdd.brands.some((brand) => brand.id === managedBrand.id),
    'a valid Admin-managed brand is accepted and returned in the shared content state',
    `got ${addManagedBrand.status}`,
  );

  const missingBrandName = await writeContent('PATCH', {
    changes: {
      brands: [...afterManagedBrandAdd.brands, {
        ...managedBrand,
        id: `${managedBrand.id}-missing-name`,
        fa: '',
      }],
    },
  });
  const untrustedBrandImage = await writeContent('PATCH', {
    changes: {
      brands: [...afterManagedBrandAdd.brands, {
        ...managedBrand,
        id: `${managedBrand.id}-untrusted-image`,
        image: 'https://untrusted.example/brand.webp',
      }],
    },
  });
  check(
    missingBrandName.status === 400 && untrustedBrandImage.status === 400,
    'brand writes require both names and an image allowed by the site CSP',
    `name=${missingBrandName.status}, image=${untrustedBrandImage.status}`,
  );

  const removeManagedBrand = await writeContent('PATCH', {
    changes: { brands: afterManagedBrandAdd.brands.filter((brand) => brand.id !== managedBrand.id) },
  });
  const afterManagedBrandRemoval = await (await fetch(`${BASE}/api/content`)).json();
  check(
    removeManagedBrand.ok && !afterManagedBrandRemoval.brands.some((brand) => brand.id === managedBrand.id),
    'an unused brand can be removed from the authoritative list',
    `got ${removeManagedBrand.status}`,
  );

  const representativeRows = snapshot.collections?.salesRepresentatives;
  check(
    Array.isArray(representativeRows) && representativeRows.length === 47 &&
      representativeRows.some((item) => item.city === 'کردکوی' && item.province === 'گلستان'),
    'the supplied domestic-sales worksheet initializes the Persian representative collection',
  );
  const invalidRepresentativeCollections = JSON.parse(JSON.stringify(snapshot.collections));
  invalidRepresentativeCollections.salesRepresentatives[0].latitude = 99;
  const invalidRepresentativePatch = await writeContent('PATCH', {
    changes: { collections: invalidRepresentativeCollections },
  });
  const representativesAfterRefusal = (await (await fetch(`${BASE}/api/content`)).json())
    .collections?.salesRepresentatives;
  check(
    invalidRepresentativePatch.status === 400 && representativesAfterRefusal?.[0]?.latitude !== 99,
    'direct API writes cannot publish out-of-Iran representative markers',
    `got ${invalidRepresentativePatch.status}`,
  );

  /* Gallery media is a same-origin structural collection. Direct API clients
     must not bypass the Admin UI with mixed-content or locale-specific media.
     Old complete snapshots did not have this optional key and remain valid. */
  const legacyWithoutGallery = JSON.parse(JSON.stringify(snapshot));
  delete legacyWithoutGallery.gallery;
  delete legacyWithoutGallery.collections.salesRepresentatives;
  const legacyGalleryPut = await writeContent('PUT', legacyWithoutGallery);
  const afterLegacyGallerySave = await (await fetch(`${BASE}/api/content`)).json();
  check(
    legacyGalleryPut.ok &&
      afterLegacyGallerySave.gallery?.length === snapshot.gallery?.length &&
      afterLegacyGallerySave.collections?.salesRepresentatives?.length === representativeRows.length,
    'an older content client preserves optional gallery and representative collections',
    `got ${legacyGalleryPut.status}`,
  );

  const unsafeGallery = JSON.parse(JSON.stringify(snapshot));
  unsafeGallery.gallery[0].src = 'https://untrusted.example/factory.webp';
  const unsafeGalleryPut = await writeContent('PUT', unsafeGallery);
  check(unsafeGalleryPut.status === 400, 'external gallery media is refused at the persistence boundary', `got ${unsafeGalleryPut.status}`);

  const translatedGallery = JSON.parse(JSON.stringify(snapshot));
  const galleryId = translatedGallery.gallery[0].id;
  translatedGallery.i18n.en = {
    ...(translatedGallery.i18n.en || {}),
    gallery: {
      [galleryId]: {
        caption: 'Translated gallery caption',
        description: 'Translated gallery description',
        src: 'https://untrusted.example/locale-only.webp',
        poster: '/uploads/images/locale-only.webp',
        type: 'video',
      },
    },
  };
  const translatedGalleryPut = await writeContent('PUT', translatedGallery);
  check(translatedGalleryPut.ok, 'gallery copy translations are accepted', `got ${translatedGalleryPut.status}`);
  const translatedGallerySaved = await (await fetch(`${BASE}/api/content`)).json();
  const savedGalleryOverride = translatedGallerySaved.i18n?.en?.gallery?.[galleryId] || {};
  check(
    savedGalleryOverride.caption === 'Translated gallery caption' &&
      !('src' in savedGalleryOverride) && !('poster' in savedGalleryOverride) && !('type' in savedGalleryOverride),
    'gallery translation save strips structural media fields',
  );

  const galleryRestore = await writeContent('PUT', snapshot);
  check(galleryRestore.ok, 'gallery validation fixture restores the original content');

  /* Social hrefs are executable navigation, not ordinary copy. Reject active
     schemes at persistence rather than hoping the document CSP neutralizes
     links that React later places in the header, footer and contact page. */
  for (const href of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>']) {
    const unsafeSocial = JSON.parse(JSON.stringify(snapshot));
    unsafeSocial.collections.socials[0].href = href;
    const response = await writeContent('PUT', unsafeSocial);
    const body = await response.json();
    check(
      response.status === 400 && body.code === 'unsafe-href-scheme',
      `${href.split(':', 1)[0]} social destinations are refused before persistence`,
      `got ${response.status}: ${JSON.stringify(body)}`,
    );
  }
  const afterUnsafeSocial = await (await fetch(`${BASE}/api/content`)).json();
  check(
    afterUnsafeSocial.collections?.socials?.[0]?.href === snapshot.collections.socials[0].href,
    'refused social schemes never replace the persisted destination',
    String(afterUnsafeSocial.collections?.socials?.[0]?.href || ''),
  );

  const translatedSocial = JSON.parse(JSON.stringify(snapshot));
  translatedSocial.i18n.en = {
    ...(translatedSocial.i18n.en || {}),
    collections: {
      ...(translatedSocial.i18n.en?.collections || {}),
      socials: [{ href: 'javascript:alert(1)' }],
    },
  };
  const translatedSocialPut = await writeContent('PUT', translatedSocial);
  check(
    translatedSocialPut.status === 400,
    'a locale social override cannot bypass the canonical href validator',
    `got ${translatedSocialPut.status}`,
  );

  /* Footer trust seals are admin-authored external resources. Valid HTTPS
     providers expand img-src for the rendered document; unsafe schemes and a
     fifth seal must be refused before they can reach either HTML or CSP. */
  const trustFixture = JSON.parse(JSON.stringify(snapshot));
  trustFixture.collections = {
    ...(trustFixture.collections || {}),
    trustSeals: [{
      id: 'trust-test',
      label: 'Test trust seal',
      href: 'https://seal.example/verify?id=1',
      image: 'https://seal.example/logo.png',
      active: true,
    }],
  };
  const trustPut = await writeContent('PUT', trustFixture);
  check(trustPut.ok, 'one valid HTTPS trust seal is accepted', `got ${trustPut.status}`);
  const trustPage = await fetch(`${BASE}/`);
  const trustCsp = trustPage.headers.get('content-security-policy') || '';
  check(
    trustCsp.includes('https://seal.example'),
    'a configured trust-logo origin is added to img-src',
    trustCsp,
  );

  const tooMany = JSON.parse(JSON.stringify(trustFixture));
  tooMany.collections.trustSeals = Array.from({ length: 5 }, (_, index) => ({
    ...trustFixture.collections.trustSeals[0],
    id: `trust-test-${index + 1}`,
  }));
  const tooManyPut = await writeContent('PUT', tooMany);
  check(tooManyPut.status === 400, 'a fifth footer trust seal is refused', `got ${tooManyPut.status}`);

  const unsafeSeal = JSON.parse(JSON.stringify(trustFixture));
  unsafeSeal.collections.trustSeals[0].href = 'javascript:alert(1)';
  const unsafePut = await writeContent('PUT', unsafeSeal);
  check(unsafePut.status === 400, 'an unsafe trust-seal destination is refused', `got ${unsafePut.status}`);

  const unsafeImage = JSON.parse(JSON.stringify(trustFixture));
  unsafeImage.collections.trustSeals[0].image = 'data:image/svg+xml,<svg onload=alert(1)>';
  const unsafeImagePut = await writeContent('PUT', unsafeImage);
  check(unsafeImagePut.status === 400, 'an unsafe trust-seal image is refused', `got ${unsafeImagePut.status}`);

  const unsafeImageId = JSON.parse(JSON.stringify(trustFixture));
  unsafeImageId.collections.trustSeals[0].imageId = 'seal" onerror="alert(1)';
  const unsafeImageIdPut = await writeContent('PUT', unsafeImageId);
  check(unsafeImageIdPut.status === 400, 'an unsafe provider image id is refused', `got ${unsafeImageIdPut.status}`);

  const restoreTrust = await writeContent('PUT', snapshot);
  check(restoreTrust.ok, 'trust-seal fixture restores the original content');
  const restoredPage = await fetch(`${BASE}/`);
  check(
    !(restoredPage.headers.get('content-security-policy') || '').includes('https://seal.example'),
    'removing the final trust seal removes its origin from img-src',
  );

  const cOrder = await jpost('/api/shop-public/orders', {
    items: [{ slug: SLUG, qty: 4 }],
    customer: CUSTOMER,
  });
  if (cOrder.ok) {
    check((await stockOf()) === 6, 'content-panel fixture: ordering 4 of 10 leaves 6');
    /* the admin edits only a price, using the stale snapshot */
    const edited = JSON.parse(JSON.stringify(snapshot));
    const target = (edited.shop?.products || []).find((p) => p.slug === SLUG);
    if (target) target.price = 123456;
    const put = await writeContent('PUT', edited);
    check(put.ok, 'content save with a stale shop snapshot is accepted', `got ${put.status}`);
    check((await stockOf()) === 6, 'saving the content panel does not resurrect sold stock');
    const after = await (await fetch(`${BASE}/api/shop-products`)).json();
    check(
      after.products.find((p) => p.slug === SLUG)?.price === 123456,
      'the price edit itself still takes effect',
    );
    const cid = await orderIdFor((await cOrder.json()).order.code);
    await fetch(`${BASE}/api/shop-admin/orders/${cid}`, { method: 'DELETE', headers: auth });
  }

  /* The latent products endpoint receives the same kind of whole-list
     snapshot. It must preserve live stock too; explicit inventory edits use
     the compare-and-set route and reject a stale expected value. */
  await setStock(10);
  const productSnapshotResponse = await fetch(`${BASE}/api/shop-admin/products`, { headers: auth });
  const productSnapshot = await productSnapshotResponse.json();
  const productSnapshotRevision = parseContentRevision(productSnapshotResponse.headers.get(CONTENT_REVISION_HEADER));
  const unknownBrandProducts = structuredClone(productSnapshot.products);
  unknownBrandProducts[0].brand = `missing-brand-${Date.now().toString(36)}`;
  const unknownBrandSave = await fetch(`${BASE}/api/shop-admin/products`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      [CONTENT_REVISION_HEADER]: String(productSnapshotRevision),
      ...auth,
    },
    body: JSON.stringify({ products: unknownBrandProducts }),
  });
  const productsAfterUnknownBrand = await (await fetch(`${BASE}/api/shop-admin/products`, { headers: auth })).json();
  check(
    unknownBrandSave.status === 400 &&
      productsAfterUnknownBrand.products.find((product) => product.slug === productSnapshot.products[0].slug)?.brand === productSnapshot.products[0].brand,
    'the legacy shop-products endpoint also refuses unknown managed brands without changing the catalogue',
    `got ${unknownBrandSave.status}`,
  );
  const revisionlessProductSave = await fetch(`${BASE}/api/shop-admin/products`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ products: productSnapshot.products }),
  });
  check(
    revisionlessProductSave.status === 428,
    'the legacy whole-catalogue endpoint also requires its source revision',
    `got ${revisionlessProductSave.status}`,
  );
  const staleOrder = await jpost('/api/shop-public/orders', {
    items: [{ slug: SLUG, qty: 2 }],
    customer: CUSTOMER,
  });
  if (staleOrder.ok) {
    check((await stockOf()) === 8, 'products-endpoint fixture: ordering 2 of 10 leaves 8');
    const staleSave = await fetch(`${BASE}/api/shop-admin/products`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        [CONTENT_REVISION_HEADER]: String(productSnapshotRevision),
        ...auth,
      },
      body: JSON.stringify({ products: productSnapshot.products }),
    });
    check(staleSave.ok, 'stale products snapshot is accepted without overwriting stock');
    check((await stockOf()) === 8, 'products endpoint preserves stock changed since page load');

    const staleStockEdit = await fetch(`${BASE}/api/shop-admin/products/${SLUG}/stock`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ stock: 42, expectedStock: 10 }),
    });
    check(staleStockEdit.status === 409, 'stale explicit stock edit is refused with 409', `got ${staleStockEdit.status}`);
    check((await stockOf()) === 8, 'refused stale stock edit leaves live stock untouched');

    const sid = await orderIdFor((await staleOrder.json()).order.code);
    await fetch(`${BASE}/api/shop-admin/orders/${sid}`, { method: 'DELETE', headers: auth });
  }

  /* The shop tab can still set inventory deliberately when its expected value
     is current. */
  await setStock(42);
  check((await stockOf()) === 42, 'the compare-and-set stock endpoint applies a deliberate edit');

  /* Deleting an order must also return its stock, otherwise tidying the admin
     order list silently destroys sellable inventory. */
  await setStock(10);
  const delOrder = await jpost('/api/shop-public/orders', {
    items: [{ slug: SLUG, qty: 4 }],
    customer: CUSTOMER,
  });
  if (delOrder.ok) {
    const d = (await delOrder.json()).order;
    check((await stockOf()) === 6, 'ordering 4 of 10 leaves 6');
    const did = await orderIdFor(d.code);
    await fetch(`${BASE}/api/shop-admin/orders/${did}`, { method: 'DELETE', headers: auth });
    check((await stockOf()) === 10, 'deleting a pending order returns its stock');
  }

  /* ---- 2. contact form: rejected submissions must not consume quota ------ */
  /* MSG_MAX is 5. Ten invalid posts must never produce a 429. */
  let sawRateLimit = false;
  for (let i = 0; i < 10; i += 1) {
    const r = await jpost('/api/messages', { name: 'x' }); // missing phone/message
    if (r.status === 429) sawRateLimit = true;
  }
  check(!sawRateLimit, 'invalid contact posts do not consume the rate limit');

  const realMsg = await jpost('/api/messages', {
    name: 'کاربر',
    phone: '09121234567',
    email: 'a@b.co',
    subject: 'استعلام',
    message: 'پیام واقعی برای تست',
  });
  check(realMsg.ok, 'a valid message still goes through after invalid attempts', `status ${realMsg.status}`);

  /* ---- 3. comments and orders have independent buckets ------------------- */
  /* Exhaust the comment bucket (max 5), then prove ordering still works. */
  for (let i = 0; i < 8; i += 1) {
    await jpost('/api/shop-public/comments', {
      slug: RL_SLUG,
      name: 'کاربر',
      text: `پرسش شماره ${i}`,
    });
  }
  const orderAfterComments = await jpost('/api/shop-public/orders', {
    items: [{ slug: RL_SLUG, qty: 1 }],
    customer: CUSTOMER,
  });
  check(
    orderAfterComments.ok,
    'posting comments does not block checkout',
    `order returned ${orderAfterComments.status}`,
  );

  /* ---- 4. rejected orders must not consume the order quota --------------- */
  for (let i = 0; i < 10; i += 1) {
    await jpost('/api/shop-public/orders', {
      items: [{ slug: RL_SLUG, qty: 1 }],
      customer: { ...CUSTOMER, phone: 'not-a-phone' },
    });
  }
  const goodOrder = await jpost('/api/shop-public/orders', {
    items: [{ slug: RL_SLUG, qty: 1 }],
    customer: CUSTOMER,
  });
  check(
    goodOrder.ok,
    'invalid orders do not consume the order rate limit',
    `valid order returned ${goodOrder.status}`,
  );

  /* An invalid online-gateway credential degrades safely to a pending order,
     but the response must tell the customer why payment did not start. */
  const initialPaymentDb = await dbStore.openDB(DB);
  const initialPreviousPayment = dbStore.getSetting(initialPaymentDb, 'shop.payment', {});
  dbStore.setSetting(initialPaymentDb, 'shop.payment', { provider: 'zarinpal', callbackBase: BASE, zarinpalMerchant: 'invalid' });
  initialPaymentDb.close();
  let initialGatewayResponse;
  try {
    initialGatewayResponse = await jpost('/api/shop-public/orders', {
      items: [{ slug: RL_SLUG, qty: 1 }], customer: CUSTOMER,
    });
  } finally {
    const restoreDb = await dbStore.openDB(DB);
    dbStore.setSetting(restoreDb, 'shop.payment', initialPreviousPayment);
    restoreDb.close();
  }
  const initialGatewayBody = await initialGatewayResponse.json().catch(() => ({}));
  check(
    initialGatewayResponse.ok && initialGatewayBody.payment?.gatewayError === true && !initialGatewayBody.payment?.payUrl,
    'an online-provider setup failure is surfaced on the new order response',
    JSON.stringify(initialGatewayBody.payment),
  );

  /* Payment retry requires an authenticated owner. Identical ownership misses
     stay indistinguishable, and an owner's repeated gateway attempts remain
     bounded before any network work. */
  const goodOrderBody = goodOrder.ok ? await goodOrder.json() : null;
  if (goodOrderBody?.order?.code) {
    const noSession = await fetch(`${BASE}/api/shop-public/orders/${goodOrderBody.order.code}/pay`, {
      method: 'POST', headers: { Origin: BASE, 'X-Forwarded-For': '198.51.100.11' },
    });
    check(noSession.status === 401, 'payment retry requires the customer session');

    const foreign = await jpost(`/api/shop-public/orders/${reversalFixture.code}/pay`, {}, { 'X-Forwarded-For': '198.51.100.12' });
    const missing = await jpost('/api/shop-public/orders/KY-NOT-AN-ORDER/pay', {}, { 'X-Forwarded-For': '198.51.100.12' });
    check(foreign.status === 404 && missing.status === 404, 'an unowned order code and an unknown code return the same response');

    const paymentDb = await dbStore.openDB(DB);
    const previousPayment = dbStore.getSetting(paymentDb, 'shop.payment', {});
    dbStore.setSetting(paymentDb, 'shop.payment', { provider: 'zarinpal', callbackBase: BASE, zarinpalMerchant: 'invalid' });
    paymentDb.close();
    const retryStatuses = [];
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await jpost(
          `/api/shop-public/orders/${goodOrderBody.order.code}/pay`,
          {},
          { 'X-Forwarded-For': '198.51.100.13' },
        );
        retryStatuses.push({ status: response.status, retryAfter: response.headers.get('retry-after') });
        if (response.status === 429) break;
      }
    } finally {
      const restoreDb = await dbStore.openDB(DB);
      dbStore.setSetting(restoreDb, 'shop.payment', previousPayment);
      restoreDb.close();
    }
    const retryLimited = retryStatuses.find((result) => result.status === 429);
    check(retryLimited && retryStatuses.slice(0, -1).every((result) => result.status === 502), 'owned payment retries hit the configured cap before gateway work', JSON.stringify(retryStatuses));
    check(Boolean(retryLimited?.retryAfter), 'payment retry 429 includes Retry-After');
  } else {
    check(false, 'payment retry test order was created');
  }

  /* ---- 4b. an Iranian keyboard must be able to buy things --------------- */
  /* ۰۹۱۲۳۴۵۶۷۸۹ is what a Persian layout produces, and the site is Persian
     first. An ASCII-only phone pattern told those customers their own phone
     number was invalid — a silent, total checkout failure for anyone who did
     not think to retype it in Latin digits. */
  const faPhone = await jpost('/api/shop-public/orders', {
    items: [{ slug: RL_SLUG, qty: 1 }],
    customer: { ...CUSTOMER, phone: '۰۹۱۲۳۴۵۶۷۸۹' },
  });
  check(faPhone.ok, 'an order with Persian-digit phone is accepted', `returned ${faPhone.status}`);

  for (const [label, written] of [
    ['+98 912 345 6789', '+98 912 345 6789'],
    ['00989123456789', '00989123456789'],
    ['9123456789', '9123456789'],
  ]) {
    const r = await jpost('/api/shop-public/orders', {
      items: [{ slug: RL_SLUG, qty: 1 }],
      customer: { ...CUSTOMER, phone: written },
    });
    check(r.ok, `an order with phone written as ${label} is accepted`, `returned ${r.status}`);
  }

  /* Still closed to things that are not mobile numbers. */
  const landline = await jpost('/api/shop-public/orders', {
    items: [{ slug: RL_SLUG, qty: 1 }],
    customer: { ...CUSTOMER, phone: '۰۲۱۲۲۵۷۸۲۴۲' },
  });
  check(landline.status === 400, 'a landline is still rejected', `returned ${landline.status}`);

  /* ---- 5. a 429, when it does happen, is actionable ---------------------- */
  let limited = null;
  for (let i = 0; i < 20 && !limited; i += 1) {
    const r = await jpost('/api/shop-public/orders', {
      items: [{ slug: RL_SLUG, qty: 1 }],
      customer: CUSTOMER,
    });
    if (r.status === 429) limited = r;
  }
  if (limited) {
    check(Boolean(limited.headers.get('retry-after')), '429 carries a Retry-After header');
    const body = await limited.json();
    check(Number(body.retryAfter) > 0, '429 body states how long to wait');
  } else {
    check(false, 'order rate limit is reachable at all');
  }

  /* Admin can completely disable every bucket for diagnostics, and restoring
     the saved settings re-enables protection without retaining stale hits. */
  const security = await (await fetch(`${BASE}/api/admin/security`, { headers: auth })).json();
  const disable = await fetch(`${BASE}/api/admin/security`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ rateLimits: { ...security.rateLimits, enabled: false } }),
  });
  check(disable.ok, 'admin can disable all rate limits', `got ${disable.status}`);
  const unlimitedOrder = await jpost('/api/shop-public/orders', {
    items: [{ slug: RL_SLUG, qty: 1 }],
    customer: CUSTOMER,
  });
  check(unlimitedOrder.ok, 'disabled limits stop an exhausted bucket from blocking checkout', `got ${unlimitedOrder.status}`);
  const callbackWhileDisabled = await fetch(BASE + mappedCallbackUrl, { redirect: 'manual' });
  check(
    callbackWhileDisabled.status === 302,
    'the Admin global switch also disables the exhausted callback limiter',
    `got ${callbackWhileDisabled.status}`,
  );
  const restoreLimits = await fetch(`${BASE}/api/admin/security`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ rateLimits: security.rateLimits }),
  });
  check(restoreLimits.ok, 'admin can re-enable the saved rate limits');

  /* ---- 6. upload errors are 4xx with a reason, never 500 ----------------- */
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64, 7),
  ]);

  const wrongField = new FormData();
  wrongField.append('image', new Blob([png], { type: 'image/png' }), 'a.png');
  const wf = await fetch(`${BASE}/api/upload`, { method: 'POST', headers: auth, body: wrongField });
  check(wf.status === 400, 'wrong upload field name returns 400, not 500', `got ${wf.status}`);
  check(!/internal/i.test(JSON.stringify(await wf.json())), 'wrong field name explains itself');

  const good = new FormData();
  good.append('file', new Blob([png], { type: 'image/png' }), 'a.png');
  const gu = await fetch(`${BASE}/api/upload`, { method: 'POST', headers: auth, body: good });
  check(gu.ok, 'a valid upload still succeeds', `got ${gu.status}`);

  /* --- slug integrity -------------------------------------------------
     replaceProducts deletes every row then re-inserts, skipping entries
     without a usable slug, so one blank slug used to delete that product and
     still answer 200. Duplicates hit a UNIQUE constraint and surfaced as 500.
     The catalogue must be byte-identical after every rejected save. */
  const catalogue = async () =>
    ((await (await fetch(`${BASE}/api/shop-products`)).json()).products || [])
      .map((p) => p.slug)
      .join(',');

  const seed = [
    { slug: 'keep-a', title: 'A', price: 1000, stock: -1, active: true },
    { slug: 'keep-b', title: 'B', price: 1000, stock: -1, active: true },
  ];
  let rawRevision = null;
  const putRaw = async (products) => {
    if (rawRevision === null) {
      const current = await fetch(`${BASE}/api/shop-admin/products`, { headers: auth });
      rawRevision = parseContentRevision(current.headers.get(CONTENT_REVISION_HEADER));
    }
    const response = await fetch(`${BASE}/api/shop-admin/products`, {
      method: 'PUT',
      headers: {
        ...auth,
        'content-type': 'application/json',
        [CONTENT_REVISION_HEADER]: String(rawRevision),
      },
      body: JSON.stringify({ products }),
    });
    if (response.ok) rawRevision = parseContentRevision(response.headers.get(CONTENT_REVISION_HEADER));
    return response;
  };

  await putRaw(seed);
  const before = await catalogue();
  check(before.includes('keep-a') && before.includes('keep-b'), 'slug fixture seeded', before);

  const bad = {
    'blank slug': [seed[0], { ...seed[1], slug: '' }],
    'duplicate slug': [seed[0], { ...seed[1], slug: 'keep-a' }],
    'slug with slash': [{ ...seed[0], slug: 'sl/ash' }],
    'slug with space': [{ ...seed[0], slug: 'has space' }],
    'null slug': [{ ...seed[0], slug: null }],
    'zero active price': [{ ...seed[0], price: 0, active: true }],
  };
  for (const [name, list] of Object.entries(bad)) {
    const res = await putRaw(list);
    check(res.status === 400, `${name} is rejected with 400`, `got ${res.status}`);
    check((await catalogue()) === before, `${name} leaves the catalogue untouched`);
  }
  const okRes = await putRaw(seed);
  check(okRes.ok, 'a valid catalogue save still succeeds', `got ${okRes.status}`);

} catch (e) {
  check(false, 'behaviour harness', String(e.message).slice(0, 140));
} finally {
  if (server) server.kill('SIGKILL');
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch {}
}

console.log(`${pass}/${pass + fail}`);
if (fail) process.exitCode = 1;
