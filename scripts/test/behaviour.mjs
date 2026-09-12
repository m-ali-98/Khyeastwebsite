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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

const PORT = 8977;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(os.tmpdir(), `ky-behaviour-test-${process.pid}.db`);

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
    env: { ...process.env, PORT: String(PORT), DB_FILE: DB, NODE_ENV: 'development' },
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

const jpost = (url, body, headers = {}) =>
  fetch(BASE + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const CUSTOMER = {
  name: 'تست کاربر',
  phone: '09121234567',
  city: 'تهران',
  address: 'خیابان آزادی پلاک ۱۲۳ واحد ۴',
};

try {
  await start();

  const login = await jpost('/api/auth/login', { user: 'admin', pass: 'khyeast-1404' });
  const token = (await login.json()).token;
  const auth = { Authorization: `Bearer ${token}` };

  /* The rate-limit checks below place many orders. They use their own product
     with unlimited stock (-1) so a 400 can only ever mean "rate limited",
     never "sold out" — otherwise a stock failure would masquerade as a
     limiter bug. */
  const RL_SLUG = 'rl-test';
  const SLUG = 'inv-test';

  /* PUT /api/shop-admin/products REPLACES the whole catalogue, so every write
     has to carry both fixtures or one silently deletes the other. */
  const putProducts = (invStock) =>
    fetch(`${BASE}/api/shop-admin/products`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({
        products: [
          { slug: RL_SLUG, title: 'تست محدودیت', price: 100000, stock: -1, active: true },
          { slug: SLUG, title: 'تست موجودی', price: 100000, stock: invStock, active: true },
        ],
      }),
    });

  /* ---- 1. inventory balances across the order lifecycle ------------------
     Runs FIRST: later checks deliberately exhaust the order rate limit, which
     would otherwise make these unreachable. */
  const setStock = putProducts;
  const stockOf = async () => {
    const all = await (await fetch(`${BASE}/api/shop-products`)).json();
    return all.products.find((p) => p.slug === SLUG)?.stock;
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

  await setStock(10);
  const invOrder = await jpost('/api/shop-public/orders', {
    items: [{ slug: SLUG, qty: 3 }],
    customer: CUSTOMER,
  });
  check(invOrder.ok, 'inventory test order placed', `status ${invOrder.status}`);

  const { order } = await invOrder.json();
  check((await stockOf()) === 7, 'ordering 3 of 10 leaves 7');

  const id = await orderIdFor(order.code);
  await setStatus(id, 'cancelled');
  check((await stockOf()) === 10, 'cancelling returns the reserved stock');

  /* Cancelling twice must not mint inventory that never existed. */
  await setStatus(id, 'cancelled');
  check((await stockOf()) === 10, 'cancelling twice does not inflate stock');

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
  const putRaw = (products) =>
    fetch(`${BASE}/api/shop-admin/products`, {
      method: 'PUT',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ products }),
    });

  await putRaw(seed);
  const before = await catalogue();
  check(before.includes('keep-a') && before.includes('keep-b'), 'slug fixture seeded', before);

  const bad = {
    'blank slug': [seed[0], { ...seed[1], slug: '' }],
    'duplicate slug': [seed[0], { ...seed[1], slug: 'keep-a' }],
    'slug with slash': [{ ...seed[0], slug: 'sl/ash' }],
    'slug with space': [{ ...seed[0], slug: 'has space' }],
    'null slug': [{ ...seed[0], slug: null }],
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
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* already gone */
    }
  }
}

console.log(`${pass}/${pass + fail}`);
