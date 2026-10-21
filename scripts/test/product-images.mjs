/* Product gallery compatibility and persistence invariants. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import DEFAULT_STATE from '../../shared/contentDefaults.js';
import { mergeContentState } from '../../shared/contentState.js';
import { localizeState } from '../../shared/i18n/index.js';
import {
  MAX_PRODUCT_IMAGES,
  normalizeProductImages,
  productImageList,
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
  normalizeProductImages(Array.from({ length: MAX_PRODUCT_IMAGES + 4 }, (_, index) => `/image-${index}.webp`)).length === MAX_PRODUCT_IMAGES,
  'product galleries have a bounded size',
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
const file = path.join(dir, 'legacy.db');
let database;
try {
  /* Reproduce the exact pre-gallery products table, then let openDB perform the
     additive migration. This proves an installed site needs no manual work. */
  const legacy = new DatabaseSync(file);
  legacy.exec(`
    CREATE TABLE products (
      slug TEXT PRIMARY KEY,
      pos INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL DEFAULT '',
      brand TEXT NOT NULL DEFAULT '',
      product_slug TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT '',
      image TEXT NOT NULL DEFAULT '',
      price INTEGER NOT NULL DEFAULT 0,
      old_price INTEGER,
      stock INTEGER NOT NULL DEFAULT -1,
      active INTEGER NOT NULL DEFAULT 1,
      featured INTEGER NOT NULL DEFAULT 0,
      comments_locked INTEGER NOT NULL DEFAULT 0,
      short TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      specs TEXT NOT NULL DEFAULT '[]'
    );
    INSERT INTO products (slug, title, image, stock)
    VALUES ('legacy', 'Legacy', '/legacy-product.webp', 7);
  `);
  legacy.close();

  database = await store.openDB(file);
  const columns = database.prepare('PRAGMA table_info(products)').all().map((column) => column.name);
  const legacyProduct = store.getProduct(database, 'legacy');
  check(columns.includes('images'), 'SQLite migration adds the gallery column');
  check(
    legacyProduct.image === '/legacy-product.webp' &&
      JSON.stringify(legacyProduct.images) === JSON.stringify(['/legacy-product.webp']),
    'migrated SQLite rows fall back to their legacy image',
  );

  store.replaceProducts(database, [{
    ...legacyProduct,
    title: 'Gallery',
    image: '/stale.webp',
    images: ['/gallery-primary.webp', '/gallery-second.webp'],
    stock: 999,
  }], { preserveStock: true });
  const persisted = store.getProduct(database, 'legacy');
  check(
    persisted.image === '/gallery-primary.webp' &&
      JSON.stringify(persisted.images) === JSON.stringify(['/gallery-primary.webp', '/gallery-second.webp']),
    'SQLite round-trips the ordered gallery and selected primary',
  );
  check(persisted.stock === 7, 'full-list gallery saves preserve live stock');
} catch (error) {
  check(false, 'SQLite gallery migration and round-trip', error?.stack || String(error));
} finally {
  try { database?.close(); } catch {}
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`${pass}/${pass + fail}`);
if (fail) process.exit(1);
