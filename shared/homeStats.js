/**
 * Keep the homepage's catalogue count tied to the same product collection used
 * by the /products listing. The positional fallback handles existing saved CMS
 * snapshots created before the metric marker was added.
 */
const LEGACY_PRODUCT_COUNT_INDEX = 1;

export function resolveHomeStats(stats, products) {
  if (!Array.isArray(stats)) return [];

  const markedIndex = stats.findIndex((stat) => stat?.metric === 'catalogue-products');
  const productCountIndex = markedIndex >= 0 ? markedIndex : LEGACY_PRODUCT_COUNT_INDEX;
  const productCount = Array.isArray(products) ? products.length : 0;

  return stats.map((stat, index) => {
    if (index !== productCountIndex) return stat;
    const row = stat && typeof stat === 'object' && !Array.isArray(stat) ? stat : {};
    return { ...row, value: productCount };
  });
}
