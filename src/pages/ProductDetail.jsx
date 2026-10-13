import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AnimatePresence, m as mo } from 'framer-motion';
import { Icons, Reveal, CTABand, hl } from '../components/ui';
import { ProductCard } from '../components/cards';
import { useContent } from '../content/ContentContext';
import { useLocale } from '../i18n/LocaleContext';
import { usePageMeta } from '../hooks/usePageMeta';
import NotFound from './NotFound';
import { imgProps, SIZES } from '../lib/img';

export default function ProductDetail() {
  const { slug } = useParams();
  const { t, l, products, brands } = useContent();
  const { shopEnabled } = useLocale();
  const [tab, setTab] = useState('usage');

  const product = products.find((p) => p.slug === slug);
  /* Hooks must run unconditionally, so this sits above the early return. */
  usePageMeta(
    product ? `${product.title} | ${t('global.company.name')}` : '',
    product ? String(product.summary || product.desc || '').slice(0, 160) : ''
  );
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
      <section className="section" style={{ paddingTop: 'calc(var(--nav-h) + 80px)' }}>
        <div className="container">
          <Reveal className="breadcrumb">
            <Link to="/">{t('nav.breadcrumb.home')}</Link>
            <span className="sep">/</span>
            <Link to="/products">{t('nav.products')}</Link>
            <span className="sep">/</span>
            <span>{product.title}</span>
          </Reveal>

          <div className="split" style={{ marginTop: 30 }}>
            <Reveal x={40} y={0}>
              <div
                className="gallery-img gallery-img--square"
                style={{ background: 'radial-gradient(90% 90% at 50% 35%, #fff 30%, var(--bg-softer))' }}
              >
                {/* Square to match the 1:1 source: the old fixed 440px height
                    with `cover` cropped the top and bottom off the packaging. */}
                <img {...imgProps(product.image, SIZES.detail)} alt={product.title} width={720} height={720} loading="lazy" />
              </div>
            </Reveal>

            <Reveal x={-40} y={0} delay={0.1}>
              <span className="overline">
                {brand?.fa} · {brand?.en}
              </span>
              <h1 className="section-title" style={{ fontSize: 'clamp(26px, 3.4vw, 40px)' }}>
                {product.title}
              </h1>
              <p style={{ color: 'var(--muted)', fontSize: 16 }}>{product.short}</p>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '18px 0 26px' }}>
                <span className="filter-chip is-active">{product.weight}</span>
                <span className="filter-chip is-active">{product.pack}</span>
                <span className="filter-chip">{t('product.chipShelf')}</span>
              </div>

              <div className="card" style={{ overflow: 'hidden', marginBottom: 26 }}>
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

              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
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
                <Link
                  className="btn btn--ghost"
                  style={{ background: 'var(--bg-soft)', color: 'var(--crimson-700)', border: 'none' }}
                  to="/contact"
                >
                  {t('product.btnSample')}
                </Link>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      <section className="section section--soft">
        <div className="container" style={{ maxWidth: 980 }}>
          <Reveal>
            <div className="tabs">
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
              className="card"
              style={{ padding: '34px 36px' }}
            >
              {tab === 'usage' && (
                <>
                  <h2 style={{ marginTop: 0, fontSize: '1.17em', fontWeight: 700 }}>{t('product.usageTitle')}</h2>
                  <ol style={{ color: 'var(--ink-2)', lineHeight: 2.3, paddingInlineStart: 22, margin: 0 }}>
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
                <ul style={{ color: 'var(--ink-2)', lineHeight: 2.3, paddingInlineStart: 22, margin: 0 }}>
                  {(product.storage || []).map((u) => (
                    <li key={u}>{u}</li>
                  ))}
                </ul>
              )}
            </mo.div>
          </AnimatePresence>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <Reveal className="section-head">
            <h2 className="section-title">{hl(t('product.related'))}</h2>
          </Reveal>
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
