/* ==========================================================================
   Point saved content at the WebP images.

     node scripts/migrate-content-webp.mjs --dry
     node scripts/migrate-content-webp.mjs

   Why this is separate from to-webp.mjs:

   server/data/content.json is live data, not source. It is created on first
   run and then owned by the admin panel, so it is NOT overwritten by a
   deploy — and its values take precedence over shared/contentDefaults.js.
   Converting the files and rewriting the source defaults therefore is not
   enough: an existing installation keeps serving the original PNG/JPEG paths
   it saved earlier, and the conversion has no effect at all.

   Only rewrites a path when the .webp file actually exists on disk, and only
   for the site's own bundled artwork — admin uploads under /uploads are left
   alone, since those files have not been converted.
   ========================================================================== */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import path from 'node:path';

const DRY = process.argv.includes('--dry');
const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = path.join(ROOT, 'server/data/content.json');
const PUBLIC = path.join(ROOT, 'public');

if (!existsSync(FILE)) {
  console.log('\n  server/data/content.json does not exist yet — nothing to migrate.');
  console.log('  A fresh install will pick up the WebP paths from contentDefaults.js.\n');
  process.exit(0);
}

const original = readFileSync(FILE, 'utf8');

/* Every /assets/... image path the file mentions. */
const PATTERN = /\/assets\/(?:img|products)\/[A-Za-z0-9._-]+\.(?:png|jpe?g)/g;
const found = [...new Set(original.match(PATTERN) || [])];

let text = original;
const changed = [];
const skipped = [];

for (const ref of found) {
  const webp = ref.replace(/\.(png|jpe?g)$/i, '.webp');
  if (!existsSync(path.join(PUBLIC, webp))) {
    skipped.push(`${ref} — no ${path.basename(webp)} on disk`);
    continue;
  }
  const count = text.split(ref).length - 1;
  text = text.split(ref).join(webp);
  changed.push(`${ref} -> ${webp} (${count}x)`);
}

/* Never write a file that would not parse — this is the site's content. */
try {
  JSON.parse(text);
} catch (e) {
  console.error('\n  ABORTED: result would not be valid JSON —', e.message, '\n');
  process.exit(1);
}

console.log(`\n${DRY ? 'DRY RUN — nothing written' : 'Migrated'}\n`);
changed.forEach((c) => console.log('  ' + c));
skipped.forEach((s) => console.log('  skipped ' + s));
if (!changed.length) console.log('  nothing to do — already migrated');

if (!DRY && changed.length) {
  copyFileSync(FILE, FILE + '.bak');
  writeFileSync(FILE, text);
  console.log(`\n  backup written to server/data/content.json.bak`);
}
console.log('');
