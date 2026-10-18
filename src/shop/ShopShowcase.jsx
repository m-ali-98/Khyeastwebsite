import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useContent } from '../content/ContentContext';
import { useLocale } from '../i18n/LocaleContext';
import { imgProps, SIZES } from '../lib/img';
import { Icons, Reveal } from '../components/ui';

const FALLBACK_SLIDE = {
  id: 'shop-showcase-fallback',
  image: '/assets/img/bread-slicing.webp',
  href: '/products',
  alt: 'برش نان تازه تهیه‌شده با خمیرمایه خوزستان',
};

const safeShowcaseHref = (value) => {
  const href = String(value || '').trim();
  if (/^\/(?!\/)/.test(href) || /^https?:\/\//i.test(href)) return href;
  return '';
};

function ShowcaseLink({ slide, active, children }) {
  const label = slide.alt;
  const focusProps = { 'aria-label': label, tabIndex: active ? undefined : -1 };
  if (/^\/(?!\/)/.test(slide.href)) {
    return (
      <Link className="shop-showcase__link" to={slide.href} {...focusProps}>
        {children}
      </Link>
    );
  }
  return (
    <a className="shop-showcase__link" href={slide.href} {...focusProps}>
      {children}
    </a>
  );
}

export default function ShopShowcase({ items, title, sub, crumb }) {
  const { t } = useContent();
  const { isRTL } = useLocale();
  const slides = useMemo(() => {
    const valid = (Array.isArray(items) ? items : [])
      .map((item, index) => ({
        id: String(item?.id || `shop-showcase-${index}`),
        image: String(item?.image || '').trim(),
        href: safeShowcaseHref(item?.href),
        alt: String(item?.alt || title || '').trim(),
      }))
      .filter((item) => item.image && item.href);
    return valid.length ? valid : [{ ...FALLBACK_SLIDE, alt: title || FALLBACK_SLIDE.alt }];
  }, [items, title]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    setActive((current) => Math.min(current, slides.length - 1));
  }, [slides.length]);

  const select = (index) => {
    const count = slides.length;
    setActive(((index % count) + count) % count);
  };
  const onKeyDown = (event) => {
    if (slides.length < 2 || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const visuallyForward = event.key === (isRTL ? 'ArrowLeft' : 'ArrowRight');
    select(active + (visuallyForward ? 1 : -1));
  };
  const goToLabel = (index) =>
    (t('shop.showcase.goTo') || 'نمایش تصویر {count}').replace('{count}', (index + 1).toLocaleString('fa-IR'));

  return (
    <header
      className="shop-showcase"
      data-testid="shop-showcase"
      aria-roledescription="اسلایدشو"
      onKeyDown={onKeyDown}
    >
      <div className="container shop-showcase__stage">
        <div className="shop-showcase__copy">
          <Reveal as="nav" className="breadcrumb" y={14} aria-label="مسیر صفحه">
            <Link to="/">{crumb || t('nav.breadcrumb.home')}</Link>
            <span className="sep">/</span>
            <span>{title}</span>
          </Reveal>

          <div className="shop-showcase__heading">
            <Reveal as="h1" delay={0.1} y={30}>{title}</Reveal>
            {sub && <Reveal as="p" delay={0.2} y={24}>{sub}</Reveal>}
          </div>

          <Reveal className="shop-showcase__actions" delay={0.3} y={18}>
            <a className="btn btn--primary" href="#shop-catalog">
              {t('shop.filter.all')}
              <Icons.arrow size={18} />
            </a>
            <Link className="btn btn--ghost" to="/shop/cart">
              <Icons.cart size={18} />
              {t('shop.cart.title')}
            </Link>
          </Reveal>
        </div>

        <div className="shop-showcase__media-shell">
          <div className="shop-showcase__frame">
            <div className="shop-showcase__viewport">
              <div className="shop-showcase__track" style={{ transform: `translate3d(${-active * 100}%, 0, 0)` }}>
                {slides.map((slide, index) => (
                  <div className="shop-showcase__slide" aria-hidden={index !== active} key={`${slide.id}-${index}`}>
                    <ShowcaseLink slide={slide} active={index === active}>
                      <img
                        {...imgProps(slide.image, SIZES.full)}
                        alt={slide.alt}
                        loading={index === 0 ? 'eager' : 'lazy'}
                        fetchPriority={index === 0 ? 'high' : 'auto'}
                      />
                    </ShowcaseLink>
                  </div>
                ))}
              </div>
            </div>
            <div className="shop-showcase__veil" aria-hidden="true" />

            {slides.length > 1 && (
              <div className="shop-showcase__navigation">
                <div className="shop-showcase__arrows">
                  <button type="button" onClick={() => select(active - 1)} aria-label={t('shop.showcase.previous')}>
                    <Icons.arrow className="shop-showcase__arrow--previous" size={20} />
                  </button>
                  <button type="button" onClick={() => select(active + 1)} aria-label={t('shop.showcase.next')}>
                    <Icons.arrow size={20} />
                  </button>
                </div>
                <div className="shop-showcase__dots" aria-label="انتخاب تصویر">
                  {slides.map((slide, index) => (
                    <button
                      type="button"
                      key={`dot-${slide.id}-${index}`}
                      className={index === active ? 'is-active' : ''}
                      onClick={() => select(index)}
                      aria-label={goToLabel(index)}
                      aria-current={index === active ? 'true' : undefined}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <span className="sr-only" aria-live="polite">
        {slides.length > 1 ? `${(active + 1).toLocaleString('fa-IR')} از ${slides.length.toLocaleString('fa-IR')}: ${slides[active]?.alt}` : ''}
      </span>
    </header>
  );
}
