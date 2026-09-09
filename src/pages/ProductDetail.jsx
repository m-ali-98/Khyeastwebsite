import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Icons, Reveal, CTABand, hl } from '../components/ui';
import { ProductCard } from '../components/cards';
import { useContent } from '../content/ContentContext';
import NotFound from './NotFound';
import SmartImage from '../components/SmartImage';

export default function ProductDetail() {
  const { slug } = useParams();
  const { t, l, products, brands } = useContent();
  const [tab, setTab] = useState('usage');

  const product = products.find((p) => p.slug === slug);
  if (!product) return <NotFound />;
  const brand = brands.find((b) => b.id === product.brand);
  const related = products.filter((p) => p.slug !== product.slug).slice(0, 4);

  const TABS = [
    { id: 'usage', label: t('product.tab.usage') },
    { id: 'analysis', label: t('product.tab.analysis') },
    { id: 'storage', label: t('product.tab.storage') },
  ];

  return (
    <>
      <section className="section" style={{ paddingTop: 'calc(var(--nav-h) + 80px)' }}>
        <div className="container">
          <Reveal className="breadcrumb" style={{ color: 'var(--muted)' }}>
            <Link to="/">{t('nav.breadcrumb.home')}</Link>
            <span className="sep" style={{ color: 'var(--crimson)' }}>/</span>
            <Link to="/products">{t('nav.products')}</Link>
            <span className="sep" style={{ color: 'var(--crimson)' }}>/</span>
            <span>{product.title}</span>
          </Reveal>

          <div className="split" style={{ marginTop: 30 }}>
            <Reveal x={40} y={0}>
              <motion.div
                className="gallery-img"
                style={{ background: 'radial-gradient(90% 90% at 50% 35%, #fff 30%, var(--bg-softer))' }}
                animate={{ y: [0, -12, 0] }}
                transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
              >
                <SmartImage src={product.image} alt={product.title} style={{ height: 440, objectFit: 'cover' }} />
              </motion.div>
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
            <motion.div
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
                  <h3 style={{ marginTop: 0 }}>{t('product.usageTitle')}</h3>
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
            </motion.div>
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
