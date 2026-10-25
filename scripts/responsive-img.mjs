/* Build the responsive variants of the photos we ship ourselves.
 *
 * The five full-bleed photos are authored at ~1400px because a desktop hero
 * is genuinely that wide, but a phone paints them into a ~390px viewport and
 * still pays for every one of those pixels. This writes a handful of smaller
 * copies next to each original and records the available widths in
 * shared/imgVariants.json, which src/lib/img.js turns into srcset/sizes at
 * render time.
 *
 * This is a build-time script over files that are committed to the repo — it
 * is NOT the admin image-optimisation feature, which was removed on purpose.
 * Nothing here touches uploads, the admin panel or anything a user submits.
 *
 *   node scripts/responsive-img.mjs          regenerate everything
 *
 * Re-run it after adding or replacing a file in public/assets/img or
 * public/assets/products, then commit the new variants.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');

/* Widths worth generating per folder. A width is skipped when it is within
   15% of the original — a 1408 and a 1280 copy of the same photo are the same
   download for no benefit, and every extra candidate is another file the
   browser might pick badly. */
const GROUPS = [
  { dir: 'public/assets/img', widths: [480, 768, 1024, 1280] },
  { dir: 'public/assets/products', widths: [360, 540] },
];

/* Variants are named <base>-<width>.webp, so the originals keep their current
   URLs and nothing that already references them has to change. */
const VARIANT = /-\d+\.webp$/;

const q = { quality: 80, effort: 6 };
const manifest = {};
let written = 0;
let skipped = 0;

for (const { dir, widths } of GROUPS) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) continue;

  for (const file of fs.readdirSync(abs).sort()) {
    if (!file.endsWith('.webp') || VARIANT.test(file)) continue;

    const base = file.slice(0, -'.webp'.length);
    const src = path.join(abs, file);
    const { width: full } = await sharp(src).metadata();
    const url = '/' + path.relative('public', dir).split(path.sep).join('/') + `/${file}`;

    const made = [];
    for (const w of widths) {
      if (w > full * 0.85) continue;
      const out = path.join(abs, `${base}-${w}.webp`);
      const before = fs.existsSync(out) ? fs.statSync(out).size : 0;
      await sharp(src).resize({ width: w }).webp(q).toFile(out);
      const after = fs.statSync(out).size;
      before === after ? skipped++ : written++;
      made.push(w);
      console.log(`  ${base}-${w}.webp  ${(after / 1024).toFixed(1)} KB`);
    }

    /* The original is always the largest candidate, so the manifest carries
       the real intrinsic width too — srcset needs a descriptor for it. */
    manifest[url] = [...made, full];
  }
}

const dest = path.join(ROOT, 'shared/imgVariants.json');
fs.writeFileSync(dest, JSON.stringify(manifest, null, 2) + '\n');
console.log(`\n${written} written, ${skipped} unchanged → shared/imgVariants.json`);
