import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Play } from 'lucide-react';
import { useLocation, useSearchParams } from 'react-router-dom';
import GalleryLightbox from '../components/GalleryLightbox';
import { hl, Icons, PageHero, Reveal, SectionHead, useNum } from '../components/ui';
import { useContent } from '../content/ContentContext';
import { useLocale } from '../i18n/LocaleContext';
import { imgProps, SIZES } from '../lib/img';
import { GALLERY_PAGE_SIZE } from '../../shared/gallery.js';

export default function Gallery() {
  const { t, m, gallery } = useContent();
  const { isRTL } = useLocale();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const formatNumber = useNum();
  const [activeIndex, setActiveIndex] = useState(null);
  const headingRef = useRef(null);
  const lightboxOpenerRef = useRef(null);
  const handledHashRef = useRef('');

  const items = Array.isArray(gallery) ? gallery : [];
  const totalPages = Math.max(1, Math.ceil(items.length / GALLERY_PAGE_SIZE));
  const rawPage = Number(searchParams.get('page') || 1);
  const requestedPage = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const safePage = Math.min(requestedPage, totalPages);
  const pageStart = (safePage - 1) * GALLERY_PAGE_SIZE;
  const visibleItems = items.slice(pageStart, pageStart + GALLERY_PAGE_SIZE);
  const canonicalPageParam = safePage === 1 ? '' : String(safePage);

  /* Keep invalid, out-of-range and redundant ?page=1 URLs canonical without
     dropping any future collection filters that may share this query string. */
  useEffect(() => {
    if ((searchParams.get('page') || '') === canonicalPageParam) return;
    const next = new URLSearchParams(searchParams);
    if (canonicalPageParam) next.set('page', canonicalPageParam);
    else next.delete('page');
    setSearchParams(next, { replace: true });
  }, [canonicalPageParam, searchParams, setSearchParams]);

  useEffect(() => {
    if (!location.hash || handledHashRef.current === location.hash) return;
    let id = '';
    try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) return;
    handledHashRef.current = location.hash;
    const targetPage = Math.floor(index / GALLERY_PAGE_SIZE) + 1;
    if (targetPage !== safePage) {
      const next = new URLSearchParams(searchParams);
      if (targetPage === 1) next.delete('page');
      else next.set('page', String(targetPage));
      setSearchParams(next, { replace: true });
    }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView?.({ block: 'center' });
    }));
  }, [items, location.hash, safePage, searchParams, setSearchParams]);

  const changePage = (nextPage) => {
    if (nextPage === safePage || nextPage < 1 || nextPage > totalPages) return;
    const next = new URLSearchParams(searchParams);
    if (nextPage === 1) next.delete('page');
    else next.set('page', String(nextPage));
    setSearchParams(next);
    requestAnimationFrame(() => {
      headingRef.current?.focus({ preventScroll: true });
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      headingRef.current?.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    });
  };

  const PreviousIcon = isRTL ? ChevronRight : ChevronLeft;
  const NextIcon = isRTL ? ChevronLeft : ChevronRight;

  return (
    <>
      <PageHero className="gallery-hero" title={t('gallery.hero.title')} sub={t('gallery.hero.sub')} image={m('gallery.hero.img')} />

      <section className="section section--airy gallery-page">
        <div className="container">
          <div ref={headingRef} className="gallery-page__heading" tabIndex="-1">
            <SectionHead overline={t('gallery.eyebrow')} title={hl(t('gallery.title'))} />
            <p>{t('gallery.intro')}</p>
          </div>

          {visibleItems.length ? (
            <div className="gallery-grid">
              {visibleItems.map((item, localIndex) => {
                const globalIndex = pageStart + localIndex;
                const preview = item.type === 'video' ? item.poster : item.src;
                return (
                  <Reveal key={item.id} id={item.id} className="gallery-grid__cell" delay={(localIndex % 3) * 0.06}>
                    <button
                      type="button"
                      className={`gallery-card gallery-card--${item.type}`}
                      onClick={(event) => {
                        lightboxOpenerRef.current = event.currentTarget;
                        setActiveIndex(globalIndex);
                      }}
                      aria-label={(t('gallery.open') || '{caption}').replace('{caption}', item.caption)}
                      aria-haspopup="dialog"
                    >
                      <span className="gallery-card__media">
                        {preview ? (
                          <img {...imgProps(preview, SIZES.card)} alt="" loading="lazy" />
                        ) : (
                          <span className="gallery-card__placeholder"><Icons.video size={46} /></span>
                        )}
                      </span>
                      <span className="gallery-card__shade" aria-hidden="true" />
                      {item.type === 'video' && (
                        <span className="gallery-card__play" aria-hidden="true"><Play fill="currentColor" /></span>
                      )}
                      <span className="gallery-card__caption">
                        {item.type === 'video' && <span>{t('gallery.video')}</span>}
                        <strong>{item.caption}</strong>
                      </span>
                    </button>
                  </Reveal>
                );
              })}
            </div>
          ) : (
            <div className="gallery-empty" role="status">
              <span><Icons.media size={38} /></span>
              <h2>{t('gallery.empty.title')}</h2>
              <p>{t('gallery.empty.text')}</p>
            </div>
          )}

          {totalPages > 1 && (
            <nav className="gallery-pagination" aria-label={t('gallery.pagination')}>
              <button type="button" onClick={() => changePage(safePage - 1)} disabled={safePage === 1} aria-label={t('gallery.previousPage')}>
                <PreviousIcon aria-hidden="true" />
              </button>
              {Array.from({ length: totalPages }, (_, index) => index + 1).map((pageNumber) => (
                <button
                  key={pageNumber}
                  type="button"
                  className={pageNumber === safePage ? 'is-current' : ''}
                  onClick={() => changePage(pageNumber)}
                  aria-current={pageNumber === safePage ? 'page' : undefined}
                  aria-label={(t('gallery.page') || '{page}').replace('{page}', formatNumber(pageNumber))}
                >
                  {formatNumber(pageNumber)}
                </button>
              ))}
              <button type="button" onClick={() => changePage(safePage + 1)} disabled={safePage === totalPages} aria-label={t('gallery.nextPage')}>
                <NextIcon aria-hidden="true" />
              </button>
            </nav>
          )}
        </div>
      </section>

      {activeIndex !== null && items[activeIndex] && (
        <GalleryLightbox
          items={items}
          index={activeIndex}
          onChange={setActiveIndex}
          onClose={() => setActiveIndex(null)}
          returnFocusRef={lightboxOpenerRef}
          t={t}
          formatNumber={formatNumber}
        />
      )}
    </>
  );
}
