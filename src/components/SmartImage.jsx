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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  const imgRef = useRef(null);

  /* A preloaded or browser-cached image can finish BEFORE React attaches the
     onLoad handler — the event then never fires and the image would stay at
     opacity 0 forever. Checking `complete` on mount covers that case. */
  const markLoaded = useCallback(() => setLoaded(true), []);
  const attach = useCallback(
    (node) => {
      imgRef.current = node;
      if (node && node.complete) markLoaded();
    },
    [markLoaded],
  );

  useEffect(() => {
    const node = imgRef.current;
    if (node && node.complete) markLoaded();
  }, [src, markLoaded]);

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
    /* manifest entries are { lqip, width }; older builds stored a bare string */
    const meta = BLUR[w] || uploadBlur[w] || null;
    const lqip = typeof meta === 'string' ? meta : meta?.lqip || null;
    const fullWidth = typeof meta === 'object' ? meta?.width : null;

    /* Only advertise a srcset when we know the real intrinsic width — a wrong
       descriptor makes the browser pick the low-res file on wide screens. */
    const small = isManaged(w) && fullWidth && fullWidth > 768 ? w.replace(/\.webp$/i, '-768.webp') : null;

    return {
      webp: w,
      srcSet: small ? `${small} 768w, ${w} ${fullWidth}w` : undefined,
      blur: lqip,
    };
  }, [src, needsUploadMap && uploadBlur[toWebp(src)]]);

  return (
    <img
      ref={attach}
      src={webp}
      srcSet={srcSet}
      sizes={srcSet ? sizes : undefined}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      decoding={priority ? 'sync' : 'async'}
      fetchPriority={priority ? 'high' : 'auto'}
      onLoad={markLoaded}
      onError={markLoaded}
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
