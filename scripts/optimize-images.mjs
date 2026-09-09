/* ==========================================================================
   Image optimisation for slow connections.
   --------------------------------------------------------------------------
   For every source image in public/assets/{img,products}:
     1. writes a WebP twin next to it            (main payload, ~5-25x smaller)
     2. writes a responsive 768w WebP variant    (phones / narrow screens)
     3. records a ~24px blurred base64 LQIP into src/assets/blurhash.json
        so pages can paint a placeholder instantly instead of empty boxes.

   Requires ImageMagick (`convert`), which is available on most systems.
   Run:  npm run images
   ========================================================================== */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DIRS = ['public/assets/img', 'public/assets/products'];
const OUT_MAP = path.join(ROOT, 'src/assets/blurhash.json');
const SRC_RE = /\.(png|jpe?g)$/i;

const sh = (args) => execFileSync('convert', args, { stdio: ['ignore', 'pipe', 'pipe'] });

const map = {};
let saved = 0;
let count = 0;

for (const dir of DIRS) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) continue;
  for (const name of fs.readdirSync(abs).sort()) {
    if (!SRC_RE.test(name)) continue;
    const src = path.join(abs, name);
    const base = name.replace(SRC_RE, '');
    const webp = path.join(abs, `${base}.webp`);
    const webpSm = path.join(abs, `${base}-768.webp`);

    /* full size + responsive variant */
    sh([src, '-quality', '82', '-define', 'webp:method=6', webp]);
    sh([src, '-resize', '768x>', '-quality', '78', '-define', 'webp:method=6', webpSm]);

    /* tiny blurred placeholder, inlined as a data URI */
    const tmp = path.join(abs, `.${base}.lqip.webp`);
    sh([src, '-resize', '24x24>', '-blur', '0x1', '-quality', '40', tmp]);
    const b64 = fs.readFileSync(tmp).toString('base64');
    fs.unlinkSync(tmp);

    const publicPath = `/${path.relative(path.join(ROOT, 'public'), abs).split(path.sep).join('/')}/${base}.webp`;
    map[publicPath] = `data:image/webp;base64,${b64}`;

    const before = fs.statSync(src).size;
    const after = fs.statSync(webp).size;
    saved += before - after;
    count++;
    console.log(
      `${name.padEnd(24)} ${(before / 1024).toFixed(0).padStart(6)} KB → ${(after / 1024)
        .toFixed(0)
        .padStart(5)} KB  (lqip ${(b64.length / 1024).toFixed(1)} KB)`,
    );
  }
}

fs.mkdirSync(path.dirname(OUT_MAP), { recursive: true });
fs.writeFileSync(OUT_MAP, `${JSON.stringify(map, null, 2)}\n`);
console.log(`\n${count} images · saved ${(saved / 1048576).toFixed(2)} MB · placeholders → ${path.relative(ROOT, OUT_MAP)}`);
