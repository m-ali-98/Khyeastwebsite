/* ==========================================================================
   SMS — sms.ir (SmsPanel V2), behind an adapter.
   --------------------------------------------------------------------------
   Same shape as server/payment.js: the provider and its credentials live in
   the admin panel, so moving from the sandbox key to the production one is a
   form submission, not a deployment.

     - 'log'   : nothing is sent; the message is recorded and returned. This
                 is the default, and what the tests and CI use. A shop with
                 no credentials configured must still take orders.
     - 'smsir' : sms.ir V2 via the smsir-js package.

   Two rules govern everything below.

   1. A failed SMS must never fail an order. Sending is attempted after the
      order is committed, and every error is swallowed into a log row. The
      customer has paid; a provider outage is not their problem.

   2. Verification codes and links go out as TEMPLATES, not free text.
      sms.ir requires a registered template for verification codes, and
      Iranian operators routinely filter bulk messages that carry a URL or a
      code on a shared service line. Free text is supported here only for the
      admin's own test message.
   ========================================================================== */

export const SMS_PROVIDERS = ['log', 'smsir'];
export const SMS_ENVIRONMENTS = ['sandbox', 'production'];

/* --------------------------------------------------------------- phones */

/** Canonical form for an Iranian mobile number: 98 + 9xxxxxxxxx (12 digits).
 *
 *  Everything that touches a phone number — login, OTP, order lookup, the
 *  customers table — must agree on one representation, or `0912…`, `+98912…`
 *  and `98912…` become three different accounts for one person. Persian and
 *  Arabic-Indic digits are folded first: an Iranian visitor typing on a
 *  Persian keyboard produces ۰۹۱۲…, which no ASCII regex would match.
 *
 *  Returns null for anything that is not a valid Iranian mobile number.
 */
export function normalizePhone(raw) {
  if (raw === 0) return null;
  if (!raw) return null;
  const folded = String(raw)
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0)) // ۰-۹
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660)) // ٠-٩
    .replace(/[\s\-()./]/g, '');
  const digits = folded.replace(/^\+/, '');
  let local = null;
  if (/^00989\d{9}$/.test(digits)) local = digits.slice(4);
  else if (/^989\d{9}$/.test(digits)) local = digits.slice(2);
  else if (/^09\d{9}$/.test(digits)) local = digits.slice(1);
  else if (/^9\d{9}$/.test(digits)) local = digits;
  if (!local) return null;
  return `98${local}`;
}

/** 09xxxxxxxxx — the form sms.ir expects on the wire. */
export function toLocalPhone(canonical) {
  const c = normalizePhone(canonical);
  return c ? `0${c.slice(2)}` : null;
}

/** ۰۹۱۲••••۳۴۵ — for the admin UI and logs, so a support screen is not a
 *  list of customer phone numbers in full. */
export function maskPhone(canonical) {
  const c = normalizePhone(canonical);
  if (!c) return '';
  const l = toLocalPhone(c);
  return `${l.slice(0, 4)}•••${l.slice(-3)}`;
}

/* ------------------------------------------------------------- settings */

/** Never render a stored secret back to the browser. The admin form shows
 *  this instead, and sends it back unchanged when the key was not edited. */
export const SECRET_MASK = '••••••••';

export function maskKey(key) {
  const k = String(key || '');
  if (!k) return '';
  return k.length <= 4 ? SECRET_MASK : `${SECRET_MASK}${k.slice(-4)}`;
}

const int = (v, d = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

export function normalizeSms(s = {}) {
  return {
    provider: SMS_PROVIDERS.includes(s.provider) ? s.provider : 'log',
    environment: SMS_ENVIRONMENTS.includes(s.environment) ? s.environment : 'sandbox',
    apiKey: String(s.apiKey || '').trim(),
    lineNumber: String(s.lineNumber || '').trim(),
    /* sms.ir template ids — registered in their panel, not invented here */
    verifyTemplateId: int(s.verifyTemplateId, 0),
    orderTemplateId: int(s.orderTemplateId, 0),
    statusTemplateId: int(s.statusTemplateId, 0),
    /* The customer gets the initial order message and, optionally, one more
       message when fulfilment reaches `shipped`. `onStatus` is kept as the
       persisted key for backwards compatibility, but no other status uses it. */
    onOrder: s.onOrder !== false,
    onStatus: Boolean(s.onStatus),
    /* A hard ceiling on messages per day. A bot hammering the OTP endpoint
       cannot spend more than this much credit overnight, whatever happens to
       the per-phone and per-IP limits in front of it. */
    dailyCap: Math.max(0, int(s.dailyCap, 500)),
  };
}

/** Merge an admin submission over what is stored, keeping the secret when
 *  the form sent back the mask (i.e. the field was not edited). Without this
 *  every save of the settings form would silently erase the API key. */
export function mergeSmsSettings(current, incoming = {}) {
  const cur = normalizeSms(current);
  const next = { ...cur, ...incoming };
  const key = String(incoming.apiKey ?? '');
  if (!key || key.startsWith(SECRET_MASK)) next.apiKey = cur.apiKey;
  return normalizeSms(next);
}

/** What the admin screen is allowed to see. */
export function publicSmsSettings(cfg) {
  const c = normalizeSms(cfg);
  return { ...c, apiKey: maskKey(c.apiKey), hasApiKey: Boolean(c.apiKey) };
}

/** Is this configuration actually able to send? Reported to the admin so a
 *  half-filled form is visibly not live, rather than failing silently later. */
export function smsReadiness(cfg) {
  const c = normalizeSms(cfg);
  const missing = [];
  if (c.provider === 'smsir') {
    if (!c.apiKey) missing.push('apiKey');
    if (!c.lineNumber) missing.push('lineNumber');
  }
  return { ready: c.provider === 'log' || missing.length === 0, provider: c.provider, missing };
}

/* ------------------------------------------------------------- messages */

/** The customer-facing order link. Kept here so the SMS body and the email
 *  (if one is ever added) cannot drift apart. */
export function orderStatusUrl(origin, order) {
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}/shop/order/${order.code}?token=${order.token}`;
}

/* Persian digits read naturally in an SMS to an Iranian customer, and the
   order code stays ASCII so it can be copied into a support chat. */
const faDigits = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

export function orderSmsText(order, url) {
  return [
    'خمیرمایه خوزستان',
    `سفارش شما با کد ${order.code} ثبت شد.`,
    `مبلغ: ${faDigits(Number(order.total).toLocaleString('en-US'))} ریال`,
    `پیگیری: ${url}`,
  ].join('\n');
}

export function shipmentSmsText(order) {
  return [
    'خمیرمایه خوزستان',
    `سفارش شما با کد ${order.code} ارسال شد.`,
  ].join('\n');
}

/** Status notifications are intentionally narrow: after the initial order
 * message, the only customer-facing milestone is the first transition into
 * `shipped`. Saving a note on an already-shipped order must not send again. */
export function shouldSendShipmentSms(previousStatus, nextStatus, settings = {}) {
  return Boolean(settings.onStatus) && previousStatus !== 'shipped' && nextStatus === 'shipped';
}

/* ------------------------------------------------------------ transport */

/* The package is loaded on first use rather than at import time: a server
   with no SMS configured should not pay for it, and a broken or missing
   dependency must surface as a failed send, not a server that will not
   boot. */
let smsirCtor = null;
async function loadSmsir() {
  if (!smsirCtor) {
    const mod = await import('smsir-js');
    smsirCtor = mod.Smsir || mod.default?.Smsir;
    if (typeof smsirCtor !== 'function') throw new Error('smsir-js: Smsir constructor not found');
  }
  return smsirCtor;
}

/* sms.ir answers with { status, message, data }. status 1 is success; the
   rest are documented failures (wrong key, no credit, unapproved template),
   all of which must be recorded rather than thrown away. */
function readResult(res) {
  const body = res?.data ?? res ?? {};
  const status = body.status ?? body.Status;
  const ok = status === 1 || status === '1';
  const messageId = body.data?.messageId ?? body.data?.packId ?? body.data?.messageIds?.[0] ?? null;
  return { ok, status: status ?? null, message: String(body.message || body.Message || ''), messageId };
}

/**
 * Send one message.
 *
 * @param cfg      normalised settings
 * @param msg      { to, kind, text, templateId, params }
 *                 `templateId` + `params` use the verification endpoint;
 *                 `text` alone is a plain bulk send (admin test only).
 * @param deps     { transport } — injected in tests so nothing hits the network.
 * @returns        { ok, provider, environment, to, text, error, messageId }
 *
 * Never throws. Callers are order and signup paths; neither may fail because
 * a third party is down.
 */
export async function sendSms(cfg, msg, deps = {}) {
  const c = normalizeSms(cfg);
  const to = normalizePhone(msg?.to);
  const base = {
    provider: c.provider,
    environment: c.environment,
    kind: msg?.kind || 'other',
    to: to || '',
    text: String(msg?.text || ''),
    messageId: null,
  };

  if (!to) return { ...base, ok: false, error: 'invalid phone' };

  if (c.provider === 'log') {
    /* Not a no-op: the row is written, so the whole pipeline — caps,
       logging, the admin view — is exercised in development exactly as it
       will be in production. */
    return { ...base, ok: true, error: '' };
  }

  const ready = smsReadiness(c);
  if (!ready.ready) return { ...base, ok: false, error: `not configured: ${ready.missing.join(', ')}` };

  try {
    const transport = deps.transport || (await makeSmsirTransport(c));
    const res = msg.templateId
      ? await transport.verify(toLocalPhone(to), int(msg.templateId), msg.params || [])
      : await transport.bulk(base.text, [toLocalPhone(to)]);
    const out = readResult(res);
    return { ...base, ok: out.ok, messageId: out.messageId, error: out.ok ? '' : `sms.ir: ${out.status} ${out.message}`.trim() };
  } catch (e) {
    return { ...base, ok: false, error: String(e?.message || e).slice(0, 300) };
  }
}

async function makeSmsirTransport(c) {
  const Smsir = await loadSmsir();
  const client = new Smsir(c.apiKey, c.lineNumber);
  return {
    verify: (mobile, templateId, params) => client.SendVerifyCode(mobile, templateId, params),
    bulk: (text, mobiles) => client.SendBulk(text, mobiles, null, c.lineNumber),
  };
}

/** Remaining credit on the sms.ir account, for the admin screen. Returns
 *  null when it cannot be read — a number that might be wrong is worse than
 *  an honest blank. */
export async function smsCredit(cfg, deps = {}) {
  const c = normalizeSms(cfg);
  if (c.provider !== 'smsir' || !c.apiKey) return null;
  try {
    const client = deps.client || new (await loadSmsir())(c.apiKey, c.lineNumber);
    const res = await client.getCredit();
    const v = res?.data?.data ?? res?.data ?? res;
    const n = Number(typeof v === 'object' ? v?.credit ?? v?.Credit : v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}
