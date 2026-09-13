/* ==========================================================================
   Responsive sources for product photography.

   The shipped product shots are generated at 360 / 540 / 720 / 1080 px square
   by scripts/to-webp.mjs. A card is ~280 CSS px on a desktop grid and ~590 on
   a phone, so sending one large file to everyone wastes most of its bytes on
   pixels the layout never shows.

   This is deliberately conservative: a srcset is only produced for the four
   known shipped images. Anything the admin uploaded through the panel has no
   generated variants, and guessing at "<name>-540.webp" would point every
   phone at a 404 and leave the card blank. Those images are returned as-is.
   ========================================================================== */

/* Base names that scripts/to-webp.mjs generates square variants for. Keep in
   sync with SQUARE_PRODUCTS in that script. */
const HAS_VARIANTS = new Set(['dezmaye-gold', 'nanmaye', 'shetab', 'xpower']);

export const PRODUCT_WIDTHS = [360, 540, 720, 1080];

/** `/assets/products/shetab.webp` → `shetab`, or null when it is not one of
 *  the shipped square shots. */
function baseName(src) {
  const m = /^\/assets\/products\/([a-z0-9-]+)\.webp$/i.exec(String(src || ''));
  if (!m) return null;
  return HAS_VARIANTS.has(m[1]) ? m[1] : null;
}

/** srcset for a shipped product image, or '' when there are no variants. */
export function productSrcSet(src) {
  const base = baseName(src);
  if (!base) return '';
  return PRODUCT_WIDTHS.map((w) => `/assets/products/${base}-${w}.webp ${w}w`).join(', ');
}

/** Everything an <img> needs, safe to spread. Falls back to a plain src. */
export function productImgProps(src, sizes) {
  const srcSet = productSrcSet(src);
  return srcSet ? { src, srcSet, sizes } : { src };
}
