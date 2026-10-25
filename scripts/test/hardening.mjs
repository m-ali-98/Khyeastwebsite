/* ==========================================================================
   Transport-level hardening checks against a real running server.

   Covers three things a code review does not catch:

   1. Security headers are present AND the CSP script hash matches the inline
      bootstrap actually being served. A stale hash is the dangerous failure
      here — the policy still looks strict, but the boot script silently stops
      running and the site renders with the wrong direction and theme.
   2. Errors never render a stack trace. Express's default handler puts
      absolute filesystem paths, the directory layout and dependency versions
      into the response body.
   3. No sensitive file is reachable over HTTP, and the SPA fallback is not
      mistaken for one — a traversal probe returning 200 is usually index.html.

   Run directly:  node scripts/test/hardening.mjs
   ========================================================================== */
import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

const PORT = 8973;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ky-harden-test-'));
const DB = path.join(DATA_DIR, 'hardening.db');

let pass = 0;
let fail = 0;
const check = (ok, name, detail = '') => {
  if (ok) pass += 1;
  else {
    fail += 1;
    console.log(`LEAK ${name}${detail ? ' — ' + detail : ''}`);
  }
};

/* fetch/Undici deliberately owns the Host header, so proxy-host tests use the
   core HTTP client to reproduce the bytes Apache sends to Node. */
const rawHttp = ({ port, path: requestPath, method = 'GET', headers = {}, body = '' }) =>
  new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: requestPath,
      method,
      headers: {
        ...headers,
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
      },
    }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({
        status: response.statusCode || 0,
        headers: response.headers,
        text,
        json: () => JSON.parse(text || '{}'),
      }));
    });
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });

let server;
let productionServer;
const start = async () => {
  server = spawn('node', ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR,
      UPLOAD_DIR: path.join(DATA_DIR, 'uploads'),
      DB_FILE: DB,
      PUBLIC_ORIGIN: BASE,
      NODE_ENV: 'development',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i += 1) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
};

try {
  const attributes = fs.readFileSync(path.join(ROOT, '.gitattributes'), 'utf8');
  for (const rule of ['ops/** text eol=lf', '*.sh text eol=lf', '*.service text eol=lf', '*.timer text eol=lf']) {
    check(attributes.split(/\r?\n/).includes(rule), `.gitattributes pins LF for ${rule.split(' ')[0]}`);
  }
  const opsRoot = path.join(ROOT, 'ops');
  const crlfOps = fs.readdirSync(opsRoot, { recursive: true })
    .filter((entry) => fs.statSync(path.join(opsRoot, entry)).isFile())
    .filter((entry) => fs.readFileSync(path.join(opsRoot, entry)).includes(Buffer.from('\r\n')));
  check(crlfOps.length === 0, 'committed operations files contain no CRLF bytes', crlfOps.join(', '));

  await start();

  /* ---- 1. security headers ---------------------------------------------- */
  const root = await fetch(`${BASE}/`);
  const h = (n) => root.headers.get(n) || '';

  check(!h('x-powered-by'), 'X-Powered-By removed', 'server advertises its stack');
  check(h('x-content-type-options') === 'nosniff', 'X-Content-Type-Options: nosniff');
  check(h('x-frame-options') === 'DENY', 'X-Frame-Options: DENY');
  check(/strict-origin/.test(h('referrer-policy')), 'Referrer-Policy set');
  check(/geolocation=\(\)/.test(h('permissions-policy')), 'Permissions-Policy set');
  check(h('cross-origin-opener-policy') === 'same-origin', 'COOP set');

  const csp = h('content-security-policy');
  for (const directive of [
    "default-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "connect-src 'self'",
  ]) {
    check(csp.includes(directive), `CSP has ${directive}`);
  }
  check(!/script-src[^;]*'unsafe-inline'/.test(csp), 'CSP script-src is not unsafe-inline');
  check(!/script-src[^;]*'unsafe-eval'/.test(csp), 'CSP script-src is not unsafe-eval');

  /* The hash in the header must match the inline script actually served, or
     the boot script is silently blocked in a real browser. */
  const html = await root.text();
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  if (inline.length) {
    for (const m of inline) {
      /* Hash what the BROWSER hashes. The HTML parser normalises CRLF to LF
         before the script text reaches the CSP check, so on a Windows
         checkout the raw bytes off the wire carry \r\n and hashing them
         produces a digest no browser ever computes. The server normalises
         for the same reason; this has to match it or the check fails on
         Windows while the real page works perfectly. */
      const text = m[1].replace(/\r\n/g, '\n');
      const want = crypto.createHash('sha256').update(text, 'utf8').digest('base64');
      check(csp.includes(`'sha256-${want}'`), 'CSP hash matches the served inline script');
    }
  }

  /* Fetchable page resources must stay on-origin. SEO canonicals, hreflang
     alternates and ordinary anchors are intentionally absolute URLs but CSP
     does not fetch them, so they are not resource-policy violations. */
  const linked = [
    ...[...html.matchAll(/<(?:script|img|source|video|audio)\b[^>]*\bsrc="([^"]+)"/gi)].map((m) => m[1]),
    ...[...html.matchAll(/<link\b(?=[^>]*\brel="(?:stylesheet|icon|preload|modulepreload)")[^>]*\bhref="([^"]+)"/gi)].map((m) => m[1]),
  ].filter((url) => !url.startsWith('data:'));
  check(
    linked.every((url) => !/^(https?:)?\/\//.test(url)),
    'every fetched resource is same-origin',
    linked.filter((url) => /^(https?:)?\/\//.test(url)).join(' '),
  );

  /* ---- 2. error responses must not leak internals ------------------------ */
  const STACKY = /home\/|node_modules|at JSON|SyntaxError|URIError|\.js:\d+/;

  const badJson = await fetch(`${BASE}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{bad',
  });
  const badJsonBody = await badJson.text();
  check(!STACKY.test(badJsonBody), 'malformed JSON leaks no stack', badJsonBody.slice(0, 90));
  check(
    badJson.headers.get('content-type')?.includes('application/json'),
    'malformed JSON returns JSON, not an HTML error page',
  );

  const badUri = await fetch(`${BASE}/api/shop-public/orders/%FF%FE`);
  const badUriBody = await badUri.text();
  check(!STACKY.test(badUriBody), 'malformed URL leaks no stack', badUriBody.slice(0, 90));

  /* ---- 3. sensitive paths are not served -------------------------------- */
  /* A 200 here is normally the SPA fallback. The file is only leaked if the
     body is NOT html and looks like the real thing. */
  const SECRET_PATHS = [
    ['/.env', /ADMIN_SECRET|ADMIN_PASS/],
    ['/.env.example', /ADMIN_SECRET/],
    ['/package.json', /"dependencies"/],
    ['/server/index.js', /require|import |app\.use/],
    ['/.git/config', /\[core\]|remote "origin"/],
    ['/server/data/content.json', /"texts"|"products"/],
    ['/vite.config.js', /defineConfig/],
    ['/node_modules/express/package.json', /"name":\s*"express"/],
  ];
  for (const [p, sig] of SECRET_PATHS) {
    const r = await fetch(BASE + p);
    const body = await r.text();
    const isHtml = /^\s*<!doctype html|^\s*<html/i.test(body);
    check(!(r.ok && !isHtml && sig.test(body)), `not served: ${p}`, `status ${r.status}`);
  }

  /* ---- 4. indexing policy is enforced at HTTP level ---------------------- */
  const missing = await fetch(`${BASE}/definitely-not-a-route`);
  const missingBody = await missing.text();
  check(missing.status === 404, 'unknown public route has a genuine HTTP 404');
  check(missing.headers.get('x-robots-tag')?.includes('noindex'), '404 carries an X-Robots-Tag noindex header');
  check(missingBody.includes('noindex, nofollow, noarchive'), '404 HTML carries a noindex directive');

  const privatePage = await fetch(`${BASE}/admin`);
  check(privatePage.status === 200 && privatePage.headers.get('x-robots-tag')?.includes('noindex'), 'functional admin route is noindex');

  const legacy = await fetch(`${BASE}/fa/dezmaye/`, { redirect: 'manual' });
  check(
    legacy.status === 301 && new URL(legacy.headers.get('location'), BASE).pathname === '/products/dezmaye-gold-80',
    'legacy/default-locale/trailing-slash duplicate redirects in one hop',
  );

  /* ---- 5. no CORS: the API must stay same-origin -------------------------- */
  const cors = await fetch(`${BASE}/api/content`, { headers: { Origin: 'https://evil.com' } });
  check(
    !cors.headers.get('access-control-allow-origin'),
    'no Access-Control-Allow-Origin for a foreign origin',
  );
  check(
    /no-store/.test(cors.headers.get('cache-control') || ''),
    'live content snapshots are never stored by a browser or intermediary',
  );

  /* Plain HTTP is usable only in non-production and uses a separate cookie
     name with no Secure flag; it can neither overwrite nor shadow the
     production __Host- credential. */
  const plainLogin = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: 'admin', pass: 'khyeast-1404' }),
  });
  const plainCookie = plainLogin.headers.get('set-cookie') || '';
  const plainCookiePair = plainCookie.split(';')[0];
  check(
    plainLogin.ok && /^ky_admin_dev=/.test(plainCookie) && !/^ky_admin_dev=[^,]*;[^,]*\bSecure\b/i.test(plainCookie),
    'plain-HTTP development login uses its distinct non-Secure cookie',
    plainCookie,
  );
  const plainMe = await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: plainCookiePair } });
  check(plainMe.ok && (await plainMe.json()).authenticated, 'the development cookie authenticates over plain HTTP');

  /* The default proxy policy trusts only loopback/private reverse proxies.
     This is the cPanel Apache/Passenger shape: Node sees Apache on loopback
     and req.ip/protocol become the public values Apache forwarded. */
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' },
    body: JSON.stringify({ user: 'admin', pass: 'khyeast-1404' }),
  });
  const loginBody = await login.json();
  const adminCookie = login.headers.get('set-cookie') || '';
  const adminCookiePair = adminCookie.split(';')[0];
  const secureAdminHeaders = { Cookie: adminCookiePair, 'X-Forwarded-Proto': 'https' };
  check(/^__Host-ky_admin=/.test(adminCookie) && /HttpOnly/i.test(adminCookie), 'admin session uses an HttpOnly __Host- cookie');
  check(/SameSite=Strict/i.test(adminCookie), 'admin session cookie is SameSite=Strict');
  check(/;\s*Secure/i.test(adminCookie) && /;\s*Path=\//i.test(adminCookie), '__Host- admin cookie is always Secure with Path=/');
  check(!/;\s*Domain=/i.test(adminCookie), '__Host- admin cookie cannot be scoped to a parent domain');
  check(!Object.hasOwn(loginBody, 'token'), 'admin credential is never returned to JavaScript in login JSON');

  const csrf = await fetch(`${BASE}/api/admin/security`, {
    method: 'PUT',
    headers: { ...secureAdminHeaders, Origin: 'https://evil.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ rateLimits: { enabled: false } }),
  });
  check(csrf.status === 403, 'cross-origin state changes cannot ride the admin cookie', `got ${csrf.status}`);

  const diagnostic = await fetch(`${BASE}/api/admin/security`, {
    headers: {
      ...secureAdminHeaders,
      'X-Forwarded-For': '203.0.113.42',
    },
  });
  const security = await diagnostic.json();
  check(diagnostic.ok && security.proxy?.clientIp === '203.0.113.42', 'trusted local proxy resolves the real visitor IP', JSON.stringify(security.proxy));
  check(security.proxy?.status === 'resolved', 'admin proxy diagnostics report a resolved forwarded address');

  /* Bypass every browser editor and send hostile rich text straight to the
     authenticated JSON endpoint. Persistence itself must canonicalise posts,
     translated post overrides and shop product descriptions. */
  const originalContent = await (await fetch(`${BASE}/api/content`)).json();
  const hostileContent = structuredClone(originalContent);
  const postSlug = hostileContent.posts[0].slug;
  hostileContent.posts[0].body = '<p onclick="steal()">متن <strong>مجاز</strong><script>alert(1)</script></p>';
  hostileContent.shop.products[0].description = '<img src="javascript:alert(1)" onerror="steal()"><p><em>توضیح مجاز</em></p>';
  hostileContent.i18n = {
    ...(hostileContent.i18n || {}),
    en: {
      ...(hostileContent.i18n?.en || {}),
      posts: {
        ...(hostileContent.i18n?.en?.posts || {}),
        [postSlug]: { ...(hostileContent.i18n?.en?.posts?.[postSlug] || {}), body: '<style>body{display:none}</style><p onmouseover="x()">Safe translation</p>' },
      },
    },
  };
  const hostileWrite = await fetch(`${BASE}/api/content`, {
    method: 'PUT',
    headers: { ...secureAdminHeaders, Origin: BASE, 'Content-Type': 'application/json' },
    body: JSON.stringify(hostileContent),
  });
  check(hostileWrite.ok, 'direct authenticated content write is accepted for server sanitizing', `got ${hostileWrite.status}`);
  const storedContent = await (await fetch(`${BASE}/api/content`)).json();
  const storedHtml = [
    storedContent.posts[0].body,
    storedContent.shop.products[0].description,
    storedContent.i18n.en.posts[postSlug].body,
  ].join('\n');
  check(!/(?:<script|<style|onerror|onclick|onmouseover|javascript:)/i.test(storedHtml), 'server removes active HTML before persistence', storedHtml.slice(0, 160));
  check(/<strong>مجاز<\/strong>/.test(storedHtml) && /<em>توضیح مجاز<\/em>/.test(storedHtml) && /Safe translation/.test(storedHtml), 'server sanitizer preserves allowed rich-text formatting');

  const oversizedContent = structuredClone(storedContent);
  oversizedContent.posts[0].body = 'x'.repeat(250_001);
  const oversizedWrite = await fetch(`${BASE}/api/content`, {
    method: 'PUT',
    headers: { ...secureAdminHeaders, Origin: BASE, 'Content-Type': 'application/json' },
    body: JSON.stringify(oversizedContent),
  });
  const oversizedError = await oversizedWrite.json();
  const contentAfterRefusal = await (await fetch(`${BASE}/api/content`)).json();
  check(
    oversizedWrite.status === 400 && oversizedError.code === 'input-too-large' &&
      /هیچ تغییری ذخیره نشد/.test(oversizedError.error || '') &&
      contentAfterRefusal.posts[0].body === storedContent.posts[0].body,
    'bounded rich-text refusal is a clear 400 and cannot partially overwrite content',
    JSON.stringify(oversizedError).slice(0, 180),
  );

  /* The dedicated shop endpoint bypasses writeContent, so prove the SQLite
     product boundary independently applies the same policy. */
  const shopAdmin = await (await fetch(`${BASE}/api/shop-admin/products`, { headers: secureAdminHeaders })).json();
  const originalProductDescription = shopAdmin.products[0].description;
  const oversizedProducts = structuredClone(shopAdmin.products);
  oversizedProducts[0].description = 'x'.repeat(250_001);
  const refusedProductWrite = await fetch(`${BASE}/api/shop-admin/products`, {
    method: 'PUT',
    headers: { ...secureAdminHeaders, Origin: BASE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ products: oversizedProducts }),
  });
  const refusedProductError = await refusedProductWrite.json();
  const productsAfterRefusal = await (
    await fetch(`${BASE}/api/shop-admin/products`, { headers: secureAdminHeaders })
  ).json();
  check(
    refusedProductWrite.status === 400 && refusedProductError.code === 'input-too-large' &&
      productsAfterRefusal.products[0].description === originalProductDescription,
    'a refused product description cannot delete or partially replace the SQLite catalogue',
    JSON.stringify(refusedProductError).slice(0, 180),
  );

  shopAdmin.products[0].description = '<p><strong>DB safe</strong><iframe src="https://evil.example"></iframe></p>';
  const directProductWrite = await fetch(`${BASE}/api/shop-admin/products`, {
    method: 'PUT',
    headers: { ...secureAdminHeaders, Origin: BASE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ products: shopAdmin.products }),
  });
  const directProducts = await directProductWrite.json();
  check(
    directProductWrite.ok && /<strong>DB safe<\/strong>/.test(directProducts.products[0].description) && !/<iframe/i.test(directProducts.products[0].description),
    'shop product database boundary sanitizes direct Admin API writes',
  );

  await fetch(`${BASE}/api/content`, {
    method: 'PUT',
    headers: { ...secureAdminHeaders, Origin: BASE, 'Content-Type': 'application/json' },
    body: JSON.stringify(originalContent),
  });

  /* A production process reached over plain HTTP must fail explicitly instead
     of returning {ok:true} with a Secure cookie the browser silently drops. */
  const productionPort = PORT + 100;
  const productionBase = `http://127.0.0.1:${productionPort}`;
  const productionData = fs.mkdtempSync(path.join(os.tmpdir(), 'ky-prod-cookie-test-'));
  productionServer = spawn('node', ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(productionPort),
      DATA_DIR: productionData,
      UPLOAD_DIR: path.join(productionData, 'uploads'),
      DB_FILE: path.join(productionData, 'production.db'),
      NODE_ENV: 'production',
      ADMIN_USER: 'cookie-admin',
      ADMIN_PASS: 'production-cookie-password',
      ADMIN_SECRET: 'production-cookie-secret-that-is-long-enough-1404',
      PUBLIC_ORIGIN: 'https://secure.example.test',
    },
    stdio: 'ignore',
  });
  for (let wait = 0; wait < 100; wait += 1) {
    try {
      if ((await fetch(`${productionBase}/api/health`)).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const insecureProductionLogin = await fetch(`${productionBase}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: 'cookie-admin', pass: 'production-cookie-password' }),
  });
  const insecureProductionBody = await insecureProductionLogin.json();
  check(
    insecureProductionLogin.status === 426 && insecureProductionBody.code === 'https-required' &&
      !insecureProductionLogin.headers.get('set-cookie'),
    'production HTTP login with an untrusted Host requires HTTPS and emits no credential',
    JSON.stringify(insecureProductionBody),
  );

  const explicitHttpLogin = await rawHttp({
    port: productionPort,
    path: '/api/auth/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Host: 'secure.example.test',
      'X-Forwarded-Proto': 'http',
    },
    body: JSON.stringify({ user: 'cookie-admin', pass: 'production-cookie-password' }),
  });
  check(
    explicitHttpLogin.status === 426 && !explicitHttpLogin.headers['set-cookie'],
    'a matching Host never overrides an explicit X-Forwarded-Proto: http',
    explicitHttpLogin.text,
  );
  const malformedHostLogin = await rawHttp({
    port: productionPort,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Host: 'secure.example.test?spoofed' },
    body: JSON.stringify({ user: 'cookie-admin', pass: 'production-cookie-password' }),
  });
  check(
    malformedHostLogin.status === 426 && !malformedHostLogin.headers['set-cookie'],
    'URL syntax in Host cannot be normalised into a trusted HTTPS authority',
    malformedHostLogin.text,
  );

  /* Some cPanel/Apache stacks preserve Host but omit X-Forwarded-Proto. The
     loopback peer is trusted and Host matches the HTTPS PUBLIC_ORIGIN, so this
     guarded fallback must avoid a day-one Admin lockout without accepting an
     arbitrary direct HTTP Host. */
  const inferredLoginBody = JSON.stringify({ user: 'cookie-admin', pass: 'production-cookie-password' });
  const inferredProductionLogin = await rawHttp({
    port: productionPort,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Host: 'secure.example.test' },
    body: inferredLoginBody,
  });
  const inferredSetCookies = inferredProductionLogin.headers['set-cookie'] || [];
  const inferredProductionCookie = inferredSetCookies.join(', ');
  const inferredCookiePair = String(inferredSetCookies[0] || '').split(';')[0];
  check(
    inferredProductionLogin.status === 200 && /^__Host-ky_admin=/.test(inferredProductionCookie) &&
      /;\s*Secure/i.test(inferredProductionCookie) &&
      /max-age=31536000/i.test(String(inferredProductionLogin.headers['strict-transport-security'] || '')),
    'trusted proxy + matching HTTPS PUBLIC_ORIGIN works without X-Forwarded-Proto',
    inferredProductionCookie,
  );
  const inferredSecurity = await rawHttp({
    port: productionPort,
    path: '/api/admin/security',
    headers: { Host: 'secure.example.test', Cookie: inferredCookiePair },
  });
  const inferredSecurityBody = inferredSecurity.json();
  check(
    inferredSecurity.status === 200 && inferredSecurityBody.proxy?.protocol === 'https' &&
      inferredSecurityBody.proxy?.protocolSource === 'public-origin-trusted-proxy' &&
      inferredSecurityBody.proxy?.forwardedProto === '' &&
      inferredSecurityBody.proxy?.hostTrusted === true &&
      inferredSecurityBody.rateLimitScope?.sharedAcrossWorkers === true,
    'Security diagnostics expose inferred protocol, source, Host trust, and shared limiter scope',
    JSON.stringify(inferredSecurityBody.proxy),
  );

  const secureProductionLogin = await fetch(`${productionBase}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' },
    body: JSON.stringify({ user: 'cookie-admin', pass: 'production-cookie-password' }),
  });
  const secureProductionCookie = secureProductionLogin.headers.get('set-cookie') || '';
  check(
    secureProductionLogin.ok && /^__Host-ky_admin=/.test(secureProductionCookie) && /;\s*Secure/i.test(secureProductionCookie),
    'production HTTPS retains the Secure __Host- cookie',
    secureProductionCookie,
  );
  productionServer.kill('SIGKILL');
  productionServer = null;
  fs.rmSync(productionData, { recursive: true, force: true });
} catch (e) {
  check(false, 'hardening harness', String(e.message).slice(0, 120));
} finally {
  if (server) server.kill('SIGKILL');
  if (productionServer) productionServer.kill('SIGKILL');
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch {}
}

console.log(`${pass}/${pass + fail}`);
