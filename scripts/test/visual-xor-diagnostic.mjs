import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants } from 'node:zlib';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXPECTED = path.join(ROOT, 'e2e/visual.spec.js-snapshots/shop-light-desktop-win32.png');
const RESULTS = path.join(ROOT, 'test-results');
const CACHE = path.join(RESULTS, 'shop-light-xor-diagnostic.json');
const start = Math.max(0, Number(process.env.XOR_CHUNK_START) || 0);

function walk(dir, found = []) {
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file, found);
    else if (entry.name === 'shop-light-actual.png') found.push(file);
  }
  return found;
}

async function prepare() {
  const candidates = walk(RESULTS).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!candidates.length || !fs.existsSync(EXPECTED)) return null;

  const [{ data: actual, info }, { data: expected, info: expectedInfo }] = await Promise.all([
    sharp(candidates[0]).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(EXPECTED).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (info.width !== expectedInfo.width || info.height !== expectedInfo.height || actual.length !== expected.length) {
    console.log(`Screenshot dimensions differ: actual ${info.width}x${info.height}; expected ${expectedInfo.width}x${expectedInfo.height}.`);
    return null;
  }

  /* OS text rasterisation produces tiny channel-level differences all over a
     screenshot. Dark mode already proves those are below the comparator's
     tolerance; transferring them would drown the material layout delta.
     Increase the visible-channel threshold only as far as needed to fit the
     check-annotation budget, retaining the strongest differences first. */
  let channelThreshold = 24;
  let selectedPixels = 0;
  let encoded = '';
  const thresholds = [24, 40, 56, 72, 88, 104, 120, 140];
  for (const threshold of thresholds) {
    const xor = Buffer.alloc(actual.length);
    let selected = 0;
    for (let index = 0; index < actual.length; index += 4) {
      const visible = Math.max(
        Math.abs(actual[index] - expected[index]),
        Math.abs(actual[index + 1] - expected[index + 1]),
        Math.abs(actual[index + 2] - expected[index + 2]),
      ) >= threshold;
      if (!visible) continue;
      selected++;
      for (let channel = 0; channel < 4; channel++) xor[index + channel] = actual[index + channel] ^ expected[index + channel];
    }
    const compressed = brotliCompressSync(xor, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    });
    channelThreshold = threshold;
    selectedPixels = selected;
    encoded = compressed.toString('base64');
    if (encoded.length <= 152_000) break;
  }
  const chunkSize = 4_000;
  const chunks = Array.from({ length: Math.ceil(encoded.length / chunkSize) }, (_, index) =>
    encoded.slice(index * chunkSize, (index + 1) * chunkSize));
  const expectedSha256 = crypto.createHash('sha256').update(fs.readFileSync(EXPECTED)).digest('hex');
  const payload = {
    width: info.width,
    height: info.height,
    channels: 4,
    expectedSha256,
    channelThreshold,
    selectedPixels,
    chunks,
  };
  fs.writeFileSync(CACHE, JSON.stringify(payload));
  return payload;
}

const payload = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : await prepare();
if (!payload) {
  console.log('No shop light screenshot pair available for compact diagnostics.');
  process.exit(0);
}

/* A step retains at most ten annotations. The first range reserves one for
   reconstruction metadata; later ranges can carry ten data chunks each. */
const limit = start === 0 ? 9 : 10;
if (start === 0) {
  const { chunks, ...meta } = payload;
  console.log(`::warning title=shop-light-xor-meta::${JSON.stringify({ ...meta, chunks: chunks.length })}`);
}
payload.chunks.slice(start, start + limit).forEach((chunk, offset) => {
  const number = String(start + offset).padStart(3, '0');
  console.log(`::warning title=shop-light-xor-${number}::${chunk}`);
});
console.log(`Emitted chunks ${start}–${Math.min(start + limit, payload.chunks.length) - 1} of ${payload.chunks.length}.`);
