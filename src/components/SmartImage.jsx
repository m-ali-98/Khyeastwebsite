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
  const [, bump] = useState(0);
  const imgRef = useRef(null);

  /* `loaded` is keyed by the resolved URL. Keeping the URL (instead of a
     boolean) means a new src — e.g. the admin replacing the hero image — is
     considered "not loaded yet" automatically, and the stale `true` from the
     previous picture can never leave the new one stuck. */
  const [loadedSrc, setLoadedSrc] = useState(null);

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

  const loaded = loadedSrc === webp;
  const markLoaded = useCallback(() => setLoadedSrc(webp), [webp]);

  /* A preloaded or cached image can finish decoding BEFORE React attaches the
     onLoad handler, so the event never fires. Reading `complete` covers that,
     both when the node mounts and whenever the resolved URL changes (the
     srcset arriving with the upload manifest counts as a change). */
  const attach = useCallback(
    (node) => {
      imgRef.current = node;
      if (node?.complete && node.naturalWidth > 0) setLoadedSrc(webp);
    },
    [webp],
  );

  useEffect(() => {
    const node = imgRef.current;
    if (node?.complete && node.naturalWidth > 0) setLoadedSrc(webp);
    /* Some browsers do not re-fire `load` when srcset is added to an <img>
       that is already showing `src`; poll once on the next frame as a guard. */
    const id = requestAnimationFrame(() => {
      const n = imgRef.current;
      if (n?.complete && n.naturalWidth > 0) setLoadedSrc(webp);
    });
    return () => cancelAnimationFrame(id);
  }, [webp, srcSet]);

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
