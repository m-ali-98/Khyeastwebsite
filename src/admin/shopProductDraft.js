import { productImageList } from '../../shared/productImages.js';

const text = (value) => (value == null ? '' : String(value).trim());

const escapeHtml = (value) => text(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const rows = (value) => (Array.isArray(value)
  ? value
      .filter((row) => Array.isArray(row))
      .map(([label, detail]) => [text(label), text(detail)])
      .filter(([label, detail]) => label || detail)
  : []);

const strings = (value) => (Array.isArray(value) ? value.map(text).filter(Boolean) : []);

const listSection = (title, values, ordered = false) => {
  if (!values.length) return '';
  const tag = ordered ? 'ol' : 'ul';
  return `<h2>${title}</h2><${tag}>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</${tag}>`;
};

/** Build safe Persian rich text from catalogue fields that have no direct
 * shop-product equivalent. Values are escaped because catalogue copy is
 * editable content, not trusted HTML. */
export function catalogProductShopDescription(product) {
  if (!product || typeof product !== 'object') return '';

  const description = [];
  const short = text(product.short);
  if (short) description.push(`<p>${escapeHtml(short)}</p>`);

  const usage = strings(product.usage);
  if (usage.length) description.push(listSection('راهنمای مصرف و کاربرد', usage, true));

  const analysis = rows(product.analysis);
  if (analysis.length) {
    description.push(
      `<h2>آنالیز آزمایشگاهی و ترکیبات</h2><ul>${analysis
        .map(([label, detail]) => (
          `<li>${label ? `<strong>${escapeHtml(label)}${detail ? ': ' : ''}</strong>` : ''}${escapeHtml(detail)}</li>`
        ))
        .join('')}</ul>`,
    );
  }

  const storage = strings(product.storage);
  if (storage.length) description.push(listSection('شرایط نگهداری و انبارداری', storage));

  return description.join('');
}

/** Import every useful catalogue field into a new shop draft while preserving
 * commerce-only decisions such as price, stock, activation and promotion. An
 * incomplete custom catalogue record never erases a draft field for which it
 * has no replacement value. */
export function autofillShopProductFromCatalog(draft, product) {
  if (!draft || typeof draft !== 'object' || !product || typeof product !== 'object') return draft;

  const slug = text(product.slug);
  if (!slug) return draft;

  const next = { ...draft, productSlug: slug, slug };
  const title = text(product.title);
  const brand = text(product.brand);
  const sourceSpecs = rows(product.specs);
  const weight = text(product.weight) || sourceSpecs.find(([label]) => label.includes('وزن'))?.[1] || '';
  const pack = text(product.pack) || sourceSpecs.find(([label]) => label.includes('بسته'))?.[1] || '';
  const unit = [pack, weight].filter(Boolean).join(' — ');
  const images = productImageList(product);
  const short = text(product.short);
  const description = catalogProductShopDescription(product);

  if (title) next.title = title;
  if (brand) next.brand = brand;
  if (unit) next.unit = unit;
  if (images.length) {
    next.image = images[0];
    next.images = images;
  }
  if (short) next.short = short;
  if (description) next.description = description;
  if (sourceSpecs.length) next.specs = sourceSpecs;

  return next;
}
