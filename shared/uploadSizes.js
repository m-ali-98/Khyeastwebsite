/* The one description of how an optimised upload is named and sized.
 *
 * The server writes the files; the browser has to work out what exists from
 * the URL alone, because content.json stores a single string per image and
 * nothing else travels with it. Both sides therefore derive everything from
 * these constants — if they ever disagreed, the browser would build a srcset
 * pointing at files that are not there, and a 404 inside a srcset is a broken
 * image rather than a fallback. scripts/test/images.mjs asserts they agree.
 */

/* Nothing on the site is painted wider than ~1400 CSS px, so a stored master
   above 1600 is pixels nobody will ever see. */
export const UPLOAD_MAX_WIDTH = 1600;

/* Smaller copies written beside the master, for phones and tablets. */
export const UPLOAD_LADDER = [480, 768, 1024];

/* An optimised upload is named <stem>-w<intrinsic width>.webp. The suffix is
   the contract: it is added only after every file in the set is on disk, so
   its presence means the whole ladder exists. Anything without it — a video,
   an animated GIF, an image sharp could not read, a file uploaded before this
   existed — is served as a plain src, exactly as before. */
export const OPTIMISED_NAME = /-w(\d+)\.webp$/;

/* Which ladder rungs are worth writing for a master of this width. A rung
   within 15% of the master is the same download twice, so it is skipped. */
export function variantWidths(fullWidth) {
  if (!Number.isFinite(fullWidth) || fullWidth <= 0) return [];
  return UPLOAD_LADDER.filter((w) => w <= fullWidth * 0.85);
}

/* The intrinsic width an optimised upload advertises, or null. */
export function widthFromName(url) {
  const m = typeof url === 'string' ? url.match(OPTIMISED_NAME) : null;
  if (!m) return null;
  const w = Number(m[1]);
  return Number.isFinite(w) && w > 0 && w <= 20000 ? w : null;
}
