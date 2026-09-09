/* ==========================================================================
   SmartImage — bandwidth-aware <img> for slow connections.
   --------------------------------------------------------------------------
   • serves the WebP twin produced by `npm run images` (5-25x smaller)
   • responsive srcset: phones download the 768w variant, not the full one
   • paints an inlined blurred placeholder (LQIP, ~150 bytes) immediately, then
     cross-fades to the real image — no empty boxes, no layout shift
   • lazy + async decoding by default; `priority` opts the hero image into
     eager loading with fetchpriority=high
   ========================================================================== */
import { useMemo, useState } from 'react';
import BLUR from '../assets/blurhash.json';

/** /assets/img/x.jpg → /assets/img/x.webp (only for local, non-uploaded files) */
const toWebp = (src) =>
  typeof src === 'string' && /^\/assets\/.+\.(png|jpe?g)$/i.test(src) ? src.replace(/\.(png|jpe?g)$/i, '.webp') : src;

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

  const { webp, srcSet, blur } = useMemo(() => {
    const w = toWebp(src);
    const isLocal = w !== src || /^\/assets\/.+\.webp$/i.test(String(src));
    const small = isLocal ? w.replace(/\.webp$/i, '-768.webp') : null;
    return {
      webp: w,
      srcSet: small ? `${small} 768w, ${w} 1600w` : undefined,
      blur: BLUR[w] || null,
    };
  }, [src]);

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
