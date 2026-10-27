import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useLocale } from '../i18n/LocaleContext';

const FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  'video[controls]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export default function GalleryLightbox({ items, index, onChange, onClose, returnFocusRef, t, formatNumber }) {
  const { isRTL } = useLocale();
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const restoreFocusTimer = useRef(0);
  const item = items[index];

  const move = (delta) => {
    if (items.length < 2) return;
    onChange((index + delta + items.length) % items.length);
  };

  useEffect(() => {
    window.clearTimeout(restoreFocusTimer.current);
    const root = document.getElementById('root');
    const activeBeforeOpen = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const previousAriaHidden = root?.getAttribute('aria-hidden');
    const previousInert = root?.inert;

    document.body.style.overflow = 'hidden';
    if (root) {
      root.inert = true;
      root.setAttribute('aria-hidden', 'true');
    }
    closeRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      if (root) {
        root.inert = Boolean(previousInert);
        if (previousAriaHidden === null) root.removeAttribute('aria-hidden');
        else root.setAttribute('aria-hidden', previousAriaHidden);
      }
      const focusTarget = returnFocusRef?.current || activeBeforeOpen;
      restoreFocusTimer.current = window.setTimeout(() => {
        if (focusTarget?.isConnected && typeof focusTarget.focus === 'function') {
          focusTarget.focus({ preventScroll: true });
        }
      }, 0);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      const nativeMediaControl = event.target?.closest?.('video, audio, input, select, textarea');
      if (event.key === 'ArrowRight' && !nativeMediaControl) {
        event.preventDefault();
        move(isRTL ? -1 : 1);
        return;
      }
      if (event.key === 'ArrowLeft' && !nativeMediaControl) {
        event.preventDefault();
        move(isRTL ? 1 : -1);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...(dialogRef.current?.querySelectorAll(FOCUSABLE) || [])];
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [index, isRTL, items.length, onChange, onClose]);

  if (!item || typeof document === 'undefined') return null;

  const PreviousIcon = isRTL ? ChevronRight : ChevronLeft;
  const NextIcon = isRTL ? ChevronLeft : ChevronRight;
  const position = (t('gallery.position') || '{current} / {total}')
    .replace('{current}', formatNumber(index + 1))
    .replace('{total}', formatNumber(items.length));

  return createPortal(
    <div
      className="gallery-lightbox"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="gallery-lightbox__dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('gallery.dialogLabel')}
        aria-describedby={item.description ? 'gallery-lightbox-description' : undefined}
      >
        <header className="gallery-lightbox__toolbar">
          <span className="gallery-lightbox__position" aria-live="polite">{position}</span>
          <button ref={closeRef} type="button" className="gallery-lightbox__close" onClick={onClose} aria-label={t('gallery.close')}>
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="gallery-lightbox__stage">
          {item.type === 'video' ? (
            <video key={item.id} src={item.src} poster={item.poster || undefined} controls playsInline preload="metadata" aria-label={item.caption} />
          ) : (
            <img src={item.src} alt={item.caption} />
          )}
          {items.length > 1 && (
            <>
              <button type="button" className="gallery-lightbox__nav gallery-lightbox__nav--previous" onClick={() => move(-1)} aria-label={t('gallery.previous')}>
                <PreviousIcon aria-hidden="true" />
              </button>
              <button type="button" className="gallery-lightbox__nav gallery-lightbox__nav--next" onClick={() => move(1)} aria-label={t('gallery.next')}>
                <NextIcon aria-hidden="true" />
              </button>
            </>
          )}
        </div>

        <div className="gallery-lightbox__copy">
          <h2>{item.caption}</h2>
          {item.description && <p id="gallery-lightbox-description">{item.description}</p>}
        </div>
      </section>
    </div>,
    document.body,
  );
}
