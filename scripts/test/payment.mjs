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
