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
let keptImageUrl = '';
let keptVideoUrl = '';

try {
  await start();
  const token = await login();
  check(Boolean(token), 'logged in');

  /* ---- content saves enforce the same origins as document CSP ---------- */
  {
    const originalResponse = await fetch(`${BASE}/api/content`);
    const original = await originalResponse.json();
    const put = async (payload) => {
      const response = await fetch(`${BASE}/api/content`, {
        method: 'PUT',
        headers: { Cookie: token, 'Content-Type': 'application/json', Origin: BASE },
        body: JSON.stringify(payload),
      });
      return { status: response.status, body: await response.json().catch(() => ({})) };
    };
    const withImage = (image, seals = original.collections?.trustSeals || []) => {
      const payload = structuredClone(original);
      payload.collections = { ...payload.collections, trustSeals: seals };
      payload.products[0] = { ...payload.products[0], image, images: [image] };
      return payload;
    };

    const untrusted = await put(withImage('https://untrusted.example/product.webp'));
    check(
      untrusted.status === 400 && untrusted.body.code === 'untrusted_origin' && /products\[0\]/.test(untrusted.body.field || ''),
      'the server rejects a gallery origin outside img-src with a useful field',
      `${untrusted.status} ${JSON.stringify(untrusted.body)}`,
    );

    const putShopImage = async (image) => {
      const products = structuredClone(original.shop.products);
      products[0] = { ...products[0], image, images: [image] };
      const response = await fetch(`${BASE}/api/shop-admin/products`, {
        method: 'PUT',
        headers: { Cookie: token, 'Content-Type': 'application/json', Origin: BASE },
        body: JSON.stringify({ products }),
      });
      return { status: response.status, body: await response.json().catch(() => ({})) };
    };
    const untrustedDirectShop = await putShopImage('https://untrusted.example/shop.webp');
    check(
      untrustedDirectShop.status === 400 && untrustedDirectShop.body.code === 'untrusted_origin',
      'the direct shop-products endpoint cannot bypass the gallery origin policy',
      `${untrustedDirectShop.status} ${JSON.stringify(untrustedDirectShop.body)}`,
    );

    const malformedResults = [];
    for (const image of [
      'http://cdn.example/product.webp',
      'https://user:pass@cdn.example/product.webp',
      '/uploads\\images\\product.webp',
      '/uploads/images/product.webp\nignored',
    ]) {
      malformedResults.push(await put(withImage(image)));
    }
    check(
      malformedResults.every((result) => result.status === 400 && result.body.code === 'invalid_url'),
      'HTTP, credentials, backslashes and control characters get explicit 400 responses',
      JSON.stringify(malformedResults),
    );

    const trustedSeal = [{
      id: 'test-cdn',
      label: 'Test CDN',
      href: 'https://cdn.example/verify',
      image: 'https://cdn.example/seal.png',
      imageId: '',
      active: true,
    }];
    const trusted = await put(withImage('https://cdn.example/product.webp', trustedSeal));
    check(trusted.status === 200, 'an HTTPS gallery origin already trusted by CSP can be saved', `${trusted.status} ${JSON.stringify(trusted.body)}`);
    const trustedDirectShop = await putShopImage('https://cdn.example/shop.webp');
    check(trustedDirectShop.status === 200, 'the direct shop-products endpoint accepts the same configured HTTPS origin', `${trustedDirectShop.status} ${JSON.stringify(trustedDirectShop.body)}`);
    const cspResponse = await fetch(`${BASE}/products`);
    check((cspResponse.headers.get('content-security-policy') || '').includes('https://cdn.example'), 'the saved gallery allowlist and document CSP use the same trusted origin');

    const restored = await put(original);
    check(restored.status === 200, 'content is restored after gallery-policy checks', String(restored.status));
  }

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

    keptImageUrl = body.url;
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
    keptVideoUrl = body.url;
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

  /* ---- unused-file preview is conservative and authenticated ----------- */
  {
    const anonymousScan = await fetch(`${BASE}/api/uploads/unused`);
    check(anonymousScan.status === 401, 'an anonymous unused-file scan is refused', String(anonymousScan.status));
    const anonymousDelete = await fetch(`${BASE}/api/uploads/unused`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Origin: BASE },
      body: JSON.stringify({ urls: [keptVideoUrl] }),
    });
    check(anonymousDelete.status === 401, 'an anonymous cleanup is refused', String(anonymousDelete.status));

    const scan = async () => {
      const response = await fetch(`${BASE}/api/uploads/unused`, { headers: { Cookie: token } });
      return { status: response.status, body: await response.json().catch(() => ({})) };
    };
    const fresh = await scan();
    check(fresh.status === 200 && fresh.body.totalCount === 0, 'fresh unsaved uploads stay inside the cleanup grace period', JSON.stringify(fresh.body));

    const ageFamily = (url) => {
      const file = onDisk(url);
      const dir = path.dirname(file);
      const name = path.basename(file);
      const master = name.match(/^(.+)-w\d+\.webp$/);
      const names = master
        ? fs.readdirSync(dir).filter((candidate) => candidate === name || (candidate.startsWith(`${master[1]}-`) && candidate.endsWith('.webp')))
        : [name];
      const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
      for (const candidate of names) fs.utimesSync(path.join(dir, candidate), old, old);
    };
    ageFamily(keptImageUrl);
    ageFamily(keptVideoUrl);

    /* A product gallery reference keeps its photo (and any responsive set),
       while an old video with no reference becomes a candidate. */
    const contentFile = path.join(TMP, 'content.json');
    const content = JSON.parse(fs.readFileSync(contentFile, 'utf8'));
    content.products[0] = {
      ...content.products[0],
      image: keptImageUrl,
      images: [keptImageUrl],
    };
    fs.writeFileSync(contentFile, JSON.stringify(content, null, 2));

    const orphanUrl = '/uploads/images/cleanup-w1600.webp';
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    for (const [name, bytes] of [['cleanup-w1600.webp', 37], ['cleanup-480.webp', 11], ['cleanup-768.webp', 19]]) {
      const file = path.join(UPLOADS, 'images', name);
      fs.writeFileSync(file, Buffer.alloc(bytes, 3));
      fs.utimesSync(file, old, old);
    }

    const preview = await scan();
    const candidateUrls = preview.body.items?.map((item) => item.url) || [];
    check(preview.status === 200 && candidateUrls.includes(keptVideoUrl) && candidateUrls.includes(orphanUrl), 'old unreferenced image sets and videos appear in the preview', candidateUrls.join(' '));
    const orphan = preview.body.items?.find((item) => item.url === orphanUrl);
    check(orphan?.fileCount === 3 && orphan?.bytes === 67, 'the preview totals an optimized image family', JSON.stringify(orphan));

    const stillUsed = await fetch(`${BASE}/api/upload`, {
      method: 'DELETE',
      headers: { Cookie: token, 'Content-Type': 'application/json', Origin: BASE },
      body: JSON.stringify({ url: keptImageUrl }),
    });
    check(stillUsed.status === 409 && fs.existsSync(onDisk(keptImageUrl)), 'the legacy delete endpoint cannot remove referenced media', String(stillUsed.status));

    /* Simulate content becoming referenced after the preview. The cleanup
       endpoint has to rescan at confirmation time and skip it. */
    content.posts[0] = {
      ...content.posts[0],
      body: `${content.posts[0]?.body || ''}<img src="${orphanUrl}">`,
    };
    fs.writeFileSync(contentFile, JSON.stringify(content, null, 2));
    const raced = await fetch(`${BASE}/api/uploads/unused`, {
      method: 'DELETE',
      headers: { Cookie: token, 'Content-Type': 'application/json', Origin: BASE },
      body: JSON.stringify({ urls: [orphanUrl] }),
    });
    const racedBody = await raced.json().catch(() => ({}));
    check(raced.status === 200 && racedBody.removed?.length === 0 && racedBody.skipped?.includes(orphanUrl), 'cleanup rescans and preserves a newly referenced file', JSON.stringify(racedBody));
    check(fs.existsSync(path.join(UPLOADS, 'images', 'cleanup-480.webp')), 'a skipped optimized set remains complete');

    content.posts[0].body = String(content.posts[0].body).replace(`<img src="${orphanUrl}">`, '');
    fs.writeFileSync(contentFile, JSON.stringify(content, null, 2));
    const cleanup = await fetch(`${BASE}/api/uploads/unused`, {
      method: 'DELETE',
      headers: { Cookie: token, 'Content-Type': 'application/json', Origin: BASE },
      body: JSON.stringify({ urls: [orphanUrl, keptVideoUrl] }),
    });
    const cleanupBody = await cleanup.json().catch(() => ({}));
    check(cleanup.status === 200 && cleanupBody.removed?.length === 2 && cleanupBody.bytes > 67, 'confirmed cleanup removes only the selected current orphans', JSON.stringify(cleanupBody));
    check(!fs.existsSync(onDisk(keptVideoUrl)), 'the selected unused video is gone');
    check(!fs.readdirSync(path.join(UPLOADS, 'images')).some((name) => name.startsWith('cleanup-')), 'every selected optimized variant is gone');
  }

  /* ---- nothing stray was left behind ----------------------------------- */
  {
    const imgs = fs.existsSync(path.join(UPLOADS, 'images')) ? fs.readdirSync(path.join(UPLOADS, 'images')) : [];
    check(imgs.length === 1, 'only the referenced image we kept is on disk', imgs.join(' '));
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
