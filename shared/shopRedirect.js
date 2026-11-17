/* Restrict post-auth navigation to known same-app storefront routes. This is
 * intentionally stricter than accepting any relative URL: login destinations
 * should not turn into open redirects or escape the shop flow. */
export function safeShopNext(value, origin = typeof window === 'undefined' ? 'https://local.invalid' : window.location.origin) {
  const fallback = '/shop/account';
  const raw = String(value || '');
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback;
  try {
    const url = new URL(raw, origin);
    if (
      url.origin !== origin ||
      !/^\/shop\/(?:cart|checkout|account|order\/[A-Za-z0-9-]+)\/?$/.test(url.pathname)
    ) return fallback;
    url.searchParams.delete('token');
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
