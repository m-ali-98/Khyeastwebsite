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
import { fileURLToPath } from 'node:url';
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

const { verifyPayment } = await import(path.join(ROOT, 'server/payment.js'));
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

async function runProvider(provider, buildBody, params) {
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
        { provider, zarinpalMerchant: 'm', idpayApiKey: 'k' },
        provider,
        params,
        EXPECTED_RIAL,
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

await runProvider(
  'zarinpal',
  (amount) => {
    const data = { code: 100, ref_id: 'R1' };
    if (amount !== undefined) data.amount = amount;
    return { data, errors: [] };
  },
  { Authority: 'A1', Status: 'OK' },
);

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

/* ---- 2. callback origin must ignore a hostile Host header ----------------- */

/* safeOrigin lives inside shop.js, which pulls in the database on import, so
   the function is extracted and evaluated on its own rather than importing
   the whole module. */
const shopSrc = fs.readFileSync(path.join(ROOT, 'server/shop.js'), 'utf8');
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
