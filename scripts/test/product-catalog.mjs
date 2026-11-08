/* Recovered production-catalogue invariants: variants, translations, media and routing. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import DEFAULT_STATE from '../../shared/contentDefaults.js';
import {
  CATALOG_SOURCE_URL,
  CATALOG_VARIANTS,
  buildCatalogProducts,
  buildCatalogProductTranslations,
} from '../../shared/catalogProducts.js';
import { loadAllPacks, localizeState } from '../../shared/i18n/index.js';
import {
  DEFAULT_SITE_ORIGIN,
  listIndexablePaths,
  redirectPath,
  resolveSeo,
} from '../../shared/seo.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let pass = 0;
let fail = 0;
const check = (ok, name, detail = '') => {
  if (ok) pass += 1;
  else {
    fail += 1;
    console.log(`LEAK ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const expectedRows = [
  ['dezmaye-gold-70', 'dezmaye', 70, 'g', 'vacuum', 60, 24],
  ['dezmaye-gold-80', 'dezmaye', 80, 'g', 'sachet', 50, 12],
  ['dezmaye-gold-90', 'dezmaye', 90, 'g', 'vacuum', 60, 24],
  ['dezmaye-gold-100', 'dezmaye', 100, 'g', 'vacuum', 60, 24],
  ['dezmaye-golden-400', 'dezmaye', 400, 'g', 'vacuum', 20, 24],
  ['dezmaye-gold-450', 'dezmaye', 450, 'g', 'vacuum', 20, 24],
  ['dezmaye-gold-500', 'dezmaye', 500, 'g', 'vacuum', 20, 24],
  ['dezmaye-gold-5kg', 'dezmaye', 5, 'kg', 'vacuum', 2, 24],
  ['dezmaye-gold-10kg', 'dezmaye', 10, 'kg', 'bag', null, 6],
  ['shetab-70', 'shetab', 70, 'g', 'vacuum', 60, 24],
  ['shetab-80', 'shetab', 80, 'g', 'sachet', 50, 12],
  ['shetab-90', 'shetab', 90, 'g', 'vacuum', 60, 24],
  ['shetab-100', 'shetab', 100, 'g', 'vacuum', 60, 24],
  ['shetab-450', 'shetab', 450, 'g', 'vacuum', 20, 24],
  ['shetab-500', 'shetab', 500, 'g', 'vacuum', 20, 24],
  ['shetab-5kg', 'shetab', 5, 'kg', 'vacuum', 2, 24],
  ['xpower-70', 'xpower', 70, 'g', 'vacuum', 60, 24],
  ['xpower-80', 'xpower', 80, 'g', 'sachet', 50, 12],
  ['xpower-90', 'xpower', 90, 'g', 'vacuum', 60, 24],
  ['xpower-100', 'xpower', 100, 'g', 'vacuum', 60, 24],
  ['xpower-450', 'xpower', 450, 'g', 'vacuum', 20, 24],
  ['xpower-500', 'xpower', 500, 'g', 'vacuum', 20, 24],
  ['xpower-5kg', 'xpower', 5, 'kg', 'vacuum', 2, 24],
  ['nanmaye-70', 'nanmaye', 70, 'g', 'vacuum', 60, 24],
  ['nanmaye-80', 'nanmaye', 80, 'g', 'sachet', 50, 12],
  ['nanmaye-90', 'nanmaye', 90, 'g', 'vacuum', 60, 24],
  ['nanmaye-100', 'nanmaye', 100, 'g', 'vacuum', 60, 24],
  ['nanmaye-450', 'nanmaye', 450, 'g', 'vacuum', 20, 24],
  ['nanmaye-500', 'nanmaye', 500, 'g', 'vacuum', 20, 24],
  ['nanmaye-5kg', 'nanmaye', 5, 'kg', 'vacuum', 2, 24],
];
const compactRows = CATALOG_VARIANTS.map((variant) => [
  variant.slug,
  variant.brand,
  variant.amount,
  variant.unit,
  variant.package,
  variant.carton,
  variant.shelfMonths,
]);
check(
  JSON.stringify(compactRows) === JSON.stringify(expectedRows),
  'the normalized table exactly matches the 30 recovered package variants',
);
check(
  CATALOG_SOURCE_URL === 'https://khuzestanyeast-co.com/products/',
  'the catalogue records its traced production source',
);
check(
  new Set(CATALOG_VARIANTS.map(({ slug }) => slug)).size === 30,
  'every recovered variant has one unique stable slug',
);

const byBrand = Object.groupBy(CATALOG_VARIANTS, ({ brand }) => brand);
check(
  byBrand.dezmaye?.length === 9 && byBrand.shetab?.length === 7 &&
    byBrand.xpower?.length === 7 && byBrand.nanmaye?.length === 7,
  'brand totals are Dezmaye 9, Shetab 7, X-Power 7 and Nan Maye 7',
);
check(
  CATALOG_VARIANTS.filter(({ amount, unit }) => amount === 80 && unit === 'g')
    .every(({ package: packaging, carton, shelfMonths }) => packaging === 'sachet' && carton === 50 && shelfMonths === 12),
  'all 80 g sachets carry the recovered 50-per-carton and 12-month data',
);
check(
  CATALOG_VARIANTS.filter(({ amount, unit }) => amount === 5 && unit === 'kg')
    .every(({ package: packaging, carton, shelfMonths }) => packaging === 'vacuum' && carton === 2 && shelfMonths === 24),
  'all 5 kg vacuum packages carry the recovered 2-per-carton and 24-month data',
);
const bulk = CATALOG_VARIANTS.find(({ slug }) => slug === 'dezmaye-gold-10kg');
check(
  bulk?.package === 'bag' && bulk.carton === null && bulk.shelfMonths === 6,
  'the exceptional Dezmaye 10 kg sack has no invented carton count and a 6-month shelf life',
);
check(
  CATALOG_VARIANTS.find(({ slug }) => slug === 'xpower-500')?.layers === 4,
  'the X-Power 500 g four-layer packaging exception is preserved',
);

const products = DEFAULT_STATE.products;
check(
  products.length === 30 && JSON.stringify(products.map(({ slug }) => slug)) ===
    JSON.stringify(CATALOG_VARIANTS.map(({ slug }) => slug)),
  'the Persian public catalogue exposes all and only the 30 recovered variants',
);
check(
  products.every((product) => (
    product.title && product.short && product.weight && product.pack && product.image &&
    product.specs.length >= 5 && product.usage.length === 4 &&
    product.analysis.length === 6 && product.storage.length === 4
  )),
  'every detail route receives complete copy, specifications, usage, analysis and storage data',
);
check(
  products.every((product, index) => (
    product.usage !== products[(index + 1) % products.length].usage &&
    product.analysis !== products[(index + 1) % products.length].analysis &&
    product.storage !== products[(index + 1) % products.length].storage
  )),
  'generated product detail arrays do not share mutable references',
);
check(
  products.filter(({ featured }) => featured).length === 4 &&
    new Set(products.filter(({ featured }) => featured).map(({ brand }) => brand)).size === 4,
  'the home page keeps exactly one featured package per brand',
);

const productBySlug = new Map(products.map((product) => [product.slug, product]));
const all80 = [...productBySlug.values()].filter(({ slug }) => /-80$/.test(slug));
check(
  all80.every(({ pack, specs, storage }) => (
    pack === 'ساشه' &&
    specs.some(([label, value]) => label === 'تعداد در کارتن' && value.includes('۵۰')) &&
    specs.some(([label, value]) => label === 'مدت ماندگاری' && value.includes('۱۲')) &&
    storage[2].includes('۱۲ ماه')
  )),
  '80 g Persian detail pages consistently describe sachets, carton quantity and 12-month storage',
);
check(
  productBySlug.get('dezmaye-gold-10kg')?.specs.every(([label]) => label !== 'تعداد در کارتن') &&
    productBySlug.get('dezmaye-gold-10kg')?.storage[2].includes('۶ ماه'),
  'the 10 kg detail page omits an unsupported carton claim and shows 6-month storage',
);
check(
  productBySlug.get('xpower-500')?.specs.some(([label, value]) => (
    label === 'نوع بسته‌بندی' && value.includes('۴‌لایه')
  )),
  'the X-Power 500 g detail page displays its four-layer vacuum pack',
);

const expectedImages = new Set([
  '/assets/products/dezmaye-gold.webp',
  '/assets/products/shetab.webp',
  '/assets/products/xpower.webp',
  '/assets/products/nanmaye.webp',
]);
check(
  products.every(({ image }) => expectedImages.has(image) && image.startsWith('/assets/')),
  'catalogue media stays on the same origin and uses the four owned brand packshots',
);
check(
  [...expectedImages].every((url) => {
    const file = path.join(ROOT, 'public', url.replace(/^\//, ''));
    return fs.statSync(file).isFile() && fs.statSync(file).size > 0;
  }),
  'every catalogue packshot exists as a non-empty public asset',
);

const english = buildCatalogProductTranslations('en', {
  usage: ['Use directly.'],
  analysis: [['Dry matter', '95%']],
  storage: ['Cool.', 'Below 25 C.', 'Old shelf copy.', 'Seal after opening.'],
});
const arabic = buildCatalogProductTranslations('ar', {
  usage: ['يستخدم مباشرة.'],
  analysis: [['المادة الجافة', '٩٥٪']],
  storage: ['بارد.', 'أقل من ٢٥.', 'نص قديم.', 'يغلق بعد الفتح.'],
});
check(
  Object.keys(english).length === 30 && Object.keys(arabic).length === 30 &&
    CATALOG_VARIANTS.every(({ slug }) => english[slug] && arabic[slug]),
  'English and Arabic dictionaries cover every catalogue slug',
);
check(
  english['dezmaye-gold-80'].pack === 'Sachet' &&
    english['dezmaye-gold-80'].storage[2].includes('12 months') &&
    english['dezmaye-gold-10kg'].storage[2].includes('6 months'),
  'English package and shelf-life exceptions are localized from the shared table',
);
check(
  arabic['dezmaye-gold-80'].pack === 'كيس' &&
    arabic['dezmaye-gold-80'].storage[2].includes('١٢ شهرًا') &&
    arabic['dezmaye-gold-10kg'].storage[2].includes('٦ شهرًا'),
  'Arabic package and shelf-life exceptions are localized from the shared table',
);
check(
  !Object.values(english).some((product) => Object.hasOwn(product, 'image')) &&
    !Object.values(arabic).some((product) => Object.hasOwn(product, 'image')),
  'locale overlays cannot replace language-neutral product media',
);

await loadAllPacks();
const localizedEnglish = localizeState(DEFAULT_STATE, 'en');
const localizedArabic = localizeState(DEFAULT_STATE, 'ar');
check(
  localizedEnglish.products.length === 30 &&
    localizedEnglish.products.every(({ title }) => !/[\u0600-\u06ff]/u.test(title)),
  'the shipped English site renders all 30 titles without Persian fallback',
);
check(
  localizedArabic.products.length === 30 &&
    localizedArabic.products.every(({ title }) => /[\u0600-\u06ff]/u.test(title)),
  'the shipped Arabic site renders all 30 localized titles',
);

const shopOnly = DEFAULT_STATE.shop.products.find(({ slug }) => slug === 'nanmaye-10');
const catalogueSlugs = new Set(products.map(({ slug }) => slug));
check(
  shopOnly && shopOnly.productSlug === '' && !catalogueSlugs.has('nanmaye-10'),
  'the 10 kg Nan Maye commercial SKU remains shop-only rather than inventing a source variant',
);
check(
  DEFAULT_STATE.shop.products.every(({ productSlug }) => !productSlug || catalogueSlugs.has(productSlug)),
  'every shop-to-catalogue relationship resolves to a recovered public variant',
);
check(
  resolveSeo('/shop/nanmaye-10', DEFAULT_STATE, DEFAULT_SITE_ORIGIN).canonical ===
    `${DEFAULT_SITE_ORIGIN}/shop/nanmaye-10`,
  'the shop-only Nan Maye SKU keeps an independent canonical URL',
);
check(
  redirectPath('/nanmaye') === '/products/nanmaye-500' &&
    redirectPath('/en/nanmaye') === '/en/products/nanmaye-500' &&
    redirectPath('/fa/nanmaye/') === '/products/nanmaye-500',
  'legacy Nan Maye links redirect in one hop to a real recovered variant',
);

const productIndexPaths = listIndexablePaths(DEFAULT_STATE).filter((route) => (
  /^\/(?:en\/|ar\/)?products\/[^/]+$/.test(route)
));
check(
  productIndexPaths.length === 90 && new Set(productIndexPaths).size === 90,
  'all 30 detail routes are indexable in each of the three locales',
);

console.log(`${pass}/${pass + fail}`);
if (fail) process.exit(1);
