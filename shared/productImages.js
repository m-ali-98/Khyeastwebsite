/* ==========================================================================
   Product gallery media — one compatibility boundary shared by the CMS,
   SQLite store, cards, SEO and public detail pages.

   `image` remains the primary/legacy field. `images` is an ordered gallery and
   its first item is always mirrored to `image` before persistence. Old rows
   that only have `image` therefore need no destructive migration.
   ========================================================================== */

export const MAX_PRODUCT_IMAGES = 12;
export const MAX_PRODUCT_IMAGE_URL_LENGTH = 2048;

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** Accept same-origin absolute paths and explicit HTTPS image locations.
 * Reject mixed-content HTTP, browser-executable schemes, scheme-relative
 * URLs, credentials, control characters and backslash-confused paths.
 * External-origin authorization is separate because it depends on CSP. */
export function cleanProductImageUrl(value) {
  const input = typeof value === 'string' ? value : '';
  if (CONTROL.test(input)) return '';
  const raw = input.trim();
  if (!raw || raw.length > MAX_PRODUCT_IMAGE_URL_LENGTH || raw.includes('\\')) return '';

  if (/^\/(?!\/)/.test(raw)) return raw;

  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    return raw;
  } catch {
    return '';
  }
}

/** Normalize a configured origin list without ever widening it to HTTP. */
export function normalizeProductImageOrigins(origins = []) {
  const safe = new Set();
  for (const value of Array.isArray(origins) ? origins : []) {
    try {
      const parsed = new URL(String(value));
      /* An allowlist entry is an origin, never a path, query or fragment. */
      if (
        parsed.protocol === 'https:' &&
        !parsed.username &&
        !parsed.password &&
        parsed.origin === parsed.href.replace(/\/$/, '')
      ) safe.add(parsed.origin);
    } catch {
      /* A malformed configured origin grants nothing. */
    }
  }
  return [...safe];
}

/** The rule shared by the Admin UI and server: safe same-origin paths, or an
 * exact HTTPS origin already present in the document's img-src policy. */
export function isAllowedProductImageUrl(value, trustedOrigins = []) {
  const clean = cleanProductImageUrl(value);
  if (!clean) return false;
  if (clean.startsWith('/')) return true;

  try {
    const allowed = new Set(normalizeProductImageOrigins(trustedOrigins));
    return allowed.has(new URL(clean).origin);
  } catch {
    return false;
  }
}

/** Validate raw input before normalization can silently discard a bad entry.
 * A stable problem object lets Admin and HTTP callers give useful feedback
 * without copying the security rule. */
export function productImagesProblem(product, trustedOrigins = []) {
  if (!product || typeof product !== 'object' || Array.isArray(product)) {
    return { code: 'invalid_product', index: -1 };
  }
  if (product.images != null && !Array.isArray(product.images)) {
    return { code: 'invalid_list', index: -1 };
  }

  const hasGallery = Array.isArray(product.images) && product.images.length > 0;
  const gallery = hasGallery ? product.images : [product.image];
  if (gallery.length > MAX_PRODUCT_IMAGES) {
    return { code: 'too_many', index: MAX_PRODUCT_IMAGES };
  }
  /* Media is optional at this shared API boundary for compatibility with old
     and operational records. When a location is supplied, every entry must be
     valid; the Admin editors separately require a photo before publishing. */
  if (!hasGallery && (product.image == null || String(product.image).trim() === '')) return null;

  const seen = new Set();
  for (let index = 0; index < gallery.length; index += 1) {
    const raw = gallery[index];
    const clean = cleanProductImageUrl(raw);
    if (!clean) return { code: 'invalid_url', index, value: raw };
    if (!isAllowedProductImageUrl(clean, trustedOrigins)) {
      return { code: 'untrusted_origin', index, value: clean };
    }
    if (seen.has(clean)) return { code: 'duplicate', index, value: clean };
    seen.add(clean);
  }
  return null;
}

export function productImagesProblemMessage(problem) {
  if (!problem) return '';
  const photo = Number.isInteger(problem.index) && problem.index >= 0 ? `Photo ${problem.index + 1}: ` : '';
  switch (problem.code) {
    case 'required': return 'At least one product photo is required.';
    case 'too_many': return `A product may contain at most ${MAX_PRODUCT_IMAGES} photos.`;
    case 'invalid_list': return 'The product image gallery must be a list.';
    case 'invalid_url': return `${photo}use a safe root-relative path or an HTTPS URL without credentials.`;
    case 'untrusted_origin': return `${photo}the external HTTPS origin is not trusted by the site image policy.`;
    case 'duplicate': return `${photo}the same image is already in this gallery.`;
    default: return 'The product image gallery is invalid.';
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
