/* Server-side rich-text persistence boundary.

   Browser sanitizing is useful feedback, not a security boundary: a caller can
   bypass the panel and send JSON directly. Node therefore runs the same shared
   whitelist with linkedom before HTML reaches content.json or SQLite. */
import { DOMParser } from 'linkedom';
import { sanitizeHtmlWithParser } from '../shared/sanitizeHtml.js';

export const sanitizeRichText = (html) => sanitizeHtmlWithParser(html, DOMParser);

const sanitizePosts = (posts) =>
  Array.isArray(posts)
    ? posts.map((post) => (
        post && typeof post === 'object'
          ? { ...post, body: sanitizeRichText(post.body || '') }
          : post
      ))
    : posts;

const sanitizePostOverrides = (posts) => {
  if (!posts || typeof posts !== 'object' || Array.isArray(posts)) return posts;
  return Object.fromEntries(
    Object.entries(posts).map(([slug, post]) => [
      slug,
      post && typeof post === 'object' && Object.hasOwn(post, 'body')
        ? { ...post, body: sanitizeRichText(post.body || '') }
        : post,
    ]),
  );
};

/** Return a sanitized copy of every content field rendered as HTML. */
export function sanitizeContentPayload(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const next = { ...source };

  if (Array.isArray(source.posts)) next.posts = sanitizePosts(source.posts);

  if (source.i18n && typeof source.i18n === 'object' && !Array.isArray(source.i18n)) {
    next.i18n = Object.fromEntries(
      Object.entries(source.i18n).map(([locale, data]) => {
        if (!data || typeof data !== 'object' || Array.isArray(data)) return [locale, data];
        return [locale, {
          ...data,
          posts: sanitizePostOverrides(data.posts),
        }];
      }),
    );
  }

  if (source.shop && typeof source.shop === 'object' && !Array.isArray(source.shop)) {
    next.shop = {
      ...source.shop,
      products: Array.isArray(source.shop.products)
        ? source.shop.products.map((product) => (
            product && typeof product === 'object'
              ? { ...product, description: sanitizeRichText(product.description || '') }
              : product
          ))
        : source.shop.products,
    };
  }

  return next;
}
