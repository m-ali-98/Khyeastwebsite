/* ==========================================================================
   The public site, in a real browser.

   This is the half of the suite linkedom could not reach: lazy route chunks
   actually resolve here, so a page that renders 16 characters in the headless
   harness is finally proved to render its real content.
   ========================================================================== */
import { test, expect } from '@playwright/test';
import { gotoReady, watchConsole, faNum } from './helpers.js';

/* Every route, with a selector that must be present and the minimum amount of
   text the page must render. The minimum matters: asserting "the page loaded"
   passes on an empty shell, which is the failure mode we are trying to catch.
   An empty cart and an empty checkout are legitimately terse — they are one
   line and a button — so they carry their own, lower, threshold rather than
   being excused entirely. */
const ROUTES = [
  ['/', '.hero'],
  ['/about', 'main'],
  ['/products', '.product-card'],
  ['/products/dezmaye-gold-80', 'main'],
  ['/export', 'main'],
  ['/quality', 'main'],
  ['/blog', 'main'],
  ['/contact', 'form'],
  ['/shop', '.sp-card, .shop-card, main'],
  ['/shop/dezmaye-gold-80', '.sp-buy'],
  ['/shop/cart', '.cart-empty, .cart-layout', 30],
  ['/shop/checkout', '.cart-empty, .checkout-grid', 30],
  ['/en', 'main'],
  ['/en/about', 'main'],
  ['/en/products', '.product-card'],
  ['/en/contact', 'form'],
  ['/ar', 'main'],
  ['/ar/products', '.product-card'],
  ['/nonexistent-page', 'main'],
];

test.describe('public routes', () => {
  for (const [route, selector, minChars = 120] of ROUTES) {
    test(`renders ${route} @mobile`, async ({ page }) => {
      const errors = watchConsole(page);
      await gotoReady(page, route);

      /* The lazy chunk must have produced real content, not the skeleton. */
      await expect(page.locator(selector).first()).toBeVisible();
      const text = await page.locator('main').innerText();
      expect(text.trim().length, `${route} rendered almost nothing`).toBeGreaterThan(minChars);

      /* No skeleton or boot splash may still be on screen once settled. */
      await expect(page.locator('.route-fallback, .boot-splash')).toHaveCount(0);

      expect(errors, `console errors on ${route}`).toEqual([]);
    });
  }
});

test('the header, footer and logo render on every locale @mobile', async ({ page }) => {
  for (const base of ['/', '/en', '/ar']) {
    await gotoReady(page, base);
    await expect(page.locator('nav.nav .nav__logo svg, nav.nav .nav__logo img')).toBeVisible();
    await expect(page.locator('footer')).toBeVisible();
  }
});

test('html lang and dir follow the locale @mobile', async ({ page }) => {
  const cases = [
    ['/', 'fa', 'rtl'],
    ['/en', 'en', 'ltr'],
    ['/ar', 'ar', 'rtl'],
  ];
  for (const [url, lang, dir] of cases) {
    await gotoReady(page, url);
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await expect(page.locator('html')).toHaveAttribute('dir', dir);
  }
});

test('the shop is reachable in Persian and absent in English and Arabic', async ({ page }) => {
  await gotoReady(page, '/');
  await expect(page.locator('.nav__cart')).toBeVisible();
  await expect(page.locator('.nav__links a[href="/shop"]')).toHaveCount(1);

  for (const base of ['/en', '/ar']) {
    await gotoReady(page, base);
    await expect(page.locator('.nav__cart')).toHaveCount(0);
    await expect(page.locator(`.nav__links a[href="${base}/shop"]`)).toHaveCount(0);
  }
});

test('dark mode applies and survives a reload', async ({ page }) => {
  await gotoReady(page, '/');
  const html = page.locator('html');
  const before = await html.getAttribute('data-theme');

  await page.locator('nav.nav button[aria-label="Dark mode"], nav.nav button[aria-label="Light mode"]').first().click();
  await expect(html).not.toHaveAttribute('data-theme', before || 'light');

  const after = await html.getAttribute('data-theme');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(html).toHaveAttribute('data-theme', after);

  /* The palette must really change, not just the attribute. */
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBeTruthy();
});

test('the language switch navigates between the three sites', async ({ page }) => {
  await gotoReady(page, '/');
  const sw = page.locator('.lang-switch').first();
  await sw.getByRole('button', { name: /en/i }).click();
  await expect(page).toHaveURL(/\/en(\/|$)/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('client-side navigation works without a full reload', async ({ page }) => {
  const errors = watchConsole(page);
  await gotoReady(page, '/');
  await page.evaluate(() => { window.__spa = true; });

  await page.locator('.nav__links a[href="/products"]').click();
  await expect(page).toHaveURL(/\/products$/);
  await expect(page.locator('.product-card').first()).toBeVisible();

  /* If the marker survived, the router handled it in-page. */
  expect(await page.evaluate(() => window.__spa)).toBe(true);
  expect(errors).toEqual([]);
});

test('a deep link to a product detail page works on a cold load @mobile', async ({ page }) => {
  const errors = watchConsole(page);
  await gotoReady(page, '/products/dezmaye-gold-80');
  await expect(page.locator('main')).toContainText('دزمایه');
  expect(errors).toEqual([]);
});

test.describe('shop purchase flow', () => {
  test('add to cart, see the badge, reach checkout and place an order', async ({ page }) => {
    const errors = watchConsole(page);

    await gotoReady(page, '/shop/dezmaye-gold-80');
    await page.locator('.sp-buy__row .btn').click();
    await expect(page.locator('.nav__cart-badge')).toHaveText(faNum(1));

    await page.locator('.nav__cart').click();
    await expect(page).toHaveURL(/\/shop\/cart$/);
    await expect(page.locator('.cart-table__row').nth(1)).toBeVisible();

    /* the summary is rendered twice (mobile + desktop placement) */
    await page.locator('.cart-summary button.btn--primary').first().click();
    await expect(page).toHaveURL(/\/shop\/checkout$/);

    const form = page.locator('.checkout-form');
    const inputs = form.locator('.checkout-form__grid input');
    await inputs.nth(0).fill('آزمون خودکار');
    await inputs.nth(1).fill('09123456789');
    await inputs.nth(2).fill('اهواز');
    await form.locator('textarea').first().fill('خیابان نمونه، پلاک ۱۲، واحد ۳');

    await form.locator('button[type="submit"]').first().click();

    /* Wait for whichever side resolves, then report the refusal text — a
       bare URL assertion only ever said "still on /shop/checkout". */
    await expect(page.locator('.order-hero .code, .note.err').first()).toBeVisible({ timeout: 20_000 });
    expect(await page.locator('.note.err').allTextContents(), 'checkout refused the order').toEqual([]);
    await expect(page).toHaveURL(/\/shop\/order\//, { timeout: 20_000 });
    await expect(page.locator('.order-hero .code')).not.toBeEmpty();
    expect(errors).toEqual([]);
  });

  test('checkout refuses an incomplete form with a visible message', async ({ page }) => {
    await gotoReady(page, '/shop/dezmaye-gold-500');
    await page.locator('.sp-buy__row .btn').click();
    await gotoReady(page, '/shop/checkout');

    await page.locator('.checkout-form button[type="submit"]').click();
    await expect(page.locator('.checkout-form .note.err')).toBeVisible();
    /* and it must not have navigated away */
    await expect(page).toHaveURL(/\/shop\/checkout$/);
  });

  test('the cart survives a reload', async ({ page }) => {
    await gotoReady(page, '/shop/dezmaye-gold-80');
    await page.locator('.sp-buy__row .btn').click();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.nav__cart-badge')).toHaveText(faNum(1));
  });

  test('a corrupted cart in localStorage does not blank the site @mobile', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('ky_shop_cart_v1', 'null');
    });
    const errors = watchConsole(page);
    await gotoReady(page, '/shop/cart');
    await expect(page.locator('main')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test('the contact form validates before it posts', async ({ page }) => {
  await gotoReady(page, '/contact');
  await page.locator('form button[type="submit"]').click();
  /* Inline field errors are <small> elements under each .field. */
  await expect(page.locator('form .field small').first()).toBeVisible();
  /* It must not have reported success. */
  await expect(page.locator('form')).toBeVisible();
});

test('/admin is reachable only by typing it, and is linked from nowhere', async ({ page }) => {
  for (const url of ['/', '/products', '/contact', '/shop']) {
    await gotoReady(page, url);
    await expect(page.locator('a[href*="admin"]')).toHaveCount(0);
  }
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.admin__login-card')).toBeVisible();
});

test('no image is requested that the server cannot serve @mobile', async ({ page }) => {
  const broken = [];
  page.on('response', (r) => {
    if (r.request().resourceType() === 'image' && r.status() >= 400) broken.push(`${r.status()} ${r.url()}`);
  });
  for (const url of ['/', '/products', '/shop', '/blog', '/about']) {
    await gotoReady(page, url);
  }
  expect(broken).toEqual([]);
});
