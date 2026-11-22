// Normalize public-facing copy without changing stored CMS data, URLs or IDs.
export function normalizePersianCopy(value) {
  return String(value ?? '').replace(/خمیر[\s\u200c]+مایه/g, 'خمیرمایه');
}

const identityKey = /^(?:slug|id|productSlug|href|url|src|image|images|video|link|phone|email|icon|metric|value|year|date|publishedAt|updatedAt)$/i;

export function normalizePublicCopy(value, key = '') {
  if (identityKey.test(key)) return value;
  if (typeof value === 'string') {
    // Preserve HTML attributes (including authored links and media URLs).
    return value.split(/(<[^>]*>)/g).map((part, i) => i % 2 ? part : normalizePersianCopy(part)).join('');
  }
  if (Array.isArray(value)) return value.map((item) => normalizePublicCopy(item, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, item]) => [childKey, normalizePublicCopy(item, childKey)]));
  }
  return value;
}

export function normalizePublicView(view) {
  if (!view) return view;
  return {
    ...view,
    texts: normalizePublicCopy(view.texts),
    collections: normalizePublicCopy(view.collections),
    products: normalizePublicCopy(view.products),
    posts: normalizePublicCopy(view.posts),
    brands: normalizePublicCopy(view.brands),
    gallery: normalizePublicCopy(view.gallery),
    shop: view.shop ? { ...view.shop, products: normalizePublicCopy(view.shop.products) } : view.shop,
  };
}
