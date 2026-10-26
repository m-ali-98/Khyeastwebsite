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
        encode that came out larger than the original — returns
        `optimised: false`, and the caller stores the untouched source instead.
     2. It never writes or removes files and knows nothing about Express. It
        accepts either a Buffer in unit tests or a staged file path in the
        server, so large compressed uploads do not need a second heap copy.
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
 * @param {Buffer|string} source validated bytes or an absolute staged path
 * @param {string} ext   the (lowercased, dot-prefixed) original extension
 * @param {number} [sourceBytes] size of a path source; ignored for Buffers
 * @returns {Promise<{
 *   optimised: boolean,
 *   buffer: Buffer|null,     // optimized master, or original Buffer in tests
 *   ext: string,             // the extension that master must be given
 *   width: number|null,      // intrinsic width of the master, when known
 *   variants: {width:number, buffer:Buffer}[],
 *   reason: string,          // why it was left alone, for the response/log
 *   originalBytes: number,
 * }>}
 */
export async function optimizeImage(source, ext, sourceBytes = 0) {
  const bufferInput = Buffer.isBuffer(source);
  const pathInput = typeof source === 'string' && source.length > 0;
  const originalBytes = bufferInput ? source.length : Number(sourceBytes) || 0;
  const untouched = (reason) => ({
    optimised: false,
    buffer: bufferInput ? source : null,
    ext,
    width: null,
    variants: [],
    reason,
    originalBytes,
  });

  if ((!bufferInput && !pathInput) || originalBytes <= 0) return untouched('empty');

  const sharp = await loadSharp();
  if (!sharp) return untouched('sharp unavailable');

  try {
    const open = () => sharp(source, { limitInputPixels: MAX_PIXELS, failOn: 'error' });

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
    if (master.length >= originalBytes && meta.width <= UPLOAD_MAX_WIDTH) {
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
      originalBytes,
    };
  } catch (err) {
    /* Corrupt, truncated, an unsupported colour space, a format this build of
       sharp was compiled without — all of it ends here, and the upload still
       succeeds with the original file. */
    return untouched(`sharp: ${err?.message || 'failed'}`);
  }
}
