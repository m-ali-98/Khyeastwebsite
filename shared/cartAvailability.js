/* ==========================================================================
   Cart availability reconciliation.

   The browser persists only { [slug]: quantity }. Catalogue rows remain
   authoritative: a saved cart must therefore be repaired whenever a fresh
   product snapshot arrives, and immediately before checkout. Keeping this
   logic pure makes the same edge cases deterministic in React and in tests.
   ========================================================================== */

export const MAX_CART_QUANTITY = 999;

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const productMap = (products) => {
  const map = new Map();
  if (!Array.isArray(products)) return map;
  for (const product of products) {
    const slug = typeof product?.slug === 'string' ? product.slug.trim() : '';
    if (slug) map.set(slug, product);
  }
  return map;
};

const productTitle = (product, slug) => {
  const title = typeof product?.title === 'string' ? product.title.trim() : '';
  return title || slug;
};

/** The highest quantity the storefront can safely offer for one product.
 * `-1` is the server-side unlimited-stock sentinel. Invalid catalogue values
 * fail closed instead of becoming the old accidental 999-item allowance. */
export function productOrderLimit(product) {
  if (!product || product.active !== true) return 0;
  const price = Number(product.price);
  const stock = Number(product.stock);
  if (!Number.isSafeInteger(price) || price <= 0) return 0;
  if (!Number.isSafeInteger(stock) || stock < -1) return 0;
  return stock === -1 ? MAX_CART_QUANTITY : Math.min(stock, MAX_CART_QUANTITY);
}

const normalizedQuantity = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.min(MAX_CART_QUANTITY, Math.max(1, Math.round(number)));
};

const sameCart = (source, next) => {
  if (!isRecord(source)) return false;
  const sourceEntries = Object.entries(source);
  const nextEntries = Object.entries(next);
  if (sourceEntries.length !== nextEntries.length) return false;
  return sourceEntries.every(([slug, quantity]) => (
    Object.hasOwn(next, slug) &&
    typeof quantity === 'number' &&
    Number.isSafeInteger(quantity) &&
    quantity === next[slug]
  ));
};

/**
 * Reconcile a persisted cart with one authoritative catalogue snapshot.
 *
 * `knownProducts` is optional historical display data. It is used only to put
 * a human title in the notice when the authoritative list no longer contains
 * a slug; it can never make that missing product orderable again.
 */
export function reconcileCart(cart, products, { knownProducts = [] } = {}) {
  const source = isRecord(cart) ? cart : {};
  const current = productMap(products);
  const known = productMap(knownProducts);
  const next = {};
  const changes = [];
  const rows = [];

  for (const [slug, storedQuantity] of Object.entries(source)) {
    const product = current.get(slug);
    const previousProduct = known.get(slug);
    const displayProduct = product || previousProduct;
    const title = productTitle(displayProduct, slug);
    const requestedNumber = Number(storedQuantity);
    const requested = normalizedQuantity(storedQuantity);

    if (!product) {
      changes.push({
        kind: 'removed',
        reason: previousProduct?.active === false ? 'inactive' : 'missing',
        slug,
        title,
        from: Number.isFinite(requestedNumber) ? requestedNumber : null,
      });
      continue;
    }

    const limit = productOrderLimit(product);
    if (limit <= 0) {
      const stock = Number(product.stock);
      let reason = 'unavailable';
      if (product.active !== true) reason = 'inactive';
      else if (Number.isSafeInteger(stock) && stock === 0) reason = 'out_of_stock';
      changes.push({
        kind: 'removed',
        reason,
        slug,
        title,
        from: Number.isFinite(requestedNumber) ? requestedNumber : null,
      });
      continue;
    }

    if (!requested) {
      changes.push({ kind: 'removed', reason: 'invalid_quantity', slug, title, from: null });
      continue;
    }

    const quantity = Math.min(requested, limit);
    next[slug] = quantity;
    rows.push({
      product,
      quantity,
      limit,
      lineTotal: Number(product.price) * quantity,
    });

    if (
      typeof storedQuantity !== 'number' ||
      !Number.isSafeInteger(storedQuantity) ||
      storedQuantity !== quantity
    ) {
      const stockLimited = Number(product.stock) >= 0 && requested > limit;
      changes.push({
        kind: 'adjusted',
        reason: stockLimited ? 'stock_reduced' : 'quantity_repaired',
        slug,
        title,
        from: Number.isFinite(requestedNumber) ? requestedNumber : null,
        to: quantity,
        available: limit,
      });
    }
  }

  return {
    cart: next,
    rows,
    changes,
    changed: !sameCart(source, next),
  };
}

export default reconcileCart;
