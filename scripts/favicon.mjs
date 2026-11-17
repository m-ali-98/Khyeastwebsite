/*
 * Build square, high-contrast favicons from the official company mark.
 * Run after replacing assets-src/brand/logo.png:
 *   node scripts/favicon.mjs
 */
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'assets-src', 'brand', 'logo.png');
const OUTPUT = path.join(ROOT, 'public', 'assets', 'brand');
const WHITE_MARK_SIZE = 0.76;

const variants = [
  { file: 'favicon-32.png', size: 32, radius: 6 },
  { file: 'favicon-64.png', size: 64, radius: 12 },
  { file: 'apple-touch-icon.png', size: 180, radius: 0 },
];

function backgroundSvg(size, radius) {
  const border = Math.max(0.6, size / 96);
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <defs>
        <linearGradient id="brand" x1="0" y1="0" x2="${size}" y2="${size}" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#e92044" />
          <stop offset="48%" stop-color="#c91134" />
          <stop offset="100%" stop-color="#5c0618" />
        </linearGradient>
        <radialGradient id="glow" cx="${size * 0.22}" cy="${size * 0.06}" r="${size * 0.9}" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#fff" stop-opacity=".16" />
          <stop offset="100%" stop-color="#fff" stop-opacity="0" />
        </radialGradient>
      </defs>
      <rect width="${size}" height="${size}" rx="${radius}" fill="url(#brand)" />
      <rect width="${size}" height="${size}" rx="${radius}" fill="url(#glow)" />
      ${radius ? `<rect x="${border}" y="${border}" width="${size - border * 2}" height="${size - border * 2}" rx="${radius - border}" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width="${border}" />` : ''}
    </svg>
  `);
}

const sourcePixels = await sharp(SOURCE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
for (let i = 0; i < sourcePixels.data.length; i += sourcePixels.info.channels) {
  sourcePixels.data[i] = 255;
  sourcePixels.data[i + 1] = 255;
  sourcePixels.data[i + 2] = 255;
}

for (const { file, size, radius } of variants) {
  const markSize = Math.round(size * WHITE_MARK_SIZE);
  const whiteMark = await sharp(sourcePixels.data, {
    raw: {
      width: sourcePixels.info.width,
      height: sourcePixels.info.height,
      channels: sourcePixels.info.channels,
    },
  })
    .resize({
      width: markSize,
      height: markSize,
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const result = await sharp(backgroundSvg(size, radius))
    .composite([{ input: whiteMark, left: Math.floor((size - markSize) / 2), top: Math.floor((size - markSize) / 2) }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUTPUT, file));

  console.log(`${file}: ${result.width}x${result.height}, ${(result.size / 1024).toFixed(1)} KB`);
}
