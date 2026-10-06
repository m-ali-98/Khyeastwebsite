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
import { normalizePhone, toLocalPhone } from './sms.js';
import {
  hashPassword,
  verifyPassword,
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

/* Per-phone and per-IP, because either alone is trivially sidestepped: one
   IP can walk a thousand numbers, and a thousand IPs can hammer one number.

   The two axes are deliberately tuned differently. The PER-PHONE cap is the
   real guard — it is what stops an attacker spending SMS credit and burying
   someone's inbox, and it is strict. The PER-IP caps are blunt, and in Iran
   they are blunter than they look: the mobile networks sit behind
   carrier-grade NAT, so a large number of unrelated customers share one
   public address. An IP cap tight enough to be meaningful against a bot is
   also tight enough to lock out a street. They are set to the loosest value
   that still bounds bulk abuse, and the money is protected by the per-phone
   cap and the daily send ceiling instead.

   The e2e suite also runs every request from one address, and hitting these
   is how that was noticed. */
const LIMITS = {
  /* OTP is the expensive one: every send costs money and lands on someone's
     phone. Deliberately tight — per phone. */
  otpPhone: { max: 5, windowMs: 60 * 60 * 1000 },
  otpIp: { max: 30, windowMs: 60 * 60 * 1000 },
  login: { max: 10, windowMs: 15 * 60 * 1000 },
  /* Registering costs nothing by itself — the SMS that precedes it is
     already capped twice over — so this one can be generous. */
  register: { max: 40, windowMs: 60 * 60 * 1000 },
};

function makeLimiter() {
  const hits = new Map();
  /* Unbounded growth is a memory leak an attacker can drive, so the map is
     swept on every read of a bucket. */
  const prune = (key, windowMs) => {
    const now = Date.now();
    const kept = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (kept.length) hits.set(key, kept);
    else hits.delete(key);
    return kept;
  };
  return {
    exceeded(key, { max, windowMs }) {
      return prune(key, windowMs).length >= max;
    },
    record(key, { windowMs }) {
      const kept = prune(key, windowMs);
      hits.set(key, [...kept, Date.now()]);
    },
    clear(key) {
      hits.delete(key);
    },
  };
}

const tooMany = (res, seconds = 900) => {
  res.setHeader('Retry-After', String(seconds));
  return res.status(429).json({ error: 'تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید.' });
};

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
export function createAccountRouter({ database, dispatchSms, smsSettings, selfOrigin, requireAdmin }) {
  const D = database;
  const r = express.Router();
  const limiter = makeLimiter();
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
    const secure = req.secure || req.get('x-forwarded-proto') === 'https';
    res.setHeader('Set-Cookie', sessionCookie(token, { secure }));
  };

  const profileOf = (row) => ({
    ...db.publicCustomer(row),
    phoneLocal: toLocalPhone(row.phone),
  });

  /* ------------------------------------------------------- 1. send a code */

  r.post('/api/account/otp', async (req, res) => {
    if (!sameOrigin(req, res)) return;
    const phone = normalizePhone(req.body?.phone);
    const purpose = ['register', 'reset'].includes(req.body?.purpose) ? req.body.purpose : 'register';
    if (!phone) return res.status(400).json({ error: 'شماره موبایل معتبر نیست.' });

    if (limiter.exceeded(`otp:ip:${ip(req)}`, LIMITS.otpIp)) return tooMany(res, 3600);
    if (limiter.exceeded(`otp:ph:${phone}`, LIMITS.otpPhone)) return tooMany(res, 3600);

    /* A code already sent moments ago is still valid — resending would cost
       another message and confuse the customer about which code is live. */
    const existing = db.getOtp(D, phone, purpose);
    if (existing && Date.now() - new Date(existing.at).getTime() < OTP_RESEND_MS) {
      const wait = Math.ceil((OTP_RESEND_MS - (Date.now() - new Date(existing.at).getTime())) / 1000);
      return res.status(429).json({ error: `کد قبلی هنوز معتبر است؛ ${wait} ثانیه دیگر دوباره تلاش کنید.`, retryAfter: wait });
    }

    const exists = Boolean(db.getCustomerByPhone(D, phone));
    /* The response is identical either way — see the header comment. The
       *message* differs only in what we bother to send. */
    const shouldSend = purpose === 'register' ? !exists : exists;

    if (shouldSend) {
      const code = generateOtp();
      db.putOtp(D, {
        phone,
        purpose,
        codeHash: hashOtp(code, phone, PEPPER),
        expiresAt: new Date(Date.now() + OTP_TTL_MS).toISOString(),
      });
      const cfg = smsSettings();
      await dispatchSms({
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

    limiter.record(`otp:ip:${ip(req)}`, LIMITS.otpIp);
    limiter.record(`otp:ph:${phone}`, LIMITS.otpPhone);
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

  r.post('/api/account/register', (req, res) => {
    if (!sameOrigin(req, res)) return;
    if (limiter.exceeded(`reg:${ip(req)}`, LIMITS.register)) return tooMany(res, 3600);

    const ticket = db.consumeTicket(D, hashToken(String(req.body?.ticket || '')), 'register');
    if (!ticket) return res.status(400).json({ error: 'تأیید شماره منقضی شده است؛ دوباره کد بگیرید.' });

    const problems = passwordProblems(req.body?.password);
    if (problems.length) return res.status(400).json({ error: problems[0], problems });

    const prof = normalizeProfile({ name: req.body?.name, email: req.body?.email });
    if (!prof.ok) return res.status(400).json({ error: Object.values(prof.errors)[0], fields: prof.errors });

    /* The ticket proves this phone, but the account may have been created in
       the meantime — by a second tab, or by someone replaying the flow. */
    if (db.getCustomerByPhone(D, ticket.phone)) {
      return res.status(409).json({ error: 'این شماره قبلاً ثبت شده است؛ وارد شوید.' });
    }

    const row = db.insertCustomer(D, {
      id: crypto.randomUUID(),
      phone: ticket.phone,
      name: prof.profile.name,
      email: prof.profile.email,
      passHash: hashPassword(req.body.password),
      at: new Date().toISOString(),
    });

    limiter.record(`reg:${ip(req)}`, LIMITS.register);
    startSession(req, res, row.id);
    res.json({ ok: true, customer: profileOf(row) });
  });

  /* ------------------------------------------------------------ 4. login */

  r.post('/api/account/login', (req, res) => {
    if (!sameOrigin(req, res)) return;
    const phone = normalizePhone(req.body?.phone);
    const key = `login:${phone || ip(req)}`;
    if (limiter.exceeded(key, LIMITS.login) || limiter.exceeded(`login:ip:${ip(req)}`, { max: 30, windowMs: 15 * 60 * 1000 }))
      return tooMany(res);

    /* One sentence for every failure — wrong number, wrong password,
       blocked account. Anything more tells a stranger which numbers are
       customers of this shop. */
    const deny = () => {
      limiter.record(key, LIMITS.login);
      limiter.record(`login:ip:${ip(req)}`, { windowMs: 15 * 60 * 1000 });
      return res.status(401).json({ error: 'شماره موبایل یا رمز عبور درست نیست.' });
    };

    if (!phone) return deny();
    const row = db.getCustomerByPhone(D, phone);
    if (!row || row.blocked) return deny();
    if (!verifyPassword(String(req.body?.password || ''), row.pass_hash)) return deny();

    limiter.clear(key);
    db.updateCustomer(D, row.id, { lastLoginAt: new Date().toISOString() });
    startSession(req, res, row.id);
    res.json({ ok: true, customer: profileOf(db.getCustomerById(D, row.id)) });
  });

  /* --------------------------------------------------- 5. password reset */

  r.post('/api/account/reset', (req, res) => {
    if (!sameOrigin(req, res)) return;
    const ticket = db.consumeTicket(D, hashToken(String(req.body?.ticket || '')), 'reset');
    if (!ticket) return res.status(400).json({ error: 'تأیید شماره منقضی شده است؛ دوباره کد بگیرید.' });

    const problems = passwordProblems(req.body?.password);
    if (problems.length) return res.status(400).json({ error: problems[0], problems });

    const row = db.getCustomerByPhone(D, ticket.phone);
    if (!row) return res.status(400).json({ error: 'حسابی با این شماره پیدا نشد.' });

    db.updateCustomer(D, row.id, { passHash: hashPassword(req.body.password) });
    /* A reset is also what someone does after losing their phone, so every
       other session must die with the old password. */
    db.deleteSessionsFor(D, row.id);
    startSession(req, res, row.id);
    res.json({ ok: true, customer: profileOf(db.getCustomerById(D, row.id)) });
  });

  /* --------------------------------------------------------- 6. session */

  r.get('/api/account/me', (req, res) => {
    const row = currentCustomer(req);
    if (!row) return res.json({ customer: null });
    res.json({
      customer: profileOf(row),
      addresses: db.listAddresses(D, row.id),
      orders: db.listOrdersForCustomer(D, row.id).map(({ token, ...o }) => ({ ...o, trackToken: token })),
    });
  });

  r.post('/api/account/logout', (req, res) => {
    const token = readCookie(req.headers.cookie);
    if (token) db.deleteSession(D, hashToken(token));
    res.setHeader('Set-Cookie', clearCookie());
    res.json({ ok: true });
  });

  r.post('/api/account/password', requireCustomer, (req, res) => {
    if (!sameOrigin(req, res)) return;
    /* The current password is required even though the session is valid: a
       borrowed, unlocked laptop must not become a permanent takeover. */
    if (!verifyPassword(String(req.body?.current || ''), req.customer.pass_hash))
      return res.status(400).json({ error: 'رمز عبور فعلی درست نیست.' });
    const problems = passwordProblems(req.body?.password);
    if (problems.length) return res.status(400).json({ error: problems[0], problems });
    db.updateCustomer(D, req.customer.id, { passHash: hashPassword(req.body.password) });
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
