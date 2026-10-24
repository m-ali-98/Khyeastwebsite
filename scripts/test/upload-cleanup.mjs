/* Upload-reference scanning and conservative orphan cleanup invariants. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  collectUploadReferences,
  deleteUnusedUploads,
  isUploadReferenced,
  listUnusedUploads,
  parseUploadUrl,
  UNUSED_UPLOAD_GRACE_MS,
} from '../../server/uploadCleanup.js';

let pass = 0;
let fail = 0;
const check = (ok, name, detail = '') => {
  if (ok) pass += 1;
  else {
    fail += 1;
    console.log(`LEAK ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ky-unused-uploads-'));
const imageDir = path.join(root, 'images');
const videoDir = path.join(root, 'videos');
fs.mkdirSync(imageDir, { recursive: true });
fs.mkdirSync(videoDir, { recursive: true });
const now = Date.now();
const old = new Date(now - UNUSED_UPLOAD_GRACE_MS - 60_000);
const put = (kind, name, bytes = 17, when = old) => {
  const file = path.join(root, kind, name);
  fs.writeFileSync(file, Buffer.alloc(bytes, 7));
  fs.utimesSync(file, when, when);
  return file;
};

try {
  /* Every persisted shape is intentional: the scanner must not only inspect a
     hard-coded `image` field and miss galleries, HTML, videos or trust seals. */
  put('images', 'gallery-w1600.webp');
  put('images', 'gallery-480.webp');
  put('images', 'gallery-768.webp');
  put('images', 'page.jpg');
  put('images', 'rich.jpg');
  put('images', 'seal.png');
  put('images', 'shop.jpg');
  put('videos', 'story.mp4');

  const content = {
    products: [{ images: ['/uploads/images/gallery-w1600.webp'] }],
    shop: { products: [{ images: ['/uploads/images/shop.jpg'] }] },
    media: { hero: '/uploads/images/page.jpg' },
    posts: [{ body: '<figure><img src="/uploads/images/rich.jpg?width=900"></figure>' }],
    sections: [{ video: '/uploads/videos/story.mp4#t=1' }],
    collections: { trustSeals: [{ image: 'https://site.test/uploads/images/seal.png' }] },
  };
  const references = collectUploadReferences(content);
  check(references.has('images/gallery-w1600.webp') && references.has('videos/story.mp4'), 'nested arrays, rich text and videos are scanned');
  check(references.has('images/seal.png') && references.has('images/shop.jpg'), 'trust seals and store galleries are scanned');
  check(
    collectUploadReferences('<img src="&#47;uploads&#47;images&#47;rich&period;jpg">').has('images/rich.jpg'),
    'HTML-entity encoded rich-text paths are still treated as references',
  );
  check(
    collectUploadReferences('/%75ploads/images/rich%2Ejpg').has('images/rich.jpg'),
    'percent-encoded safe path characters cannot hide an upload reference',
  );
  check(isUploadReferenced('/uploads/images/gallery-480.webp', content), 'one master reference protects every optimized variant');

  put('images', 'orphan-w1600.webp', 31);
  put('images', 'orphan-480.webp', 11);
  put('images', 'orphan-768.webp', 19);
  put('videos', 'fresh.mp4', 13, new Date(now));

  const first = listUnusedUploads(root, content, { now });
  check(first.totalCount === 1 && first.items[0]?.url === '/uploads/images/orphan-w1600.webp', 'only old unreferenced families are candidates', JSON.stringify(first.items));
  check(first.items[0]?.fileCount === 3 && first.items[0]?.bytes === 61, 'optimized variants preview as one family with total size');
  check(!first.items.some((item) => item.url.includes('fresh')), 'recent uploads remain inside the grace period');

  /* Simulate a save after preview. The destructive operation must rescan and
     preserve the newly referenced family instead of trusting the stale list. */
  const becameUsed = { ...content, draft: `<img src="${first.items[0].url}">` };
  const protectedResult = deleteUnusedUploads(root, becameUsed, [first.items[0].url], { now });
  check(protectedResult.removed.length === 0 && protectedResult.skipped.length === 1, 'deletion rescans and skips a newly referenced candidate');
  check(fs.existsSync(path.join(imageDir, 'orphan-480.webp')), 'a skipped responsive family remains complete');

  const removed = deleteUnusedUploads(root, content, [first.items[0].url], { now });
  check(removed.removed.length === 1 && removed.removed[0].fileCount === 3, 'confirmed cleanup removes the whole optimized family');
  check(!fs.readdirSync(imageDir).some((name) => name.startsWith('orphan-')), 'no optimized orphan survives cleanup');

  const shared = { a: '/uploads/images/page.jpg', b: '/uploads/images/page.jpg' };
  check(isUploadReferenced('/uploads/images/page.jpg', shared), 'a file shared by multiple fields remains in use');
  check(!parseUploadUrl('/uploads/images/../content.json') && !parseUploadUrl('https://evil.test/uploads/images/a.jpg'), 'cleanup accepts only exact safe local upload URLs');

  const cyclic = {};
  cyclic.self = cyclic;
  cyclic.image = '/uploads/images/page.jpg';
  check(collectUploadReferences(cyclic).has('images/page.jpg'), 'cyclic objects cannot trap the iterative reference scanner');
  let boundedFailClosed = false;
  try {
    collectUploadReferences({ one: { two: '/uploads/images/page.jpg' } }, { maxNodes: 1 });
  } catch (error) {
    boundedFailClosed = error?.code === 'UPLOAD_REFERENCE_SCAN_LIMIT';
  }
  check(boundedFailClosed, 'a bounded scan refuses cleanup instead of missing late references');
} catch (error) {
  check(false, 'cleanup harness', error?.stack || String(error));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`${pass}/${pass + fail}`);
if (fail) process.exit(1);
