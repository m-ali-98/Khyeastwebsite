/* ==========================================================================
   Customer account checks — the pure half.

   What is guarded here, in order of what it would cost to get wrong:

   1. A leaked database must not hand over passwords, live OTP codes, or
      replayable session cookies. All three are stored as one-way values.
   2. Comparisons that decide access are constant time and fail closed.
   3. An address that would produce an undeliverable parcel is refused at
      the door, with a message naming the field.
   4. Persian digits work everywhere a number is typed — postal codes and
      phones both, because a Persian-first site is where they will be typed.

   The HTTP half (rate limits, enumeration, session cookies, ownership) runs
   against a live server in behaviour-account.mjs.
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

const A = await import(pathToFileURL(path.join(ROOT, 'server/accounts.js')).href);
const G = await import(pathToFileURL(path.join(ROOT, 'shared/iranGeo.js')).href);

/* ------------------------------------------------------------ passwords */
{
  const hash = A.hashPassword('correct horse battery');
  check(!hash.includes('correct horse'), 'the password is not in its own hash');
  check(hash.startsWith('scrypt$'), 'the hash names its algorithm', hash.slice(0, 20));
  check(hash.split('$').length === 6, 'parameters travel with the hash, so they can be raised later');

  check(A.verifyPassword('correct horse battery', hash) === true, 'the right password verifies');
  check(A.verifyPassword('correct horse batterx', hash) === false, 'a one-character change fails');
  check(A.verifyPassword('', hash) === false, 'an empty password fails');
  check(A.verifyPassword('correct horse battery', '') === false, 'an empty hash fails closed');
  check(A.verifyPassword('x', 'garbage') === false, 'a corrupt hash fails closed, not throws');
  check(A.verifyPassword('x', 'md5$1$2$3$4$5') === false, 'an unknown scheme is refused');
  check(A.verifyPassword('x', null) === false, 'a null hash fails closed');

  /* Login misses must still execute a real scrypt comparison. A syntactically
     valid dummy hash prevents phone existence from being a 1 ms vs 50 ms
     timing oracle. */
  check(A.DUMMY_PASSWORD_HASH.startsWith('scrypt$'), 'the login miss path has a real scrypt dummy hash');
  check(A.verifyLoginPassword('wrong', null) === false, 'a missing customer runs the dummy comparison and fails');
  check(A.verifyLoginPassword('wrong', hash) === false, 'a real customer with a wrong password follows the same helper');

  /* Two accounts with the same password must not share a hash, or one
     cracked password cracks every account that chose it. */
  const a = A.hashPassword('samepassword');
  const b = A.hashPassword('samepassword');
  check(a !== b, 'the same password hashes differently each time (random salt)');
  check(A.verifyPassword('samepassword', a) && A.verifyPassword('samepassword', b), 'both still verify');

  const weak = A.passwordProblems('1234567');
  check(weak.length > 0, 'a 7-character password is refused');
  check(A.passwordProblems('12345678').length > 0, 'an all-digit password is refused');
  check(A.passwordProblems('password').length > 0, 'a common password is refused');
  check(A.passwordProblems('PASSWORD').length > 0, 'the common-password check is case-insensitive');
  check(A.passwordProblems('khyeast-1404').length === 0, 'a reasonable password is accepted');
  check(A.passwordProblems('x'.repeat(300)).length > 0, 'an absurdly long password is refused');
  check(/[\u0600-\u06FF]/.test(A.passwordProblems('123')[0]), 'the reason is in Persian');
}

/* ------------------------------------------------------------------ OTP */
{
  const seen = new Set();
  for (let i = 0; i < 400; i += 1) {
    const code = A.generateOtp();
    if (!/^\d{5}$/.test(code)) check(false, 'every code is five digits', code);
    seen.add(code);
  }
  check(seen.size > 300, 'codes are not repetitive', `${seen.size} distinct of 400`);

  const pepper = 'server-secret';
  const h = A.hashOtp('12345', '989123456789', pepper);
  check(!h.includes('12345'), 'the code is not stored in its hash');
  check(A.otpMatches('12345', '989123456789', pepper, h) === true, 'the right code matches');
  check(A.otpMatches('12346', '989123456789', pepper, h) === false, 'a wrong code does not');

  /* Bound to the phone: a code sent to one number must not verify another,
     or an attacker requests a code for their own phone and uses it on
     someone else's. */
  check(A.otpMatches('12345', '989120000000', pepper, h) === false, 'a code is bound to its phone number');

  /* Peppered: 100,000 possible codes is a table an attacker can build in a
     second if the hash is unsalted. */
  check(A.hashOtp('12345', '989123456789', 'other-secret') !== h, 'the hash depends on the server secret');
  check(A.otpMatches('12345', '989123456789', 'wrong-pepper', h) === false, 'a code from another server does not verify');
  check(A.otpMatches('12345', '989123456789', pepper, '') === false, 'an empty stored hash fails closed');
  check(A.otpMatches('12345', '989123456789', pepper, 'short') === false, 'a truncated hash fails closed');

  check(A.OTP_TTL_MS <= 5 * 60 * 1000, 'a code expires within five minutes');
  check(A.OTP_MAX_ATTEMPTS <= 5, 'guesses are capped');
}

/* -------------------------------------------------------------- session */
{
  const { token, hash } = A.newSessionToken();
  check(token.length >= 40, 'the session token is long', String(token.length));
  check(hash !== token, 'the database stores a hash, not the cookie value');
  check(A.hashToken(token) === hash, 'and the hash is reproducible from the cookie');
  check(A.newSessionToken().token !== token, 'tokens are not repeated');

  const cookie = A.sessionCookie(token, { secure: true });
  check(cookie.includes('HttpOnly'), 'the cookie is HttpOnly, so XSS cannot read the session');
  check(cookie.includes('SameSite=Lax'), 'the cookie is SameSite=Lax');
  check(cookie.includes('Secure'), 'Secure is set over https');
  check(!A.sessionCookie(token, { secure: false }).includes('Secure'), 'but not over plain http, or dev login breaks');
  check(A.clearCookie().includes('Max-Age=0'), 'logout expires the cookie');

  check(A.readCookie(`a=1; ${A.SESSION_COOKIE}=${token}; b=2`) === token, 'the cookie is read out of a crowded header');
  check(A.readCookie('') === null, 'no cookie, no session');
  check(A.readCookie('ky_customer_other=zzz') === null, 'a lookalike cookie name is not accepted');

  /* CSRF: SameSite is one attribute; the origin is checked too. */
  const req = (origin) => ({ get: (h) => (h.toLowerCase() === 'origin' ? origin : undefined), headers: { origin } });
  check(A.originAllowed(req('https://khuzestanyeast-co.com'), 'https://khuzestanyeast-co.com') === true, 'our own origin is allowed');
  check(A.originAllowed(req('https://evil.example'), 'https://khuzestanyeast-co.com') === false, 'a foreign origin is refused');
  check(A.originAllowed(req(undefined), 'https://khuzestanyeast-co.com') === true, 'a request with no Origin is not browser CSRF');
}

/* ------------------------------------------------------------- postcode */
{
  check(G.normalizePostal('1619637511') === '1619637511', 'a valid code passes');
  check(G.normalizePostal('۱۶۱۹۶۳۷۵۱۱') === '1619637511', 'Persian digits are folded');
  check(G.normalizePostal('16196-37511') === '1619637511', 'a dash is tolerated');
  check(G.normalizePostal('161963751') === null, 'nine digits is refused');
  check(G.normalizePostal('0619637511') === null, 'a code cannot start with zero');
  check(G.normalizePostal('1615637511') === null, 'the fourth digit is never five');
  check(G.normalizePostal('') === null, 'empty is refused');
  check(G.normalizePostal('abcdefghij') === null, 'letters are refused');

  check(G.PROVINCES.length === 31, 'all 31 provinces are listed', String(G.PROVINCES.length));
  check(G.isProvince('خوزستان') === true, 'a real province is accepted');
  check(G.isProvince('Khuzestan') === false, 'the list is the Persian names');
  check(G.isProvince('') === false, 'empty is not a province');
}

/* ------------------------------------------------------------- addresses */
{
  const good = {
    title: 'خانه',
    receiver: 'سید محمد علوی',
    phone: '۰۹۱۲۳۴۵۶۷۸۹',
    province: 'خوزستان',
    city: 'دزفول',
    address: 'خیابان شریعتی، کوچه دوم',
    plaque: '۱۲',
    unit: '۳',
    postal: '۱۶۱۹۶۳۷۵۱۱',
    note: 'زنگ دوم',
  };
  const v = A.normalizeAddress(good);
  check(v.ok === true, 'a complete Persian address is accepted', JSON.stringify(v.errors || {}));
  check(v.address.phone === '989123456789', 'the receiver phone is canonicalised');
  check(v.address.postal === '1619637511', 'the postal code is canonicalised');

  const missing = A.normalizeAddress({ ...good, postal: '12' });
  check(missing.ok === false, 'a bad postal code is refused');
  check(Boolean(missing.errors.postal), 'and the field is named');
  check(Object.keys(missing.errors).length === 1, 'only the broken field is reported');

  for (const [field, patch] of [
    ['receiver', { receiver: 'ع' }],
    ['phone', { phone: '02122578242' }],
    ['province', { province: 'ناکجاآباد' }],
    ['city', { city: '' }],
    ['address', { address: 'کوتاه' }],
  ]) {
    const bad = A.normalizeAddress({ ...good, ...patch });
    check(bad.ok === false && Boolean(bad.errors[field]), `a bad ${field} is refused with a message`, JSON.stringify(bad.errors || {}));
  }

  check(A.normalizeAddress({ ...good, title: '' }).address.title.length > 0, 'an untitled address still gets a name');

  /* The one-line form feeds the order snapshot and the shipping label. */
  const line = A.formatAddress(v.address);
  check(line.includes('خوزستان') && line.includes('دزفول'), 'the one-line form has province and city', line);
  check(line.includes('پلاک') && line.includes('کد پستی'), 'and plaque and postal code', line);
  check(!A.formatAddress({ province: 'تهران', city: 'تهران', address: 'x' }).includes('پلاک'), 'an empty plaque leaves no stray label');

  /* Injection: an address is rendered in the admin panel and on an invoice. */
  const nasty = A.normalizeAddress({ ...good, address: '<script>alert(1)</script> خیابان اول' });
  check(nasty.ok === true, 'odd characters do not crash the validator');
  check(typeof nasty.address.address === 'string', 'the value stays a string');
}

/* --------------------------------------------------------------- profile */
{
  check(A.normalizeProfile({ name: 'سید محمد علوی' }).ok === true, 'a name alone is a valid profile');
  check(A.normalizeProfile({ name: 'ع' }).ok === false, 'a one-letter name is refused');
  check(A.normalizeProfile({ name: 'علی رضایی', email: 'a@b.co' }).ok === true, 'a valid email is accepted');
  check(A.normalizeProfile({ name: 'علی رضایی', email: 'not-an-email' }).ok === false, 'a broken email is refused');
  check(A.normalizeProfile({ name: 'علی رضایی', email: 'A@B.CO' }).profile.email === 'a@b.co', 'email is lower-cased');
}

console.log(`${pass}/${pass + fail}`);
