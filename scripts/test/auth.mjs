/* ==========================================================================
   Session / token-revocation checks against a real running server.

   A signed token cannot be taken back on its own. Before sessions existed,
   logging out only deleted the token from the browser's localStorage — any
   copy captured in the meantime stayed valid for the remainder of its 12-hour
   life. These checks prove that ending a session really does kill the token
   everywhere, that it does not disturb other sessions, and that a self-signed
   token carrying an invented session id is refused.

   Run directly:  node scripts/test/auth.mjs
   ========================================================================== */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

const PORT = 8971;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(os.tmpdir(), `ky-auth-test-${process.pid}.db`);
const PASS = 'khyeast-1404';
const SECRET = 'khyeast-content-secret-dev';

let pass = 0;
let fail = 0;
const check = (ok, name, detail = '') => {
  if (ok) pass += 1;
  else {
    fail += 1;
    console.log(`LEAK ${name}${detail ? ' — ' + detail : ''}`);
  }
};

/* ---- server lifecycle ----------------------------------------------------- */

let server;
const start = async () => {
  server = spawn('node', ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_FILE: DB, NODE_ENV: 'development' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i += 1) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
};

const stop = () => {
  if (server) server.kill('SIGKILL');
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* already gone */
    }
  }
};

const login = async () => {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: 'admin', pass: PASS }),
  });
  return (await r.json()).token;
};

/* Status of an authenticated probe carrying `token`. */
const probe = async (token, url = '/api/auth/me') =>
  (await fetch(BASE + url, { headers: { Authorization: `Bearer ${token}` } })).status;

const post = (token, url) =>
  fetch(BASE + url, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });

/* Forge a correctly signed token with an arbitrary payload, exactly as an
   attacker who knew the secret would. */
const forge = (payload) => {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
};

/* ---- checks --------------------------------------------------------------- */

try {
  await start();

  /* A fresh token works, and stops working the moment its session ends. */
  const t = await login();
  check((await probe(t)) === 200, 'fresh token accepted');
  check((await probe(t, '/api/messages')) === 200, 'fresh token reaches admin routes');

  await post(t, '/api/auth/logout');
  check((await probe(t)) === 401, 'logged-out token rejected', 'a stolen copy would still work');
  check(
    (await probe(t, '/api/messages')) === 401,
    'logged-out token blocked from admin routes',
  );
  check((await post(t, '/api/auth/logout')).status === 401, 'double logout is rejected');

  /* Ending one session must not disturb another. */
  const a = await login();
  const b = await login();
  check(a !== b, 'each login issues a distinct token');
  await post(a, '/api/auth/logout');
  check((await probe(a)) === 401, 'session A ended');
  check((await probe(b)) === 200, 'session B survives A logging out');

  /* The panic button kills everything, including the caller. */
  const c = await login();
  await post(b, '/api/auth/logout-all');
  check((await probe(b)) === 401, 'logout-all ends the calling session');
  check((await probe(c)) === 401, 'logout-all ends every other session');

  /* A valid signature is not enough: the session id must be one the server
     actually issued. These payloads are all correctly signed. */
  const exp = Date.now() + 9e8;
  const FORGED = [
    ['no sid at all', { user: 'attacker', exp }],
    ['invented sid', { user: 'attacker', exp, sid: 'de'.repeat(16) }],
    ['sid null', { user: 'attacker', exp, sid: null }],
    ['sid numeric', { user: 'attacker', exp, sid: 123 }],
    ['sid object', { user: 'attacker', exp, sid: {} }],
    /* Inherited Object.prototype keys must not read as live sessions. */
    ['sid __proto__', { user: 'attacker', exp, sid: '__proto__' }],
    ['sid constructor', { user: 'attacker', exp, sid: 'constructor' }],
    ['sid toString', { user: 'attacker', exp, sid: 'toString' }],
  ];
  for (const [name, payload] of FORGED) {
    check((await probe(forge(payload))) === 401, `forged token rejected: ${name}`);
  }

  /* Sessions live in the database, so a deploy or crash must not log the
     admin out. */
  const survivor = await login();
  check((await probe(survivor)) === 200, 'token valid before restart');
  server.kill('SIGKILL');
  await new Promise((r) => setTimeout(r, 500));
  await start();
  check((await probe(survivor)) === 200, 'session survives a server restart');

  /* Expired ids are pruned on write, so the stored row cannot grow forever. */
  await post(survivor, '/api/auth/logout-all');
  const before = await login();
  check((await probe(before)) === 200, 'login works after logout-all');
} catch (e) {
  check(false, 'auth harness', String(e.message).slice(0, 120));
} finally {
  stop();
}

console.log(`${pass}/${pass + fail}`);
