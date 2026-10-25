import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useContent } from '../content/ContentContext';
import { productOrderLimit, reconcileCart } from '../../shared/cartAvailability.js';

const Ctx = createContext(null);
const CART_KEY = 'ky_shop_cart_v1';
const ORDERS_KEY = 'ky_shop_orders_v1';

const isPlainRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/* Read JSON from localStorage, falling back whenever the stored value cannot
   be used as-is. A single corrupt key must never take down the storefront. */
const readLS = (key, fallback) => {
  try {
    const value = localStorage.getItem(key);
    if (!value) return fallback;
    const parsed = JSON.parse(value);
    return isPlainRecord(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
};

const writeLS = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage can be unavailable or full; the in-memory cart still works.
  }
};

/* ---------------- money helpers (prices stored in RIAL) ---------------- */
export const rialToUnit = (rial, unit) => (unit === 'toman' ? Math.round(Number(rial) / 10) : Math.round(Number(rial)));
export const formatMoney = (rial, unit = 'rial', withLabel = true) => {
  const value = rialToUnit(rial, unit).toLocaleString('fa-IR');
  return withLabel ? `${value} ${unit === 'toman' ? 'تومان' : 'ریال'}` : value;
};
export const orderTokensGet = () => readLS(ORDERS_KEY, {});
export const orderTokenSave = (code, token) => writeLS(ORDERS_KEY, { ...orderTokensGet(), [code]: token });
export const orderTokenGet = (code) => orderTokensGet()[code] || '';

const publicProducts = async () => {
  const response = await fetch('/api/shop-products', {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw Object.assign(new Error(`api error ${response.status}`), { status: response.status });
  const payload = await response.json();
  if (!payload || !Array.isArray(payload.products)) throw new Error('invalid product catalogue');
  return payload.products;
};

export function ShopProvider({ children }) {
  const { state, ready: contentReady, backend } = useContent();
  const contentProducts = Array.isArray(state.shop?.products) ? state.shop.products : [];
  const display = state.shop?.display || {};
  const [inventorySnapshot, setInventorySnapshot] = useState(null);
  const products = inventorySnapshot?.base === contentProducts
    ? inventorySnapshot.products
    : contentProducts;
  const [cart, setCart] = useState({});
  const [cartHydrated, setCartHydrated] = useState(false);
  const [availabilityNotice, setAvailabilityNotice] = useState(null);
  const [availabilityRefreshing, setAvailabilityRefreshing] = useState(false);
  const [comments, setComments] = useState([]);
  const [paymentProvider, setPaymentProvider] = useState('offline');
  const [shopReady, setShopReady] = useState(false);

  useEffect(() => {
    setCart(readLS(CART_KEY, {}));
    setCartHydrated(true);
  }, []);

  const loadComments = useCallback(() => (
    fetch('/api/shop-public', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('shop api'))))
      .then((payload) => {
        setComments(Array.isArray(payload.comments) ? payload.comments : []);
        setPaymentProvider(payload.paymentProvider || 'offline');
        return payload;
      })
      .catch(() => null)
      .finally(() => setShopReady(true))
  ), []);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  const persist = useCallback((next) => {
    setCart(next);
    writeLS(CART_KEY, next);
  }, []);

  const applyReconciliation = useCallback((result) => {
    if (!result?.changed) return result;
    persist(result.cart);
    if (result.changes.length) setAvailabilityNotice({ changes: result.changes });
    return result;
  }, [persist]);

  const reconciliation = useMemo(
    () => reconcileCart(cart, products),
    [cart, products],
  );

  /* Once a real server snapshot and the persisted browser cart are both
     available, repair the stored cart. The rendered rows already use this
     result, so an unavailable line cannot leak into checkout for one frame. */
  useEffect(() => {
    if (!contentReady || !backend || !cartHydrated || !reconciliation.changed) return;
    applyReconciliation(reconciliation);
  }, [contentReady, backend, cartHydrated, reconciliation, applyReconciliation]);

  const effectiveCart = reconciliation.cart;
  const rows = useMemo(() => reconciliation.rows.map((row) => ({
    product: row.product,
    qty: row.quantity,
    sum: row.lineTotal,
    limit: row.limit,
  })), [reconciliation]);

  const bySlug = useCallback(
    (slug) => products.find((product) => product.slug === slug) || null,
    [products],
  );

  const add = useCallback((slug, quantity = 1) => {
    const limit = productOrderLimit(bySlug(slug));
    if (!limit) return false;
    const amount = Math.max(1, Math.round(Number(quantity) || 1));
    const current = Number(effectiveCart[slug]) || 0;
    persist({ ...effectiveCart, [slug]: Math.min(limit, current + amount) });
    return true;
  }, [bySlug, effectiveCart, persist]);

  const setQty = useCallback((slug, quantity) => {
    const limit = productOrderLimit(bySlug(slug));
    const next = { ...effectiveCart };
    if (!limit) {
      delete next[slug];
      persist(next);
      return;
    }
    const amount = Math.max(0, Math.min(limit, Math.round(Number(quantity) || 0)));
    if (amount <= 0) delete next[slug];
    else next[slug] = amount;
    persist(next);
  }, [bySlug, effectiveCart, persist]);

  const remove = useCallback((slug) => {
    const next = { ...effectiveCart };
    delete next[slug];
    persist(next);
  }, [effectiveCart, persist]);

  const clear = useCallback(() => {
    setAvailabilityNotice(null);
    persist({});
  }, [persist]);

  const dismissAvailabilityNotice = useCallback(() => setAvailabilityNotice(null), []);

  /* Stock can move while the checkout form is open. This request is made
     immediately before every order POST and again after a conflict. It returns
     rows from that exact response, avoiding a stale React render closure. */
  const refreshCartAvailability = useCallback(async () => {
    setAvailabilityRefreshing(true);
    try {
      const latestProducts = await publicProducts();
      const result = reconcileCart(cart, latestProducts, { knownProducts: products });
      /* Tie the direct response to the content array it refreshed. A later
         route-level content response supersedes it synchronously, without one
         render against an older checkout snapshot. */
      setInventorySnapshot({ base: contentProducts, products: latestProducts });
      applyReconciliation(result);
      return {
        ...result,
        rows: result.rows.map((row) => ({
          product: row.product,
          qty: row.quantity,
          sum: row.lineTotal,
          limit: row.limit,
        })),
      };
    } finally {
      setAvailabilityRefreshing(false);
    }
  }, [cart, products, contentProducts, applyReconciliation]);

  const count = rows.reduce((sum, row) => sum + row.qty, 0);
  const subtotal = rows.reduce((sum, row) => sum + row.sum, 0);
  const freeOver = Number(display.freeShippingOver) || 0;
  const shipping = rows.length && !(freeOver > 0 && subtotal >= freeOver)
    ? Math.max(0, Math.round(Number(display.shippingCost) || 0))
    : 0;
  const total = subtotal + shipping;
  const unit = display.displayUnit === 'toman' ? 'toman' : 'rial';
  const money = useCallback((rial, withLabel = true) => formatMoney(rial, unit, withLabel), [unit]);

  const value = useMemo(() => ({
    ready: contentReady && shopReady,
    display,
    products,
    unit,
    money,
    paymentProvider,
    comments,
    reloadComments: loadComments,
    bySlug,
    cart: effectiveCart,
    cartHydrated,
    rows,
    count,
    subtotal,
    shipping,
    total,
    availabilityNotice,
    availabilityRefreshing,
    add,
    setQty,
    remove,
    clear,
    dismissAvailabilityNotice,
    refreshCartAvailability,
  }), [
    contentReady,
    shopReady,
    display,
    products,
    unit,
    money,
    paymentProvider,
    comments,
    loadComments,
    bySlug,
    effectiveCart,
    cartHydrated,
    rows,
    count,
    subtotal,
    shipping,
    total,
    availabilityNotice,
    availabilityRefreshing,
    add,
    setQty,
    remove,
    clear,
    dismissAvailabilityNotice,
    refreshCartAvailability,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useShop = () => useContext(Ctx);
