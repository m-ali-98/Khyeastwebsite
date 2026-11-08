/* ==========================================================================
   Search metadata, structured data, sitemap and crawlable HTML.

   This module is deliberately browser-safe and server-safe. React uses the
   same resolver after client navigation that the Node server and static build
   use before sending HTML, so canonical URLs, hreflang and index policy cannot
   drift between three separate implementations.
   ========================================================================== */
import {
  DEFAULT_LOCALE,
  LOCALES,
  getLocaleMeta,
  localizeState,
  shopEnabled,
} from './i18n/index.js';

export const DEFAULT_SITE_ORIGIN = 'https://khuzestanyeast-co.com';
export const SEO_HEAD_START = '<!-- seo:head:start -->';
export const SEO_HEAD_END = '<!-- seo:head:end -->';

const OG_LOCALE = { fa: 'fa_IR', en: 'en_US', ar: 'ar_AE' };
const PRIVATE_SHOP_ROUTE = /^\/shop\/(?:cart|checkout|login|account)$|^\/shop\/order\/[^/]+$/;
const validSlug = (value) => {
  const slug = String(value || '');
  return slug.length <= 120 && /^[a-z0-9\u0600-\u06FF]+(?:-[a-z0-9\u0600-\u06FF]+)*$/.test(slug);
};
const ALIASES = {
  '/dezmaye': '/products/dezmaye-gold-80',
  '/shetab': '/products/shetab-90',
  '/xpower': '/products/xpower-70',
  '/nanmaye': '/products/nanmaye-10',
};

const STATIC_ROUTES = {
  '/': {
    titleKey: 'home.hero.title',
    seoTitleKey: 'seo.home.title',
    descriptionKey: 'home.hero.desc',
    imageKey: 'home.hero.bg',
    bodyKeys: ['home.intro.p1', 'home.brands.sub', 'home.products.sub', 'home.features.title'],
  },
  '/about': {
    titleKey: 'about.hero.title',
    descriptionKey: 'about.hero.sub',
    imageKey: 'about.hero.img',
    bodyKeys: ['about.story.p1', 'about.story.p2', 'about.mission.mission', 'about.mission.vision'],
  },
  '/products': {
    kind: 'collection',
    titleKey: 'products.hero.title',
    descriptionKey: 'products.hero.sub',
    imageKey: 'products.hero.img',
    bodyKeys: ['products.catalog.text'],
    listing: 'products',
  },
  '/export': {
    titleKey: 'export.hero.title',
    descriptionKey: 'export.hero.sub',
    imageKey: 'export.hero.img',
    bodyKeys: ['export.banner.text', 'export.markets.sub', 'export.why.sub'],
  },
  '/quality': {
    titleKey: 'quality.hero.title',
    descriptionKey: 'quality.hero.sub',
    imageKey: 'quality.hero.img',
    bodyKeys: ['quality.lab.p1', 'quality.lab.p2', 'quality.cert.sub', 'quality.process.sub'],
  },
  '/blog': {
    titleKey: 'blog.hero.title',
    descriptionKey: 'blog.hero.sub',
    imageKey: 'blog.hero.img',
    bodyKeys: ['blog.hero.sub'],
    listing: 'posts',
  },
  '/gallery': {
    kind: 'collection',
    titleKey: 'gallery.hero.title',
    descriptionKey: 'gallery.hero.sub',
    imageKey: 'gallery.hero.img',
    bodyKeys: ['gallery.intro'],
    listing: 'gallery',
  },
  '/sales-representatives': {
    kind: 'collection',
    titleKey: 'salesReps.hero.title',
    seoTitleKey: 'seo.salesRepresentatives.title',
    descriptionKey: 'salesReps.hero.sub',
    imageKey: 'salesReps.hero.img',
    bodyKeys: ['salesReps.intro'],
    listing: 'salesRepresentatives',
    locales: ['fa'],
  },
  '/contact': {
    titleKey: 'contact.hero.title',
    descriptionKey: 'contact.hero.sub',
    imageKey: 'contact.hero.img',
    bodyKeys: ['contact.quick.text', 'footer.about'],
    listing: 'offices',
  },
  '/shop': {
    titleKey: 'shop.hero.title',
    seoTitleKey: 'seo.shop.title',
    descriptionKey: 'shop.hero.sub',
    imageKey: 'shop.hero.img',
    bodyKeys: ['shop.hero.sub'],
    listing: 'shop',
    locales: ['fa'],
  },
};

const PRIVATE_TITLE_KEYS = [
  [/^\/admin(?:\/|$)/, 'admin'],
  [/^\/shop\/cart(?:\/|$)/, 'shop.cart.title'],
  [/^\/shop\/checkout(?:\/|$)/, 'shop.checkout.title'],
  [/^\/shop\/login(?:\/|$)/, 'shop.auth.title'],
  [/^\/shop\/account(?:\/|$)/, 'shop.account.title'],
  [/^\/shop\/order(?:\/|$)/, 'shop.order.track'],
];

const stripMarks = (value) => String(value || '').replace(/\[\[(.+?)\]\]/g, '$1').trim();
const decodeEntities = (value) =>
  String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');

export const plainText = (value) =>
  stripMarks(
    decodeEntities(
      String(value || '')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' '),
    ),
  ).replace(/\s+/g, ' ').trim();

export function clipDescription(value, max = 160) {
  const text = plainText(value);
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const word = cut.lastIndexOf(' ');
  return `${cut.slice(0, word > max * 0.65 ? word : cut.length).trim()}…`;
}

export function validIsoDate(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return parsed.getUTCFullYear() === Number(year) &&
    parsed.getUTCMonth() + 1 === Number(month) &&
    parsed.getUTCDate() === Number(day)
    ? text
    : '';
}

export function normalizeOrigin(value = DEFAULT_SITE_ORIGIN) {
  try {
    const url = new URL(String(value || DEFAULT_SITE_ORIGIN));
    if (!/^https?:$/.test(url.protocol)) throw new Error('unsupported origin');
    return url.origin;
  } catch {
    return DEFAULT_SITE_ORIGIN;
  }
}

export function normalizePathname(value = '/') {
  let path = String(value || '/').split(/[?#]/, 1)[0] || '/';
  if (!path.startsWith('/')) path = `/${path}`;
  path = path.replace(/\/{2,}/g, '/');
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return path || '/';
}

export function localeRoute(pathname = '/') {
  const path = normalizePathname(pathname);
  const first = path.split('/')[1];
  const locale = LOCALES.some((item) => item.code === first && item.code !== DEFAULT_LOCALE)
    ? first
    : DEFAULT_LOCALE;
  const prefix = locale === DEFAULT_LOCALE ? '' : `/${locale}`;
  const relative = prefix && path.startsWith(prefix) ? path.slice(prefix.length) || '/' : path;
  return { path, locale, relative };
}

export function localePath(locale, relative = '/') {
  const clean = normalizePathname(relative);
  if (locale === DEFAULT_LOCALE) return clean;
  return clean === '/' ? `/${locale}` : `/${locale}${clean}`;
}

export function absoluteUrl(origin, value = '/') {
  if (/^https?:\/\//i.test(String(value))) return String(value).replace(/^http:\/\//i, 'https://');
  try {
    return new URL(String(value || '/'), `${normalizeOrigin(origin)}/`).href;
  } catch {
    return `${normalizeOrigin(origin)}/`;
  }
}

/** Return a path-only permanent redirect, or null when the URL is canonical. */
export function redirectPath(pathname = '/') {
  const original = String(pathname || '/').split(/[?#]/, 1)[0] || '/';
  let target = original.startsWith('/') ? original.replace(/\/{2,}/g, '/') : `/${original}`;
  if (target.length > 1) target = target.replace(/\/+$/, '');

  if (target === '/fa') target = '/';
  else if (target.startsWith('/fa/')) target = normalizePathname(target.slice(3));
  if (target === '/index.html') target = '/';

  if (target === '/en/admin' || target.startsWith('/en/admin/')) target = normalizePathname(target.slice(3));
  else if (target === '/ar/admin' || target.startsWith('/ar/admin/')) target = normalizePathname(target.slice(3));

  const { locale, relative } = localeRoute(target);
  if (ALIASES[relative]) target = localePath(locale, ALIASES[relative]);
  return target !== original ? target : null;
}

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const escapeXml = escapeHtml;
const safeJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
const cleanArray = (values) => values.map(plainText).filter(Boolean);
const asArray = (value) => (Array.isArray(value) ? value : []);

function titleWithSite(page, site, home = false) {
  const cleanPage = stripMarks(page);
  const cleanSite = stripMarks(site);
  let title;
  if (
    home ||
    !cleanPage ||
    cleanPage === cleanSite ||
    cleanPage.toLocaleLowerCase().includes(cleanSite.toLocaleLowerCase())
  ) title = cleanPage || cleanSite;
  else {
    const combined = `${cleanPage} | ${cleanSite}`;
    /* Preserve the meaningful page phrase instead of appending a company
       suffix that would crowd out an already descriptive entity title. */
    title = combined.length > 70 && cleanPage.length >= 38 ? cleanPage : combined;
  }
  return clipDescription(title, 70);
}

function localizedView(state, locale) {
  return localizeState(state, locale) || state || {};
}

function routeAlternates(relative, locales, origin) {
  const allowed = LOCALES.filter((item) => locales.includes(item.code));
  const links = allowed.map((item) => ({
    hreflang: item.htmlLang,
    ogLocale: OG_LOCALE[item.code] || item.htmlLang,
    href: absoluteUrl(origin, localePath(item.code, relative)),
  }));
  if (locales.includes(DEFAULT_LOCALE)) {
    links.push({ hreflang: 'x-default', href: absoluteUrl(origin, localePath(DEFAULT_LOCALE, relative)) });
  }
  return links;
}

function pageLinks(view, locale, route, listing) {
  if (listing === 'products') {
    return asArray(view.products).filter((item) => validSlug(item?.slug)).map((item) => ({
      label: plainText(item.title),
      href: localePath(locale, `/products/${item.slug}`),
      text: plainText(item.short),
    }));
  }
  if (listing === 'posts') {
    return asArray(view.posts).filter((item) => validSlug(item?.slug)).map((item) => ({
      label: plainText(item.title),
      href: localePath(locale, `/blog/${item.slug}`),
      text: plainText(item.excerpt),
    }));
  }
  if (listing === 'shop') {
    return asArray(view.shop?.products)
      .filter((item) => item?.active && validSlug(item.slug))
      .map((item) => ({
        label: plainText(item.title),
        href: `/shop/${item.slug}`,
        text: plainText(item.short),
      }));
  }
  if (listing === 'offices') {
    return asArray(view.collections?.offices).map((item) => ({
      label: plainText(item?.title),
      href: localePath(locale, '/contact'),
      text: plainText(item?.address),
    }));
  }
  if (listing === 'gallery') {
    return asArray(view.gallery).filter((item) => validSlug(item?.id)).map((item) => ({
      label: plainText(item.caption),
      href: `${localePath(locale, '/gallery')}#${item.id}`,
      text: plainText(item.description),
    }));
  }
  if (listing === 'salesRepresentatives') {
    return asArray(view.collections?.salesRepresentatives)
      .filter((item) => item?.active !== false && validSlug(item?.id))
      .map((item) => ({
        label: plainText(item.name),
        href: `/sales-representatives#${item.id}`,
        text: plainText([item.city, item.province, item.brands].filter(Boolean).join('، ')),
      }));
  }
  return route.links || [];
}

function breadcrumbItems(view, locale, relative, title) {
  const home = plainText(view.texts?.['nav.breadcrumb.home'] || view.texts?.['nav.home'] || 'Home');
  const items = [{ name: home, path: localePath(locale, '/') }];
  if (relative === '/') return items;
  if (relative.startsWith('/products/')) {
    items.push({ name: plainText(view.texts?.['nav.products'] || 'Products'), path: localePath(locale, '/products') });
  } else if (relative.startsWith('/blog/')) {
    items.push({ name: plainText(view.texts?.['nav.blog'] || 'Blog'), path: localePath(locale, '/blog') });
  } else if (relative.startsWith('/shop/')) {
    items.push({ name: plainText(view.texts?.['nav.shop'] || 'Shop'), path: '/shop' });
  }
  items.push({ name: title, path: localePath(locale, relative) });
  return items;
}

function organizationSchema(view, origin) {
  const texts = view.texts || {};
  const offices = asArray(view.collections?.offices);
  const socials = asArray(view.collections?.socials)
    .map((item) => String(item?.href || '').trim())
    .filter((href) => /^https?:\/\//i.test(href))
    .map((href) => absoluteUrl(origin, href));
  const phones = offices.flatMap((office) => asArray(office?.phones)).map((phone) => phone?.tel).filter(Boolean);
  return {
    '@type': 'Organization',
    '@id': `${origin}/#organization`,
    name: plainText(texts['global.company.name']),
    alternateName: plainText(texts['global.company.en']),
    url: `${origin}/`,
    logo: {
      '@type': 'ImageObject',
      url: absoluteUrl(origin, '/assets/brand/logo.webp'),
      width: 268,
      height: 256,
    },
    image: absoluteUrl(origin, view.media?.['home.hero.bg'] || '/assets/img/hero-wheat.webp'),
    description: clipDescription(texts['footer.about'] || texts['home.hero.desc'], 240),
    slogan: plainText(texts['global.slogan']),
    foundingDate: '1991',
    email: plainText(texts['global.email']),
    telephone: phones[0] || plainText(texts['global.sales.phone.fa']),
    contactPoint: phones.map((phone) => ({
      '@type': 'ContactPoint',
      telephone: phone,
      contactType: 'sales and customer service',
      availableLanguage: ['fa', 'en', 'ar'],
    })),
    address: offices.map((office) => ({
      '@type': 'PostalAddress',
      name: plainText(office?.title),
      streetAddress: plainText(office?.address),
      addressCountry: 'IR',
    })),
    sameAs: [...new Set(socials)],
  };
}

function schemaGraph(meta, view, origin, entity, shopOffer) {
  const graph = [
    organizationSchema(view, origin),
    {
      '@type': 'WebSite',
      '@id': `${origin}/#website`,
      url: `${origin}/`,
      name: plainText(view.texts?.['global.company.name']),
      description: clipDescription(view.texts?.['global.slogan'], 200),
      publisher: { '@id': `${origin}/#organization` },
      inLanguage: LOCALES.map((item) => item.htmlLang),
    },
    {
      '@type': meta.kind === 'product'
        ? 'ItemPage'
        : meta.kind === 'collection' || meta.kind === 'shop'
          ? 'CollectionPage'
          : 'WebPage',
      '@id': `${meta.canonical}#webpage`,
      url: meta.canonical,
      name: meta.title,
      description: meta.description,
      isPartOf: { '@id': `${origin}/#website` },
      about: { '@id': `${origin}/#organization` },
      primaryImageOfPage: meta.image ? { '@type': 'ImageObject', url: meta.image } : undefined,
      breadcrumb: meta.breadcrumbs.length > 1 ? { '@id': `${meta.canonical}#breadcrumb` } : undefined,
      mainEntity: entity && (meta.kind === 'product' || meta.kind === 'article')
        ? { '@id': `${meta.canonical}#${meta.kind === 'product' ? 'product' : 'article'}` }
        : (meta.kind === 'collection' || meta.kind === 'shop') && meta.links.length
          ? { '@id': `${meta.canonical}#itemlist` }
          : undefined,
      inLanguage: getLocaleMeta(meta.locale).htmlLang,
    },
  ];

  if (meta.breadcrumbs.length > 1) {
    graph.push({
      '@type': 'BreadcrumbList',
      '@id': `${meta.canonical}#breadcrumb`,
      itemListElement: meta.breadcrumbs.map((item, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: item.name,
        item: absoluteUrl(origin, item.path),
      })),
    });
  }

  if ((meta.kind === 'collection' || meta.kind === 'shop') && meta.links.length) {
    graph.push({
      '@type': 'ItemList',
      '@id': `${meta.canonical}#itemlist`,
      itemListElement: meta.links.map((item, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: item.label,
        url: absoluteUrl(origin, item.href),
      })),
    });
  }

  if (meta.kind === 'product' && entity) {
    const brand = asArray(view.brands).find((item) => item?.id === entity.brand);
    const offer = shopOffer?.active
      ? {
          '@type': 'Offer',
          url: absoluteUrl(origin, `/shop/${shopOffer.slug}`),
          priceCurrency: 'IRR',
          price: String(Math.max(0, Number(shopOffer.price) || 0)),
          availability: Number(shopOffer.stock) > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
          itemCondition: 'https://schema.org/NewCondition',
          seller: { '@id': `${origin}/#organization` },
        }
      : undefined;
    graph.push({
      '@type': 'Product',
      '@id': `${meta.canonical}#product`,
      name: plainText(entity.title),
      description: clipDescription(entity.short || entity.summary || entity.description, 500),
      image: [absoluteUrl(origin, entity.image)],
      sku: String(entity.slug),
      category: 'Instant dry yeast',
      brand: brand
        ? { '@type': 'Brand', name: plainText(brand.en || brand.fa || entity.brand) }
        : { '@type': 'Brand', name: plainText(entity.brand) },
      manufacturer: { '@id': `${origin}/#organization` },
      offers: offer,
    });
  }

  if (meta.kind === 'article' && entity) {
    const publishedAt = validIsoDate(entity.publishedAt);
    const updatedAt = validIsoDate(entity.updatedAt) || publishedAt;
    graph.push({
      '@type': 'BlogPosting',
      '@id': `${meta.canonical}#article`,
      mainEntityOfPage: { '@id': `${meta.canonical}#webpage` },
      headline: plainText(entity.title),
      description: clipDescription(entity.excerpt, 300),
      image: [absoluteUrl(origin, entity.image)],
      datePublished: publishedAt || undefined,
      dateModified: updatedAt || undefined,
      articleSection: plainText(entity.category),
      wordCount: plainText(entity.body).split(/\s+/).filter(Boolean).length,
      inLanguage: getLocaleMeta(meta.locale).htmlLang,
      author: { '@id': `${origin}/#organization` },
      publisher: { '@id': `${origin}/#organization` },
    });
  }

  return { '@context': 'https://schema.org', '@graph': graph };
}

/** Resolve one absolute route against a base-language CMS state. */
export function resolveSeo(pathname, state, requestedOrigin = DEFAULT_SITE_ORIGIN) {
  const origin = normalizeOrigin(requestedOrigin);
  const { path, locale, relative } = localeRoute(pathname);
  const localeMeta = getLocaleMeta(locale);
  const view = localizedView(state, locale);
  const texts = view.texts || {};
  const media = view.media || {};
  const site = plainText(texts['global.company.name'] || 'Khuzestan Yeast Co.');
  const storefrontAvailable = shopEnabled(locale) && view.shop?.display?.enabled !== false;
  const fallbackImage = media['home.hero.bg'] || '/assets/img/hero-wheat.webp';

  let route = null;
  let entity = null;
  let shopOffer = null;

  const rawPrivate = /^\/admin(?:\/|$)/.test(path) || (shopEnabled(locale) && PRIVATE_SHOP_ROUTE.test(relative));
  if (rawPrivate) {
    const titleKey = PRIVATE_TITLE_KEYS.find(([pattern]) => pattern.test(relative) || pattern.test(path))?.[1];
    const privateTitle = titleKey === 'admin' ? 'Admin' : plainText(texts[titleKey] || site);
    return {
      path,
      relative,
      locale,
      lang: localeMeta.htmlLang,
      dir: localeMeta.dir,
      status: 200,
      kind: 'private',
      siteName: site,
      shopAvailable: storefrontAvailable,
      indexable: false,
      title: titleWithSite(privateTitle, site),
      description: clipDescription(texts['footer.about'] || texts['global.slogan']),
      canonical: '',
      alternates: [],
      image: absoluteUrl(origin, fallbackImage),
      ogLocale: OG_LOCALE[locale],
      breadcrumbs: [],
      body: [],
      links: [],
      schema: null,
    };
  }

  const staticRoute = STATIC_ROUTES[relative];
  const availableStaticRoute =
    staticRoute &&
    (!staticRoute.locales || staticRoute.locales.includes(locale)) &&
    (relative !== '/shop' || storefrontAvailable);
  if (availableStaticRoute) {
    route = {
      kind: staticRoute.kind || (relative === '/shop' ? 'shop' : relative === '/blog' ? 'collection' : 'page'),
      relative,
      title: plainText(texts[staticRoute.titleKey]),
      seoTitle: plainText(texts[staticRoute.seoTitleKey] || texts[staticRoute.titleKey]),
      description: clipDescription(texts[staticRoute.descriptionKey] || texts['footer.about']),
      image: (relative === '/shop'
        ? asArray(view.shop?.display?.showcase).find((item) => item?.image)?.image
        : '') || media[staticRoute.imageKey] || fallbackImage,
      body: cleanArray(staticRoute.bodyKeys.map((key) => texts[key])),
      links: pageLinks(view, locale, staticRoute, staticRoute.listing),
      locales: staticRoute.locales || LOCALES.map((item) => item.code),
    };
  } else {
    const productMatch = relative.match(/^\/products\/([^/]+)$/);
    const postMatch = relative.match(/^\/blog\/([^/]+)$/);
    const shopMatch = relative.match(/^\/shop\/([^/]+)$/);

    if (productMatch) {
      entity = asArray(view.products).find((item) => item?.slug === productMatch[1]);
      if (entity) {
        shopOffer = view.shop?.display?.enabled === false
          ? null
          : asArray(view.shop?.products).find(
              (item) => item?.active && (item.productSlug ? item.productSlug === entity.slug : item.slug === entity.slug),
            );
        route = {
          kind: 'product',
          relative,
          title: plainText(entity.title),
          seoTitle: plainText(entity.seoTitle || entity.title),
          description: clipDescription(entity.seoDescription || entity.short || entity.summary || entity.description),
          image: entity.image || fallbackImage,
          body: cleanArray([
            entity.short,
            ...asArray(entity.specs).map((pair) => Array.isArray(pair) ? `${pair[0]}: ${pair[1]}` : ''),
          ]),
          links: [],
          locales: LOCALES.map((item) => item.code),
        };
      }
    } else if (postMatch) {
      entity = asArray(view.posts).find((item) => item?.slug === postMatch[1]);
      if (entity) {
        route = {
          kind: 'article',
          relative,
          title: plainText(entity.title),
          seoTitle: plainText(entity.seoTitle || entity.title),
          description: clipDescription(entity.seoDescription || entity.excerpt),
          image: entity.image || fallbackImage,
          body: cleanArray([entity.excerpt, clipDescription(entity.body, 1200)]),
          links: [],
          locales: LOCALES.map((item) => item.code),
        };
      }
    } else if (shopMatch && storefrontAvailable) {
      const item = asArray(view.shop?.products).find((product) => product?.slug === shopMatch[1] && product.active);
      if (item) {
        entity = item;
        shopOffer = item;
        const catalog = asArray(view.products).find((product) => product?.slug === (item.productSlug || item.slug));
        route = {
          kind: 'shop-product',
          relative,
          title: plainText(item.title),
          seoTitle: plainText(item.seoTitle || item.title),
          description: clipDescription(item.seoDescription || item.short || item.description),
          image: item.image || fallbackImage,
          body: cleanArray([
            item.short,
            ...asArray(item.specs).map((pair) => Array.isArray(pair) ? `${pair[0]}: ${pair[1]}` : ''),
          ]),
          links: catalog ? [{ label: plainText(catalog.title), href: `/products/${catalog.slug}`, text: plainText(catalog.short) }] : [],
          locales: ['fa'],
          /* When linked, the catalogue page is the multilingual source of
             product truth; consolidate that duplicate while a genuinely
             standalone shop product keeps its own canonical URL. */
          canonicalRelative: catalog ? `/products/${catalog.slug}` : relative,
          canonicalizedDuplicate: Boolean(catalog),
        };
      }
    }
  }

  if (!route) {
    const notFound = plainText(texts['nf.title'] || 'Page not found');
    return {
      path,
      relative,
      locale,
      lang: localeMeta.htmlLang,
      dir: localeMeta.dir,
      status: 404,
      kind: 'not-found',
      siteName: site,
      shopAvailable: storefrontAvailable,
      indexable: false,
      title: titleWithSite(notFound, site),
      description: clipDescription(texts['nf.text'] || 'The requested page could not be found.'),
      canonical: '',
      alternates: [],
      image: absoluteUrl(origin, fallbackImage),
      ogLocale: OG_LOCALE[locale],
      breadcrumbs: [],
      body: [],
      links: [{ label: plainText(texts['nf.btn'] || 'Home'), href: localePath(locale, '/'), text: '' }],
      schema: null,
    };
  }

  const canonicalRelative = route.canonicalRelative || route.relative;
  const canonicalPath = localePath(locale, canonicalRelative);
  const canonical = absoluteUrl(origin, canonicalPath);
  const title = titleWithSite(route.seoTitle || route.title, site, route.relative === '/');
  const breadcrumbs = breadcrumbItems(view, locale, canonicalRelative, route.title);
  const indexable = true;
  const meta = {
    path,
    relative,
    locale,
    lang: localeMeta.htmlLang,
    dir: localeMeta.dir,
    status: 200,
    kind: route.kind === 'shop-product' ? 'product' : route.kind,
    siteName: site,
    shopAvailable: storefrontAvailable,
    indexable,
    title,
    pageTitle: route.title,
    description: route.description,
    canonical,
    alternates: route.canonicalizedDuplicate ? [] : routeAlternates(route.relative, route.locales, origin),
    image: absoluteUrl(origin, route.image || fallbackImage),
    ogLocale: OG_LOCALE[locale],
    breadcrumbs,
    body: route.body,
    links: route.links,
    entity,
    shopOffer,
  };
  meta.schema = schemaGraph(meta, view, origin, route.canonicalizedDuplicate ? null : entity, shopOffer);
  return meta;
}

export function renderSeoHead(meta, options = {}) {
  const publishedAt = validIsoDate(meta.entity?.publishedAt);
  const updatedAt = validIsoDate(meta.entity?.updatedAt) || publishedAt;
  const robots = meta.indexable
    ? 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'
    : 'noindex, nofollow, noarchive';
  const alternateLocaleTags = meta.alternates
    .filter((item) => item.hreflang !== 'x-default' && item.hreflang !== meta.lang)
    .map((item) => `    <meta property="og:locale:alternate" content="${escapeHtml(OG_LOCALE[item.hreflang] || item.hreflang)}" />`)
    .join('\n');
  const verification = [
    options.googleVerification
      ? `    <meta name="google-site-verification" content="${escapeHtml(options.googleVerification)}" />`
      : '',
    options.bingVerification
      ? `    <meta name="msvalidate.01" content="${escapeHtml(options.bingVerification)}" />`
      : '',
  ].filter(Boolean).join('\n');
  const canonical = meta.canonical ? `    <link rel="canonical" href="${escapeHtml(meta.canonical)}" />` : '';
  const alternates = meta.alternates
    .map((item) => `    <link rel="alternate" hreflang="${escapeHtml(item.hreflang)}" href="${escapeHtml(item.href)}" />`)
    .join('\n');
  const schema = meta.schema
    ? `    <script id="seo-jsonld" type="application/ld+json">${safeJson(meta.schema)}</script>`
    : '';

  return [
    SEO_HEAD_START,
    `    <title>${escapeHtml(meta.title)}</title>`,
    `    <meta name="description" content="${escapeHtml(meta.description)}" />`,
    `    <meta name="robots" content="${robots}" />`,
    `    <meta name="googlebot" content="${robots}" />`,
    canonical,
    alternates,
    `    <meta property="og:site_name" content="${escapeHtml(meta.siteName || meta.title.split(' | ').at(-1))}" />`,
    `    <meta property="og:title" content="${escapeHtml(meta.title)}" />`,
    `    <meta property="og:description" content="${escapeHtml(meta.description)}" />`,
    `    <meta property="og:type" content="${meta.kind === 'article' ? 'article' : meta.kind === 'product' ? 'product' : 'website'}" />`,
    meta.canonical ? `    <meta property="og:url" content="${escapeHtml(meta.canonical)}" />` : '',
    `    <meta property="og:locale" content="${escapeHtml(meta.ogLocale || meta.lang)}" />`,
    alternateLocaleTags,
    `    <meta property="og:image" content="${escapeHtml(meta.image)}" />`,
    `    <meta property="og:image:secure_url" content="${escapeHtml(meta.image)}" />`,
    `    <meta property="og:image:type" content="${/\.png(?:[?#]|$)/i.test(meta.image) ? 'image/png' : /\.jpe?g(?:[?#]|$)/i.test(meta.image) ? 'image/jpeg' : /\.avif(?:[?#]|$)/i.test(meta.image) ? 'image/avif' : 'image/webp'}" />`,
    `    <meta property="og:image:alt" content="${escapeHtml(meta.pageTitle || meta.title)}" />`,
    meta.kind === 'article' && publishedAt
      ? `    <meta property="article:published_time" content="${escapeHtml(publishedAt)}" />`
      : '',
    meta.kind === 'article' && updatedAt
      ? `    <meta property="article:modified_time" content="${escapeHtml(updatedAt)}" />`
      : '',
    meta.kind === 'article' && meta.entity?.category
      ? `    <meta property="article:section" content="${escapeHtml(plainText(meta.entity.category))}" />`
      : '',
    meta.kind === 'product' && meta.shopOffer?.active
      ? `    <meta property="product:price:amount" content="${escapeHtml(String(Math.max(0, Number(meta.shopOffer.price) || 0)))}" />`
      : '',
    meta.kind === 'product' && meta.shopOffer?.active
      ? '    <meta property="product:price:currency" content="IRR" />'
      : '',
    meta.kind === 'product' && meta.shopOffer?.active
      ? `    <meta property="product:availability" content="${Number(meta.shopOffer.stock) > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock'}" />`
      : '',
    '    <meta name="twitter:card" content="summary_large_image" />',
    `    <meta name="twitter:title" content="${escapeHtml(meta.title)}" />`,
    `    <meta name="twitter:description" content="${escapeHtml(meta.description)}" />`,
    `    <meta name="twitter:image" content="${escapeHtml(meta.image)}" />`,
    `    <meta name="twitter:image:alt" content="${escapeHtml(meta.pageTitle || meta.title)}" />`,
    verification,
    schema,
    SEO_HEAD_END,
  ].filter(Boolean).join('\n');
}

function fallbackNavigation(meta) {
  const locale = meta.locale;
  const labels = {
    fa: ['خانه', 'درباره ما', 'محصولات', 'صادرات', 'کیفیت', 'وبلاگ', 'گالری', 'تماس با ما'],
    en: ['Home', 'About', 'Products', 'Export', 'Quality', 'Blog', 'Gallery', 'Contact'],
    ar: ['الرئيسية', 'من نحن', 'المنتجات', 'التصدير', 'الجودة', 'المدونة', 'المعرض', 'اتصل بنا'],
  }[locale] || ['Home', 'About', 'Products', 'Export', 'Quality', 'Blog', 'Gallery', 'Contact'];
  const entries = ['/', '/about', '/products', '/export', '/quality', '/blog', '/gallery', '/contact']
    .map((path, index) => ({ path, label: labels[index] }));
  if (locale === 'fa') entries.splice(-1, 0, { path: '/sales-representatives', label: 'نمایندگان فروش' });
  if (meta.shopAvailable) entries.splice(3, 0, { path: '/shop', label: 'فروشگاه' });
  return `<nav aria-label="${escapeHtml(locale === 'fa' ? 'پیوندهای اصلی' : locale === 'ar' ? 'الروابط الرئيسية' : 'Primary links')}"><ul>${entries
    .map(({ path, label }) => `<li><a href="${escapeHtml(localePath(locale, path))}">${escapeHtml(label)}</a></li>`)
    .join('')}</ul></nav>`;
}

export function renderSeoFallback(meta) {
  const body = meta.body.map((text) => `<p>${escapeHtml(text)}</p>`).join('');
  const links = meta.links.length
    ? `<ul>${meta.links.map((item) => `<li><a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>${item.text ? ` — ${escapeHtml(item.text)}` : ''}</li>`).join('')}</ul>`
    : '';
  return [
    '<div id="root">',
    '<main class="seo-fallback">',
    meta.kind !== 'private' ? fallbackNavigation(meta) : '',
    '<article>',
    `<h1>${escapeHtml(meta.pageTitle || meta.title)}</h1>`,
    `<p>${escapeHtml(meta.description)}</p>`,
    body,
    links,
    '</article>',
    '</main>',
    '</div>',
  ].join('');
}

export function renderSeoDocument(template, meta, options = {}) {
  const head = renderSeoHead(meta, options);
  let html = String(template || '');
  if (!html.includes(SEO_HEAD_START) || !html.includes(SEO_HEAD_END)) {
    throw new Error('SEO head markers are missing from the HTML template');
  }
  html = html.replace(new RegExp(`${SEO_HEAD_START}[\\s\\S]*?${SEO_HEAD_END}`), head);
  html = html.replace(/<html\b([^>]*)>/i, (_all, attrs) => {
    let next = attrs.replace(/\s(?:lang|dir)="[^"]*"/gi, '');
    return `<html lang="${escapeHtml(meta.lang)}" dir="${escapeHtml(meta.dir)}"${next}>`;
  });
  if (!/<div id="root"><\/div>/.test(html)) throw new Error('empty React root is missing from the HTML template');
  html = html.replace('<div id="root"></div>', renderSeoFallback(meta));
  return html;
}

export function listIndexablePaths(state) {
  const paths = [];
  const addLocalized = (relative, locales = LOCALES.map((item) => item.code)) => {
    for (const locale of locales) paths.push(localePath(locale, relative));
  };

  for (const [relative, route] of Object.entries(STATIC_ROUTES)) {
    if (relative === '/shop' && state?.shop?.display?.enabled === false) continue;
    addLocalized(relative, route.locales || LOCALES.map((item) => item.code));
  }
  for (const product of asArray(state?.products)) {
    if (validSlug(product?.slug)) addLocalized(`/products/${product.slug}`);
  }
  for (const post of asArray(state?.posts)) {
    if (validSlug(post?.slug)) addLocalized(`/blog/${post.slug}`);
  }
  if (state?.shop?.display?.enabled !== false) {
    for (const item of asArray(state?.shop?.products)) {
      if (!item?.active || !validSlug(item.slug)) continue;
      const catalogueSlug = item.productSlug || item.slug;
      const isCatalogueDuplicate = asArray(state?.products).some((product) => product?.slug === catalogueSlug);
      if (!isCatalogueDuplicate) paths.push(`/shop/${item.slug}`);
    }
  }
  return [...new Set(paths)];
}

/* Routes that need an HTML shell are a superset of sitemap URLs: shop products
   linked to a catalogue counterpart remain customer-facing but canonicalize
   there, while genuinely standalone shop products are already in the sitemap. */
export function listRoutablePaths(state) {
  const paths = listIndexablePaths(state);
  if (state?.shop?.display?.enabled !== false) {
    for (const product of asArray(state?.shop?.products)) {
      if (product?.active && validSlug(product.slug)) paths.push(`/shop/${product.slug}`);
    }
  }
  return [...new Set(paths)];
}

export function renderSitemap(state, origin = DEFAULT_SITE_ORIGIN) {
  const siteOrigin = normalizeOrigin(origin);
  const urls = listIndexablePaths(state)
    .map((path) => resolveSeo(path, state, siteOrigin))
    .filter((meta) => meta.indexable && meta.canonical === absoluteUrl(siteOrigin, meta.path));

  const entries = urls.map((meta) => {
    const alternates = meta.alternates
      .map((item) => `    <xhtml:link rel="alternate" hreflang="${escapeXml(item.hreflang)}" href="${escapeXml(item.href)}" />`)
      .join('\n');
    const image = meta.image
      ? `    <image:image><image:loc>${escapeXml(meta.image)}</image:loc><image:title>${escapeXml(meta.pageTitle || meta.title)}</image:title></image:image>`
      : '';
    const lastmod = validIsoDate(meta.entity?.updatedAt) || validIsoDate(meta.entity?.publishedAt);
    return [
      '  <url>',
      `    <loc>${escapeXml(meta.canonical)}</loc>`,
      lastmod ? `    <lastmod>${escapeXml(lastmod)}</lastmod>` : '',
      alternates,
      image,
      '  </url>',
    ].filter(Boolean).join('\n');
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
    ...entries,
    '</urlset>',
    '',
  ].join('\n');
}

export function renderRobots(origin = DEFAULT_SITE_ORIGIN) {
  const siteOrigin = normalizeOrigin(origin);
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /seo-pages/',
    '',
    `Sitemap: ${siteOrigin}/sitemap.xml`,
    '',
  ].join('\n');
}
