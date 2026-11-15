import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BrowserRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import RouteFallback from './components/RouteFallback';
import SeoHead from './components/SeoHead';
import { useContent } from './content/ContentContext';
import { useLocale, localePath } from './i18n/LocaleContext';
import { isStorefrontEnabled } from '../shared/shopAvailability.js';
import { dismissBootSplash } from './lib/bootSplash';
import useLoadingGate from './hooks/useLoadingGate';
import Home from './pages/Home'; // landing page stays in the main bundle

/* ---------------------------------------------------------------------------
   Route-level code splitting: every page ships as its own chunk and starts
   loading only after the visitor asks for it. There is deliberately no idle,
   hover, neighbour, or route-warm prefetch layer. Browser-native module caching
   remains useful, while the loading screen is driven only by unresolved route
   code or a genuinely pending fresh-content request.
   --------------------------------------------------------------------------- */
const About = lazy(() => import('./pages/About'));
const Products = lazy(() => import('./pages/Products'));
const ProductDetail = lazy(() => import('./pages/ProductDetail'));
const Export = lazy(() => import('./pages/Export'));
const Quality = lazy(() => import('./pages/Quality'));
const Blog = lazy(() => import('./pages/Blog'));
const PostDetail = lazy(() => import('./pages/PostDetail'));
const Contact = lazy(() => import('./pages/Contact'));
const SalesRepresentatives = lazy(() => import('./pages/SalesRepresentatives'));
const Gallery = lazy(() => import('./pages/Gallery'));
const NotFound = lazy(() => import('./pages/NotFound'));
const Shop = lazy(() => import('./pages/Shop'));
const ShopProduct = lazy(() => import('./pages/ShopProduct'));
const ShopCart = lazy(() => import('./pages/ShopCart'));
const ShopCheckout = lazy(() => import('./pages/ShopCheckout'));
const ShopOrder = lazy(() => import('./pages/ShopOrder'));
const ShopAuth = lazy(() => import('./pages/ShopAuth'));
const ShopAccount = lazy(() => import('./pages/ShopAccount'));

/* The admin panel is intentionally NOT linked anywhere on the public site.
   It is reachable only by typing its address directly. */
const AdminApp = lazy(() => import('./admin/AdminApp'));

/* Mounted inside each Suspense boundary after the active route has resolved.
   Fresh content is acquired before the route is mounted, so this commit is the
   final real readiness signal — not a timer and not a simulated loading beat. */
function RouteCommit({ routeKey, onReady }) {
  useEffect(() => {
    onReady(routeKey);
  }, [routeKey, onReady]);
  return null;
}

function PublicRoutes() {
  /* The online shop is an Iran-facing feature (rial pricing, Iranian payment
     gateway), so it exists on the Persian site only. On /en and /ar its routes
     are simply not mounted and fall through to the 404 page. */
  const { shopEnabled, locale } = useLocale();
  const { state } = useContent();
  const storefrontEnabled = isStorefrontEnabled(shopEnabled, state.shop?.display);
  const persianSite = locale === 'fa';
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/about" element={<About />} />
      <Route path="/products" element={<Products />} />
      <Route path="/products/:slug" element={<ProductDetail />} />
      {storefrontEnabled && <Route path="/shop" element={<Shop />} />}
      {shopEnabled && (
        <>
          <Route path="/shop/cart" element={<ShopCart />} />
          <Route path="/shop/checkout" element={<ShopCheckout />} />
          <Route path="/shop/order/:code" element={<ShopOrder />} />
          <Route path="/shop/login" element={<ShopAuth />} />
          <Route path="/shop/account" element={<ShopAccount />} />
        </>
      )}
      {storefrontEnabled && <Route path="/shop/:slug" element={<ShopProduct />} />}
      <Route path="/export" element={<Export />} />
      <Route path="/quality" element={<Quality />} />
      <Route path="/blog" element={<Blog />} />
      <Route path="/blog/:slug" element={<PostDetail />} />
      <Route path="/gallery" element={<Gallery />} />
      {persianSite && <Route path="/sales-representatives" element={<SalesRepresentatives />} />}
      <Route path="/contact" element={<Contact />} />
      <Route path="/dezmaye" element={<Navigate to="/products/dezmaye-gold-80" replace />} />
      <Route path="/shetab" element={<Navigate to="/products/shetab-90" replace />} />
      <Route path="/xpower" element={<Navigate to="/products/xpower-70" replace />} />
      <Route path="/nanmaye" element={<Navigate to="/products/nanmaye-500" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function NavigationRoutes() {
  const location = useLocation();
  const isAdmin = location.pathname === '/admin' || location.pathname.startsWith('/admin/');
  const { locale } = useLocale();
  const { reload } = useContent();
  /* Collection query strings only change which already-fresh records are
     visible. Keep gallery pagination and catalogue brand filters inside their
     mounted route instead of briefly removing <main>, re-fetching all content,
     and letting the browser clamp a mobile scroll position to the footer. */
  const isInPlaceCollection = /^\/(?:gallery|products)$/.test(location.pathname);
  const routeKey = isInPlaceCollection
    ? `collection:${location.pathname}`
    : `${location.key || 'route'}:${location.pathname}${location.search}`;
  const [freshKey, setFreshKey] = useState('');
  const [settledKey, setSettledKey] = useState('');
  const activeKey = useRef(routeKey);
  const freshKeyRef = useRef('');
  activeKey.current = routeKey;

  /* A destination is genuinely pending until a no-store content request has
     settled and its route (including a lazy module) has committed. The visual
     loader is adaptively delayed, so fast cached routes never flash it; when it
     does appear, minVisible=0 removes it at the exact completion signal. */
  const waiting = routeKey !== settledKey;
  const loaderState = useLoadingGate(waiting, { minVisible: 0 });
  const bootSplashPresent = typeof document !== 'undefined' && document.getElementById('boot-splash');
  const loaderVisible = waiting && loaderState === 'visible' && !bootSplashPresent;

  /* Do not mount the destination against an old content snapshot. Every unique
     history entry revalidates first; concurrent first-paint/admin requests are
     de-duplicated by ContentProvider. A failed backend still releases the route
     with its shipped defaults instead of trapping somebody on a loader. */
  useLayoutEffect(() => {
    let current = true;
    reload()
      .catch(() => null)
      .finally(() => {
        if (!current || activeKey.current !== routeKey) return;
        freshKeyRef.current = routeKey;
        setFreshKey(routeKey);
      });
    return () => {
      current = false;
    };
  }, [routeKey, reload]);

  const markRouteReady = useCallback((key) => {
    if (key !== activeKey.current || freshKeyRef.current !== key) return;
    setSettledKey(key);
    dismissBootSplash();
  }, []);

  /* Reconstruct the public URL because useLocation is relative to the locale
     basename (`/en/products` appears here as `/products`). The same resolver
     renders direct-request metadata on the server and updates it here after
     client navigation. */
  const seoPath = localePath(locale, location.pathname);
  const contentIsFresh = freshKey === routeKey;

  if (isAdmin) {
    return (
      <>
        <SeoHead pathname={seoPath} />
        {loaderVisible && <RouteFallback mode="admin" />}
        <Suspense fallback={null}>
          {contentIsFresh && (
            <>
              <AdminApp />
              <RouteCommit routeKey={routeKey} onReady={markRouteReady} />
            </>
          )}
        </Suspense>
      </>
    );
  }

  /* The outgoing page is not retained or cross-faded. The destination mounts
     only with fresh content; a single cover appears only when that real wait
     outlives the connection-aware threshold. */
  return (
    <>
      <SeoHead pathname={seoPath} />
      <Layout>
        {loaderVisible && <RouteFallback />}
        <main
          key={routeKey}
          aria-hidden={loaderVisible ? 'true' : undefined}
          inert={loaderVisible ? true : undefined}
        >
          <Suspense fallback={null}>
            {contentIsFresh && (
              <>
                <PublicRoutes />
                <RouteCommit routeKey={routeKey} onReady={markRouteReady} />
              </>
            )}
          </Suspense>
        </main>
      </Layout>
    </>
  );
}

export default function App() {
  /* Persian lives at the site root and English/Arabic under /en and /ar.
     Handing the prefix to the router as a `basename` means every <Link to="…">
     in the app stays locale-relative with no changes to the page components. */
  const { meta } = useLocale();
  return (
    /* React Router normally marks history updates as transitions, which may
       retain an already-painted route while a new lazy boundary suspends. Our
       own opaque gate must commit immediately and the outgoing page must not
       remain as a hidden second layer, so history updates are synchronous. */
    <BrowserRouter basename={meta.prefix || undefined} useTransitions={false}>
      <NavigationRoutes />
    </BrowserRouter>
  );
}
