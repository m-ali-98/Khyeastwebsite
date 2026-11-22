const VALID_SLUG = /^[a-z0-9\u0600-\u06FF]+(?:-[a-z0-9\u0600-\u06FF]+)*$/;

const validSlug = (value) => {
  const slug = typeof value === 'string' ? value : '';
  return slug.length > 0 && slug.length <= 120 && VALID_SLUG.test(slug);
};

/** Resolve a public catalogue product's purchase destination. Only the
 * explicit Admin relationship is authoritative: matching slugs alone do not
 * mean two independently managed records represent the same product. */
export function findCatalogueShopProduct(catalogueSlug, shopProducts) {
  if (!validSlug(catalogueSlug) || !Array.isArray(shopProducts)) return null;
  return shopProducts.find((product) => (
    Boolean(product?.active) &&
    product.productSlug === catalogueSlug &&
    validSlug(product.slug)
  )) || null;
}

export function catalogueShopPath(catalogueSlug, shopProducts) {
  const related = findCatalogueShopProduct(catalogueSlug, shopProducts);
  return related ? `/shop/${related.slug}` : '/shop';
}
