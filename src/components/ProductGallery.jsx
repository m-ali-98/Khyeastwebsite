import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLocale } from '../i18n/LocaleContext';
import { imgProps } from '../lib/img';
import { normalizeProductImages } from '../../shared/productImages.js';

const COPY = {
  fa: {
    gallery: (title) => `گالری تصاویر ${title}`,
    previous: 'تصویر قبلی',
    next: 'تصویر بعدی',
    show: (index, total) => `نمایش تصویر ${index} از ${total}`,
    position: (index, total) => `تصویر ${index} از ${total}`,
    thumbs: 'انتخاب تصویر محصول',
  },
  en: {
    gallery: (title) => `${title} image gallery`,
    previous: 'Previous image',
    next: 'Next image',
    show: (index, total) => `Show image ${index} of ${total}`,
    position: (index, total) => `Image ${index} of ${total}`,
    thumbs: 'Choose a product image',
  },
  ar: {
    gallery: (title) => `معرض صور ${title}`,
    previous: 'الصورة السابقة',
    next: 'الصورة التالية',
    show: (index, total) => `عرض الصورة ${index} من ${total}`,
    position: (index, total) => `الصورة ${index} من ${total}`,
    thumbs: 'اختيار صورة المنتج',
  },
  ru: {
    gallery: (title) => `Галерея изображений: ${title}`,
    previous: 'Предыдущее изображение',
    next: 'Следующее изображение',
    show: (index, total) => `Показать изображение ${index} из ${total}`,
    position: (index, total) => `Изображение ${index} из ${total}`,
    thumbs: 'Выбрать изображение товара',
  },
};

/** Accessible primary-image gallery shared by catalogue and store details.
 * The ordered first image is rendered immediately, and every source still
 * passes through imgProps so uploaded responsive variants are reused. */
export default function ProductGallery({
  images,
  primary = '',
  title,
  className = '',
  stageClassName = '',
  sizes = '(max-width: 900px) 100vw, 46vw',
  eager = false,
}) {
  const { locale, isRTL } = useLocale();
  const labels = COPY[locale] || COPY.fa;
  const gallery = useMemo(() => normalizeProductImages(images, primary), [images, primary]);
  const signature = gallery.join('\u0000');
  const [active, setActive] = useState(0);

  useEffect(() => setActive(0), [signature]);

  if (!gallery.length) return null;
  const index = Math.min(active, gallery.length - 1);
  const current = gallery[index];
  const multiple = gallery.length > 1;
  const number = (value) => value.toLocaleString(locale);
  const move = (step) => setActive((value) => (value + step + gallery.length) % gallery.length);
  const PreviousIcon = isRTL ? ChevronRight : ChevronLeft;
  const NextIcon = isRTL ? ChevronLeft : ChevronRight;

  const onKeyDown = (event) => {
    if (!multiple || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') setActive(0);
    else if (event.key === 'End') setActive(gallery.length - 1);
    else if (event.key === 'ArrowRight') move(isRTL ? -1 : 1);
    else move(isRTL ? 1 : -1);
  };

  return (
    <section className={`product-gallery ${className}`.trim()} aria-label={labels.gallery(title)}>
      <div
        className={`product-gallery__stage ${stageClassName}`.trim()}
        tabIndex={multiple ? 0 : undefined}
        onKeyDown={onKeyDown}
      >
        <img
          key={current}
          className="product-gallery__main"
          {...imgProps(current, sizes)}
          alt={title}
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager ? 'high' : 'auto'}
        />

        {multiple && (
          <>
            <button
              type="button"
              className="product-gallery__nav product-gallery__nav--previous"
              aria-label={labels.previous}
              onClick={() => move(-1)}
            >
              <PreviousIcon size={21} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="product-gallery__nav product-gallery__nav--next"
              aria-label={labels.next}
              onClick={() => move(1)}
            >
              <NextIcon size={21} aria-hidden="true" />
            </button>
            <span className="product-gallery__position" aria-live="polite">
              {labels.position(number(index + 1), number(gallery.length))}
            </span>
          </>
        )}
      </div>

      {multiple && (
        <div className="product-gallery__thumbs" role="group" aria-label={labels.thumbs}>
          {gallery.map((image, imageIndex) => (
            <button
              type="button"
              className={`product-gallery__thumb${imageIndex === index ? ' is-active' : ''}`}
              aria-label={labels.show(number(imageIndex + 1), number(gallery.length))}
              aria-current={imageIndex === index ? 'true' : undefined}
              onClick={() => setActive(imageIndex)}
              key={image}
            >
              <img {...imgProps(image, '72px')} alt="" loading="lazy" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
