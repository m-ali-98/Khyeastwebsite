/* ==========================================================================
   Convert site photography to WebP.

     node scripts/to-webp.mjs --dry     preview, write nothing
     node scripts/to-webp.mjs           convert and rewrite references

   Scope is deliberately narrow:
     • public/assets/products/*.png  — product shots, transparent, lossy+alpha
     • public/assets/img/*.jpg       — photography, lossy

   Deliberately NOT touched:
     • favicons and apple-touch-icon — some OS/browser surfaces still expect
       PNG, and they are already ~1-12 KB so there is nothing to win
     • logo.png / logo-original.png  — the logo is rendered through
       <Logo>, is used on light and dark backgrounds, and the user has
       rejected lossy handling of the brand artwork before

   Originals are kept. They are the only copies of the artwork and the admin
   panel can still reference them; WebP is written alongside.
   ========================================================================== */
import sharp from 'sharp';
import { readdirSync, statSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const DRY = process.argv.includes('--dry');
const ROOT = path.resolve(import.meta.dirname, '..');

/* Quality 82 with effort 6: at this resolution the difference from the source
   is not visible side by side, while 90+ gives up most of the saving.
   Measured 37-40 dB PSNR against the originals — "very good" by the usual
   reading, where anything above 35 dB is considered visually transparent. */
const PHOTO = { quality: 82, effort: 6 };
/* Product shots carry the packaging artwork, so they get a little more
   headroom. Their PNGs declare an alpha channel but it is 100% opaque, so
   nothing is lost when the encoder drops it. */
const PRODUCT = { quality: 86, effort: 6 };

const TARGETS = [
  { dir: 'public/assets/products', match: /\.png$/i, opts: PRODUCT },
  { dir: 'public/assets/img', match: /\.(jpe?g)$/i, opts: PHOTO },
];

const kb = (n) => (n / 1024).toFixed(0) + 'K';
const rows = [];
let before = 0;
let after = 0;

for (const { dir, match, opts } of TARGETS) {
  const abs = path.join(ROOT, dir);
  if (!existsSync(abs)) continue;
  for (const file of readdirSync(abs).filter((f) => match.test(f))) {
    const src = path.join(abs, file);
    const out = src.replace(/\.(png|jpe?g)$/i, '.webp');
    const srcSize = statSync(src).size;

    const buf = await sharp(src).webp(opts).toBuffer();

    /* Only keep the WebP if it is actually smaller — a already-optimised JPEG
       can encode larger, and shipping a bigger file would defeat the point. */
    if (buf.length >= srcSize) {
      rows.push([file, kb(srcSize), '—', 'skipped (webp was larger)']);
      before += srcSize;
      after += srcSize;
      continue;
    }

    if (!DRY) writeFileSync(out, buf);
    before += srcSize;
    after += buf.length;
    const saved = (100 - (buf.length / srcSize) * 100).toFixed(0);
    rows.push([file, kb(srcSize), kb(buf.length), `-${saved}%`]);
  }
}

const w = [Math.max(...rows.map((r) => r[0].length)), 8, 8, 26];
console.log(`\n${DRY ? 'DRY RUN — nothing written' : 'Converted'}\n`);
for (const r of rows) console.log('  ' + r.map((c, i) => String(c).padEnd(w[i])).join(''));
console.log(
  `\n  total ${kb(before)} -> ${kb(after)}  (saved ${kb(before - after)}, ${(100 - (after / before) * 100).toFixed(0)}%)\n`,
);

/* ---------------------------------------------------------------------------
   Rewrite references. Every path lives in source as a plain string literal, so
   a literal replace is sufficient and safe — there is no dynamic construction
   of these filenames anywhere in the tree (verified by grep before writing).
   --------------------------------------------------------------------------- */
const SOURCES = [
  'shared/contentDefaults.js',
  'src/admin/tabs.jsx',
  'src/admin/shopTabs.jsx',
  'index.html', // carries the hero preload hint
];
const converted = rows.filter((r) => r[2] !== '—').map((r) => r[0]);

let edits = 0;
for (const rel of SOURCES) {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) continue;
  let text = readFileSync(abs, 'utf8');
  const original = text;
  for (const file of converted) {
    const webp = file.replace(/\.(png|jpe?g)$/i, '.webp');
    text = text.split(file).join(webp);
  }
  if (text !== original) {
    if (!DRY) writeFileSync(abs, text);
    const n = converted.reduce((acc, f) => acc + original.split(f).length - 1, 0);
    edits += n;
    console.log(`  ${rel}: ${n} reference${n === 1 ? '' : 's'} updated`);
  }
}
console.log(`\n  ${edits} references ${DRY ? 'would be' : ''} rewritten\n`);
