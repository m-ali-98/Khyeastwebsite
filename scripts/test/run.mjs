/* ==========================================================================
   Full test suite.

     npm test          (runs vite build first, then this)

   Why it exists: `vite build` only proves the code parses. It cannot catch a
   ReferenceError thrown during render, which blanks the whole site while the
   build still reports success — that is exactly how an undefined easing
   constant once shipped a white page to production.

   So every check here executes the real built bundle against a real DOM, or
   talks to a real running server. Each route boots in its own child process
   because module state (React's registry, the route prefetch cache) leaks
   between boots inside one process and produces false failures.
   ========================================================================== */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runNodeSuite, summarizeNodeSuite } from './suite-harness.mjs';

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));

const ROUTES = [
  '/', '/about', '/products', '/products/dezmaye-gold-80', '/products/shetab-90',
  '/products/xpower-70', '/products/nanmaye-500', '/shop', '/shop/cart',
  '/shop/checkout', '/shop/dezmaye-gold-80', '/export', '/quality', '/blog',
  '/blog/reduce-bread-production-costs', '/gallery', '/sales-representatives', '/contact', '/shop/login', '/shop/account',
  '/en', '/en/about', '/en/products', '/en/products/dezmaye-gold-80', '/en/blog', '/en/gallery', '/en/contact', '/en/sales-representatives', '/en/shop',
  '/ar', '/ar/about', '/ar/products', '/ar/products/dezmaye-gold-80', '/ar/gallery', '/ar/contact', '/ar/shop',
  '/dezmaye', '/shetab', '/nonexistent-page',
];

/* Values a corrupted or hostile localStorage could hold. The literal string
   "null" is the important one: it is truthy, so a naive `v ? JSON.parse(v)`
   guard passes it straight through and every `{ ...cart }` spread then throws,
   killing the entire site with no way for the visitor to recover. */
const CART_STATES = [
  '{}', 'null', '{not json', '42', '"hello"', '[{"slug":"x"}]',
  '{"dezmaye-gold-80":2}', '{"dezmaye-gold-80":"abc"}', '{"dezmaye-gold-80":-5}',
  '{"dezmaye-gold-80":1000000000}', '{"dezmaye-gold-80":null}', '{"no-such":2}',
  '{"__proto__":{"polluted":1},"dezmaye-gold-80":1}',
];

let pass = 0;
let fail = 0;
const failures = [];

const record = (ok, label, detail = '') => {
  if (ok) { pass++; return; }
  fail++;
  failures.push(`${label}${detail ? ' — ' + detail : ''}`);
};

/* A non-zero child makes execFile reject, but the rejection still contains
   the assertion summary and LEAK diagnostics. Keep both instead of reducing
   an actionable failure to a generic harness error. */
async function reportSuite(file, timeout, description = '') {
  const name = file.replace('.mjs', '');
  const result = await runNodeSuite(path.join(HERE, file), { cwd: HERE, timeout });
  const { line, leaks, ok, detail } = summarizeNodeSuite(result);

  record(ok, name, detail.slice(0, 300));
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${line || '?'}${description ? ` ${description}` : ''}`);
  leaks.forEach((entry) => console.log('       ' + entry));
  if (result.failed && result.error) {
    console.log('       ' + result.error.split('\n').slice(-4).join(' | ').slice(0, 300));
  }
}

async function child(script, ...args) {
  const { stdout } = await run(process.execPath, [path.join(HERE, script), ...args], { cwd: HERE, timeout: 40000 });
  return JSON.parse(stdout.trim().split('\n').pop());
}

console.log('\nTest harness — child failures must retain their diagnostics');
await reportSuite('runner-harness.mjs', 10000, 'exit-code and diagnostic checks');

console.log('\nRoutes — every page must mount and render real content');
for (const route of ROUTES) {
  try {
    const r = await child('route-one.mjs', route);
    const nameless = r.namelessLinks || [];
    const skips = r.headingSkips || [];
    const ok = r.chars > 40 && !r.errors.length && !nameless.length && !skips.length;
    const why =
      r.errors[0]?.slice(0, 90) ||
      (nameless.length ? `nameless link: ${nameless.join(', ')}` : '') ||
      (skips.length ? `heading level skipped: ${skips.join(', ')}` : '') ||
      `${r.chars} chars`;
    record(ok, `route ${route}`, why);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${route.padEnd(38)} ${String(r.chars).padStart(5)}ch ${ok ? '' : why.slice(0, 60)}`);
  } catch (e) {
    record(false, `route ${route}`, String(e.message).split('\n')[0].slice(0, 90));
    console.log(`  FAIL ${route.padEnd(38)} harness error`);
  }
}

console.log('\nCart — a corrupted localStorage must never take the site down');
for (const state of CART_STATES) {
  try {
    const r = await child('cart-one.mjs', state);
    const ok = r.chars > 40 && !r.errors.length;
    record(ok, `cart ${state}`, r.errors[0]?.slice(0, 90));
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${state.slice(0, 46).padEnd(48)} ${String(r.chars).padStart(5)}ch ${r.errors[0]?.slice(0, 50) || ''}`);
  } catch (e) {
    record(false, `cart ${state}`, String(e.message).slice(0, 90));
    console.log(`  FAIL ${state.slice(0, 46).padEnd(48)} harness error`);
  }
}

console.log('\nContent — a malformed API payload must not blank the site');
const CONTENT_CASES = [
  'texts is string', 'products is object', 'products null', 'product missing slug',
  'product is null', 'posts is string', 'shop missing', 'shop.products null',
  'deeply empty', 'array at root', 'null at root', 'number at root', 'huge nesting',
];
for (const name of CONTENT_CASES) {
  for (const route of ['/', '/products', '/shop']) {
    try {
      const r = await child('content-one.mjs', name, route);
      const ok = r.chars > 40 && !r.errors.length;
      record(ok, `content ${name} @ ${route}`, r.errors[0]?.slice(0, 80));
      if (!ok) console.log(`  FAIL ${name.padEnd(22)} ${route.padEnd(11)} ${String(r.chars).padStart(5)}ch ${r.errors[0]?.slice(0, 50) || ''}`);
    } catch (e) {
      record(false, `content ${name} @ ${route}`, String(e.message).slice(0, 80));
      console.log(`  FAIL ${name.padEnd(22)} ${route.padEnd(11)} harness error`);
    }
  }
}
console.log(`  ${CONTENT_CASES.length * 3} malformed payloads checked`);

console.log('\nSanitizer — admin-authored HTML must never execute or restyle');
await reportSuite('sanitizer.mjs', 40000);

console.log('\nPayment — the money path must fail closed');
await reportSuite('payment.mjs', 40000, 'amount + callback-origin cases');

console.log('\nSMS — a message that cannot be sent must not cost an order');
await reportSuite('sms.mjs', 40000, 'phone, secret and transport cases');

console.log('\nAuth — logging out must revoke the session, not just hide its cookie');
await reportSuite('auth.mjs', 60000, 'session / revocation cases');

console.log('\nHardening — headers, error leakage, exposed files');
await reportSuite('hardening.mjs', 60000, 'transport-level checks');

console.log('\nPersistence lifecycle — authoritative state and active requests survive failures');
for (const [file, description] of [
  ['content-store.mjs', 'fresh final-schema initialization, incompatible-store refusal and worker revisions'],
  ['migrations.mjs', 'explicit plans, transactional rollback and verified pre-change backups'],
  ['graceful-shutdown.mjs', 'bounded HTTP request drain'],
  ['backup-script.mjs', 'validated staged backup and quarantine/incoming exclusion'],
  ['offsite-script.mjs', 'checksum-gated encrypted offsite replication'],
]) {
  await reportSuite(file, 30000, description);
}

console.log('\nTheme — first paint defaults light and saved dark mode stays coherent');
await reportSuite('theme.mjs', 30000, 'startup and palette checks');

console.log('\nLoading — first paint and route feedback follow real readiness');
await reportSuite('loading.mjs', 30000, 'readiness and motion checks');

console.log('\nAssets — every referenced image must ship, and nothing oversized');
await reportSuite('assets.mjs', 30000, 'asset checks');

console.log('\nSEO — every public route must be crawlable, canonical and safe');
await reportSuite('seo.mjs', 40000, 'crawl, metadata, schema and sitemap checks');

console.log('\nSales representatives — worksheet data, Iran geometry and persistence rules');
await reportSuite('sales-representatives.mjs', 10000, 'worksheet, map and validation checks');

console.log('\nUpload optimisation — a photo may be shrunk, but never lost or broken');
for (const [file, description, timeout] of [
  ['images.mjs', 'upload optimisation checks', 60000],
  ['upload-cleanup.mjs', 'unused-file reference and safety checks', 30000],
  ['upload.mjs', 'upload round-trip checks', 90000],
]) {
  await reportSuite(file, timeout, description);
}

console.log('\nAccounts — a phone, a password, and no sight of anyone else orders');
for (const [file, description, timeout] of [
  ['accounts.mjs', 'hashing, codes, sessions and addresses', 40000],
  ['account-http.mjs', 'signup, login, ownership and snapshots', 90000],
]) {
  await reportSuite(file, timeout, description);
}

console.log('\nProduct catalogue — recovered variants, localized details, media and routes');
await reportSuite('product-catalog.mjs', 10000, 'variant, translation, media and routing checks');

console.log('\nShop product drafts — catalogue selections should fill every reusable field');
await reportSuite('shop-product-draft.mjs', 10000, 'catalogue-to-shop autofill checks');

console.log('\nProduct images — legacy media, ordered galleries and SQLite persistence');
await reportSuite('product-images.mjs', 40000, 'gallery compatibility and persistence checks');

console.log('\nPublic gallery — safe media, locale overlays and page-size contract');
await reportSuite('gallery.mjs', 10000, 'media validation and localization checks');

console.log('\nCart availability — persisted lines follow the live catalogue');
await reportSuite('cart-availability.mjs', 10000, 'deletion, deactivation and stock-change checks');

console.log('\nInventory — duplicate carts and abandoned payments cannot oversell');
await reportSuite('inventory.mjs', 40000, 'stock and expiry checks');

console.log('\nBehaviour — limits, errors and inventory must not cost a sale');
await reportSuite('behaviour.mjs', 90000, 'behavioural checks');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log('  • ' + f));
  process.exit(1);
}
console.log('All checks passed.\n');
