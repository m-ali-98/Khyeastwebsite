/* ==========================================================================
   Visual regression.

     npm run test:e2e:update     accept the current rendering as the baseline

   Windows baselines live under e2e/visual.spec.js-snapshots/ and are committed
   with the code. Update them only after reviewing the generated pages; from
   then on any unintended layout or colour change fails with a pixel diff.

   Fonts and scroll reveals are the usual source of false diffs. The suite
   waits for webfonts and lazy images, puts every reveal in its final state,
   and freezes animation before taking a screenshot.
   ========================================================================== */
import { test, expect } from '@playwright/test';
import { gotoReady } from './helpers.js';

/* The project already runs with one worker. Do not put independent snapshots
   in a serial group: one intentional baseline change should report every
   affected page, not suppress the remaining visual coverage. */

async function settle(page) {
  await page.evaluate(() => document.fonts.ready);

  /* A screenshot records the finished page, not whether IntersectionObserver
     happened to run between two 900px scroll jumps. Force every shared reveal
     into its final state before freezing transitions. This also prevents a
     hidden heading from becoming an accepted baseline while its cards show. */
  await page.evaluate(() => {
    document.documentElement.classList.add('reveal-failsafe');
    document.querySelectorAll('.reveal').forEach((el) => el.classList.add('is-in'));
  });
  await page.addStyleTag({
    content: `*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important;
      transition-duration: 0s !important; transition-delay: 0s !important; caret-color: transparent !important; }`,
  });

  /* Walk the page to request native lazy images, then wait for every image to
     finish decoding. Network-idle happens before an off-screen lazy image is
     requested, so relying on it alone produces stable but incomplete shots. */
  await page.evaluate(async () => {
    const step = Math.max(300, Math.floor(window.innerHeight * 0.75));
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }

    await Promise.all(
      [...document.images].map(async (img) => {
        if (!img.complete) {
          await Promise.race([
            new Promise((resolve) => {
              img.addEventListener('load', resolve, { once: true });
              img.addEventListener('error', resolve, { once: true });
            }),
            new Promise((resolve) => setTimeout(resolve, 5000)),
          ]);
        }
        if (img.decode) await img.decode().catch(() => {});
      }),
    );

    window.scrollTo(0, 0);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

const PAGES = [
  ['home', '/'],
  ['about', '/about'],
  ['products', '/products'],
  ['product-detail', '/products/dezmaye-gold-80'],
  ['export', '/export'],
  ['quality', '/quality'],
  ['blog', '/blog'],
  ['contact', '/contact'],
  ['shop', '/shop'],
  ['shop-product', '/shop/dezmaye-gold-80'],
  ['en-home', '/en'],
  ['ar-home', '/ar'],
];

for (const [name, url] of PAGES) {
  for (const theme of ['light', 'dark']) {
    test(`${name} looks right (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('ky_theme', t), theme);
      await gotoReady(page, url);
      await settle(page);
      await expect(page).toHaveScreenshot(`${name}-${theme}.png`, { fullPage: true });
    });
  }
}

test('the navbar keeps its shape in both states', async ({ page }) => {
  await gotoReady(page, '/');
  await settle(page);
  await expect(page.locator('nav.nav')).toHaveScreenshot('nav-top.png');

  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(400);
  await expect(page.locator('nav.nav')).toHaveScreenshot('nav-scrolled.png');
});

test('the admin login card looks right', async ({ page }) => {
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.admin__login-card')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  await expect(page.locator('.admin__login-card')).toHaveScreenshot('admin-login.png');
});
