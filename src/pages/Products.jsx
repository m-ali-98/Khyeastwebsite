import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence, m as mo } from 'framer-motion';
import { Icons, Reveal, PageHero } from '../components/ui';
import { ProductCard } from '../components/cards';
import { useContent } from '../content/ContentContext';

export default function Products() {
  const [params, setParams] = useSearchParams();
  const { t, m, products, brands, l } = useContent();
  const active = params.get('brand') || 'all';

  const setFilter = (id) => {
    const next = new URLSearchParams(params);
    if (id === 'all') next.delete('brand');
    else next.set('brand', id);
    /* This is an in-page collection update, not a destination change. Keeping
       the current scroll position also prevents the mobile list from jumping
       when the new result set is shorter than the previous one. */
    setParams(next, { replace: true, preventScrollReset: true });
  };

  const list = active === 'all' ? products : products.filter((p) => p.brand === active);

  return (
    <>
      <PageHero className="products-hero" title={t('products.hero.title')} sub={t('products.hero.sub')} image={m('products.hero.img')} />

      <section className="section products-index">
        <div className="container">
          <Reveal className="filter-bar products-filter" role="group" aria-label={t('products.hero.title')}>
            <button
              type="button"
              className={`filter-chip ${active === 'all' ? 'is-active' : ''}`}
              aria-pressed={active === 'all'}
              onClick={() => setFilter('all')}
            >
              {t('products.filter.all')}
            </button>
            {brands.map((b) => (
              <button
                key={b.id}
                type="button"
                className={`filter-chip ${active === b.id ? 'is-active' : ''}`}
                aria-pressed={active === b.id}
                onClick={() => setFilter(b.id)}
              >
                {b.fa} ({b.en})
              </button>
            ))}
          </Reveal>

          <mo.div
            className="products-grid products-catalog-grid"
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
          </mo.div>

          <Reveal className="section-break products-index__cta">
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
    </>
  );
}
