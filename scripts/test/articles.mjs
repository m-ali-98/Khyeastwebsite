/* Integrity checks for the Persian article import and its local media. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from 'linkedom';
import DEFAULT_STATE from '../../shared/contentDefaults.js';
import { loadAllPacks, localizeState } from '../../shared/i18n/index.js';
import { sanitizeHtmlResultWithParser } from '../../shared/sanitizeHtml.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const articleStyles = fs.readFileSync(path.join(ROOT, 'src', 'styles', 'global.scss'), 'utf8');
const galleryStyles = fs.readFileSync(path.join(ROOT, 'src', 'styles', 'inner-pages.scss'), 'utf8');
const adminStyles = fs.readFileSync(path.join(ROOT, 'src', 'admin', 'admin.scss'), 'utf8');
const expectedSlugs = [
  'yeast-types-for-baking',
  'fresh-vs-dry-yeast',
  'instant-vs-active-dry-yeast',
  'how-to-identify-quality-yeast',
  'buy-yeast-direct-from-factory',
  'yeast-buying-guide',
];
let passed = 0;
let failed = 0;
const check = (condition, label, detail = '') => {
  if (condition) {
    passed++;
    console.log(`ok  ${label}`);
  } else {
    failed++;
    console.log(`LEAK ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

check(
  DEFAULT_STATE.posts.length === expectedSlugs.length &&
    expectedSlugs.every((slug, index) => DEFAULT_STATE.posts[index]?.slug === slug),
  'the six supplied articles replace the placeholders in a stable order',
  DEFAULT_STATE.posts.map(({ slug }) => slug).join(', '),
);

let tableCount = 0;
let videoCount = 0;
let mediaErrors = [];
for (const post of DEFAULT_STATE.posts) {
  const cover = post.image || '';
  if (!cover.startsWith('/assets/blog/') || !cover.endsWith('.webp') ||
      !fs.existsSync(path.join(ROOT, 'public', cover.replace(/^\/+/, '')))) {
    mediaErrors.push(`${post.slug}: cover ${cover || '(missing)'}`);
  }

  const sanitized = sanitizeHtmlResultWithParser(post.body, DOMParser);
  if (!sanitized.ok || sanitized.html !== post.body) mediaErrors.push(`${post.slug}: body is not already safely normalized`);
  const document = new DOMParser().parseFromString(`<html><body>${post.body}</body></html>`, 'text/html');
  const body = document.querySelector('body');
  if (!body?.querySelector('h2') || (body?.textContent || '').trim().length < 1000) {
    mediaErrors.push(`${post.slug}: body is unexpectedly incomplete`);
  }
  for (const image of body?.querySelectorAll('img') || []) {
    const src = image.getAttribute('src') || '';
    if (!src.startsWith('/assets/blog/') || !src.endsWith('.webp') ||
        !fs.existsSync(path.join(ROOT, 'public', src.replace(/^\/+/, '')))) {
      mediaErrors.push(`${post.slug}: invalid image ${src || '(missing src)'}`);
    }
    if (!image.getAttribute('alt')) mediaErrors.push(`${post.slug}: image has no alt text`);
  }
  for (const source of body?.querySelectorAll('video source') || []) {
    const src = source.getAttribute('src') || '';
    videoCount++;
    if (!src.startsWith('/assets/blog/') || !src.endsWith('.mp4') ||
        !fs.existsSync(path.join(ROOT, 'public', src.replace(/^\/+/, '')))) {
      mediaErrors.push(`${post.slug}: invalid video ${src || '(missing src)'}`);
    }
  }
  tableCount += body?.querySelectorAll('figure[data-rich-table] table').length || 0;
}
check(mediaErrors.length === 0, 'all article bodies, WebP images and available videos are safe and local', mediaErrors.slice(0, 8).join('; '));
check(tableCount === 5, 'all five source comparison and packaging tables are retained in the safe rich-table format', String(tableCount));
check(videoCount === 1, 'the one video included in the archive is linked locally; unavailable video media is omitted', String(videoCount));
check(
  articleStyles.includes('.post-body figure:has(> video)') &&
    articleStyles.includes('width: min(100%, 720px)') &&
    articleStyles.includes('object-position: center') &&
    articleStyles.includes('color-scheme: dark'),
  'uploaded article players are capped, centered, and retain polished native controls',
);
check(
  articleStyles.includes('.post-body figure:has(> video),\n.post-body figure:has(> iframe)') &&
    articleStyles.includes('.post-body figure:has(> iframe) figcaption') &&
    articleStyles.includes('aspect-ratio: 16 / 9') &&
    articleStyles.includes('border-radius: 16px'),
  'article embeds share the same centered frame, responsive ratio, and caption treatment as uploaded videos',
);
check(
  adminStyles.includes('figure:has(> video) video') &&
    adminStyles.includes('figure:has(> iframe) iframe') &&
    adminStyles.includes('.rte-dialog__media-preview') &&
    galleryStyles.includes('.gallery-lightbox__stage video'),
  'admin previews and gallery lightboxes share polished native and embedded-video styling',
);

await loadAllPacks();
for (const locale of ['en', 'ar', 'ru']) {
  const localized = localizeState(DEFAULT_STATE, locale);
  const gaps = [];
  for (const source of DEFAULT_STATE.posts) {
    const post = localized.posts.find(({ slug }) => slug === source.slug);
    for (const field of ['title', 'excerpt', 'date', 'category', 'readTime', 'body']) {
      if (!post?.[field]) gaps.push(`${source.slug}.${field}`);
    }
  }
  const noPersianFallback = locale !== 'ru' || localized.posts.every((post) =>
    !/[\u0600-\u06ff]/u.test(`${post.title} ${post.excerpt} ${post.date} ${post.category} ${post.body}`));
  check(gaps.length === 0 && noPersianFallback, `${locale} has complete localized entries for all six articles`, gaps.join(', '));
}

console.log(`${passed}/${passed + failed}`);
if (failed) process.exit(1);
