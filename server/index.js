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
import { createShopRouter } from './shop.js';
import * as store from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const CONTENT_FILE = path.join(DATA_DIR, 'content.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json'); // legacy — imported once
const SHOP_FILE = path.join(DATA_DIR, 'shop.json'); // legacy — imported once
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'khyeast.db');

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

const PORT = process.env.PORT || 8787;

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

/** Persist site content: shop → database, everything else → JSON file. */
const writeContent = (next) => {
  const { shop, ...rest } = next;
  if (shop && typeof shop === 'object') {
    if (Array.isArray(shop.products)) store.replaceProducts(db, shop.products);
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
const bearer = (req) => {
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
};
const requireAuth = (req, res, next) => {
  const token = bearer(req);
  const payload = token && verify(token);
  if (!payload) return res.status(401).json({ error: 'unauthorized' });
  req.session = payload;
  next();
};

/* ---------------- uploads ---------------- */
/* SVG is deliberately NOT accepted. An .svg is an XML document that may carry
   <script> and event handlers, and it is served from our own origin — so an
   uploaded SVG becomes stored XSS able to read the admin token out of
   localStorage. Raster formats cannot execute. */
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
const scriptHashes = () => {
  try {
    const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
    const out = [];
    for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
      out.push(`'sha256-${crypto.createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
    }
    return out.join(' ');
  } catch {
    return '';
  }
};

/* Computed once at boot; the built HTML does not change while running. */
const INLINE_SCRIPTS = scriptHashes();

const CSP = [
  "default-src 'self'",
  `script-src 'self' ${INLINE_SCRIPTS}`.trim(),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
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
  if (IS_PROD && (req.secure || req.get('x-forwarded-proto') === 'https')) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

app.use(express.json({ limit: '8mb' }));

/* ---------------- public ---------------- */
app.get('/api/health', (_req, res) => res.json({ ok: true, db: 'sqlite' }));

app.get('/api/content', (_req, res) => {
  try {
    res.json(readContent());
  } catch {
    res.json(DEFAULT_STATE);
  }
});

/* The contact form is public and unauthenticated, so without a limit anyone
   can flood the inbox — burying real enquiries and growing the database
   until the disk fills. Generous enough that a person correcting a typo and
   resubmitting is never blocked. */
const MSG_WINDOW = 10 * 60 * 1000;
const MSG_MAX = 5;
const msgHits = new Map();

setInterval(() => {
  const cut = Date.now() - MSG_WINDOW;
  for (const [ip, times] of msgHits) {
    const keep = times.filter((t) => t > cut);
    if (keep.length) msgHits.set(ip, keep);
    else msgHits.delete(ip);
  }
}, MSG_WINDOW).unref();

app.post('/api/messages', (req, res) => {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const recent = (msgHits.get(ip) || []).filter((t) => now - t < MSG_WINDOW);
  if (recent.length >= MSG_MAX) {
    res.setHeader('Retry-After', Math.ceil(MSG_WINDOW / 1000));
    return res.status(429).json({ error: 'too many messages, please try again later' });
  }
  msgHits.set(ip, [...recent, now]);
  const { name, phone, email, subject, message } = req.body || {};
  if (!name || !phone || !message) return res.status(400).json({ error: 'fields required' });
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
/* Throttle password guessing. Without this the admin password can be brute
   forced at network speed; the panel is protected by a single credential, so
   this is the only thing standing between a guesser and full content control.
   Entries are swept so the map cannot grow without bound. */
const LOGIN_WINDOW = 15 * 60 * 1000;
const LOGIN_MAX = 8;
const loginHits = new Map();

setInterval(() => {
  const cut = Date.now() - LOGIN_WINDOW;
  for (const [ip, times] of loginHits) {
    const keep = times.filter((t) => t > cut);
    if (keep.length) loginHits.set(ip, keep);
    else loginHits.delete(ip);
  }
}, LOGIN_WINDOW).unref();

app.post('/api/auth/login', (req, res) => {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const recent = (loginHits.get(ip) || []).filter((t) => now - t < LOGIN_WINDOW);
  if (recent.length >= LOGIN_MAX) {
    res.setHeader('Retry-After', Math.ceil(LOGIN_WINDOW / 1000));
    return res.status(429).json({ error: 'too many attempts, try again later' });
  }

  const { user, pass } = req.body || {};
  /* Compare in constant time so response latency cannot reveal how much of
     the credential was correct. */
  const eq = (a, b) => {
    const ba = Buffer.from(String(a ?? ''));
    const bb = Buffer.from(String(b ?? ''));
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
  };
  if (!eq(user, ADMIN_USER) || !eq(pass, ADMIN_PASS)) {
    loginHits.set(ip, [...recent, now]);
    return res.status(401).json({ error: 'invalid credentials' });
  }

  loginHits.delete(ip); // successful login clears the counter
  const exp = Date.now() + TOKEN_TTL;
  res.json({ token: sign({ user, exp, sid: sessionStart(exp) }) });
});

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ ok: true }));

/* Ending the session server-side is what actually revokes the token; clearing
   localStorage in the browser only hides it. */
app.post('/api/auth/logout', requireAuth, (req, res) => {
  sessionEnd(req.session.sid);
  res.json({ ok: true });
});

/* Escape hatch for a token believed to be stolen: invalidates every session,
   including the caller's, so the admin can lock everyone out and log back in. */
app.post('/api/auth/logout-all', requireAuth, (_req, res) => {
  sessionEndAll();
  res.json({ ok: true });
});

/* ---------------- admin: content ---------------- */
const REQUIRED_KEYS = ['texts', 'media', 'links', 'collections', 'brands', 'products', 'posts', 'shop'];
app.put('/api/content', requireAuth, (req, res) => {
  const next = req.body;
  if (!next || typeof next !== 'object') return res.status(400).json({ error: 'invalid payload' });
  for (const k of REQUIRED_KEYS) if (!(k in next)) return res.status(400).json({ error: `missing key: ${k}` });
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
app.post('/api/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  const ext = path.extname(req.file.originalname).toLowerCase();
  const kind = ALLOWED.image.includes(ext) ? 'image' : ALLOWED.video.includes(ext) ? 'video' : null;
  if (!kind) return res.status(415).json({ error: 'unsupported file type' });
  if (!contentMatchesExt(req.file.buffer, ext))
    return res.status(415).json({ error: 'file content does not match its extension' });
  const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
  const dir = path.join(UPLOAD_DIR, `${kind}s`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), req.file.buffer);
  res.json({ url: `/uploads/${kind}s/${name}` });
});

app.delete('/api/upload', requireAuth, (req, res) => {
  const url = String(req.body?.url || '');
  const m = url.match(/^\/uploads\/(images|videos)\/([\w.-]+)$/);
  if (!m) return res.status(400).json({ error: 'invalid url' });
  const file = path.join(UPLOAD_DIR, m[1], m[2]);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  res.json({ ok: true });
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

/* ---------------- online shop ---------------- */
app.use(createShopRouter({ database: db, requireAuth }));

/* ---------------- production static site ---------------- */
if (fs.existsSync(DIST)) {
  /* Content-hashed files never change → cache them for a year.
     index.html must always be revalidated so deploys are picked up. */
  app.use(
    express.static(DIST, {
      etag: true,
      setHeaders: (res, filePath) => {
        if (/[.-][0-9a-zA-Z_-]{8,}\.(js|css|woff2?|png|jpe?g|webp|svg|avif)$/.test(filePath))
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        else if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
        else res.setHeader('Cache-Control', 'public, max-age=86400');
      },
    }),
  );
  app.get(/^\/(?!api|uploads).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(DIST, 'index.html'));
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
