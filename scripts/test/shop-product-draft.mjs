import DEFAULT_STATE from '../../shared/contentDefaults.js';
import {
  autofillShopProductFromCatalog,
  catalogProductShopDescription,
} from '../../src/admin/shopProductDraft.js';

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

const clone = (value) => JSON.parse(JSON.stringify(value));
const source = clone(DEFAULT_STATE.products.find((product) => product.slug === 'dezmaye-gold-80'));
const sourceBefore = clone(source);
const draft = {
  slug: 'shop-temporary',
  title: 'عنوان موقت',
  brand: 'nanmaye',
  productSlug: '',
  unit: 'واحد موقت',
  image: '/draft.webp',
  images: ['/draft.webp'],
  price: 123456,
  oldPrice: 150000,
  stock: 7,
  active: false,
  featured: true,
  commentsLocked: true,
  short: 'متن موقت',
  description: '<p>توضیح موقت</p>',
  specs: [['موقت', 'مقدار']],
};
const draftBefore = clone(draft);
const imported = autofillShopProductFromCatalog(draft, source);

check(
  imported.slug === source.slug && imported.productSlug === source.slug,
  'catalogue selection sets both the shop slug and relationship',
  `${imported.slug} / ${imported.productSlug}`,
);
check(imported.title === source.title, 'catalogue selection imports the title');
check(imported.brand === source.brand, 'catalogue selection imports the brand');
check(
  imported.unit.includes(source.weight) && imported.unit.includes(source.pack),
  'catalogue selection builds the sales unit from weight and packaging',
  imported.unit,
);
check(
  imported.image === source.images[0] && JSON.stringify(imported.images) === JSON.stringify(source.images),
  'catalogue selection imports the ordered gallery and primary image',
);
check(imported.short === source.short, 'catalogue selection imports the card copy');
check(
  JSON.stringify(imported.specs) === JSON.stringify(source.specs),
  'catalogue selection imports the specification rows',
);
check(
  imported.description.includes('راهنمای مصرف و کاربرد') &&
    imported.description.includes(source.usage[0]) &&
    imported.description.includes('آنالیز آزمایشگاهی و ترکیبات') &&
    imported.description.includes(source.analysis[0][0]) &&
    imported.description.includes('شرایط نگهداری و انبارداری') &&
    imported.description.includes(source.storage[0]),
  'catalogue-only usage, analysis and storage copy fills the rich description',
);
check(
  imported.price === draft.price &&
    imported.oldPrice === draft.oldPrice &&
    imported.stock === draft.stock &&
    imported.active === draft.active &&
    imported.featured === draft.featured &&
    imported.commentsLocked === draft.commentsLocked,
  'autofill preserves price, stock and shop-only merchandising decisions',
);
check(JSON.stringify(draft) === JSON.stringify(draftBefore), 'autofill does not mutate the current draft');

imported.images.push('/new.webp');
imported.specs[0][1] = 'changed';
check(JSON.stringify(source) === JSON.stringify(sourceBefore), 'imported galleries and specs do not alias catalogue state');

const incomplete = autofillShopProductFromCatalog(draft, { slug: 'minimal-catalogue-item' });
check(
  incomplete.productSlug === 'minimal-catalogue-item' &&
    incomplete.slug === 'minimal-catalogue-item' &&
    incomplete.title === draft.title &&
    incomplete.image === draft.image &&
    incomplete.description === draft.description &&
    incomplete.specs === draft.specs,
  'an incomplete catalogue record imports its identity without erasing unavailable fields',
);

const hostileDescription = catalogProductShopDescription({
  short: '<img src=x onerror=alert(1)>',
  usage: ['استفاده <script>alert(1)</script>'],
  analysis: [['<b>برچسب</b>', '"مقدار" & بیشتر']],
  storage: ['دور از <iframe>'],
});
check(
  !hostileDescription.includes('<script>') &&
    !hostileDescription.includes('<img') &&
    !hostileDescription.includes('<iframe>') &&
    hostileDescription.includes('&lt;script&gt;') &&
    hostileDescription.includes('&amp;'),
  'editable catalogue text is escaped before becoming shop rich text',
  hostileDescription,
);
check(
  autofillShopProductFromCatalog(draft, null) === draft &&
    autofillShopProductFromCatalog(draft, { title: 'بدون شناسه' }) === draft,
  'missing catalogue identities leave the draft untouched',
);

console.log(`${pass}/${pass + fail}`);
if (fail) process.exitCode = 1;
