/* The public content document and every authenticated content mutation use the
   same concurrency token. Keep the header name and integer parsing in a
   browser-safe module so the Admin client and Node server cannot drift. */
export const CONTENT_REVISION_HEADER = 'X-Khyeast-Content-Revision';

export function parseContentRevision(value) {
  const raw = String(value ?? '').trim();
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const revision = Number(raw);
  return Number.isSafeInteger(revision) ? revision : null;
}
