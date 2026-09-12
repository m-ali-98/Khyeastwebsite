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

console.log(`${pass}/${pass + fail}`);
