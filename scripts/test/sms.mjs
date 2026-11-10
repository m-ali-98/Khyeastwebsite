/* ==========================================================================
   SMS layer checks.

   The SMS path touches two things that are expensive to get wrong: a
   customer's only link to their order, and an account's credit balance. The
   properties guarded here are, in order of how much they would cost:

   1. A send NEVER throws. Payment settlement calls this; a provider outage
      must not turn a committed, paid order into a 500.
   2. The API key never leaves the server, and saving the settings form with
      the mask in the field does not erase it.
   3. One phone number has exactly one canonical form, whatever the visitor
      typed — Persian digits, +98, 0098 or a bare 912.
   4. The daily cap and the configured-ness check fail closed.

   No network: the sms.ir transport is injected.
   ========================================================================== */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import express from 'express';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

let pass = 0;
let fail = 0;
const check = (ok, name, detail = '') => {
  if (ok) pass += 1;
  else {
    fail += 1;
    console.log(`LEAK ${name}${detail ? ' — ' + detail : ''}`);
  }
};

const sms = await import(pathToFileURL(path.join(ROOT, 'server/sms.js')).href);
const {
  normalizePhone,
  toLocalPhone,
  maskPhone,
  maskKey,
  SECRET_MASK,
  normalizeSms,
  mergeSmsSettings,
  publicSmsSettings,
  smsReadiness,
  orderStatusUrl,
  orderSmsText,
  shipmentSmsText,
  shouldSendShipmentSms,
  sendSms,
} = sms;

/* ---------------------------------------------------- 1. phone identity */
{
  const canonical = '989123456789';
  const spellings = [
    '09123456789',
    '9123456789',
    '+989123456789',
    '00989123456789',
    '0912 345 6789',
    '0912-345-6789',
    '۰۹۱۲۳۴۵۶۷۸۹', // Persian digits
    '٠٩١٢٣٤٥٦٧٨٩', // Arabic-Indic digits
    ' 0912.345.6789 ',
  ];
  for (const s of spellings) {
    check(normalizePhone(s) === canonical, `one identity for ${s}`, String(normalizePhone(s)));
  }

  /* Anything that is not an Iranian mobile must be rejected outright rather
     than stored in a half-normalised form that no later lookup will match. */
  for (const bad of ['', null, undefined, 0, '0912345678', '091234567890', '02122578242', '+1 555 0100', 'not a phone', '98812345678']) {
    check(normalizePhone(bad) === null, `rejected: ${JSON.stringify(bad)}`, String(normalizePhone(bad)));
  }

  check(toLocalPhone('989123456789') === '09123456789', 'wire format is 09xxxxxxxxx');
  check(toLocalPhone('nonsense') === null, 'wire format of a bad number is null');
  check(maskPhone('989123456789') === '0912•••789', 'masked for display', maskPhone('989123456789'));
  check(!maskPhone('989123456789').includes('3456'), 'mask hides the middle digits');
}

/* --------------------------------------------- 2. the key stays on the server */
{
  const stored = normalizeSms({ provider: 'smsir', apiKey: 'SECRET-KEY-ABCD1234', lineNumber: '30007' });

  const shown = publicSmsSettings(stored);
  check(!JSON.stringify(shown).includes('SECRET-KEY'), 'API key is not serialised to the admin client');
  check(shown.apiKey === maskKey(stored.apiKey), 'admin sees a mask');
  check(shown.hasApiKey === true, 'admin is told a key exists');
  check(publicSmsSettings({}).hasApiKey === false, 'empty config reports no key');

  /* The form round-trip: the browser posts back what it was shown. */
  const resaved = mergeSmsSettings(stored, { ...shown, lineNumber: '30008' });
  check(resaved.apiKey === 'SECRET-KEY-ABCD1234', 'saving the form with the mask keeps the stored key');
  check(resaved.lineNumber === '30008', 'other fields still save');

  const replaced = mergeSmsSettings(stored, { apiKey: 'NEW-KEY-9999' });
  check(replaced.apiKey === 'NEW-KEY-9999', 'a real new key replaces the old one');

  const blanked = mergeSmsSettings(stored, { apiKey: '' });
  check(blanked.apiKey === 'SECRET-KEY-ABCD1234', 'an empty field is "unchanged", not "delete"');

  check(maskKey('') === '', 'no key, no mask');
  check(maskKey('abc').startsWith(SECRET_MASK), 'a short key is not partly revealed');
  check(!maskKey('SECRET-KEY-ABCD1234').includes('SECRET'), 'the mask never contains the head of the key');
}

/* ------------------------------------------------------ 3. configuration */
{
  check(normalizeSms({}).provider === 'log', 'default provider sends nothing');
  check(normalizeSms({ provider: 'carrier-pigeon' }).provider === 'log', 'unknown provider falls back to log');
  check(normalizeSms({ environment: 'staging' }).environment === 'sandbox', 'unknown environment falls back to sandbox');
  check(normalizeSms({}).dailyCap === 500, 'there is a default daily cap');
  check(normalizeSms({ dailyCap: -5 }).dailyCap === 0, 'a negative cap cannot be stored');
  check(normalizeSms({ verifyTemplateId: '12345' }).verifyTemplateId === 12345, 'template ids coerce to numbers');
  check(normalizeSms({ verifyTemplateId: 'abc' }).verifyTemplateId === 0, 'a non-numeric template id is zero, not NaN');
  check(normalizeSms({ statusTemplateId: '24680' }).statusTemplateId === 24680, 'shipment template id is persisted as a number');
  check(normalizeSms({ statusTemplateId: '' }).statusTemplateId === 0, 'blank shipment template id remains an empty fallback');
  check(normalizeSms({}).onStatus === false, 'shipment notifications are opt-in');

  check(smsReadiness({ provider: 'log' }).ready === true, 'the log provider is always ready');
  const half = smsReadiness({ provider: 'smsir', apiKey: 'k' });
  check(half.ready === false, 'smsir without a line number is not ready');
  check(half.missing.includes('lineNumber'), 'the admin is told which field is missing');
  check(smsReadiness({ provider: 'smsir', apiKey: 'k', lineNumber: '3000' }).ready === true, 'fully configured is ready');
}

/* ------------------------------------------------------- 4. the message */
{
  const order = { code: 'KY-1404-0007', token: 'abc123', total: 9100000 };
  const url = orderStatusUrl('https://khuzestanyeast-co.com/', order);
  check(url === 'https://khuzestanyeast-co.com/shop/order/KY-1404-0007?token=abc123', 'status url', url);
  check(!url.includes('//shop'), 'a trailing slash on the origin does not double up');

  const text = orderSmsText(order, url);
  check(text.includes(order.code), 'the code is in the message');
  check(text.includes(url), 'the link is in the message');
  /* The token is the only thing protecting the tracking page, so the link
     must carry it — a message without it is useless to the customer. */
  check(text.includes('token=abc123'), 'the link carries the order token');
  check(text.includes('۹٬۱۰۰٬۰۰۰') || /[۰-۹]/.test(text), 'the amount is in Persian digits');

  const shipped = shipmentSmsText(order);
  check(shipped.includes(order.code), 'the shipment message includes the order code');
  check(shipped.includes('ارسال شد'), 'the shipment message names the shipped milestone');

  const enabled = { onStatus: true };
  check(shouldSendShipmentSms('paid', 'shipped', enabled), 'paid to shipped sends the one follow-up message');
  check(shouldSendShipmentSms('pending_payment', 'shipped', enabled), 'any real transition into shipped may notify');
  check(!shouldSendShipmentSms('shipped', 'shipped', enabled), 'saving an already-shipped order does not resend');
  check(!shouldSendShipmentSms('paid', 'delivered', enabled), 'delivered does not send a status message');
  check(!shouldSendShipmentSms('pending_payment', 'paid', enabled), 'paid does not send a status message');
  check(!shouldSendShipmentSms('shipped', 'cancelled', enabled), 'cancelled does not send a status message');
  check(!shouldSendShipmentSms('paid', 'shipped', { onStatus: false }), 'disabled shipment notifications stay quiet');
}

/* ------------------------------------- 5. only after successful payment */
{
  const dbStore = await import(pathToFileURL(path.join(ROOT, 'server/db.js')).href);
  const { createShopRouter } = await import(pathToFileURL(path.join(ROOT, 'server/shop.js')).href);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ky-paid-sms-test-'));
  const database = await dbStore.openDB(path.join(dataDir, 'sms.db'));
  const account = {
    id: crypto.randomUUID(),
    phone: '989123456789',
    name: 'خریدار تست',
    email: '',
    passHash: 'not-used-in-this-test',
    at: new Date().toISOString(),
  };
  dbStore.insertCustomer(database, account);
  dbStore.setSetting(database, 'shop.sms', {
    provider: 'log',
    onOrder: true,
    onStatus: false,
    orderTemplateId: 13579,
  });

  const verificationCalls = [];
  const paymentVerifier = async (config, provider, params, expectedRial, expectedAuthority) => {
    verificationCalls.push({ config, provider, params, expectedRial, expectedAuthority });
    const ok = String(params.Status || params.status || '').toUpperCase() === 'OK';
    return { ok, refId: ok ? `REF-${verificationCalls.length}` : '' };
  };
  const permit = () => ({ limited: false, retryAfter: 0, finish() {} });
  const router = createShopRouter({
    database,
    requireAuth: (_req, _res, next) => next(),
    rateLimiter: { check: permit, reserve: permit },
    paymentVerifier,
  });
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  dbStore.setSetting(database, 'shop.payment', { provider: 'zarinpal', callbackBase: origin });

  const insertPendingOrder = (label) => {
    const order = {
      id: crypto.randomUUID(),
      code: `KY-PAID-${label}`,
      token: crypto.randomBytes(16).toString('hex'),
      customerId: account.id,
      /* Deliberately different: the SMS must use the verified account phone,
         not a delivery recipient copied into the order. */
      customer: { name: 'گیرنده دیگر', phone: '09120000000' },
      subtotal: 9_100_000,
      shipping: 0,
      total: 9_100_000,
      currency: 'IRR',
      status: 'pending_payment',
      provider: 'zarinpal',
      payAuthority: `A${crypto.randomBytes(18).toString('hex')}`,
      payRef: null,
      adminNote: '',
      at: new Date().toISOString(),
      paidAt: null,
      items: [],
    };
    dbStore.insertOrder(database, order);
    return order;
  };
  const orderLogs = (ref) => dbStore.listSmsLog(database, 50)
    .filter((row) => row.kind === 'order' && row.ref === ref);
  const waitForOrderLogs = async (ref, count) => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const rows = orderLogs(ref);
      if (rows.length >= count) return rows;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return orderLogs(ref);
  };

  try {
    const manualOnlineOrder = insertPendingOrder('MANUAL-ONLINE');
    const manualPaid = await fetch(`${origin}/api/shop-admin/orders/${manualOnlineOrder.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paid' }),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    check(
      manualPaid.ok && orderLogs(manualOnlineOrder.code).length === 0,
      'a manual paid edit on an online order cannot impersonate gateway-verified SMS confirmation',
    );

    const callbackOrder = insertPendingOrder('CALLBACK');
    check(orderLogs(callbackOrder.code).length === 0, 'a pending order has no order-registered SMS');
    const callbackUrl =
      `${origin}/api/shop-pay/zarinpal/callback?code=${encodeURIComponent(callbackOrder.code)}` +
      `&Authority=${encodeURIComponent(callbackOrder.payAuthority)}&Status=OK`;
    const paid = await fetch(callbackUrl, { redirect: 'manual' });
    const paidLogs = await waitForOrderLogs(callbackOrder.code, 1);
    check(paid.status === 302 && /[?&]pay=ok/.test(paid.headers.get('location') || ''), 'successful payment returns to the success page');
    check(dbStore.getOrderById(database, callbackOrder.id)?.status === 'paid', 'successful verification settles the order before SMS');
    check(paidLogs.length === 1, 'successful gateway payment sends one order-registered SMS', `got ${paidLogs.length}`);
    check(paidLogs[0]?.phone === account.phone, 'payment SMS uses the verified account phone');
    check(paidLogs[0]?.text.includes(`token=${callbackOrder.token}`), 'payment SMS carries the private tracking link');
    check(
      verificationCalls[0]?.provider === 'zarinpal' &&
        verificationCalls[0]?.expectedRial === callbackOrder.total &&
        verificationCalls[0]?.expectedAuthority === callbackOrder.payAuthority,
      'payment must be verified against the stored amount and authority before SMS',
    );

    await fetch(callbackUrl, { redirect: 'manual' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    check(verificationCalls.length === 1, 'an idempotent paid callback does not verify or notify again');
    check(orderLogs(callbackOrder.code).length === 1, 'refreshing the successful callback does not duplicate the SMS');

    const failedOrder = insertPendingOrder('FAILED');
    const failed = await fetch(
      `${origin}/api/shop-pay/zarinpal/callback?code=${encodeURIComponent(failedOrder.code)}` +
        `&Authority=${encodeURIComponent(failedOrder.payAuthority)}&Status=NOK`,
      { redirect: 'manual' },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    check(failed.status === 302 && /[?&]pay=fail/.test(failed.headers.get('location') || ''), 'failed payment returns to the failure page');
    check(dbStore.getOrderById(database, failedOrder.id)?.status === 'pending_payment', 'failed verification cannot mark an order paid');
    check(orderLogs(failedOrder.code).length === 0, 'failed payment never sends the order-registered SMS');

    const lateOrder = insertPendingOrder('LATE');
    dbStore.updateOrder(database, lateOrder.id, { status: 'cancelled', autoCancelled: true });
    const late = await fetch(
      `${origin}/api/shop-pay/zarinpal/callback?code=${encodeURIComponent(lateOrder.code)}` +
        `&Authority=${encodeURIComponent(lateOrder.payAuthority)}&Status=OK`,
      { redirect: 'manual' },
    );
    const lateLogs = await waitForOrderLogs(lateOrder.code, 1);
    check(late.status === 302 && dbStore.getOrderById(database, lateOrder.id)?.status === 'paid', 'a verified late payment that reclaims inventory is successful');
    check(lateLogs.length === 1, 'a successfully recovered late payment sends the order-registered SMS');

    const recoveredOrder = insertPendingOrder('RECOVERED');
    const recovered = await fetch(
      `${origin}/api/shop-admin/payment/unverified/${encodeURIComponent(recoveredOrder.payAuthority)}/verify`,
      { method: 'POST' },
    );
    const recoveredLogs = await waitForOrderLogs(recoveredOrder.code, 1);
    check(recovered.ok && dbStore.getOrderById(database, recoveredOrder.id)?.status === 'paid', 'Admin recovery can settle a successfully verified payment');
    check(recoveredLogs.length === 1, 'a recovered successful payment sends the order-registered SMS');
    await fetch(
      `${origin}/api/shop-admin/payment/unverified/${encodeURIComponent(recoveredOrder.payAuthority)}/verify`,
      { method: 'POST' },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    check(orderLogs(recoveredOrder.code).length === 1, 'rechecking a recovered paid order does not duplicate the SMS');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

/* ---------------------------------------------------- 6. sending, safely */
{
  const cfg = { provider: 'smsir', apiKey: 'k', lineNumber: '3000' };

  /* The one property the order path depends on. */
  const exploding = {
    verify: () => {
      throw new Error('socket hang up');
    },
    bulk: () => {
      throw new Error('socket hang up');
    },
  };
  const out = await sendSms(cfg, { to: '09123456789', text: 'hi' }, { transport: exploding });
  check(out.ok === false, 'a transport that throws yields a failure, not an exception');
  check(out.error.includes('socket hang up'), 'the reason is preserved', out.error);

  const rejecting = { bulk: () => Promise.reject(new Error('ENOTFOUND api.sms.ir')), verify: () => Promise.reject(new Error('x')) };
  const out2 = await sendSms(cfg, { to: '09123456789', text: 'hi' }, { transport: rejecting });
  check(out2.ok === false, 'a rejected promise yields a failure too');

  /* sms.ir answers 200 with a status field; a non-1 status is a failure
     however healthy the HTTP call looked. */
  const refusing = { bulk: async () => ({ data: { status: 110, message: 'template not approved' } }), verify: async () => ({}) };
  const out3 = await sendSms(cfg, { to: '09123456789', text: 'hi' }, { transport: refusing });
  check(out3.ok === false, 'status 110 is not a success');
  check(out3.error.includes('template not approved'), 'the provider message reaches the log', out3.error);

  const good = { bulk: async () => ({ data: { status: 1, data: { messageId: 42 } } }), verify: async () => ({}) };
  const out4 = await sendSms(cfg, { to: '۰۹۱۲۳۴۵۶۷۸۹' }, { transport: good });
  check(out4.ok === true, 'status 1 is a success');
  check(out4.messageId === 42, 'the provider message id is kept for the report');
  check(out4.to === '989123456789', 'the logged number is canonical even when typed in Persian');

  /* A verification code must use the template endpoint: free text with a
     code in it gets filtered by the operators. */
  let usedVerify = false;
  const spy = {
    verify: async (mobile, templateId, params) => {
      usedVerify = true;
      check(mobile === '09123456789', 'the template send receives the local format', mobile);
      check(templateId === 777, 'the configured template id is used', String(templateId));
      check(Array.isArray(params) && params[0].name === 'CODE', 'parameters are passed through');
      return { data: { status: 1, data: { messageId: 'm1' } } };
    },
    bulk: async () => ({ data: { status: 1 } }),
  };
  await sendSms(cfg, { to: '09123456789', templateId: 777, params: [{ name: 'CODE', value: '12345' }] }, { transport: spy });
  check(usedVerify, 'a templated message goes through the verification endpoint');

  /* Fail closed, before any network call. */
  const unconfigured = await sendSms({ provider: 'smsir' }, { to: '09123456789', text: 'hi' }, { transport: good });
  check(unconfigured.ok === false, 'an unconfigured provider does not pretend to send');
  check(unconfigured.error.includes('not configured'), 'and says so', unconfigured.error);

  const badNumber = await sendSms(cfg, { to: '02122578242', text: 'hi' }, { transport: good });
  check(badNumber.ok === false, 'a landline is refused before the provider is called');

  /* The default provider must be safe to run anywhere, including CI. */
  const logged = await sendSms({ provider: 'log' }, { to: '09123456789', text: 'hello' });
  check(logged.ok === true, 'the log provider reports success');
  check(logged.provider === 'log', 'and is identifiable in the log row');
  check(logged.text === 'hello', 'the body is recorded so it can be inspected in development');
}

console.log(`${pass}/${pass + fail}`);
if (fail) process.exitCode = 1;
