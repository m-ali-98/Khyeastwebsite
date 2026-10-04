import VARIANTS from '../../shared/imgVariants.json';
import { variantWidths, widthFromName } from '../../shared/uploadSizes.js';

/* the -w<width> part of an optimised upload's name, without the extension */
const OPTIMISED_NAME_SUFFIX = /-w\d+$/;

/* Responsive variants for the photos that ship with the repo.
 *
 * scripts/responsive-img.mjs writes <name>-<width>.webp next to each original
 * and records the available widths. This turns that manifest into the srcset
 * the browser needs, so a phone downloads the 480px copy of the hero (16 KB)
 * instead of the 1584px one (110 KB).
 *
 * Every image URL on the site is editable from the admin panel, so a src can
 * also be an upload under /uploads, an absolute URL, or something typed by
 * hand. Anything not in the manifest falls through untouched — no variant is
 * ever invented, because a 404 inside a srcset is a broken image, not a
 * fallback. */

/* Typical layout widths, so each call site declares the slot it paints into
   rather than repeating a media-query string. */
export const SIZES = {
  /* hero, parallax banner, page hero — edge to edge */
  full: '100vw',
  /* the story / intro split sections: one column on a phone, half the
     container (max 1200px) from the tablet breakpoint up */
  half: '(max-width: 900px) 100vw, 600px',
  /* the small floating inset on those same sections */
  inset: '(max-width: 900px) 45vw, 280px',
  /* a product, post or brand card in the grid */
  card: '(max-width: 640px) 90vw, (max-width: 1100px) 45vw, 340px',
  /* the large product / post detail photo */
  detail: '(max-width: 900px) 100vw, 560px',
};

/* An image optimised on upload advertises its intrinsic width in its own
   filename (…-w1600.webp), and the server only publishes that name once every
   smaller copy is on disk. So the widths can be derived from the URL with no
   manifest and no extra request — and an upload that was left alone (a video
   poster, an animated GIF, a file from before this existed) simply has no
   suffix and gets a plain src. */
function uploadWidths(src) {
  const full = widthFromName(src);
  if (!full) return null;
  return [...variantWidths(full), full];
}

/* Spread onto an <img>: imgProps(src, SIZES.full) -> { src, srcSet, sizes }.
   Returns just { src } when there is nothing to offer. */
export function imgProps(src, sizes = SIZES.full) {
  const widths = typeof src === 'string' ? VARIANTS[src] || uploadWidths(src) : null;
  if (!widths || widths.length < 2) return { src };

  /* Repo photos are <stem>.webp with variants at <stem>-480.webp; uploads are
     <stem>-w1600.webp with variants at <stem>-480.webp. Same stem either way,
     once the advertised width is stripped off. */
  const base = src.slice(0, -'.webp'.length).replace(OPTIMISED_NAME_SUFFIX, '');
  const largest = widths[widths.length - 1];
  const srcSet = widths
    .map((w) => `${w === largest ? src : `${base}-${w}.webp`} ${w}w`)
    .join(', ');

  return { src, srcSet, sizes };
}
