import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useContent } from '../content/ContentContext';

const Ctx = createContext(null);
const CART_KEY = 'ky_shop_cart_v1';
const ORDERS_KEY = 'ky_shop_orders_v1';

const readLS = (key, fallback) => {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
};
const writeLS = (key, v) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {}
};

/* ---------------- money helpers (prices stored in RIAL) ---------------- */
export const rialToUnit = (rial, unit) => (unit === 'toman' ? Math.round(Number(rial) / 10) : Math.round(Number(rial)));
export const formatMoney = (rial, unit = 'rial', withLabel = true) => {
  const v = rialToUnit(rial, unit).toLocaleString('fa-IR');
  return withLabel ? `${v} ${unit === 'toman' ? 'تومان' : 'ریال'}` : v;
};
export const orderTokensGet = () => readLS(ORDERS_KEY, {});
export const orderTokenSave = (code, token) => writeLS(ORDERS_KEY, { ...orderTokensGet(), [code]: token });
export const orderTokenGet = (code) => orderTokensGet()[code] || '';

export function ShopProvider({ children }) {
  const { state, ready } = useContent();
  const shop = state.shop || { display: {}, products: [] };
  const display = shop.display || {};
  const products = useMemo(() => shop.products || [], [shop.products]);

  const [cart, setCart] = useState({}); // { slug: qty }
  const [comments, setComments] = useState([]);
  const [paymentProvider, setPaymentProvider] = useState('offline');
  const [shopReady, setShopReady] = useState(false);

  useEffect(() => setCart(readLS(CART_KEY, {})), []);
  const persist = (next) => {
    setCart(next);
    writeLS(CART_KEY, next);
  };

  const loadComments = useCallback(() => {
    fetch('/api/shop-public')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setComments(d.comments || []);
        setPaymentProvider(d.paymentProvider || 'offline');
      })
      .catch(() => {})
      .finally(() => setShopReady(true));
  }, []);
  useEffect(loadComments, [loadComments]);

  const bySlug = useCallback((slug) => products.find((p) => p.slug === slug) || null, [products]);

  const add = useCallback(
    (slug, qty = 1) => {
      const p = bySlug(slug);
      if (!p || !p.active) return false;
      const max = Number(p.stock) >= 0 ? Number(p.stock) : 999;
      const next = { ...cart, [slug]: Math.min(999, Math.max(1, (cart[slug] || 0) + qty), Math.max(1, max)) };
      persist(next);
      return true;
    },
    [cart, bySlug]
  );

  const setQty = useCallback(
    (slug, qty) => {
      const next = { ...cart };
      const p = bySlug(slug);
      const max = p && Number(p.stock) >= 0 ? Number(p.stock) : 999;
      const q = Math.min(999, Math.max(0, qty), Math.max(0, max));
      if (q <= 0) delete next[slug];
      else next[slug] = q;
      persist(next);
    },
    [cart, bySlug]
  );

  const remove = useCallback(
    (slug) => {
      const next = { ...cart };
      delete next[slug];
      persist(next);
    },
    [cart]
  );

  const clear = useCallback(() => persist({}), []);

  const rows = useMemo(
    () =>
      Object.entries(cart)
        .map(([slug, qty]) => {
          const product = bySlug(slug);
          return product ? { product, qty, sum: Math.round(Number(product.price) || 0) * qty } : null;
        })
        .filter(Boolean),
    [cart, bySlug]
  );

  const count = useMemo(() => rows.reduce((s, r) => s + r.qty, 0), [rows]);
  const subtotal = useMemo(() => rows.reduce((s, r) => s + r.sum, 0), [rows]);
  const freeOver = Number(display.freeShippingOver) || 0;
  const shipping = useMemo(() => {
    if (!rows.length) return 0;
    return freeOver > 0 && subtotal >= freeOver ? 0 : Math.max(0, Math.round(Number(display.shippingCost) || 0));
  }, [rows.length, subtotal, freeOver, display.shippingCost]);
  const total = subtotal + shipping;

  const unit = display.displayUnit === 'toman' ? 'toman' : 'rial';
  const money = useCallback((rial, withLabel = true) => formatMoney(rial, unit, withLabel), [unit]);

  const value = useMemo(
    () => ({
      ready: ready && shopReady,
      display,
      products,
      unit,
      money,
      paymentProvider,
      comments,
      reloadComments: loadComments,
      bySlug,
      cart,
      add,
      setQty,
      remove,
      clear,
      rows,
      count,
      subtotal,
      shipping,
      total,
    }),
    [ready, shopReady, display, products, unit, money, paymentProvider, comments, loadComments, bySlug, cart, add, setQty, remove, clear, rows, count, subtotal, shipping, total]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useShop = () => useContext(Ctx);
