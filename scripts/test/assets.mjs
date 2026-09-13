/* Every asset the site references must exist in the build.

   The uncompressed originals used to sit in public/, so they were copied into
   dist/ on every build and uploaded to the host on every deploy — 5.4 MB that
   no page ever requested. They now live in assets-src/, which is outside the
   build. That is only safe while nothing references them, and a broken image
   is invisible in a unit test, so this check walks every image path in the
   shipped content and the source and asserts the file is really in dist/. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  process.exit(0);
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
addFile(path.join(ROOT, 'server/data/content.json'));
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
check(fs.existsSync(SRC), 'assets-src/ archive of originals still present');

/* ---- product photography must stay square with a complete variant set ----
   /products and the product detail page render these in a 1:1 frame with
   `object-fit: contain`, so a non-square file would letterbox. Every width
   named in src/lib/productImage.js must exist on disk: that module builds the
   srcset by string concatenation, so a missing file is a 404 and a blank card
   on exactly the viewport that picks it. */
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

const imgSrc = fs.readFileSync(path.join(ROOT, 'src/lib/productImage.js'), 'utf8');
const bases = [...imgSrc.matchAll(/'([a-z0-9-]+)'/g)]
  .map((m) => m[1])
  .filter((n) => fs.existsSync(path.join(ROOT, 'public/assets/products', `${n}.webp`)));
const widths = (imgSrc.match(/PRODUCT_WIDTHS = \[([^\]]+)\]/) || [, ''])[1]
  .split(',')
  .map((x) => Number(x.trim()))
  .filter(Boolean);

check(bases.length === 4, 'all four product shots are known to the srcset helper', bases.join(' '));
check(widths.length >= 3, 'PRODUCT_WIDTHS is populated', widths.join(' '));

const notSquare = [];
const missingVariant = [];
for (const base of bases) {
  for (const w of [null, ...widths]) {
    const rel = `public/assets/products/${base}${w ? `-${w}` : ''}.webp`;
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
      missingVariant.push(`${base}-${w}`);
      continue;
    }
    const dim = webpSize(abs);
    if (!dim || dim[0] !== dim[1]) notSquare.push(`${rel} ${dim ? dim.join('x') : '?'}`);
    else if (w && dim[0] !== w) notSquare.push(`${rel} is ${dim[0]}px, expected ${w}`);
  }
}
check(missingVariant.length === 0, 'every declared srcset width exists on disk', missingVariant.join(' '));
check(notSquare.length === 0, 'every product image is square at its declared width', notSquare.slice(0, 4).join(' '));

/* The card must reserve the square box, and must not invent variants for
   admin-uploaded images (that would 404 and blank the card). */
const cardsSrc = fs.readFileSync(path.join(ROOT, 'src/components/cards.jsx'), 'utf8');
const scssSrc = fs.readFileSync(path.join(ROOT, 'src/styles/global.scss'), 'utf8');
check(/width=\{720\}/.test(cardsSrc) && /height=\{720\}/.test(cardsSrc), 'product card reserves the image box');
check(/productImgProps\(product\.image/.test(cardsSrc), 'product card uses the responsive helper');
check(
  /\.product-card__media \{[^}]*aspect-ratio:\s*1\s*\/\s*1/s.test(scssSrc),
  'the card media frame is square in CSS',
);

/* ---- speculative prefetch must respect the locale ----------------------
   React Router strips the /en and /ar prefix with `basename`, so
   location.pathname is plain "/" in all three languages. The neighbour table
   therefore cannot tell them apart on its own, and prefetch() used to warm
   the shop chunks for English and Arabic visitors — routes that are never
   mounted outside Persian. The shopOn flag is what prevents that, so assert
   both that it is still threaded through and that it actually filters. */
const routesSrc = fs.readFileSync(path.join(ROOT, 'src/routes.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'src/App.jsx'), 'utf8');

check(
  /export function prefetch\(pathname, shopOn/.test(routesSrc),
  'prefetch() still takes the shop/locale flag',
);
check(
  /if \(!shopOn && key\.startsWith\('\/shop'\)\) return;/.test(routesSrc),
  'prefetch() filters shop chunks when the shop is off',
);
check(
  /prefetch\(location\.pathname, shopEnabled\)/.test(appSrc),
  'App passes shopEnabled into prefetch',
);
check(
  /const \{ locale, shopEnabled \} = useLocale\(\)/.test(appSrc),
  'shopEnabled is actually in scope where prefetch is called',
);

/* Behavioural check on the REAL prefetch(), not a copy of it: re-implementing
   the filter here would pass even if src/routes.js were reverted. The module
   imports React, so it cannot simply be imported in Node — instead slice the
   pure parts out of the source and evaluate them with the dynamic imports
   stubbed, recording which chunks would be requested. */
const slice = (name) => {
  const i = routesSrc.indexOf(`const ${name}`);
  const j = routesSrc.indexOf('\n};', i);
  return routesSrc.slice(i, j + 3);
};
const prefetchSrc = routesSrc.slice(
  routesSrc.indexOf('export function prefetch'),
  routesSrc.indexOf('const onIdle'),
);
const keysForSrc = routesSrc.slice(
  routesSrc.indexOf('function keysFor'),
  routesSrc.indexOf('/** Prefetch the neighbours'),
);

const harness = `
  ${slice('LOADERS').replace(/\(\) => import\([^)]*\)/g, '() => {}')}
  ${slice('NEIGHBOURS')}
  const isSaving = () => false;
  const warmed = [];
  const warm = (k) => warmed.push(k);
  ${keysForSrc}
  ${prefetchSrc.replace('export function', 'function')}
  return (path, shopOn) => { warmed.length = 0; prefetch(path, shopOn); return warmed.slice(); };
`;
// eslint-disable-next-line no-new-func
const runPrefetch = new Function(harness)();

const faWarm = runPrefetch('/', true);
const enWarm = runPrefetch('/', false);
check(faWarm.includes('/shop'), 'Persian home still warms the shop chunk', faWarm.join(' '));
check(
  !enWarm.some((k) => k.startsWith('/shop')),
  'English/Arabic home warms no shop chunk',
  enWarm.join(' '),
);
check(
  enWarm.includes('/products') && enWarm.includes('/about'),
  'non-shop neighbours are still warmed for every locale',
  enWarm.join(' '),
);
check(
  !runPrefetch('/products', false).some((k) => k.startsWith('/shop')),
  'the products page also skips the shop chunk outside Persian',
);

console.log(`${pass}/${pass + fail}`);
