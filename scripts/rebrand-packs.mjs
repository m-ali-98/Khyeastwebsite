/* Rebrand AI packshots v2: cover invented label text with Khuzestan Yeast label designs. */
import sharp from 'sharp';
import fs from 'node:fs';

const W = 1408;
const H = 768;
const PX = (fx, fy, fw = 0, fh = 0) => [Math.round(fx * W), Math.round(fy * H), Math.round(fw * W), Math.round(fh * H)];

const wheat = (cx, cy, s, fill) => `
<g transform="translate(${cx},${cy}) scale(${s})" fill="${fill}">
  <path d="M0 28V-20" stroke="${fill}" stroke-width="3" stroke-linecap="round" fill="none"/>
  <path d="M0 -14c-5.4-.9-8.2-4.5-8.2-9.2 4.6 0 8.2 3.7 8.2 9.2z"/>
  <path d="M0 -14c5.4-.9 8.2-4.5 8.2-9.2-4.6 0-8.2 3.7-8.2 9.2z"/>
  <path d="M0 -5.5c-5.4-.9-8.2-4.5-8.2-9.2 4.6 0 8.2 3.7 8.2 9.2z"/>
  <path d="M0 -5.5c5.4-.9 8.2-4.5 8.2-9.2-4.6 0-8.2 3.7-8.2 9.2z"/>
  <path d="M0 3c-5.4-.9-8.2-4.5-8.2-9.2 4.6 0 8.2 3.7 8.2 9.2z"/>
  <path d="M0 3c5.4-.9 8.2-4.5 8.2-9.2-4.6 0-8.2 3.7-8.2 9.2z"/>
  <path d="M0 -21.5c0-3.4 1.2-5.6 0-8.5-1.2 2.9 0 5.1 0 8.5z"/>
</g>`;

const rect = (fx, fy, fw, fh, fill, rx = 0, op = 1) => {
  const [x, y, w, h] = PX(fx, fy, fw, fh);
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" opacity="${op}"/>`;
};

let uid = 0;
const label = (fx, fy, fw, fh, pal, opts = {}) => {
  const [x, y, w, h] = PX(fx, fy, fw, fh);
  const cx = x + w / 2;
  const id = `clip${uid++}`;
  return `
  <clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${opts.rx ?? 10}"/></clipPath>
  <g clip-path="url(#${id})">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${opts.rx ?? 10}" fill="${pal.base}"/>
    ${opts.swoosh ? `<path d="M${x + w * 0.04} ${y + h * 0.66} C ${x + w * 0.35} ${y + h * 0.5}, ${x + w * 0.55} ${y + h * 0.82}, ${x + w * 0.96} ${y + h * 0.6}" fill="none" stroke="${pal.accent}" stroke-width="${Math.max(6, w * 0.045)}" stroke-linecap="round"/>` : ''}
    <rect x="${x + 5}" y="${y + 5}" width="${w - 10}" height="${h - 10}" rx="${Math.max(2, (opts.rx ?? 10) - 4)}" fill="none" stroke="${pal.accent}" stroke-width="2" opacity="0.85"/>
    <rect x="${x + w * 0.14}" y="${y + h - 16}" width="${w * 0.72}" height="5" rx="2.5" fill="${pal.accent}"/>
    <rect x="${x + w * 0.22}" y="${y + 11}" width="${w * 0.56}" height="5" rx="2.5" fill="${pal.accent}"/>
    ${wheat(cx, y + h * 0.46, h / 150, pal.emblem)}
  </g>`;
};

async function avg(file, fx, fy, size = 10) {
  const [x, y] = PX(fx, fy);
  const stats = await sharp(file)
    .extract({ left: x - size / 2, top: y - size / 2, width: size, height: size })
    .stats();
  return '#' + stats.channels.slice(0, 3).map((s) => Math.round(s.mean).toString(16).padStart(2, '0')).join('');
}

async function run(src, file, build, blurFrom) {
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${await build(src)}</svg>`;
  const base = await sharp(src).composite([{ input: Buffer.from(svg), blend: 'over' }]).toBuffer();
  const [bx, by, , bh] = PX(0, blurFrom, 1, 1 - blurFrom);
  const band = await sharp(base).extract({ left: 0, top: by, width: W, height: bh }).blur(9).toBuffer();
  await sharp(base)
    .composite([{ input: band, left: 0, top: by }])
    .png()
    .toFile(file);
  console.log('rebranded', file);
}

const GOLD = '#d9a441';
const JOBS = {
  'dezmaye-gold': {
    blurFrom: 0.885,
    build: async (f) => {
      const pal = { base: '#a5122e', accent: GOLD, emblem: '#e9c476' };
      return (
        rect(0.7235, 0.278, 0.02, 0.522, '#7d0d20') +
        wheat(0.7335 * W, 0.42 * H, 0.85, GOLD) +
        rect(0.54, 0.213, 0.164, 0.047, '#a5122e') +
        label(0.296, 0.262, 0.196, 0.553, pal) +
        label(0.532, 0.26, 0.182, 0.556, pal)
      );
    },
  },
  shetab: {
    blurFrom: 0.895,
    build: async (f) => {
      const pal = { base: '#ffffff', accent: '#c4122f', emblem: '#c4122f' };
      return (
        rect(0.277, 0.33, 0.043, 0.40, '#8f0f26') +
        wheat(0.2985 * W, 0.44 * H, 0.8, '#ffffff') +
        label(0.322, 0.335, 0.172, 0.42, pal, { swoosh: true }) +
        label(0.505, 0.235, 0.212, 0.575, pal, { swoosh: true })
      );
    },
  },
  xpower: {
    blurFrom: 0.872,
    build: async (f) => {
      const pal = { base: '#2e3338', accent: '#dc143c', emblem: '#ffffff' };
      return (
        rect(0.877, 0.515, 0.03, 0.33, '#7a0c20') +
        wheat(0.892 * W, 0.62 * H, 0.8, '#ffffff') +
        rect(0.62, 0.478, 0.252, 0.036, '#7a0c20') +
        label(0.398, 0.185, 0.194, 0.62, pal, { swoosh: true }) +
        label(0.616, 0.515, 0.262, 0.315, pal, { swoosh: true, rx: 8 })
      );
    },
  },
  nanmaye: {
    blurFrom: 0.93,
    build: async (f) => {
      const cartonSide = await avg(f, 0.31, 0.62);
      const pal = { base: '#f5f3f0', accent: '#c4122f', emblem: '#c4122f' };
      return (
        rect(0.384, 0.43, 0.013, 0.29, '#f0eeeb', 2) +
        rect(0.621, 0.43, 0.013, 0.29, '#f0eeeb', 2) +
        label(0.396, 0.265, 0.224, 0.575, pal, { rx: 6 }) +
        rect(0.197, 0.54, 0.083, 0.21, '#ffffff', 4) +
        wheat(0.2385 * W, 0.615 * H, 1.5, '#c4122f') +
        rect(0.345, 0.54, 0.038, 0.14, cartonSide, 3)
      );
    },
  },
};

for (const [name, job] of Object.entries(JOBS)) {
  const file = `public/assets/products/${name}.png`;
  await run(`/tmp/packs-orig/${name}.png`, file, job.build, job.blurFrom);
}
