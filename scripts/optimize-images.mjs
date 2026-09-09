/* ==========================================================================
   Build-time image optimisation for public/assets.
   --------------------------------------------------------------------------
   Runs automatically before `npm run build` and `npm run dev` (see the
   "prebuild" / "predev" scripts in package.json), so nobody has to remember it.

   • converts every PNG/JPEG under public/assets to WebP + a 768w variant
   • records blurred placeholders (LQIP) into src/assets/blurhash.json
   • skips files whose optimised output is already newer than the source, so
     repeated runs cost close to nothing
   • if ImageMagick is missing it prints a notice and exits 0 — the build still
     succeeds, images are simply served in their original format

   Manual run:  npm run images        (add --force to rebuild everything)
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canOptimize, optimizeFile, SOURCE_RE, webpPath, writeManifest, readManifest } from '../server/imagePipeline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'public/assets');
const MANIFEST = path.join(ROOT, 'src/assets/blurhash.json');
const FORCE = process.argv.includes('--force');

if (!canOptimize()) {
  console.log('[images] ImageMagick not found — skipping optimisation (originals will be served).');
  if (!fs.existsSync(MANIFEST)) writeManifest(MANIFEST, {});
  process.exit(0);
}

/** every png/jpg under public/assets, recursively */
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SOURCE_RE.test(entry.name)) out.push(full);
  }
  return out;
}

const publicUrl = (abs) => `/${path.relative(path.join(ROOT, 'public'), abs).split(path.sep).join('/')}`;

const existing = readManifest(MANIFEST);
const entries = {};
let processed = 0;
let skipped = 0;
let saved = 0;

for (const src of walk(ASSETS).sort()) {
  const out = webpPath(src);
  const url = publicUrl(out);

  /* up to date? (output newer than source and we already know its placeholder) */
  const fresh =
    !FORCE &&
    fs.existsSync(out) &&
    fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs &&
    existing[url] &&
    typeof existing[url] === 'object' &&
    existing[url].width;
  if (fresh) {
    skipped++;
    continue;
  }

  const r = await optimizeFile(src);
  if (r.lqip) entries[url] = { lqip: r.lqip, width: r.width || null };
  saved += r.bytesBefore - r.bytesAfter;
  processed++;
  console.log(
    `  ${path.basename(src).padEnd(26)} ${(r.bytesBefore / 1024).toFixed(0).padStart(6)} KB → ${(r.bytesAfter / 1024)
      .toFixed(0)
      .padStart(5)} KB`,
  );
}

if (processed) writeManifest(MANIFEST, entries);
else if (!fs.existsSync(MANIFEST)) writeManifest(MANIFEST, {});

console.log(
  `[images] ${processed} optimised, ${skipped} already up to date` +
    (saved > 0 ? ` · saved ${(saved / 1048576).toFixed(2)} MB` : ''),
);
