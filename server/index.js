/* ==========================================================================
   Khuzestan Yeast Co. — content & shop API server
   --------------------------------------------------------------------------
   Database : server/data/khyeast.db  (SQLite / WAL — transactional)
              → revisioned CMS sections, shop/settings, orders, payments,
                comments, contact messages and other mutable application state
   Uploads  : server/uploads  (served at /uploads/*; persistent filesystem)

   The admin can only change content values — never code or styling.
   ========================================================================== */
import express from 'express';
import compression from 'compression';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import DEFAULT_STATE from '../shared/contentDefaults.js';
import { mergeContentState } from '../shared/contentState.js';
import { loadAllPacks } from '../shared/i18n/index.js';
import { galleryItemsProblem, galleryOverridesProblem } from '../shared/gallery.js';
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
import {
  deleteUnusedUploads,
  isUploadReferenced,
  listUnusedUploads,
  parseUploadUrl,
  quarantineUploadSet,
  UPLOAD_QUARANTINE_RETENTION_MS,
} from './uploadCleanup.js';
import {
  productImagesProblem,
  productImagesProblemMessage,
  productNeedsImageValidation,
} from '../shared/productImages.js';
import { trustSealImageOrigins, validateTrustSeals } from '../shared/trustSeals.js';
import { salesRepresentativeProblem } from '../shared/salesRepresentatives.js';
import { CONTENT_REVISION_HEADER, parseContentRevision } from '../shared/contentRevision.js';
import { socialLinkOverridesProblem, socialLinksProblem } from '../shared/socialLinks.js';
import { VIDEO_EMBED_FRAME_SOURCES } from '../shared/videoEmbeds.js';
import * as store from './db.js';
import { createRateLimiter, rateLimitResponse } from './rateLimits.js';
import { originAllowed, readCookie } from './accounts.js';
import { sanitizeContentPayload, isRichTextValidationError } from './sanitize.js';
import { createGracefulShutdown } from './gracefulShutdown.js';
import { trustedCsrfOrigins } from './siteOrigin.js';

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
/* Multipart bodies are staged on the same filesystem as live uploads. That
   keeps a 200 MB video out of the JavaScript heap and lets publication use an
   atomic rename. The private directory is neither served nor backed up. */
const UPLOAD_INCOMING_DIR = path.join(UPLOAD_DIR, '.incoming');
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
const PUBLIC_ORIGIN_URL = (() => {
  const value = String(process.env.PUBLIC_ORIGIN || '').trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return (
      ['http:', 'https:'].includes(parsed.protocol) &&
      !parsed.username && !parsed.password && parsed.pathname === '/' &&
      !parsed.search && !parsed.hash
    ) ? parsed : null;
  } catch {
    return null;
  }
})();

if (IS_PROD) {
  const problems = [];
  if (ADMIN_PASS === DEV_PASS) problems.push('ADMIN_PASS is still the published default');
  if (SECRET === DEV_SECRET) problems.push('ADMIN_SECRET is still the published default');
  if (ADMIN_PASS.length < 12) problems.push('ADMIN_PASS is shorter than 12 characters');
  if (SECRET.length < 32) problems.push('ADMIN_SECRET is shorter than 32 characters');
  if (process.env.PUBLIC_ORIGIN && !PUBLIC_ORIGIN_URL) {
    problems.push('PUBLIC_ORIGIN is not a valid http:// or https:// origin');
  }
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

/* Determine freshness before opening SQLite creates a database file. Empty
   directories and abandoned multipart staging are not state; any real file in
   the data/upload trees is. Defaults may be persisted only when this check can
   prove there is no earlier installation to recover. */
const treeHasPersistentFiles = (root) => {
  if (!fs.existsSync(root)) return false;
  const stack = [root];
  while (stack.length) {
    const directory = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return true; }
    for (const entry of entries) {
      if (entry.name === '.gitkeep') continue;
      const target = path.join(directory, entry.name);
      if (path.resolve(target) === path.resolve(UPLOAD_INCOMING_DIR) && entry.isDirectory()) continue;
      if (entry.isDirectory()) stack.push(target);
      else return true;
    }
  }
  return false;
};
const installationWasFresh = !fs.existsSync(DB_FILE) &&
  !treeHasPersistentFiles(DATA_DIR) &&
  !treeHasPersistentFiles(UPLOAD_DIR);

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/* ---------------- database ---------------- */
const db = await store.openDB(DB_FILE, { allowCreate: installationWasFresh });
const installation = store.initializeStore(db, { freshInstall: installationWasFresh });
const contentInitialization = installation.content;
if (contentInitialization.status === 'initialized') {
  console.log('[db] editorial content revision 1 — initialized from immutable defaults');
}
if (contentInitialization.status === 'unavailable') {
  console.error(
    '[content] authoritative SQLite editorial content is unavailable; public reads will use shipped fallback, ' +
    'while Admin writes and upload cleanup remain disabled until a verified database restore: ' +
    contentInitialization.reason,
  );
}
if (installation.operational.status === 'initialized') {
  const report = installation.operational;
  console.log(
    `[db] initialized ${path.relative(process.cwd(), DB_FILE)} — ` +
      `products: ${report.products}, orders: ${report.orders}, ` +
      `comments: ${report.comments}, messages: ${report.messages}`,
  );
}

const rateLimiter = createRateLimiter({ database: db, store, hashSecret: SECRET });

/** Site content = revisioned SQLite editorial sections + normalized shop rows. */
const contentUnavailable = (cause) => Object.assign(
  new Error('persisted SQLite content is missing, unreadable, or invalid'),
  { code: 'CONTENT_UNAVAILABLE', cause },
);

let editorialCache = null;
const invalidateEditorialCache = () => { editorialCache = null; };
const readEditorialStrict = () => {
  const token = store.getContentToken(db);
  if (editorialCache?.key === token.key) return editorialCache.value;
  const value = store.readContentSections(db);
  editorialCache = { key: token.key, value };
  return value;
};

const readContentStrict = () => {
  try {
    const base = readEditorialStrict();
    return {
      ...base,
      shop: {
        display: { ...DEFAULT_STATE.shop.display, ...(store.getSetting(db, 'shop.display') || {}) },
        products: store.listProducts(db),
      },
    };
  } catch (error) {
    if (error?.code === 'CONTENT_UNAVAILABLE') throw error;
    throw contentUnavailable(error);
  }
};

/* Pair the response body with the exact global revision that produced it.
   A deferred SQLite read transaction prevents another Passenger worker from
   committing between the content SELECTs and the revision header. */
const readContentSnapshotStrict = () => db.transaction(() => ({
  content: readContentStrict(),
  revision: store.getContentMeta(db).revision,
}))();

/* Public reads retain the historical availability fallback, but callers can
   distinguish it through X-Khyeast-Content-Status. It must never be fed back
   into a write as though it were persisted state. */
const fallbackContent = () => {
  const base = JSON.parse(JSON.stringify(DEFAULT_STATE));
  return {
    ...base,
    shop: {
      display: { ...DEFAULT_STATE.shop.display, ...(store.getSetting(db, 'shop.display') || {}) },
      products: store.listProducts(db),
    },
  };
};

const readContent = () => {
  try {
    return readContentStrict();
  } catch {
    return fallbackContent();
  }
};

const strictContentForResponse = (res, operation, scope = 'content') => {
  try {
    return readContentStrict();
  } catch (error) {
    console.error(`[${scope}] ${operation} refused:`, error?.cause?.message || error?.message || error);
    res.setHeader('Retry-After', '60');
    res.status(503).json({
      error: 'persisted SQLite content is unavailable; restore a verified database backup before writing',
      code: 'content-unavailable',
    });
    return null;
  }
};

/** Persist sanitized editorial sections and related shop changes inside the
 * caller's one SQLite writer transaction. Existing stock is never copied from
 * the Admin snapshot; the dedicated compare-and-set endpoint remains the only
 * way to change an existing product's operational inventory. */
const writeContent = (next, previous, requestedSections = store.CONTENT_SECTIONS, expectedRevision) => {
  const sanitized = sanitizeContentPayload(next);

  /* Sanitization canonicalizes galleries. For an untouched legacy catalogue
     row that the changed-only validator intentionally skipped, restore exact
     old media fields so an unrelated save cannot silently drop an HTTP,
     duplicate, or formerly trusted URL. The row must be repaired when edited. */
  if (Array.isArray(sanitized.products) && Array.isArray(next.products) && Array.isArray(previous?.products)) {
    const previousBySlug = new Map(previous.products.map((product) => [product?.slug, product]));
    sanitized.products = sanitized.products.map((product, index) => {
      const incoming = next.products[index];
      const prior = previousBySlug.get(incoming?.slug);
      if (productNeedsImageValidation(incoming, prior)) return product;
      const preserved = { ...product };
      for (const field of ['image', 'images']) {
        if (Object.hasOwn(prior, field)) preserved[field] = prior[field];
        else delete preserved[field];
      }
      return preserved;
    });
  }

  const editorialChanges = {};
  for (const section of requestedSections) {
    if (store.CONTENT_SECTIONS.includes(section)) editorialChanges[section] = sanitized[section];
  }
  const editorialResult = store.replaceContentSections(db, editorialChanges, { expectedRevision });

  const shop = sanitized.shop;
  let productsChanged = false;
  if (shop && typeof shop === 'object' && Array.isArray(shop.products)) {
    const oldProducts = Array.isArray(previous?.shop?.products) ? previous.shop.products : null;
    const oldBySlug = new Map((oldProducts || []).map((product) => [product.slug, product]));
    productsChanged = !oldProducts ||
      shop.products.length !== oldProducts.length ||
      shop.products.some((product, index) => (
        product?.slug !== oldProducts[index]?.slug ||
        productNeedsImageValidation(product, oldBySlug.get(product?.slug), { ignore: ['stock'] })
      ));
  }

  const currentDisplay = {
    ...DEFAULT_STATE.shop.display,
    ...(store.getSetting(db, 'shop.display') || {}),
  };
  const nextDisplay = shop?.display && typeof shop.display === 'object'
    ? { ...currentDisplay, ...shop.display }
    : currentDisplay;
  const displayChanged = !isDeepStrictEqual(nextDisplay, currentDisplay);

  if (productsChanged) store.replaceProducts(db, shop.products, { preserveStock: true });
  if (displayChanged) store.setSetting(db, 'shop.display', nextDisplay);

  /* Editorial changes already advanced the token. A shop-only content change
     must do the same, because it is carried by the same GET/PUT snapshot. */
  const revision = (productsChanged || displayChanged) && !editorialResult.changedSections.length
    ? store.advanceContentRevision(db, { expectedRevision })
    : editorialResult.revision;
  if (revision !== expectedRevision) invalidateEditorialCache();

  return {
    revision,
    changedSections: editorialResult.changedSections,
    productsChanged,
    displayChanged,
  };
};

/* Content publication, shop-product saves and destructive upload accounting
   share a process-local lane plus BEGIN IMMEDIATE. The queue orders requests in
   this worker; SQLite provides the cross-worker writer boundary. */
let contentMutationTail = Promise.resolve();
const runContentMutation = (operation) => {
  const execute = () => store.withImmediateTransaction(db, operation);
  const current = contentMutationTail.then(execute, execute);
  contentMutationTail = current.catch(() => {});
  return current;
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
  return db.immediateTransaction(() => {
    saveSessions({ ...loadSessions(), [sid]: exp });
    return sid;
  })();
};

const sessionEnd = (sid) => db.immediateTransaction(() => {
  const sessions = loadSessions();
  if (!(sid in sessions)) return false;
  delete sessions[sid];
  saveSessions(sessions);
  return true;
})();

const sessionEndAll = () => db.immediateTransaction(() => store.setSetting(db, SESSION_KEY, {}))();

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
   nor shadow the Admin credential. Plain-HTTP development uses a separate
   name, so making localhost usable cannot weaken or shadow production auth. */
const ADMIN_COOKIE = '__Host-ky_admin';
const ADMIN_DEV_COOKIE = 'ky_admin_dev';
const LEGACY_ADMIN_COOKIE = 'ky_admin';
const bearer = (req) => {
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
};
const authorityOf = (raw, defaultPort = '443') => {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return null;
  /* Host is an authority, not a URL. Reject delimiters, whitespace and URL
     syntax instead of letting WHATWG normalisation turn a malformed header
     into a trusted hostname. Bracketed IPv6 remains valid. */
  if (!/^(?:\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::\d{1,5})?$/i.test(value)) return null;
  try {
    const parsed = new URL(`http://${value}`);
    if (
      parsed.username || parsed.password || parsed.pathname !== '/' ||
      parsed.search || parsed.hash
    ) return null;
    return {
      host: value,
      hostname: parsed.hostname.replace(/\.$/, ''),
      port: parsed.port || defaultPort,
    };
  } catch {
    return null;
  }
};
const trustedHttpsAuthorities = (() => {
  const entries = [];
  if (PUBLIC_ORIGIN_URL?.protocol === 'https:') {
    entries.push({
      hostname: PUBLIC_ORIGIN_URL.hostname.toLowerCase().replace(/\.$/, ''),
      port: PUBLIC_ORIGIN_URL.port || '443',
    });
  }
  for (const raw of String(process.env.TRUSTED_HOSTS || '').split(',')) {
    const parsed = authorityOf(raw);
    if (parsed) entries.push(parsed);
  }
  return entries;
})();
const trustedProxyPeer = (req) => {
  const trust = req.app?.get?.('trust proxy fn');
  return typeof trust === 'function' && Boolean(trust(req.socket?.remoteAddress, 0));
};
const trustedHttpsHost = (req, peerTrusted) => {
  if (!peerTrusted || !trustedHttpsAuthorities.length) return { matched: false, host: '' };
  /* The fallback contract deliberately requires the actual request Host. Do
     not broaden it to X-Forwarded-Host: that header has no consistent append
     semantics across proxy chains and is unnecessary when Apache preserves
     the public Host as required by the deployment documentation. */
  const parsed = authorityOf(req.get('host'));
  const matched = Boolean(parsed && trustedHttpsAuthorities.some(
    (allowed) => allowed.hostname === parsed.hostname && allowed.port === parsed.port,
  ));
  return {
    matched,
    host: matched ? parsed.host : String(req.get('host') || ''),
  };
};

/** Determine the browser-facing protocol. Express handles ordinary TLS and a
 * trusted X-Forwarded-Proto header. Some cPanel/Passenger stacks preserve the
 * public Host but omit that header; in production only, an HTTPS PUBLIC_ORIGIN
 * may fill that gap when both the socket peer and Host are trusted. */
const transportSecurity = (req) => {
  const directTls = Boolean(req.socket?.encrypted);
  const expressSecure = req.secure === true || req.protocol === 'https';
  const peerTrusted = trustedProxyPeer(req);
  const host = trustedHttpsHost(req, peerTrusted);
  const forwardedProto = String(req.get('x-forwarded-proto') || '').trim();
  const publicOriginFallback = Boolean(
    IS_PROD &&
    PUBLIC_ORIGIN_URL?.protocol === 'https:' &&
    !expressSecure &&
    !forwardedProto &&
    peerTrusted &&
    host.matched
  );
  const secure = expressSecure || publicOriginFallback;
  return {
    secure,
    protocol: secure ? 'https' : 'http',
    source: directTls
      ? 'direct-tls'
      : expressSecure
        ? 'forwarded-proto'
        : publicOriginFallback
          ? 'public-origin-trusted-proxy'
          : 'plain-http',
    expressProtocol: String(req.protocol || 'http'),
    forwardedProto: forwardedProto.slice(0, 120),
    forwardedHost: String(req.get('x-forwarded-host') || '').slice(0, 300),
    requestHost: String(req.get('host') || '').slice(0, 300),
    matchedHost: host.host,
    hostTrusted: host.matched,
    peerTrusted,
    publicOrigin: PUBLIC_ORIGIN_URL?.origin || '',
  };
};
const secureRequest = (req) => transportSecurity(req).secure;
const adminCookieMode = (req) => {
  const secure = secureRequest(req);
  if (secure || process.env.NODE_ENV === 'production') {
    return { name: ADMIN_COOKIE, secure: true, transportAllowed: secure };
  }
  return { name: ADMIN_DEV_COOKIE, secure: false, transportAllowed: true };
};
const serializeAdminCookie = (name, value, { secure = false, maxAge }) =>
  `${name}=${value}; Path=/; HttpOnly; SameSite=Strict;${secure ? ' Secure;' : ''} Max-Age=${maxAge}`;
const adminCookie = (req, token) => {
  const mode = adminCookieMode(req);
  return [
    serializeAdminCookie(mode.name, token, {
      secure: mode.secure,
      maxAge: Math.floor(TOKEN_TTL / 1000),
    }),
    /* Expire old or alternate non-production cookie names. */
    serializeAdminCookie(LEGACY_ADMIN_COOKIE, '', { secure: mode.secure, maxAge: 0 }),
    ...(mode.name === ADMIN_COOKIE
      ? [serializeAdminCookie(ADMIN_DEV_COOKIE, '', { secure: false, maxAge: 0 })]
      : []),
  ];
};
const clearAdminCookie = (req) => {
  const mode = adminCookieMode(req);
  return [
    serializeAdminCookie(mode.name, '', { secure: mode.secure, maxAge: 0 }),
    serializeAdminCookie(LEGACY_ADMIN_COOKIE, '', { secure: mode.secure, maxAge: 0 }),
  ];
};
const ownOrigins = (req) => trustedCsrfOrigins(req, process.env);
const requireAuth = (req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  /* Bearer support remains for trusted scripts and existing integrations, but
     the browser panel uses only the HttpOnly cookie. A script injected into
     the page can issue a request while it runs; it can no longer copy the
     credential out of localStorage and take it somewhere else. */
  const bearerToken = bearer(req);
  const cookieMode = adminCookieMode(req);
  const cookieToken = cookieMode.transportAllowed
    ? readCookie(req.headers.cookie, cookieMode.name)
    : null;
  const token = bearerToken || cookieToken;
  const payload = token && verify(token);
  if (!payload) return res.status(401).json({ error: 'unauthorized' });

  /* Cookie authentication needs an explicit CSRF boundary in addition to
     SameSite=Strict. Native tools omit Origin and use Bearer; browser writes
     must name the canonical site or an explicitly trusted HTTPS alias. */
  if (!bearerToken && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.get('origin');
    if (origin && !originAllowed(req, ownOrigins(req))) return res.status(403).json({ error: 'forbidden' });
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
  { ext: '.webm', test: (b) => b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) },
];

/* ISO BMFF files all begin with `ftyp`; that marker alone also admits HEIC,
   audio, and arbitrary polyglot data. Validate the complete bounded file-type
   box, then require brands for the declared upload extension. */
const isoFileBrands = (buffer) => {
  if (!buffer || buffer.length < 16 || buffer.subarray(4, 8).toString('latin1') !== 'ftyp') return null;
  let headerSize = 8;
  let boxSize = buffer.readUInt32BE(0);
  if (boxSize === 1) {
    if (buffer.length < 24) return null;
    const largeSize = buffer.readBigUInt64BE(8);
    if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    boxSize = Number(largeSize);
    headerSize = 16;
  }
  if (
    boxSize === 0 || boxSize < headerSize + 8 || boxSize > buffer.length ||
    (boxSize - (headerSize + 8)) % 4 !== 0
  ) return null;

  const brands = [buffer.subarray(headerSize, headerSize + 4).toString('latin1')];
  const compatibleStart = headerSize + 8;
  for (let offset = compatibleStart; offset < boxSize; offset += 4) {
    brands.push(buffer.subarray(offset, offset + 4).toString('latin1'));
  }
  return brands;
};
const ISO_BRANDS_BY_EXT = {
  '.avif': new Set(['avif', 'avis']),
  '.mp4': new Set(['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'iso7', 'iso8', 'iso9', 'mp41', 'mp42', 'avc1', 'M4V ']),
  '.m4v': new Set(['M4V ', 'M4VH', 'M4VP', 'mp42', 'isom', 'iso2']),
  '.mov': new Set(['qt  ']),
};

/** Does the file's content actually match the extension it claims? */
const contentMatchesExt = (buf, ext) => {
  if (!buf || buf.length < 12) return false;
  const key = ext === '.jpeg' ? '.jpg' : ext;
  const isoBrands = ISO_BRANDS_BY_EXT[key];
  if (isoBrands) return (isoFileBrands(buf) || []).some((brand) => isoBrands.has(brand));
  const sigs = MAGIC.filter((m) => m.ext === key);
  return sigs.length ? sigs.some((m) => Boolean(m.test(buf))) : false;
};
const UPLOAD_MAX_BYTES = 200 * 1024 * 1024;
const UPLOAD_INCOMING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const UPLOAD_TEMP_NAME = /^upload-[a-z0-9]+-[a-f0-9]{16}\.part$/;

fs.mkdirSync(UPLOAD_INCOMING_DIR, { recursive: true, mode: 0o700 });

/* A killed worker can leave a completed or partial Multer file behind. Remove
   only this application's generated names, and only after a full day, so a
   slow active request can never be mistaken for debris. */
const purgeStaleIncomingUploads = (now = Date.now()) => {
  let entries = [];
  try {
    entries = fs.readdirSync(UPLOAD_INCOMING_DIR, { withFileTypes: true });
  } catch (error) {
    console.error('[upload] could not scan incoming directory:', error.message);
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !UPLOAD_TEMP_NAME.test(entry.name)) continue;
    const file = path.join(UPLOAD_INCOMING_DIR, entry.name);
    try {
      const stat = fs.statSync(file);
      if (now - stat.mtimeMs >= UPLOAD_INCOMING_MAX_AGE_MS) fs.unlinkSync(file);
    } catch (error) {
      if (error?.code !== 'ENOENT') console.error('[upload] could not remove stale incoming file:', error.message);
    }
  }
};
purgeStaleIncomingUploads();
setInterval(purgeStaleIncomingUploads, 60 * 60 * 1000).unref?.();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, done) => done(null, UPLOAD_INCOMING_DIR),
    filename: (_req, _file, done) => {
      try {
        done(null, `upload-${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}.part`);
      } catch (error) {
        done(error);
      }
    },
  }),
  limits: { fileSize: UPLOAD_MAX_BYTES, files: 1, fields: 0, parts: 1 },
});

/* The Admin gallery already sends selected files sequentially. Enforce that
   contract server-side so concurrent tabs cannot run multiple large Sharp
   decoders in one process. Reject before Multer starts reading the body. */
let activeUploadRequests = 0;
const reserveUploadSlot = (req, res, next) => {
  if (activeUploadRequests >= 1) {
    res.setHeader('Retry-After', '5');
    return res.status(503).json({ error: 'another upload is still being processed' });
  }
  activeUploadRequests += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeUploadRequests = Math.max(0, activeUploadRequests - 1);
  };
  req.uploadSlot = { processing: false, release };
  const releaseBeforeProcessing = () => {
    if (!req.uploadSlot.processing) release();
  };
  /* Multer failures never enter the route, so the response lifecycle releases
     their slot. Once image processing starts, only the route's finally block
     may release it—even if the client disconnects while Sharp is still busy. */
  res.once('finish', releaseBeforeProcessing);
  res.once('close', releaseBeforeProcessing);
  next();
};

const readFilePrefix = async (file, length = 4096) => {
  const handle = await fs.promises.open(file, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
};

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
  /* Only provider-specific video player origins are frameable. The shared
     parser emits canonical URLs on precisely these three origins. */
  `frame-src ${VIDEO_EMBED_FRAME_SOURCES.join(' ')}`,
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
  if (IS_PROD && secureRequest(req)) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

/* Keep public JSON requests small. Only authenticated editorial and shop-
   catalogue saves use the larger parser, which is mounted after their auth
   guard so anonymous clients cannot make the server parse multi-megabyte JSON. */
const smallJsonBody = express.json({ limit: '100kb' });
app.use((req, res, next) => {
  const adminLargeJsonWrite = ['PUT', 'PATCH'].includes(req.method) &&
    (req.path === '/api/content' || req.path === '/api/shop-admin/products');
  if (adminLargeJsonWrite) return next();
  return smallJsonBody(req, res, next);
});

/* ---------------- public ---------------- */
/* `imageOptimiser` is here so a deployment can be checked without uploading
   anything: sharp carries a native binary, and on a host that cannot install
   it uploads keep working but are stored as they arrive. */
app.get('/api/health', async (_req, res) =>
  res.json({ ok: true, db: 'sqlite', imageOptimiser: await optimiserAvailable() }),
);

app.get('/api/content', async (_req, res) => {
  /* Public copy is edited while visitors may already have the SPA open. A
     cached JSON response would make route-level revalidation meaningless, so
     neither the browser nor an intermediary may store this snapshot. */
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  try {
    const { content, revision } = readContentSnapshotStrict();
    res.setHeader('X-Khyeast-Content-Status', 'persisted');
    res.setHeader(CONTENT_REVISION_HEADER, String(revision));
    res.json(content);
  } catch {
    /* Keep the public site readable during a restore incident, while exposing
       that this is a shipped fallback rather than authoritative saved state.
       Admin uses the header to display a read-only recovery warning. A fallback
       deliberately has no revision and can never authorize a write. */
    res.setHeader('X-Khyeast-Content-Status', 'fallback');
    try {
      res.json(fallbackContent());
    } catch {
      res.json(DEFAULT_STATE);
    }
  }
});

/* The contact form is public and unauthenticated, so without a limit anyone
   can flood the inbox. The restored default allows five valid messages per
   visitor / 10 minutes and can still be tuned or disabled in Admin. */
app.post('/api/messages', (req, res) => {
  const ip = req.ip || 'unknown';
  const limit = rateLimiter.check('message', ip);
  if (limit.limited)
    return rateLimitResponse(res, limit.retryAfter, 'too many messages, please try again later');
  const { name, phone, email, subject, message } = req.body || {};
  if (!name || !phone || !message) return res.status(400).json({ error: 'fields required' });
  /* Reserve atomically only once this is a real submission. The early check is
     a cheap fast path, while reserve closes the cross-worker check/record race. */
  const attempt = rateLimiter.reserve('message', ip);
  if (attempt.limited) {
    return rateLimitResponse(res, attempt.retryAfter, 'too many messages, please try again later');
  }
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
  try {
    store.insertMessage(db, item);
    attempt.finish(true);
  } catch (error) {
    attempt.finish(false);
    throw error;
  }
  res.json({ ok: true, id: item.id });
});

/* ---------------- auth ---------------- */
app.use('/api/auth', (_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
});

/* Failed Admin logins share the runtime-configurable limiter. The restored
   conservative default bounds network-speed password guessing, and Admin can
   still disable all limiters from the security panel when diagnosing issues. */
app.post('/api/auth/login', (req, res) => {
  const cookieMode = adminCookieMode(req);
  if (!cookieMode.transportAllowed) {
    return res.status(426).json({
      error: 'ورود مدیر در محیط production فقط از طریق HTTPS مجاز است.',
      code: 'https-required',
    });
  }

  const ip = req.ip || 'unknown';
  const attempt = rateLimiter.reserve('adminLogin', ip);
  if (attempt.limited)
    return rateLimitResponse(res, attempt.retryAfter, 'too many attempts, try again later');

  const { user, pass } = req.body || {};
  /* Compare in constant time so response latency cannot reveal how much of
     the credential was correct. */
  const eq = (a, b) => {
    const ba = Buffer.from(String(a ?? ''));
    const bb = Buffer.from(String(b ?? ''));
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
  };
  if (!eq(user, ADMIN_USER) || !eq(pass, ADMIN_PASS)) {
    attempt.finish(true);
    return res.status(401).json({ error: 'invalid credentials' });
  }

  attempt.finish(false);
  rateLimiter.clear('adminLogin', ip); // successful login clears completed failures
  const exp = Date.now() + TOKEN_TTL;
  const token = sign({ user, exp, sid: sessionStart(exp) });
  res.setHeader('Set-Cookie', adminCookie(req, token));
  /* The credential exists only in Set-Cookie. Returning it in JSON would make
     the supposedly HttpOnly session readable to page JavaScript at login. */
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  /* Session discovery is an expected anonymous request on the address-bar-only
     Admin page. Return a quiet negative result when there is no credential at
     all (rather than creating a noisy browser 401); presented-but-invalid or
     revoked credentials still fail closed through requireAuth. */
  const cookieMode = adminCookieMode(req);
  if (
    !bearer(req) &&
    (!cookieMode.transportAllowed || !readCookie(req.headers.cookie, cookieMode.name))
  ) {
    return res.json({ ok: false, authenticated: false });
  }
  return requireAuth(req, res, () => res.json({ ok: true, authenticated: true }));
});

/* Ending the session server-side is what actually revokes the credential;
   expiring the browser cookie alone would only hide its copied value. */
app.post('/api/auth/logout', requireAuth, (req, res) => {
  sessionEnd(req.session.sid);
  res.setHeader('Set-Cookie', clearAdminCookie(req));
  res.json({ ok: true });
});

/* Escape hatch for a token believed to be stolen: invalidates every session,
   including the caller's, so the admin can lock everyone out and log back in. */
app.post('/api/auth/logout-all', requireAuth, (req, res) => {
  sessionEndAll();
  res.setHeader('Set-Cookie', clearAdminCookie(req));
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
  const transport = transportSecurity(req);
  return {
    rateLimits: rateLimiter.settings(),
    rateLimitScope: rateLimiter.scope(),
    proxy: {
      setting: trustProxyDescription(),
      configuredBy: process.env.TRUST_PROXY === undefined ? 'safe-default' : 'environment',
      clientIp: req.ip || 'unknown',
      chain: Array.isArray(req.ips) ? req.ips : [],
      socketIp,
      forwardedFor,
      status: !forwardedSeen ? 'direct' : proxyResolved ? 'resolved' : 'forwarded-header-not-trusted',
      protocol: transport.protocol,
      protocolSource: transport.source,
      expressProtocol: transport.expressProtocol,
      forwardedProto: transport.forwardedProto,
      forwardedHost: transport.forwardedHost,
      requestHost: transport.requestHost,
      publicOrigin: transport.publicOrigin,
      hostTrusted: transport.hostTrusted,
      peerTrusted: transport.peerTrusted,
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
const PATCHABLE_CONTENT_KEYS = new Set([...REQUIRED_KEYS, 'gallery', 'i18n']);
const setContentRevision = (res, revision) => {
  res.setHeader(CONTENT_REVISION_HEADER, String(revision));
  return revision;
};
const saveContentRequest = (req, res, { partial = false } = {}) => {
  /* A public GET may deliberately serve shipped defaults during a restore
     incident. Never let an ordinary Admin save turn that availability fallback
     into the new authoritative database: all writes begin from a strict read
     after this request owns SQLite's immediate writer transaction. */
  const current = strictContentForResponse(res, 'content save');
  if (!current) return;

  let next;
  let requestedSections = store.CONTENT_SECTIONS;
  if (partial) {
    const changes = req.body?.changes;
    if (!isRecord(changes)) return res.status(400).json({ error: 'invalid content patch' });
    const keys = Object.keys(changes);
    const unknown = keys.find((key) => !PATCHABLE_CONTENT_KEYS.has(key));
    if (unknown) return res.status(400).json({ error: `unknown content key: ${unknown}` });
    requestedSections = keys.filter((key) => store.CONTENT_SECTIONS.includes(key));
    next = { ...current, ...changes };
  } else {
    if (!isRecord(req.body)) return res.status(400).json({ error: 'invalid payload' });
    next = { ...req.body };
    for (const k of REQUIRED_KEYS) if (!(k in next)) return res.status(400).json({ error: `missing key: ${k}` });
  }
  /* Never let an older payload without translations wipe the stored ones. */
  if (!next.i18n || typeof next.i18n !== 'object' || Array.isArray(next.i18n)) {
    next.i18n = current.i18n || {};
  }

  /* An older client may omit Gallery, so preserve the authoritative section
     rather than rejecting or accidentally wiping it. */
  if (!Object.hasOwn(next, 'gallery')) {
    next.gallery = Array.isArray(current.gallery) ? current.gallery : DEFAULT_STATE.gallery;
  }

  /* Preserve the new nested collection when a pre-feature Admin client sends
     its complete `collections` bucket. Omitting a field is not a request to
     erase the public sales network; deliberate removal is represented by an
     explicit empty array. */
  if (
    isRecord(next.collections) &&
    !Object.hasOwn(next.collections, 'salesRepresentatives') &&
    Array.isArray(current.collections?.salesRepresentatives)
  ) {
    next.collections = {
      ...next.collections,
      salesRepresentatives: current.collections.salesRepresentatives,
    };
  }

  const { shop: nextShop, ...persistedCandidate } = next;
  if (!store.validContentState(persistedCandidate) || !isRecord(nextShop)) {
    return res.status(400).json({ error: 'invalid content structure' });
  }
  const galleryProblem = galleryItemsProblem(next.gallery);
  if (galleryProblem) {
    return res.status(400).json({ error: 'invalid gallery', problem: galleryProblem });
  }
  for (const [locale, localeData] of Object.entries(next.i18n || {})) {
    const problem = galleryOverridesProblem(localeData?.gallery);
    if (problem) {
      return res.status(400).json({ error: `invalid ${locale} gallery translation`, problem });
    }
    const socialProblem = socialLinkOverridesProblem(localeData?.collections?.socials);
    if (socialProblem) {
      return res.status(400).json({
        error: `invalid ${locale} social link`,
        code: socialProblem.code,
        index: socialProblem.index,
      });
    }
  }
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
      if (bucket === 'brands' && (!String(list[i]?.fa || '').trim() || !String(list[i]?.en || '').trim())) {
        return res.status(400).json({ error: `brands[${i}]: Persian and English names are required` });
      }
    }
  }

  const brandIds = new Set((Array.isArray(next.brands) ? next.brands : []).map((brand) => brand?.id));
  for (const [bucket, products] of [
    ['products', next.products],
    ['shop.products', next.shop?.products],
  ]) {
    if (!Array.isArray(products)) continue;
    for (let index = 0; index < products.length; index += 1) {
      const brand = products[index]?.brand;
      if (brand && !brandIds.has(brand)) {
        return res.status(400).json({ error: `${bucket}[${index}]: unknown brand "${brand}"` });
      }
    }
  }

  if (Array.isArray(next.shop?.products)) {
    const problems = shopProductProblems(next.shop.products);
    if (problems.length) return res.status(400).json({ error: 'invalid shop products', problems });
  }

  /* Social destinations become executable anchor hrefs in three public
     surfaces. CSP does not make javascript: or data: navigation safe, so the
     persistence boundary accepts only absolute HTTP(S) destinations (plus a
     non-rendered incomplete draft while an Admin is typing). */
  if (next.collections?.socials !== undefined) {
    const problem = socialLinksProblem(next.collections.socials);
    if (problem) {
      return res.status(400).json({
        error: 'invalid social links',
        code: problem.code,
        index: problem.index,
      });
    }
  }

  /* Trust seals become executable destinations and expand img-src in the
     document CSP, so this collection gets a stricter boundary than ordinary
     copy. Incomplete rows may be saved only while disabled; published rows
     require a label, an HTTPS verification URL and a safe logo URL. */
  if (next.collections?.trustSeals !== undefined) {
    const trustError = validateTrustSeals(next.collections.trustSeals);
    if (trustError) return res.status(400).json({ error: trustError });
  }

  /* Representatives are public contact records and SVG coordinates. Reject
     malformed or oversized direct-API payloads before they reach SQLite; the
     browser editor is useful feedback, not the persistence security boundary. */
  if (next.collections?.salesRepresentatives !== undefined) {
    const problem = salesRepresentativeProblem(next.collections.salesRepresentatives);
    if (problem) {
      return res.status(400).json({
        error: 'invalid sales representatives',
        code: problem.code,
        index: problem.index,
      });
    }
  }

  /* Product photos have to be renderable under the exact img-src policy this
     payload will publish. Validate before normalization so a malformed or
     untrusted entry cannot be silently discarded while the save appears to
     succeed. Whole-page Admin saves include every product, so only a new or
     edited row is revalidated; untouched legacy rows are preserved verbatim
     and cannot block an unrelated edit. If the effective CSP origin set
     changes, every gallery is related and must be checked again. */
  const trustedImageOrigins = trustSealImageOrigins(next.collections?.trustSeals);
  const currentImageOrigins = trustSealImageOrigins(current.collections?.trustSeals);
  const originPolicyChanged = [...new Set(trustedImageOrigins)].sort().join('\n') !==
    [...new Set(currentImageOrigins)].sort().join('\n');
  const previousBrandsById = new Map(
    (Array.isArray(current.brands) ? current.brands : []).map((brand) => [brand?.id, brand]),
  );
  for (let index = 0; index < next.brands.length; index += 1) {
    const brand = next.brands[index];
    if (
      !originPolicyChanged &&
      !productNeedsImageValidation(brand, previousBrandsById.get(brand?.id))
    ) continue;
    if (!String(brand?.image || '').trim()) {
      return res.status(400).json({
        error: 'invalid brand image',
        code: 'required',
        field: `brands[${index}].image`,
      });
    }
    const problem = productImagesProblem(brand, trustedImageOrigins);
    if (problem) {
      return res.status(400).json({
        error: 'invalid brand image',
        code: problem.code,
        field: `brands[${index}].image`,
        detail: productImagesProblemMessage(problem),
      });
    }
  }
  for (const [bucket, list, previousList, ignore] of [
    ['products', next.products, current.products, []],
    ['shop.products', next.shop?.products, current.shop?.products, ['stock']],
  ]) {
    if (!Array.isArray(list)) continue;
    const previousBySlug = new Map(
      (Array.isArray(previousList) ? previousList : []).map((product) => [product?.slug, product]),
    );
    for (let index = 0; index < list.length; index += 1) {
      const product = list[index];
      if (
        !originPolicyChanged &&
        !productNeedsImageValidation(product, previousBySlug.get(product?.slug), { ignore })
      ) continue;
      const problem = productImagesProblem(product, trustedImageOrigins);
      if (!problem) continue;
      const usesGallery = Array.isArray(product?.images) && product.images.length > 0;
      const imageField = problem.index >= 0
        ? (usesGallery ? `.images[${problem.index}]` : '.image')
        : '';
      return res.status(400).json({
        error: 'invalid product gallery',
        code: problem.code,
        field: `${bucket}[${index}]${imageField}`,
        detail: productImagesProblemMessage(problem),
      });
    }
  }

  /* The revision must come from the exact GET snapshot the editor changed.
     Reading it here would merely compare current state with itself and let a
     stale tab overwrite a newer one. This check runs while BEGIN IMMEDIATE is
     held, so no other worker can commit between comparison and persistence. */
  const revisionHeader = req.get(CONTENT_REVISION_HEADER);
  const expectedRevision = parseContentRevision(revisionHeader);
  const currentRevision = store.getContentMeta(db).revision;
  setContentRevision(res, currentRevision);
  if (revisionHeader === undefined) {
    return res.status(428).json({
      error: 'content revision is required; reload before saving',
      code: 'content-revision-required',
      revision: currentRevision,
    });
  }
  if (expectedRevision === null) {
    return res.status(400).json({
      error: 'invalid content revision',
      code: 'invalid-content-revision',
      revision: currentRevision,
    });
  }
  if (expectedRevision !== currentRevision) {
    return res.status(409).json({
      error: 'content changed in another editor; reload and review the latest version',
      code: 'content-conflict',
      revision: currentRevision,
    });
  }

  let result;
  try {
    result = writeContent(next, current, requestedSections, expectedRevision);
  } catch (error) {
    if (isRichTextValidationError(error)) {
      return res.status(400).json({
        error: error.message,
        code: error.code,
        field: error.field,
        limit: error.limit,
      });
    }
    throw error;
  }
  setContentRevision(res, result.revision);
  res.json({
    ok: true,
    unchanged: !result.changedSections.length && !result.productsChanged && !result.displayChanged,
    revision: result.revision,
  });
};

const contentWriteRoute = (partial) => (req, res, next) => {
  runContentMutation(() => saveContentRequest(req, res, { partial })).catch((error) => {
    /* Handle this only after the transaction rejected, so a future conflict
       raised late in writeContent can never commit earlier partial work. */
    if (error?.code === 'CONTENT_CONFLICT') {
      const revision = setContentRevision(res, store.getContentMeta(db).revision);
      return res.status(409).json({
        error: 'content changed in another editor; reload and review the latest version',
        code: 'content-conflict',
        revision,
      });
    }
    return next(error);
  });
};
const largeAdminJsonBody = express.json({ limit: '8mb' });
app.put('/api/content', requireAuth, largeAdminJsonBody, contentWriteRoute(false));
app.patch('/api/content', requireAuth, largeAdminJsonBody, contentWriteRoute(true));

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
app.get('/api/uploads/unused', requireAuth, (_req, res) => {
  const content = strictContentForResponse(res, 'unused-file preview', 'uploads');
  if (!content) return;
  res.json(listUnusedUploads(UPLOAD_DIR, content));
});

app.delete('/api/uploads/unused', requireAuth, (req, res, next) => {
  if (!Array.isArray(req.body?.urls)) return res.status(400).json({ error: 'urls must be an array' });
  return runContentMutation(() => {
    /* The content tree is read again here rather than trusting the preview. If
       a file became referenced while the confirmation dialog was open, it is
       no longer a candidate and will be reported as skipped. The SQLite writer
       boundary keeps this read and move atomic relative to every worker's save. */
    const content = strictContentForResponse(res, 'unused-file cleanup', 'uploads');
    if (!content) return;
    const result = deleteUnusedUploads(UPLOAD_DIR, content, req.body.urls);
    res.json({ ok: true, ...result });
  }).catch(next);
});

app.post('/api/upload', requireAuth, reserveUploadSlot, upload.single('file'), async (req, res) => {
  if (req.uploadSlot) req.uploadSlot.processing = true;
  const staged = req.file?.path;
  let reply;
  try {
    /* Compute a response without publishing it yet. The one-upload slot must
       remain held until the staged file is gone; otherwise a keep-alive client
       can receive 200 and start its next request before this finally block has
       released capacity. */
    reply = await (async () => {
      if (!req.file || !staged) return { status: 400, body: { error: 'no file' } };
      const ext = path.extname(req.file.originalname).toLowerCase();
      const kind = ALLOWED.image.includes(ext) ? 'image' : ALLOWED.video.includes(ext) ? 'video' : null;
      if (!kind) return { status: 415, body: { error: 'unsupported file type' } };
      if (!contentMatchesExt(await readFilePrefix(staged), ext)) {
        return { status: 415, body: { error: 'file content does not match its extension' } };
      }

      const dir = path.join(UPLOAD_DIR, `${kind}s`);
      await fs.promises.mkdir(dir, { recursive: true });
      const stem = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

      /* Videos never need to enter the JavaScript heap: after the signature
         check, atomically publish the staged file on the same filesystem. */
      if (kind === 'video') {
        const name = `${stem}${ext}`;
        await fs.promises.rename(staged, path.join(dir, name));
        return {
          status: 200,
          body: {
            url: `/uploads/videos/${name}`,
            optimised: false,
            bytes: req.file.size,
            originalBytes: req.file.size,
          },
        };
      }

      /* Sharp reads images directly from the staged path. Its decoded-pixel
         memory remains bounded separately; the original compressed file is not
         duplicated into a 200 MB Node Buffer. */
      const opt = await optimizeImage(staged, ext, req.file.size);
      if (!opt.optimised) {
        const name = `${stem}${ext}`;
        await fs.promises.rename(staged, path.join(dir, name));
        return {
          status: 200,
          body: {
            url: `/uploads/images/${name}`,
            optimised: false,
            bytes: req.file.size,
            originalBytes: req.file.size,
            width: null,
          },
        };
      }

      /* Write the smaller copies FIRST and the master last, then hand back the
         -w<width> name. If any write fails, remove even a partially written path
         and atomically publish the untouched staged original instead. */
      const written = [];
      let name = opt.variants.length ? `${stem}-w${opt.width}.webp` : `${stem}${opt.ext}`;
      try {
        const variantWrites = opt.variants.map((variant) => {
          const file = path.join(dir, `${stem}-${variant.width}.webp`);
          written.push(file);
          return fs.promises.writeFile(file, variant.buffer);
        });
        /* Wait for every parallel variant operation to settle before cleanup;
           Promise.all would reject early while another write could still be
           racing the fallback removal. The master remains last as the public
           completion marker for an optimized family. */
        const settled = await Promise.allSettled(variantWrites);
        const failed = settled.find((result) => result.status === 'rejected');
        if (failed) throw failed.reason;

        const master = path.join(dir, name);
        written.push(master);
        await fs.promises.writeFile(master, opt.buffer);
      } catch {
        await Promise.allSettled(written.map((file) => fs.promises.rm(file, { force: true })));
        name = `${stem}${ext}`;
        await fs.promises.rename(staged, path.join(dir, name));
        return {
          status: 200,
          body: {
            url: `/uploads/images/${name}`,
            optimised: false,
            bytes: req.file.size,
            originalBytes: req.file.size,
            width: null,
          },
        };
      }

      return {
        status: 200,
        body: {
          url: `/uploads/images/${name}`,
          optimised: true,
          bytes: opt.buffer.length,
          originalBytes: opt.originalBytes,
          width: opt.width,
        },
      };
    })();
  } finally {
    if (staged) {
      try { await fs.promises.rm(staged, { force: true }); }
      catch (error) { console.error('[upload] could not remove incoming file:', error.message); }
    }
    req.uploadSlot?.release();

    /* A response is the client's signal that it may begin another sequential
       gallery upload. Send it only after cleanup and release are complete. If
       processing threw, leave reply unset so Express handles that error after
       this finally block has still released all resources. */
    if (reply && !res.headersSent && !res.destroyed) {
      res.status(reply.status).json(reply.body);
    }
  }
});

app.delete('/api/upload', requireAuth, (req, res, next) => {
  const url = String(req.body?.url || '');
  /* This lower-level endpoint remains for existing integrations, but it may no
     longer remove a file used by another product or page. Gallery removal in
     the Admin intentionally removes only the reference; the unused-files
     cleanup is the normal retirement path. */
  if (!parseUploadUrl(url)) return res.status(400).json({ error: 'invalid url' });
  return runContentMutation(() => {
    const content = strictContentForResponse(res, 'guarded upload removal', 'uploads');
    if (!content) return;
    if (isUploadReferenced(url, content)) {
      return res.status(409).json({ error: 'upload is still referenced' });
    }
    const result = quarantineUploadSet(UPLOAD_DIR, url);
    res.json({
      ok: true,
      stuck: result.stuck,
      removed: result.moved,
      quarantined: result.moved,
      bytes: result.bytes,
      batch: result.batch,
      restoreUntil: result.restoreUntil,
      quarantineDays: Math.round(UPLOAD_QUARANTINE_RETENTION_MS / (24 * 60 * 60 * 1000)),
    });
  }).catch(next);
});

/* Defence in depth for anything already on disk (including files uploaded
   before the signature check existed): never let the browser sniff a
   different type than we declare, and forbid scripts outright so an HTML or
   SVG document served from here cannot execute. */
app.use(
  '/uploads',
  express.static(UPLOAD_DIR, {
    maxAge: '30d',
    dotfiles: 'deny',
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; sandbox");
    },
  }),
);

/* ---------------- online shop + customer accounts ---------------- */
const shopRouter = createShopRouter({
  database: db,
  requireAuth,
  rateLimiter,
  contentMutation: runContentMutation,
  assertContentAvailable: () => readContentStrict(),
  trustedImageOrigins: () => trustSealImageOrigins(readContentStrict().collections?.trustSeals),
  selfOrigin: (req) => trustedCsrfOrigins(req, process.env),
});
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
  isSecureRequest: secureRequest,
  /* Use the same deployment trust boundary as callback/SMS URLs; never let a
     client-supplied Host define the CSRF origin in production. */
  selfOrigin: (req) => trustedCsrfOrigins(req, process.env),
});
shopRouter.useCustomer(accountRouter.currentCustomer);
app.use(accountRouter);

/* ---------------- production static site + route-aware SEO ---------------- */
if (fs.existsSync(DIST)) {
  const templatePath = path.join(DIST, 'seo-pages', '_template.html');
  const seoTemplate = fs.existsSync(templatePath)
    ? fs.readFileSync(templatePath, 'utf8')
    : fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  const configuredOrigin = PUBLIC_ORIGIN_URL?.origin || '';
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
    return normalizeOrigin(`${secureRequest(req) ? 'https' : 'http'}://${req.get('host')}`);
  };
  const seoState = async () => {
    try {
      return mergeContentState(DEFAULT_STATE, await readContent());
    } catch {
      return mergeContentState(DEFAULT_STATE, {});
    }
  };

  /* Normalize protocol/host before any public document or asset is served.
     This sits after the API routers, whose own trusted-origin checks remain
     independent, but before robots, sitemap and static files. */
  app.use((req, res, next) => {
    if (!IS_PROD || !canonicalProductionOrigin) return next();
    const incoming = normalizeOrigin(`${secureRequest(req) ? 'https' : 'http'}://${req.get('host')}`);
    if (incoming === canonicalProductionOrigin) return next();
    return res.redirect(301, `${canonicalProductionOrigin}${req.originalUrl}`);
  });

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').setHeader('Cache-Control', 'public, max-age=3600');
    res.send(renderRobots(requestOrigin(req)));
  });
  app.get('/sitemap.xml', async (req, res) => {
    res.type('application/xml').setHeader('Cache-Control', 'no-cache');
    res.send(renderSitemap(await seoState(), requestOrigin(req)));
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

  app.get(/^\/(?!api|uploads).*/, async (req, res) => {
    const origin = requestOrigin(req);
    const queryAt = req.originalUrl.indexOf('?');
    const query = queryAt >= 0 ? req.originalUrl.slice(queryAt) : '';
    const redirect = redirectPath(req.path);
    if (redirect) return res.redirect(301, `${redirect}${query}`);

    const state = await seoState();
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

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[content-api] listening on http://0.0.0.0:${PORT}`);
  console.log(`[content-api] database: ${DB_FILE} (${db.driver})`);
  console.log(`[content-api] admin login default user: "${ADMIN_USER}" (set ADMIN_USER / ADMIN_PASS env to change)`);
});

/* systemd sends SIGTERM on every deployment. Drain callbacks and other active
   requests before closing SQLite; the bounded timeout remains below the
   deployment guide's TimeoutStopSec so systemd does not kill us first. */
const shutdown = createGracefulShutdown({
  server,
  timeoutMs: 90_000,
  closeResources: () => db.close(),
});
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
