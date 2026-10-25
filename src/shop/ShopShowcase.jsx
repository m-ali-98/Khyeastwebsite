import { useEffect, useMemo, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useContent } from '../content/ContentContext';
import { useLocale } from '../i18n/LocaleContext';
import { imgProps, SIZES } from '../lib/img';
import { Icons, Reveal } from '../components/ui';

const SHOWCASE_INTERVAL_MS = 4000;

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

export default function ShopShowcase({ items, title, sub, crumb, onBrowseAll }) {
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
  const [interactionPaused, setInteractionPaused] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => typeof document === 'undefined' || !document.hidden);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    setActive((current) => Math.min(current, slides.length - 1));
  }, [slides.length]);

  useEffect(() => {
    const syncVisibility = () => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', syncVisibility);
    return () => document.removeEventListener('visibilitychange', syncVisibility);
  }, []);

  /* Warm the next responsive image before its four-second turn arrives. Lazy
     slides remain cheap at first paint, while the actual transition never has
     to reveal an undecoded blank frame on a slower mobile connection. */
  useEffect(() => {
    if (slides.length < 2 || typeof window === 'undefined') return;
    const next = slides[(active + 1) % slides.length];
    const source = imgProps(next.image, SIZES.full);
    const preload = new window.Image();
    if (source.srcSet) preload.srcset = source.srcSet;
    if (source.sizes) preload.sizes = source.sizes;
    preload.decoding = 'async';
    preload.src = source.src;
  }, [active, slides]);

  const autoPlaying = slides.length > 1 && !reduceMotion && !interactionPaused && pageVisible;

  /* A timeout (rather than a free-running interval) gives every image a full
     four seconds after either an automatic or manual selection. Hover/focus,
     a hidden tab, and reduced-motion preferences pause rotation. */
  useEffect(() => {
    if (!autoPlaying) return undefined;
    const timer = window.setTimeout(() => {
      setActive((current) => (current + 1) % slides.length);
    }, SHOWCASE_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [active, autoPlaying, slides.length]);

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

  /* Native same-page hashes create a history entry and can re-apply their
     scroll position after a back navigation or reload. That made the primary
     “all products” action feel intermittent: repeat taps could land at a
     different offset as the fixed header collapsed. Keep the real href as a
     no-JavaScript fallback, but make ordinary clicks deterministic and safe to
     repeat without mutating the URL. */
  const browseCatalog = (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const catalog = document.getElementById('shop-catalog');
    if (!catalog) return;
    event.preventDefault();
    onBrowseAll?.();
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    catalog.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
  };

  return (
    <header
      className="shop-showcase"
      data-testid="shop-showcase"
      data-autoplay={autoPlaying ? 'true' : 'false'}
      aria-roledescription="اسلایدشو"
      onKeyDown={onKeyDown}
      onMouseEnter={() => setInteractionPaused(true)}
      onMouseLeave={() => setInteractionPaused(false)}
      onFocusCapture={() => setInteractionPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setInteractionPaused(false);
      }}
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
            <a
              className="btn btn--primary shop-showcase__catalog-link"
              href="#shop-catalog"
              aria-controls="shop-catalog"
              onClick={browseCatalog}
            >
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

      <span className="sr-only" aria-live={autoPlaying ? 'off' : 'polite'} aria-atomic="true">
        {slides.length > 1 ? `${(active + 1).toLocaleString('fa-IR')} از ${slides.length.toLocaleString('fa-IR')}: ${slides[active]?.alt}` : ''}
      </span>
    </header>
  );
}
