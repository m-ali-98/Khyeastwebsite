import DEFAULT_STATE from '../../shared/contentDefaults.js';
import { localizeState, loadAllPacks } from '../../shared/i18n/index.js';
import {
  GALLERY_PAGE_SIZE,
  cleanGalleryAssetUrl,
  galleryItemsProblem,
  galleryOverridesProblem,
  normalizeGalleryItems,
  stripGalleryMediaOverrides,
} from '../../shared/gallery.js';

let pass = 0;
let total = 0;
const leaks = [];
const check = (condition, label) => {
  total += 1;
  if (condition) pass += 1;
  else leaks.push(`LEAK ${label}`);
};

await loadAllPacks();

check(GALLERY_PAGE_SIZE === 9, 'public gallery contract is exactly nine items per page');
check(!galleryItemsProblem(DEFAULT_STATE.gallery), 'seeded company gallery passes strict validation');
check(normalizeGalleryItems(undefined, DEFAULT_STATE.gallery).length === DEFAULT_STATE.gallery.length, 'legacy state without a gallery inherits the shipped seed');
check(DEFAULT_STATE.gallery.every((item) => cleanGalleryAssetUrl(item.src, 'image')), 'seed media uses safe local image paths');
check(cleanGalleryAssetUrl('/uploads/videos/demo.mp4', 'video') === '/uploads/videos/demo.mp4', 'MP4 upload path is accepted');
check(cleanGalleryAssetUrl('/uploads/videos/demo.webm', 'video') === '/uploads/videos/demo.webm', 'WebM upload path is accepted');
check(!cleanGalleryAssetUrl('https://example.com/demo.mp4', 'video'), 'external gallery video is rejected');
check(!cleanGalleryAssetUrl('http://khuzestanyeast-co.com/demo.jpg', 'image'), 'HTTP gallery image is rejected');
check(!cleanGalleryAssetUrl('/uploads/images/../videos/demo.mp4', 'image'), 'path traversal is rejected');
check(!cleanGalleryAssetUrl('//example.com/demo.jpg', 'image'), 'protocol-relative gallery image is rejected');
check(!cleanGalleryAssetUrl('/uploads/videos/demo.mov', 'video'), 'browser-inconsistent MOV source is rejected');

const validVideo = [{
  id: 'factory-film',
  type: 'video',
  src: '/uploads/videos/factory.mp4',
  poster: '/uploads/images/factory.webp',
  caption: 'Factory film',
  description: 'A longer description.',
}];
check(!galleryItemsProblem(validVideo), 'video with an uploaded poster passes validation');
check(galleryItemsProblem([{ ...validVideo[0], poster: 'https://example.com/poster.jpg' }]) === 'gallery-poster-invalid', 'external video poster is rejected');
check(galleryItemsProblem([{ ...validVideo[0], caption: '' }]) === 'gallery-caption-invalid', 'blank caption is rejected');
check(galleryItemsProblem([...validVideo, { ...validVideo[0] }]) === 'gallery-id-duplicate', 'duplicate stable id is rejected');
check(galleryItemsProblem([{ ...validVideo[0], src: '/uploads/images/not-a-video.webp' }]) === 'gallery-src-invalid', 'media type and source directory must agree');

const malformed = normalizeGalleryItems([null, validVideo[0], { id: 'bad', type: 'image', src: 'javascript:alert(1)' }]);
check(malformed.length === 1 && malformed[0].id === 'factory-film', 'defensive normalization drops malformed rows');

const stripped = stripGalleryMediaOverrides({
  'factory-film': {
    caption: 'Translated',
    description: 'Copy',
    src: 'https://evil.example/video.mp4',
    poster: '/uploads/images/replacement.webp',
    type: 'image',
  },
});
check(
  Object.keys(stripped['factory-film']).sort().join(',') === 'caption,description',
  'locale overlay cannot replace structural media fields',
);
check(
  galleryOverridesProblem({ 'factory-film': { caption: 'x'.repeat(141) } }) === 'gallery-translation-caption-invalid',
  'oversized localized captions are refused',
);

const en = localizeState(DEFAULT_STATE, 'en');
const ar = localizeState(DEFAULT_STATE, 'ar');
check(en.gallery[0].caption === 'A Look at Khuzestan Yeast Products', 'English gallery seed is localized');
check(ar.gallery[0].caption === 'نظرة على منتجات الخميرة في خوزستان', 'Arabic gallery seed is localized');
check(en.gallery[0].src === DEFAULT_STATE.gallery[0].src && ar.gallery[0].src === DEFAULT_STATE.gallery[0].src, 'all locales share one media source');

for (const leak of leaks) console.log(leak);
console.log(`${pass}/${total}`);
if (pass !== total) process.exitCode = 1;
