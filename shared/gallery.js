export const GALLERY_PAGE_SIZE = 9;
export const MAX_GALLERY_ITEMS = 120;
export const GALLERY_CAPTION_MAX = 140;
export const GALLERY_DESCRIPTION_MAX = 2000;

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IMAGE_EXT_RE = /\.(?:avif|gif|jpe?g|png|webp)$/i;
const VIDEO_EXT_RE = /\.(?:mp4|webm)$/i;
const SAFE_ASSET_PATH_RE = /^\/(?:assets|uploads\/(?:images|videos))\/[A-Za-z0-9][A-Za-z0-9._/-]*$/;

const string = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * Gallery media is intentionally local-only. Besides keeping CSP and the
 * public player aligned, this prevents an administrator typo from turning a
 * saved page into an HTTP mixed-content or untrusted tracking request.
 */
export function cleanGalleryAssetUrl(value, kind = 'image') {
  const raw = string(value);
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '';
  if (/[?#\u0000-\u001f]/.test(raw) || !SAFE_ASSET_PATH_RE.test(raw)) return '';

  const segments = raw.split('/').slice(1);
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return '';

  const isUploadImage = raw.startsWith('/uploads/images/');
  const isUploadVideo = raw.startsWith('/uploads/videos/');
  const isBundledAsset = raw.startsWith('/assets/');
  if (kind === 'video') return isUploadVideo && VIDEO_EXT_RE.test(raw) ? raw : '';
  return (isUploadImage || isBundledAsset) && IMAGE_EXT_RE.test(raw) ? raw : '';
}

export function normalizeGalleryItem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const type = value.type === 'video' ? 'video' : value.type === 'image' ? 'image' : '';
  const id = string(value.id);
  const src = cleanGalleryAssetUrl(value.src, type || 'image');
  if (!ID_RE.test(id) || id.length > 120 || !type || !src) return null;

  return {
    id,
    type,
    src,
    poster: type === 'video' ? cleanGalleryAssetUrl(value.poster, 'image') : '',
    caption: string(value.caption),
    description: string(value.description),
  };
}

export function normalizeGalleryItems(value, fallback = []) {
  const source = Array.isArray(value) ? value : Array.isArray(fallback) ? fallback : [];
  const seen = new Set();
  const items = [];
  for (const row of source) {
    const item = normalizeGalleryItem(row);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
    if (items.length >= MAX_GALLERY_ITEMS) break;
  }
  return items;
}

export function galleryItemsProblem(value) {
  if (!Array.isArray(value)) return 'gallery-not-array';
  if (value.length > MAX_GALLERY_ITEMS) return 'gallery-too-many';

  const ids = new Set();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return 'gallery-item-invalid';
    const id = string(item.id);
    if (!ID_RE.test(id) || id.length > 120) return 'gallery-id-invalid';
    if (ids.has(id)) return 'gallery-id-duplicate';
    ids.add(id);

    if (item.type !== 'image' && item.type !== 'video') return 'gallery-type-invalid';
    if (!cleanGalleryAssetUrl(item.src, item.type)) return 'gallery-src-invalid';
    if (item.type === 'image' && string(item.poster)) return 'gallery-image-poster-invalid';
    if (item.type === 'video' && string(item.poster) && !cleanGalleryAssetUrl(item.poster, 'image')) {
      return 'gallery-poster-invalid';
    }

    const caption = string(item.caption);
    const description = string(item.description);
    if (!caption || caption.length > GALLERY_CAPTION_MAX) return 'gallery-caption-invalid';
    if (description.length > GALLERY_DESCRIPTION_MAX) return 'gallery-description-invalid';
  }
  return '';
}

/** Locale overlays may translate copy only; media structure stays in Persian. */
export function galleryOverridesProblem(value) {
  if (value === undefined) return '';
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'gallery-translation-not-object';
  for (const [id, row] of Object.entries(value)) {
    if (!ID_RE.test(id) || id.length > 120) return 'gallery-translation-id-invalid';
    if (!row || typeof row !== 'object' || Array.isArray(row)) return 'gallery-translation-row-invalid';
    if (Object.hasOwn(row, 'caption') && typeof row.caption !== 'string') return 'gallery-translation-caption-invalid';
    if (Object.hasOwn(row, 'description') && typeof row.description !== 'string') return 'gallery-translation-description-invalid';
    if (string(row.caption).length > GALLERY_CAPTION_MAX) return 'gallery-translation-caption-invalid';
    if (string(row.description).length > GALLERY_DESCRIPTION_MAX) return 'gallery-translation-description-invalid';
  }
  return '';
}

export function stripGalleryMediaOverrides(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [id, row] of Object.entries(value)) {
    if (!ID_RE.test(id) || id.length > 120 || !row || typeof row !== 'object' || Array.isArray(row)) continue;
    const next = {};
    const caption = string(row.caption);
    const description = string(row.description);
    if (caption) next.caption = caption;
    if (description) next.description = description;
    if (Object.keys(next).length) out[id] = next;
  }
  return out;
}
