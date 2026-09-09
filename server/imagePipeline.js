/* ==========================================================================
   Shared image optimisation pipeline.
   --------------------------------------------------------------------------
   Used by BOTH:
     • scripts/optimize-images.mjs  → build-time pass over public/assets
     • server/index.js  /api/upload → runtime pass over admin uploads

   For a source image it produces:
     name.webp        full size, WebP          (the file the site actually uses)
     name-768.webp    768px-wide variant       (phones / narrow screens)
     LQIP             ~24px blurred data URI   (instant placeholder)

   Backend: ImageMagick (`convert` / `magick`). If neither binary exists the
   pipeline degrades gracefully — the original file is kept and used as-is, so
   uploads never fail just because the host has no ImageMagick.
   ========================================================================== */
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const pexec = promisify(execFile);

export const SOURCE_RE = /\.(png|jpe?g)$/i;

/* ---------------------------------------------------------- binary lookup */
let BIN = null; // null = not probed yet, false = unavailable
export function imagickBin() {
  if (BIN !== null) return BIN;
  for (const candidate of ['convert', 'magick']) {
    try {
      execFileSync(candidate, ['-version'], { stdio: 'ignore' });
      BIN = candidate;
      return BIN;
    } catch {}
  }
  BIN = false;
  return BIN;
}

export const canOptimize = () => imagickBin() !== false;

/* ------------------------------------------------------------- primitives */
const run = async (args) => {
  const bin = imagickBin();
  if (!bin) throw new Error('imagemagick not available');
  await pexec(bin, args, { timeout: 60_000, maxBuffer: 1024 * 1024 });
};

/** Pixel width of an image, or null when it cannot be read. */
export async function imageWidth(file) {
  try {
    const bin = imagickBin();
    if (!bin) return null;
    const probe = bin === 'magick' ? ['identify', '-format', '%w', file] : ['-format', '%w', file];
    const { stdout } = await pexec(bin === 'magick' ? 'magick' : 'identify', probe, { timeout: 20_000 });
    const n = parseInt(String(stdout).trim(), 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** name.jpg → name.webp (leaves .webp/.svg/.gif untouched) */
export const webpPath = (file) => file.replace(SOURCE_RE, '.webp');
/** name.webp → name-768.webp */
export const smallPath = (file) => file.replace(/\.webp$/i, '-768.webp');

/**
 * Optimise one image file on disk.
 * @returns {Promise<{webp:string, small:string|null, lqip:string|null, bytesBefore:number, bytesAfter:number}>}
 */
export async function optimizeFile(src, { quality = 82, smallQuality = 78, smallWidth = 768, lqip = true } = {}) {
  const bytesBefore = fs.statSync(src).size;
  const isSource = SOURCE_RE.test(src);
  const webp = isSource ? webpPath(src) : src;

  if (isSource) await run([src, '-quality', String(quality), '-define', 'webp:method=6', webp]);

  const small = smallPath(webp);
  await run([
    webp,
    '-resize',
    `${smallWidth}x>`,
    '-quality',
    String(smallQuality),
    '-define',
    'webp:method=6',
    small,
  ]);

  let blur = null;
  if (lqip) {
    const tmp = path.join(path.dirname(src), `.${path.basename(src)}.lqip.webp`);
    try {
      await run([src, '-resize', '24x24>', '-blur', '0x1', '-quality', '40', tmp]);
      blur = `data:image/webp;base64,${fs.readFileSync(tmp).toString('base64')}`;
    } catch {
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
  }

  return {
    webp,
    small: fs.existsSync(small) ? small : null,
    lqip: blur,
    width: await imageWidth(webp),
    bytesBefore,
    bytesAfter: fs.existsSync(webp) ? fs.statSync(webp).size : bytesBefore,
  };
}

/* ------------------------------------------------- LQIP manifest handling */
/**
 * Merge entries into a JSON map of { "/public/path.webp": "data:image/webp;base64,…" }.
 * Written atomically so a crash cannot leave a half-file behind.
 */
export function writeManifest(file, entries) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let current = {};
  try {
    current = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  const next = { ...current, ...entries };
  const sorted = Object.fromEntries(Object.keys(next).sort().map((k) => [k, next[k]]));
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(sorted, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return sorted;
}

export function readManifest(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}
