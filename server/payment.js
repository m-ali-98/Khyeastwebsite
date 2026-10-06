/* ==========================================================================
   ZarinPal — the whole gateway, through the official zarinpal-node-sdk.
   --------------------------------------------------------------------------
   Credentials live in the admin panel, so connecting a live terminal is a
   form submission rather than a deployment. Two providers exist:

     - 'offline'  : no gateway; orders are recorded as pending payment
     - 'zarinpal' : the real thing

   Covered, matching the SDK documentation one to one:

     payments.create          → createPayment      (start a payment)
     verifications.verify     → verifyPayment      (settle it)
     inquiries.inquire        → inquirePayment     (what happened to it?)
     unverified.list          → listUnverified     (money paid, never settled)
     reversals.reverse        → reversePayment     (give it back, <30 min)
     transactions.list        → listTransactions   (terminal ledger)
     feeCalculation           → calculateFee       (see the cut beforehand)

   UNITS. This is the part that costs real money if it is wrong, so it is
   stated once and respected everywhere: the shop stores RIAL, ZarinPal is
   billed in RIAL, and every call that carries an amount also carries an
   explicit `currency: 'IRR'` so the unit is never inferred.

   TESTING. Every function takes an optional injected client. A gateway
   integration that can only be reached over the internet is one that never
   gets tested, and this is the money path.
   ========================================================================== */
import { normalizePhone, toLocalPhone } from './sms.js';

/* ---------- ZarinPal (official SDK) ---------- */

/** ZarinPal refuses anything under 10,000 rial outright. Catching it here
 *  turns a gateway error page into a plain "payment unavailable" and an
 *  order that can still be paid another way. */
export const ZARINPAL_MIN_RIAL = 10000;

/** The SDK validates the merchant id as a UUID and throws otherwise. A
 *  half-filled settings form must not take the shop's checkout down, so an
 *  unusable id is treated as "not configured" instead. */
export const isZarinpalMerchant = (v) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(String(v || ''));

/* The SDK validates the mobile as 09xxxxxxxxx and throws on anything else,
   so an odd phone on an optional field must not take checkout down. Reusing
   the SMS layer's normaliser rather than writing a third phone regex: it
   already folds Persian digits and every prefix spelling, and it is the
   function the rest of the system agrees with. undefined, not '', because
   the SDK only skips the check when the field is absent. */
const sdkMobile = (raw) => toLocalPhone(normalizePhone(raw)) || undefined;

/* The SDK is loaded on first use and the instance is injectable, so the
   tests exercise this code without a network and without a real merchant
   id. A gateway client that can only be reached over the internet is a
   gateway client that never gets tested. */
let ZarinPalCtor = null;
async function zarinpalClient(cfg, deps = {}) {
  if (deps.zarinpal) return deps.zarinpal;
  if (!ZarinPalCtor) {
    const mod = await import('zarinpal-node-sdk');
    ZarinPalCtor = mod.ZarinPal || mod.default?.ZarinPal || mod.default;
  }
  return new ZarinPalCtor({ merchantId: cfg.zarinpalMerchant, sandbox: Boolean(cfg.zarinpalSandbox) });
}

/* Both SDK calls answer { data: { code, ... } }; some transports hand back
   the inner object directly. */
const zpData = (res) => res?.data ?? res ?? {};

async function zarinpalCreate(cfg, order, callbackUrl, deps) {
  const rial = Math.round(Number(order.total) || 0);
  if (rial < ZARINPAL_MIN_RIAL) throw new Error(`zarinpal: amount ${rial} rial is below the ${ZARINPAL_MIN_RIAL} rial minimum`);

  const z = await zarinpalClient(cfg, deps);
  const res = await z.payments.create({
    amount: rial,
    currency: 'IRR', // explicit: the shop's unit is rial, never toman
    callback_url: callbackUrl,
    description: `سفارش ${order.code} — خمیرمایه خوزستان`,
    mobile: sdkMobile(order.customer?.phone),
    email: order.customer?.email || undefined,
  });

  const data = zpData(res);
  if (Number(data.code) !== 100 || !data.authority) {
    throw new Error(`zarinpal request failed: ${data.code ?? '?'} ${data.message || ''}`.trim());
  }
  return { ref: String(data.authority), payUrl: z.payments.getRedirectUrl(data.authority) };
}

async function zarinpalVerify(cfg, params, expectedRial, deps) {
  if (String(params.Status || params.status || '').toUpperCase() !== 'OK') return { ok: false };
  const authority = String(params.Authority || params.authority || '');
  const expected = Math.round(Number(expectedRial) || 0);

  const z = await zarinpalClient(cfg, deps);
  /* The amount sent here comes from OUR database, never from the callback
     query string. That is the real protection: ZarinPal fails the
     verification when it does not match what was authorised, so a tampered
     return URL cannot settle an order for the wrong sum. */
  const res = await z.verifications.verify({ amount: expected, authority });
  const data = zpData(res);
  const code = Number(data.code);

  /* 100 = verified now. 101 = already verified — the customer pressed back,
     or the callback arrived twice. Treating that as a failure would flip a
     genuinely paid order to failed, so it settles, idempotently. */
  if (code !== 100 && code !== 101) {
    return { ok: false, ref: authority, gatewayCode: code, message: String(data.message || '') };
  }

  /* ZarinPal's verify response does not echo the amount, which is why the
     check below is conditional. The previous version demanded it and
     treated its absence as fraud — against the real API that would have
     refused every genuine payment the shop ever took. When an amount IS
     present it still has to match. */
  if (data.amount !== undefined && data.amount !== null) {
    const paid = parseAmount(data.amount);
    if (!Number.isFinite(paid) || paid !== expected) {
      return { ok: false, ref: authority, amountMismatch: { paid, expected } };
    }
  }

  return { ok: true, ref: String(data.ref_id ?? authority), alreadyVerified: code === 101, cardPan: data.card_pan || '' };
}

/* Coerce a gateway-supplied amount to a number, but only from a genuine number
   or numeric string. `Number([91000])` is 91000 and `Number([])` is 0, so
   passing the raw value to Number() would let an array-shaped response satisfy
   an equality check it should never satisfy. Anything else yields NaN, which
   callers treat as a failed verification. */
function parseAmount(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}

/* ---------- public helpers ---------- */
export const PROVIDERS = ['offline', 'zarinpal'];

export function normalizePayment(p = {}) {
  return {
    provider: PROVIDERS.includes(p.provider) ? p.provider : 'offline',
    zarinpalMerchant: String(p.zarinpalMerchant || '').trim(),
    /* An explicit toggle. The old code decided sandbox by looking for a
       'test' prefix on the merchant id, but the SDK requires a real UUID,
       so that heuristic described an id it would reject anyway. */
    zarinpalSandbox: Boolean(p.zarinpalSandbox),
    /* Only the terminal ledger needs these two; payments work without them.
       They come from a different place in the ZarinPal panel (active
       sessions), which is why they are separate fields and not assumed. */
    zarinpalAccessToken: String(p.zarinpalAccessToken || '').trim(),
    zarinpalTerminalId: String(p.zarinpalTerminalId || '').trim(),
    callbackBase: String(p.callbackBase || '').trim().replace(/\/+$/, ''),
  };
}

/* Credentials are write-only, the same rule the SMS settings follow: the
   admin screen gets a mask, and posting the mask back means "unchanged".
   An admin session should not be a way to read the merchant id and the
   access token out of a browser tab. */
export const SECRET_MASK = '••••••••';
export const maskSecret = (v) => {
  const s = String(v || '');
  if (!s) return '';
  return s.length <= 4 ? SECRET_MASK : `${SECRET_MASK}${s.slice(-4)}`;
};

const SECRET_FIELDS = ['zarinpalMerchant', 'zarinpalAccessToken'];

export function publicPayment(cfg) {
  const c = normalizePayment(cfg);
  return {
    ...c,
    zarinpalMerchant: maskSecret(c.zarinpalMerchant),
    zarinpalAccessToken: maskSecret(c.zarinpalAccessToken),
    hasZarinpalMerchant: Boolean(c.zarinpalMerchant),
    hasZarinpalAccessToken: Boolean(c.zarinpalAccessToken),
    zarinpalMerchantValid: isZarinpalMerchant(c.zarinpalMerchant),
    /* What the panel can actually offer, so the UI never shows a button
       that is guaranteed to fail. */
    canPay: c.provider === 'zarinpal' && isZarinpalMerchant(c.zarinpalMerchant),
    canLedger: Boolean(c.zarinpalAccessToken && c.zarinpalTerminalId),
  };
}

export function mergePayment(current, incoming = {}) {
  const cur = normalizePayment(current);
  const next = { ...cur, ...incoming };
  for (const field of SECRET_FIELDS) {
    const sent = String(incoming[field] ?? '');
    if (!sent || sent.startsWith(SECRET_MASK)) next[field] = cur[field];
  }
  return normalizePayment(next);
}

/* --------------------------------------------------------------------------
   Gateway operations beyond the checkout round trip.

   All of them answer the same shape — { ok, ... , error } — and none of
   them throw. They are called from admin screens, and an admin screen that
   shows a stack trace because a terminal is misconfigured is worse than one
   that says what is wrong.
   -------------------------------------------------------------------------- */

const needMerchant = (cfg) =>
  isZarinpalMerchant(cfg.zarinpalMerchant) ? null : { ok: false, error: 'شناسه پذیرنده (merchant_id) تنظیم نشده یا معتبر نیست.' };

const failed = (e) => ({ ok: false, error: String(e?.response?.data?.errors?.message || e?.message || e).slice(0, 300) });

/** What actually happened to one payment. Answers for an order whose
 *  customer closed the tab before the callback came back. */
export async function inquirePayment(payment, authority, deps) {
  const cfg = normalizePayment(payment);
  const bad = needMerchant(cfg);
  if (bad) return bad;
  try {
    const z = await zarinpalClient(cfg, deps);
    const data = zpData(await z.inquiries.inquire({ authority: String(authority) }));
    return {
      ok: Number(data.code) === 100,
      code: Number(data.code),
      status: String(data.status || ''),
      message: String(data.message || ''),
      /* The gateway's own word on whether this money was ever settled. */
      settled: String(data.status || '').toUpperCase() === 'VERIFIED',
    };
  } catch (e) {
    return failed(e);
  }
}

/** Payments the customer completed but that were never verified — a dropped
 *  callback, a closed tab, a server restart at the wrong moment. This is
 *  money that has left a customer's account and not been settled, so it is
 *  the single most valuable call in this file. */
export async function listUnverified(payment, deps) {
  const cfg = normalizePayment(payment);
  const bad = needMerchant(cfg);
  if (bad) return { ...bad, authorities: [] };
  try {
    const z = await zarinpalClient(cfg, deps);
    const data = zpData(await z.unverified.list());
    const authorities = Array.isArray(data.authorities) ? data.authorities : [];
    return { ok: Number(data.code) === 100, code: Number(data.code), authorities };
  } catch (e) {
    return { ...failed(e), authorities: [] };
  }
}

/** Return the money, inside ZarinPal's 30-minute window. Needs the server's
 *  IP registered on the terminal or the gateway answers -62. */
export async function reversePayment(payment, authority, deps) {
  const cfg = normalizePayment(payment);
  const bad = needMerchant(cfg);
  if (bad) return bad;
  try {
    const z = await zarinpalClient(cfg, deps);
    const data = zpData(await z.reversals.reverse({ authority: String(authority) }));
    const code = Number(data.code);
    return {
      ok: code === 100,
      code,
      message:
        code === -62
          ? 'آی‌پی سرور روی درگاه ثبت نشده است (خطای ۶۲-).'
          : String(data.message || ''),
    };
  } catch (e) {
    return failed(e);
  }
}

/** The terminal's own ledger. Unlike everything else here this goes through
 *  ZarinPal's GraphQL endpoint and needs an access token plus a terminal
 *  id, which come from a different page of their panel. */
export async function listTransactions(payment, { filter, limit = 20, offset = 0 } = {}, deps) {
  const cfg = normalizePayment(payment);
  if (!cfg.zarinpalAccessToken || !cfg.zarinpalTerminalId)
    return { ok: false, error: 'برای مشاهده تراکنش‌ها، Access Token و شناسه ترمینال لازم است.', transactions: [] };
  const ALLOWED = ['PAID', 'VERIFIED', 'TRASH', 'ACTIVE', 'REFUNDED'];
  try {
    const z = await zarinpalClient(cfg, deps);
    const res = await z.transactions.list({
      terminalId: cfg.zarinpalTerminalId,
      /* The SDK throws on an unknown filter, so an unexpected value is
         dropped rather than passed through. */
      filter: ALLOWED.includes(filter) ? filter : undefined,
      limit: Math.max(1, Math.min(100, Number(limit) || 20)),
      offset: Math.max(0, Number(offset) || 0),
    });
    const list = res?.data?.transactions || res?.transactions || [];
    return { ok: true, transactions: Array.isArray(list) ? list : [] };
  } catch (e) {
    return { ...failed(e), transactions: [] };
  }
}

/** ZarinPal's cut, before anyone pays anything.
 *
 *  Documented as payments.feeCalculation, but SDK 2.2.0 does not implement
 *  it — the method is simply absent from the Payments class. Rather than
 *  drop the feature we call the documented endpoint through the SDK's own
 *  request(), which supplies the base URL, the headers and the merchant id,
 *  so this stays correct for sandbox and production alike and starts using
 *  the real method the moment the SDK ships one. */
export async function calculateFee(payment, rial, deps) {
  const cfg = normalizePayment(payment);
  const bad = needMerchant(cfg);
  if (bad) return bad;
  const amount = Math.round(Number(rial) || 0);
  if (amount < 1000) return { ok: false, error: 'مبلغ باید حداقل ۱۰۰۰ ریال باشد.' };
  try {
    const z = await zarinpalClient(cfg, deps);
    const call = z.payments.feeCalculation
      ? z.payments.feeCalculation({ amount, currency: 'IRR' })
      : z.request('POST', '/pg/v4/payment/feeCalculation.json', { amount, currency: 'IRR' });
    const data = zpData(await call);
    if (Number(data.code) !== 100) return { ok: false, error: String(data.message || `code ${data.code}`) };
    return {
      ok: true,
      amount: Number(data.amount ?? amount),
      fee: Number(data.fee ?? 0),
      feeType: String(data.fee_type || ''),
      suggestedAmount: Number(data.suggested_amount ?? 0) || null,
    };
  } catch (e) {
    return failed(e);
  }
}

/* returns { provider, ref, payUrl } — payUrl is null for offline */
export async function createPayment(payment, order, { origin, deps } = {}) {
  const cfg = normalizePayment(payment);
  const base = cfg.callbackBase || origin;
  if (cfg.provider !== 'zarinpal') return { provider: 'offline', ref: null, payUrl: null };
  /* A merchant id the SDK would reject is the same situation as no merchant
     id at all: record the order, do not break checkout. */
  if (!isZarinpalMerchant(cfg.zarinpalMerchant)) return { provider: 'offline', ref: null, payUrl: null };
  const out = await zarinpalCreate(cfg, order, `${base}/api/shop-pay/zarinpal/callback?code=${order.code}`, deps);
  return { provider: 'zarinpal', ...out };
}

/** Confirm a gateway callback.
 *  @param expectedRial the order total, in RIAL. Required: a callback that
 *  settled for a different amount than the order costs must NOT be accepted.
 */
export async function verifyPayment(payment, provider, params, expectedRial, deps) {
  const cfg = normalizePayment(payment);
  if (provider === 'zarinpal') return zarinpalVerify(cfg, params, expectedRial, deps);
  return { ok: false, ref: '' };
}
