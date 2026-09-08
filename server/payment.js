/* ==========================================================================
   Iranian payment gateway adapters — "ready to connect".
   Set the provider + credentials in the admin panel (shop settings) and
   online payment works with no code change:
     - 'offline'  : no gateway; orders are recorded as pending payment
     - 'zarinpal' : ZarinPal (pg/v4) — needs merchant_id
     - 'idpay'    : IDPay (v1.1)     — needs api key (sandbox toggle)
   Gateway amounts are in TOMAN; the shop stores prices in RIAL, so every
   amount is converted here (rial / 10).
   ========================================================================== */

const toToman = (rial) => Math.max(10, Math.round(Number(rial) / 10));

/* ---------- ZarinPal (pg/v4) ---------- */
async function zarinpalCreate(cfg, order, callbackUrl) {
  const sandbox = String(cfg.zarinpalMerchant || '').startsWith('test');
  const base = sandbox ? 'https://sandbox.zarinpal.com' : 'https://api.zarinpal.com';
  const res = await fetch(`${base}/pg/v4/payment/request.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      merchant_id: cfg.zarinpalMerchant,
      amount: toToman(order.total),
      callback_url: callbackUrl,
      description: `سفارش ${order.code} — خمیرمایه خوزستان`,
      metadata: { mobile: order.customer?.phone || '', order_id: order.code },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (json?.data?.code !== 100) throw new Error(`zarinpal request failed: ${json?.errors?.message || 'unknown'}`);
  const authority = json.data.authority;
  const payBase = sandbox ? 'https://sandbox.zarinpal.com' : 'https://www.zarinpal.com';
  return { ref: authority, payUrl: `${payBase}/pg/StartPay/${authority}` };
}

async function zarinpalVerify(cfg, params) {
  if (String(params.Status || '').toUpperCase() !== 'OK') return { ok: false };
  const sandbox = String(cfg.zarinpalMerchant || '').startsWith('test');
  const base = sandbox ? 'https://sandbox.zarinpal.com' : 'https://api.zarinpal.com';
  const res = await fetch(`${base}/pg/v4/payment/verify.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ merchant_id: cfg.zarinpalMerchant, authority: params.Authority }),
  });
  const json = await res.json().catch(() => ({}));
  const ok = json?.data?.code === 100;
  return { ok, ref: ok ? String(json.data.ref_id) : String(params.Authority || '') };
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

async function idpayVerify(cfg, params) {
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
  return { ok: [150, 200].includes(Number(json?.status)), ref: String(params.id || '') };
}

/* ---------- public helpers ---------- */
export const PROVIDERS = ['offline', 'zarinpal', 'idpay'];

export function normalizePayment(p = {}) {
  return {
    provider: PROVIDERS.includes(p.provider) ? p.provider : 'offline',
    zarinpalMerchant: String(p.zarinpalMerchant || '').trim(),
    idpayApiKey: String(p.idpayApiKey || '').trim(),
    idpaySandbox: Boolean(p.idpaySandbox),
    callbackBase: String(p.callbackBase || '').trim().replace(/\/+$/, ''),
  };
}

/* returns { provider, ref, payUrl } — payUrl is null for offline */
export async function createPayment(payment, order, { origin }) {
  const cfg = normalizePayment(payment);
  const base = cfg.callbackBase || origin;
  if (cfg.provider === 'zarinpal') {
    if (!cfg.zarinpalMerchant) return { provider: 'offline', ref: null, payUrl: null };
    const out = await zarinpalCreate(cfg, order, `${base}/api/shop-pay/zarinpal/callback?code=${order.code}`);
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
export async function verifyPayment(payment, provider, params) {
  const cfg = normalizePayment(payment);
  if (provider === 'zarinpal') return zarinpalVerify(cfg, params);
  if (provider === 'idpay') return idpayVerify(cfg, params);
  return { ok: false, ref: '' };
}
