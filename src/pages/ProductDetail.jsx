import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AnimatePresence, m as mo } from 'framer-motion';
import { Icons, Reveal, SectionHead, CTABand, hl } from '../components/ui';
import { ProductCard } from '../components/cards';
import { useContent } from '../content/ContentContext';
import { useLocale } from '../i18n/LocaleContext';
import NotFound from './NotFound';
import ProductGallery from '../components/ProductGallery';

export default function ProductDetail() {
  const { slug } = useParams();
  const { t, l, products, brands } = useContent();
  const { shopEnabled } = useLocale();
  const [tab, setTab] = useState('usage');

  const product = products.find((p) => p.slug === slug);
  if (!product) return <NotFound />;
  const brand = brands.find((b) => b.id === product.brand);

  /* Same brand first. Someone looking at a 500g دزمایه is far more likely to
     want the other دزمایه sizes than a different brand entirely, and the
     catalogue order alone used to bury them. Within each group the catalogue
     order is kept, so the admin's ordering still decides ties. */
  const related = [...products.filter((p) => p.slug !== product.slug)]
    .sort((a, b) => Number(b.brand === product.brand) - Number(a.brand === product.brand))
    .slice(0, 4);

  const TABS = [
    { id: 'usage', label: t('product.tab.usage') },
    { id: 'analysis', label: t('product.tab.analysis') },
    { id: 'storage', label: t('product.tab.storage') },
  ];

  return (
    <>
      <section className="section section--nav-offset catalog-detail">
        <div className="container">
          <Reveal as="nav" className="breadcrumb catalog-detail__breadcrumb" aria-label={t('nav.breadcrumb.home')}>
            <Link to="/">{t('nav.breadcrumb.home')}</Link>
            <span className="sep">/</span>
            <Link to="/products">{t('nav.products')}</Link>
            <span className="sep">/</span>
            <span>{product.title}</span>
          </Reveal>

          <div className="split detail-layout catalog-detail__layout">
            <Reveal className="catalog-detail__media" x={40} y={0}>
              <ProductGallery
                images={product.images}
                primary={product.image}
                title={product.title}
                stageClassName="gallery-img gallery-img--square catalog-detail__gallery"
                sizes="(max-width: 920px) 100vw, 46vw"
                eager
              />
            </Reveal>

            <Reveal className="catalog-detail__copy" x={-40} y={0} delay={0.1}>
              <span className="overline">
                {brand?.fa} · {brand?.en}
              </span>
              <h1 className="section-title catalog-detail__title">{product.title}</h1>
              <p className="catalog-detail__lead">{product.short}</p>

              <div className="chip-row catalog-detail__chips">
                <span className="filter-chip is-active">{product.weight}</span>
                <span className="filter-chip is-active">{product.pack}</span>
                <span className="filter-chip">{t('product.chipShelf')}</span>
              </div>

              <div className="card data-card detail-spec catalog-detail__spec">
                <table className="spec-table">
                  <tbody>
                    {(product.specs || []).map(([k, v]) => (
                      <tr key={k}>
                        <th>{k}</th>
                        <td>{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="button-row catalog-detail__actions">
                <a className="btn btn--primary" href={l('sales.tel')}>
                  <Icons.phone size={18} />
                  {t('product.btnOrder')}
                </a>
                {/* The shop exists on the Persian site only, so this button
                    follows the same gate the navigation uses rather than a
                    second rule that could drift away from it. */}
                {shopEnabled && (
                  <Link className="btn btn--primary" to="/shop">
                    <Icons.store size={18} />
                    {t('product.btnShop')}
                  </Link>
                )}
                <a className="btn btn--outline" href={l('sales.whatsapp')} target="_blank" rel="noreferrer">
                  <Icons.whatsapp size={18} />
                  {t('product.btnWhatsapp')}
                </a>
                <Link className="btn btn--soft" to="/contact">
                  {t('product.btnSample')}
                </Link>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      <section className="section section--soft section--compact catalog-detail-tabs">
        <div className="container container--narrow">
          <Reveal>
            <div className="tabs catalog-detail-tabs__nav">
              {TABS.map((tb) => (
                <button key={tb.id} className={`tab ${tab === tb.id ? 'is-active' : ''}`} onClick={() => setTab(tb.id)}>
                  {tb.label}
                </button>
              ))}
            </div>
          </Reveal>

          <AnimatePresence mode="wait">
            <mo.div
              key={tab}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="card data-card data-card--panel catalog-detail-tabs__panel"
            >
              {tab === 'usage' && (
                <>
                  <h2>{t('product.usageTitle')}</h2>
                  <ol className="catalog-detail-tabs__list">
                    {(product.usage || []).map((u) => (
                      <li key={u}>{u}</li>
                    ))}
                  </ol>
                </>
              )}
              {tab === 'analysis' && (
                <table className="spec-table">
                  <tbody>
                    {(product.analysis || []).map(([k, v]) => (
                      <tr key={k}>
                        <th>{k}</th>
                        <td>{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {tab === 'storage' && (
                <ul className="catalog-detail-tabs__list">
                  {(product.storage || []).map((u) => (
                    <li key={u}>{u}</li>
                  ))}
                </ul>
              )}
            </mo.div>
          </AnimatePresence>
        </div>
      </section>

      <section className="section catalog-related">
        <div className="container">
          <SectionHead title={hl(t('product.related'))} align="start" />
          <div className="products-grid">
            {related.map((p, i) => (
              <ProductCard key={p.slug} product={p} index={i} />
            ))}
          </div>
        </div>
      </section>
      <CTABand />
    </>
  );
}
