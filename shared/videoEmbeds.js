/* Safe rich-text video embeds.
 *
 * Persisted iframes are limited to three reviewed providers. We accept their
 * ordinary share/watch URLs but always serialize a provider-specific player
 * URL, so arbitrary iframe hosts, ports, paths and query parameters never
 * cross the HTML/CSP boundary.
 */

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const APARAT_ID = /^[A-Za-z0-9_-]{3,128}$/;
const VIMEO_ID = /^\d{5,20}$/;
const VIMEO_HASH = /^[A-Za-z0-9_-]{5,64}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

const PROVIDER_HOSTS = new Map([
  ['youtube.com', 'youtube'],
  ['www.youtube.com', 'youtube'],
  ['m.youtube.com', 'youtube'],
  ['youtube-nocookie.com', 'youtube'],
  ['www.youtube-nocookie.com', 'youtube'],
  ['youtu.be', 'youtube'],
  ['aparat.com', 'aparat'],
  ['www.aparat.com', 'aparat'],
  ['vimeo.com', 'vimeo'],
  ['www.vimeo.com', 'vimeo'],
  ['m.vimeo.com', 'vimeo'],
  ['player.vimeo.com', 'vimeo'],
]);

/* Keep this list in lockstep with the canonical origins returned below. CSP
 * consumes the same constants, while transport tests pin the exact scope. */
export const VIDEO_EMBED_FRAME_SOURCES = Object.freeze([
  'https://www.youtube-nocookie.com',
  'https://www.aparat.com',
  'https://player.vimeo.com',
]);

const BARE_PROVIDER_HOST = /^(?:www\.)?(?:m\.)?(?:youtube\.com|youtube-nocookie\.com|youtu\.be|aparat\.com|vimeo\.com|player\.vimeo\.com)(?::\d+)?(?:[/?#]|$)/i;

function parseProviderUrl(raw) {
  const value = String(raw ?? '').trim();
  if (!value || value.length > 2048 || CONTROL.test(value) || value.includes('\\') || value.startsWith('//')) return null;

  let absolute = value;
  if (!/^[a-z][a-z\d+.-]*:/i.test(absolute)) {
    if (!BARE_PROVIDER_HOST.test(absolute)) return null;
    absolute = `https://${absolute}`;
  }

  try {
    const url = new URL(absolute);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const provider = PROVIDER_HOSTS.get(url.hostname.toLowerCase());
    return provider ? { url, provider } : null;
  } catch {
    return null;
  }
}

/** The provider name is useful to distinguish a malformed share URL from an
 * existing direct video URL. It never authorizes a frame by itself. */
export function getVideoEmbedProvider(raw) {
  return parseProviderUrl(raw)?.provider || '';
}

function secureHttpsUrl(url) {
  return url.protocol === 'https:' && !url.username && !url.password && !url.port;
}

function videoId(value) {
  return VIDEO_ID.test(value) ? value : '';
}

function youtubeVideoId(url, hostname) {
  const path = url.pathname;
  if (hostname === 'youtu.be') {
    const match = path.match(/^\/([A-Za-z0-9_-]{11})\/?$/);
    return match ? videoId(match[1]) : '';
  }

  if (path === '/watch') {
    const values = url.searchParams.getAll('v');
    return values.length === 1 ? videoId(values[0]) : '';
  }

  const match = path.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})\/?$/);
  return match ? videoId(match[1]) : '';
}

function aparatVideoId(path) {
  const share = path.match(/^\/v\/([A-Za-z0-9_-]{3,128})\/?$/);
  if (share) return APARAT_ID.test(share[1]) ? share[1] : '';

  const embed = path.match(/^\/video\/video\/embed\/videohash\/([A-Za-z0-9_-]{3,128})\/vt\/frame\/?$/);
  return embed && APARAT_ID.test(embed[1]) ? embed[1] : '';
}

function vimeoVideo(url, hostname) {
  const path = url.pathname;
  let match;
  let id = '';
  let pathHash = '';

  if (hostname === 'player.vimeo.com') {
    match = path.match(/^\/video\/(\d{5,20})\/?$/);
    if (!match) return '';
    id = match[1];
  } else {
    match = path.match(/^\/(\d{5,20})(?:\/([A-Za-z0-9_-]{5,64}))?\/?$/);
    if (!match) return '';
    id = match[1];
    pathHash = match[2] || '';
  }

  if (!VIMEO_ID.test(id)) return '';
  const queryHashes = url.searchParams.getAll('h');
  if (queryHashes.length > 1) return '';
  const queryHash = queryHashes[0] || '';
  if (url.searchParams.has('h') && !VIMEO_HASH.test(queryHash)) return '';
  if (pathHash && queryHash && pathHash !== queryHash) return '';
  return `${id}${pathHash || queryHash ? `?h=${pathHash || queryHash}` : ''}`;
}

/** Convert a provider share/watch URL into a canonical, safe iframe source.
 * Returns an empty string for every other URL. */
export function canonicalVideoEmbedUrl(raw) {
  const parsed = parseProviderUrl(raw);
  if (!parsed || !secureHttpsUrl(parsed.url)) return '';

  const { url, provider } = parsed;
  const hostname = url.hostname.toLowerCase();

  if (provider === 'youtube') {
    const id = youtubeVideoId(url, hostname);
    return id ? `${VIDEO_EMBED_FRAME_SOURCES[0]}/embed/${id}` : '';
  }

  if (provider === 'aparat') {
    const id = aparatVideoId(url.pathname);
    return id ? `${VIDEO_EMBED_FRAME_SOURCES[1]}/video/video/embed/videohash/${id}/vt/frame` : '';
  }

  if (provider === 'vimeo') {
    const video = vimeoVideo(url, hostname);
    return video ? `${VIDEO_EMBED_FRAME_SOURCES[2]}/video/${video}` : '';
  }

  return '';
}

/** True only for a URL that is already in the exact canonical player form. */
export function isCanonicalVideoEmbedUrl(raw) {
  const value = String(raw ?? '');
  return Boolean(value) && canonicalVideoEmbedUrl(value) === value;
}
