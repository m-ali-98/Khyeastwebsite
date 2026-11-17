import { useEffect, useMemo } from 'react';
import { useContent } from '../content/ContentContext';
import { resolveSeo, validIsoDate } from '../../shared/seo.js';

const setMeta = (attribute, key, content) => {
  let element = document.head.querySelector(`meta[${attribute}="${key}"]`);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.setAttribute('content', String(content || ''));
};

const addLink = (rel, href, hreflang) => {
  const element = document.createElement('link');
  element.rel = rel;
  element.href = href;
  if (hreflang) element.hreflang = hreflang;
  element.setAttribute('data-seo-client', '');
  document.head.appendChild(element);
};

/**
 * Keep route metadata correct after an in-app navigation. Direct requests are
 * rendered with the same resolver by the server/build, so this effect is not
 * the crawler's only source of truth; it simply prevents a subsequent client
 * route from inheriting the previous page's title, canonical or JSON-LD.
 */
export default function SeoHead({ pathname }) {
  const { state } = useContent();
  const meta = useMemo(
    () => resolveSeo(pathname, state, window.location.origin),
    [pathname, state],
  );

  useEffect(() => {
    document.title = meta.title;
    const robots = meta.indexable
      ? 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'
      : 'noindex, nofollow, noarchive';

    setMeta('name', 'description', meta.description);
    setMeta('name', 'robots', robots);
    setMeta('name', 'googlebot', robots);
    setMeta('property', 'og:site_name', meta.siteName);
    setMeta('property', 'og:title', meta.title);
    setMeta('property', 'og:description', meta.description);
    setMeta('property', 'og:type', meta.kind === 'article' ? 'article' : meta.kind === 'product' ? 'product' : 'website');
    if (meta.canonical) setMeta('property', 'og:url', meta.canonical);
    else document.head.querySelector('meta[property="og:url"]')?.remove();
    setMeta('property', 'og:locale', meta.ogLocale || meta.lang);
    setMeta('property', 'og:image', meta.image);
    setMeta('property', 'og:image:secure_url', meta.image);
    setMeta('property', 'og:image:type', /\.png(?:[?#]|$)/i.test(meta.image) ? 'image/png' : /\.jpe?g(?:[?#]|$)/i.test(meta.image) ? 'image/jpeg' : /\.avif(?:[?#]|$)/i.test(meta.image) ? 'image/avif' : 'image/webp');
    setMeta('property', 'og:image:alt', meta.pageTitle || meta.title);
    setMeta('name', 'twitter:card', 'summary_large_image');
    setMeta('name', 'twitter:title', meta.title);
    setMeta('name', 'twitter:description', meta.description);
    setMeta('name', 'twitter:image', meta.image);
    setMeta('name', 'twitter:image:alt', meta.pageTitle || meta.title);
    document.head.querySelectorAll([
      'meta[property="article:published_time"]',
      'meta[property="article:modified_time"]',
      'meta[property="article:section"]',
      'meta[property="product:price:amount"]',
      'meta[property="product:price:currency"]',
      'meta[property="product:availability"]',
    ].join(', ')).forEach((element) => element.remove());
    if (meta.kind === 'article') {
      const publishedAt = validIsoDate(meta.entity?.publishedAt);
      const updatedAt = validIsoDate(meta.entity?.updatedAt) || publishedAt;
      if (publishedAt) setMeta('property', 'article:published_time', publishedAt);
      if (updatedAt) setMeta('property', 'article:modified_time', updatedAt);
      if (meta.entity?.category) setMeta('property', 'article:section', meta.entity.category);
    }
    if (meta.kind === 'product' && meta.shopOffer?.active) {
      setMeta('property', 'product:price:amount', Math.max(0, Number(meta.shopOffer.price) || 0));
      setMeta('property', 'product:price:currency', 'IRR');
      setMeta(
        'property',
        'product:availability',
        Number(meta.shopOffer.stock) === -1 || Number(meta.shopOffer.stock) > 0
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock',
      );
    }

    document.head.querySelectorAll('link[rel="canonical"], link[rel="alternate"][hreflang], meta[property="og:locale:alternate"]')
      .forEach((element) => element.remove());
    if (meta.canonical) addLink('canonical', meta.canonical);
    for (const alternate of meta.alternates) {
      addLink('alternate', alternate.href, alternate.hreflang);
    }
    for (const alternate of meta.alternates.filter((item) => item.hreflang !== 'x-default' && item.hreflang !== meta.lang)) {
      const element = document.createElement('meta');
      element.setAttribute('property', 'og:locale:alternate');
      element.setAttribute('content', alternate.ogLocale || alternate.hreflang);
      element.setAttribute('data-seo-client', '');
      document.head.appendChild(element);
    }

    let schema = document.getElementById('seo-jsonld');
    if (meta.schema) {
      if (!schema) {
        schema = document.createElement('script');
        schema.id = 'seo-jsonld';
        schema.type = 'application/ld+json';
        document.head.appendChild(schema);
      }
      schema.textContent = JSON.stringify(meta.schema).replace(/</g, '\\u003c');
    } else {
      schema?.remove();
    }
  }, [meta]);

  return null;
}
