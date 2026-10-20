/* ==========================================================================
   /api/upload end to end, against a real running server.

   server/images.js is covered as a pure function in images.mjs. What that
   cannot prove is the part most likely to hurt someone: that the files the
   browser will ask for actually reach the disk, that the published name only
   ever appears once they have, that a video is still stored byte for byte,
   and that deleting an image takes its smaller copies with it instead of
   orphaning them forever.

   Run directly:  node scripts/test/upload.mjs
   ========================================================================== */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import sharp from 'sharp';
import { UPLOAD_LADDER, UPLOAD_MAX_WIDTH, widthFromName, variantWidths } from '../../shared/uploadSizes.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

const PORT = 8975;
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ky-upload-'));
const DB = path.join(TMP, 'test.db');
const UPLOADS = path.join(TMP, 'uploads');
const PASS = 'khyeast-1404';

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
/* Keep the server's own output. When the harness fails, "command failed" is
   useless — the reason is almost always in here. */
let serverLog = '';

const start = async () => {
  server = spawn('node', ['server/index.js'], {
    cwd: ROOT,
    /* DATA_DIR too, not just DB_FILE: without it the server falls back to the
       real server/data and this suite would be reading the content.json you
       actually ship. */
    env: { ...process.env, PORT: String(PORT), DATA_DIR: TMP, DB_FILE: DB, UPLOAD_DIR: UPLOADS, NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => { serverLog += d; });
  server.stderr.on('data', (d) => { serverLog += d; });
  server.on('error', (e) => { serverLog += `spawn: ${e.message}\n`; });

  /* 20s, not 10: a cold start on Windows loads a native SQLite binding and
     may be waiting on a virus scanner the first time. */
  for (let i = 0; i < 200; i += 1) {
    if (server.exitCode !== null) throw new Error(`server exited early (${server.exitCode}): ${serverLog.trim().slice(-300)}`);
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not start: ${serverLog.trim().slice(-300) || 'no output'}`);
};

const stop = async () => {
  if (server) server.kill('SIGKILL');
  /* Windows keeps the SQLite file locked until the last handle closes, which
     lags process exit. Retry rather than reporting a cleanup race as a test
     failure — and never let cleanup decide the result. */
  for (let i = 0; i < 6; i += 1) {
    try {
      fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
};

const login = async () => {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: 'admin', pass: PASS }),
  });
  await r.json();
  return (r.headers.get('set-cookie') || '').split(';')[0];
};

const send = async (cookie, buf, filename, type) => {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type }), filename);
  const r = await fetch(`${BASE}/api/upload`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: BASE },
    body: fd,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

/* A noisy photo, so the size comparisons are not won by a flat colour. */
const photo = (w, h, fmt = 'jpeg') => {
  const px = Buffer.alloc(w * h * 3);
  for (let i = 0; i < px.length; i++) px[i] = (i * 2654435761) % 251;
  return sharp(px, { raw: { width: w, height: h, channels: 3 } })[fmt]({ quality: 92 }).toBuffer();
};

const onDisk = (url) => path.join(UPLOADS, url.replace(/^\/uploads\//, ''));

try {
  await start();
  const token = await login();
  check(Boolean(token), 'logged in');

  /* ---- a large photo is shrunk, and the whole ladder is on disk -------- */
  {
    const src = await photo(3000, 2000);
    const { status, body } = await send(token, src, 'camera.jpg', 'image/jpeg');

    check(status === 200, 'a large photo uploads', String(status));
    check(body.optimised === true, 'the response says it was optimised', JSON.stringify(body));
    check(/\/uploads\/images\/[\w.-]+-w\d+\.webp$/.test(body.url || ''), 'the url carries the advertised width', body.url);
    check(body.bytes < body.originalBytes / 2, 'it is at least halved', `${body.originalBytes} -> ${body.bytes}`);

    const master = onDisk(body.url);
    check(fs.existsSync(master), 'the master is on disk', master);
    check(fs.statSync(master).size === body.bytes, 'the master is the size the response claimed');

    const full = widthFromName(body.url);
    check(full === UPLOAD_MAX_WIDTH, 'it was capped at the maximum width', String(full));

    /* This is the whole contract: every width the browser will put in its
       srcset has to exist, or it renders a broken image. */
    const stem = master.replace(/-w\d+\.webp$/, '');
    const missing = variantWidths(full).filter((w) => !fs.existsSync(`${stem}-${w}.webp`));
    check(missing.length === 0, 'every width the browser will request exists', missing.join(' '));

    /* Read the bytes and measure those, rather than handing sharp a path.
       libvips keeps the file open while it works, and Windows refuses to
       unlink an open file — measuring by path here made the delete below
       fail with EPERM, which looked like a server bug and was this test
       holding the files hostage. */
    const widths = [];
    for (const w of variantWidths(full)) widths.push((await sharp(fs.readFileSync(`${stem}-${w}.webp`)).metadata()).width);
    check(widths.join() === variantWidths(full).join(), 'each variant is the width it claims', widths.join());

    /* ---- and deleting the image takes the set with it ------------------ */
    const del = await fetch(`${BASE}/api/upload`, {
      method: 'DELETE',
      headers: { Cookie: token, 'Content-Type': 'application/json', Origin: BASE },
      body: JSON.stringify({ url: body.url }),
    });
    const delBody = await del.json().catch(() => ({}));
    check(del.status === 200, 'the image deletes', `${del.status} ${JSON.stringify(delBody)}`);
    check((delBody.stuck || []).length === 0, 'nothing was left locked', (delBody.stuck || []).join(' '));
    check(!fs.existsSync(master), 'the master is gone');
    const orphans = UPLOAD_LADDER.filter((w) => fs.existsSync(`${stem}-${w}.webp`));
    check(orphans.length === 0, 'no smaller copy is orphaned', orphans.join(' '));
  }

  /* ---- a small image is accepted without a pointless ladder ------------ */
  {
    const src = await photo(300, 300, 'png');
    const { status, body } = await send(token, src, 'small.png', 'image/png');
    check(status === 200, 'a small image uploads', String(status));

    const file = onDisk(body.url);
    check(fs.existsSync(file), 'it is on disk', body.url);
    const full = widthFromName(body.url);
    if (full) {
      const stem = file.replace(/-w\d+\.webp$/, '');
      const missing = variantWidths(full).filter((w) => !fs.existsSync(`${stem}-${w}.webp`));
      check(missing.length === 0, 'a small image promises nothing it lacks', missing.join(' '));
    } else {
      check(true, 'a small image promises nothing it lacks');
    }
  }

  /* ---- a video is still stored byte for byte --------------------------- */
  {
    /* Smallest thing that passes the magic-byte check for .mp4. */
    const mp4 = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from('ftypisom', 'latin1'),
      Buffer.alloc(64, 7),
    ]);
    const { status, body } = await send(token, mp4, 'clip.mp4', 'video/mp4');
    check(status === 200, 'a video uploads', String(status));
    check(body.url?.endsWith('.mp4'), 'a video keeps its container', body.url);
    check(body.optimised === false, 'a video is not run through the image pipeline');
    const stored = fs.readFileSync(onDisk(body.url));
    check(stored.equals(mp4), 'a video is stored byte for byte');
  }

  /* ---- the security checks still come first ---------------------------- */
  {
    const html = Buffer.from('<svg onload="alert(1)"></svg>');
    const { status } = await send(token, html, 'evil.png', 'image/png');
    check(status === 415, 'content that lies about its extension is still refused', String(status));

    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const r2 = await send(token, svg, 'logo.svg', 'image/svg+xml');
    check(r2.status === 415, 'svg is still refused outright', String(r2.status));

    const anon = await fetch(`${BASE}/api/upload`, { method: 'POST', body: new FormData() });
    check(anon.status === 401, 'an anonymous upload is still refused', String(anon.status));
  }

  /* ---- nothing stray was left behind ----------------------------------- */
  {
    const imgs = fs.existsSync(path.join(UPLOADS, 'images')) ? fs.readdirSync(path.join(UPLOADS, 'images')) : [];
    check(imgs.length === 1, 'only the files we kept are on disk', imgs.join(' '));
  }
} catch (e) {
  check(false, 'harness', String(e?.message || e));
} finally {
  await stop();
}

/* Exit 0 even on failure, like every other suite here: run.mjs reads the
   N/M line and the LEAK lines from stdout. A non-zero exit makes execFile
   reject, and the reason — the thing we actually need — is thrown away. */
console.log(`${pass}/${pass + fail}`);
