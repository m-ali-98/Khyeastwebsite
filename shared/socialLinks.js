/* ==========================================================================
   Public social-link safety.

   Social destinations are Admin-authored strings that become executable href
   attributes in the header, footer and contact page. CSP is not an input
   validation boundary: javascript: and data: destinations must never reach
   public consumers even when a browser would block one particular execution
   path. Keep persistence and rendering on one definition so they cannot drift.
   ========================================================================== */

const MAX_SOCIAL_HREF_LENGTH = 2048;
const DRAFT_HREFS = new Set(['', 'http://', 'https://']);
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const hrefProblem = (value, { allowDraft = false } = {}) => {
  if (typeof value !== 'string') return 'href-not-string';
  const href = value.trim();
  if (allowDraft && DRAFT_HREFS.has(href.toLowerCase())) return null;
  if (!href) return 'href-required';
  if (href.length > MAX_SOCIAL_HREF_LENGTH) return 'href-too-long';

  try {
    const parsed = new URL(href);
    if (!['http:', 'https:'].includes(parsed.protocol)) return 'unsafe-href-scheme';
    if (!parsed.hostname || parsed.username || parsed.password) return 'invalid-href';
  } catch {
    return 'invalid-href';
  }
  return null;
};

/** Only absolute HTTP(S) destinations may become public anchor hrefs. */
export const isSafeSocialHref = (value) => hrefProblem(value) === null;

/**
 * Validate the canonical Persian collection before persistence. Blank and
 * scheme-only values are allowed as short-lived Admin drafts, but are never
 * rendered by safeSocialLinks below.
 */
export function socialLinksProblem(links) {
  if (!Array.isArray(links)) return { code: 'not-array', index: -1 };
  for (let index = 0; index < links.length; index += 1) {
    const item = links[index];
    if (!isRecord(item)) return { code: 'invalid-row', index };
    const code = hrefProblem(item.href, { allowDraft: true });
    if (code) return { code, index };
  }
  return null;
}

/** Locale rows normally translate only labels. If a direct API caller adds an
 * href override, it must satisfy the same protocol rule as the base link. */
export function socialLinkOverridesProblem(links) {
  if (links === undefined) return null;
  if (!Array.isArray(links)) return { code: 'not-array', index: -1 };
  for (let index = 0; index < links.length; index += 1) {
    const item = links[index];
    if (!isRecord(item) || !Object.hasOwn(item, 'href')) continue;
    const code = hrefProblem(item.href, { allowDraft: true });
    if (code) return { code, index };
  }
  return null;
}

/** Fail closed when rendering old or externally corrupted persisted content. */
export function safeSocialLinks(links) {
  if (!Array.isArray(links)) return [];
  const safe = links.filter((item) => isRecord(item) && isSafeSocialHref(item.href));
  return safe.length === links.length ? links : safe;
}
