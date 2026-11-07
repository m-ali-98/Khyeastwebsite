/* Server-side rich-text persistence boundary.

   Browser sanitizing is useful feedback, not a security boundary: a caller can
   bypass the panel and send JSON directly. Node therefore runs the same shared
   whitelist with linkedom before HTML reaches authoritative SQLite rows.

   A safety limit is a validation refusal, not valid empty HTML. Callers receive
   a typed error so an Admin save returns 400 and keeps the original content
   instead of silently persisting an empty field. */
import { DOMParser } from 'linkedom';
import { normalizeGalleryItems, stripGalleryMediaOverrides } from '../shared/gallery.js';
import {
  sanitizeHtmlResultWithParser,
  MAX_HTML_INPUT_LENGTH,
  MAX_HTML_DEPTH,
  MAX_HTML_NODES,
} from '../shared/sanitizeHtml.js';
import { syncProductImages } from '../shared/productImages.js';

const faNumber = (value) => new Intl.NumberFormat('fa-IR').format(value);
const fieldName = (field) => String(field || 'محتوای غنی').slice(0, 180);

const rejectionMessage = (result, field) => {
  const name = fieldName(field);
  if (result.code === 'input-too-large') {
    return `محتوای «${name}» بیش از حد بزرگ است؛ حداکثر ${faNumber(MAX_HTML_INPUT_LENGTH)} نویسه مجاز است. هیچ تغییری ذخیره نشد.`;
  }
  if (result.code === 'node-limit') {
    return `ساختار HTML «${name}» بیش از ${faNumber(MAX_HTML_NODES)} گره دارد. محتوا را ساده‌تر کنید؛ هیچ تغییری ذخیره نشد.`;
  }
  if (result.code === 'depth-limit') {
    return `ساختار HTML «${name}» بیش از ${faNumber(MAX_HTML_DEPTH)} سطح تو‌در‌تو دارد. محتوا را ساده‌تر کنید؛ هیچ تغییری ذخیره نشد.`;
  }
  return `HTML «${name}» قابل پردازش نیست. ساختار متن را اصلاح کنید؛ هیچ تغییری ذخیره نشد.`;
};

export class RichTextValidationError extends Error {
  constructor(result, field) {
    super(rejectionMessage(result, field));
    this.name = 'RichTextValidationError';
    this.code = result.code || 'invalid-rich-text';
    this.field = fieldName(field);
    this.limit = result.limit || null;
    this.actual = result.actual || null;
    this.status = 400;
  }
}

export const isRichTextValidationError = (error) => error instanceof RichTextValidationError;

/* Full content saves revisit every post and shop description, even when the
   edited bucket is only a phone number or link. Parsing identical HTML through
   linkedom on every request is pure duplicate work. Keep a small bounded LRU
   of successful canonicalisations; validation failures are never cached so the
   error still carries the exact field name from the current request. */
const RICH_TEXT_CACHE_MAX_ENTRIES = 512;
const RICH_TEXT_CACHE_MAX_CHARS = 4 * 1024 * 1024;
const RICH_TEXT_CACHE_MAX_ENTRY_CHARS = 128 * 1024;
const richTextCache = new Map();
let richTextCacheChars = 0;

const cachedRichText = (source) => {
  if (!richTextCache.has(source)) return null;
  const value = richTextCache.get(source);
  richTextCache.delete(source);
  richTextCache.set(source, value);
  return value;
};

const rememberRichText = (source, value) => {
  const weight = source.length + value.length;
  if (weight > RICH_TEXT_CACHE_MAX_ENTRY_CHARS) return;
  if (richTextCache.has(source)) {
    richTextCacheChars -= source.length + richTextCache.get(source).length;
    richTextCache.delete(source);
  }
  richTextCache.set(source, value);
  richTextCacheChars += weight;
  while (
    richTextCache.size > RICH_TEXT_CACHE_MAX_ENTRIES ||
    richTextCacheChars > RICH_TEXT_CACHE_MAX_CHARS
  ) {
    const oldest = richTextCache.entries().next().value;
    if (!oldest) break;
    richTextCache.delete(oldest[0]);
    richTextCacheChars -= oldest[0].length + oldest[1].length;
  }
};

export const sanitizeRichText = (html, field = 'محتوای غنی') => {
  const source = String(html || '');
  const cached = cachedRichText(source);
  if (cached !== null) return cached;
  const result = sanitizeHtmlResultWithParser(source, DOMParser);
  if (!result.ok) throw new RichTextValidationError(result, field);
  rememberRichText(source, result.html);
  return result.html;
};

const sanitizePosts = (posts, prefix = 'posts') =>
  Array.isArray(posts)
    ? posts.map((post, index) => (
        post && typeof post === 'object'
          ? {
              ...post,
              body: sanitizeRichText(
                post.body || '',
                `${prefix}[${index}]${post.slug ? ` (${String(post.slug).slice(0, 80)})` : ''}.body`,
              ),
            }
          : post
      ))
    : posts;

const sanitizePostOverrides = (posts, prefix) => {
  if (!posts || typeof posts !== 'object' || Array.isArray(posts)) return posts;
  return Object.fromEntries(
    Object.entries(posts).map(([slug, post]) => [
      slug,
      post && typeof post === 'object' && Object.hasOwn(post, 'body')
        ? { ...post, body: sanitizeRichText(post.body || '', `${prefix}.${String(slug).slice(0, 80)}.body`) }
        : post,
    ]),
  );
};

const sanitizeProductList = (products) => (
  Array.isArray(products)
    ? products.map((product) => (
        product && typeof product === 'object' && !Array.isArray(product)
          ? syncProductImages(product)
          : product
      ))
    : products
);

/* Product media is structural, like the slug: translations inherit it from
   the Persian/base entity. Strip direct-API attempts to create a locale-only
   gallery so changing language can never swap or lose product photography. */
const sanitizeProductOverrides = (products) => {
  if (!products || typeof products !== 'object' || Array.isArray(products)) return products;
  return Object.fromEntries(
    Object.entries(products).map(([slug, product]) => {
      if (!product || typeof product !== 'object' || Array.isArray(product)) return [slug, product];
      const { image: _image, images: _images, ...translatedFields } = product;
      return [slug, translatedFields];
    }),
  );
};

/** Return a sanitized copy of every content field rendered as HTML. */
export function sanitizeContentPayload(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const next = { ...source };

  if (Array.isArray(source.posts)) next.posts = sanitizePosts(source.posts);
  if (Array.isArray(source.products)) next.products = sanitizeProductList(source.products);
  if (Array.isArray(source.gallery)) next.gallery = normalizeGalleryItems(source.gallery);

  if (source.i18n && typeof source.i18n === 'object' && !Array.isArray(source.i18n)) {
    next.i18n = Object.fromEntries(
      Object.entries(source.i18n).map(([locale, data]) => {
        if (!data || typeof data !== 'object' || Array.isArray(data)) return [locale, data];
        return [locale, {
          ...data,
          products: sanitizeProductOverrides(data.products),
          posts: sanitizePostOverrides(data.posts, `i18n.${String(locale).slice(0, 20)}.posts`),
          ...(Object.hasOwn(data, 'gallery') ? { gallery: stripGalleryMediaOverrides(data.gallery) } : {}),
        }];
      }),
    );
  }

  if (source.shop && typeof source.shop === 'object' && !Array.isArray(source.shop)) {
    next.shop = {
      ...source.shop,
      products: Array.isArray(source.shop.products)
        ? source.shop.products.map((product, index) => (
            product && typeof product === 'object' && !Array.isArray(product)
              ? syncProductImages({
                  ...product,
                  description: sanitizeRichText(
                    product.description || '',
                    `shop.products[${index}]${product.slug ? ` (${String(product.slug).slice(0, 80)})` : ''}.description`,
                  ),
                })
              : product
          ))
        : source.shop.products,
    };
  }

  return next;
}
