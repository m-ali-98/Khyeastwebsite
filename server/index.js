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
import { canOptimize, optimizeFile, SOURCE_RE, webpPath } from './imagePipeline.js';
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
const ALLOWED = {
  image: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'],
  video: ['.mp4', '.webm', '.mov', '.m4v'],
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
app.post('/api/auth/login', (req, res) => {
  const { user, pass } = req.body || {};
  if (user !== ADMIN_USER || pass !== ADMIN_PASS) return res.status(401).json({ error: 'invalid credentials' });
  res.json({ token: sign({ user, exp: Date.now() + TOKEN_TTL }) });
});

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ ok: true }));

/* ---------------- admin: content ---------------- */
const REQUIRED_KEYS = ['texts', 'media', 'links', 'collections', 'brands', 'products', 'posts', 'shop'];
app.put('/api/content', requireAuth, (req, res) => {
  const next = req.body;
  if (!next || typeof next !== 'object') return res.status(400).json({ error: 'invalid payload' });
  for (const k of REQUIRED_KEYS) if (!(k in next)) return res.status(400).json({ error: `missing key: ${k}` });
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
/* Every image the admin uploads is optimised automatically: it is converted to
   WebP, given a 768w variant for phones and a blurred placeholder, exactly like
   the build-time assets. The admin does not have to do anything. */
const LQIP_FILE = path.join(DATA_DIR, 'uploads-lqip.json');
const lqipRead = () => {
  try {
    return JSON.parse(fs.readFileSync(LQIP_FILE, 'utf8'));
  } catch {
    return {};
  }
};
const lqipWrite = (map) => {
  try {
    fs.writeFileSync(LQIP_FILE, JSON.stringify(map, null, 2));
  } catch {}
};

app.get('/api/uploads-lqip', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json(lqipRead());
});

app.post('/api/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  const ext = path.extname(req.file.originalname).toLowerCase();
  const kind = ALLOWED.image.includes(ext) ? 'image' : ALLOWED.video.includes(ext) ? 'video' : null;
  if (!kind) return res.status(415).json({ error: 'unsupported file type' });

  const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
  const dir = path.join(UPLOAD_DIR, `${kind}s`);
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, name);
  fs.writeFileSync(abs, req.file.buffer);

  let url = `/uploads/${kind}s/${name}`;

  /* optimise images (never videos); on any failure keep the original file */
  if (kind === 'image' && SOURCE_RE.test(name) && canOptimize()) {
    try {
      const out = await optimizeFile(abs);
      const webpName = path.basename(webpPath(abs));
      const webpUrl = `/uploads/images/${webpName}`;
      if (out.lqip) lqipWrite({ ...lqipRead(), [webpUrl]: { lqip: out.lqip, width: out.width || null } });
      /* the original PNG/JPEG is no longer referenced — drop it */
      if (out.bytesAfter > 0 && fs.existsSync(webpPath(abs)) && webpPath(abs) !== abs) fs.unlinkSync(abs);
      url = webpUrl;
      console.log(
        `[upload] ${name} → ${webpName}  ${(out.bytesBefore / 1024).toFixed(0)} KB → ${(out.bytesAfter / 1024).toFixed(0)} KB`,
      );
    } catch (e) {
      console.warn('[upload] optimisation skipped:', e.message);
    }
  }

  res.json({ url });
});

app.delete('/api/upload', requireAuth, (req, res) => {
  const url = String(req.body?.url || '');
  const m = url.match(/^\/uploads\/(images|videos)\/([\w.-]+)$/);
  if (!m) return res.status(400).json({ error: 'invalid url' });
  const file = path.join(UPLOAD_DIR, m[1], m[2]);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  /* remove the generated companions too */
  const small = file.replace(/\.webp$/i, '-768.webp');
  if (small !== file && fs.existsSync(small)) fs.unlinkSync(small);
  const map = lqipRead();
  if (map[url]) {
    delete map[url];
    lqipWrite(map);
  }
  res.json({ ok: true });
});

app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));

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
