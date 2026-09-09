import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import Layout from './components/Layout';
import RouteFallback from './components/RouteFallback';
import { usePrefetchRoutes, prefetch } from './routes';
import { useLocale, LOCALES, localePath } from './i18n/LocaleContext';
import { useContent } from './content/ContentContext';
import Home from './pages/Home'; // landing page stays in the main bundle

/* ---------------------------------------------------------------------------
   Route-level code splitting: every page ships as its own chunk, so a visitor
   on a slow connection downloads only the page they asked for. Chunks are
   prefetched on idle / on link hover (see src/routes.js), which makes the
   navigation itself feel instant once the browser is idle.
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

/* The admin panel is intentionally NOT linked anywhere on the public site.
   It is reachable only by typing its address directly. */
const AdminApp = lazy(() => import('./admin/AdminApp'));

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

/* Route transition easing — mirrors --ease-out in src/styles/global.scss so
   JS-driven page transitions and CSS transitions share one curve. */
const EASE_OUT = [0.16, 1, 0.3, 1];

/* Routes whose <title> is set by the page itself (from the product or post it
   loaded), so the app-level effect must leave it alone. */
const HAS_OWN_TITLE = /^\/(products|blog|shop)\/[^/]+$/;

function AnimatedRoutes() {
  const location = useLocation();
  const isAdmin = location.pathname.startsWith('/admin');
  const { t } = useContent();
  const { locale } = useLocale();
  usePrefetchRoutes();

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

  useEffect(() => {
    prefetch(location.pathname); // warm neighbours of the current page
  }, [location.pathname]);

  if (isAdmin) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <AdminApp />
      </Suspense>
    );
  }

  /* `mode="popLayout"` lets the incoming page render immediately instead of
     waiting for the outgoing one to finish animating (that wait used to cost
     ~450 ms on every navigation, on top of the network time). */
  return (
    <Layout>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.main
          key={location.pathname}
          /* Short, compositor-only (opacity + transform) and asymmetric: the
             outgoing page leaves faster than the incoming one arrives, which
             reads as responsive rather than sluggish. */
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.26, ease: EASE_OUT }}
        >
          <Suspense fallback={<RouteFallback />}>
            <PublicRoutes />
          </Suspense>
        </motion.main>
      </AnimatePresence>
    </Layout>
  );
}

export default function App() {
  /* Persian lives at the site root and English/Arabic under /en and /ar.
     Handing the prefix to the router as a `basename` means every <Link to="…">
     in the app stays locale-relative with no changes to the page components. */
  const { meta } = useLocale();
  return (
    <BrowserRouter basename={meta.prefix || undefined}>
      <AnimatedRoutes />
    </BrowserRouter>
  );
}
