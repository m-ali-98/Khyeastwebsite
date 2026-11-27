// A GTM container ID is configuration, never arbitrary HTML or JavaScript.
export const DEFAULT_GOOGLE_TAG_ID = 'GTM-NFTZ2BZ2';
export const GOOGLE_TAG_ID_PATTERN = /^GTM-[A-Z0-9]{4,20}$/;

export function validGoogleTagId(value) {
  return typeof value === 'string' && (value === '' || GOOGLE_TAG_ID_PATTERN.test(value));
}

// Only call with a validated, nonempty ID. This is the installation snippet
// supplied by Google for the container's "All tags" option.
export function googleTagHead(id) {
  if (!id || !validGoogleTagId(id)) return '';
  return `<script async src="https://www.googletagmanager.com/gtm.js?id=${id}"></script>\n<script>\n  window.dataLayer = window.dataLayer || [];\n  function gtag(){dataLayer.push(arguments);}\n  gtag('js', new Date());\n</script>`;
}
