import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BrowserRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import RouteFallback from './components/RouteFallback';
import { useLocale, LOCALES, localePath } from './i18n/LocaleContext';
import { useContent } from './content/ContentContext';
import { dismissBootSplash } from './lib/bootSplash';
import Home from './pages/Home'; // landing page stays in the main bundle

/* ---------------------------------------------------------------------------
   Route-level code splitting: every page ships as its own chunk and starts
   loading only after the visitor asks for it. There is deliberately no idle,
   hover, neighbour, or route-warm prefetch layer; every navigation owns an
   explicit loading-screen phase instead of silently filling a route cache.
   --------------------------------------------------------------------------- */
const About = lazy(() => import('./pages/About'));
const Products = lazy(() => import('./pages/Products'));
const ProductDetail = lazy(() => import('./pages/ProductDetail'));
const Export = lazy(() => import('./pages/Export'));
const Quality = lazy(() => import('./pages/Quality'));
const Blog = lazy(() => import('./pages/Blog'));
const PostDetail = lazy(() => import('./pages/PostDetail'));
const Contact = lazy(() => import('./pages/Contact'));
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

/* Mounted inside each Suspense boundary, after the active route has resolved.
   It dismisses first paint and tells the navigation gate that the new page is
   genuinely ready. A keyed effect runs even when React.lazy already holds the
   module in memory, so cached revisits still receive the loading screen. */
function RouteCommit({ routeKey, onReady }) {
  useEffect(() => {
    dismissBootSplash();
    onReady(routeKey);
  }, [routeKey, onReady]);
  return null;
}

function PublicRoutes() {
  /* The online shop is an Iran-facing feature (rial pricing, Iranian payment
     gateway), so it exists on the Persian site only. On /en and /ar its routes
     are simply not mounted and fall through to the 404 page. */
  const { shopEnabled } = useLocale();
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/about" element={<About />} />
      <Route path="/products" element={<Products />} />
      <Route path="/products/:slug" element={<ProductDetail />} />
      {shopEnabled && (
        <>
          <Route path="/shop" element={<Shop />} />
          <Route path="/shop/cart" element={<ShopCart />} />
          <Route path="/shop/checkout" element={<ShopCheckout />} />
          <Route path="/shop/order/:code" element={<ShopOrder />} />
          <Route path="/shop/login" element={<ShopAuth />} />
          <Route path="/shop/account" element={<ShopAccount />} />
          <Route path="/shop/:slug" element={<ShopProduct />} />
        </>
      )}
      <Route path="/export" element={<Export />} />
      <Route path="/quality" element={<Quality />} />
      <Route path="/blog" element={<Blog />} />
      <Route path="/blog/:slug" element={<PostDetail />} />
      <Route path="/contact" element={<Contact />} />
      <Route path="/dezmaye" element={<Navigate to="/products/dezmaye-gold-80" replace />} />
      <Route path="/shetab" element={<Navigate to="/products/shetab-90" replace />} />
      <Route path="/xpower" element={<Navigate to="/products/xpower-70" replace />} />
      <Route path="/nanmaye" element={<Navigate to="/products/nanmaye-10" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

/* Routes whose <title> is set by the page itself (from the product or post it
   loaded), so the app-level effect must leave it alone. */
const HAS_OWN_TITLE = /^\/(products|blog|shop)\/[^/]+$/;
const NAVIGATION_BEAT_MS = 420;

function NavigationRoutes() {
  const location = useLocation();
  const isAdmin = location.pathname.startsWith('/admin');
  const { t } = useContent();
  const { locale } = useLocale();
  const routeKey = `${location.key || 'route'}:${location.pathname}${location.search}`;
  const [settledKey, setSettledKey] = useState(routeKey);
  const activeKey = useRef(routeKey);
  const settledKeyRef = useRef(settledKey);
  const started = useRef({ key: routeKey, at: 0 });
  const finishTimer = useRef(0);
  activeKey.current = routeKey;
  settledKeyRef.current = settledKey;
  const transitioning = routeKey !== settledKey;
  /* On a direct visit the static splash already owns first-paint feedback.
     Keeping React's fallback empty beneath it avoids two simultaneous live
     status announcements; subsequent Suspense waits use the orbital screen. */
  const bootSplashPresent = typeof document !== 'undefined' && document.getElementById('boot-splash');

  /* Start immediately on every history navigation, including revisits whose
     module is already held by React.lazy/the browser. The page renders under
     this screen so a cold chunk and a cached chunk follow the same path. */
  useLayoutEffect(() => {
    if (routeKey === settledKeyRef.current) return undefined;
    window.clearTimeout(finishTimer.current);
    started.current = { key: routeKey, at: performance.now() };
    return () => window.clearTimeout(finishTimer.current);
  }, [routeKey]);

  const markRouteReady = useCallback((key) => {
    if (key !== activeKey.current || key === settledKeyRef.current) return;
    const beganAt = started.current.key === key ? started.current.at : performance.now();
    const elapsed = performance.now() - beganAt;
    const remaining = Math.max(0, NAVIGATION_BEAT_MS - elapsed);
    window.clearTimeout(finishTimer.current);
    finishTimer.current = window.setTimeout(() => {
      if (activeKey.current === key) setSettledKey(key);
    }, remaining);
  }, []);

  useEffect(() => () => window.clearTimeout(finishTimer.current), []);

  /* Title, description, canonical and hreflang alternates per locale — search
     engines see three properly-linked language versions of every page. */
  /* Per-page <title> and description. Every page previously shared the site
     title, so search results listed a dozen identical entries and neither
     users nor crawlers could tell them apart. Each key already exists in all
     three languages, so the titles translate with the rest of the site. */
  useEffect(() => {
    const HERO_KEY = {
      '/': 'home.hero.title',
      '/about': 'about.hero.title',
      '/products': 'products.hero.title',
      '/export': 'export.hero.title',
      '/quality': 'quality.hero.title',
      '/blog': 'blog.hero.title',
      '/contact': 'contact.hero.title',
      '/shop': 'shop.hero.title',
    };
    const site = t('global.company.name');
    const key = HERO_KEY[location.pathname];
    /* Strip the [[…]] highlight markers used by the visual headings. */
    const plain = (s) => String(s || '').replace(/\[\[(.+?)\]\]/g, '$1').trim();
    const pageTitle = key ? plain(t(key)) : '';
    /* Detail pages (product, post) set their own title from the entity via
       usePageMeta. React runs child effects BEFORE parent effects, so writing
       document.title unconditionally here would clobber theirs on every
       render. Only claim the title for routes this table actually knows. */
    const ownsTitle = key || !HAS_OWN_TITLE.test(location.pathname);
    if (ownsTitle) {
      document.title =
        location.pathname === '/' || !pageTitle
          ? `${site} | ${plain(t('global.slogan'))}`
          : `${pageTitle} | ${site}`;
    }

    const setMeta = (attr, key, content) => {
      let el = document.head.querySelector(`meta[${attr}="${key}"]`);
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.setAttribute('content', content);
    };

    const desc = `${t('footer.about')} ${t('global.slogan')}`.trim();
    setMeta('name', 'description', desc);
    setMeta('property', 'og:title', t('global.company.name'));
    setMeta('property', 'og:description', t('global.slogan'));
    setMeta('property', 'og:locale', { fa: 'fa_IR', en: 'en_US', ar: 'ar_AE' }[locale] || 'fa_IR');

    const path = location.pathname; // already locale-relative thanks to basename
    document.head.querySelectorAll('link[data-i18n-alt]').forEach((n) => n.remove());
    const add = (rel, href, hreflang) => {
      const link = document.createElement('link');
      link.rel = rel;
      link.href = href;
      if (hreflang) link.hreflang = hreflang;
      link.setAttribute('data-i18n-alt', '');
      document.head.appendChild(link);
    };
    /* Canonical and hreflang must be absolute URLs — Google ignores relative
       hreflang values, which meant the three language versions were never
       actually linked to each other. */
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const url = (code) => `${origin}${localePath(code, path)}`;
    add('canonical', url(locale));
    LOCALES.forEach((lo) => add('alternate', url(lo.code), lo.htmlLang));
    add('alternate', url('fa'), 'x-default');
  }, [location.pathname, locale, t]);

  if (isAdmin) {
    return (
      <>
        {transitioning && <RouteFallback mode="admin" />}
        <Suspense
          fallback={transitioning || bootSplashPresent ? null : <RouteFallback mode="admin" />}
        >
          <AdminApp />
          <RouteCommit routeKey={routeKey} onReady={markRouteReady} />
        </Suspense>
      </>
    );
  }

  /* The outgoing page leaves immediately. A single opaque loading layer then
     covers the new route until both conditions are true: its Suspense content
     committed, and the orbital screen completed a short readable beat. There
     is never a two-page cross-fade or a stale page retained underneath. */
  return (
    <Layout>
      {transitioning && <RouteFallback />}
      <main
        key={location.pathname}
        aria-hidden={transitioning ? 'true' : undefined}
        inert={transitioning ? true : undefined}
      >
        <Suspense
          fallback={transitioning || bootSplashPresent ? null : <RouteFallback />}
        >
          <PublicRoutes />
          <RouteCommit routeKey={routeKey} onReady={markRouteReady} />
        </Suspense>
      </main>
    </Layout>
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
