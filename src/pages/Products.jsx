import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Icons, Reveal, PageHero, CTABand } from '../components/ui';
import { ProductCard } from '../components/cards';
import { BRANDS, PRODUCTS } from '../data/products';

export default function Products() {
  const [params, setParams] = useSearchParams();
  const active = params.get('brand') || 'all';

  const setFilter = (id) => {
    if (id === 'all') params.delete('brand');
    else params.set('brand', id);
    setParams(params, { replace: true });
  };

  const list = active === 'all' ? PRODUCTS : PRODUCTS.filter((p) => p.brand === active);

  return (
    <>
      <PageHero
        title="محصولات خمیرمایه خوزستان"
        sub="همه محصولات خمیرمایه خشک فوری با برندهای دزمایه، شتاب، ایکس پاور و نان مایه؛ از ساشه ۷۰ گرمی تا کیسه صادراتی ۲۰ کیلوگرمی."
        image="/assets/img/bread-slicing.jpg"
      />

      <section className="section">
        <div className="container">
          <Reveal className="filter-bar">
            <button className={`filter-chip ${active === 'all' ? 'is-active' : ''}`} onClick={() => setFilter('all')}>
              همه محصولات
            </button>
            {BRANDS.map((b) => (
              <button
                key={b.id}
                className={`filter-chip ${active === b.id ? 'is-active' : ''}`}
                onClick={() => setFilter(b.id)}
              >
                {b.fa} ({b.en})
              </button>
            ))}
          </Reveal>

          <motion.div
            className="products-grid"
            key={active}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            <AnimatePresence mode="popLayout">
              {list.map((p, i) => (
                <ProductCard key={p.slug} product={p} index={i} />
              ))}
            </AnimatePresence>
          </motion.div>

          <Reveal className="mt-56">
            <div className="cta-band">
              <div>
                <h2>دانلود کاتالوگ جامع محصولات</h2>
                <p>
                  برای دریافت مشخصات فنی، آنالیز آزمایشگاهی و شرایط نگهداری، کاتالوگ رسمی شرکت را از
                  واحد بازرگانی درخواست کنید.
                </p>
              </div>
              <div className="cta-band__actions">
                <Link to="/contact" className="btn btn--light">
                  درخواست کاتالوگ و نمونه
                  <Icons.arrow size={18} />
                </Link>
                <a className="btn btn--ghost" href="tel:02186086267">
                  <Icons.phone size={18} />
                  تماس با واحد فروش
                </a>
              </div>
            </div>
          </Reveal>
        </div>
      </section>
      <CTABand />
    </>
  );
}
