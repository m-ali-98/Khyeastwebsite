/* ==========================================================================
   Visual regression.

     npm run test:e2e:update     accept the current rendering as the baseline

   The first run WILL fail: there are no baselines in the repository yet, so
   Playwright writes them and reports "a snapshot doesn't exist". Review the
   written PNGs under e2e/__screenshots__/ — they are what the site looks
   like today — and commit them. From then on any unintended layout or colour
   change fails the build with a pixel diff.

   Baselines are rendered by the same browser build on every machine, but
   fonts are the usual source of false diffs, so the suite waits for the
   webfonts to finish loading and freezes every animation first.
   ========================================================================== */
import { test, expect } from '@playwright/test';
import { gotoReady } from './helpers.js';

test.describe.configure({ mode: 'serial' });

async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  /* Reveal animations trigger on scroll; walk the page so nothing is frozen
     mid-fade, then return to the top. */
  await page.evaluate(async () => {
    const step = window.innerHeight;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 250));
  });
  /* Kill the caret and anything still interpolating. */
  await page.addStyleTag({
    content: `*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important;
      transition-duration: 0s !important; transition-delay: 0s !important; caret-color: transparent !important; }`,
  });
  await page.waitForTimeout(200);
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
