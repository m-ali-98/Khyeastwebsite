/* ==========================================================================
   Product gallery media — one compatibility boundary shared by the CMS,
   SQLite store, cards, SEO and public detail pages.

   `image` remains the primary/legacy field. `images` is an ordered gallery and
   its first item is always mirrored to `image` before persistence. Old rows
   that only have `image` therefore need no destructive migration.
   ========================================================================== */

export const MAX_PRODUCT_IMAGES = 12;
export const MAX_PRODUCT_IMAGE_URL_LENGTH = 2048;

const CONTROL = /[\u0000-\u001f\u007f]/;

/** Accept same-origin absolute paths and explicit HTTP(S) image locations.
 * Reject browser-executable schemes, scheme-relative URLs, credentials,
 * control characters and backslash-confused paths. */
export function cleanProductImageUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw || raw.length > MAX_PRODUCT_IMAGE_URL_LENGTH || CONTROL.test(raw) || raw.includes('\\')) return '';

  if (/^\/(?!\/)/.test(raw)) return raw;

  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    return raw;
  } catch {
    return '';
  }
}

/** Return the canonical ordered, de-duplicated gallery. The legacy image is
 * used only when the new gallery has no valid entry, so `images[0]` remains
 * the unambiguous primary image whenever a gallery exists. */
export function normalizeProductImages(images, legacyImage = '', limit = MAX_PRODUCT_IMAGES) {
  const source = Array.isArray(images) ? images : [];
  const valid = [];
  const seen = new Set();

  for (const candidate of source) {
    const image = cleanProductImageUrl(candidate);
    if (!image || seen.has(image)) continue;
    seen.add(image);
    valid.push(image);
    if (valid.length >= Math.max(1, Number(limit) || MAX_PRODUCT_IMAGES)) break;
  }

  if (!valid.length) {
    const fallback = cleanProductImageUrl(legacyImage);
    if (fallback) valid.push(fallback);
  }

  return valid;
}

/** Read either a modern or legacy product without mutating it. */
export function productImageList(product) {
  if (!product || typeof product !== 'object') return [];
  return normalizeProductImages(product.images, product.image);
}

/** Produce a persistence-ready product while keeping every old consumer of
 * `image` pointed at the gallery's selected primary picture. */
export function syncProductImages(product) {
  if (!product || typeof product !== 'object') return product;
  const images = productImageList(product);
  return {
    ...product,
    image: images[0] || '',
    images,
  };
}
