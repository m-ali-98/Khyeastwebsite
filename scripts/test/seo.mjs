import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import DEFAULT_STATE from '../../shared/contentDefaults.js';
import { mergeContentState } from '../../shared/contentState.js';
import { loadAllPacks } from '../../shared/i18n/index.js';
import { normalizePublicView } from '../../shared/persianCopy.js';
import {
  listIndexablePaths,
  listRoutablePaths,
  normalizeOrigin,
  redirectPath,
  renderRobots,
  renderSeoDocument,
  renderSitemap,
  resolveSeo,
} from '../../shared/seo.js';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const DIST = path.join(ROOT, 'dist');
const ORIGIN = 'https://khuzestanyeast-co.com';
// The build can deliberately use a different public origin, as the updater
// does. Pure resolver checks remain pinned to the stable fixture above.
const BUILD_ORIGIN = normalizeOrigin(process.env.SEO_ORIGIN || process.env.PUBLIC_ORIGIN || ORIGIN);
let pass = 0;
let total = 0;
const leaks = [];
const check = (condition, label, detail = '') => {
  total++;
  if (condition) pass++;
  else leaks.push(`LEAK ${label}${detail ? ` — ${detail}` : ''}`);
};

await loadAllPacks();

const home = resolveSeo('/', DEFAULT_STATE, ORIGIN);
const enAbout = resolveSeo('/en/about', DEFAULT_STATE, ORIGIN);
const arQuality = resolveSeo('/ar/quality', DEFAULT_STATE, ORIGIN);
const ruAbout = resolveSeo('/ru/about', DEFAULT_STATE, ORIGIN);
const product = resolveSeo('/products/dezmaye-gold-80', DEFAULT_STATE, ORIGIN);
const ruProduct = resolveSeo('/ru/products/dezmaye-gold-80', DEFAULT_STATE, ORIGIN);
const article = resolveSeo('/blog/yeast-types-for-baking', DEFAULT_STATE, ORIGIN);
const ruArticle = resolveSeo('/ru/blog/yeast-types-for-baking', DEFAULT_STATE, ORIGIN);
const gallery = resolveSeo('/en/gallery', DEFAULT_STATE, ORIGIN);
const salesRepresentatives = resolveSeo('/sales-representatives', DEFAULT_STATE, ORIGIN);
const invalidLocaleSalesRepresentatives = resolveSeo('/en/sales-representatives', DEFAULT_STATE, ORIGIN);
const shopProduct = resolveSeo('/shop/dezmaye-gold-80', DEFAULT_STATE, ORIGIN);
const shop = resolveSeo('/shop', DEFAULT_STATE, ORIGIN);
const account = resolveSeo('/shop/account', DEFAULT_STATE, ORIGIN);
const admin = resolveSeo('/admin', DEFAULT_STATE, ORIGIN);
const missing = resolveSeo('/does-not-exist', DEFAULT_STATE, ORIGIN);
const invalidLocaleShop = resolveSeo('/en/shop', DEFAULT_STATE, ORIGIN);

check(home.indexable && home.status === 200, 'home indexable');
check(home.homeStats.length === 4 && home.homeStats[0].value === '۳۰' && home.homeStats[3].value === '۵۰', 'homepage fallback exposes actual statistics without JavaScript');
const legacyCopy = structuredClone(DEFAULT_STATE);
legacyCopy.texts['global.company.name'] = 'شرکت خمیر مایه خوزستان';
legacyCopy.texts['seo.home.title'] = 'خمیر مایه خوزستان';
check(!resolveSeo('/', legacyCopy, ORIGIN).title.includes('خمیر مایه'), 'legacy saved SEO copy uses consistent Persian spelling');
const authored = { products: [{ slug: 'خمیر مایه', title: 'خمیر مایه', description: '<a href="/خمیر مایه">خمیر مایه</a>' }] };
const normalized = normalizePublicView(authored);
check(normalized.products[0].title === 'خمیرمایه' && normalized.products[0].description === '<a href="/خمیر مایه">خمیرمایه</a>' && normalized.products[0].slug === 'خمیر مایه' && authored.products[0].title === 'خمیر مایه', 'public copy normalization preserves authored URLs, IDs and stored state');
check(home.canonical === `${ORIGIN}/`, 'home canonical');
check(home.alternates.length === 5, 'home has 4 locales plus x-default');
check(home.alternates.some((alternate) => alternate.hreflang === 'ru' && alternate.href === `${ORIGIN}/ru`), 'Russian homepage is in hreflang alternates');
check(ruProduct.alternates.some((alternate) => alternate.hreflang === 'ru' && alternate.href === `${ORIGIN}/ru/products/dezmaye-gold-80`), 'Russian product route has a localized canonical alternate');
const hostileSocialState = structuredClone(DEFAULT_STATE);
hostileSocialState.collections.socials = [
  hostileSocialState.collections.socials[0],
  { id: 'unsafe-js', label: 'unsafe', href: 'javascript:alert(1)' },
  { id: 'unsafe-data', label: 'unsafe', href: 'data:text/html,<script>alert(1)</script>' },
];
const hostileOrganization = resolveSeo('/', hostileSocialState, ORIGIN).schema?.['@graph']
  ?.find((item) => item['@type'] === 'Organization');
check(
  hostileOrganization?.sameAs?.length === 1 && hostileOrganization.sameAs[0].startsWith('https://wa.me/'),
  'legacy unsafe social hrefs are omitted from public structured data',
  JSON.stringify(hostileOrganization?.sameAs),
);
check(enAbout.lang === 'en' && enAbout.dir === 'ltr', 'English language and direction');
check(!enAbout.title.includes('Khuzestan Yeast Co. | Khuzestan Yeast Co.'), 'title does not duplicate company name');
check(arQuality.lang === 'ar' && arQuality.dir === 'rtl', 'Arabic language and direction');
check(ruAbout.lang === 'ru' && ruAbout.dir === 'ltr' && ruAbout.ogLocale === 'ru_RU', 'Russian language, direction and Open Graph locale');
check(ruAbout.title.includes('О компании') && !/[\u0600-\u06ff]/u.test(ruAbout.title + ruAbout.description), 'Russian metadata has no Persian or Arabic fallback');
check(ruProduct.lang === 'ru' && /[А-Яа-яЁё]/u.test(ruProduct.pageTitle) && !/[\u0600-\u06ff]/u.test(ruProduct.title + ruProduct.description), 'Russian product metadata is localized');
check(ruArticle.kind === 'article' && /[А-Яа-яЁё]/u.test(ruArticle.pageTitle) && !/[\u0600-\u06ff]/u.test(ruArticle.title + ruArticle.description), 'Russian editorial metadata is localized');
check(new Set([home.description, enAbout.description, arQuality.description, ruAbout.description]).size === 4, 'descriptions are route/locale specific');
check(product.schema?.['@graph']?.some((item) => item['@type'] === 'Product'), 'Product JSON-LD');
check(product.schema?.['@graph']?.some((item) => item['@type'] === 'Product' && item.offers?.priceCurrency === 'IRR'), 'Product Offer in IRR');
for (const [stock, availability] of [
  [-1, 'https://schema.org/InStock'],
  [0, 'https://schema.org/OutOfStock'],
  [4, 'https://schema.org/InStock'],
]) {
  const state = structuredClone(DEFAULT_STATE);
  state.shop.products.find((item) => item.productSlug === 'dezmaye-gold-80').stock = stock;
  const offer = resolveSeo('/products/dezmaye-gold-80', state, ORIGIN).schema?.['@graph']
    ?.find((item) => item['@type'] === 'Product')?.offers;
  check(offer?.availability === availability, `shop inventory ${stock} maps to correct Product availability`, offer?.availability);
}
check(article.schema?.['@graph']?.some((item) => item['@type'] === 'BlogPosting'), 'BlogPosting JSON-LD');
check(article.schema?.['@graph']?.some((item) => item['@type'] === 'WebPage'), 'article is attached to a valid WebPage schema type');
check(article.schema?.['@graph']?.some((item) => item['@type'] === 'BlogPosting' && item.datePublished === '2026-09-08'), 'article ISO publication date');
const catalogueGraph = resolveSeo('/products', DEFAULT_STATE, ORIGIN).schema?.['@graph'] || [];
check(catalogueGraph.some((item) => item['@type'] === 'CollectionPage'), 'catalogue CollectionPage JSON-LD');
check(catalogueGraph.some((item) => item['@type'] === 'ItemList'), 'catalogue ItemList JSON-LD');
check(gallery.kind === 'collection' && gallery.links.length === DEFAULT_STATE.gallery.length, 'gallery is a localized collection');
check(gallery.schema?.['@graph']?.some((item) => item['@type'] === 'ItemList' && item.itemListElement.length === DEFAULT_STATE.gallery.length), 'gallery ItemList JSON-LD');
check(gallery.links.every((item) => item.href.startsWith('/en/gallery#')), 'gallery fallback links address localized media cards');
check(
  salesRepresentatives.indexable && salesRepresentatives.links.length === DEFAULT_STATE.collections.salesRepresentatives.length,
  'Persian sales representative map is an indexable collection',
);
check(
  salesRepresentatives.alternates.length === 2 && salesRepresentatives.alternates.every((item) => ['fa', 'x-default'].includes(item.hreflang)),
  'sales representative map emits Persian-only alternates',
);
check(invalidLocaleSalesRepresentatives.status === 404, 'non-Persian sales representative map is a 404');
check(shopProduct.canonical === `${ORIGIN}/products/dezmaye-gold-80`, 'shop duplicate consolidates into catalogue URL');
check(shopProduct.alternates.length === 0, 'shop duplicate does not emit misleading hreflang');
const standaloneState = structuredClone(DEFAULT_STATE);
standaloneState.shop.products.push({
  ...standaloneState.shop.products[0],
  slug: 'standalone-shop-item',
  productSlug: '',
  title: 'محصول مستقل فروشگاه',
});
const standaloneShop = resolveSeo('/shop/standalone-shop-item', standaloneState, ORIGIN);
check(listIndexablePaths(standaloneState).includes('/shop/standalone-shop-item'), 'standalone shop product enters the sitemap');
check(standaloneShop.canonical === `${ORIGIN}/shop/standalone-shop-item` && standaloneShop.alternates.length === 2, 'standalone shop product keeps a self canonical and Persian alternates');
check(standaloneShop.schema?.['@graph']?.some((item) => item['@type'] === 'Product' && item.offers), 'standalone shop product publishes Product/Offer schema');
check(shop.alternates.length === 2 && shop.alternates.every((item) => item.hreflang === 'fa' || item.hreflang === 'x-default'), 'Persian-only shop alternates');
check(shop.title === 'خرید خمیرمایه خشک فوری | فروشگاه خمیرمایه خوزستان', 'shop has a concise commercial title');
check(shop.image === `${ORIGIN}/assets/img/bread-slicing.webp`, 'shop social image follows its first showcase slide');
const customShowcaseState = structuredClone(DEFAULT_STATE);
customShowcaseState.shop.display.showcase[0].image = '/assets/img/factory.webp';
check(resolveSeo('/shop', customShowcaseState, ORIGIN).image === `${ORIGIN}/assets/img/factory.webp`, 'edited showcase image feeds shop social metadata');
const partialShopState = mergeContentState(DEFAULT_STATE, { shop: { display: { enabled: true }, products: [] } });
check(Array.isArray(partialShopState.shop.display.showcase) && partialShopState.shop.display.showcase.length === 1, 'missing showcase settings inherit safe defaults');
const malformedShowcaseState = mergeContentState(DEFAULT_STATE, { shop: { display: { showcase: [null, 'bad'] }, products: [] } });
check(malformedShowcaseState.shop.display.showcase[0]?.image === '/assets/img/bread-slicing.webp', 'malformed showcase rows fall back safely');
check(!account.indexable && account.status === 200, 'account noindex');
check(!admin.indexable && admin.status === 200, 'admin noindex');
check(!missing.indexable && missing.status === 404, 'unknown route is a 404');
check(resolveSeo('/administrator', DEFAULT_STATE, ORIGIN).status === 404, 'admin-like unknown path cannot become a soft 200');
check(invalidLocaleShop.status === 404, 'non-Persian shop is a 404');
check(resolveSeo('/ru/shop', DEFAULT_STATE, ORIGIN).status === 404, 'Russian storefront and checkout remain unavailable by scope');
check(resolveSeo('/ru/sales-representatives', DEFAULT_STATE, ORIGIN).status === 404, 'Iran-only sales representative map stays Persian-only');
check(resolveSeo('/en/shop/account', DEFAULT_STATE, ORIGIN).status === 404, 'non-Persian private shop route is also a 404');
check(resolveSeo('/shop/cart/extra', DEFAULT_STATE, ORIGIN).status === 404, 'private-looking nested path cannot become a soft 200');
check(resolveSeo('/shop/order', DEFAULT_STATE, ORIGIN).status === 404, 'order route without a code is a 404');
const closedShopState = structuredClone(DEFAULT_STATE);
closedShopState.shop.display.enabled = false;
check(resolveSeo('/shop', closedShopState, ORIGIN).status === 404 && !listRoutablePaths(closedShopState).includes('/shop'), 'disabled storefront leaves no indexable shop shell');
const pausedOrderRoute = resolveSeo('/shop/order/KY-PRIVATE-123', closedShopState, ORIGIN);
const pausedLoginRoute = resolveSeo('/shop/login', closedShopState, ORIGIN);
const pausedAccountRoute = resolveSeo('/shop/account', closedShopState, ORIGIN);
check(
  pausedOrderRoute.kind === 'private' && !pausedOrderRoute.indexable && !pausedOrderRoute.canonical &&
    pausedLoginRoute.kind === 'private' && !pausedLoginRoute.indexable &&
    pausedAccountRoute.kind === 'private' && !pausedAccountRoute.indexable,
  'login, account and existing order routes stay private and noindex while the storefront is paused',
);
check(
  resolveSeo('/shop/cart', closedShopState, ORIGIN).status === 404 &&
    resolveSeo('/shop/checkout', closedShopState, ORIGIN).status === 404,
  'paused cart and checkout SSR routes return 404 like the client router',
);
check(redirectPath('/dezmaye') === '/products/dezmaye-gold-80', 'legacy brand permanent target');
check(redirectPath('/en/dezmaye') === '/en/products/dezmaye-gold-80', 'localized legacy target');
check(redirectPath('/fa/dezmaye/') === '/products/dezmaye-gold-80', 'combined prefix/slash/legacy redirect is single-hop');
check(redirectPath('/nanmaye') === '/products/nanmaye-500', 'legacy Nan Maye target is a recovered catalogue variant');
check(redirectPath('/ar/nanmaye') === '/ar/products/nanmaye-500', 'localized Nan Maye legacy target');
check(redirectPath('/about/') === '/about', 'trailing slash canonical target');
check(redirectPath('/fa/products') === '/products', 'default locale prefix target');
check(redirectPath('/index.html') === '/', 'index file canonical target');
check(redirectPath('/blog/reduce-bread-production-costs') === '/blog/yeast-buying-guide', 'former cost article permanently redirects to the imported buying guide');
check(redirectPath('/ru/blog/yeast-quality-and-bread-shelf-life') === '/ru/blog/how-to-identify-quality-yeast', 'localized former quality article permanently redirects to the imported quality guide');
check(redirectPath('/en/%d8%aa%d9%81%d8%a7%d9%88%d8%aa-%d8%ae%d9%85%db%8c%d8%b1%d9%85%d8%a7%db%8c%d9%87-%d8%aa%d8%a7%d8%b2%d9%87-%d9%88-%d8%ae%d8%b4%da%a9/') === '/en/blog/fresh-vs-dry-yeast', 'percent-encoded legacy WordPress article path redirects to its localized blog route');

const paths = listIndexablePaths(DEFAULT_STATE);
check(paths.length === 179, 'all current public locale routes enumerated', String(paths.length));
check(new Set(paths).size === paths.length, 'route enumeration has no duplicates');
check(
  paths.filter((entry) => entry.startsWith('/shop/')).join(',') === '/shop/nanmaye-10',
  'catalogue duplicates stay excluded while the standalone Nan Maye shop SKU is indexable',
);
check(paths.includes('/shop') && !paths.includes('/en/shop') && !paths.includes('/ar/shop') && !paths.includes('/ru/shop'), 'shop listed in Persian only');
check(!paths.includes('/ru/sales-representatives') && paths.includes('/ru/products/dezmaye-gold-80') && paths.includes('/ru/blog/yeast-types-for-baking') && paths.includes('/ru/blog/yeast-buying-guide'), 'Russian catalogue and imported blog routes are indexed while Iran-only representatives are not');
const routable = listRoutablePaths(DEFAULT_STATE);
check(routable.length === 185, 'four-locale public catalogue/blog plus Persian-only representatives and shop routes are rendered');
check(routable.includes('/shop/dezmaye-gold-80'), 'canonicalized shop product remains routable');
const allMeta = paths.map((route) => resolveSeo(route, DEFAULT_STATE, ORIGIN));
check(new Set(allMeta.map((meta) => meta.title)).size === allMeta.length, 'every sitemap page has a unique title');
check(new Set(allMeta.map((meta) => meta.description)).size === allMeta.length, 'every sitemap page has a unique description');
check(allMeta.every((meta) => meta.title.length <= 70 && meta.description.length <= 160), 'search titles and descriptions stay within useful display lengths');
const malformedState = structuredClone(DEFAULT_STATE);
malformedState.shop.products = 'not-an-array';
malformedState.collections.offices = 'not-an-array';
let malformedSafe = false;
try {
  malformedSafe = resolveSeo('/', malformedState, ORIGIN).status === 200;
} catch {}
check(malformedSafe, 'malformed nested CMS lists cannot crash SEO rendering');

const sitemap = renderSitemap(DEFAULT_STATE, ORIGIN);
check(sitemap.startsWith('<?xml version="1.0"'), 'sitemap XML declaration');
check(sitemap.includes('<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>'), 'sitemap links an optional browser-only visual stylesheet');
check((sitemap.match(/<url>/g) || []).length === paths.length, 'one sitemap entry per route');
check(sitemap.includes('xmlns:xhtml=') && sitemap.includes('hreflang="x-default"'), 'sitemap hreflang namespace and x-default');
check(sitemap.includes('<lastmod>2026-09-08</lastmod>'), 'sitemap imported article lastmod');
check(sitemap.includes('<image:image>'), 'image sitemap entries');
check(!sitemap.includes('/shop/account') && !sitemap.includes('/admin'), 'sitemap excludes private routes');
check(!sitemap.includes('/en/shop'), 'sitemap excludes invalid locale shop');

const robots = renderRobots(ORIGIN);
check(robots.includes('User-agent: *') && robots.includes('Allow: /'), 'robots permits public crawl');
check(robots.includes(`Sitemap: ${ORIGIN}/sitemap.xml`), 'robots advertises sitemap');
check(robots.includes('Disallow: /api/'), 'robots excludes APIs');

const builtIndex = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
const builtEnAbout = fs.readFileSync(path.join(DIST, 'seo-pages', 'en--about.html'), 'utf8');
const builtEnGallery = fs.readFileSync(path.join(DIST, 'seo-pages', 'en--gallery.html'), 'utf8');
const builtRuAbout = fs.readFileSync(path.join(DIST, 'seo-pages', 'ru--about.html'), 'utf8');
const builtRuProduct = fs.readFileSync(path.join(DIST, 'seo-pages', 'ru--products--dezmaye-gold-80.html'), 'utf8');
const builtSalesRepresentatives = fs.readFileSync(path.join(DIST, 'seo-pages', 'sales-representatives.html'), 'utf8');
const builtProduct = fs.readFileSync(path.join(DIST, 'seo-pages', 'products--dezmaye-gold-80.html'), 'utf8');
const builtPrivate = fs.readFileSync(path.join(DIST, 'seo-pages', '_private.html'), 'utf8');
const built404 = fs.readFileSync(path.join(DIST, '404.html'), 'utf8');
const builtHtaccess = fs.readFileSync(path.join(DIST, '.htaccess'), 'utf8');
const builtSitemapStylesheet = fs.readFileSync(path.join(DIST, 'sitemap.xsl'), 'utf8');
check(builtIndex.includes('<main class="seo-fallback">'), 'root has crawlable fallback content');
check(builtIndex.includes('۳۰+ سال سابقه') && builtIndex.includes('۵۰+ کشور صادراتی'), 'initial HTML includes actual homepage statistics');
check(builtIndex.includes('application/ld+json'), 'root has structured data before JavaScript');
check(builtEnAbout.includes('<html lang="en" dir="ltr"'), 'built English document language');
check(builtEnAbout.includes('<h1>About Khuzestan Yeast Co.</h1>'), 'built route-specific fallback heading');
check(builtEnAbout.includes(`rel="canonical" href="${BUILD_ORIGIN}/en/about"`), 'built route-specific canonical');
check(builtRuAbout.includes('<html lang="ru" dir="ltr"') && builtRuAbout.includes('<h1>О компании «Хузестан Йист»</h1>'), 'built Russian document has Cyrillic content and LTR metadata');
check(builtRuProduct.includes('Инстантные сухие дрожжи') && builtRuProduct.includes(`hreflang="ru" href="${BUILD_ORIGIN}/ru/products/dezmaye-gold-80"`), 'built Russian product page and metadata alternate render');
check(builtEnGallery.includes('A Look at Khuzestan Yeast Products') && builtEnGallery.includes('gallery#product-range'), 'built gallery exposes localized crawlable item links');
check(
  builtSalesRepresentatives.includes('نمایندگان فروش خمیرمایه خوزستان') && builtSalesRepresentatives.includes('sales-representatives#sales-rep-001'),
  'built Persian representative page exposes crawlable representative links',
);
check(builtProduct.includes('"@type":"Product"') && builtProduct.includes('"@type":"Offer"'), 'built product schema and offer');
check(builtPrivate.includes('content="noindex, nofollow, noarchive"'), 'static private shell noindex');
check(built404.includes('content="noindex, nofollow, noarchive"'), 'static 404 shell noindex');
check(fs.readFileSync(path.join(DIST, 'robots.txt'), 'utf8') === renderRobots(BUILD_ORIGIN), 'built robots matches resolver');
check(fs.readFileSync(path.join(DIST, 'sitemap.xml'), 'utf8') === renderSitemap(DEFAULT_STATE, BUILD_ORIGIN), 'built sitemap matches resolver');
check(
  builtSitemapStylesheet.includes('<xsl:stylesheet') && builtSitemapStylesheet.includes('doctype-system="about:legacy-compat"') && builtSitemapStylesheet.includes('Public canonical pages') && builtSitemapStylesheet.includes('@media (max-width: 740px)') && builtSitemapStylesheet.includes('prefers-color-scheme: dark'),
  'built sitemap stylesheet provides responsive, accessible light/dark presentation',
);
check(builtHtaccess.includes('AddType text/xsl .xsl') && builtHtaccess.includes('FilesMatch "\\.xsl$"'), 'Apache serves and revalidates the sitemap stylesheet');
check(builtHtaccess.includes('RewriteRule ^en/about$ /seo-pages/en--about.html [L]'), 'Apache maps localized route to prerender');
check(builtHtaccess.includes('RewriteRule . - [R=404,L]'), 'Apache returns genuine unknown-route 404');
check(builtHtaccess.includes('X-Robots-Tag "noindex, nofollow, noarchive"'), 'Apache sends noindex header for private and 404 shells');
check(builtHtaccess.includes('RewriteRule ^(?:fa/)?dezmaye/?$ /products/dezmaye-gold-80 [R=301,L]'), 'Apache sends a single permanent legacy redirect');
check(builtHtaccess.includes('RewriteRule ^(?:fa/)?nanmaye/?$ /products/nanmaye-500 [R=301,L]'), 'Apache sends Nan Maye aliases to a real catalogue variant');

/* Admin text is escaped in visible fallback and escaped inside JSON-LD. */
const hostile = structuredClone(DEFAULT_STATE);
hostile.products.find(({ slug }) => slug === 'dezmaye-gold-80').title = '<script>alert(1)</script> Yeast';
const hostileMeta = resolveSeo('/products/dezmaye-gold-80', hostile, ORIGIN);
const template = fs.readFileSync(path.join(DIST, 'seo-pages', '_template.html'), 'utf8');
const hostileHtml = renderSeoDocument(template, hostileMeta);
check(!hostileHtml.includes('<h1><script>'), 'fallback escapes CMS title');
check(!hostileHtml.includes('"name":"<script>'), 'JSON-LD escapes opening tags');
check(hostileHtml.includes('>Yeast</h1>'), 'sanitized CMS title remains readable');

for (const line of leaks) console.log(line);
console.log(`${pass}/${total}`);
if (pass !== total) process.exitCode = 1;
