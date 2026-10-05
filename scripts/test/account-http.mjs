/* ==========================================================================
   Customer accounts against a real running server.

   The pure logic is covered in accounts.mjs. What can only be tested with a
   server in front of it:

   1. Nobody can register, log in, or read an account without the code that
      was actually sent to the phone. The test reads it the way a customer
      does — out of the delivered message — via the admin SMS log, so there
      is no test-only backdoor in the product.
   2. One customer cannot see or edit another's addresses or orders.
   3. The session is an HttpOnly cookie, and logging out really revokes it.
   4. The endpoints do not leak which phone numbers have accounts.
   5. Ordering requires an account, and the order keeps a SNAPSHOT of the
      address — editing the address afterwards must not rewrite history.
   ========================================================================== */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

const PORT = 8978;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(os.tmpdir(), `ky-account-test-${process.pid}.db`);
const ADMIN = { user: 'admin', pass: 'khyeast-account-test' };

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
      DB_FILE: DB,
      NODE_ENV: 'development',
      ADMIN_USER: ADMIN.user,
      ADMIN_PASS: ADMIN.pass,
      ADMIN_SECRET: 'account-test-secret-0123456789abcdef',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 150; i += 1) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
};

/* A browser sends Origin on cross-site requests; our CSRF guard compares it
   to the site's own origin. The tests send the honest one by default. */
const ORIGIN = BASE;

const call = (method, url, body, { cookie, origin = ORIGIN, auth } = {}) =>
  fetch(BASE + url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(origin ? { Origin: origin } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const json = async (res) => ({ status: res.status, body: await res.json().catch(() => ({})), res });

let adminToken = '';
/* The customer's inbox, as the admin sees it. */
const lastSms = async (phoneEnding) => {
  const { body } = await json(await call('GET', '/api/shop-admin/sms', undefined, { auth: adminToken }));
  const rows = body.log || [];
  const row = phoneEnding ? rows.find((l) => l.phone.endsWith(phoneEnding)) : rows[0];
  return row || null;
};
const codeFor = async (phoneEnding) => {
  const row = await lastSms(phoneEnding);
  const m = row && row.text.match(/(\d{5})/);
  return m ? m[1] : null;
};
const cookieOf = (res) => {
  const raw = res.headers.get('set-cookie') || '';
  return raw.split(';')[0];
};

/** The whole signup, as a customer performs it. */
const signUp = async (phone, password, name) => {
  await json(await call('POST', '/api/account/otp', { phone, purpose: 'register' }));
  const code = await codeFor(phone.slice(-4));
  const verified = await json(await call('POST', '/api/account/otp/verify', { phone, code, purpose: 'register' }));
  const reg = await json(await call('POST', '/api/account/register', { ticket: verified.body.ticket, password, name }));
  return { code, ticket: verified.body.ticket, reg, cookie: cookieOf(reg.res) };
};

try {
  await start();

  /* admin session, used only to read the SMS log */
  const login = await json(await call('POST', '/api/auth/login', { user: ADMIN.user, pass: ADMIN.pass }));
  adminToken = login.body.token;
  check(Boolean(adminToken), 'admin login for reading the SMS log');

  /* ---------------------------------------------- 1. registration flow */
  const PHONE = '09120000001';
  const PASS = 'khyeast-1404-ok';

  const otp1 = await json(await call('POST', '/api/account/otp', { phone: PHONE, purpose: 'register' }));
  check(otp1.status === 200, 'requesting a code succeeds', String(otp1.status));

  const sms = await lastSms('0001');
  check(Boolean(sms), 'a message was actually dispatched');
  check(sms.kind === 'otp', 'it is logged as an otp', sms.kind);
  const code = await codeFor('0001');
  check(/^\d{5}$/.test(code || ''), 'the message contains a five-digit code', String(code));

  /* The code is the only thing standing between a stranger and the
     account, so the wrong one must never be enough. */
  const wrong = await json(await call('POST', '/api/account/otp/verify', { phone: PHONE, code: '00000', purpose: 'register' }));
  check(wrong.status === 400, 'a wrong code is rejected', String(wrong.status));
  check(!JSON.stringify(wrong.body).includes(code), 'and the response does not leak the real code');

  const verified = await json(await call('POST', '/api/account/otp/verify', { phone: PHONE, code, purpose: 'register' }));
  check(verified.status === 200 && Boolean(verified.body.ticket), 'the right code returns a ticket');

  /* Registration cannot happen without the ticket. */
  const noTicket = await json(await call('POST', '/api/account/register', { password: PASS, name: 'بدون بلیط' }));
  check(noTicket.status === 400, 'registering without a ticket is refused', String(noTicket.status));

  const weak = await json(await call('POST', '/api/account/register', { ticket: verified.body.ticket, password: '123', name: 'رمز ضعیف' }));
  check(weak.status === 400, 'a weak password is refused');
  check(/[\u0600-\u06FF]/.test(weak.body.error || ''), 'with a Persian reason', weak.body.error);

  /* The failed attempt above consumed the ticket, which is correct: a
     single-use proof is single use. Start again. */
  const s1 = await signUp(PHONE, PASS, 'مشتری یکم');
  check(s1.reg.status === 200, 'registration succeeds', JSON.stringify(s1.reg.body).slice(0, 120));
  check(s1.reg.body.customer?.phone === '989120000001', 'the account is keyed on the canonical phone', s1.reg.body.customer?.phone);

  const setCookie = s1.reg.res.headers.get('set-cookie') || '';
  check(setCookie.includes('HttpOnly'), 'the session cookie is HttpOnly');
  check(setCookie.includes('SameSite=Lax'), 'the session cookie is SameSite=Lax');
  check(!setCookie.includes('Secure'), 'Secure is omitted over plain http so dev works');

  /* A used ticket cannot be replayed into a second account. */
  const replay = await json(await call('POST', '/api/account/register', { ticket: s1.ticket, password: PASS, name: 'تکراری' }));
  check(replay.status === 400, 'a ticket cannot be used twice', String(replay.status));

  /* ------------------------------------------------------- 2. the session */
  const me = await json(await call('GET', '/api/account/me', undefined, { cookie: s1.cookie }));
  check(me.body.customer?.name === 'مشتری یکم', 'the session identifies the customer');
  check(me.body.customer?.phoneLocal === '09120000001', 'the readable phone comes back for display');
  check(!JSON.stringify(me.body).includes('pass_hash'), 'the password hash is never serialised');
  check(!JSON.stringify(me.body).includes('scrypt$'), 'nor any part of it');

  const anon = await json(await call('GET', '/api/account/me'));
  check(anon.body.customer === null, 'no cookie, no customer');

  const forged = await json(await call('GET', '/api/account/me', undefined, { cookie: 'ky_customer=not-a-real-token' }));
  check(forged.body.customer === null, 'a forged cookie is not a session');

  /* ----------------------------------------------------------- 3. login */
  const badPass = await json(await call('POST', '/api/account/login', { phone: PHONE, password: 'wrong-password' }));
  check(badPass.status === 401, 'a wrong password is refused');

  const unknown = await json(await call('POST', '/api/account/login', { phone: '09129999999', password: 'wrong-password' }));
  check(unknown.status === 401, 'an unknown number is refused');
  /* Enumeration: the two failures must be indistinguishable, or this
     endpoint becomes a "which of these numbers shop here" oracle. */
  check(unknown.body.error === badPass.body.error, 'a wrong password and an unknown number give the same answer');

  const ok = await json(await call('POST', '/api/account/login', { phone: '۰۹۱۲۰۰۰۰۰۰۱', password: PASS }));
  check(ok.status === 200, 'logging in with Persian digits works', String(ok.status));
  const cookie1 = cookieOf(ok.res);
  check(cookie1 !== s1.cookie, 'logging in issues a fresh session');

  /* CSRF: a cross-site POST that somehow carried the cookie is refused. */
  const csrf = await json(await call('POST', '/api/account/password', { current: PASS, password: 'another-good-1404' }, { cookie: cookie1, origin: 'https://evil.example' }));
  check(csrf.status === 403, 'a request from a foreign origin is refused', String(csrf.status));

  /* ------------------------------------------------------- 4. addresses */
  const ADDR = {
    title: 'خانه',
    receiver: 'گیرنده یکم',
    phone: '09120000011',
    province: 'خوزستان',
    city: 'دزفول',
    address: 'خیابان شریعتی، کوچه دوم',
    plaque: '12',
    unit: '3',
    postal: '1619637511',
  };
  const a1 = await json(await call('POST', '/api/account/addresses', ADDR, { cookie: cookie1 }));
  check(a1.status === 200, 'an address is saved', JSON.stringify(a1.body).slice(0, 120));
  check(a1.body.address.isDefault === true, 'the first address becomes the default');

  const a2 = await json(await call('POST', '/api/account/addresses', { ...ADDR, title: 'انبار', city: 'اهواز' }, { cookie: cookie1 }));
  check(a2.body.address.isDefault === false, 'the second one does not steal the default');

  const badAddr = await json(await call('POST', '/api/account/addresses', { ...ADDR, postal: '123' }, { cookie: cookie1 }));
  check(badAddr.status === 400 && Boolean(badAddr.body.fields?.postal), 'a bad postal code is refused by field');

  const anonAddr = await json(await call('GET', '/api/account/addresses'));
  check(anonAddr.status === 401, 'addresses need a session');

  /* ------------------------------------------ 5. one customer, one world */
  const s2 = await signUp('09120000002', 'second-customer-1404', 'مشتری دوم');
  check(s2.reg.status === 200, 'a second customer registers');

  const peek = await json(await call('GET', '/api/account/me', undefined, { cookie: s2.cookie }));
  check((peek.body.addresses || []).length === 0, 'the second customer sees none of the first ones addresses');

  const steal = await json(await call('PUT', `/api/account/addresses/${a1.body.address.id}`, { ...ADDR, city: 'تغییر داده شد' }, { cookie: s2.cookie }));
  check(steal.status === 404, 'another customer cannot edit an address by id', String(steal.status));

  const stealDel = await json(await call('DELETE', `/api/account/addresses/${a1.body.address.id}`, undefined, { cookie: s2.cookie }));
  check(stealDel.status === 404, 'nor delete it', String(stealDel.status));

  const stillThere = await json(await call('GET', '/api/account/addresses', undefined, { cookie: cookie1 }));
  check(stillThere.body.addresses.some((x) => x.id === a1.body.address.id && x.city === 'دزفول'), 'and it is untouched');

  /* ----------------------------------------------- 6. ordering, snapshot */
  const products = await json(await call('GET', '/api/shop-products'));
  const slug = (products.body.products || []).find((p) => p.active && (p.stock === -1 || p.stock > 0))?.slug;
  check(Boolean(slug), 'there is something to buy');

  const guestOrder = await json(await call('POST', '/api/shop-public/orders', { items: [{ slug, qty: 1 }], customer: { name: 'مهمان', phone: '09120000003', city: 'اهواز', address: 'یک نشانی کامل برای تست' } }));
  check(guestOrder.status === 401, 'ordering without an account is refused', String(guestOrder.status));

  const order = await json(
    await call('POST', '/api/shop-public/orders', { items: [{ slug, qty: 1 }], customer: { addressId: a1.body.address.id } }, { cookie: cookie1 })
  );
  check(order.status === 200, 'a signed-in customer can order with a saved address', JSON.stringify(order.body).slice(0, 140));

  const mine = await json(await call('GET', '/api/account/me', undefined, { cookie: cookie1 }));
  check((mine.body.orders || []).some((o) => o.code === order.body.order.code), 'the order appears in the account');
  const placed = (mine.body.orders || []).find((o) => o.code === order.body.order.code);
  check(placed.customer.address.includes('دزفول'), 'the order carries the address it was sent to', placed.customer.address);
  check(Boolean(placed.trackToken), 'the account can reach its own tracking page');

  const others = await json(await call('GET', '/api/account/me', undefined, { cookie: s2.cookie }));
  check((others.body.orders || []).length === 0, 'another customer does not see that order');

  /* The snapshot: editing the address must not rewrite where a past parcel
     went. This is the whole reason the order copies the address. */
  await json(await call('PUT', `/api/account/addresses/${a1.body.address.id}`, { ...ADDR, city: 'شوشتر', address: 'نشانی کاملاً جدید برای تست' }, { cookie: cookie1 }));
  const after = await json(await call('GET', '/api/account/me', undefined, { cookie: cookie1 }));
  const same = (after.body.orders || []).find((o) => o.code === order.body.order.code);
  check(same.customer.address.includes('دزفول'), 'the past order still shows the old address', same.customer.address);
  check(!same.customer.address.includes('شوشتر'), 'and not the edited one');

  /* The order confirmation goes to the verified account number. */
  const confirm = await lastSms('0001');
  check(confirm.kind === 'order' && confirm.text.includes(order.body.order.code), 'the confirmation SMS names the order');
  check(confirm.text.includes(`token=`), 'and carries the tracking link');

  /* --------------------------------------------------------- 7. logout */
  const out = await json(await call('POST', '/api/account/logout', {}, { cookie: cookie1 }));
  check(out.status === 200, 'logout succeeds');
  const afterOut = await json(await call('GET', '/api/account/me', undefined, { cookie: cookie1 }));
  check(afterOut.body.customer === null, 'the old cookie is dead afterwards, not merely forgotten');

  /* -------------------------------------------------- 8. password reset */
  await json(await call('POST', '/api/account/otp', { phone: PHONE, purpose: 'reset' }));
  const resetCode = await codeFor('0001');
  const rv = await json(await call('POST', '/api/account/otp/verify', { phone: PHONE, code: resetCode, purpose: 'reset' }));
  check(rv.status === 200, 'a reset code verifies');

  /* A register ticket must not be usable as a reset ticket, or the two
     flows become one. */
  const crossUse = await json(await call('POST', '/api/account/register', { ticket: rv.body.ticket, password: 'cross-use-1404', name: 'جابجا' }));
  check(crossUse.status === 400, 'a reset ticket cannot register an account');

  await json(await call('POST', '/api/account/otp', { phone: PHONE, purpose: 'reset' }));
  /* the resend window blocks an immediate second code — wait it out only if
     the server actually refused */
  let resetCode2 = await codeFor('0001');
  const rv2 = await json(await call('POST', '/api/account/otp/verify', { phone: PHONE, code: resetCode2, purpose: 'reset' }));
  const NEWPASS = 'brand-new-1404-x';
  const reset = await json(await call('POST', '/api/account/reset', { ticket: rv2.body.ticket, password: NEWPASS }));
  check(reset.status === 200, 'the password is reset', JSON.stringify(reset.body).slice(0, 120));

  const oldPass = await json(await call('POST', '/api/account/login', { phone: PHONE, password: PASS }));
  check(oldPass.status === 401, 'the old password no longer works');
  const newPass = await json(await call('POST', '/api/account/login', { phone: PHONE, password: NEWPASS }));
  check(newPass.status === 200, 'the new one does');

  /* ------------------------------------------------- 9. enumeration again */
  const regKnown = await json(await call('POST', '/api/account/otp', { phone: PHONE, purpose: 'register' }));
  const regUnknown = await json(await call('POST', '/api/account/otp', { phone: '09127777777', purpose: 'register' }));
  check(
    regKnown.status === regUnknown.status && JSON.stringify(regKnown.body) === JSON.stringify(regUnknown.body),
    'the code endpoint answers the same for a known and an unknown number',
    `${regKnown.status} ${JSON.stringify(regKnown.body)} vs ${regUnknown.status} ${JSON.stringify(regUnknown.body)}`
  );
  /* ...and no code was actually sent to the already-registered number. */
  const sentToKnown = await lastSms('0001');
  check(sentToKnown.kind !== 'otp' || sentToKnown.ref !== 'register', 'no registration code is sent to an existing account', JSON.stringify({ kind: sentToKnown.kind, ref: sentToKnown.ref }));

  /* ------------------------------------------------- 10. OTP guess limit */
  const VICTIM = '09125555555';
  await json(await call('POST', '/api/account/otp', { phone: VICTIM, purpose: 'register' }));
  const real = await codeFor('5555');
  for (let i = 0; i < 6; i += 1) {
    await json(await call('POST', '/api/account/otp/verify', { phone: VICTIM, code: String(i).padStart(5, '1'), purpose: 'register' }));
  }
  const afterGuesses = await json(await call('POST', '/api/account/otp/verify', { phone: VICTIM, code: real, purpose: 'register' }));
  check(afterGuesses.status === 400, 'the real code is dead after repeated wrong guesses', String(afterGuesses.status));
  /* --------------------------------------------- 11. the admin's view */
  const list = await json(await call('GET', '/api/shop-admin/customers', undefined, { auth: adminToken }));
  check(list.status === 200, 'the admin can list customers');
  check(list.body.customers.length >= 2, 'both test customers are there', String(list.body.customers.length));
  /* The admin panel is a browser page like any other: a password hash that
     reaches it is a password hash in a screenshot, a cache and a support
     chat. */
  check(!JSON.stringify(list.body).includes('scrypt$'), 'no password hash reaches the admin panel');
  check(!JSON.stringify(list.body).includes('pass_hash'), 'not even the field name');

  const target = list.body.customers.find((c) => c.phone === '989120000001');
  check(target.orderCount >= 1, 'the list counts their orders', String(target.orderCount));
  check(target.addressCount >= 2, 'and their addresses', String(target.addressCount));

  const anonList = await json(await call('GET', '/api/shop-admin/customers'));
  check(anonList.status === 401, 'the customer list needs an admin session');
  /* A customer session is not an admin session, however valid it is. */
  const customerPeek = await json(await call('GET', '/api/shop-admin/customers', undefined, { cookie: cookieOf(newPass.res) }));
  check(customerPeek.status === 401, 'a signed-in customer cannot read the customer list', String(customerPeek.status));

  const detail = await json(await call('GET', `/api/shop-admin/customers/${target.id}`, undefined, { auth: adminToken }));
  check(detail.status === 200 && detail.body.orders.length >= 1, 'the admin can see a customer orders');
  check(detail.body.addresses.length >= 1, 'and their addresses');
  check(!JSON.stringify(detail.body.orders).includes('"token"'), 'but not the order tracking tokens');

  /* Blocking must end the session, not just refuse the next login — a
     block that leaves someone signed in blocks nothing. */
  const live = cookieOf(newPass.res);
  const before = await json(await call('GET', '/api/account/me', undefined, { cookie: live }));
  check(before.body.customer !== null, 'the customer is signed in before the block');

  const block = await json(await call('PATCH', `/api/shop-admin/customers/${target.id}`, { blocked: true }, { auth: adminToken }));
  check(block.status === 200 && block.body.customer.blocked === true, 'the admin can block an account');

  const afterBlock = await json(await call('GET', '/api/account/me', undefined, { cookie: live }));
  check(afterBlock.body.customer === null, 'blocking ends the live session immediately');

  const blockedLogin = await json(await call('POST', '/api/account/login', { phone: PHONE, password: NEWPASS }));
  check(blockedLogin.status === 401, 'and the right password no longer logs in');

  const unblock = await json(await call('PATCH', `/api/shop-admin/customers/${target.id}`, { blocked: false }, { auth: adminToken }));
  check(unblock.body.customer.blocked === false, 'unblocking is possible');
  const backIn = await json(await call('POST', '/api/account/login', { phone: PHONE, password: NEWPASS }));
  check(backIn.status === 200, 'and the customer can sign in again');

  const stillOrders = await json(await call('GET', `/api/shop-admin/customers/${target.id}`, undefined, { auth: adminToken }));
  check(stillOrders.body.orders.length >= 1, 'blocking never deleted the order history');

  const ghost = await json(await call('GET', '/api/shop-admin/customers/not-a-real-id', undefined, { auth: adminToken }));
  check(ghost.status === 404, 'an unknown customer id is a 404, not a crash');

} catch (e) {
  check(false, 'harness', String(e?.message || e));
} finally {
  server?.kill();
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
}

console.log(`${pass}/${pass + fail}`);
