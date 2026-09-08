import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Icons, Reveal, PageHero, CTABand } from '../components/ui';
import { useContent } from '../content/ContentContext';
import { useShop } from '../shop/ShopContext';
import { ShopCard } from '../shop/parts';

const TRUST = [
  { icon: 'shield', key: 'shop.trust.guarantee' },
  { icon: 'box', key: 'shop.trust.shipping' },
  { icon: 'check', key: 'shop.trust.payment' },
  { icon: 'phone', key: 'shop.trust.support' },
];

export default function Shop() {
  const { t, m, brands } = useContent();
  const { display, products } = useShop();
  const [brand, setBrand] = useState('all');
  const [sort, setSort] = useState('default');

  const enabled = display.enabled !== false;
  const list = useMemo(() => {
    let arr = products.filter((p) => p.active);
    if (brand !== 'all') arr = arr.filter((p) => p.brand === brand);
    if (sort === 'cheap') arr = [...arr].sort((a, b) => Number(a.price) - Number(b.price));
    if (sort === 'expensive') arr = [...arr].sort((a, b) => Number(b.price) - Number(a.price));
    return arr;
  }, [products, brand, sort]);

  const shopBrands = useMemo(
    () => brands.filter((b) => products.some((p) => p.active && p.brand === b.id)),
    [brands, products]
  );

  return (
    <>
      <PageHero title={t('shop.hero.title')} sub={t('shop.hero.sub')} image={m('shop.hero.img')} />

      <section className="section">
        <div className="container">
          <div className="shop-trust">
            {TRUST.map((item, i) => {
              const Ic = Icons[item.icon];
              return (
                <Reveal key={item.key} delay={i * 0.08} className="shop-trust__item">
                  <span className="ico">
                    <Ic size={21} />
                  </span>
                  <span>{t(item.key)}</span>
                </Reveal>
              );
            })}
          </div>

          {enabled && list.length > 0 && (
            <Reveal className="shop-toolbar">
              <div className="filter-bar">
                <button className={`filter-chip ${brand === 'all' ? 'is-active' : ''}`} onClick={() => setBrand('all')}>
                  {t('shop.filter.all')}
                </button>
                {shopBrands.map((b) => (
                  <button
                    key={b.id}
                    className={`filter-chip ${brand === b.id ? 'is-active' : ''}`}
                    onClick={() => setBrand(b.id)}
                  >
                    {b.fa} ({b.en})
                  </button>
                ))}
              </div>
              <div className="shop-toolbar__sort">
                <label htmlFor="shop-sort">{t('shop.sort.label')}:</label>
                <select id="shop-sort" value={sort} onChange={(e) => setSort(e.target.value)}>
                  <option value="default">{t('shop.sort.default')}</option>
                  <option value="cheap">{t('shop.sort.cheap')}</option>
                  <option value="expensive">{t('shop.sort.expensive')}</option>
                </select>
              </div>
            </Reveal>
          )}

          {enabled && list.length > 0 ? (
            <motion.div className="shop-grid" key={`${brand}-${sort}`}>
              <AnimatePresence mode="popLayout">
                {list.map((p, i) => (
                  <ShopCard key={p.slug} p={p} index={i} />
                ))}
              </AnimatePresence>
            </motion.div>
          ) : (
            <Reveal className="cart-empty">
              <span className="ico">
                <Icons.box size={40} />
              </span>
              <h2>{t('shop.empty')}</h2>
            </Reveal>
          )}
        </div>
      </section>

      <CTABand />
    </>
  );
}
