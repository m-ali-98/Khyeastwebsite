import { useMemo, useState } from 'react';
import { Reveal, Icons, faNum, CTABand } from '../components/ui';
import { useContent } from '../content/ContentContext';
import { useShop } from '../shop/ShopContext';
import ShopShowcase from '../shop/ShopShowcase';
import { ShopCard as ShopProductCard } from '../shop/parts';
import '../styles/shop.scss';

const BRAND_LABEL = { dezmaye: 'دزمایه', shetab: 'شتاب', xpower: 'ایکس پاور', nanmaye: 'نان مایه' };
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

const normalizeSearch = (value) =>
  String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('fa-IR')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ةۀ]/g, 'ه')
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/[۰-۹]/g, (digit) => String(FA_DIGITS.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(AR_DIGITS.indexOf(digit)))
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const isOnSale = (product) => Number(product?.oldPrice) > Number(product?.price);

export default function Shop() {
  const { t, brands } = useContent();
  const { products, display } = useShop();
  const [brand, setBrand] = useState('all');
  const [sort, setSort] = useState('default');
  const [query, setQuery] = useState('');
  const [saleOnly, setSaleOnly] = useState(false);

  const activeProducts = useMemo(() => products.filter((product) => product.active), [products]);
  const shopBrands = useMemo(
    () => brands.filter((item) => activeProducts.some((product) => product.brand === item.id)),
    [activeProducts, brands],
  );
  const brandTerms = useMemo(
    () => Object.fromEntries(brands.map((item) => [item.id, [item.fa, item.en].filter(Boolean).join(' ')])),
    [brands],
  );
  const filteredProducts = useMemo(() => {
    const needle = normalizeSearch(query);
    let next = activeProducts.filter((product) => {
      if (brand !== 'all' && product.brand !== brand) return false;
      if (saleOnly && !isOnSale(product)) return false;
      if (!needle) return true;
      const searchable = normalizeSearch([
        product.title,
        product.short,
        product.unit,
        product.brand,
        brandTerms[product.brand],
        BRAND_LABEL[product.brand],
      ].filter(Boolean).join(' '));
      return searchable.includes(needle);
    });
    if (sort === 'cheap') next = [...next].sort((a, b) => Number(a.price) - Number(b.price));
    if (sort === 'expensive') next = [...next].sort((a, b) => Number(b.price) - Number(a.price));
    return next;
  }, [activeProducts, brand, brandTerms, query, saleOnly, sort]);

  const hasFilters = brand !== 'all' || saleOnly || Boolean(query.trim());
  const resetFilters = () => {
    setBrand('all');
    setSaleOnly(false);
    setQuery('');
  };
  const countText = (t('shop.results.count') || '{count} محصول نمایش داده می‌شود')
    .replace('{count}', faNum(filteredProducts.length));

  return (
    <>
      <ShopShowcase
        items={display.showcase}
        title={t('shop.hero.title')}
        sub={t('shop.hero.sub')}
      />

      <section className="shop-trust container" aria-label="مزایای خرید">
        {[
          [Icons.shield, t('shop.trust.guarantee')],
          [Icons.shipping, t('shop.trust.shipping')],
          [Icons.payment, t('shop.trust.payment')],
          [Icons.phone, t('shop.trust.support')],
        ].map(([Icon, label], index) => (
          <Reveal className="shop-trust__item" delay={index * 0.05} key={label}>
            <span className="ico"><Icon size={21} /></span>
            <span>{label}</span>
          </Reveal>
        ))}
      </section>

      <section className="section section--light shop-listing" id="shop-catalog">
        <div className="container">
          <Reveal className="shop-toolbar">
            <div className="shop-toolbar__intro">
              <span aria-hidden="true" />
              <div>
                <h2>{t('shop.filter.all')}</h2>
                <p aria-live="polite" aria-atomic="true">{countText}</p>
              </div>
            </div>

            <div className="filter-bar shop-filter" role="group" aria-label="فیلتر محصولات">
              {[
                ['all', t('shop.filter.all')],
                ...shopBrands.map((item) => [item.id, item.fa || item.en || BRAND_LABEL[item.id] || item.id]),
              ].map(([key, label]) => (
                <button
                  type="button"
                  key={key}
                  className={`filter-chip${brand === key ? ' is-active' : ''}`}
                  onClick={() => setBrand(key)}
                  aria-pressed={brand === key}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                className={`filter-chip shop-filter__sale${saleOnly ? ' is-active' : ''}`}
                onClick={() => setSaleOnly((value) => !value)}
                aria-pressed={saleOnly}
                data-testid="shop-sale-filter"
              >
                <Icons.discount size={17} />
                {t('shop.filter.sale')}
              </button>
            </div>

            <div className="shop-toolbar__tools">
              <label className="shop-search">
                <span className="sr-only">{t('shop.search.label')}</span>
                <Icons.search size={19} aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('shop.search.placeholder')}
                  autoComplete="off"
                  spellCheck="false"
                  data-testid="shop-search"
                />
                {query && (
                  <button type="button" onClick={() => setQuery('')} aria-label={t('shop.search.clear')}>
                    ×
                  </button>
                )}
              </label>
              <label className="shop-toolbar__sort">
                <span>{t('shop.sort.label')}</span>
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value)}
                  aria-label={t('shop.sort.label')}
                >
                  <option value="default">{t('shop.sort.default')}</option>
                  <option value="cheap">{t('shop.sort.cheap')}</option>
                  <option value="expensive">{t('shop.sort.expensive')}</option>
                </select>
              </label>
            </div>
          </Reveal>

          {activeProducts.length ? (
            <>
              {filteredProducts.length ? (
                <div className="shop-grid" data-testid="shop-product-grid">
                  {filteredProducts.map((product, index) => (
                    <ShopProductCard key={product.slug} p={product} index={index} />
                  ))}
                </div>
              ) : (
                <Reveal className="shop-empty shop-empty--filtered" role="status">
                  <span className="shop-empty__icon" aria-hidden="true"><Icons.search size={27} /></span>
                  <h3>{t('shop.results.emptyTitle')}</h3>
                  <p>{t('shop.results.emptyText')}</p>
                  {hasFilters && (
                    <button type="button" className="btn btn--outline" onClick={resetFilters}>
                      <Icons.refresh size={17} />
                      {t('shop.filter.reset')}
                    </button>
                  )}
                </Reveal>
              )}
            </>
          ) : (
            <Reveal className="shop-empty">
              <Icons.box size={52} />
              <p>{t('shop.empty')}</p>
            </Reveal>
          )}
        </div>
      </section>

      <CTABand />
    </>
  );
}
