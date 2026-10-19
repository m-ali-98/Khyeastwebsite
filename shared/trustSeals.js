/* ==========================================================================
   Footer trust seals — one validation boundary shared by admin, server and UI.

   Providers such as eNamad supply two different URLs: a verification link and
   a remotely hosted logo. Only explicit HTTPS destinations are accepted. Logo
   files uploaded through the CMS may also use a same-origin absolute path.
   ========================================================================== */

export const MAX_TRUST_SEALS = 4;

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IMAGE_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/;
const CONTROL_OR_SPACE = /[\u0000-\u0020\u007f]/;
const cleanUrlText = (value) => String(value || '').trim().replace(/&amp;/gi, '&');

export function safeHttpsUrl(value) {
  const raw = cleanUrlText(value);
  if (!raw || CONTROL_OR_SPACE.test(raw)) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    return url.href;
  } catch {
    return '';
  }
}

export function safeTrustImageUrl(value) {
  const raw = cleanUrlText(value);
  if (/^\/(?!\/)/.test(raw) && !CONTROL_OR_SPACE.test(raw) && !raw.includes('\\')) return raw;
  return safeHttpsUrl(raw);
}

/** Return an empty string when valid, otherwise a stable machine-readable reason. */
export function validateTrustSeals(value) {
  if (!Array.isArray(value)) return 'trustSeals must be an array';
  if (value.length > MAX_TRUST_SEALS) return `trustSeals may contain at most ${MAX_TRUST_SEALS} items`;

  const seen = new Set();
  const seenImageIds = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const seal = value[index];
    if (!seal || typeof seal !== 'object' || Array.isArray(seal)) return `trustSeals[${index}] must be an object`;

    const id = String(seal.id || '').trim();
    if (!ID_RE.test(id) || id.length > 120) return `trustSeals[${index}] has an invalid id`;
    if (seen.has(id)) return `trustSeals[${index}] has a duplicate id`;
    seen.add(id);

    if (typeof seal.active !== 'boolean') return `trustSeals[${index}].active must be boolean`;
    const label = String(seal.label || '').trim();
    const href = cleanUrlText(seal.href);
    const image = cleanUrlText(seal.image);
    const imageId = String(seal.imageId || '').trim();
    if (label.length > 160) return `trustSeals[${index}].label is too long`;
    if (imageId && !IMAGE_ID_RE.test(imageId)) return `trustSeals[${index}].imageId is invalid`;
    if (imageId && seenImageIds.has(imageId)) return `trustSeals[${index}].imageId is duplicate`;
    if (imageId) seenImageIds.add(imageId);
    if (href && !safeHttpsUrl(href)) return `trustSeals[${index}].href must be HTTPS`;
    if (image && !safeTrustImageUrl(image)) return `trustSeals[${index}].image is invalid`;
    if (seal.active && (!label || !href || !image)) return `trustSeals[${index}] is active but incomplete`;
  }
  return '';
}

/** Defensive public rendering: malformed or incomplete rows simply stay hidden. */
export function activeTrustSeals(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const seenImageIds = new Set();
  const output = [];
  for (const raw of value.slice(0, MAX_TRUST_SEALS)) {
    if (!raw || typeof raw !== 'object' || raw.active !== true) continue;
    const id = String(raw.id || '').trim();
    const label = String(raw.label || '').trim().slice(0, 160);
    const href = safeHttpsUrl(raw.href);
    const image = safeTrustImageUrl(raw.image);
    const imageIdRaw = String(raw.imageId || '').trim();
    const imageId = IMAGE_ID_RE.test(imageIdRaw) && !seenImageIds.has(imageIdRaw) ? imageIdRaw : '';
    if (!ID_RE.test(id) || seen.has(id) || !label || !href || !image) continue;
    seen.add(id);
    if (imageId) seenImageIds.add(imageId);
    output.push({ id, label, href, image, imageId, active: true });
  }
  return output;
}

/** Image origins are added to the document CSP only after admin validation. */
export function trustSealImageOrigins(value) {
  const origins = new Set();
  /* Only seals that can actually render expand img-src. A disabled draft must
     not loosen the public policy merely because it contains an external URL. */
  for (const seal of activeTrustSeals(value)) {
    if (!seal.image.startsWith('https://')) continue;
    try {
      origins.add(new URL(seal.image).origin);
    } catch {
      /* activeTrustSeals already parsed it; this is a final fail-closed guard. */
    }
  }
  return [...origins];
}

export default {
  MAX_TRUST_SEALS,
  safeHttpsUrl,
  safeTrustImageUrl,
  validateTrustSeals,
  activeTrustSeals,
  trustSealImageOrigins,
};
