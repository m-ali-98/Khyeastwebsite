/* ==========================================================================
   Upload optimisation
   --------------------------------------------------------------------------
   An admin uploads whatever came off their phone or camera — commonly a 4 MB
   4000px JPEG — and the site then sends that file, untouched, to every
   visitor. The photos committed to this repo are 16-55 KB on a phone, so one
   careless upload can cost a hundred times the picture it replaces.

   This shrinks an uploaded image once, on the way in: down to at most
   UPLOAD_MAX_WIDTH, re-encoded as WebP, plus the smaller copies that
   src/lib/img.js turns into a srcset.

   Three rules keep it from ever being the thing that breaks an upload:

     1. It never fails the request. Every path that cannot produce a better
        file — sharp missing, an animated GIF, a corrupt or exotic image, an
        encode that came out larger than the original — returns the original
        bytes with `optimised: false`, and the caller stores those instead.
     2. It is pure. It reads and writes no files and knows nothing about
        Express; it takes a Buffer and returns Buffers. That is what makes
        scripts/test/images.mjs able to cover the awkward cases directly.
     3. The name is the contract. The caller may only use the -w<width>.webp
        name after every buffer in the set is safely on disk, so the suffix
        the browser reads can never promise a file that is missing.

   Security note: this runs AFTER the extension allowlist and the magic-byte
   check in server/index.js, never before. Decoding is additionally capped by
   limitInputPixels so a small "decompression bomb" file cannot pin the CPU
   or exhaust memory.
   ========================================================================== */
import { UPLOAD_MAX_WIDTH, variantWidths } from '../shared/uploadSizes.js';

/* ~100 MP. Comfortably above any real camera, far below a crafted bomb. */
const MAX_PIXELS = 100_000_000;

/* Re-encode settings. effort 4 rather than 6: the admin is watching a
   spinner, and the extra second buys about 2%. */
const WEBP = { quality: 82, effort: 4 };

/* sharp is loaded lazily and optionally. It carries a native binary, and a
   cheap shared host may not have it — in that case uploads must keep working
   exactly as they did before, just without the optimisation. */
let sharpPromise;
async function loadSharp() {
  if (!sharpPromise) {
    sharpPromise = import('sharp')
      .then((mod) => mod.default)
      .catch(() => null);
  }
  return sharpPromise;
}

/** True when this module can actually do anything (used by the health route). */
export async function optimiserAvailable() {
  return Boolean(await loadSharp());
}

/* Animated images are left alone: re-encoding one through the still pipeline
   silently throws away every frame but the first, which looks exactly like a
   bug to whoever uploaded it. */
const isAnimated = (meta) => Number(meta?.pages) > 1;

/**
 * @param {Buffer} buf   the uploaded bytes, already validated by the caller
 * @param {string} ext   the (lowercased, dot-prefixed) original extension
 * @returns {Promise<{
 *   optimised: boolean,
 *   buffer: Buffer,          // what to store as the master
 *   ext: string,             // the extension that master must be given
 *   width: number|null,      // intrinsic width of the master, when known
 *   variants: {width:number, buffer:Buffer}[],
 *   reason: string,          // why it was left alone, for the response/log
 *   originalBytes: number,
 * }>}
 */
export async function optimizeImage(buf, ext) {
  const untouched = (reason) => ({
    optimised: false,
    buffer: buf,
    ext,
    width: null,
    variants: [],
    reason,
    originalBytes: buf?.length || 0,
  });

  if (!Buffer.isBuffer(buf) || buf.length === 0) return untouched('empty');

  const sharp = await loadSharp();
  if (!sharp) return untouched('sharp unavailable');

  try {
    const open = () => sharp(buf, { limitInputPixels: MAX_PIXELS, failOn: 'error' });

    const meta = await open().metadata();
    if (!meta?.width || !meta?.height) return untouched('unreadable');
    if (isAnimated(meta)) return untouched('animated');

    /* .rotate() with no argument bakes in the EXIF orientation. Without it a
       portrait phone photo is stored on its side, because sharp strips the
       metadata that was telling the browser to turn it. */
    const width = Math.min(meta.width, UPLOAD_MAX_WIDTH);
    const master = await open()
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp(WEBP)
      .toBuffer();

    /* An already-small, already-efficient file can come out bigger. Storing
       that would make the site slower in the name of making it faster. */
    if (master.length >= buf.length && meta.width <= UPLOAD_MAX_WIDTH) {
      return untouched('already small');
    }

    /* The master may be narrower than requested — a portrait photo rotated
       by EXIF, or an image smaller than the cap. Measure, never assume. */
    const realWidth = (await sharp(master).metadata()).width || width;

    const variants = [];
    for (const w of variantWidths(realWidth)) {
      variants.push({
        width: w,
        buffer: await open().rotate().resize({ width: w, withoutEnlargement: true }).webp(WEBP).toBuffer(),
      });
    }

    return {
      optimised: true,
      buffer: master,
      ext: '.webp',
      width: realWidth,
      variants,
      reason: 'ok',
      originalBytes: buf.length,
    };
  } catch (err) {
    /* Corrupt, truncated, an unsupported colour space, a format this build of
       sharp was compiled without — all of it ends here, and the upload still
       succeeds with the original file. */
    return untouched(`sharp: ${err?.message || 'failed'}`);
  }
}
