/* Rebuild the shipped logo from the master.
 *
 * The master (assets-src/brand/logo.png) is 837x800 and 152 KB. The largest
 * place the mark is ever drawn is the boot splash at 72 CSS px, so shipping
 * the master meant downloading ~150 KB — on the critical path, since the
 * splash paints before anything else — to draw a thumbnail. A 256px WebP is
 * ~12 KB and still crisp on a 3x display.
 *
 * Run after replacing the master:  node scripts/logo-webp.mjs
 */
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'assets-src', 'brand', 'logo.png');
const OUT = path.join(ROOT, 'public', 'assets', 'brand', 'logo.webp');
const HEIGHT = 256;

const info = await sharp(SRC).resize({ height: HEIGHT }).webp({ quality: 88, effort: 6 }).toFile(OUT);
const before = (await sharp(SRC).metadata()).size || 0;

console.log(
  `logo.webp  ${info.width}x${info.height}  ${(info.size / 1024).toFixed(1)} KB` +
    (before ? `  (master ${(before / 1024).toFixed(0)} KB)` : ''),
);
