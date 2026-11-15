/* ==========================================================================
   Customer accounts — pure logic.
   --------------------------------------------------------------------------
   No database, no express: everything here is a function of its arguments,
   so the security-critical parts (hashing, comparison, expiry, validation)
   are directly testable without a server.

   The threat model this is written against:
     - the database file leaks   → passwords must be useless to the reader
     - an attacker guesses OTPs  → short window, few attempts, hashed at rest
     - an attacker steals a cookie → the stored value must not be the cookie
     - XSS on the shop/admin     → both session cookies are HttpOnly, so JS
                                    can use the active same-origin session but
                                    cannot copy its credential elsewhere
   ========================================================================== */
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { isProvince, normalizePostal } from '../shared/iranGeo.js';
import { normalizePhone } from './sms.js';

/* ------------------------------------------------------------ passwords */

/* scrypt, from node's own crypto — no dependency, and memory-hard, which is
   the property that makes a stolen hash expensive to attack on a GPU. These
   parameters cost ~100ms on a small VPS, which is the right order: slow
   enough to hurt an attacker, fast enough that a login does not feel stuck. */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const scryptAsync = promisify(crypto.scrypt);

const encodedPasswordHash = (salt, key, params = SCRYPT) =>
  `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString('base64')}$${key.toString('base64')}`;

export function hashPassword(password, salt = crypto.randomBytes(16)) {
  const key = crypto.scryptSync(String(password), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 128 * SCRYPT.N * SCRYPT.r * 2,
  });
  /* Self-describing: the parameters travel with the hash, so they can be
     raised later without invalidating everyone's password. */
  return encodedPasswordHash(salt, key);
}

/** Request handlers use libuv's worker-pool variant so scrypt's CPU/memory
 * work does not stop unrelated health checks, callbacks, or static requests. */
export async function hashPasswordAsync(password, salt = crypto.randomBytes(16)) {
  const key = await scryptAsync(String(password), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 128 * SCRYPT.N * SCRYPT.r * 2,
  });
  return encodedPasswordHash(salt, key);
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, salt, key] = String(stored || '').split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(key, 'base64');
    const actual = crypto.scryptSync(String(password), Buffer.from(salt, 'base64'), expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: 128 * Number(N) * Number(r) * 2,
    });
    /* Constant time: a fast "wrong" answer leaks how much of the hash
       matched. */
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export async function verifyPasswordAsync(password, stored) {
  try {
    const [scheme, NText, rText, pText, saltText, keyText] = String(stored || '').split('$');
    const N = Number(NText);
    const r = Number(rText);
    const p = Number(pText);
    if (
      scheme !== 'scrypt' ||
      !Number.isSafeInteger(N) || N <= 1 ||
      !Number.isSafeInteger(r) || r <= 0 ||
      !Number.isSafeInteger(p) || p <= 0
    ) return false;
    const expected = Buffer.from(keyText || '', 'base64');
    const salt = Buffer.from(saltText || '', 'base64');
    if (!expected.length || !salt.length) return false;
    const actual = await scryptAsync(String(password), salt, expected.length, {
      N,
      r,
      p,
      maxmem: 128 * N * r * 2,
    });
    return actual.length === expected.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/* A missing account must cost the same scrypt work as a wrong password for a
   real account. Generate one valid, process-local hash at startup and use it
   on every miss; the random password is never accepted by any route. */
export const DUMMY_PASSWORD_HASH = hashPassword(crypto.randomBytes(32).toString('base64url'));

/** Always perform one full password verification, whether or not a customer
 * row exists. Keeping this decision in a pure helper makes it hard for a
 * future login refactor to accidentally restore the phone-enumeration oracle. */
export function verifyLoginPassword(password, storedHash) {
  return verifyPassword(password, storedHash || DUMMY_PASSWORD_HASH);
}

export async function verifyLoginPasswordAsync(password, storedHash) {
  return verifyPasswordAsync(password, storedHash || DUMMY_PASSWORD_HASH);
}

/** Why a password was refused, in Persian, as a list.
 *
 *  Length is the rule that actually matters; composition rules mostly push
 *  people toward Password1! and a sticky note. The common-password check is
 *  worth more than any character-class requirement. */
const COMMON = new Set([
  '12345678', '123456789', '1234567890', 'password', 'qwertyui', 'iloveyou',
  '11111111', '00000000', 'khyeast1', 'khuzestan', 'abcd1234', 'admin123',
]);

export function passwordProblems(password) {
  const p = String(password ?? '');
  const out = [];
  if (p.length < 8) out.push('رمز عبور باید حداقل ۸ کاراکتر باشد.');
  if (p.length > 200) out.push('رمز عبور بیش از حد طولانی است.');
  if (/^\d+$/.test(p)) out.push('رمز عبور نباید فقط عدد باشد.');
  if (COMMON.has(p.toLowerCase())) out.push('این رمز عبور بسیار رایج است؛ رمز دیگری انتخاب کنید.');
  return out;
}

/* ------------------------------------------------------------- OTP codes */

export const OTP_LENGTH = 5;
export const OTP_TTL_MS = 2 * 60 * 1000; // short: a code is a password
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_MS = 90 * 1000;

/** Uniform over 10^5 — Math.random() is not a CSPRNG and must never pick a
 *  credential. */
export function generateOtp() {
  const max = 10 ** OTP_LENGTH;
  let n;
  do {
    n = crypto.randomBytes(4).readUInt32BE(0);
  } while (n >= Math.floor(0xffffffff / max) * max); // reject the biased tail
  return String(n % max).padStart(OTP_LENGTH, '0');
}

/** Codes are stored hashed and peppered. Hashed, so a leaked database does
 *  not hand over live codes; peppered with the server secret, so the hash
 *  cannot be reversed with a 100,000-entry rainbow table — which is all a
 *  five-digit space needs. */
export function hashOtp(code, phone, pepper) {
  return crypto.createHmac('sha256', String(pepper || '')).update(`${phone}:${code}`).digest('hex');
}

export function otpMatches(code, phone, pepper, storedHash) {
  const a = Buffer.from(hashOtp(code, phone, pepper));
  const b = Buffer.from(String(storedHash || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* -------------------------------------------------------------- sessions */

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = 'ky_customer';

/** The cookie value is the secret; the database stores only its SHA-256.
 *  A dump of the sessions table is then useless for impersonation. */
export function newSessionToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

export function sessionCookie(token, { secure, maxAgeMs = SESSION_TTL_MS } = {}) {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly', // unreadable from JavaScript
    'SameSite=Lax', // a cross-site POST cannot carry it
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export const clearCookie = ({ secure = false } = {}) => {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
};

export function readCookie(header, name = SESSION_COOKIE) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** SameSite=Lax stops the classic cross-site form POST, but it is one
 *  cookie attribute between a session and CSRF. A state-changing request
 *  must also come from our own origin. Requests with no Origin header at all
 *  (curl, a native app) are allowed: they are not browser CSRF, which is
 *  what this defends against. */
export function originAllowed(req, selfOrigin) {
  const origin = req.get?.('origin') || req.headers?.origin;
  if (!origin) return true;
  return origin === selfOrigin;
}

/* ------------------------------------------------------------- addresses */

export const MAX_ADDRESSES = 10;

const clean = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

/**
 * Validate and normalise a Persian postal address.
 * @returns { ok: true, address } | { ok: false, errors: { field: message } }
 */
export function normalizeAddress(raw = {}) {
  const errors = {};
  const a = {
    title: clean(raw.title, 40) || 'نشانی من',
    receiver: clean(raw.receiver, 120),
    phone: normalizePhone(raw.phone),
    province: clean(raw.province, 40),
    city: clean(raw.city, 60),
    address: clean(raw.address, 500),
    plaque: clean(raw.plaque, 20),
    unit: clean(raw.unit, 20),
    postal: normalizePostal(raw.postal),
    note: clean(raw.note, 300),
  };

  if (a.receiver.length < 3) errors.receiver = 'نام گیرنده را کامل بنویسید.';
  /* The receiver's phone, not the account's: parcels are delivered to a
     person at a door, who may not be the person who placed the order. */
  if (!a.phone) errors.phone = 'شماره موبایل گیرنده معتبر نیست.';
  if (!isProvince(a.province)) errors.province = 'استان را از فهرست انتخاب کنید.';
  if (a.city.length < 2) errors.city = 'نام شهر را بنویسید.';
  if (a.address.length < 10) errors.address = 'نشانی را کامل‌تر بنویسید (خیابان، کوچه…).';
  if (!a.postal) errors.postal = 'کد پستی باید ۱۰ رقم معتبر باشد.';

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, address: a };
}

/** One line, for the order snapshot, the admin list and the shipping label. */
export function formatAddress(a = {}) {
  return [
    a.province,
    a.city,
    a.address,
    a.plaque ? `پلاک ${a.plaque}` : '',
    a.unit ? `واحد ${a.unit}` : '',
    a.postal ? `کد پستی ${a.postal}` : '',
  ]
    .filter(Boolean)
    .join('، ');
}

/* --------------------------------------------------------------- profile */

export function normalizeProfile(raw = {}) {
  const errors = {};
  const name = clean(raw.name, 120);
  const email = clean(raw.email, 160).toLowerCase();
  if (name.length < 3) errors.name = 'نام و نام خانوادگی را کامل بنویسید.';
  /* Email is optional — many customers will not have one — but if given it
     has to be plausible. */
  if (email && !/^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/.test(email)) errors.email = 'نشانی ایمیل معتبر نیست.';
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, profile: { name, email } };
}
