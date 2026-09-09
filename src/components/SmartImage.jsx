/* ==========================================================================
   SmartImage — bandwidth-aware <img> for slow connections.
   --------------------------------------------------------------------------
   • serves the WebP twin (5-25x smaller than the PNG/JPEG source)
   • responsive srcset: phones download the 768w variant, not the full one
   • paints an inlined blurred placeholder (LQIP, ~150 bytes) immediately, then
     cross-fades to the real image — no empty boxes, no layout shift
   • lazy + async decoding by default; `priority` opts the hero image into
     eager loading with fetchpriority=high

   Placeholders come from two sources, both produced automatically:
     build time → src/assets/blurhash.json   (public/assets/**)
     runtime    → GET /api/uploads-lqip      (admin uploads)
   ========================================================================== */
import { useEffect, useMemo, useState } from 'react';
import BLUR from '../assets/blurhash.json';

/* --------- runtime placeholders for admin uploads (fetched once) --------- */
let uploadBlur = {};
let uploadPromise = null;
const listeners = new Set();

function loadUploadBlur() {
  if (uploadPromise) return uploadPromise;
  uploadPromise = fetch('/api/uploads-lqip')
    .then((r) => (r.ok ? r.json() : {}))
    .then((map) => {
      uploadBlur = map || {};
      listeners.forEach((fn) => fn());
      return uploadBlur;
    })
    .catch(() => ({}));
  return uploadPromise;
}

/** /assets/img/x.jpg → /assets/img/x.webp — also covers /uploads/images/*. */
const toWebp = (src) =>
  typeof src === 'string' && /^\/(assets|uploads)\/.+\.(png|jpe?g)$/i.test(src)
    ? src.replace(/\.(png|jpe?g)$/i, '.webp')
    : src;

const isManaged = (src) => typeof src === 'string' && /^\/(assets|uploads)\/.+\.webp$/i.test(src);

export default function SmartImage({
  src,
  alt = '',
  priority = false,
  sizes = '100vw',
  className = '',
  style,
  ...rest
}) {
  const [loaded, setLoaded] = useState(false);
  const [, bump] = useState(0);

  /* subscribe to the upload placeholder map, but only when we need it */
  const needsUploadMap = typeof src === 'string' && src.startsWith('/uploads/');
  useEffect(() => {
    if (!needsUploadMap) return undefined;
    const fn = () => bump((n) => n + 1);
    listeners.add(fn);
    loadUploadBlur();
    return () => listeners.delete(fn);
  }, [needsUploadMap]);

  const { webp, srcSet, blur } = useMemo(() => {
    const w = toWebp(src);
    const managed = isManaged(w);
    const small = managed ? w.replace(/\.webp$/i, '-768.webp') : null;
    return {
      webp: w,
      srcSet: small ? `${small} 768w, ${w} 1600w` : undefined,
      blur: BLUR[w] || uploadBlur[w] || null,
    };
  }, [src, needsUploadMap && uploadBlur[toWebp(src)]]);

  return (
    <img
      src={webp}
      srcSet={srcSet}
      sizes={srcSet ? sizes : undefined}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      decoding={priority ? 'sync' : 'async'}
      fetchPriority={priority ? 'high' : 'auto'}
      onLoad={() => setLoaded(true)}
      onError={() => setLoaded(true)}
      className={`smart-img ${loaded ? 'is-loaded' : ''} ${className}`.trim()}
      style={
        blur && !loaded
          ? { ...style, backgroundImage: `url(${blur})`, backgroundSize: 'cover', backgroundPosition: 'center' }
          : style
      }
      {...rest}
    />
  );
}
