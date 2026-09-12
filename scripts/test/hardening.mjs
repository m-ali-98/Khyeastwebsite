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
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

const PORT = 8973;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(os.tmpdir(), `ky-harden-test-${process.pid}.db`);

let pass = 0;
let fail = 0;
const check = (ok, name, detail = '') => {
  if (ok) pass += 1;
  else {
    fail += 1;
    console.log(`LEAK ${name}${detail ? ' — ' + detail : ''}`);
  }
};

let server;
const start = async () => {
  server = spawn('node', ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_FILE: DB, NODE_ENV: 'development' },
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
      const want = crypto.createHash('sha256').update(m[1], 'utf8').digest('base64');
      check(csp.includes(`'sha256-${want}'`), 'CSP hash matches the served inline script');
    }
  }

  /* Nothing the page links to may be off-origin, or CSP blocks it. */
  const linked = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((u) => !u.startsWith('data:'));
  check(
    linked.every((u) => !/^(https?:)?\/\//.test(u)),
    'every linked resource is same-origin',
    linked.filter((u) => /^(https?:)?\/\//.test(u)).join(' '),
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

  /* ---- 4. no CORS: the API must stay same-origin -------------------------- */
  const cors = await fetch(`${BASE}/api/content`, { headers: { Origin: 'https://evil.com' } });
  check(
    !cors.headers.get('access-control-allow-origin'),
    'no Access-Control-Allow-Origin for a foreign origin',
  );
} catch (e) {
  check(false, 'hardening harness', String(e.message).slice(0, 120));
} finally {
  if (server) server.kill('SIGKILL');
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* already gone */
    }
  }
}

console.log(`${pass}/${pass + fail}`);
