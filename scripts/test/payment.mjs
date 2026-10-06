/* ==========================================================================
   Payment-verification security checks.

   These guard the money path. Two classes of bug are covered:

   1. Amount verification must FAIL CLOSED. An earlier version asked
      `Number.isFinite(paid) && paid !== expected`, which SKIPS the comparison
      when the gateway response omits `amount` or sends something unparseable.
      A gateway (or anyone able to spoof one) could then settle a 910,000 rial
      order having collected nothing at all.

   2. Callback origins must not come from the client's Host header, or an
      attacker can point the gateway's return URL at a host they control and
      capture the order token from its query string.
   ========================================================================== */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

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
/* Orders are priced in rial; both gateways settle in toman (rial / 10), so
   the amount the gateway echoes back is a tenth of the order total. */
const EXPECTED_RIAL = 910000;
const EXPECTED_TOMAN = EXPECTED_RIAL / 10;

/* Each case: what the gateway replies with, and whether settlement is allowed. */
const AMOUNT_CASES = [
  ['amount correct', EXPECTED_TOMAN, true],
  ['amount correct as string', String(EXPECTED_TOMAN), true],
  ['amount omitted', undefined, false],
  ['amount null', null, false],
  ['amount NaN string', 'abc', false],
  ['amount empty string', '', false],
  ['amount underpaid', 1, false],
  ['amount overpaid', EXPECTED_TOMAN * 2, false],
  ['amount negative', -EXPECTED_TOMAN, false],
  ['amount in rial not toman', EXPECTED_RIAL, false],
  ['amount object', { v: EXPECTED_TOMAN }, false],
  ['amount array', [EXPECTED_TOMAN], false],
  ['amount Infinity', 'Infinity', false],
];

const realFetch = globalThis.fetch;

async function runProvider(provider, buildBody, params, { deps } = {}) {
  for (const [name, amount, shouldSettle] of AMOUNT_CASES) {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => buildBody(amount),
      text: async () => '',
    });
    let res;
    try {
      res = await verifyPayment(
        { provider, zarinpalMerchant: MERCHANT, idpayApiKey: 'k' },
        provider,
        params,
        EXPECTED_RIAL,
        deps ? deps(amount) : undefined,
      );
    } catch (e) {
      res = { ok: false, error: e.message };
    }
    check(
      Boolean(res.ok) === shouldSettle,
      `${provider}: ${name}`,
      `ok=${res.ok} expected ok=${shouldSettle}`,
    );
  }
}

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
    { zarinpal: z },
  );
  check(Boolean(res.ok) === shouldSettle, `zarinpal: ${name}`, `ok=${res.ok} expected ${shouldSettle}`);
}

/* The amount we ask ZarinPal to verify must come from our own database and
   be in rial — that is what makes a tampered callback harmless. */
{
  const z = fakeZarinpal(() => ({ data: { code: 100, ref_id: 'R1' } }));
  await verifyPayment({ provider: 'zarinpal', zarinpalMerchant: MERCHANT }, 'zarinpal', { Authority: AUTHORITY, Status: 'OK' }, EXPECTED_RIAL, { zarinpal: z });
  check(fakeZarinpal.lastVerify.amount === EXPECTED_RIAL, 'zarinpal: verify is sent the order total in RIAL', String(fakeZarinpal.lastVerify.amount));
  check(fakeZarinpal.lastVerify.authority === AUTHORITY, 'zarinpal: verify is sent the callback authority');
}

/* Gateway status codes. */
{
  const code = async (c) => {
    const z = fakeZarinpal(() => ({ data: { code: c, ref_id: 'R9' } }));
    return verifyPayment({ provider: 'zarinpal', zarinpalMerchant: MERCHANT }, 'zarinpal', { Authority: AUTHORITY, Status: 'OK' }, EXPECTED_RIAL, { zarinpal: z });
  };
  check((await code(100)).ok === true, 'zarinpal: code 100 settles');
  /* 101 is "already verified" — the customer pressed back or the callback
     arrived twice. Failing it would flip a paid order to failed. */
  const repeat = await code(101);
  check(repeat.ok === true, 'zarinpal: code 101 (already verified) settles, idempotently');
  check(repeat.alreadyVerified === true, 'zarinpal: and says it was a repeat');
  for (const bad of [-9, 51, 54, 0]) {
    check((await code(bad)).ok === false, `zarinpal: code ${bad} does not settle`);
  }
}

/* A cancelled payment never reaches the gateway at all. */
{
  let called = false;
  const z = fakeZarinpal(() => {
    called = true;
    return { data: { code: 100 } };
  });
  const res = await verifyPayment({ provider: 'zarinpal', zarinpalMerchant: MERCHANT }, 'zarinpal', { Authority: AUTHORITY, Status: 'NOK' }, EXPECTED_RIAL, { zarinpal: z });
  check(res.ok === false, 'zarinpal: Status=NOK does not settle');
  check(called === false, 'zarinpal: and a cancelled payment is not even sent for verification');
}

/* IDPAY still settles in toman — its amounts, and only its amounts, are
   divided by ten. It does echo the amount, so the strict check stays. */
await runProvider(
  'idpay',
  (amount) => {
    const b = { status: 200, track_id: 'T1' };
    if (amount !== undefined) b.amount = amount;
    return b;
  },
  { id: 'I1', order_id: 'O1', status: '200' },
);

globalThis.fetch = realFetch;

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
  const stored = { provider: 'zarinpal', zarinpalMerchant: MERCHANT, idpayApiKey: 'IDPAY-SECRET-KEY' };
  const shown = publicPayment(stored);
  check(!JSON.stringify(shown).includes(MERCHANT), 'the merchant id is not serialised to the admin client');
  check(!JSON.stringify(shown).includes('IDPAY-SECRET-KEY'), 'nor the IDPay key');
  check(shown.hasZarinpalMerchant === true && shown.zarinpalMerchantValid === true, 'but the admin is told it is set and valid');
  const resaved = mergePayment(stored, { ...shown, zarinpalSandbox: true });
  check(resaved.zarinpalMerchant === MERCHANT, 'saving the form with the mask keeps the stored merchant id');
  check(resaved.idpayApiKey === 'IDPAY-SECRET-KEY', 'and the stored IDPay key');
  check(resaved.zarinpalSandbox === true, 'while other fields still save');
}

/* ---- 2. callback origin must ignore a hostile Host header ----------------- */

/* safeOrigin lives inside shop.js, which pulls in the database on import, so
   the function is extracted and evaluated on its own rather than importing
   the whole module. */
const shopSrc = fs.readFileSync(path.join(ROOT, 'server', 'shop.js'), 'utf8');
const start = shopSrc.indexOf('const PUBLIC_ORIGIN');
const end = shopSrc.indexOf('\n}', shopSrc.indexOf('function safeOrigin')) + 2;

if (start === -1 || end < start) {
  check(false, 'safeOrigin present in server/shop.js');
} else {
  const body = shopSrc.slice(start, end);
  const makeOrigin = (env) =>
    new Function('process', body + '; return safeOrigin;')({ env });
  const req = (host, protocol = 'https') => ({
    protocol,
    get: (k) => (k === 'host' ? host : null),
  });

  const GOOD = 'khuzestanyeast-co.com';

  /* With an allowlist, only the listed host may build the origin. */
  const guarded = makeOrigin({ TRUSTED_HOSTS: GOOD });
  check(guarded(req(GOOD)) === `https://${GOOD}`, 'allowlisted host accepted');
  check(guarded(req('evil.com')) === '', 'foreign Host header rejected');
  check(
    guarded(req(`${GOOD}.evil.com`)) === '',
    'suffix-confusion host rejected',
  );
  check(guarded(req('')) === '', 'empty Host rejected');

  /* PUBLIC_ORIGIN always wins, whatever the client claims. */
  const pinned = makeOrigin({ PUBLIC_ORIGIN: `https://${GOOD}` });
  check(
    pinned(req('evil.com')) === `https://${GOOD}`,
    'PUBLIC_ORIGIN overrides Host header',
  );

  /* An admin-configured callbackBase outranks everything. */
  check(
    pinned(req('evil.com'), 'https://configured.example') ===
      'https://configured.example',
    'configured callbackBase wins',
  );

  /* Header-injection characters can never reach a URL. */
  const open = makeOrigin({});
  for (const bad of ['evil.com\r\nX: 1', 'evil.com/path', 'evil.com?a=b', 'evil.com#f']) {
    check(open(req(bad)) === '', `malformed Host rejected: ${JSON.stringify(bad)}`);
  }
}

console.log(`${pass}/${pass + fail}`);
