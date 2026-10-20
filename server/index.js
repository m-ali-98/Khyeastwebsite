/* ==========================================================================
   Khuzestan Yeast Co. — content & shop API server
   --------------------------------------------------------------------------
   Database : server/data/khyeast.db  (SQLite / WAL — transactional)
              → shop products, shop settings, payment credentials,
                orders + order items, product comments, contact messages
   File     : server/data/content.json
              → site texts, media, links, brands, catalog products, blog posts
   Uploads  : server/uploads  (served at /uploads/*)

   The admin can only change content values — never code or styling.
   ========================================================================== */
import express from 'express';
import compression from 'compression';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import DEFAULT_STATE from '../shared/contentDefaults.js';
import { mergeContentState } from '../shared/contentState.js';
import { loadAllPacks } from '../shared/i18n/index.js';
import {
  normalizeOrigin,
  redirectPath,
  renderRobots,
  renderSeoDocument,
  renderSitemap,
  resolveSeo,
} from '../shared/seo.js';
import { createShopRouter, shopProductProblems } from './shop.js';
import { createAccountRouter } from './accountRoutes.js';
import { optimizeImage, optimiserAvailable } from './images.js';
import { UPLOAD_LADDER } from '../shared/uploadSizes.js';
import { trustSealImageOrigins, validateTrustSeals } from '../shared/trustSeals.js';
import * as store from './db.js';
import { createRateLimiter, rateLimitResponse } from './rateLimits.js';
import { readCookie } from './accounts.js';
import { sanitizeContentPayload } from './sanitize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* Load server/.env or ./.env if present, without adding a dependency.
   Real environment variables always win, so a host's own settings are never
   overridden by a stale file. */
for (const envPath of [path.join(__dirname, '.env'), path.join(__dirname, '..', '.env')]) {
  if (!fs.existsSync(envPath)) continue;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    if (val && process.env[key] === undefined) process.env[key] = val;
  }
}

/* Evaluate filesystem overrides only after .env has been loaded. This keeps a
   cPanel deployment and the scratch test harnesses out of the real data tree. */
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(__dirname, 'uploads');
const CONTENT_FILE = path.join(DATA_DIR, 'content.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json'); // legacy — imported once
const SHOP_FILE = path.join(DATA_DIR, 'shop.json'); // legacy — imported once
const DB_FILE = process.env.DB_FILE ? path.resolve(process.env.DB_FILE) : path.join(DATA_DIR, 'khyeast.db');
const PORT = process.env.PORT || 8787;

/* The SEO renderer needs all three translation packs synchronously while it
   answers a direct request. The browser still downloads only its active pack;
   this server-side preload does not affect client bundle size. */
await loadAllPacks();

/* --------------------------------------------------------------------------
   Credentials.

   The dev fallbacks below are published in this repository, so on a public
   server they are equivalent to having no password at all: ADMIN_SECRET signs
   the session tokens, and anyone who knows it can mint a valid admin token
   without ever touching the login endpoint — no password, and the rate limit
   never applies because the login route is never called.

   Production therefore refuses to start until real values are supplied.
   Set them in the host's environment (never in a committed file):

     ADMIN_USER=...  ADMIN_PASS=...  ADMIN_SECRET=...
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   -------------------------------------------------------------------------- */
const DEV_PASS = 'khyeast-1404';
const DEV_SECRET = 'khyeast-content-secret-dev';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || DEV_PASS;
const SECRET = process.env.ADMIN_SECRET || DEV_SECRET;
const IS_PROD = process.env.NODE_ENV === 'production';

if (IS_PROD) {
  const problems = [];
  if (ADMIN_PASS === DEV_PASS) problems.push('ADMIN_PASS is still the published default');
  if (SECRET === DEV_SECRET) problems.push('ADMIN_SECRET is still the published default');
  if (ADMIN_PASS.length < 12) problems.push('ADMIN_PASS is shorter than 12 characters');
  if (SECRET.length < 32) problems.push('ADMIN_SECRET is shorter than 32 characters');
  if (!process.env.PUBLIC_ORIGIN && !process.env.TRUSTED_HOSTS) {
    problems.push(
      'neither PUBLIC_ORIGIN nor TRUSTED_HOSTS is set — payment callback URLs ' +
        "would be built from the client's Host header",
    );
  }
  if (problems.length) {
    console.error('\n[content-api] REFUSING TO START — insecure configuration:');
    for (const p of problems) console.error('  • ' + p);
    console.error('\n  Fix these in the environment. Generate a secret with:');
    console.error('    node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n');
    process.exit(1);
  }
} else if (ADMIN_PASS === DEV_PASS || SECRET === DEV_SECRET) {
  console.warn('[content-api] WARNING: using published development credentials — never deploy this way.');
}

const TOKEN_TTL = 1000 * 60 * 60 * 12; // 12h

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(CONTENT_FILE)) fs.writeFileSync(CONTENT_FILE, JSON.stringify(DEFAULT_STATE, null, 2));

const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJSON = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2));

/* ---------------- database ---------------- */
const db = await store.openDB(DB_FILE);
const seedReport = store.seedFromLegacy(db, { CONTENT_FILE, SHOP_FILE, MESSAGES_FILE });
if (!seedReport.skipped) {
  console.log(
    `[db] initialised ${path.relative(process.cwd(), DB_FILE)} — ` +
      `products: ${seedReport.products}, orders: ${seedReport.orders}, ` +
      `comments: ${seedReport.comments}, messages: ${seedReport.messages}` +
      (seedReport.from.length ? ` (imported from ${seedReport.from.join(', ')})` : ' (from defaults)'),
  );
}

const rateLimiter = createRateLimiter({ database: db, store });

/* content.json no longer stores the shop section — the DB does. */
try {
  const c = readJSON(CONTENT_FILE);
  if (c.shop) {
    delete c.shop;
    writeJSON(CONTENT_FILE, c);
    console.log('[db] moved "shop" section out of content.json into the database');
  }
} catch {}

/** Site content = JSON file + shop section rebuilt from the database. */
const readContent = () => {
  let base;
  try {
    base = readJSON(CONTENT_FILE);
  } catch {
    base = { ...DEFAULT_STATE };
    delete base.shop;
  }
  return {
    ...base,
    i18n: base.i18n && typeof base.i18n === 'object' ? base.i18n : { en: {}, ar: {} },
    shop: {
      display: { ...DEFAULT_STATE.shop.display, ...(store.getSetting(db, 'shop.display') || {}) },
      products: store.listProducts(db),
    },
  };
};

/** Persist site content: shop → database, everything else → JSON file.
 *
 *  Stock is deliberately NOT taken from this payload. The admin panel loads
 *  /api/content once when it mounts and then holds that snapshot; meanwhile
 *  customer orders and order-status changes move stock in the database. Saving
 *  any unrelated edit (a price, a description) used to write the stale
 *  snapshot back over the live figures, silently undoing every sale made since
 *  the page was opened — a customer's order would vanish from inventory.
 *
 *  The shop editor does have an inventory field. Existing stock changes use a
 *  dedicated compare-and-set endpoint after this content save, so an explicit
 *  edit is applied only if the live value still matches what the admin saw.
 *  A genuinely new product keeps the initial stock carried by this payload. */
const writeContent = (next) => {
  /* The panel sanitizes for immediate preview, but only this server-side pass
     protects direct API callers and future clients. Store only canonical safe
     HTML in both content.json and the shop database. */
  const sanitized = sanitizeContentPayload(next);
  const { shop, ...rest } = sanitized;
  if (shop && typeof shop === 'object') {
    if (Array.isArray(shop.products)) store.replaceProducts(db, shop.products, { preserveStock: true });
    if (shop.display && typeof shop.display === 'object')
      store.setSetting(db, 'shop.display', {
        ...DEFAULT_STATE.shop.display,
        ...(store.getSetting(db, 'shop.display') || {}),
        ...shop.display,
      });
  }
  writeJSON(CONTENT_FILE, rest);
};

/* ---------------- auth ---------------- */
/* Tokens are signed and carry an expiry, but a signature alone cannot be taken
   back: until this session store existed, logging out only dropped the token
   from the browser's localStorage, and a copy captured in the meantime stayed
   valid for the rest of its 12 hours with no way to stop it.
 
   So every token also carries a session id, and a session is only accepted
   while it is listed here. Logging out removes the entry, which makes every
   copy of that token dead immediately. The list is an allowlist rather than a
   blocklist of revoked ids: entries can be pruned once they expire without
   ever reviving a token, and a session the server has no record of is refused
   by default.
 
   It lives in the settings table so it survives a restart — otherwise every
   deploy would silently sign the admin out. */
const SESSION_KEY = 'auth.sessions';

const loadSessions = () => {
  const raw = store.getSetting(db, SESSION_KEY, {});
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
};

/* Drop expired ids on every write so the row cannot grow without bound. */
const saveSessions = (sessions) => {
  const now = Date.now();
  const live = {};
  for (const [sid, exp] of Object.entries(sessions)) {
    if (typeof exp === 'number' && exp > now) live[sid] = exp;
  }
  store.setSetting(db, SESSION_KEY, live);
  return live;
};

const sessionStart = (exp) => {
  const sid = crypto.randomBytes(16).toString('hex');
  saveSessions({ ...loadSessions(), [sid]: exp });
  return sid;
};

const sessionEnd = (sid) => {
  const sessions = loadSessions();
  if (!(sid in sessions)) return false;
  delete sessions[sid];
  saveSessions(sessions);
  return true;
};

const sessionEndAll = () => store.setSetting(db, SESSION_KEY, {});

const sign = (payload) => {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
};
const verify = (token) => {
  try {
    const [body, sig] = String(token).split('.');
    const expect = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp < Date.now()) return null;
    /* A correctly signed token whose session has been ended — or which predates
       session tracking entirely — is no longer usable. */
    if (typeof payload.sid !== 'string') return null;
    const exp = loadSessions()[payload.sid];
    if (typeof exp !== 'number' || exp <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
};
/* __Host- forces supporting browsers to require Secure + Path=/ and forbids a
   Domain attribute. A compromised sibling subdomain can therefore neither set
   nor shadow the Admin credential. */
const ADMIN_COOKIE = '__Host-ky_admin';
const LEGACY_ADMIN_COOKIE = 'ky_admin';
const bearer = (req) => {
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
};
const adminCookie = (token) => [
  `${ADMIN_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=${Math.floor(TOKEN_TTL / 1000)}`,
  /* Expire the pre-hardening cookie during migration. */
  `${LEGACY_ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0`,
];
const clearAdminCookie = () => [
  `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0`,
  `${LEGACY_ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0`,
];
const ownOrigin = (req) => {
  if (process.env.PUBLIC_ORIGIN) return String(process.env.PUBLIC_ORIGIN).replace(/\/+$/, '');
  return `${req.secure ? 'https' : 'http'}://${req.get('host')}`;
};
const requireAuth = (req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  /* Bearer support remains for trusted scripts and existing integrations, but
     the browser panel uses only the HttpOnly cookie. A script injected into
     the page can issue a request while it runs; it can no longer copy the
     credential out of localStorage and take it somewhere else. */
  const bearerToken = bearer(req);
  const cookieToken = readCookie(req.headers.cookie, ADMIN_COOKIE);
  const token = bearerToken || cookieToken;
  const payload = token && verify(token);
  if (!payload) return res.status(401).json({ error: 'unauthorized' });

  /* Cookie authentication needs an explicit CSRF boundary in addition to
     SameSite=Strict. Native tools omit Origin and use Bearer; a browser that
     sends an Origin on a state change must name this exact site. */
  if (!bearerToken && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.get('origin');
    if (origin && origin !== ownOrigin(req)) return res.status(403).json({ error: 'forbidden' });
  }
  req.session = payload;
  next();
};

/* ---------------- uploads ---------------- */
/* SVG is deliberately NOT accepted. An .svg is an XML document that may carry
   <script> and event handlers, and it is served from our own origin — so an
   uploaded SVG becomes stored XSS able to act through the admin's live cookie
   even though HttpOnly prevents stealing that credential. Raster formats
   cannot execute. */
const ALLOWED = {
  image: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'],
  video: ['.mp4', '.webm', '.mov', '.m4v'],
};

/* Trust the bytes, not the filename: an attacker controls the extension, so a
   .png that is really HTML would still be sniffed as a document by some
   browsers. Each signature is checked against the file's magic number. */
const MAGIC = [
  { ext: '.png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: '.jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: '.gif', test: (b) => b.subarray(0, 6).toString('latin1').match(/^GIF8[79]a$/) },
  { ext: '.webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { ext: '.avif', test: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' },
  { ext: '.mp4', test: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' },
  { ext: '.m4v', test: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' },
  { ext: '.mov', test: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' },
  { ext: '.webm', test: (b) => b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) },
];

/** Does the file's content actually match the extension it claims? */
const contentMatchesExt = (buf, ext) => {
  if (!buf || buf.length < 12) return false;
  const key = ext === '.jpeg' ? '.jpg' : ext;
  const sigs = MAGIC.filter((m) => m.ext === key);
  return sigs.length ? sigs.some((m) => Boolean(m.test(buf))) : false;
};
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
});

const DIST = path.join(__dirname, '..', 'dist');

const app = express();

/* Apache/Passenger on cPanel normally reaches Node over loopback or a private
   address. Trusting only those proxy ranges lets Express peel their
   X-Forwarded-For hop and expose the real visitor as req.ip, while a direct
   public connection still cannot spoof that header. Override with TRUST_PROXY
   when the deployment topology is different (`false`, a hop count, or any
   Express proxy-addr expression). Never default to `true`, which trusts every
   client-supplied hop. */
const parseTrustProxy = (raw) => {
  const value = String(raw ?? '').trim();
  if (!value) return 'loopback, linklocal, uniquelocal';
  if (/^(false|off|no|0)$/i.test(value)) return false;
  if (/^(true|on|yes)$/i.test(value)) return true;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
};
const TRUST_PROXY_SETTING = parseTrustProxy(process.env.TRUST_PROXY);
app.set('trust proxy', TRUST_PROXY_SETTING);
if (TRUST_PROXY_SETTING === true) {
  console.warn('[content-api] WARNING: TRUST_PROXY=true trusts forwarded IP headers from every direct client.');
}

/* gzip/deflate every text response — the single biggest win on slow links
   (HTML/JS/CSS/JSON shrink ~70%). Images are already compressed, so skipped. */
app.use(
  compression({
    threshold: 512,
    filter: (req, res) => (req.headers['x-no-compression'] ? false : compression.filter(req, res)),
  }),
);

/* ---------------- security headers ----------------
   Defence in depth for the whole surface. The site loads nothing from a third
   party — no CDN fonts, no analytics, no embeds — so the policy can be strict:
   everything comes from our own origin and nothing else.

   script-src is hash-based rather than 'unsafe-inline'. index.html carries one
   inline bootstrap script (it sets lang/dir/theme before first paint so the
   page never flashes the wrong direction), and its sha256 is computed from the
   built file at startup. That means an edit to the script keeps working with
   no hand-maintained constant, while any script an attacker manages to inject
   into the DOM has the wrong hash and will not run.

   style-src still needs 'unsafe-inline': the animation layer writes inline
   style attributes on elements, and CSP blocks those without it. Styles cannot
   execute, so the residual risk is defacement rather than code execution. */
const scriptHashesFromHtml = (html) => {
  const out = [];
  for (const match of String(html || '').matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    /* The browser hashes the script text as the HTML parser produced it,
       and the parser normalises CRLF to LF. A file checked out on Windows
       (or edited there) carries CRLF, so hashing the raw bytes yields a
       digest the browser never computes — and the inline boot script is
       blocked on every page load. Normalise before hashing. */
    const text = match[1].replace(/\r\n/g, '\n');
    out.push(`'sha256-${crypto.createHash('sha256').update(text, 'utf8').digest('base64')}'`);
  }
  return out.join(' ');
};

const scriptHashes = () => {
  try {
    return scriptHashesFromHtml(fs.readFileSync(path.join(DIST, 'index.html'), 'utf8'));
  } catch {
    return '';
  }
};

/* Computed once at boot for APIs/assets. Route HTML recalculates the second
   hash because each page carries different JSON-LD. */
const INLINE_SCRIPTS = scriptHashes();

const makeCsp = (inlineScripts = INLINE_SCRIPTS, trustedImageOrigins = []) => [
  "default-src 'self'",
  `script-src 'self' ${inlineScripts}`.trim(),
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob:${trustedImageOrigins.length ? ` ${trustedImageOrigins.join(' ')}` : ''}`,
  "media-src 'self'",
  "font-src 'self'",
  /* The admin panel talks to this origin only. */
  "connect-src 'self'",
  /* Nothing is ever embedded, and we embed nothing. */
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  /* There are no <form> posts — the admin uses fetch — so block them all. */
  "form-action 'self'",
  'upgrade-insecure-requests',
].join('; ');

const CSP = makeCsp();

app.disable('x-powered-by'); // do not advertise the stack

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY'); // for pre-CSP browsers
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=(), usb=(), interest-cohort=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  /* HSTS only over TLS, and only in production — sending it from a plain-HTTP
     dev server would pin developers to https://localhost. */
  if (IS_PROD && req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

app.use(express.json({ limit: '8mb' }));

/* ---------------- public ---------------- */
/* `imageOptimiser` is here so a deployment can be checked without uploading
   anything: sharp carries a native binary, and on a host that cannot install
   it uploads keep working but are stored as they arrive. */
app.get('/api/health', async (_req, res) =>
  res.json({ ok: true, db: 'sqlite', imageOptimiser: await optimiserAvailable() }),
);

app.get('/api/content', (_req, res) => {
  /* Public copy is edited while visitors may already have the SPA open. A
     cached JSON response would make route-level revalidation meaningless, so
     neither the browser nor an intermediary may store this snapshot. */
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  try {
    res.json(readContent());
  } catch {
    res.json(DEFAULT_STATE);
  }
});

/* The contact form is public and unauthenticated, so without a limit anyone
   can flood the inbox. The shared limiter defaults to a generous 30 valid
   messages per visitor / 10 minutes and can be tuned or disabled in Admin. */
app.post('/api/messages', (req, res) => {
  const ip = req.ip || 'unknown';
  const limit = rateLimiter.check('message', ip);
  if (limit.limited)
    return rateLimitResponse(res, limit.retryAfter, 'too many messages, please try again later');
  const { name, phone, email, subject, message } = req.body || {};
  if (!name || !phone || !message) return res.status(400).json({ error: 'fields required' });
  /* Count the attempt only once it is known to be a real submission. Charging
     the quota before validation meant a visitor who mistyped their phone five
     times was locked out for ten minutes without ever sending a message. */
  rateLimiter.record('message', ip);
  const item = {
    id: crypto.randomUUID(),
    name: String(name).slice(0, 200),
    phone: String(phone).slice(0, 40),
    email: String(email || '').slice(0, 200),
    subject: String(subject || '').slice(0, 200),
    message: String(message).slice(0, 5000),
    at: new Date().toISOString(),
    read: false,
  };
  store.insertMessage(db, item);
  res.json({ ok: true, id: item.id });
});

/* ---------------- auth ---------------- */
app.use('/api/auth', (_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
});

/* Failed admin logins share the runtime-configurable limiter. The default is
   intentionally much more forgiving than the old eight-attempt ceiling, but
   still bounds network-speed password guessing. */
app.post('/api/auth/login', (req, res) => {
  const ip = req.ip || 'unknown';
  const limit = rateLimiter.check('adminLogin', ip);
  if (limit.limited)
    return rateLimitResponse(res, limit.retryAfter, 'too many attempts, try again later');

  const { user, pass } = req.body || {};
  /* Compare in constant time so response latency cannot reveal how much of
     the credential was correct. */
  const eq = (a, b) => {
    const ba = Buffer.from(String(a ?? ''));
    const bb = Buffer.from(String(b ?? ''));
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
  };
  if (!eq(user, ADMIN_USER) || !eq(pass, ADMIN_PASS)) {
    rateLimiter.record('adminLogin', ip);
    return res.status(401).json({ error: 'invalid credentials' });
  }

  rateLimiter.clear('adminLogin', ip); // successful login clears the counter
  const exp = Date.now() + TOKEN_TTL;
  const token = sign({ user, exp, sid: sessionStart(exp) });
  res.setHeader('Set-Cookie', adminCookie(token));
  /* The credential exists only in Set-Cookie. Returning it in JSON would make
     the supposedly HttpOnly session readable to page JavaScript at login. */
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  /* Session discovery is an expected anonymous request on the address-bar-only
     Admin page. Return a quiet negative result when there is no credential at
     all (rather than creating a noisy browser 401); presented-but-invalid or
     revoked credentials still fail closed through requireAuth. */
  if (!bearer(req) && !readCookie(req.headers.cookie, ADMIN_COOKIE)) {
    return res.json({ ok: false, authenticated: false });
  }
  return requireAuth(req, res, () => res.json({ ok: true, authenticated: true }));
});

/* Ending the session server-side is what actually revokes the credential;
   expiring the browser cookie alone would only hide its copied value. */
app.post('/api/auth/logout', requireAuth, (req, res) => {
  sessionEnd(req.session.sid);
  res.setHeader('Set-Cookie', clearAdminCookie());
  res.json({ ok: true });
});

/* Escape hatch for a token believed to be stolen: invalidates every session,
   including the caller's, so the admin can lock everyone out and log back in. */
app.post('/api/auth/logout-all', requireAuth, (req, res) => {
  sessionEndAll();
  res.setHeader('Set-Cookie', clearAdminCookie());
  res.json({ ok: true });
});

/* ---------------- admin: proxy + rate limits ---------------- */
const trustProxyDescription = () => {
  if (TRUST_PROXY_SETTING === false) return 'disabled';
  if (TRUST_PROXY_SETTING === true) return 'all (unsafe unless direct access is impossible)';
  if (typeof TRUST_PROXY_SETTING === 'number') return `${TRUST_PROXY_SETTING} hop(s)`;
  return String(TRUST_PROXY_SETTING);
};

const securitySnapshot = (req) => {
  const forwardedFor = String(req.get('x-forwarded-for') || '').slice(0, 500);
  const socketIp = String(req.socket?.remoteAddress || 'unknown');
  const forwardedSeen = Boolean(forwardedFor);
  const proxyResolved = forwardedSeen && Array.isArray(req.ips) && req.ips.length > 0;
  return {
    rateLimits: rateLimiter.settings(),
    proxy: {
      setting: trustProxyDescription(),
      configuredBy: process.env.TRUST_PROXY === undefined ? 'safe-default' : 'environment',
      clientIp: req.ip || 'unknown',
      chain: Array.isArray(req.ips) ? req.ips : [],
      socketIp,
      forwardedFor,
      status: !forwardedSeen ? 'direct' : proxyResolved ? 'resolved' : 'forwarded-header-not-trusted',
    },
  };
};

app.get('/api/admin/security', requireAuth, (req, res) => res.json(securitySnapshot(req)));
app.put('/api/admin/security', requireAuth, (req, res) => {
  rateLimiter.update(req.body?.rateLimits || req.body || {});
  res.json({ ok: true, ...securitySnapshot(req) });
});

/* ---------------- admin: content ---------------- */
const REQUIRED_KEYS = ['texts', 'media', 'links', 'collections', 'brands', 'products', 'posts', 'shop'];
app.put('/api/content', requireAuth, (req, res) => {
  const next = req.body;
  if (!next || typeof next !== 'object') return res.status(400).json({ error: 'invalid payload' });
  for (const k of REQUIRED_KEYS) if (!(k in next)) return res.status(400).json({ error: `missing key: ${k}` });
  /* The slug is both the primary key and the URL for catalogue products and
     blog posts. A blank one produces /products/ (which collides with the index
     route) and a duplicate makes the second entity permanently unreachable,
     because every lookup is a .find() that stops at the first match. Neither
     is recoverable from the public site, so refuse the save instead. */
  for (const bucket of ['products', 'posts', 'brands']) {
    const list = next[bucket];
    if (!Array.isArray(list)) continue;
    const key = bucket === 'brands' ? 'id' : 'slug';
    const seen = new Set();
    for (let i = 0; i < list.length; i += 1) {
      const id = typeof list[i]?.[key] === 'string' ? list[i][key].trim() : '';
      if (!id) return res.status(400).json({ error: `${bucket}[${i}]: missing ${key}` });
      if (id.length > 120 || !/^[a-z0-9\u0600-\u06FF]+(?:-[a-z0-9\u0600-\u06FF]+)*$/.test(id)) {
        return res.status(400).json({ error: `${bucket}[${i}]: invalid ${key}` });
      }
      if (seen.has(id)) return res.status(400).json({ error: `${bucket}[${i}]: duplicate ${key} "${id}"` });
      seen.add(id);
    }
  }

  if (Array.isArray(next.shop?.products)) {
    const problems = shopProductProblems(next.shop.products);
    if (problems.length) return res.status(400).json({ error: 'invalid shop products', problems });
  }

  /* Trust seals become executable destinations and expand img-src in the
     document CSP, so this collection gets a stricter boundary than ordinary
     copy. Incomplete rows may be saved only while disabled; published rows
     require a label, an HTTPS verification URL and a safe logo URL. */
  if (next.collections?.trustSeals !== undefined) {
    const trustError = validateTrustSeals(next.collections.trustSeals);
    if (trustError) return res.status(400).json({ error: trustError });
  }

  /* never let a payload without translations wipe the stored ones */
  if (!next.i18n || typeof next.i18n !== 'object') next.i18n = readContent().i18n || {};
  writeContent(next);
  res.json({ ok: true });
});

/* ---------------- admin: messages ---------------- */
app.get('/api/messages', requireAuth, (_req, res) => res.json(store.listMessages(db)));

app.patch('/api/messages/:id', requireAuth, (req, res) => {
  const ok = store.updateMessage(db, req.params.id, Boolean(req.body?.read));
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

app.delete('/api/messages/:id', requireAuth, (req, res) => {
  store.deleteMessage(db, req.params.id);
  res.json({ ok: true });
});

/* ---------------- admin: uploads ---------------- */
app.post('/api/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  const ext = path.extname(req.file.originalname).toLowerCase();
  const kind = ALLOWED.image.includes(ext) ? 'image' : ALLOWED.video.includes(ext) ? 'video' : null;
  if (!kind) return res.status(415).json({ error: 'unsupported file type' });
  if (!contentMatchesExt(req.file.buffer, ext))
    return res.status(415).json({ error: 'file content does not match its extension' });

  const dir = path.join(UPLOAD_DIR, `${kind}s`);
  fs.mkdirSync(dir, { recursive: true });
  const stem = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  /* Videos are stored as they arrive. Images go through server/images.js,
     which shrinks them to a sane width and writes the smaller copies the
     browser picks between. It never throws and never refuses: anything it
     cannot improve comes back as the original bytes. */
  const opt =
    kind === 'image'
      ? await optimizeImage(req.file.buffer, ext)
      : { optimised: false, buffer: req.file.buffer, ext, width: null, variants: [], originalBytes: req.file.buffer.length };

  /* Write the smaller copies FIRST and the master last, then hand back the
     -w<width> name. The browser reads that suffix as "the whole ladder is
     there", so it must only ever be published once the ladder really is. If
     any write fails we roll back to the plain name and the plain file, and
     the upload still succeeds — unoptimised beats broken. */
  const written = [];
  let name = `${stem}${opt.ext}`;
  try {
    if (opt.optimised && opt.variants.length) {
      for (const v of opt.variants) {
        const vf = path.join(dir, `${stem}-${v.width}.webp`);
        fs.writeFileSync(vf, v.buffer);
        written.push(vf);
      }
      name = `${stem}-w${opt.width}.webp`;
    }
    const master = path.join(dir, name);
    fs.writeFileSync(master, opt.buffer);
    written.push(master);
  } catch (err) {
    for (const f of written) {
      try { fs.unlinkSync(f); } catch { /* best effort */ }
    }
    name = `${stem}${ext}`;
    fs.writeFileSync(path.join(dir, name), req.file.buffer);
    return res.json({ url: `/uploads/${kind}s/${name}`, optimised: false, bytes: req.file.buffer.length, originalBytes: req.file.buffer.length });
  }

  res.json({
    url: `/uploads/${kind}s/${name}`,
    optimised: Boolean(opt.optimised),
    bytes: opt.buffer.length,
    originalBytes: opt.originalBytes,
    width: opt.width,
  });
});

app.delete('/api/upload', requireAuth, (req, res) => {
  const url = String(req.body?.url || '');
  const m = url.match(/^\/uploads\/(images|videos)\/([\w.-]+)$/);
  if (!m) return res.status(400).json({ error: 'invalid url' });
  const dir = path.join(UPLOAD_DIR, m[1]);

  /* Unlinking can fail on a file that is in use — Windows refuses while any
     handle is open, and a virus scanner or a backup agent can hold one for a
     moment. That must not turn removing a picture into a 500: the admin has
     already stopped referencing it, and a file we could not delete is litter,
     not an error. Report which ones survived instead. */
  const stuck = [];
  const remove = (f) => {
    if (!fs.existsSync(f)) return;
    try {
      fs.unlinkSync(f);
    } catch {
      stuck.push(path.basename(f));
    }
  };

  remove(path.join(dir, m[2]));

  /* An optimised image is a set, not a file. Deleting only the master would
     leave its smaller copies behind for good — nothing else references them,
     so no later pass could ever find them. */
  const opt = m[2].match(/^(.+)-w\d+\.webp$/);
  if (opt) {
    for (const w of UPLOAD_LADDER) remove(path.join(dir, `${opt[1]}-${w}.webp`));
  }
  res.json({ ok: true, stuck });
});

/* Defence in depth for anything already on disk (including files uploaded
   before the signature check existed): never let the browser sniff a
   different type than we declare, and forbid scripts outright so an HTML or
   SVG document served from here cannot execute. */
app.use(
  '/uploads',
  express.static(UPLOAD_DIR, {
    maxAge: '30d',
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; sandbox");
    },
  }),
);

/* ---------------- online shop + customer accounts ---------------- */
const shopRouter = createShopRouter({ database: db, requireAuth, rateLimiter });
app.use(shopRouter);

/* The account router borrows the shop's SMS sender so the daily cap and the
   sms_log stay in one place, and the shop borrows the account router's
   session reader so an order knows who placed it. */
const accountRouter = createAccountRouter({
  database: db,
  dispatchSms: shopRouter.dispatchSms,
  smsSettings: shopRouter.smsSettings,
  requireAdmin: requireAuth,
  rateLimiter,
  /* Same rule as the payment callbacks: PUBLIC_ORIGIN wins, and a Host
     header from the client is never trusted to describe us. */
  selfOrigin: (req) =>
    process.env.PUBLIC_ORIGIN || `${req.secure ? 'https' : 'http'}://${req.get('host')}`,
});
shopRouter.useCustomer(accountRouter.currentCustomer);
app.use(accountRouter);

/* ---------------- production static site + route-aware SEO ---------------- */
if (fs.existsSync(DIST)) {
  const templatePath = path.join(DIST, 'seo-pages', '_template.html');
  const seoTemplate = fs.existsSync(templatePath)
    ? fs.readFileSync(templatePath, 'utf8')
    : fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  const configuredOrigin = process.env.PUBLIC_ORIGIN ? normalizeOrigin(process.env.PUBLIC_ORIGIN) : '';
  const trustedHosts = String(process.env.TRUSTED_HOSTS || '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  /* PUBLIC_ORIGIN is preferred. When a production host uses the allowlist
     instead, its first entry is the canonical host; never let an arbitrary
     Host header write attacker-controlled canonicals into HTML or sitemaps. */
  const canonicalProductionOrigin = configuredOrigin || (IS_PROD && trustedHosts[0] ? normalizeOrigin(`https://${trustedHosts[0]}`) : '');
  const requestOrigin = (req) => {
    if (canonicalProductionOrigin) return canonicalProductionOrigin;
    return normalizeOrigin(`${req.secure ? 'https' : 'http'}://${req.get('host')}`);
  };
  const seoState = () => {
    try {
      return mergeContentState(DEFAULT_STATE, readContent());
    } catch {
      return mergeContentState(DEFAULT_STATE, {});
    }
  };

  /* Normalize protocol/host before any public document or asset is served.
     This sits after the API routers, whose own trusted-origin checks remain
     independent, but before robots, sitemap and static files. */
  app.use((req, res, next) => {
    if (!IS_PROD || !canonicalProductionOrigin) return next();
    const incoming = normalizeOrigin(`${req.secure ? 'https' : 'http'}://${req.get('host')}`);
    if (incoming === canonicalProductionOrigin) return next();
    return res.redirect(301, `${canonicalProductionOrigin}${req.originalUrl}`);
  });

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').setHeader('Cache-Control', 'public, max-age=3600');
    res.send(renderRobots(requestOrigin(req)));
  });
  app.get('/sitemap.xml', (req, res) => {
    res.type('application/xml').setHeader('Cache-Control', 'no-cache');
    res.send(renderSitemap(seoState(), requestOrigin(req)));
  });
  app.get('/index.html', (_req, res) => res.redirect(301, '/'));
  const sendStatic404 = (res) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('Content-Language', 'fa');
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(404).sendFile(path.join(DIST, '404.html'));
  };
  app.get('/404.html', (_req, res) => sendStatic404(res));

  /* Generated files are an Apache implementation detail. Serving them by
     storage path would create a second indexable URL for every page. */
  app.get(/^\/seo-pages(?:\/|$)/i, (_req, res) => sendStatic404(res));

  /* Content-hashed files never change → cache them for a year. `index: false`
     is essential: `/` must pass through the live renderer below so CMS edits
     update its metadata and structured data without a redeploy. */
  app.use(
    express.static(DIST, {
      etag: true,
      index: false,
      redirect: false,
      setHeaders: (res, filePath) => {
        if (/[.-][0-9a-zA-Z_-]{8,}\.(js|css|woff2?|png|jpe?g|webp|svg|avif)$/.test(filePath))
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        else if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
        /* Brand and product artwork in /assets keeps a stable, unhashed name,
           so it cannot be marked immutable — a redesign would be invisible to
           anyone holding the old copy. A week with stale-while-revalidate lets
           a repeat visitor paint from cache instantly while the browser
           refreshes it in the background, instead of re-fetching every day. */
        else if (/\.(png|jpe?g|webp|svg|avif|ico|woff2?)$/.test(filePath))
          res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
        else res.setHeader('Cache-Control', 'public, max-age=86400');
      },
    }),
  );

  app.get(/^\/(?!api|uploads).*/, (req, res) => {
    const origin = requestOrigin(req);
    const queryAt = req.originalUrl.indexOf('?');
    const query = queryAt >= 0 ? req.originalUrl.slice(queryAt) : '';
    const redirect = redirectPath(req.path);
    if (redirect) return res.redirect(301, `${redirect}${query}`);

    const state = seoState();
    const meta = resolveSeo(req.path, state, origin);
    let html;
    try {
      html = renderSeoDocument(seoTemplate, meta, {
        googleVerification: process.env.GOOGLE_SITE_VERIFICATION || '',
        bingVerification: process.env.BING_SITE_VERIFICATION || '',
      });
    } catch (error) {
      console.error('[seo] could not render route metadata:', error.message);
      return res.status(500).type('text/plain').send('internal error');
    }

    /* JSON-LD differs by route and is an inline script element. Hash this
       exact response so the strict CSP permits it without unsafe-inline. */
    res.setHeader(
      'Content-Security-Policy',
      makeCsp(scriptHashesFromHtml(html), trustSealImageOrigins(state.collections?.trustSeals)),
    );
    res.setHeader('Content-Language', meta.lang);
    res.setHeader('Cache-Control', meta.indexable ? 'no-cache' : 'private, no-store');
    res.vary('Host');
    if (!meta.indexable) res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    return res.status(meta.status).type('html').send(html);
  });
}

/* ---------------- error handling ----------------
   Express's default handler renders the stack trace into the response body.
   That hands an attacker absolute filesystem paths, the directory layout and
   the exact dependency versions in use — free reconnaissance from a single
   malformed request. Log the detail server-side; return a bare reason.

   Must be registered last: Express selects error middleware by arity (four
   arguments) and by declaration order. */
// eslint-disable-next-line no-unused-vars -- the 4th arg is what marks this as an error handler
app.use((err, req, res, _next) => {
  /* Multer reports upload problems as errors, not as a rejected request. Left
     to the generic branch they surfaced as HTTP 500 "internal error", so an
     admin uploading a too-large video was told the server had broken. */
  if (err?.name === 'MulterError') {
    const MULTER = {
      LIMIT_FILE_SIZE: [413, 'file too large (max 200MB)'],
      LIMIT_UNEXPECTED_FILE: [400, 'unexpected file field'],
      LIMIT_FILE_COUNT: [400, 'too many files'],
      LIMIT_PART_COUNT: [400, 'too many parts'],
      LIMIT_FIELD_KEY: [400, 'field name too long'],
      LIMIT_FIELD_VALUE: [400, 'field value too long'],
      LIMIT_FIELD_COUNT: [400, 'too many fields'],
    };
    const [code, message] = MULTER[err.code] || [400, 'upload rejected'];
    return res.status(code).json({ error: message });
  }

  const status = Number(err?.status || err?.statusCode) || 500;

  /* Client mistakes are worth naming precisely; anything else is a bug on our
     side and gets a generic message. */
  const message =
    err?.type === 'entity.parse.failed'
      ? 'malformed JSON'
      : err?.type === 'entity.too.large'
        ? 'payload too large'
        : err instanceof URIError
          ? 'malformed URL'
          : status < 500
            ? 'bad request'
            : 'internal error';

  if (status >= 500) console.error(`[content-api] ${req.method} ${req.originalUrl}:`, err);
  if (res.headersSent) return;
  res.status(status === 500 && err instanceof URIError ? 400 : status).json({ error: message });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[content-api] listening on http://0.0.0.0:${PORT}`);
  console.log(`[content-api] database: ${DB_FILE} (${db.driver})`);
  console.log(`[content-api] admin login default user: "${ADMIN_USER}" (set ADMIN_USER / ADMIN_PASS env to change)`);
});

const shutdown = () => {
  try {
    db.close();
  } catch {}
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
