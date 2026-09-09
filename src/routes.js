/* ==========================================================================
   Route chunk prefetching.
   --------------------------------------------------------------------------
   Code splitting alone would make navigation SLOWER on a bad connection (the
   chunk is fetched only after the click). So we warm chunks ahead of time:

     • on idle  — after the first paint, the most likely next pages are pulled
                  in during browser downtime
     • on hover / touchstart / focus of any internal link — gives the network a
       ~100-300 ms head start before the click actually happens
     • on route change — the neighbours of the current page

   All of it is skipped when the visitor is on 2G or has Data Saver enabled.
   ========================================================================== */
import { useEffect } from 'react';

/* Same import specifiers as src/App.jsx → Vite dedupes to the same chunk. */
const LOADERS = {
  '/about': () => import('./pages/About'),
  '/products': () => import('./pages/Products'),
  '/products/:slug': () => import('./pages/ProductDetail'),
  '/shop': () => import('./pages/Shop'),
  '/shop/cart': () => import('./pages/ShopCart'),
  '/shop/checkout': () => import('./pages/ShopCheckout'),
  '/shop/:slug': () => import('./pages/ShopProduct'),
  '/shop/order': () => import('./pages/ShopOrder'),
  '/export': () => import('./pages/Export'),
  '/quality': () => import('./pages/Quality'),
  '/blog': () => import('./pages/Blog'),
  '/blog/:slug': () => import('./pages/PostDetail'),
  '/contact': () => import('./pages/Contact'),
};

/* Pages worth having ready before the user asks for them, in priority order. */
const IDLE_ORDER = ['/products', '/shop', '/about', '/contact', '/shop/:slug', '/products/:slug', '/blog'];

/* What people usually open next from each page. */
const NEIGHBOURS = {
  '/': ['/products', '/shop', '/about'],
  '/products': ['/products/:slug', '/shop'],
  '/shop': ['/shop/:slug', '/shop/cart'],
  '/shop/cart': ['/shop/checkout'],
  '/shop/checkout': ['/shop/order'],
  '/blog': ['/blog/:slug'],
  '/about': ['/quality', '/export'],
  '/quality': ['/products'],
  '/export': ['/contact'],
};

const done = new Set();

export const isSaving = () => {
  if (typeof navigator === 'undefined') return false;
  const c = navigator.connection || {};
  return c.saveData === true || /(^|-)2g$/.test(c.effectiveType || '');
};

/** Load one route chunk at most once. */
export function warm(key) {
  const load = LOADERS[key];
  if (!load || done.has(key)) return;
  done.add(key);
  load().catch(() => done.delete(key));
}

/** Map a real pathname to the closest loader keys. */
function keysFor(pathname) {
  if (LOADERS[pathname]) return [pathname];
  if (/^\/products\/[^/]+$/.test(pathname)) return ['/products/:slug'];
  if (/^\/blog\/[^/]+$/.test(pathname)) return ['/blog/:slug'];
  if (/^\/shop\/order\//.test(pathname)) return ['/shop/order'];
  if (/^\/shop\/[^/]+$/.test(pathname)) return ['/shop/:slug'];
  return [];
}

/** Prefetch the neighbours of a pathname (called on every route change). */
export function prefetch(pathname) {
  if (isSaving()) return;
  const base = keysFor(pathname)[0] || pathname;
  (NEIGHBOURS[base] || []).forEach(warm);
}

const onIdle = (fn) =>
  typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 2500 }) : setTimeout(fn, 1200);

/** Install idle + hover prefetching for the whole app (mount once). */
export function usePrefetchRoutes() {
  useEffect(() => {
    if (isSaving()) return undefined;

    /* 1. warm the likely pages while the browser is idle, one at a time so we
          never compete with the content the user is actually looking at */
    let i = 0;
    const step = () => {
      if (i >= IDLE_ORDER.length) return;
      warm(IDLE_ORDER[i++]);
      onIdle(step);
    };
    const idleId = onIdle(step);

    /* 2. warm on intent — hovering, touching or tabbing to a link */
    const onIntent = (e) => {
      const a = e.target?.closest?.('a[href^="/"]');
      if (!a) return;
      const path = a.getAttribute('href').split('?')[0].split('#')[0];
      keysFor(path).forEach(warm);
    };
    const opts = { passive: true, capture: true };
    document.addEventListener('pointerenter', onIntent, opts);
    document.addEventListener('touchstart', onIntent, opts);
    document.addEventListener('focusin', onIntent, opts);

    return () => {
      if (typeof cancelIdleCallback === 'function') cancelIdleCallback(idleId);
      document.removeEventListener('pointerenter', onIntent, opts);
      document.removeEventListener('touchstart', onIntent, opts);
      document.removeEventListener('focusin', onIntent, opts);
    };
  }, []);
}
