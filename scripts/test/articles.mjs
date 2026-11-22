/* Integrity checks for the Persian article import and its local media. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from 'linkedom';
import DEFAULT_STATE from '../../shared/contentDefaults.js';
import { loadAllPacks, localizeState } from '../../shared/i18n/index.js';
import { sanitizeHtmlResultWithParser } from '../../shared/sanitizeHtml.js';
import { wordBoundaryExcerpt } from '../../shared/excerpt.js';

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
const PERSIAN_SPECIFIC_LETTERS = /[\u067e\u0686\u0698\u06af\u06a9\u06cc]/u;
const VIDEO_UI_ARTIFACT = /نمایشگر\s*ویدیو|00:0000:0000:05|برای افزایش یا کاهش صدا از کلیدهای بالا و پایین استفاده کنید/u;
const parseArticleBody = (html) => new DOMParser()
  .parseFromString(`<html><body>${html}</body></html>`, 'text/html')
  .querySelector('body');
const articleBodyShape = (html) => {
  const body = parseArticleBody(html);
  return {
    headings: [...body.querySelectorAll('h2, h3, h4')].map(({ tagName }) => tagName.toLowerCase()),
    tables: [...body.querySelectorAll('table')].map((table) =>
      [...table.querySelectorAll('tr')].map((row) => [...row.children].map(({ tagName }) => tagName.toLowerCase()).join(',')),
    ),
    media: [...body.querySelectorAll('img, video')].map((element) => {
      if (element.tagName.toLowerCase() === 'img') return `img:${element.getAttribute('src')}`;
      const sources = [...element.querySelectorAll('source')].map((source) =>
        `${source.getAttribute('type') || ''}:${source.getAttribute('src') || ''}`,
      );
      return `video:${element.getAttribute('src') || ''}:${sources.join('|')}:${element.hasAttribute('controls')}:${element.getAttribute('preload') || ''}`;
    }),
  };
};
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

check(wordBoundaryExcerpt('بازار روبه رو ش…') === 'بازار روبه رو…', 'legacy excerpts end at a word boundary');
check(wordBoundaryExcerpt('متن کامل.') === 'متن کامل.', 'complete editorial excerpts remain unchanged');
check(wordBoundaryExcerpt('متن کامل …') === 'متن کامل …', 'an explicitly separated ellipsis remains unchanged');

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
  DEFAULT_STATE.posts.every(({ body }) => !VIDEO_UI_ARTIFACT.test(body)),
  'imported native-player labels, timestamps, and keyboard-help text are removed from article copy',
);
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
  const failures = [];
  for (const source of DEFAULT_STATE.posts) {
    const post = localized.posts.find(({ slug }) => slug === source.slug);
    if (!post) {
      failures.push(`${source.slug}: missing article`);
      continue;
    }
    for (const field of ['title', 'excerpt', 'date', 'category', 'readTime', 'body']) {
      if (!post[field]) failures.push(`${source.slug}.${field}: missing translation`);
      else if (PERSIAN_SPECIFIC_LETTERS.test(post[field])) failures.push(`${source.slug}.${field}: Persian text remains`);
    }
    if (post.image !== source.image) failures.push(`${source.slug}: cover image differs from Persian source`);
    if (VIDEO_UI_ARTIFACT.test(post.body)) failures.push(`${source.slug}: imported player-help text remains`);
    if (JSON.stringify(articleBodyShape(post.body)) !== JSON.stringify(articleBodyShape(source.body))) {
      failures.push(`${source.slug}: headings, tables, image/video paths, or video controls do not match Persian source`);
    }
    const body = parseArticleBody(post.body);
    for (const image of body.querySelectorAll('img')) {
      const alt = image.getAttribute('alt') || '';
      if (!alt || PERSIAN_SPECIFIC_LETTERS.test(alt)) failures.push(`${source.slug}: image alt text is missing or untranslated`);
    }
    for (const anchor of body.querySelectorAll('a[href^="/"]')) {
      if (!anchor.getAttribute('href').startsWith(`/${locale}`)) failures.push(`${source.slug}: internal link is not localized`);
    }
    const safe = sanitizeHtmlResultWithParser(post.body, DOMParser);
    if (!safe.ok) failures.push(`${source.slug}: translated body is not safe rich text`);
  }
  check(
    failures.length === 0,
    `${locale} has complete translated articles synchronized with Persian text structure and media`,
    failures.slice(0, 8).join('; '),
  );
}

console.log(`${passed}/${passed + failed}`);
if (failed) process.exit(1);
