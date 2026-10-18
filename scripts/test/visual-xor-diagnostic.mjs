import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants } from 'node:zlib';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXPECTED = path.join(ROOT, 'e2e/visual.spec.js-snapshots/shop-light-desktop-win32.png');
const RESULTS = path.join(ROOT, 'test-results');

function walk(dir, found = []) {
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file, found);
    else if (entry.name === 'shop-light-actual.png') found.push(file);
  }
  return found;
}

const candidates = walk(RESULTS).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
if (!candidates.length || !fs.existsSync(EXPECTED)) {
  console.log('No shop light screenshot pair available for compact diagnostics.');
  process.exit(0);
}

const actualImage = sharp(candidates[0]).ensureAlpha();
const expectedImage = sharp(EXPECTED).ensureAlpha();
const [{ data: actual, info }, { data: expected, info: expectedInfo }] = await Promise.all([
  actualImage.raw().toBuffer({ resolveWithObject: true }),
  expectedImage.raw().toBuffer({ resolveWithObject: true }),
]);
if (info.width !== expectedInfo.width || info.height !== expectedInfo.height || actual.length !== expected.length) {
  console.log(`Screenshot dimensions differ: actual ${info.width}x${info.height}; expected ${expectedInfo.width}x${expectedInfo.height}.`);
  process.exit(0);
}

const xor = Buffer.allocUnsafe(actual.length);
for (let index = 0; index < actual.length; index++) xor[index] = actual[index] ^ expected[index];
const compressed = brotliCompressSync(xor, {
  params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
});
const encoded = compressed.toString('base64');
const chunkSize = 48_000;
const chunks = Array.from({ length: Math.ceil(encoded.length / chunkSize) }, (_, index) =>
  encoded.slice(index * chunkSize, (index + 1) * chunkSize));
const hash = crypto.createHash('sha256').update(fs.readFileSync(EXPECTED)).digest('hex');
const meta = JSON.stringify({ width: info.width, height: info.height, channels: 4, chunks: chunks.length, expectedSha256: hash });
console.log(`::warning title=shop-light-xor-meta::${meta}`);
chunks.forEach((chunk, index) => {
  const number = String(index).padStart(3, '0');
  console.log(`::warning title=shop-light-xor-${number}::${chunk}`);
});
console.log(`Emitted ${chunks.length} compact screenshot XOR chunks (${compressed.length} bytes).`);
