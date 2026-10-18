/* ==========================================================================
   Defensive content merge shared by the browser, SEO renderer and build.

   The CMS payload is intentionally allowed to be partial. Defaults preserve
   every required key, while arrays supplied by the CMS replace their default
   counterpart. Invalid entity rows are discarded at the boundary so neither
   React nor the search-engine renderer can be taken down by one malformed
   record.
   ========================================================================== */

const ENTITY_ARRAYS = ['products', 'posts', 'brands'];
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const clone = (value) =>
  typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));

export function mergeContentState(base, remote) {
  const out = clone(base);
  if (!remote || typeof remote !== 'object' || Array.isArray(remote)) return out;

  for (const key of Object.keys(out)) {
    if (!(key in remote)) continue;
    const incoming = remote[key];
    if (Array.isArray(out[key])) out[key] = Array.isArray(incoming) ? incoming : out[key];
    else if (isPlainObject(out[key])) out[key] = isPlainObject(incoming) ? { ...out[key], ...incoming } : out[key];
    else out[key] = incoming;
  }

  for (const key of ENTITY_ARRAYS) {
    if (Array.isArray(out[key])) out[key] = out[key].filter(isPlainObject);
  }
  if (isPlainObject(out.shop)) {
    out.shop.display = isPlainObject(out.shop.display)
      ? { ...clone(base.shop?.display || {}), ...out.shop.display }
      : clone(base.shop?.display || {});
    const showcase = Array.isArray(out.shop.display.showcase)
      ? out.shop.display.showcase.filter(isPlainObject)
      : [];
    out.shop.display.showcase = showcase.length
      ? showcase
      : clone(base.shop?.display?.showcase || []);
    out.shop.products = Array.isArray(out.shop.products)
      ? out.shop.products.filter(isPlainObject)
      : clone(base.shop?.products || []);
  } else {
    out.shop = clone(base.shop || { display: {}, products: [] });
  }

  return out;
}

export default mergeContentState;
