import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { m as mo } from 'framer-motion';
import { Icons, faNum } from '../components/ui';
import { useContent } from '../content/ContentContext';
import { useShop } from './ShopContext';

/* ---------------- quantity stepper ---------------- */
export function QtyStepper({ value, onChange, max = 999, min = 1 }) {
  return (
    <div className="qty-stepper">
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label="افزایش">
        +
      </button>
      <span>{faNum(value)}</span>
      <button type="button" onClick={() => onChange(value - 1)} disabled={value <= min} aria-label="کاهش">
        −
      </button>
    </div>
  );
}

/* ---------------- shop product card ---------------- */
export function ShopCard({ p, index = 0 }) {
  const { t, brands } = useContent();
  const { add, money } = useShop();
  const [added, setAdded] = useState(false);
  const out = Number(p.stock) === 0;
  const low = Number(p.stock) > 0 && Number(p.stock) <= 10;
  const off = p.oldPrice && Number(p.oldPrice) > Number(p.price)
    ? Math.round((1 - Number(p.price) / Number(p.oldPrice)) * 100)
    : 0;
  const brand = brands.find((b) => b.id === p.brand);

  useEffect(() => {
    if (!added) return undefined;
    const id = setTimeout(() => setAdded(false), 1600);
    return () => clearTimeout(id);
  }, [added]);

  return (
    <mo.article
      className="shop-card"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.94 }}
      transition={{ duration: 0.5, delay: Math.min(index * 0.07, 0.45), ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="shop-card__img">
        <Link to={`/shop/${p.slug}`} aria-label={p.title}>
          <img src={p.image} alt={p.title} loading="lazy" />
        </Link>
        <div className="shop-card__badges">
          {off > 0 && <span className="badge-off">{faNum(off)}٪ {t('shop.card.off')}</span>}
          {p.featured && (
            <span className="badge-featured">
              <Icons.star size={12} />
              {t('shop.card.featured')}
            </span>
          )}
        </div>
        <span className={`shop-card__stock ${out ? 'is-out' : low ? 'is-low' : ''}`}>
          {out ? t('shop.card.outOfStock') : low ? t('shop.card.lowStock') : t('shop.card.inStock')}
        </span>
      </div>
      <div className="shop-card__body">
        <div className="shop-card__meta">
          {brand && <span className="shop-card__brand">{brand.en}</span>}
          {p.unit && <span className="shop-card__unit">{p.unit}</span>}
        </div>
        <h3 className="shop-card__title">
          <Link to={`/shop/${p.slug}`}>{p.title}</Link>
        </h3>
        <div className="shop-card__spacer" />
        <div className="shop-card__price">
          <span className="now">{money(p.price)}</span>
          {off > 0 && <span className="was">{money(p.oldPrice)}</span>}
        </div>
        <div className="shop-card__actions">
          <Link to={`/shop/${p.slug}`} className="btn btn--outline btn--sm">
            {t('shop.card.view')}
            <Icons.arrow size={15} />
          </Link>
          <button
            type="button"
            className={`btn btn--primary btn--sm${added ? ' is-added' : ''}`}
            disabled={out}
            onClick={() => add(p.slug, 1) && setAdded(true)}
            title={added ? t('shop.card.added') : t('shop.card.add')}
            aria-label={`${added ? t('shop.card.added') : t('shop.card.add')} — ${p.title}`}
            aria-live="polite"
          >
            {added ? (
              <>
                <Icons.check size={17} className="confirm-icon" />
                {t('shop.card.added')}
              </>
            ) : (
              <>
                <Icons.cart size={17} />
                {t('shop.card.add')}
              </>
            )}
          </button>
        </div>
      </div>
    </mo.article>
  );
}
