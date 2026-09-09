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

const PORT = process.env.PORT || 8787;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'khyeast-1404';
const SECRET = process.env.ADMIN_SECRET || 'khyeast-content-secret-dev';
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
    return payload;
  } catch {
    return null;
  }
};
const requireAuth = (req, res, next) => {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token || !verify(token)) return res.status(401).json({ error: 'unauthorized' });
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

const app = express();

/* gzip/deflate every text response — the single biggest win on slow links
   (HTML/JS/CSS/JSON shrink ~70%). Images are already compressed, so skipped. */
app.use(
  compression({
    threshold: 512,
    filter: (req, res) => (req.headers['x-no-compression'] ? false : compression.filter(req, res)),
  }),
);

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

app.post('/api/messages', (req, res) => {
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
  res.json({ token: sign({ user, exp: Date.now() + TOKEN_TTL }) });
});

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ ok: true }));

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
const DIST = path.join(__dirname, '..', 'dist');
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
