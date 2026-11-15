/* ==========================================================================
   Payment-verification security checks.

   These guard the money path. Two classes of bug are covered:

   1. Amount verification must FAIL CLOSED. An earlier version asked
      `Number.isFinite(paid) && paid !== expected`, which SKIPS the comparison
      when the gateway response omits `amount` or sends something unparseable.
      A gateway (or anyone able to spoof one) could then settle a 910,000 rial
      order having collected nothing at all.

   2. Callback origins must not come from the client's Host header, or a
      forged host could redirect gateway customers and SMS links off-site.
   ========================================================================== */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';

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

/* ---- 1. amount verification ---------------------------------------------- */

/* import() needs a URL, not a filesystem path: on Windows an absolute path
   starts with a drive letter and Node rejects it as an unknown "c:" scheme
   (ERR_UNSUPPORTED_ESM_URL_SCHEME). pathToFileURL works on every platform. */
const { verifyPayment } = await import(pathToFileURL(path.join(ROOT, 'server', 'payment.js')).href);
const { isTrustedCallbackBase, safeOrigin } = await import(pathToFileURL(path.join(ROOT, 'server', 'siteOrigin.js')).href);
/* Orders are priced in rial, and ZarinPal is billed in rial. There is no
   conversion left anywhere in this file — that is the point. */
const EXPECTED_RIAL = 910000;

/* The SDK validates this as a UUID and throws on anything else. */
const MERCHANT = '0123abcd-4567-89ef-0123-456789abcdef';
const AUTHORITY = `A${'0'.repeat(35)}`;

/* A stand-in for the SDK. Nothing here touches the network, which is the
   only reason the gateway paths can be tested at all. */
const fakeZarinpal = (verifyBody, createBody) => ({
  payments: {
    create: async (data) => {
      fakeZarinpal.lastCreate = data;
      return createBody ? createBody(data) : { data: { code: 100, authority: AUTHORITY } };
    },
    getRedirectUrl: (a) => `https://www.zarinpal.com/pg/StartPay/${a}`,
  },
  verifications: {
    verify: async (data) => {
      fakeZarinpal.lastVerify = data;
      return verifyBody(data);
    },
  },
});

/* ZARINPAL. Amounts are RIAL now, and the verify response does not echo an
   amount — so "amount omitted" must SETTLE, where the old toman-based code
   refused it. That refusal would have rejected every genuine payment the
   shop ever took, because the real API never sends the field. */
const ZARINPAL_CASES = [
  ['amount absent from the response (the real API shape)', undefined, true],
  ['amount echoed and correct', EXPECTED_RIAL, true],
  ['amount echoed as a correct string', String(EXPECTED_RIAL), true],
  ['amount echoed but underpaid', 1, false],
  ['amount echoed but overpaid', EXPECTED_RIAL * 2, false],
  ['amount echoed in toman instead of rial', EXPECTED_RIAL / 10, false],
  ['amount echoed as nonsense', 'abc', false],
  ['amount echoed as an array', [EXPECTED_RIAL], false],
  ['amount echoed as an object', { v: EXPECTED_RIAL }, false],
];

for (const [name, amount, shouldSettle] of ZARINPAL_CASES) {
  const z = fakeZarinpal(() => {
    const data = { code: 100, ref_id: 'R1' };
    if (amount !== undefined) data.amount = amount;
    return { data };
  });
  const res = await verifyPayment(
    { provider: 'zarinpal', zarinpalMerchant: MERCHANT },
    'zarinpal',
    { Authority: AUTHORITY, Status: 'OK' },
    EXPECTED_RIAL,
    AUTHORITY,
    { zarinpal: z },
  );
  check(Boolean(res.ok) === shouldSettle, `zarinpal: ${name}`, `ok=${res.ok} expected ${shouldSettle}`);
}

/* The amount we ask ZarinPal to verify must come from our own database and
   be in rial — that is what makes a tampered callback harmless. */
{
  const z = fakeZarinpal(() => ({ data: { code: 100, ref_id: 'R1' } }));
  await verifyPayment({ provider: 'zarinpal', zarinpalMerchant: MERCHANT }, 'zarinpal', { Authority: AUTHORITY, Status: 'OK' }, EXPECTED_RIAL, AUTHORITY, { zarinpal: z });
  check(fakeZarinpal.lastVerify.amount === EXPECTED_RIAL, 'zarinpal: verify is sent the order total in RIAL', String(fakeZarinpal.lastVerify.amount));
  check(fakeZarinpal.lastVerify.authority === AUTHORITY, 'zarinpal: verify is sent the callback authority');
}

/* Gateway status codes. */
{
  const code = async (c) => {
    const z = fakeZarinpal(() => ({ data: { code: c, ref_id: 'R9' } }));
    return verifyPayment({ provider: 'zarinpal', zarinpalMerchant: MERCHANT }, 'zarinpal', { Authority: AUTHORITY, Status: 'OK' }, EXPECTED_RIAL, AUTHORITY, { zarinpal: z });
  };
  check((await code(100)).ok === true, 'zarinpal: code 100 settles');

  /* card_pan and fee are documented on the verify response and exist
     nowhere else afterwards. */
  {
    const z = fakeZarinpal(() => ({ data: { code: 100, ref_id: 'R1', card_pan: '6219********9007', fee: 4500, fee_type: 'Merchant' } }));
    const out = await verifyPayment({ provider: 'zarinpal', zarinpalMerchant: MERCHANT }, 'zarinpal', { Authority: AUTHORITY, Status: 'OK' }, EXPECTED_RIAL, AUTHORITY, { zarinpal: z });
    check(out.authority === AUTHORITY, 'zarinpal: the original authority remains available after settlement');
    check(out.refId === 'R1', 'zarinpal: ref_id is returned separately from authority', out.refId);
    check(out.cardPan === '6219********9007', 'zarinpal: the masked card is kept', out.cardPan);
    check(out.fee === 4500, 'zarinpal: the gateway fee is kept', String(out.fee));
    check(out.feeType === 'Merchant', 'zarinpal: and who paid it');
  }
  /* 101 is "already verified" — the customer pressed back or the callback
     arrived twice. Failing it would flip a paid order to failed. */
  const repeat = await code(101);
  check(repeat.ok === true, 'zarinpal: code 101 (already verified) settles, idempotently');
  check(repeat.alreadyVerified === true, 'zarinpal: and says it was a repeat');
  for (const bad of [-9, 51, 54, 0]) {
    check((await code(bad)).ok === false, `zarinpal: code ${bad} does not settle`);
  }
}

/* Critical regression: three equal-total orders must not be able to spend one
   authority three times. The gateway returns 100 for the first verification
   and would return its documented 101 for every later call, exactly like a
   previously verified real payment. Mismatched orders are rejected before the
   client is called; a repeat for the original order remains idempotent. */
{
  const orderAuthorities = [AUTHORITY, `A${'1'.repeat(35)}`, `A${'2'.repeat(35)}`];
  let gatewayCalls = 0;
  const z = fakeZarinpal(() => ({
    data: { code: gatewayCalls++ === 0 ? 100 : 101, ref_id: 'ONLY-ONE-PAYMENT' },
  }));
  const verifyFor = (storedAuthority) =>
    verifyPayment(
      { provider: 'zarinpal', zarinpalMerchant: MERCHANT },
      'zarinpal',
      { Authority: AUTHORITY, Status: 'OK' },
      EXPECTED_RIAL,
      storedAuthority,
      { zarinpal: z },
    );

  const first = await verifyFor(orderAuthorities[0]);
  const stolenSecond = await verifyFor(orderAuthorities[1]);
  const stolenThird = await verifyFor(orderAuthorities[2]);
  const repeatOriginal = await verifyFor(orderAuthorities[0]);

  check(first.ok === true, 'authority binding: the original equal-total order settles');
  check(
    stolenSecond.ok === false && stolenSecond.authorityMismatch === true &&
      stolenThird.ok === false && stolenThird.authorityMismatch === true,
    'authority binding: the same authority cannot settle two other equal-total orders',
  );
  check(gatewayCalls === 2, 'authority binding: mismatches never reach the gateway', String(gatewayCalls));
  check(repeatOriginal.ok === true && repeatOriginal.alreadyVerified, 'authority binding: code 101 stays idempotent for the original order');
}

/* A cancelled payment never reaches the gateway at all. */
{
  let called = false;
  const z = fakeZarinpal(() => {
    called = true;
    return { data: { code: 100 } };
  });
  const res = await verifyPayment({ provider: 'zarinpal', zarinpalMerchant: MERCHANT }, 'zarinpal', { Authority: AUTHORITY, Status: 'NOK' }, EXPECTED_RIAL, AUTHORITY, { zarinpal: z });
  check(res.ok === false, 'zarinpal: Status=NOK does not settle');
  check(called === false, 'zarinpal: and a cancelled payment is not even sent for verification');
}

/* IDPAY still settles in toman — its amounts, and only its amounts, are
   divided by ten. It does echo the amount, so the strict check stays. */
/* IDPay is gone. An unknown provider must settle nothing, rather than
   falling through to a default that says yes. */
{
  const gone = await verifyPayment({ provider: 'idpay', idpayApiKey: 'k' }, 'idpay', { id: 'I1', status: '200' }, EXPECTED_RIAL);
  check(gone.ok === false, 'a removed provider cannot settle an order');
  const { PROVIDERS } = await import(pathToFileURL(path.join(ROOT, 'server', 'payment.js')).href);
  check(PROVIDERS.join(',') === 'offline,zarinpal', 'the provider list is offline and zarinpal only', PROVIDERS.join(','));
}

/* ---- 1b. the request side: units, minimums and credentials ------------- */
{
  const { createPayment, isZarinpalMerchant, publicPayment, mergePayment, ZARINPAL_MIN_RIAL } = await import(
    pathToFileURL(path.join(ROOT, 'server', 'payment.js')).href
  );

  const order = { code: 'KY-1', total: EXPECTED_RIAL, customer: { phone: '09123456789', email: 'a@b.co' } };
  const z = fakeZarinpal(() => ({ data: { code: 100 } }));
  const out = await createPayment({ provider: 'zarinpal', zarinpalMerchant: MERCHANT }, order, { origin: 'https://example.com', deps: { zarinpal: z } });

  /* The unit bug this rewrite exists to fix: the shop stores rial, and the
     old client sent total/10 with no currency field. */
  check(fakeZarinpal.lastCreate.amount === EXPECTED_RIAL, 'zarinpal: the request carries the order total in RIAL, not toman', String(fakeZarinpal.lastCreate.amount));
  check(fakeZarinpal.lastCreate.currency === 'IRR', 'zarinpal: the currency is stated explicitly');
  check(out.payUrl.includes(AUTHORITY), 'zarinpal: the pay URL carries the authority', out.payUrl);
  check(out.authority === AUTHORITY, 'zarinpal: creation returns authority under an unambiguous field');
  check(out.provider === 'zarinpal', 'zarinpal: the provider is reported');
  check(fakeZarinpal.lastCreate.callback_url.startsWith('https://example.com/api/shop-pay/zarinpal/callback'), 'zarinpal: the callback returns to our own origin');

  /* The SDK throws on a mobile that is not 09xxxxxxxxx, which must never
     take checkout down over an optional field. */
  for (const [phone, expected] of [
    ['09123456789', '09123456789'],
    ['989123456789', '09123456789'],
    ['۰۹۱۲۳۴۵۶۷۸۹', '09123456789'],
    ['02122578242', undefined],
    ['', undefined],
  ]) {
    await createPayment({ provider: 'zarinpal', zarinpalMerchant: MERCHANT }, { ...order, customer: { phone } }, { origin: 'https://e.com', deps: { zarinpal: z } });
    check(fakeZarinpal.lastCreate.mobile === expected, `zarinpal: mobile ${JSON.stringify(phone)} → ${expected}`, String(fakeZarinpal.lastCreate.mobile));
  }

  /* Zero is never an order: reject it before provider selection so even an
     offline/misconfigured gateway cannot turn a free cart into a durable
     payment attempt. */
  let zeroError = '';
  try {
    await createPayment({ provider: 'offline' }, { ...order, total: 0 }, { origin: 'https://e.com' });
  } catch (e) {
    zeroError = e.message;
  }
  check(zeroError.includes('greater than zero'), 'a zero-total payment is rejected before the gateway', zeroError);

  /* Below the gateway minimum, and with an unusable merchant id, checkout
     must degrade to an offline order rather than erroring out. */
  let threw = '';
  try {
    await createPayment({ provider: 'zarinpal', zarinpalMerchant: MERCHANT }, { ...order, total: 500 }, { origin: 'https://e.com', deps: { zarinpal: z } });
  } catch (e) {
    threw = e.message;
  }
  check(threw.includes('minimum'), 'zarinpal: an amount under the gateway minimum is refused by name', threw);
  check(ZARINPAL_MIN_RIAL === 10000, 'zarinpal: the minimum is the documented 10,000 rial');

  const unusable = await createPayment({ provider: 'zarinpal', zarinpalMerchant: 'not-a-uuid' }, order, { origin: 'https://e.com', deps: { zarinpal: z } });
  check(unusable.provider === 'offline', 'a malformed merchant id degrades to an offline order');
  check(unusable.payUrl === null, 'and offers no pay URL');
  check(isZarinpalMerchant(MERCHANT) === true, 'a real UUID merchant id is accepted');
  check(isZarinpalMerchant('test-merchant') === false, 'the old test- prefix is not a valid merchant id');

  /* Credentials are write-only in the admin API. */
  const stored = { provider: 'zarinpal', zarinpalMerchant: MERCHANT, zarinpalAccessToken: 'ACCESS-TOKEN-SECRET', zarinpalTerminalId: 'T1' };
  const shown = publicPayment(stored);
  check(!JSON.stringify(shown).includes(MERCHANT), 'the merchant id is not serialised to the admin client');
  check(!JSON.stringify(shown).includes('ACCESS-TOKEN-SECRET'), 'nor the access token');
  check(shown.hasZarinpalMerchant === true && shown.zarinpalMerchantValid === true, 'but the admin is told it is set and valid');
  check(shown.canPay === true, 'and that the gateway can take payments');
  check(shown.canLedger === true, 'and that the ledger is available');
  check(publicPayment({ provider: 'zarinpal', zarinpalMerchant: MERCHANT }).canLedger === false, 'no access token, no ledger');
  check(publicPayment({ provider: 'offline' }).canPay === false, 'an offline shop cannot take payments');

  const resaved = mergePayment(stored, { ...shown, zarinpalSandbox: true });
  check(resaved.zarinpalMerchant === MERCHANT, 'saving the form with the mask keeps the stored merchant id');
  check(resaved.zarinpalAccessToken === 'ACCESS-TOKEN-SECRET', 'and the stored access token');
  check(resaved.zarinpalSandbox === true, 'while other fields still save');
}

/* ---- 1b2. what the SDK constructor is actually given -------------------
   Tested because it was wrong and nothing caught it: every other test
   injects a ready-made client, so the line that builds the real one was
   never exercised. The access token lives here, and without it every
   GraphQL call — the ledger, refunds, refund status — authenticates as
   `Bearer undefined`. */
{
  const {
    applyZarinpalTimeouts,
    zarinpalConfig,
    ZARINPAL_REQUEST_TIMEOUT_MS,
  } = await import(pathToFileURL(path.join(ROOT, 'server', 'payment.js')).href);

  const plain = zarinpalConfig({ zarinpalMerchant: MERCHANT, zarinpalSandbox: true });
  check(plain.merchantId === MERCHANT, 'config: the merchant id is passed');
  check(plain.sandbox === true, 'config: sandbox is passed');
  check(!('accessToken' in plain), 'config: no token configured means no token key at all');

  const withToken = zarinpalConfig({ zarinpalMerchant: MERCHANT, zarinpalAccessToken: 'tok-123' });
  check(withToken.accessToken === 'tok-123', 'config: the access token reaches the SDK');
  check(withToken.sandbox === false, 'config: sandbox defaults off');

  /* An empty string is worse than an absent key: the SDK interpolates it
     into the Authorization header unconditionally. */
  check(!('accessToken' in zarinpalConfig({ zarinpalMerchant: MERCHANT, zarinpalAccessToken: '' })), 'config: an empty token is omitted, not sent blank');
  check(!('accessToken' in zarinpalConfig({ zarinpalMerchant: MERCHANT, zarinpalAccessToken: '   ' })), 'config: nor a whitespace one');

  const transports = { httpClient: { defaults: {} }, graphqlClient: { defaults: {} } };
  check(
    applyZarinpalTimeouts(transports) === transports &&
      transports.httpClient.defaults.timeout === ZARINPAL_REQUEST_TIMEOUT_MS &&
      transports.graphqlClient.defaults.timeout === ZARINPAL_REQUEST_TIMEOUT_MS,
    'config: REST and GraphQL gateway transports cannot wait forever',
    JSON.stringify(transports),
  );

  const {
    PAYMENT_VERIFICATION_AUTO_RETRY_LIMIT,
    paymentVerificationRetryPlan,
    retryablePaymentVerificationResponse,
  } = await import(pathToFileURL(path.join(ROOT, 'server', 'shop.js')).href);
  const headers = {};
  const retry = { code: 0, type: '', body: '', released: 0, logs: 0 };
  const response = {
    setHeader(name, value) { headers[name.toLowerCase()] = String(value); },
    status(code) { retry.code = code; return this; },
    type(value) { retry.type = value; return this; },
    send(value) { retry.body = String(value); return this; },
  };
  const retryPlan = paymentVerificationRetryPlan(
    '/api/shop-pay/zarinpal/callback?code=KY-1&Authority=A123&Status=OK',
  );
  retryablePaymentVerificationResponse(response, {
    releaseReservation: () => { retry.released += 1; },
    error: new Error('simulated gateway timeout'),
    logger: { error() { retry.logs += 1; } },
    retryPlan,
  });
  check(
    retry.code === 503 &&
      retry.type === 'html' &&
      retry.released === 1 &&
      retry.logs === 1 &&
      headers['retry-after'] === '5' &&
      headers['cache-control']?.includes('no-store') &&
      !('location' in headers) &&
      /http-equiv="refresh" content="5;url=/.test(retry.body) &&
      retry.body.includes('Authority=A123') &&
      retry.body.includes('_kyVerifyRetry=1') &&
      retry.body.includes('دوباره پرداخت نکنید'),
    'callback: an ambiguous verification timeout releases capacity and retries the same authority',
    JSON.stringify({ retry, headers, retryPlan }),
  );

  const terminalHeaders = {};
  const terminal = { code: 0, body: '' };
  const terminalResponse = {
    setHeader(name, value) { terminalHeaders[name.toLowerCase()] = String(value); },
    status(code) { terminal.code = code; return this; },
    type() { return this; },
    send(value) { terminal.body = String(value); return this; },
  };
  const terminalPlan = paymentVerificationRetryPlan(
    `/api/shop-pay/zarinpal/callback?code=KY-1&Authority=A123&Status=OK&_kyVerifyRetry=${PAYMENT_VERIFICATION_AUTO_RETRY_LIMIT}`,
  );
  retryablePaymentVerificationResponse(terminalResponse, {
    logger: { error() {} },
    retryPlan: terminalPlan,
  });
  check(
    terminal.code === 503 &&
      !terminal.body.includes('http-equiv="refresh"') &&
      !('retry-after' in terminalHeaders) &&
      terminal.body.includes('بررسی خودکار') &&
      terminal.body.includes('متوقف شد') &&
      terminal.body.includes('بررسی دوباره همین پرداخت') &&
      !terminalPlan.manualUrl.includes('_kyVerifyRetry'),
    'callback: automatic verification retries stop at a finite limit and leave a manual action',
    JSON.stringify({ terminal, terminalHeaders, terminalPlan }),
  );

  const fallbackHtml = fs.readFileSync(path.join(ROOT, 'ops', 'payment-callback-unavailable.html'), 'utf8');
  const fallbackScript = fallbackHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1] || '';
  const fallbackHash = `sha256-${crypto.createHash('sha256').update(fallbackScript).digest('base64')}`;
  const deploymentGuide = fs.readFileSync(path.join(ROOT, 'docs', 'khyeast-linux-deployment-guide.html'), 'utf8');
  check(
    !fallbackHtml.includes('http-equiv="refresh"') &&
      fallbackScript.includes('const limit = 6') &&
      fallbackScript.includes('sessionStorage') &&
      fallbackScript.includes('location.reload()') &&
      fallbackHtml.includes('بررسی دوباره همین پرداخت'),
    'callback: the Nginx outage page also bounds automatic retries and exposes a manual action',
  );
  const runFallbackScript = ({ stored = null, failWrite = false } = {}) => {
    const timers = [];
    const writes = [];
    const status = { textContent: '' };
    const retryLink = { hidden: true, addEventListener() {} };
    const location = { pathname: '/api/shop-pay/zarinpal/callback', search: '?Authority=A123', reload() {} };
    vm.runInNewContext(fallbackScript, {
      location,
      document: { getElementById: (id) => (id === 'retry-status' ? status : retryLink) },
      sessionStorage: {
        getItem: () => (stored ? JSON.stringify(stored) : null),
        setItem: (_key, value) => {
          if (failWrite) throw new Error('storage denied');
          writes.push(JSON.parse(value));
        },
        removeItem() {},
      },
      window: { setTimeout: (_callback, delay) => timers.push(delay) },
    });
    return { timers, writes, status, retryLink };
  };
  const fallbackFirst = runFallbackScript();
  check(
    fallbackFirst.timers.join() === '5000' &&
      fallbackFirst.writes[0]?.attempt === 1 &&
      fallbackFirst.retryLink.hidden === true,
    'callback: the static fallback schedules exactly one counted retry per response',
  );
  const fallbackTerminal = runFallbackScript({ stored: { attempt: 6, at: Date.now() } });
  check(
    fallbackTerminal.timers.length === 0 &&
      fallbackTerminal.retryLink.hidden === false &&
      fallbackTerminal.status.textContent.includes('متوقف شد'),
    'callback: the static fallback stops after six retries',
  );
  const fallbackNoStorage = runFallbackScript({ failWrite: true });
  check(
    fallbackNoStorage.timers.length === 0 && fallbackNoStorage.retryLink.hidden === false,
    'callback: unavailable session storage fails safe to the manual action',
  );
  check(
    deploymentGuide.includes(fallbackHash),
    'callback: the deployment CSP permits only the exact reviewed fallback script hash',
    fallbackHash,
  );
}

/* ---- 1c. the rest of the gateway: inquiry, unverified, reverse, fee ---- */
{
  const {
    inquirePayment,
    listUnverified,
    reversePayment,
    listTransactions,
    calculateFee,
  } = await import(pathToFileURL(path.join(ROOT, 'server', 'payment.js')).href);

  const CFG = { provider: 'zarinpal', zarinpalMerchant: MERCHANT };
  const client = (over) => ({
    payments: { create: async () => ({}), getRedirectUrl: (a) => a },
    verifications: { verify: async () => ({}) },
    inquiries: { inquire: async () => ({ data: { code: 100, status: 'VERIFIED', message: 'ok' } }) },
    unverified: { list: async () => ({ data: { code: 100, authorities: [] } }) },
    reversals: { reverse: async () => ({ data: { code: 100, message: 'ok' } }) },
    transactions: { list: async () => ({ data: { transactions: [] } }) },
    request: async () => ({ data: { code: 100, amount: 1000000, fee: 40000, fee_type: 'Merchant' } }),
    ...over,
  });

  /* Every one of these is called from an admin screen. None may throw: a
     panel that shows a stack trace because a terminal is misconfigured is
     worse than one that says what is wrong. */
  const exploding = {
    inquiries: { inquire: () => { throw new Error('ECONNRESET'); } },
    unverified: { list: () => Promise.reject(new Error('ETIMEDOUT')) },
    reversals: { reverse: () => { throw new Error('boom'); } },
    transactions: { list: () => Promise.reject(new Error('gone')) },
    request: () => { throw new Error('nope'); },
  };
  const LEDGER = { ...CFG, zarinpalAccessToken: 'tok', zarinpalTerminalId: 'T1' };
  for (const [name, call] of [
    ['inquiry', () => inquirePayment(CFG, AUTHORITY, { zarinpal: client(exploding) })],
    ['unverified', () => listUnverified(CFG, { zarinpal: client(exploding) })],
    ['reverse', () => reversePayment(CFG, AUTHORITY, { zarinpal: client(exploding) })],
    ['transactions', () => listTransactions(LEDGER, {}, { zarinpal: client(exploding) })],
    ['fee', () => calculateFee(CFG, 1000000, { zarinpal: client(exploding) })],
  ]) {
    const out = await call();
    check(out.ok === false && Boolean(out.error), `${name}: a transport failure is reported, not thrown`, JSON.stringify(out));
  }

  /* Without a usable merchant id they must refuse before calling out. */
  for (const [name, call] of [
    ['inquiry', () => inquirePayment({ provider: 'zarinpal' }, AUTHORITY, { zarinpal: client() })],
    ['unverified', () => listUnverified({ provider: 'zarinpal' }, { zarinpal: client() })],
    ['reverse', () => reversePayment({ provider: 'zarinpal' }, AUTHORITY, { zarinpal: client() })],
    ['fee', () => calculateFee({ provider: 'zarinpal' }, 1000000, { zarinpal: client() })],
  ]) {
    const out = await call();
    check(out.ok === false, `${name}: refuses without a merchant id`);
  }

  /* INQUIRY — the gateway's own word on whether money was settled. */
  const inq = await inquirePayment(CFG, AUTHORITY, { zarinpal: client() });
  check(inq.ok === true && inq.settled === true, 'inquiry: VERIFIED is reported as settled', JSON.stringify(inq));
  const unpaid = await inquirePayment(CFG, AUTHORITY, {
    zarinpal: client({ inquiries: { inquire: async () => ({ data: { code: 100, status: 'IN_BANK' } }) } }),
  });
  check(unpaid.settled === false, 'inquiry: anything other than VERIFIED is not settled', unpaid.status);

  /* UNVERIFIED — money the customer paid that was never settled. */
  const list = await listUnverified(CFG, {
    zarinpal: client({
      unverified: {
        list: async () => ({ data: { code: 100, authorities: [{ authority: AUTHORITY, amount: 910000 }] } }),
      },
    }),
  });
  check(list.ok === true && list.authorities.length === 1, 'unverified: the list comes back');
  const emptyList = await listUnverified(CFG, {
    zarinpal: client({ unverified: { list: async () => ({ data: { code: 100 } }) } }),
  });
  check(Array.isArray(emptyList.authorities), 'unverified: a response with no array is still an array', typeof emptyList.authorities);

  /* REVERSE — and the documented -62, which means the server IP is not
     registered on the terminal. A bare code there is unhelpful at 3am. */
  const rev = await reversePayment(CFG, AUTHORITY, { zarinpal: client() });
  check(rev.ok === true, 'reverse: code 100 succeeds');
  const noIp = await reversePayment(CFG, AUTHORITY, {
    zarinpal: client({ reversals: { reverse: async () => ({ data: { code: -62 } }) } }),
  });
  check(noIp.ok === false, 'reverse: -62 fails');
  check(noIp.message.includes('آی‌پی'), 'reverse: and -62 is explained in Persian', noIp.message);

  /* TRANSACTIONS — needs credentials the payment path does not. */
  const noToken = await listTransactions(CFG, {}, { zarinpal: client() });
  check(noToken.ok === false, 'transactions: refused without an access token');
  check(noToken.transactions.length === 0, 'and the list is still an array');

  let sentFilter;
  const txClient = client({
    transactions: {
      list: async (d) => {
        sentFilter = d;
        return { data: { transactions: [{ id: '1', status: 'PAID', amount: 910000 }] } };
      },
    },
  });
  const tx = await listTransactions(LEDGER, { filter: 'PAID', limit: 5 }, { zarinpal: txClient });
  check(tx.ok === true && tx.transactions.length === 1, 'transactions: the ledger comes back');
  check(sentFilter.terminalId === 'T1', 'transactions: the configured terminal is used');
  /* The SDK throws on an unknown filter, so one must never reach it. */
  await listTransactions(LEDGER, { filter: 'DROP TABLE' }, { zarinpal: txClient });
  check(sentFilter.filter === undefined, 'transactions: an unknown filter is dropped, not forwarded', String(sentFilter.filter));
  await listTransactions(LEDGER, { limit: 9999 }, { zarinpal: txClient });
  check(sentFilter.limit <= 100, 'transactions: the page size is capped', String(sentFilter.limit));
  await listTransactions(LEDGER, { offset: -5 }, { zarinpal: txClient });
  check(sentFilter.offset === 0, 'transactions: a negative offset is clamped', String(sentFilter.offset));

  /* FEE — documented on payments.feeCalculation, which SDK 2.2.0 does not
     implement, so this falls back to the documented endpoint through the
     SDK's own request(). Both routes must work. */
  let viaRequest = null;
  const feeFallback = await calculateFee(CFG, 1000000, {
    zarinpal: client({
      request: async (method, url, data) => {
        viaRequest = { method, url, data };
        return { data: { code: 100, amount: 1000000, fee: 40000, fee_type: 'Merchant' } };
      },
    }),
  });
  check(feeFallback.ok === true && feeFallback.fee === 40000, 'fee: the fallback endpoint returns a fee', JSON.stringify(feeFallback));
  check(viaRequest.url.includes('feeCalculation'), 'fee: the documented endpoint is used', viaRequest?.url);
  check(viaRequest.data.currency === 'IRR', 'fee: in rial, explicitly');

  let viaSdk = false;
  const feeNative = await calculateFee(CFG, 1000000, {
    zarinpal: client({
      payments: {
        create: async () => ({}),
        getRedirectUrl: (a) => a,
        feeCalculation: async () => {
          viaSdk = true;
          return { data: { code: 100, amount: 1000000, fee: 40000, fee_type: 'Payer' } };
        },
      },
    }),
  });
  check(viaSdk && feeNative.ok === true, 'fee: the SDK method is preferred the moment it exists');
  check(feeNative.feeType === 'Payer', 'fee: who pays the fee is reported', feeNative.feeType);

  const tooSmall = await calculateFee(CFG, 100, { zarinpal: client() });
  check(tooSmall.ok === false, 'fee: below the 1000 rial floor is refused');
}

/* ---- 1d. refunds ------------------------------------------------------- */
{
  const { createRefund, listRefunds, REFUND_METHODS, REFUND_REASONS } = await import(
    pathToFileURL(path.join(ROOT, 'server', 'payment.js')).href
  );

  const LEDGER = { provider: 'zarinpal', zarinpalMerchant: MERCHANT, zarinpalAccessToken: 'tok', zarinpalTerminalId: 'T1' };
  let sent = null;
  const client = (over) => ({
    refunds: {
      create: async (d) => {
        sent = d;
        return { data: { resource: { id: 'RF1', amount: d.amount, timeline: { refund_status: 'IN_PROGRESS' } } } };
      },
      list: async (d) => {
        sent = d;
        return { data: { refunds: [{ id: 'RF1', amount: 910000, status: 'DONE' }] } };
      },
      ...over,
    },
  });

  const ok = await createRefund(LEDGER, { sessionId: 'S1', amount: 910000 }, { zarinpal: client() });
  check(ok.ok === true && ok.id === 'RF1', 'refund: a valid request succeeds', JSON.stringify(ok));
  check(sent.sessionId === 'S1', 'refund: keyed on the session id from the ledger, not an authority');
  check(sent.amount === 910000, 'refund: the amount is rial, like everything else', String(sent.amount));
  check(sent.method === 'PAYA' && sent.reason === 'CUSTOMER_REQUEST', 'refund: sensible defaults are sent');

  /* GraphQL answers 200 with an errors array rather than an HTTP status, so
     a failure looks exactly like a success unless it is checked. */
  const graphqlErr = await createRefund(LEDGER, { sessionId: 'S1', amount: 910000 }, {
    zarinpal: client({ create: async () => ({ errors: [{ message: 'insufficient balance' }] }) }),
  });
  check(graphqlErr.ok === false, 'refund: a GraphQL errors array is a failure, not a success');
  check(graphqlErr.error.includes('insufficient balance'), 'refund: and the reason survives', graphqlErr.error);

  /* The SDK throws on an unknown method or reason, so neither may be
     forwarded from a request body unchecked. */
  for (const [field, body] of [
    ['method', { sessionId: 'S1', amount: 910000, method: 'CASH' }],
    ['reason', { sessionId: 'S1', amount: 910000, reason: 'BECAUSE' }],
  ]) {
    const out = await createRefund(LEDGER, body, { zarinpal: client() });
    check(out.ok === false, `refund: an invalid ${field} is refused before the SDK sees it`, JSON.stringify(out));
  }
  check(REFUND_METHODS.join(',') === 'PAYA,CARD', 'refund: the SDK methods are mirrored');
  check(REFUND_REASONS.length === 4, 'refund: all four reasons are offered', String(REFUND_REASONS.length));

  check((await createRefund(LEDGER, { amount: 910000 }, { zarinpal: client() })).ok === false, 'refund: no session id, no refund');
  /* ZarinPal's documented refund floor is 20,000 rial — not the 1,000 the
     payment side uses, and not the SDK's generic validator. A refund just
     under it must be refused here rather than by the gateway. */
  const { REFUND_MIN_RIAL } = await import(pathToFileURL(path.join(ROOT, 'server', 'payment.js')).href);
  check(REFUND_MIN_RIAL === 20000, 'refund: the floor is the documented 20,000 rial', String(REFUND_MIN_RIAL));
  check((await createRefund(LEDGER, { sessionId: 'S1', amount: 19999 }, { zarinpal: client() })).ok === false, 'refund: one rial under the floor is refused');
  check((await createRefund(LEDGER, { sessionId: 'S1', amount: 20000 }, { zarinpal: client() })).ok === true, 'refund: exactly the floor is allowed');

  /* Refunds use the ledger credentials, not the merchant id. */
  const noToken = await createRefund({ provider: 'zarinpal', zarinpalMerchant: MERCHANT }, { sessionId: 'S1', amount: 910000 }, { zarinpal: client() });
  check(noToken.ok === false, 'refund: refused without an access token');
  check(noToken.error.includes('Access Token'), 'refund: and says which credential is missing', noToken.error);

  const thrown = await createRefund(LEDGER, { sessionId: 'S1', amount: 910000 }, {
    zarinpal: client({ create: () => { throw new Error('ECONNRESET'); } }),
  });
  check(thrown.ok === false && Boolean(thrown.error), 'refund: a transport failure is reported, not thrown');

  /* STATUS — via the documented SessionById query, because GetRefunds is
     not in ZarinPal's published schema and must not be what we rely on to
     answer "did the customer get their money". */
  {
    const { refundStatus } = await import(pathToFileURL(path.join(ROOT, 'server', 'payment.js')).href);
    let asked = null;
    const gql = (res) => ({
      graphql: async (query, variables) => {
        asked = { query, variables };
        return res;
      },
    });

    const done = await refundStatus(LEDGER, '829492417', {
      zarinpal: gql({ data: { Session: [{ id: '829492417', amount: 10000, status: 'PAID', timeline: { refund_status: 'SUCCESS', refund_amount: 10000, refund_time: '2026-02-17T13:35:59+03:30' } } ] } }),
    });
    check(done.ok === true && done.refundStatus === 'SUCCESS', 'refund status: a completed refund is reported', JSON.stringify(done));
    check(done.refundAmount === 10000, 'refund status: with its amount');
    check(asked.query.includes('SessionById'), 'refund status: the documented query is used');
    check(asked.variables.terminal_id === 'T1' && asked.variables.id === '829492417', 'refund status: terminal and session are both sent');

    /* A paid session that has never been refunded has an empty timeline —
       that is "not refunded", not an error. */
    const none = await refundStatus(LEDGER, '1', { zarinpal: gql({ data: { Session: [{ id: '1', amount: 10000, status: 'PAID', timeline: {} }] } }) });
    check(none.ok === true && none.refundStatus === '', 'refund status: an un-refunded session is not an error');

    const missing = await refundStatus(LEDGER, '1', { zarinpal: gql({ data: { Session: [] } }) });
    check(missing.ok === false, 'refund status: an unknown session is reported as not found');

    const errored = await refundStatus(LEDGER, '1', { zarinpal: gql({ errors: [{ message: 'unauthorized' }] }) });
    check(errored.ok === false && errored.error.includes('unauthorized'), 'refund status: a GraphQL errors array is a failure');

    check((await refundStatus(LEDGER, '', { zarinpal: gql({}) })).ok === false, 'refund status: no session id, no lookup');
    check((await refundStatus({ provider: 'zarinpal' }, '1', { zarinpal: gql({}) })).ok === false, 'refund status: needs the ledger credentials');
  }

  const list = await listRefunds(LEDGER, {}, { zarinpal: client() });
  check(list.ok === true && list.refunds.length === 1, 'refund: the list comes back');
  check(sent.terminalId === 'T1', 'refund: the configured terminal is used');
  await listRefunds(LEDGER, { limit: 9999 }, { zarinpal: client() });
  check(sent.limit <= 100, 'refund: the page size is capped', String(sent.limit));
  check((await listRefunds({ provider: 'zarinpal' }, {}, { zarinpal: client() })).refunds.length === 0, 'refund: an unavailable list is still an array');
}

/* ---- 2. callback origin must ignore a hostile Host header ----------------- */
{
  const req = (host, protocol = 'https') => ({
    protocol,
    get: (key) => (key === 'host' ? host : null),
  });
  const good = 'khuzestanyeast-co.com';
  const productionPinned = { NODE_ENV: 'production', PUBLIC_ORIGIN: `https://${good}` };
  check(safeOrigin(req('evil.com'), '', productionPinned) === `https://${good}`, 'PUBLIC_ORIGIN overrides a hostile Host header');
  check(isTrustedCallbackBase(`https://${good}`, req('evil.com'), productionPinned), 'pinned callback origin is trusted');
  check(!isTrustedCallbackBase('https://configured.example', req(good), productionPinned), 'a foreign callback base is rejected');
  check(safeOrigin(req(good), 'https://configured.example', productionPinned) === '', 'a stale untrusted callback base fails closed');

  const guarded = { NODE_ENV: 'production', TRUSTED_HOSTS: good };
  check(safeOrigin(req(good), '', guarded) === `https://${good}`, 'trusted-host-only production origin is accepted');
  check(safeOrigin(req('evil.com'), '', guarded) === '', 'a foreign Host header is rejected');
  check(safeOrigin(req(`${good}.evil.com`), '', guarded) === '', 'suffix-confusion hosts are rejected');
  check(safeOrigin(req(good, 'http'), '', guarded) === '', 'production callbacks require HTTPS');
  check(safeOrigin(req(''), '', guarded) === '', 'an empty Host is rejected');

  const aliases = { ...productionPinned, TRUSTED_HOSTS: `www.${good}` };
  check(isTrustedCallbackBase(`https://www.${good}`, req(good), aliases), 'an explicitly trusted HTTPS alias is accepted');
  check(!isTrustedCallbackBase(`http://www.${good}`, req(good), aliases), 'an HTTP alias is rejected in production');

  const development = { NODE_ENV: 'development' };
  check(safeOrigin(req('localhost:4175', 'http'), '', development) === 'http://localhost:4175', 'local development can use a valid request origin');
  for (const host of ['evil.com\r\nX: 1', 'evil.com/path', 'evil.com?a=b', 'evil.com#f']) {
    check(safeOrigin(req(host, 'http'), '', development) === '', `malformed Host rejected: ${JSON.stringify(host)}`);
  }
}
console.log(`${pass}/${pass + fail}`);
if (fail) process.exitCode = 1;
