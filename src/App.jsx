import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import Layout from './components/Layout';
import Home from './pages/Home';
import About from './pages/About';
import Products from './pages/Products';
import ProductDetail from './pages/ProductDetail';
import Export from './pages/Export';
import Quality from './pages/Quality';
import Blog from './pages/Blog';
import PostDetail from './pages/PostDetail';
import Contact from './pages/Contact';
import NotFound from './pages/NotFound';
import Shop from './pages/Shop';
import ShopProduct from './pages/ShopProduct';
import ShopCart from './pages/ShopCart';
import ShopCheckout from './pages/ShopCheckout';
import ShopOrder from './pages/ShopOrder';

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

function AnimatedRoutes() {
  const location = useLocation();
  const isAdmin = location.pathname.startsWith('/admin');

  useEffect(() => {
    document.title = 'شرکت خمیر مایه خوزستان | از مغز گندم؛ تا اولین برش نان';
  }, [location.pathname]);

  if (isAdmin) {
    return (
      <Suspense fallback={<div style={{ minHeight: '100svh', display: 'grid', placeItems: 'center' }}>…</div>}>
        <AdminApp />
      </Suspense>
    );
  }

  return (
    <AnimatePresence mode="wait">
      <motion.main
        key={location.pathname}
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -14 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        <Layout>
          <PublicRoutes />
        </Layout>
      </motion.main>
    </AnimatePresence>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AnimatedRoutes />
    </BrowserRouter>
  );
}
