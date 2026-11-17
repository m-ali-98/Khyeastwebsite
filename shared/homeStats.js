/**
 * Keep homepage collection counters tied to the same data collections used by
 * the public catalogue and shop. Legacy positional indices keep old CMS
 * snapshots dynamic until they are next explicitly saved.
 */
const LEGACY_METRIC_INDEX = {
  'catalogue-products': 1,
  brands: 2,
};

export function resolveHomeStats(stats, products, brands) {
  if (!Array.isArray(stats)) return [];

  const counts = {
    'catalogue-products': Array.isArray(products) ? products.length : 0,
    brands: Array.isArray(brands) ? brands.length : 0,
  };
  const indexMetrics = new Map(
    Object.entries(LEGACY_METRIC_INDEX).map(([metric, index]) => [index, metric]),
  );

  return stats.map((stat, index) => {
    const metric = stat?.metric || indexMetrics.get(index);
    if (!Object.hasOwn(counts, metric)) return stat;
    const row = stat && typeof stat === 'object' && !Array.isArray(stat) ? stat : {};
    return { ...row, value: counts[metric] };
  });
}
