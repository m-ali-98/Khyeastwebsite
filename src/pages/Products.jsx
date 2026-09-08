import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Icons, Reveal, PageHero, CTABand } from '../components/ui';
import { ProductCard } from '../components/cards';
import { useContent } from '../content/ContentContext';

export default function Products() {
  const [params, setParams] = useSearchParams();
  const { t, m, products, brands, l } = useContent();
  const active = params.get('brand') || 'all';

  const setFilter = (id) => {
    if (id === 'all') params.delete('brand');
    else params.set('brand', id);
    setParams(params, { replace: true });
  };

  const list = active === 'all' ? products : products.filter((p) => p.brand === active);

  return (
    <>
      <PageHero title={t('products.hero.title')} sub={t('products.hero.sub')} image={m('products.hero.img')} />

      <section className="section">
        <div className="container">
          <Reveal className="filter-bar">
            <button className={`filter-chip ${active === 'all' ? 'is-active' : ''}`} onClick={() => setFilter('all')}>
              {t('products.filter.all')}
            </button>
            {brands.map((b) => (
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
                <h2>{t('products.catalog.title')}</h2>
                <p>{t('products.catalog.text')}</p>
              </div>
              <div className="cta-band__actions">
                <Link to="/contact" className="btn btn--light">
                  {t('products.catalog.btn')}
                  <Icons.arrow size={18} />
                </Link>
                <a className="btn btn--ghost" href={l('sales.tel')}>
                  <Icons.phone size={18} />
                  {t('products.catalog.btnPhone')}
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
