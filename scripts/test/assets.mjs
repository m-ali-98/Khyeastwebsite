/* Every asset the site references must exist in the build.

   The uncompressed originals used to sit in public/, so they were copied into
   dist/ on every build and uploaded to the host on every deploy — 5.4 MB that
   no page ever requested. They now live in assets-src/, which is outside the
   build. That is only safe while nothing references them, and a broken image
   is invisible in a unit test, so this check walks every image path in the
   shipped content and the source and asserts the file is really in dist/. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { UPLOAD_LADDER } from '../../shared/uploadSizes.js';
import { createDatabase } from '../../server/sqlite.js';
import { fileURLToPath } from 'node:url';
import { productionTree } from './release-profile.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = path.join(ROOT, 'dist');

let pass = 0;
let fail = 0;
const check = (cond, what, extra = '') => {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.log(`LEAK ${what}${extra ? ` — ${extra}` : ''}`);
  }
};

if (!fs.existsSync(DIST)) {
  console.log('LEAK dist/ missing — run `npm run build` first');
  console.log('0/1');
  process.exit(1);
}

/* Collect every /assets/... reference from the places that can name one. */
const texts = [];
const addFile = (p) => {
  try {
    texts.push(fs.readFileSync(p, 'utf8'));
  } catch {
    /* optional file */
  }
};
addFile(path.join(ROOT, 'shared/contentDefaults.js'));
addFile(path.join(ROOT, 'index.html'));

const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(jsx?|scss|css)$/.test(e.name)) addFile(p);
  }
};
walk(path.join(ROOT, 'src'));

const refs = new Set();
for (const t of texts)
  for (const m of t.matchAll(/\/assets\/[A-Za-z0-9/_.-]+\.(?:webp|png|jpe?g|svg|avif|ico|woff2?)/g))
    refs.add(m[0]);

check(refs.size > 5, 'found asset references to verify', `only ${refs.size}`);

const missing = [...refs].filter((r) => !fs.existsSync(path.join(DIST, r)));
check(missing.length === 0, 'every referenced asset exists in dist', missing.slice(0, 6).join(' '));

/* The originals must stay OUT of the build: that is the whole point of the
   move, and a stray copy would silently restore the 5.4 MB deploy. */
const heavy = [];
const scanDist = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) scanDist(p);
    else if (fs.statSync(p).size > 400 * 1024) heavy.push(`${path.relative(DIST, p)} ${Math.round(fs.statSync(p).size / 1024)}KB`);
  }
};
scanDist(DIST);
/* Only the Inter latin-ext font (85 KB) and hashed JS come close; nothing
   image-shaped should be this large once the originals are excluded. */
const heavyImages = heavy.filter((h) => /\.(png|jpe?g|webp|avif)/.test(h));
check(heavyImages.length === 0, 'no oversized image ships in the build', heavyImages.join(' '));

/* Guard the archive itself: if someone deletes it, the masters are gone and a
   future re-crop would have to be done from the lossy webp. */
const SRC = path.join(ROOT, 'assets-src');
if (!productionTree) check(fs.existsSync(SRC), 'assets-src/ archive of originals still present');
else console.log('  source-only original-image archive check runs before promotion');

/* ---- product photography must stay square --------------------------------
   /products and the product detail page render these in a 1:1 frame. The
   masters are 1408x768, so if a shot is ever regenerated without the square
   crop the packaging silently gets cropped top and bottom again. */
const webpSize = (file) => {
  const d = fs.readFileSync(file);
  if (d.slice(0, 4).toString() !== 'RIFF') return null;
  const fmt = d.slice(12, 16).toString();
  if (fmt === 'VP8X') return [d.readUIntLE(24, 3) + 1, d.readUIntLE(27, 3) + 1];
  if (fmt === 'VP8 ') {
    const i = d.indexOf(Buffer.from([0x9d, 0x01, 0x2a]));
    return [d.readUInt16LE(i + 3) & 0x3fff, d.readUInt16LE(i + 5) & 0x3fff];
  }
  if (fmt === 'VP8L') {
    const b = d.readUInt32LE(21);
    return [(b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1];
  }
  return null;
};

const shotDir = path.join(ROOT, 'public/assets/products');
/* scripts/responsive-img.mjs writes <base>-<width>.webp next to each
   original; those are not separate products. */
const VARIANT = /-\d+\.webp$/;
const shots = fs.readdirSync(shotDir).filter((f) => f.endsWith('.webp') && !VARIANT.test(f));
const notSquare = [];
for (const f of shots) {
  const dim = webpSize(path.join(shotDir, f));
  if (!dim || dim[0] !== dim[1]) notSquare.push(`${f} ${dim ? dim.join('x') : '?'}`);
}
check(shots.length === 4, 'the four product shots are present', shots.join(' '));
check(notSquare.length === 0, 'every product photo is square', notSquare.join(' '));
check(
  /\.product-card__media \{[^}]*aspect-ratio:\s*1\s*\/\s*1/s.test(
    fs.readFileSync(path.join(ROOT, 'src/styles/global.scss'), 'utf8'),
  ),
  'the card media frame is square in CSS',
);


/* ---- responsive image variants ----------------------------------------
   src/lib/img.js builds a srcset straight from shared/imgVariants.json and
   never invents a filename, because a 404 inside a srcset is a broken image
   rather than a fallback. So the manifest has to describe reality: every
   width it lists must exist on disk, and the last entry must be the real
   intrinsic width of the original. */
const variants = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared/imgVariants.json'), 'utf8'));
const missingVariant = [];
const badVariantWidth = [];
for (const [url, widths] of Object.entries(variants)) {
  const file = path.join(ROOT, 'public', url.replace(/^\//, ''));
  if (!fs.existsSync(file)) { missingVariant.push(url); continue; }

  const full = webpSize(file);
  if (full && full[0] !== widths[widths.length - 1]) badVariantWidth.push(`${url} ${full[0]} != ${widths[widths.length - 1]}`);

  const base = file.slice(0, -'.webp'.length);
  for (const w of widths.slice(0, -1)) {
    if (!fs.existsSync(`${base}-${w}.webp`)) missingVariant.push(`${url} @${w}`);
  }
  const sorted = [...widths].sort((a, b) => a - b);
  if (widths.join() !== sorted.join() || new Set(widths).size !== widths.length) {
    badVariantWidth.push(`${url} widths not ascending/unique`);
  }
}
check(Object.keys(variants).length > 0, 'the responsive variant manifest is not empty');
check(missingVariant.length === 0, 'every width in the manifest exists on disk', missingVariant.join(' '));
check(badVariantWidth.length === 0, 'the largest manifest width is the original', badVariantWidth.join(' '));

/* A smaller variant that is not actually smaller is pure waste. */
const notSmaller = [];
for (const [url, widths] of Object.entries(variants)) {
  const file = path.join(ROOT, 'public', url.replace(/^\//, ''));
  const fullBytes = fs.statSync(file).size;
  const base = file.slice(0, -'.webp'.length);
  for (const w of widths.slice(0, -1)) {
    if (fs.statSync(`${base}-${w}.webp`).size >= fullBytes) notSmaller.push(`${url} @${w}`);
  }
}
check(notSmaller.length === 0, 'every variant is smaller than its original', notSmaller.join(' '));

/* ---- optionally validate uploads referenced by a live SQLite store -------
   Builds intentionally never open mutable production data. Operators that want
   a deployment check can opt in explicitly with both paths below; the ordinary
   repository suite remains deterministic and validates immutable defaults. */
const liveDbFile = process.env.KHYEAST_ASSET_DB_FILE
  ? path.resolve(process.env.KHYEAST_ASSET_DB_FILE)
  : '';
const liveUploadRoot = process.env.KHYEAST_ASSET_UPLOAD_DIR
  ? path.resolve(process.env.KHYEAST_ASSET_UPLOAD_DIR)
  : '';
if (liveDbFile && liveUploadRoot) {
  const gone = [];
  try {
    if (!fs.existsSync(liveDbFile)) throw new Error(`database not found: ${liveDbFile}`);
    const liveDatabase = await createDatabase(liveDbFile);
    const blobs = liveDatabase.prepare('SELECT value_json AS value FROM content_sections').all()
      .map((row) => row.value);
    for (const product of liveDatabase.prepare('SELECT image, images FROM products').all()) {
      blobs.push(String(product.image || ''), String(product.images || ''));
    }
    liveDatabase.close();
    const urls = [...new Set(
      blobs.flatMap((raw) => String(raw).match(/\/uploads\/(?:images|videos)\/[\w.-]+/g) || []),
    )];
    for (const url of urls) {
      const file = path.join(liveUploadRoot, url.replace(/^\/uploads\//, ''));
      if (!fs.existsSync(file)) {
        gone.push(url);
        continue;
      }
      const width = Number((url.match(/-w(\d+)\.webp$/) || [])[1]);
      if (!width) continue;
      const stem = file.replace(/-w\d+\.webp$/, '');
      for (const variant of UPLOAD_LADDER.filter((item) => item <= width * 0.85)) {
        if (!fs.existsSync(`${stem}-${variant}.webp`)) gone.push(`${url} @${variant}`);
      }
    }
  } catch (error) {
    gone.push(error.message);
  }
  check(gone.length === 0, 'every live SQLite upload reference exists', gone.join(' '));
} else {
  check(
    !liveDbFile && !liveUploadRoot,
    'live SQLite upload references (explicit check not requested)',
    'set both KHYEAST_ASSET_DB_FILE and KHYEAST_ASSET_UPLOAD_DIR',
  );
}

/* ---- no speculative route cache -----------------------------------------
   Page chunks now start only after an explicit navigation. Browser-native HTTP
   caching remains intact, but the old idle / neighbour / hover prefetch layer
   must not silently warm Products and About from the home page. */
const appSrc = fs.readFileSync(path.join(ROOT, 'src', 'App.jsx'), 'utf8');
check(!fs.existsSync(path.join(ROOT, 'src', 'routes.js')), 'legacy route-prefetch module is removed');
check(
  !/usePrefetchRoutes|prefetch\(location\.pathname|isWarm/.test(appSrc),
  'App has no custom route warming or route-cache checks',
);
check(
  /useLoadingGate\(waiting,\s*\{\s*minVisible:\s*0\s*\}\)/.test(appSrc) &&
    /loaderVisible && <RouteFallback/.test(appSrc) &&
    !/NAVIGATION_BEAT_MS/.test(appSrc),
  'navigation loading is driven by real pending work rather than a forced beat',
);

/* ---- CSP: the inline-script hash must survive a Windows checkout ---------
   The browser hashes the inline boot script as the HTML parser produced it,
   and the parser normalises CRLF to LF. Hashing the raw file bytes therefore
   produces a digest no browser ever computes when index.html has Windows
   line endings, and the script that sets lang/dir/theme before first paint is
   blocked on every single page load. Drive the REAL function from the server
   over both line endings and require the same answer. */
{
  const src = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
  const start = src.indexOf('const scriptHashesFromHtml');
  const end = src.indexOf('/* Computed once at boot', start);
  if (start === -1 || end < start) {
    check(false, 'scriptHashesFromHtml() and scriptHashes() found in server/index.js');
  } else {
    const tmp = path.join(ROOT, '.tmp-csp-check');
    const body = "\n  var a = 1;\n  console.log(a);\n";
    const html = (nl) => `<html><head><script>${body.replace(/\n/g, nl)}</script></head></html>`;

    const hashesFor = (nl) => {
      fs.mkdirSync(tmp, { recursive: true });
      fs.writeFileSync(path.join(tmp, 'index.html'), html(nl));
      const fn = new Function(
        'fs', 'path', 'crypto', 'DIST',
        `${src.slice(start, end)} return scriptHashes();`,
      )(fs, path, crypto, tmp);
      fs.rmSync(tmp, { recursive: true, force: true });
      return fn;
    };

    const lf = hashesFor('\n');
    const crlf = hashesFor('\r\n');
    const expected = `'sha256-${crypto.createHash('sha256').update(body, 'utf8').digest('base64')}'`;

    check(lf === expected, 'CSP hash matches the parsed script text (LF)', `${lf} vs ${expected}`);
    check(crlf === lf, 'CSP hash is identical for a CRLF checkout', `${crlf} vs ${lf}`);
  }
}

console.log(`${pass}/${pass + fail}`);
if (fail) process.exitCode = 1;
