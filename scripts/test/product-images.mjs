/* Product gallery compatibility and persistence invariants. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import DEFAULT_STATE from '../../shared/contentDefaults.js';
import { mergeContentState } from '../../shared/contentState.js';
import { localizeState } from '../../shared/i18n/index.js';
import {
  cleanProductImageUrl,
  isAllowedProductImageUrl,
  MAX_PRODUCT_IMAGES,
  normalizeProductImageOrigins,
  normalizeProductImages,
  productImageList,
  productImagesProblem,
  productNeedsImageValidation,
  syncProductImages,
} from '../../shared/productImages.js';
import { sanitizeContentPayload } from '../../server/sanitize.js';
import * as store from '../../server/db.js';

let pass = 0;
let fail = 0;
const check = (ok, name, detail = '') => {
  if (ok) pass += 1;
  else {
    fail += 1;
    console.log(`LEAK ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

check(
  JSON.stringify(productImageList({ image: '/legacy.webp' })) === JSON.stringify(['/legacy.webp']),
  'a legacy image becomes a one-photo gallery',
);
check(
  JSON.stringify(normalizeProductImages(['/primary.webp', '/second.webp'], '/stale.webp')) ===
    JSON.stringify(['/primary.webp', '/second.webp']),
  'ordered gallery wins over stale legacy image',
);
check(
  JSON.stringify(normalizeProductImages(['javascript:alert(1)', '//evil.test/x', '/ok.webp', '/ok.webp'])) ===
    JSON.stringify(['/ok.webp']),
  'unsafe and duplicate product image URLs are rejected',
);
check(
  !cleanProductImageUrl('http://cdn.example/photo.webp') &&
    !cleanProductImageUrl('https://user:pass@cdn.example/photo.webp') &&
    !cleanProductImageUrl('/uploads\\evil.webp') &&
    !cleanProductImageUrl('/uploads/images/a.webp\nignored') &&
    !cleanProductImageUrl('\n/uploads/images/a.webp'),
  'HTTP, credentials, backslashes and control characters are rejected',
);
check(
  isAllowedProductImageUrl('/uploads/images/photo.webp', []) &&
    isAllowedProductImageUrl('https://cdn.example/photo.webp', ['https://cdn.example']) &&
    !isAllowedProductImageUrl('https://other.example/photo.webp', ['https://cdn.example']) &&
    !isAllowedProductImageUrl('https://sub.cdn.example/photo.webp', ['https://cdn.example']),
  'gallery authorization is exact-origin while safe root paths remain allowed',
);
check(
  JSON.stringify(normalizeProductImageOrigins([
    'https://cdn.example',
    'https://cdn.example/',
    'http://cdn.example',
    'https://cdn.example/path',
    'nonsense',
  ])) === JSON.stringify(['https://cdn.example']),
  'only canonical HTTPS origins can expand the gallery allowlist',
);
check(
  productImagesProblem({ images: ['https://cdn.example/a.webp'] }, ['https://cdn.example']) === null &&
    productImagesProblem({ images: ['https://other.example/a.webp'] }, ['https://cdn.example'])?.code === 'untrusted_origin' &&
    productImagesProblem({ images: ['http://cdn.example/a.webp'] }, ['https://cdn.example'])?.code === 'invalid_url' &&
    productImagesProblem({ images: ['/safe.webp', '/safe.webp'] }, [])?.code === 'duplicate',
  'save-time validation distinguishes trusted, untrusted, mixed-content and duplicate media',
);
check(
  normalizeProductImages(Array.from({ length: MAX_PRODUCT_IMAGES + 4 }, (_, index) => `/image-${index}.webp`)).length === MAX_PRODUCT_IMAGES,
  'product galleries have a bounded size',
);
const legacyProduct = {
  slug: 'legacy',
  title: 'Legacy',
  image: 'http://old.example/photo.webp',
  images: ['http://old.example/photo.webp', 'http://old.example/photo.webp'],
  stock: 4,
};
check(
  !productNeedsImageValidation(
    { images: [...legacyProduct.images], stock: 4, image: legacyProduct.image, title: 'Legacy', slug: 'legacy' },
    legacyProduct,
  ) &&
    !productNeedsImageValidation(syncProductImages(legacyProduct), legacyProduct) &&
    productNeedsImageValidation({ ...legacyProduct, title: 'Edited' }, legacyProduct) &&
    !productNeedsImageValidation({ ...legacyProduct, stock: 1 }, legacyProduct, { ignore: ['stock'] }) &&
    productNeedsImageValidation({ ...legacyProduct, images: [legacyProduct.image] }, legacyProduct),
  'gallery enforcement targets new or edited products while ignoring stale operational stock',
);
const synced = syncProductImages({ image: '/old.webp', images: ['/new.webp', '/second.webp'] });
check(
  synced.image === '/new.webp' && synced.images.length === 2,
  'the first ordered image is mirrored to the legacy primary field',
);

const merged = mergeContentState(DEFAULT_STATE, {
  products: [{ slug: 'catalogue', title: 'Catalogue', image: '/stale.webp', images: ['/primary.webp', '/other.webp'] }],
  shop: {
    ...DEFAULT_STATE.shop,
    products: [{ slug: 'store', title: 'Store', image: '/store-legacy.webp' }],
  },
});
check(
  merged.products[0].image === '/primary.webp' && merged.products[0].images.length === 2,
  'content merge keeps cards and SEO on the gallery primary image',
);
check(
  merged.shop.products[0].image === '/store-legacy.webp' && merged.shop.products[0].images[0] === '/store-legacy.webp',
  'content merge upgrades legacy shop products in memory',
);

const translated = localizeState({
  ...merged,
  i18n: {
    en: {
      products: {
        catalogue: { title: 'Translated', image: '/wrong.webp', images: ['/wrong-gallery.webp'] },
      },
    },
  },
}, 'en');
check(
  translated.products[0].title === 'Translated' &&
    translated.products[0].image === '/primary.webp' &&
    translated.products[0].images[0] === '/primary.webp',
  'translated product fields cannot replace language-neutral media',
);

const sanitized = sanitizeContentPayload({
  products: [{ slug: 'catalogue', image: '/stale.webp', images: ['/first.webp', '/second.webp'] }],
  shop: { products: [{ slug: 'store', image: '/old.webp', images: ['/shop-first.webp', '/shop-second.webp'], description: '<p>Safe</p>' }] },
  i18n: { en: { products: { catalogue: { title: 'English', image: '/wrong.webp', images: ['/wrong.webp'] } } } },
});
check(
  sanitized.products[0].image === '/first.webp' && sanitized.products[0].images.length === 2,
  'server canonicalizes catalogue galleries before persistence',
);
check(
  sanitized.shop.products[0].image === '/shop-first.webp' && sanitized.shop.products[0].images.length === 2,
  'server canonicalizes store galleries before persistence',
);
check(
  sanitized.i18n.en.products.catalogue.title === 'English' &&
    !Object.hasOwn(sanitized.i18n.en.products.catalogue, 'image') &&
    !Object.hasOwn(sanitized.i18n.en.products.catalogue, 'images'),
  'server strips locale-specific product media',
);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ky-product-images-'));
const file = path.join(dir, 'fresh.db');
let database;
try {
  database = await store.openDB(file);
  store.initializeStore(database, { freshInstall: true });
  const columns = database.prepare('PRAGMA table_info(products)').all().map((column) => column.name);
  check(columns.includes('images'), 'the fresh SQLite schema includes the ordered gallery column');

  store.replaceProducts(database, [{
    slug: 'gallery-product',
    title: 'Initial gallery',
    image: '/initial.webp',
    images: ['/initial.webp'],
    stock: 7,
  }]);
  const initial = store.getProduct(database, 'gallery-product');
  check(
    initial.image === '/initial.webp' &&
      JSON.stringify(initial.images) === JSON.stringify(['/initial.webp']),
    'fresh SQLite rows expose the selected primary and ordered gallery',
  );

  store.replaceProducts(database, [{
    ...initial,
    title: 'Gallery',
    image: '/stale.webp',
    images: ['/gallery-primary.webp', '/gallery-second.webp'],
    stock: 999,
  }], { preserveStock: true });
  const persisted = store.getProduct(database, 'gallery-product');
  check(
    persisted.image === '/gallery-primary.webp' &&
      JSON.stringify(persisted.images) === JSON.stringify(['/gallery-primary.webp', '/gallery-second.webp']),
    'SQLite round-trips the ordered gallery and selected primary',
  );
  check(persisted.stock === 7, 'full-list gallery saves preserve live stock');
} catch (error) {
  check(false, 'fresh SQLite gallery round-trip', error?.stack || String(error));
} finally {
  try { database?.close(); } catch {}
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`${pass}/${pass + fail}`);
if (fail) process.exit(1);
