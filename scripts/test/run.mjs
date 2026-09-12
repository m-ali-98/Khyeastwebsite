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

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));

const ROUTES = [
  '/', '/about', '/products', '/products/dezmaye-gold-80', '/products/shetab-90',
  '/products/xpower-70', '/products/nanmaye-10', '/shop', '/shop/cart',
  '/shop/checkout', '/shop/dezmaye-gold-80', '/export', '/quality', '/blog',
  '/blog/reduce-bread-production-costs', '/contact',
  '/en', '/en/about', '/en/products', '/en/blog', '/en/contact', '/en/shop',
  '/ar', '/ar/about', '/ar/products', '/ar/contact', '/ar/shop',
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

async function child(script, arg) {
  const { stdout } = await run('node', [path.join(HERE, script), arg], { cwd: HERE, timeout: 40000 });
  return JSON.parse(stdout.trim().split('\n').pop());
}

console.log('\nRoutes — every page must mount and render real content');
for (const route of ROUTES) {
  try {
    const r = await child('route-one.mjs', route);
    const ok = r.chars > 40 && !r.errors.length;
    record(ok, `route ${route}`, r.errors[0]?.slice(0, 90) || `${r.chars} chars`);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${route.padEnd(38)} ${String(r.chars).padStart(5)}ch ${r.errors[0]?.slice(0, 60) || ''}`);
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
      const { stdout } = await run('node', [path.join(HERE, 'content-one.mjs'), name, route], { cwd: HERE, timeout: 40000 });
      const r = JSON.parse(stdout.trim().split('\n').pop());
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
try {
  const { stdout } = await run('node', [path.join(HERE, 'sanitizer.mjs')], { cwd: HERE, timeout: 40000 });
  const line = stdout.trim().split('\n').pop();
  const m = line.match(/(\d+)\/(\d+)/);
  const leaks = stdout.split('\n').filter((l) => l.startsWith('LEAK'));
  const ok = Boolean(m) && m[1] === m[2];
  record(ok, 'sanitizer', leaks.join('; ').slice(0, 120));
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${line}`);
  leaks.forEach((l) => console.log('       ' + l));
} catch (e) {
  record(false, 'sanitizer', String(e.message).slice(0, 90));
  console.log('  FAIL sanitizer harness error');
}

console.log('\nPayment — the money path must fail closed');
try {
  const { stdout } = await run('node', [path.join(HERE, 'payment.mjs')], { cwd: HERE, timeout: 40000 });
  const line = stdout.trim().split('\n').pop();
  const m = line.match(/(\d+)\/(\d+)/);
  const leaks = stdout.split('\n').filter((l) => l.startsWith('LEAK'));
  const ok = Boolean(m) && m[1] === m[2];
  record(ok, 'payment', leaks.join('; ').slice(0, 160));
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${line} amount + callback-origin cases`);
  leaks.forEach((l) => console.log('       ' + l));
} catch (e) {
  record(false, 'payment', String(e.message).slice(0, 90));
  console.log('  FAIL payment harness error');
}

console.log('\nAuth — logging out must revoke the token, not just forget it');
try {
  const { stdout } = await run('node', [path.join(HERE, 'auth.mjs')], { cwd: HERE, timeout: 60000 });
  const line = stdout.trim().split('\n').pop();
  const m = line.match(/(\d+)\/(\d+)/);
  const leaks = stdout.split('\n').filter((l) => l.startsWith('LEAK'));
  const ok = Boolean(m) && m[1] === m[2];
  record(ok, 'auth', leaks.join('; ').slice(0, 160));
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${line} session / revocation cases`);
  leaks.forEach((l) => console.log('       ' + l));
} catch (e) {
  record(false, 'auth', String(e.message).slice(0, 90));
  console.log('  FAIL auth harness error');
}

console.log('\nHardening — headers, error leakage, exposed files');
try {
  const { stdout } = await run('node', [path.join(HERE, 'hardening.mjs')], { cwd: HERE, timeout: 60000 });
  const line = stdout.trim().split('\n').pop();
  const m = line.match(/(\d+)\/(\d+)/);
  const leaks = stdout.split('\n').filter((l) => l.startsWith('LEAK'));
  const ok = Boolean(m) && m[1] === m[2];
  record(ok, 'hardening', leaks.join('; ').slice(0, 160));
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${line} transport-level checks`);
  leaks.forEach((l) => console.log('       ' + l));
} catch (e) {
  record(false, 'hardening', String(e.message).slice(0, 90));
  console.log('  FAIL hardening harness error');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log('  • ' + f));
  process.exit(1);
}
console.log('All checks passed.\n');
