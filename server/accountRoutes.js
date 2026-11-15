/* ==========================================================================
   Customer account API  —  /api/account/*
   --------------------------------------------------------------------------
   Registration is phone-first: request a code, prove the phone, then choose a
   password. Logging in afterwards is phone + password; the code is only for
   proving ownership of a number (sign-up, reset, changing the number).

   Everything that can be abused is rate limited on two axes — per phone and
   per IP — because either one alone is trivially sidestepped: a single IP can
   walk through a thousand phone numbers, and a thousand IPs can hammer one.

   Enumeration is treated as a real concern. "Is this phone registered?" is
   information worth money to someone building a target list, so the login
   error is always the same sentence and the OTP endpoint answers identically
   whether or not an account exists.
   ========================================================================== */
import express from 'express';
import crypto from 'node:crypto';
import * as db from './db.js';
import { publicOrderView } from './orderViews.js';
import { normalizePhone, toLocalPhone } from './sms.js';
import { rateLimitResponse } from './rateLimits.js';
import {
  hashPasswordAsync,
  verifyPasswordAsync,
  verifyLoginPasswordAsync,
  passwordProblems,
  generateOtp,
  hashOtp,
  otpMatches,
  OTP_TTL_MS,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_MS,
  newSessionToken,
  hashToken,
  sessionCookie,
  clearCookie,
  readCookie,
  originAllowed,
  SESSION_TTL_MS,
  normalizeAddress,
  normalizeProfile,
  formatAddress,
  MAX_ADDRESSES,
} from './accounts.js';

/* ------------------------------------------------------------ throttles */

/* Per-phone and per-IP buckets are supplied by the shared limiter. The phone
   axis protects one person's inbox; the broader IP axis accounts for
   carrier-grade NAT while still bounding bulk abuse. Both can be inspected
   or disabled from Admin. */

/* ---------------------------------------------------------------- router */

/**
 * @param database  the open SQLite handle
 * @param dispatchSms  (msg) => Promise<{ok,error}> — the logged, capped
 *        sender from the shop router. Injected rather than imported so the
 *        daily cap and the sms_log stay in one place.
 * @param smsSettings  () => normalised SMS settings (for the template id)
 * @param selfOrigin   (req) => the site's own origin, for the CSRF check
 * @param requireAdmin the admin session guard, for the customers tab
 */
export function createAccountRouter({
  database,
  dispatchSms,
  smsSettings,
  selfOrigin,
  requireAdmin,
  rateLimiter,
  isSecureRequest = (req) => req.secure === true,
}) {
  const D = database;
  const r = express.Router();
  const PEPPER = process.env.ADMIN_SECRET || 'khyeast-content-secret-dev';

  /* Housekeeping: expired sessions, codes and tickets. Cheap, and it keeps
     the tables from growing without bound. */
  setInterval(() => {
    try {
      db.sweepSessions(D);
    } catch (e) {
      console.error('[account] sweep failed:', e.message);
    }
  }, 15 * 60 * 1000).unref?.();

  const ip = (req) => req.ip || 'unknown';
  const blocked = (kind, key, res) => {
    const check = rateLimiter.check(kind, key);
    if (!check.limited) return false;
    rateLimitResponse(res, check.retryAfter, 'تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید.');
    return true;
  };

  /* Reject a cross-origin state change even if the cookie somehow rode
     along. SameSite=Lax is the first line; this is the second. */
  const sameOrigin = (req, res) => {
    if (originAllowed(req, selfOrigin(req))) return true;
    res.status(403).json({ error: 'forbidden' });
    return false;
  };

  const currentCustomer = (req) => {
    const token = readCookie(req.headers.cookie);
    if (!token) return null;
    const session = db.getSession(D, hashToken(token));
    if (!session) return null;
    const row = db.getCustomerById(D, session.customer_id);
    if (!row || row.blocked) return null;
    return row;
  };

  /** Attached to every protected route. Named requireCustomer, not
   *  requireAuth, to keep it visibly distinct from the admin guard. */
  const requireCustomer = (req, res, next) => {
    const row = currentCustomer(req);
    if (!row) return res.status(401).json({ error: 'برای ادامه وارد حساب خود شوید.' });
    req.customer = row;
    next();
  };
  r.requireCustomer = requireCustomer;
  r.currentCustomer = currentCustomer;

  const startSession = (req, res, customerId) => {
    const { token, hash } = newSessionToken();
    db.insertSession(D, {
      tokenHash: hash,
      customerId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
      ua: req.get('user-agent') || '',
    });
    /* This includes direct TLS, trusted X-Forwarded-Proto, and the guarded
       PUBLIC_ORIGIN fallback used by proxies that omit the protocol header. */
    res.setHeader('Set-Cookie', sessionCookie(token, { secure: isSecureRequest(req) }));
  };

  const profileOf = (row) => ({
    ...db.publicCustomer(row),
    phoneLocal: toLocalPhone(row.phone),
  });

  /* A session-changing response and `/me` must describe the account in the
     same shape. Returning this snapshot directly from register/login/reset
     avoids a second request racing the Set-Cookie update, while no-store
     prevents a browser cache from replaying the signed-out or pre-order
     version of this private response after authentication changes. */
  const accountOf = (row) => ({
    customer: profileOf(row),
    addresses: db.listAddresses(D, row.id),
    orders: db.listOrdersForCustomer(D, row.id).map(publicOrderView),
  });

  r.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  });

  /* ------------------------------------------------------- 1. send a code */

  r.post('/api/account/otp', async (req, res) => {
    if (!sameOrigin(req, res)) return;
    const phone = normalizePhone(req.body?.phone);
    const purpose = ['register', 'reset'].includes(req.body?.purpose) ? req.body.purpose : 'register';
    if (!phone) return res.status(400).json({ error: 'شماره موبایل معتبر نیست.' });

    /* Check the shared resend state before the longer-lived limiter. Besides
       avoiding a second message, this makes request two indistinguishable even
       when one phone has older legitimate rate-limit history. Once the row
       expires, the ordinary per-IP and per-phone limits still apply. */
    const existing = db.getOtp(D, phone, purpose);
    if (existing && Date.now() - new Date(existing.at).getTime() < OTP_RESEND_MS) {
      const wait = Math.ceil((OTP_RESEND_MS - (Date.now() - new Date(existing.at).getTime())) / 1000);
      return res.status(429).json({ error: `کد قبلی هنوز معتبر است؛ ${wait} ثانیه دیگر دوباره تلاش کنید.`, retryAfter: wait });
    }

    if (blocked('otpIp', ip(req), res)) return;
    if (blocked('otpPhone', phone, res)) return;

    const requestIp = ip(req);
    const ipAttempt = rateLimiter.reserve('otpIp', requestIp);
    if (ipAttempt.limited) {
      return rateLimitResponse(res, ipAttempt.retryAfter, 'تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید.');
    }
    const phoneAttempt = rateLimiter.reserve('otpPhone', phone);
    if (phoneAttempt.limited) {
      ipAttempt.finish(false);
      return rateLimitResponse(res, phoneAttempt.retryAfter, 'تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید.');
    }

    /* The response AND resend state are identical either way. Previously only
       a number eligible for this flow received an OTP row, so a second quick
       request returned 429 for one class of number and 200 for the other — a
       reliable account-enumeration oracle. An ineligible number gets a random
       256-bit placeholder hash of the same shape; no five-digit code can
       practically match it, but it enforces the same resend window. */
    let shouldSend;
    let code;
    try {
      const exists = Boolean(db.getCustomerByPhone(D, phone));
      shouldSend = purpose === 'register' ? !exists : exists;
      code = shouldSend ? generateOtp() : null;
      db.putOtp(D, {
        phone,
        purpose,
        codeHash: shouldSend ? hashOtp(code, phone, PEPPER) : crypto.randomBytes(32).toString('hex'),
        expiresAt: new Date(Date.now() + OTP_TTL_MS).toISOString(),
      });
      ipAttempt.finish(true);
      phoneAttempt.finish(true);
    } catch (error) {
      ipAttempt.finish(false);
      phoneAttempt.finish(false);
      throw error;
    }

    if (shouldSend) {
      const cfg = smsSettings();
      /* Do not make response latency reveal whether an SMS provider call was
         needed. dispatchSms owns its error handling and durable log, so it can
         run in the background just like order-status messages. */
      void dispatchSms({
        kind: 'otp',
        to: phone,
        ref: purpose,
        /* Free text is the fallback until the sms.ir templates are approved;
           once verifyTemplateId is set the template path is used instead,
           which is what survives operator filtering. */
        text: `خمیرمایه خوزستان\nکد ورود شما: ${code}\nاین کد تا ۲ دقیقه معتبر است.`,
        templateId: cfg.verifyTemplateId || 0,
        params: [{ name: 'CODE', value: code }],
      });
    }

    res.json({ ok: true, sent: true, resendAfter: Math.ceil(OTP_RESEND_MS / 1000) });
  });

  /* ------------------------------------------------- 2. prove the number */

  r.post('/api/account/otp/verify', (req, res) => {
    if (!sameOrigin(req, res)) return;
    const phone = normalizePhone(req.body?.phone);
    const purpose = ['register', 'reset'].includes(req.body?.purpose) ? req.body.purpose : 'register';
    const code = String(req.body?.code || '').replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).trim();
    if (!phone) return res.status(400).json({ error: 'شماره موبایل معتبر نیست.' });

    const row = db.getOtp(D, phone, purpose);
    const bad = () => res.status(400).json({ error: 'کد وارد شده درست نیست یا منقضی شده است.' });
    if (!row) return bad();

    if (new Date(row.expires_at).getTime() <= Date.now()) {
      db.deleteOtp(D, phone, purpose);
      return bad();
    }
    /* Burn the code after a handful of wrong guesses. Five digits is 100,000
       possibilities — plenty against a human, nothing against a script, so
       the attempt counter is the real protection, not the length. */
    if (row.attempts >= OTP_MAX_ATTEMPTS) {
      db.deleteOtp(D, phone, purpose);
      return bad();
    }
    if (!otpMatches(code, phone, PEPPER, row.code_hash)) {
      db.bumpOtpAttempts(D, phone, purpose);
      return bad();
    }

    db.deleteOtp(D, phone, purpose);
    const ticket = crypto.randomBytes(32).toString('base64url');
    db.putTicket(D, {
      ticketHash: hashToken(ticket),
      phone,
      purpose,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    res.json({ ok: true, ticket });
  });

  /* ----------------------------------------------------- 3. registration */

  r.post('/api/account/register', async (req, res) => {
    if (!sameOrigin(req, res)) return;
    if (blocked('register', ip(req), res)) return;

    /* Valid tickets from parallel signup flows can reach scrypt together.
       Reserve before consuming a one-use ticket: a request refused for load
       must not burn the customer's proof and force another OTP round trip. */
    const registrationAttempt = rateLimiter.reserve('register', ip(req));
    if (registrationAttempt.limited) {
      return rateLimitResponse(res, registrationAttempt.retryAfter);
    }

    try {
      const ticket = db.consumeTicket(D, hashToken(String(req.body?.ticket || '')), 'register');
      if (!ticket) {
        registrationAttempt.finish(false);
        return res.status(400).json({ error: 'تأیید شماره منقضی شده است؛ دوباره کد بگیرید.' });
      }

      const problems = passwordProblems(req.body?.password);
      if (problems.length) {
        registrationAttempt.finish(false);
        return res.status(400).json({ error: problems[0], problems });
      }

      const prof = normalizeProfile({ name: req.body?.name, email: req.body?.email });
      if (!prof.ok) {
        registrationAttempt.finish(false);
        return res.status(400).json({ error: Object.values(prof.errors)[0], fields: prof.errors });
      }

      /* The ticket proves this phone, but the account may have been created in
         the meantime — by a second tab, or by someone replaying the flow. */
      if (db.getCustomerByPhone(D, ticket.phone)) {
        registrationAttempt.finish(false);
        return res.status(409).json({ error: 'این شماره قبلاً ثبت شده است؛ وارد شوید.' });
      }

      let passHash;
      try {
        passHash = await hashPasswordAsync(req.body.password);
      } catch (error) {
        registrationAttempt.finish(false);
        throw error;
      }
      /* Async scrypt deliberately yields. Re-check after that yield so two tabs
         completing registration together produce a clean conflict, not a UNIQUE
         exception after both passed the first lookup. */
      if (db.getCustomerByPhone(D, ticket.phone)) {
        registrationAttempt.finish(false);
        return res.status(409).json({ error: 'این شماره قبلاً ثبت شده است؛ وارد شوید.' });
      }
      let row;
      try {
        row = db.insertCustomer(D, {
          id: crypto.randomUUID(),
          phone: ticket.phone,
          name: prof.profile.name,
          email: prof.profile.email,
          passHash,
          at: new Date().toISOString(),
        });
      } catch (error) {
        registrationAttempt.finish(false);
        if (db.getCustomerByPhone(D, ticket.phone)) {
          return res.status(409).json({ error: 'این شماره قبلاً ثبت شده است؛ وارد شوید.' });
        }
        throw error;
      }

      registrationAttempt.finish(true);
      startSession(req, res, row.id);
      res.json({ ok: true, ...accountOf(row) });
    } finally {
      /* Idempotent: explicit success/failure paths already finished it, while
         unexpected database errors still release their in-flight capacity. */
      registrationAttempt.finish(false);
    }
  });

  /* ------------------------------------------------------------ 4. login */

  r.post('/api/account/login', async (req, res) => {
    if (!sameOrigin(req, res)) return;
    const phone = normalizePhone(req.body?.phone);
    const phoneKey = phone || `invalid:${ip(req)}`;
    /* Reserve both buckets before yielding to async scrypt. Without an
       in-flight reservation, a parallel burst could pass every check before
       its first wrong-password result was recorded. */
    const phoneAttempt = rateLimiter.reserve('customerLogin', phoneKey);
    if (phoneAttempt.limited) return rateLimitResponse(res, phoneAttempt.retryAfter);
    const ipAttempt = rateLimiter.reserve('customerLoginIp', ip(req));
    if (ipAttempt.limited) {
      phoneAttempt.finish(false);
      return rateLimitResponse(res, ipAttempt.retryAfter);
    }

    /* One sentence for every failure — wrong number, wrong password,
       blocked account. Anything more tells a stranger which numbers are
       customers of this shop. */
    const deny = () => {
      phoneAttempt.finish(true);
      ipAttempt.finish(true);
      return res.status(401).json({ error: 'شماره موبایل یا رمز عبور درست نیست.' });
    };

    if (!phone) {
      /* Invalid syntax is already distinguishable by the caller; still do the
         same expensive work so this path cannot become a cheap hash-flooding
         variant of the account-existence oracle. */
      await verifyLoginPasswordAsync(String(req.body?.password || ''), null);
      return deny();
    }
    let row;
    let passwordOk;
    let current;
    try {
      row = db.getCustomerByPhone(D, phone);
      /* Never short-circuit before scrypt. A miss uses the process-local dummy
         hash; a blocked account verifies its real hash and is denied afterwards.
         Registered and unregistered phones therefore take the same expensive
         path and return the same message. */
      passwordOk = await verifyLoginPasswordAsync(String(req.body?.password || ''), row?.pass_hash);
      current = row ? db.getCustomerById(D, row.id) : null;
    } catch (error) {
      phoneAttempt.finish(false);
      ipAttempt.finish(false);
      throw error;
    }
    if (
      !row || !current || current.blocked || !passwordOk ||
      current.pass_hash !== row.pass_hash
    ) return deny();

    phoneAttempt.finish(false);
    ipAttempt.finish(false);
    rateLimiter.clear('customerLogin', phoneKey);
    const loggedIn = db.updateCustomer(D, current.id, { lastLoginAt: new Date().toISOString() });
    startSession(req, res, current.id);
    res.json({ ok: true, ...accountOf(loggedIn) });
  });

  /* --------------------------------------------------- 5. password reset */

  r.post('/api/account/reset', async (req, res) => {
    if (!sameOrigin(req, res)) return;
    const ticket = db.consumeTicket(D, hashToken(String(req.body?.ticket || '')), 'reset');
    if (!ticket) return res.status(400).json({ error: 'تأیید شماره منقضی شده است؛ دوباره کد بگیرید.' });

    const problems = passwordProblems(req.body?.password);
    if (problems.length) return res.status(400).json({ error: problems[0], problems });

    const row = db.getCustomerByPhone(D, ticket.phone);
    if (!row) return res.status(400).json({ error: 'حسابی با این شماره پیدا نشد.' });

    const resetCustomer = db.updateCustomer(D, row.id, { passHash: await hashPasswordAsync(req.body.password) });
    /* A reset is also what someone does after losing their phone, so every
       other session must die with the old password. */
    db.deleteSessionsFor(D, row.id);
    startSession(req, res, row.id);
    res.json({ ok: true, ...accountOf(resetCustomer) });
  });

  /* --------------------------------------------------------- 6. session */

  r.get('/api/account/me', (req, res) => {
    const row = currentCustomer(req);
    if (!row) return res.json({ customer: null });
    res.json(accountOf(row));
  });

  /* Order codes are identifiers, not credentials. A customer can read an
     order only through the HttpOnly account session that owns it. */
  r.get('/api/account/orders/:code', requireCustomer, (req, res) => {
    const order = db.getOrderByCode(D, req.params.code);
    if (!order || order.customerId !== req.customer.id) return res.status(404).json({ error: 'not found' });
    res.json({ order: publicOrderView(order) });
  });

  r.post('/api/account/logout', (req, res) => {
    const token = readCookie(req.headers.cookie);
    if (token) db.deleteSession(D, hashToken(token));
    res.setHeader('Set-Cookie', clearCookie({ secure: isSecureRequest(req) }));
    res.json({ ok: true });
  });

  r.post('/api/account/password', requireCustomer, async (req, res) => {
    if (!sameOrigin(req, res)) return;
    /* The current password is required even though the session is valid: a
       borrowed, unlocked laptop must not become a permanent takeover. */
    if (!(await verifyPasswordAsync(String(req.body?.current || ''), req.customer.pass_hash)))
      return res.status(400).json({ error: 'رمز عبور فعلی درست نیست.' });
    const problems = passwordProblems(req.body?.password);
    if (problems.length) return res.status(400).json({ error: problems[0], problems });
    const passHash = await hashPasswordAsync(req.body.password);
    const currentTokenHash = hashToken(String(readCookie(req.headers.cookie) || ''));
    const changed = D.immediateTransaction(() => {
      const updated = db.updateCustomerPasswordIfCurrent(
        D,
        req.customer.id,
        req.customer.pass_hash,
        passHash,
      );
      if (!updated) return false;
      db.deleteOtherSessionsFor(D, req.customer.id, currentTokenHash);
      return true;
    })();
    if (!changed) {
      return res.status(409).json({ error: 'رمز عبور هم‌زمان تغییر کرده است؛ دوباره وارد شوید.' });
    }
    res.json({ ok: true });
  });

  r.put('/api/account/profile', requireCustomer, (req, res) => {
    if (!sameOrigin(req, res)) return;
    const prof = normalizeProfile(req.body || {});
    if (!prof.ok) return res.status(400).json({ error: Object.values(prof.errors)[0], fields: prof.errors });
    const row = db.updateCustomer(D, req.customer.id, prof.profile);
    res.json({ ok: true, customer: profileOf(row) });
  });

  /* ------------------------------------------------------- 7. addresses */

  r.get('/api/account/addresses', requireCustomer, (req, res) => res.json({ addresses: db.listAddresses(D, req.customer.id) }));

  r.post('/api/account/addresses', requireCustomer, (req, res) => {
    if (!sameOrigin(req, res)) return;
    if (db.listAddresses(D, req.customer.id).length >= MAX_ADDRESSES)
      return res.status(409).json({ error: `حداکثر ${MAX_ADDRESSES} نشانی می‌توانید ذخیره کنید.` });
    const v = normalizeAddress(req.body || {});
    if (!v.ok) return res.status(400).json({ error: Object.values(v.errors)[0], fields: v.errors });
    const saved = db.insertAddress(D, req.customer.id, v.address, Boolean(req.body?.isDefault));
    res.json({ ok: true, address: saved, addresses: db.listAddresses(D, req.customer.id) });
  });

  r.put('/api/account/addresses/:id', requireCustomer, (req, res) => {
    if (!sameOrigin(req, res)) return;
    const v = normalizeAddress(req.body || {});
    if (!v.ok) return res.status(400).json({ error: Object.values(v.errors)[0], fields: v.errors });
    /* Scoped to the session's own customer id, so an id guessed from
       somewhere else edits nothing. */
    const saved = db.updateAddress(D, req.customer.id, req.params.id, v.address);
    if (!saved) return res.status(404).json({ error: 'نشانی پیدا نشد.' });
    if (req.body?.isDefault) db.setDefaultAddress(D, req.customer.id, saved.id);
    res.json({ ok: true, address: saved, addresses: db.listAddresses(D, req.customer.id) });
  });

  r.delete('/api/account/addresses/:id', requireCustomer, (req, res) => {
    if (!sameOrigin(req, res)) return;
    if (!db.deleteAddress(D, req.customer.id, req.params.id)) return res.status(404).json({ error: 'نشانی پیدا نشد.' });
    res.json({ ok: true, addresses: db.listAddresses(D, req.customer.id) });
  });

  r.post('/api/account/addresses/:id/default', requireCustomer, (req, res) => {
    if (!sameOrigin(req, res)) return;
    if (!db.getAddress(D, req.customer.id, req.params.id)) return res.status(404).json({ error: 'نشانی پیدا نشد.' });
    res.json({ ok: true, addresses: db.setDefaultAddress(D, req.customer.id, req.params.id) });
  });

  /* ------------------------------------------------- 8. admin read-only+ */

  /* Deliberately narrow. The admin needs to answer "who is this customer,
     what have they ordered, where do they want it" and to stop an abusive
     account — nothing else. There is no endpoint here that reveals a
     password hash or a session, and none that edits someone's address on
     their behalf: a shipping address the customer did not write is a
     parcel sent to the wrong door with nobody to blame. */
  r.get('/api/shop-admin/customers', requireAdmin, (req, res) => {
    const customers = db.listCustomers(D).map((c) => ({
      ...c,
      orderCount: db.listOrdersForCustomer(D, c.id).length,
      addressCount: db.listAddresses(D, c.id).length,
    }));
    res.json({ customers });
  });

  r.get('/api/shop-admin/customers/:id', requireAdmin, (req, res) => {
    const row = db.getCustomerById(D, req.params.id);
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json({
      customer: db.publicCustomer(row),
      addresses: db.listAddresses(D, row.id),
      orders: db.listOrdersForCustomer(D, row.id).map(({ token, ...o }) => o),
    });
  });

  /* Blocking is reversible and does not delete anything: an order history
     is a business record, and a blocked customer may be a mistake. */
  r.patch('/api/shop-admin/customers/:id', requireAdmin, (req, res) => {
    const row = db.getCustomerById(D, req.params.id);
    if (!row) return res.status(404).json({ error: 'not found' });
    const blocked = Boolean(req.body?.blocked);
    db.updateCustomer(D, row.id, { blocked });
    /* A block that leaves the existing session alive blocks nothing. */
    if (blocked) db.deleteSessionsFor(D, row.id);
    res.json({ ok: true, customer: db.publicCustomer(db.getCustomerById(D, row.id)) });
  });

  return r;
}

export { formatAddress };
