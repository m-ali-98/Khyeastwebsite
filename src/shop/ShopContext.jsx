import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useContent } from '../content/ContentContext';
import { productOrderLimit, reconcileCart } from '../../shared/cartAvailability.js';

const Ctx = createContext(null);
const CART_KEY = 'ky_shop_cart_v1';
const ORDERS_KEY = 'ky_shop_orders_v1';

const isPlainRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const parseStoredRecord = (value) => {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = JSON.parse(value);
    return isPlainRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/* Read JSON from localStorage, falling back whenever the stored value cannot
   be used as-is. A single corrupt key must never take down the storefront. */
const readLS = (key, fallback) => {
  try {
    return parseStoredRecord(localStorage.getItem(key)) || fallback;
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
  const [cartStorageRevision, setCartStorageRevision] = useState(0);
  const [availabilityNotice, setAvailabilityNotice] = useState(null);
  const [availabilityRefreshing, setAvailabilityRefreshing] = useState(false);
  const [paymentProvider, setPaymentProvider] = useState(null);
  const paymentProviderRef = useRef(null);
  const paymentProviderRequest = useRef(null);
  const lastAutoReconciledProducts = useRef(null);

  useEffect(() => {
    setCart(readLS(CART_KEY, {}));
    setCartHydrated(true);

    /* `storage` fires in every other same-origin tab. Without this listener an
       older tab keeps its mount-time cart and its next click can replace newer
       localStorage wholesale. Invalid external values are ignored rather than
       turning one damaged tab into a cross-tab cart clear. */
    const syncCartFromStorage = (event) => {
      if (event.key !== CART_KEY && event.key !== null) return;
      try {
        if (event.storageArea && event.storageArea !== localStorage) return;
        /* Do not roll state back for an already-queued event if another tab (or
           this one) has written again, but still refresh the live catalogue. */
        const latest = localStorage.getItem(CART_KEY);
        if (latest !== event.newValue) {
          setCartStorageRevision((revision) => revision + 1);
          return;
        }
        if (event.key === null || latest === null) {
          setCart({});
          setCartStorageRevision((revision) => revision + 1);
          return;
        }
        const next = parseStoredRecord(latest);
        if (next) {
          setCart(next);
          setCartStorageRevision((revision) => revision + 1);
        }
      } catch {
        /* Keep the last usable in-memory cart when storage access is blocked. */
      }
    };
    window.addEventListener('storage', syncCartFromStorage);
    return () => window.removeEventListener('storage', syncCartFromStorage);
  }, []);

  /* Payment identity is needed only by checkout and order retry screens. Those
     routes call this lazy loader; ordinary pages no longer fetch shop metadata
     (or the former global comments table) during application bootstrap. */
  const loadPaymentProvider = useCallback(() => {
    if (paymentProviderRef.current !== null) {
      return Promise.resolve(paymentProviderRef.current);
    }
    if (paymentProviderRequest.current) return paymentProviderRequest.current;

    paymentProviderRequest.current = fetch('/api/shop-public/payment', {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('shop payment api'))))
      .then((payload) => payload?.paymentProvider || 'offline')
      .catch(() => 'offline')
      .then((provider) => {
        paymentProviderRef.current = provider;
        setPaymentProvider(provider);
        return provider;
      })
      .finally(() => { paymentProviderRequest.current = null; });
    return paymentProviderRequest.current;
  }, []);

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
    if (!contentReady || !backend || !cartHydrated) return;
    /* Reconcile automatically when an authoritative catalogue arrives, not
       merely because another tab changed the cart. An old tab may not know a
       newly published slug yet; persisting its stale "missing" conclusion
       would otherwise erase the newer tab's valid line. */
    if (lastAutoReconciledProducts.current === products) return;
    lastAutoReconciledProducts.current = products;
    if (reconciliation.changed) applyReconciliation(reconciliation);
  }, [contentReady, backend, cartHydrated, products, reconciliation, applyReconciliation]);

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

  /* Storage events are asynchronous. Re-read localStorage at mutation time as
     well, so a click made just before the event callback runs still starts from
     the newest cross-tab cart rather than overwriting it. Preserve unknown
     slugs here: this tab's catalogue may be older than the tab that added one. */
  const latestCartForMutation = useCallback(() => {
    try {
      const value = localStorage.getItem(CART_KEY);
      if (value === null) return {};
      return parseStoredRecord(value) || effectiveCart;
    } catch {
      return effectiveCart;
    }
  }, [effectiveCart]);

  const add = useCallback((slug, quantity = 1) => {
    const limit = productOrderLimit(bySlug(slug));
    if (!limit) return false;
    const base = latestCartForMutation();
    const amount = Math.max(1, Math.round(Number(quantity) || 1));
    const current = Number(base[slug]) || 0;
    persist({ ...base, [slug]: Math.min(limit, current + amount) });
    return true;
  }, [bySlug, latestCartForMutation, persist]);

  const setQty = useCallback((slug, quantity) => {
    const limit = productOrderLimit(bySlug(slug));
    const next = { ...latestCartForMutation() };
    if (!limit) {
      delete next[slug];
      persist(next);
      return;
    }
    const amount = Math.max(0, Math.min(limit, Math.round(Number(quantity) || 0)));
    if (amount <= 0) delete next[slug];
    else next[slug] = amount;
    persist(next);
  }, [bySlug, latestCartForMutation, persist]);

  const remove = useCallback((slug) => {
    const next = { ...latestCartForMutation() };
    delete next[slug];
    persist(next);
  }, [latestCartForMutation, persist]);

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
         render against an older checkout snapshot. This exact result is
         applied below, so the automatic effect need not apply it a second time. */
      lastAutoReconciledProducts.current = latestProducts;
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

  /* A storage event can carry a slug that this long-lived tab has never seen.
     Refresh live inventory before deciding that the line is missing, then
     retain the same unavailable/reduced-stock repair and notice behavior used
     at mount and checkout. Superseded requests are ignored. */
  useEffect(() => {
    if (!cartStorageRevision || !backend || !cartHydrated) return undefined;
    let current = true;
    publicProducts()
      .then((latestProducts) => {
        if (!current) return;
        let latestCart;
        try {
          const stored = localStorage.getItem(CART_KEY);
          latestCart = stored === null ? {} : parseStoredRecord(stored);
        } catch {
          return;
        }
        if (!latestCart) return;
        const result = reconcileCart(latestCart, latestProducts, { knownProducts: contentProducts });
        lastAutoReconciledProducts.current = latestProducts;
        setInventorySnapshot({ base: contentProducts, products: latestProducts });
        if (result.changed) applyReconciliation(result);
        else setCart(latestCart);
      })
      .catch(() => {
        /* Keep the synchronized cart and current catalogue when offline. */
      });
    return () => { current = false; };
  }, [cartStorageRevision, backend, cartHydrated, contentProducts, applyReconciliation]);

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
    ready: contentReady,
    display,
    products,
    unit,
    money,
    paymentProvider,
    loadPaymentProvider,
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
    display,
    products,
    unit,
    money,
    paymentProvider,
    loadPaymentProvider,
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
