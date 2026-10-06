/* ==========================================================================
   Iranian payment gateway adapters — "ready to connect".
   Set the provider + credentials in the admin panel (shop settings) and
   online payment works with no code change:
     - 'offline'  : no gateway; orders are recorded as pending payment
     - 'zarinpal' : ZarinPal, through the official zarinpal-node-sdk
     - 'idpay'    : IDPay (v1.1) — needs api key (sandbox toggle)

   UNITS. This is the part that costs real money if it is wrong, so it is
   stated once here and respected everywhere below.

     - The shop stores every price in RIAL.
     - ZarinPal takes the amount in RIAL and accepts an explicit `currency`
       of 'IRR'. We send both, so the unit is never inferred.
     - IDPay settles in TOMAN, so its amounts — and only its amounts — are
       divided by ten.

   The previous hand-rolled ZarinPal client converted to toman before
   sending, with no currency field. Against an API whose default is IRR
   that asks the customer for a tenth of the order. The conversion is gone
   from the ZarinPal path, and a test pins the unit.
   ========================================================================== */

import { normalizePhone, toLocalPhone } from './sms.js';

const toToman = (rial) => Math.max(10, Math.round(Number(rial) / 10));

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

/* ---------- IDPay (v1.1) ---------- */
async function idpayCreate(cfg, order, callbackUrl) {
  const res = await fetch('https://api.idpay.ir/v1.1/payment', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-API-KEY': cfg.idpayApiKey,
      'X-SANDBOX': cfg.idpaySandbox ? '1' : '0',
    },
    body: JSON.stringify({
      order_id: order.code,
      amount: toToman(order.total),
      name: order.customer?.name || '',
      phone: order.customer?.phone || '',
      mail: order.customer?.email || '',
      desc: `سفارش ${order.code} — خمیرمایه خوزستان`,
      callback: callbackUrl,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!json?.id || !json?.link) throw new Error(`idpay request failed: ${json?.error_message || res.status}`);
  return { ref: json.id, payUrl: json.link };
}

async function idpayVerify(cfg, params, expectedRial) {
  // statuses: 200 = paid, 150 = settled/paid-at-gateway — treat both as success candidates
  const status = Number(params.status || 0);
  if (![200, 150].includes(status)) return { ok: false, ref: String(params.id || '') };
  const res = await fetch('https://api.idpay.ir/v1.1/payment/inquiry', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-API-KEY': cfg.idpayApiKey,
      'X-SANDBOX': cfg.idpaySandbox ? '1' : '0',
    },
    body: JSON.stringify({ id: params.id, order_id: params.order_id }),
  });
  const json = await res.json().catch(() => ({}));
  const ok = [150, 200].includes(Number(json?.status));
  if (!ok) return { ok: false, ref: String(params.id || '') };
  /* IDPay echoes the settled amount; refuse anything that is not what the
     order actually costs. */
  const expected = toToman(expectedRial);
  const paid = parseAmount(json?.amount);
  if (!Number.isFinite(paid) || paid !== expected) {
    return { ok: false, ref: String(params.id || ''), amountMismatch: { paid, expected } };
  }
  return { ok: true, ref: String(params.id || '') };
}

/* ---------- public helpers ---------- */
export const PROVIDERS = ['offline', 'zarinpal', 'idpay'];

export function normalizePayment(p = {}) {
  return {
    provider: PROVIDERS.includes(p.provider) ? p.provider : 'offline',
    zarinpalMerchant: String(p.zarinpalMerchant || '').trim(),
    /* An explicit toggle. The old code decided sandbox by looking for a
       'test' prefix on the merchant id, but the SDK requires a real UUID,
       so that heuristic now describes an id it would reject anyway. */
    zarinpalSandbox: Boolean(p.zarinpalSandbox),
    idpayApiKey: String(p.idpayApiKey || '').trim(),
    idpaySandbox: Boolean(p.idpaySandbox),
    callbackBase: String(p.callbackBase || '').trim().replace(/\/+$/, ''),
  };
}

/* Credentials are write-only, the same rule the SMS settings follow: the
   admin screen gets a mask, and posting the mask back means "unchanged".
   An admin session should not be a way to read the merchant id and the
   IDPay key out of a browser tab. */
export const SECRET_MASK = '••••••••';
export const maskSecret = (v) => {
  const s = String(v || '');
  if (!s) return '';
  return s.length <= 4 ? SECRET_MASK : `${SECRET_MASK}${s.slice(-4)}`;
};

export function publicPayment(cfg) {
  const c = normalizePayment(cfg);
  return {
    ...c,
    zarinpalMerchant: maskSecret(c.zarinpalMerchant),
    idpayApiKey: maskSecret(c.idpayApiKey),
    hasZarinpalMerchant: Boolean(c.zarinpalMerchant),
    hasIdpayApiKey: Boolean(c.idpayApiKey),
    zarinpalMerchantValid: isZarinpalMerchant(c.zarinpalMerchant),
  };
}

export function mergePayment(current, incoming = {}) {
  const cur = normalizePayment(current);
  const next = { ...cur, ...incoming };
  for (const field of ['zarinpalMerchant', 'idpayApiKey']) {
    const sent = String(incoming[field] ?? '');
    if (!sent || sent.startsWith(SECRET_MASK)) next[field] = cur[field];
  }
  return normalizePayment(next);
}

/* returns { provider, ref, payUrl } — payUrl is null for offline */
export async function createPayment(payment, order, { origin, deps } = {}) {
  const cfg = normalizePayment(payment);
  const base = cfg.callbackBase || origin;
  if (cfg.provider === 'zarinpal') {
    /* A merchant id the SDK would reject is the same situation as no
       merchant id at all: record the order, do not break checkout. */
    if (!isZarinpalMerchant(cfg.zarinpalMerchant)) return { provider: 'offline', ref: null, payUrl: null };
    const out = await zarinpalCreate(cfg, order, `${base}/api/shop-pay/zarinpal/callback?code=${order.code}`, deps);
    return { provider: 'zarinpal', ...out };
  }
  if (cfg.provider === 'idpay') {
    if (!cfg.idpayApiKey) return { provider: 'offline', ref: null, payUrl: null };
    const out = await idpayCreate(cfg, order, `${base}/api/shop-pay/idpay/callback`);
    return { provider: 'idpay', ...out };
  }
  return { provider: 'offline', ref: null, payUrl: null };
}

/* returns { ok, ref } */
/** Confirm a gateway callback.
 *  @param expectedRial the order total, in RIAL. Required: a callback that
 *  settled for a different amount than the order costs must NOT be accepted,
 *  otherwise an order can be marked paid for a fraction of its value. */
export async function verifyPayment(payment, provider, params, expectedRial, deps) {
  const cfg = normalizePayment(payment);
  if (provider === 'zarinpal') return zarinpalVerify(cfg, params, expectedRial, deps);
  if (provider === 'idpay') return idpayVerify(cfg, params, expectedRial);
  return { ok: false, ref: '' };
}
