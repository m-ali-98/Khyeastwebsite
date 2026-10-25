import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import DEFAULT_STATE from '../../shared/contentDefaults.js';
import { mergeContentState } from '../../shared/contentState.js';
import { loadAllPacks } from '../../shared/i18n/index.js';
import {
  listIndexablePaths,
  listRoutablePaths,
  redirectPath,
  renderRobots,
  renderSeoDocument,
  renderSitemap,
  resolveSeo,
} from '../../shared/seo.js';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const DIST = path.join(ROOT, 'dist');
const ORIGIN = 'https://khuzestanyeast-co.com';
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
const product = resolveSeo('/products/dezmaye-gold-80', DEFAULT_STATE, ORIGIN);
const article = resolveSeo('/blog/reduce-bread-production-costs', DEFAULT_STATE, ORIGIN);
const shopProduct = resolveSeo('/shop/dezmaye-gold-80', DEFAULT_STATE, ORIGIN);
const shop = resolveSeo('/shop', DEFAULT_STATE, ORIGIN);
const account = resolveSeo('/shop/account', DEFAULT_STATE, ORIGIN);
const admin = resolveSeo('/admin', DEFAULT_STATE, ORIGIN);
const missing = resolveSeo('/does-not-exist', DEFAULT_STATE, ORIGIN);
const invalidLocaleShop = resolveSeo('/en/shop', DEFAULT_STATE, ORIGIN);

check(home.indexable && home.status === 200, 'home indexable');
check(home.canonical === `${ORIGIN}/`, 'home canonical');
check(home.alternates.length === 4, 'home has 3 locales plus x-default');
check(enAbout.lang === 'en' && enAbout.dir === 'ltr', 'English language and direction');
check(!enAbout.title.includes('Khuzestan Yeast Co. | Khuzestan Yeast Co.'), 'title does not duplicate company name');
check(arQuality.lang === 'ar' && arQuality.dir === 'rtl', 'Arabic language and direction');
check(new Set([home.description, enAbout.description, arQuality.description]).size === 3, 'descriptions are route/locale specific');
check(product.schema?.['@graph']?.some((item) => item['@type'] === 'Product'), 'Product JSON-LD');
check(product.schema?.['@graph']?.some((item) => item['@type'] === 'Product' && item.offers?.priceCurrency === 'IRR'), 'Product Offer in IRR');
check(article.schema?.['@graph']?.some((item) => item['@type'] === 'BlogPosting'), 'BlogPosting JSON-LD');
check(article.schema?.['@graph']?.some((item) => item['@type'] === 'WebPage'), 'article is attached to a valid WebPage schema type');
check(article.schema?.['@graph']?.some((item) => item['@type'] === 'BlogPosting' && item.datePublished === '2026-08-16'), 'article ISO publication date');
const catalogueGraph = resolveSeo('/products', DEFAULT_STATE, ORIGIN).schema?.['@graph'] || [];
check(catalogueGraph.some((item) => item['@type'] === 'CollectionPage'), 'catalogue CollectionPage JSON-LD');
check(catalogueGraph.some((item) => item['@type'] === 'ItemList'), 'catalogue ItemList JSON-LD');
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
const legacyShopState = mergeContentState(DEFAULT_STATE, { shop: { display: { enabled: true }, products: [] } });
check(Array.isArray(legacyShopState.shop.display.showcase) && legacyShopState.shop.display.showcase.length === 1, 'new showcase defaults migrate into legacy shop settings');
const malformedShowcaseState = mergeContentState(DEFAULT_STATE, { shop: { display: { showcase: [null, 'bad'] }, products: [] } });
check(malformedShowcaseState.shop.display.showcase[0]?.image === '/assets/img/bread-slicing.webp', 'malformed showcase rows fall back safely');
check(!account.indexable && account.status === 200, 'account noindex');
check(!admin.indexable && admin.status === 200, 'admin noindex');
check(!missing.indexable && missing.status === 404, 'unknown route is a 404');
check(resolveSeo('/administrator', DEFAULT_STATE, ORIGIN).status === 404, 'admin-like unknown path cannot become a soft 200');
check(invalidLocaleShop.status === 404, 'non-Persian shop is a 404');
check(resolveSeo('/en/shop/account', DEFAULT_STATE, ORIGIN).status === 404, 'non-Persian private shop route is also a 404');
check(resolveSeo('/shop/cart/extra', DEFAULT_STATE, ORIGIN).status === 404, 'private-looking nested path cannot become a soft 200');
check(resolveSeo('/shop/order', DEFAULT_STATE, ORIGIN).status === 404, 'order route without a code is a 404');
const closedShopState = structuredClone(DEFAULT_STATE);
closedShopState.shop.display.enabled = false;
check(resolveSeo('/shop', closedShopState, ORIGIN).status === 404 && !listRoutablePaths(closedShopState).includes('/shop'), 'disabled storefront leaves no indexable shop shell');
check(redirectPath('/dezmaye') === '/products/dezmaye-gold-80', 'legacy brand permanent target');
check(redirectPath('/en/dezmaye') === '/en/products/dezmaye-gold-80', 'localized legacy target');
check(redirectPath('/fa/dezmaye/') === '/products/dezmaye-gold-80', 'combined prefix/slash/legacy redirect is single-hop');
check(redirectPath('/about/') === '/about', 'trailing slash canonical target');
check(redirectPath('/fa/products') === '/products', 'default locale prefix target');
check(redirectPath('/index.html') === '/', 'index file canonical target');

const paths = listIndexablePaths(DEFAULT_STATE);
check(paths.length === 55, 'all current public locale routes enumerated', String(paths.length));
check(new Set(paths).size === paths.length, 'route enumeration has no duplicates');
check(!paths.some((entry) => entry.includes('/shop/')), 'transaction/product duplicates excluded from sitemap list');
check(paths.includes('/shop') && !paths.includes('/en/shop') && !paths.includes('/ar/shop'), 'shop listed in Persian only');
const routable = listRoutablePaths(DEFAULT_STATE);
check(routable.length === 62, 'catalogue plus seven customer-facing shop products are rendered');
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
check((sitemap.match(/<url>/g) || []).length === paths.length, 'one sitemap entry per route');
check(sitemap.includes('xmlns:xhtml=') && sitemap.includes('hreflang="x-default"'), 'sitemap hreflang namespace and x-default');
check(sitemap.includes('<lastmod>2026-08-16</lastmod>'), 'sitemap article lastmod');
check(sitemap.includes('<image:image>'), 'image sitemap entries');
check(!sitemap.includes('/shop/account') && !sitemap.includes('/admin'), 'sitemap excludes private routes');
check(!sitemap.includes('/en/shop'), 'sitemap excludes invalid locale shop');

const robots = renderRobots(ORIGIN);
check(robots.includes('User-agent: *') && robots.includes('Allow: /'), 'robots permits public crawl');
check(robots.includes(`Sitemap: ${ORIGIN}/sitemap.xml`), 'robots advertises sitemap');
check(robots.includes('Disallow: /api/'), 'robots excludes APIs');

const builtIndex = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
const builtEnAbout = fs.readFileSync(path.join(DIST, 'seo-pages', 'en--about.html'), 'utf8');
const builtProduct = fs.readFileSync(path.join(DIST, 'seo-pages', 'products--dezmaye-gold-80.html'), 'utf8');
const builtPrivate = fs.readFileSync(path.join(DIST, 'seo-pages', '_private.html'), 'utf8');
const built404 = fs.readFileSync(path.join(DIST, '404.html'), 'utf8');
const builtHtaccess = fs.readFileSync(path.join(DIST, '.htaccess'), 'utf8');
check(builtIndex.includes('<main class="seo-fallback">'), 'root has crawlable fallback content');
check(builtIndex.includes('application/ld+json'), 'root has structured data before JavaScript');
check(builtEnAbout.includes('<html lang="en" dir="ltr"'), 'built English document language');
check(builtEnAbout.includes('<h1>About Khuzestan Yeast Co.</h1>'), 'built route-specific fallback heading');
check(builtEnAbout.includes(`rel="canonical" href="${ORIGIN}/en/about"`), 'built route-specific canonical');
check(builtProduct.includes('"@type":"Product"') && builtProduct.includes('"@type":"Offer"'), 'built product schema and offer');
check(builtPrivate.includes('content="noindex, nofollow, noarchive"'), 'static private shell noindex');
check(built404.includes('content="noindex, nofollow, noarchive"'), 'static 404 shell noindex');
check(fs.readFileSync(path.join(DIST, 'robots.txt'), 'utf8') === robots, 'built robots matches resolver');
check(fs.readFileSync(path.join(DIST, 'sitemap.xml'), 'utf8') === sitemap, 'built sitemap matches resolver');
check(builtHtaccess.includes('RewriteRule ^en/about$ /seo-pages/en--about.html [L]'), 'Apache maps localized route to prerender');
check(builtHtaccess.includes('RewriteRule . - [R=404,L]'), 'Apache returns genuine unknown-route 404');
check(builtHtaccess.includes('X-Robots-Tag "noindex, nofollow, noarchive"'), 'Apache sends noindex header for private and 404 shells');
check(builtHtaccess.includes('RewriteRule ^(?:fa/)?dezmaye/?$ /products/dezmaye-gold-80 [R=301,L]'), 'Apache sends a single permanent legacy redirect');

/* Admin text is escaped in visible fallback and escaped inside JSON-LD. */
const hostile = structuredClone(DEFAULT_STATE);
hostile.products[0].title = '<script>alert(1)</script> Yeast';
const hostileMeta = resolveSeo('/products/dezmaye-gold-80', hostile, ORIGIN);
const template = fs.readFileSync(path.join(DIST, 'seo-pages', '_template.html'), 'utf8');
const hostileHtml = renderSeoDocument(template, hostileMeta);
check(!hostileHtml.includes('<h1><script>'), 'fallback escapes CMS title');
check(!hostileHtml.includes('"name":"<script>'), 'JSON-LD escapes opening tags');
check(hostileHtml.includes('>Yeast</h1>'), 'sanitized CMS title remains readable');

for (const line of leaks) console.log(line);
console.log(`${pass}/${total}`);
if (pass !== total) process.exitCode = 1;
