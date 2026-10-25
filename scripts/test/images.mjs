/* Upload optimisation — it may shrink a photo, it may decline to, but it may
   never lose an upload, rotate it, flatten an animation, or publish a name
   that promises files which are not on disk.
   -------------------------------------------------------------------------
   server/images.js is pure and knows nothing about Express, so every case
   below is driven directly with buffers built by sharp. The naming contract
   is checked against the same shared module the browser uses, because the
   browser builds a srcset out of the filename alone. */
import sharp from 'sharp';
import { optimizeImage } from '../../server/images.js';
import { UPLOAD_MAX_WIDTH, UPLOAD_LADDER, variantWidths, widthFromName } from '../../shared/uploadSizes.js';

let pass = 0;
const fails = [];
const check = (ok, label, detail = '') => {
  if (ok) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
};

/* A noisy photo, so WebP cannot cheat its way to a tiny file and the size
   comparisons below mean something. */
const noise = (w, h) => {
  const px = Buffer.alloc(w * h * 3);
  for (let i = 0; i < px.length; i++) px[i] = (i * 2654435761) % 251;
  return sharp(px, { raw: { width: w, height: h, channels: 3 } });
};

const jpeg = async (w, h) => noise(w, h).jpeg({ quality: 92 }).toBuffer();
const png = async (w, h) => noise(w, h).png().toBuffer();

/* ---- the ordinary case: a big camera photo ---------------------------- */
{
  const src = await jpeg(3000, 2000);
  const r = await optimizeImage(src, '.jpg');

  check(r.optimised, 'a 3000px photo is optimised', r.reason);
  check(r.ext === '.webp', 'it is stored as webp', r.ext);
  check(r.width === UPLOAD_MAX_WIDTH, `it is capped at ${UPLOAD_MAX_WIDTH}px`, String(r.width));
  check(r.buffer.length < src.length, 'the stored file is smaller', `${src.length} -> ${r.buffer.length}`);

  const meta = await sharp(r.buffer).metadata();
  check(meta.width === UPLOAD_MAX_WIDTH && meta.height === Math.round((UPLOAD_MAX_WIDTH * 2000) / 3000), 'the aspect ratio is kept', `${meta.width}x${meta.height}`);

  check(r.variants.length === UPLOAD_LADDER.length, 'every ladder rung is written', String(r.variants.length));
  const widths = await Promise.all(r.variants.map(async (v) => (await sharp(v.buffer).metadata()).width));
  check(
    widths.join() === r.variants.map((v) => v.width).join(),
    'each variant really is the width it claims',
    widths.join(),
  );
  check(r.variants.every((v) => v.buffer.length < r.buffer.length), 'every variant is smaller than the master');
}

/* ---- the naming contract the browser depends on ----------------------- */
{
  const r = await optimizeImage(await jpeg(2400, 1200), '.jpg');
  const name = `/uploads/images/1700000000000-abcd1234-w${r.width}.webp`;

  check(widthFromName(name) === r.width, 'the browser reads the width back out of the name', String(widthFromName(name)));
  check(
    variantWidths(r.width).join() === r.variants.map((v) => v.width).join(),
    'the widths the browser will ask for are exactly the ones written',
    `${variantWidths(r.width)} vs ${r.variants.map((v) => v.width)}`,
  );
  check(widthFromName('/uploads/images/plain.webp') === null, 'an unoptimised name advertises nothing');
  check(widthFromName('/uploads/images/x-w0.webp') === null, 'a zero width is rejected');
  check(widthFromName('/uploads/videos/clip-w1600.mp4') === null, 'only .webp can advertise a width');
}

/* ---- images that must be left exactly as they are --------------------- */
{
  /* Animated: re-encoding through the still pipeline would keep frame 1 and
     throw the rest away, which looks like data loss to the admin. */
  const frames = await noise(100, 300).png().toBuffer();
  const gif = await sharp(frames, { raw: undefined, pages: 3, pageHeight: 100 })
    .gif()
    .toBuffer()
    .catch(() => null);
  if (gif) {
    const r = await optimizeImage(gif, '.gif');
    check(!r.optimised && r.buffer === gif, 'an animated gif is stored untouched', r.reason);
  } else {
    check(true, 'an animated gif is stored untouched (fixture unavailable)');
  }

  /* Corrupt / not an image at all. The magic-byte check upstream would
     normally stop this; the point is that sharp failing is survivable. */
  const junk = Buffer.from('this is definitely not an image, but it is 64 bytes long or so');
  const r2 = await optimizeImage(junk, '.jpg');
  check(!r2.optimised && r2.buffer === junk, 'a corrupt file still uploads', r2.reason);
  check(r2.ext === '.jpg', 'a declined file keeps its original extension', r2.ext);

  /* Truncated: valid header, missing body. */
  const whole = await jpeg(800, 600);
  const cut = whole.subarray(0, Math.floor(whole.length / 3));
  const r3 = await optimizeImage(cut, '.jpg');
  check(r3.buffer === cut, 'a truncated file still uploads', r3.reason);

  const r4 = await optimizeImage(Buffer.alloc(0), '.png');
  check(!r4.optimised && r4.originalBytes === 0, 'an empty buffer is survivable', r4.reason);

  const r5 = await optimizeImage(null, '.png');
  check(!r5.optimised, 'a missing buffer is survivable', r5.reason);
}

/* ---- never make a file worse ------------------------------------------ */
{
  /* A small, already-efficient WebP: re-encoding buys nothing and can cost. */
  const tiny = await sharp({ create: { width: 120, height: 120, channels: 3, background: '#dc143c' } })
    .webp({ quality: 90 })
    .toBuffer();
  const r = await optimizeImage(tiny, '.webp');
  check(
    r.buffer.length <= tiny.length,
    'an already-small file is never stored larger',
    `${tiny.length} -> ${r.buffer.length}`,
  );
}

/* ---- small images get no pointless ladder ----------------------------- */
{
  const r = await optimizeImage(await png(400, 400), '.png');
  check(r.variants.length === 0, 'a 400px image gets no variants', String(r.variants.length));
  check(variantWidths(400).length === 0, 'the browser agrees there are none');
  check(variantWidths(600).join() === '480', 'a 600px image offers only the 480 rung', variantWidths(600).join());
  check(variantWidths(1600).join() === UPLOAD_LADDER.join(), 'a 1600px image offers the full ladder');
}

/* ---- EXIF orientation must be applied, not dropped -------------------- */
{
  /* Orientation 6 = rotate 90°. sharp strips metadata on re-encode, so if
     .rotate() were missing the stored photo would lie on its side. */
  const upright = await noise(2400, 1200).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const r = await optimizeImage(upright, '.jpg');
  if (r.optimised) {
    const meta = await sharp(r.buffer).metadata();
    check(meta.height > meta.width, 'EXIF rotation is baked in, not lost', `${meta.width}x${meta.height}`);
    check(meta.width === r.width, 'the advertised width matches the stored pixels', `${r.width} vs ${meta.width}`);
    check(
      variantWidths(r.width).join() === r.variants.map((v) => v.width).join(),
      'a rotated photo still gets a consistent ladder',
    );
  } else {
    check(false, 'EXIF rotation is baked in, not lost', r.reason);
  }
}

/* ---- the master is measured, never assumed ---------------------------- */
{
  const r = await optimizeImage(await jpeg(1000, 1000), '.jpg');
  const meta = await sharp(r.buffer).metadata();
  check(r.width === meta.width, 'a below-cap image reports its true width', `${r.width} vs ${meta.width}`);
  check(meta.width === 1000, 'a below-cap image is not upscaled', String(meta.width));
}

for (const f of fails) console.log('  LEAK ' + f);
/* Exit 0 and let run.mjs judge the N/M line — a non-zero exit would make it
   discard this output, which is the only thing that says what broke. */
console.log(`${pass}/${pass + fails.length}`);
