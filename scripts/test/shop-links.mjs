import { catalogueShopPath } from '../../shared/shopLinks.js';

let pass = 0;
let fail = 0;
const check = (condition, label, detail = '') => {
  if (condition) {
    pass += 1;
    return;
  }
  fail += 1;
  console.log(`LEAK ${label}${detail ? ` — ${detail}` : ''}`);
};

const products = [
  { slug: 'same-slug', productSlug: '', active: true },
  { slug: 'inactive-listing', productSlug: 'catalogue-item', active: false },
  { slug: 'related-listing', productSlug: 'catalogue-item', active: true },
  { slug: 'second-related-listing', productSlug: 'catalogue-item', active: true },
];

check(
  catalogueShopPath('catalogue-item', products) === '/shop/related-listing',
  'an explicit active relationship opens the respective shop product',
);
check(
  catalogueShopPath('same-slug', products) === '/shop',
  'matching slugs without an explicit relationship fall back to the shop',
);
check(
  catalogueShopPath('inactive-only', [
    { slug: 'inactive-shop-item', productSlug: 'inactive-only', active: false },
  ]) === '/shop',
  'an inactive related product is not exposed as a purchase destination',
);
check(
  catalogueShopPath('missing', products) === '/shop',
  'a catalogue product without a relationship falls back to the shop',
);
check(
  catalogueShopPath('catalogue-item', [
    { slug: '../account', productSlug: 'catalogue-item', active: true },
  ]) === '/shop',
  'an invalid related slug cannot turn content into an unintended route',
);
check(
  catalogueShopPath('محصول-آزمایشی', [
    { slug: 'فروشگاه-آزمایشی', productSlug: 'محصول-آزمایشی', active: true },
  ]) === '/shop/فروشگاه-آزمایشی',
  'valid Persian slugs remain linkable',
);
check(
  catalogueShopPath('', products) === '/shop' &&
    catalogueShopPath('catalogue-item', null) === '/shop',
  'malformed inputs fail closed to the storefront',
);

console.log(`${pass}/${pass + fail}`);
if (fail) process.exitCode = 1;
