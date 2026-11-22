/* Russian locale contract: every public Russian route is translated, uses
   the correct document direction and metadata, and keeps Iran-only commerce
   out of the language while retaining the Persian shop scope. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import DEFAULT_STATE from '../../shared/contentDefaults.js';
import {
  LOCALES,
  loadAllPacks,
  getPack,
  localizeState,
  shopEnabled,
} from '../../shared/i18n/index.js';
import {
  listIndexablePaths,
  resolveSeo,
  DEFAULT_SITE_ORIGIN,
} from '../../shared/seo.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const untranslatedScript = /[\u0600-\u06ff]/u;
let pass = 0;
let fail = 0;
const check = (condition, label, detail = '') => {
  if (condition) pass++;
  else {
    fail++;
    console.log(`LEAK ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

await loadAllPacks();
const ru = getPack('ru');
const view = localizeState(DEFAULT_STATE, 'ru');
const russianMeta = LOCALES.find(({ code }) => code === 'ru');

check(Boolean(ru), 'Russian pack loads before the app renders');
check(
  russianMeta?.prefix === '/ru' && russianMeta.dir === 'ltr' && russianMeta.htmlLang === 'ru',
  'Russian locale is registered with /ru, ru language and left-to-right direction',
);
check(shopEnabled('ru') === false, 'Iranian online shop remains Persian-only');

const excludedTextKey = (key) => key.startsWith('shop.') || key.startsWith('salesReps.') ||
  key === 'nav.salesRepresentatives' || key.startsWith('seo.salesRepresentatives.');
const publicTextKeys = Object.keys(DEFAULT_STATE.texts || {}).filter((key) => !excludedTextKey(key));
const missingTextKeys = publicTextKeys.filter((key) => !ru?.texts?.[key]);
check(missingTextKeys.length === 0, 'every public base text key has a Russian translation', missingTextKeys.join(', '));
check(
  publicTextKeys.every((key) => !untranslatedScript.test(String(view?.texts?.[key] || ''))),
  'no public Russian text key falls back to Persian or Arabic',
);

const translatableCollectionFields = ['label', 'title', 'text', 'address', 'role'];
const missingCollectionFields = [];
for (const [bucket, rows] of Object.entries(DEFAULT_STATE.collections || {})) {
  if (bucket === 'salesRepresentatives') continue;
  for (const [index, base] of (Array.isArray(rows) ? rows : []).entries()) {
    const translated = view?.collections?.[bucket]?.[index];
    if (typeof base === 'string') {
      if (!translated || untranslatedScript.test(translated)) missingCollectionFields.push(`${bucket}[${index}]`);
      continue;
    }
    for (const field of translatableCollectionFields) {
      if (!base?.[field]) continue;
      if (!translated?.[field] || untranslatedScript.test(String(translated[field]))) {
        missingCollectionFields.push(`${bucket}[${index}].${field}`);
      }
    }
  }
}
check(missingCollectionFields.length === 0, 'all visible collection labels and descriptions are Russian', missingCollectionFields.join(', '));

const missingBrands = (DEFAULT_STATE.brands || []).filter((brand) => {
  const translated = view?.brands?.find((item) => item.id === brand.id);
  return !translated?.fa || !translated?.tagline ||
    untranslatedScript.test(`${translated?.fa || ''} ${translated?.tagline || ''}`);
});
check(missingBrands.length === 0, 'all brand names and taglines are localized', missingBrands.map(({ id }) => id).join(', '));

const productFields = ['title', 'weight', 'pack', 'short', 'specs', 'usage', 'analysis', 'storage'];
const productGaps = [];
for (const base of DEFAULT_STATE.products || []) {
  const localized = view?.products?.find((item) => item.slug === base.slug);
  for (const field of productFields) {
    if (localized?.[field] == null) productGaps.push(`${base.slug}.${field}`);
  }
  const strings = [localized?.title, localized?.weight, localized?.pack, localized?.short,
    ...(localized?.specs || []).flat(), ...(localized?.usage || []),
    ...(localized?.analysis || []).flat(), ...(localized?.storage || [])];
  if (strings.some((value) => untranslatedScript.test(String(value || '')))) productGaps.push(`${base.slug}: Persian/Arabic fallback`);
}
check(productGaps.length === 0, 'all catalogue titles, specs, usage and storage details are Russian', productGaps.join(', '));
check(
  (view?.products || []).length === 30 && (view?.products || []).every(({ title }) => /[\u0400-\u04ff]/u.test(title)),
  'the complete 30-product Russian catalogue renders in Cyrillic',
);

const postFields = ['title', 'excerpt', 'date', 'category', 'readTime', 'body'];
const postGaps = [];
for (const base of DEFAULT_STATE.posts || []) {
  const localized = view?.posts?.find((item) => item.slug === base.slug);
  for (const field of postFields) {
    if (!localized?.[field] || untranslatedScript.test(String(localized[field]))) postGaps.push(`${base.slug}.${field}`);
  }
}
check(postGaps.length === 0, 'all blog cards and complete article bodies are Russian', postGaps.join(', '));
check(
  (view?.gallery || []).length === (DEFAULT_STATE.gallery || []).length &&
    (view?.gallery || []).every((item) => item.caption && !untranslatedScript.test(item.caption)),
  'all public gallery captions are localized',
);

const russianRoutes = listIndexablePaths(DEFAULT_STATE).filter((route) => route === '/ru' || route.startsWith('/ru/'));
const metadataGaps = [];
for (const route of russianRoutes) {
  const meta = resolveSeo(route, DEFAULT_STATE, DEFAULT_SITE_ORIGIN);
  const visible = [meta.pageTitle, meta.title, meta.description, ...(meta.body || []),
    ...(meta.links || []).flatMap((link) => [link.label, link.text]),
    ...(meta.breadcrumbs || []).map((item) => item.name)];
  if (!meta.indexable || meta.lang !== 'ru' || meta.dir !== 'ltr' || visible.some((value) => untranslatedScript.test(String(value || '')))) {
    metadataGaps.push(route);
  }
}
check(russianRoutes.length === 44, 'Russian version has every public static, product and imported blog URL', String(russianRoutes.length));
check(metadataGaps.length === 0, 'all Russian route metadata, crawlable links and body snippets avoid Persian fallback', metadataGaps.join(', '));
check(
  !listIndexablePaths(DEFAULT_STATE).includes('/ru/shop') && !listIndexablePaths(DEFAULT_STATE).includes('/ru/sales-representatives'),
  'sitemap route set excludes Persian-only shop and sales representative pages',
);
const unknown = resolveSeo('/ru/not-a-real-page', DEFAULT_STATE, DEFAULT_SITE_ORIGIN);
check(unknown.status === 404 && !untranslatedScript.test(`${unknown.title} ${unknown.description}`), 'Russian not-found metadata is localized');

const layout = read('src/components/Layout.jsx');
const pending = read('src/components/PagePending.jsx');
const fallback = read('src/components/RouteFallback.jsx');
const gallery = read('src/components/ProductGallery.jsx');
const bootHtml = read('index.html');
const fonts = read('src/styles/fonts.scss');
const seo = read('shared/seo.js');
const adminLocale = read('src/admin/adminLocale.jsx');
check(
  layout.includes("ru: { light: 'Переключить на светлую тему', dark: 'Переключить на тёмную тему' }") &&
    layout.includes("ru: 'Наверх'") && layout.includes("ru: 'Перейти к основному содержимому'") &&
    layout.includes("ru: 'Выбор языка'"),
  'Russian header theme, language switcher, skip-link and back-to-top labels exist',
);
check(
  layout.includes('lang-switch--desktop') && layout.includes('lang-switch--block') &&
    layout.includes('lang-switch__option') && layout.includes('lang-switch__option-check') &&
    layout.includes('aria-expanded={open}') && layout.includes('aria-current={lo.code === locale ?'),
  'desktop language picker exposes a keyboard-accessible native-name dropdown while the mobile segmented switch remains',
);
check(pending.includes("ru: 'Загружаем последние данные'"), 'data-loading announcement is localized in Russian');
check(fallback.includes("ru: { page: 'Загружаем страницу', admin: 'Загружаем панель управления' }"), 'route-loading announcement is localized in Russian');
check(gallery.includes("ru: {") && gallery.includes('Предыдущее изображение') && gallery.includes('Выбрать изображение товара'), 'product gallery accessibility labels are localized in Russian');
check(bootHtml.includes('<span lang="ru">Загрузка</span>') && bootHtml.includes("seg === 'ru'") && bootHtml.includes("loc === 'ru' ? 'ltr'"), 'first-paint loader announces Russian and sets LTR direction');
check(fonts.includes('inter-cyrillic-wght-normal.woff2'), 'Russian pages load a Cyrillic-capable web font subset');
check(seo.includes("ru: 'Основная навигация'") && /ru_RU/.test(seo), 'SEO fallback navigation and Open Graph metadata support Russian');
check(adminLocale.includes("{ code: 'ru', label: 'Русский', flag: 'RU' }"), 'Admin translation editor can select Russian');

console.log(`${pass}/${pass + fail}`);
if (fail) process.exit(1);
