/* ==========================================================================
   SMS layer checks.

   The SMS path touches two things that are expensive to get wrong: a
   customer's only link to their order, and an account's credit balance. The
   properties guarded here are, in order of how much they would cost:

   1. A send NEVER throws. Order creation calls this; a provider outage must
      not turn a committed, paid order into a 500.
   2. The API key never leaves the server, and saving the settings form with
      the mask in the field does not erase it.
   3. One phone number has exactly one canonical form, whatever the visitor
      typed — Persian digits, +98, 0098 or a bare 912.
   4. The daily cap and the configured-ness check fail closed.

   No network: the sms.ir transport is injected.
   ========================================================================== */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

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
}

/* ---------------------------------------------------- 5. sending, safely */
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
