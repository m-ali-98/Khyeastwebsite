import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import Layout from './components/Layout';
import RouteFallback from './components/RouteFallback';
import { usePrefetchRoutes, prefetch } from './routes';
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
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/about" element={<About />} />
      <Route path="/products" element={<Products />} />
      <Route path="/products/:slug" element={<ProductDetail />} />
      <Route path="/shop" element={<Shop />} />
      <Route path="/shop/cart" element={<ShopCart />} />
      <Route path="/shop/checkout" element={<ShopCheckout />} />
      <Route path="/shop/order/:code" element={<ShopOrder />} />
      <Route path="/shop/:slug" element={<ShopProduct />} />
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

/* Slow links / data-saver / reduced-motion visitors get a plain fade with no
   movement and no exit delay — the page swaps as soon as its chunk lands. */
function useLightMotion() {
  if (typeof window === 'undefined') return false;
  const conn = navigator.connection || {};
  const slow = conn.saveData === true || /(^|-)2g$/.test(conn.effectiveType || '');
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  return Boolean(slow || reduced);
}

function AnimatedRoutes() {
  const location = useLocation();
  const isAdmin = location.pathname.startsWith('/admin');
  const light = useLightMotion();
  usePrefetchRoutes();

  useEffect(() => {
    document.title = 'شرکت خمیر مایه خوزستان | از مغز گندم؛ تا اولین برش نان';
  }, [location.pathname]);

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
          initial={light ? { opacity: 0 } : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={light ? { opacity: 0 } : { opacity: 0, y: -8 }}
          transition={{ duration: light ? 0.12 : 0.28, ease: [0.22, 1, 0.36, 1] }}
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
  return (
    <BrowserRouter>
      <AnimatedRoutes />
    </BrowserRouter>
  );
}
