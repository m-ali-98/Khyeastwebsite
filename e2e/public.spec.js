/* ==========================================================================
   The public site, in a real browser.

   This is the half of the suite linkedom could not reach: lazy route chunks
   actually resolve here, so a page that renders 16 characters in the headless
   harness is finally proved to render its real content.
   ========================================================================== */
import { test, expect } from '@playwright/test';
import { gotoReady, routeSettled, one, watchConsole, faNum, signUpCustomer, addAddress, uniquePhone } from './helpers.js';

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
  /* /shop/checkout is deliberately absent: it requires an account now and
     sends an anonymous visitor to sign in, which is covered by its own test
     below. The sign-in page it lands on is public, so that is listed. */
  ['/shop/login', '.auth-card', 30],
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
      const response = await gotoReady(page, route);
      if (route === '/nonexistent-page') expect(response?.status()).toBe(404);

      /* The lazy chunk must have produced real content, not the skeleton. */
      await expect(page.locator(selector).first()).toBeVisible();
      const text = await page.locator('main').innerText();
      expect(text.trim().length, `${route} rendered almost nothing`).toBeGreaterThan(minChars);

      /* No navigation cover or boot splash may still be on screen once settled. */
      await expect(page.locator('.navigation-loader, .boot-splash')).toHaveCount(0);

      /* Chromium reports the expected top-level 404 as a console error on
         Windows. Allow that one network message only after asserting the main
         document really returned 404; failed assets on every other route
         remain test failures. */
      const unexpectedErrors = route === '/nonexistent-page'
        ? errors.filter((message) => !/^Failed to load resource:.*404 \(Not Found\)$/.test(message))
        : errors;
      expect(unexpectedErrors, `console errors on ${route}`).toEqual([]);
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

test('the mobile header stays compact without wrapping or overlapping its locale wordmarks @mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 844 });
  await gotoReady(page, '/');
  const header = page.locator('nav.nav');

  /* Persian carries three controls. On a 375px phone the mark-only treatment
     is intentional; retaining a wrapped company name made the header almost
     as tall as the hero copy beneath it. */
  await expect(header.locator('.nav__logo-text')).toBeHidden();
  const compact = await page.evaluate(() => {
    const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
    const targets = [...document.querySelectorAll('.nav__icon, .nav__burger')]
      .filter((node) => node.getClientRects().length)
      .map((node) => node.getBoundingClientRect());
    return {
      nav: rect('.nav').height,
      topbar: rect('.nav__topbar').height,
      bar: rect('.nav__bar').height,
      minTarget: Math.min(...targets.flatMap(({ width, height }) => [width, height])),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(compact).toMatchObject({ nav: 102, topbar: 34, bar: 68, overflow: 0 });
  expect(compact.minTarget).toBeGreaterThanOrEqual(42);

  /* Once there is room, show the Persian company name as one clean line and
     discard only the redundant Latin subtitle. */
  await page.setViewportSize({ width: 390, height: 844 });
  const faName = header.locator('.nav__logo-text strong');
  await expect(faName).toBeVisible();
  await expect(header.locator('.nav__logo-text small')).toBeHidden();
  const faLine = await faName.evaluate((node) => ({
    height: node.getBoundingClientRect().height,
    lineHeight: parseFloat(getComputedStyle(node).lineHeight),
  }));
  expect(faLine.height).toBeLessThanOrEqual(faLine.lineHeight + 0.5);

  /* English and Arabic have one control, so hiding their full identity at the
     old generic breakpoint wasted space. Both wordmarks must fit even at 320. */
  await page.setViewportSize({ width: 320, height: 844 });
  for (const route of ['/en', '/ar']) {
    await gotoReady(page, route);
    await expect(header.locator('.nav__logo-text')).toBeVisible();
    await expect(header.locator('.nav__logo-text small')).toBeVisible();
    const geometry = await page.evaluate(() => {
      const logo = document.querySelector('.nav__logo').getBoundingClientRect();
      const actions = document.querySelector('.nav__actions').getBoundingClientRect();
      const subtitle = document.querySelector('.nav__logo-text small');
      const subRect = subtitle.getBoundingClientRect();
      return {
        separated: logo.right <= actions.left || actions.right <= logo.left,
        subtitleHeight: subRect.height,
        subtitleLineHeight: parseFloat(getComputedStyle(subtitle).lineHeight),
        subtitleDirection: getComputedStyle(subtitle).direction,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(geometry.separated).toBe(true);
    expect(geometry.subtitleHeight).toBeLessThanOrEqual(geometry.subtitleLineHeight + 0.5);
    expect(geometry.subtitleDirection).toBe('ltr');
    expect(geometry.overflow).toBe(0);
  }
});

test('the shop header is transparent over its showcase and solid only after scrolling @mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoReady(page, '/shop');
  await expect(page.getByTestId('shop-showcase')).toBeVisible();

  const nav = page.locator('nav.nav');
  const bar = page.locator('.nav__bar');
  const backgroundAlpha = () => bar.evaluate((node) => {
    const values = getComputedStyle(node).backgroundColor.match(/[\d.]+/g)?.map(Number) || [];
    return values.length === 4 ? values[3] : 1;
  });
  await expect(nav).not.toHaveClass(/is-scrolled/);
  expect(await backgroundAlpha()).toBe(0);

  await page.evaluate(() => window.scrollTo(0, 90));
  await expect(nav).toHaveClass(/is-scrolled/);
  await expect.poll(backgroundAlpha).toBeGreaterThanOrEqual(0.95);
  await expect(bar).toHaveCSS('backdrop-filter', 'none');

  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(nav).not.toHaveClass(/is-scrolled/);
  await expect.poll(backgroundAlpha).toBe(0);
});

test('the mobile menu opens immediately above the shop showcase @mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoReady(page, '/shop');

  const nav = page.locator('nav.nav');
  await page.getByRole('button', { name: 'منوی سایت' }).click();
  await expect(page.locator('#mobile-navigation')).toBeVisible();
  await expect(page.locator('body')).toHaveClass(/is-mobile-menu-open/);
  await expect(page.locator('main')).toBeHidden();
  await expect(page.locator('#mobile-navigation').getByRole('link', { name: /فروشگاه/ })).toHaveClass(/active/);

  await page.keyboard.press('Escape');
  await expect(page.locator('#mobile-navigation')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/is-mobile-menu-open/);
  await expect(page.locator('main')).toBeVisible();
  await expect(nav).not.toHaveClass(/is-scrolled/);

  /* Opening from the compact scrolled state must keep the inverse menu paint.
     A later mobile “solid header” rule once won the cascade here, producing
     white menu labels over a white bar even though the top-state menu worked. */
  await page.evaluate(() => window.scrollTo({ top: 120, behavior: 'instant' }));
  await expect(nav).toHaveClass(/is-scrolled/);
  const scrollBeforeOpen = await page.evaluate(() => window.scrollY);
  await page.getByRole('button', { name: 'منوی سایت' }).click();
  await expect(page.locator('#mobile-navigation')).toBeVisible();
  await expect(nav).toHaveClass(/is-menu-open/);
  await expect(nav.locator('.nav__bar')).toHaveCSS('background-color', 'rgba(16, 10, 12, 0.96)');
  await expect(nav.locator('.nav__logo-text strong')).toHaveCSS('color', 'rgb(255, 255, 255)');
  expect(await page.locator('#mobile-navigation').evaluate((node) => getComputedStyle(node).paddingTop)).toBe('84px');
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBeforeOpen);

  await page.keyboard.press('Escape');
  await expect(page.locator('#mobile-navigation')).toHaveCount(0);
  await expect(nav).toHaveClass(/is-scrolled/);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBeforeOpen);
});

test('shop search, sale and brand filters compose without hiding their controls @mobile', async ({ page }) => {
  await gotoReady(page, '/shop');

  const showcase = page.getByTestId('shop-showcase');
  await expect(showcase.getByRole('heading', { level: 1 })).toContainText('فروشگاه');
  await expect(showcase.locator('.shop-showcase__link')).toHaveAttribute('href', '/products');

  const search = page.getByTestId('shop-search');
  await search.fill('ايكس پاور');
  await expect(page.locator('.shop-card')).toHaveCount(1);
  await expect(page.locator('.shop-card')).toContainText('ایکس پاور');
  const cardActions = page.locator('.shop-card__actions').first();
  await expect(cardActions.getByRole('link', { name: /مشاهده و خرید/ })).toBeVisible();
  const addButton = cardActions.getByRole('button');
  await expect(addButton).toBeVisible();
  await expect(addButton).toHaveAccessibleName(/افزودن به سبد خرید/);
  await addButton.click();
  await expect(addButton).toContainText('اضافه شد');

  const sale = page.getByTestId('shop-sale-filter');
  await sale.click();
  await expect(sale).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.shop-card')).toHaveCount(0);
  await expect(search).toBeVisible();
  await expect(page.getByRole('heading', { name: /محصولی با این مشخصات/ })).toBeVisible();

  await page.getByRole('button', { name: 'پاک کردن فیلترها' }).click();
  await expect(search).toHaveValue('');
  await expect(sale).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.shop-card')).toHaveCount(7);

  await sale.click();
  await page.locator('.shop-filter').getByRole('button', { name: 'دزمایه', exact: true }).click();
  await search.fill('۸۰');
  await page.locator('.shop-toolbar__sort select').selectOption('expensive');
  await expect(page.locator('.shop-card')).toHaveCount(1);
  await expect(page.locator('.shop-card')).toContainText('۸۰ گرمی');
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

test('the first-paint screen stays until a directly opened lazy route commits', async ({ page }) => {
  let releaseChunk;
  let markRequested;
  const chunkRequested = new Promise((resolve) => { markRequested = resolve; });
  const held = new Promise((resolve) => { releaseChunk = resolve; });

  await page.route(/\/assets\/About-[^/]+\.js$/, async (route) => {
    markRequested();
    await held;
    await route.continue();
  });

  const navigation = page.goto('/about', { waitUntil: 'domcontentloaded' });
  await chunkRequested;
  await expect(page.locator('#boot-splash')).toBeVisible();
  await page.waitForTimeout(280);
  await expect(page.locator('#boot-splash')).toBeVisible();

  releaseChunk();
  await navigation;
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('#boot-splash')).toHaveCount(0, { timeout: 3000 });
});

test('idle, hover and focus do not speculatively fetch neighbouring route chunks', async ({ page }) => {
  const speculative = [];
  page.on('request', (request) => {
    if (/\/assets\/(?:Products|About)-[^/]+\.js$/.test(new URL(request.url()).pathname)) {
      speculative.push(request.url());
    }
  });

  await gotoReady(page, '/');
  const productsLink = page.locator('.nav__links a[href="/products"]');
  await productsLink.hover();
  await productsLink.focus();
  await page.waitForTimeout(500);

  expect(speculative, 'a route chunk was warmed before navigation').toEqual([]);
});

test('a cold client-side route stays behind the navigation screen until it commits', async ({ page }) => {
  let releaseChunk;
  const held = new Promise((resolve) => { releaseChunk = resolve; });
  await page.route(/\/assets\/Contact-[^/]+\.js$/, async (route) => {
    await held;
    await route.continue();
  });

  await gotoReady(page, '/');
  await expect(page.locator('#boot-splash')).toHaveCount(0);
  await page.locator('.nav__links a[href="/contact"]').click();

  const loader = page.locator('.navigation-loader');
  await expect(loader).toBeVisible({ timeout: 2500 });
  await expect(loader).toHaveAttribute('aria-busy', 'true');
  await expect(loader.locator('.navigation-loader__orbit')).toBeVisible();
  /* The outgoing route is removed rather than cross-faded under the cover. */
  await expect(page.locator('.hero')).toHaveCount(0);
  /* Longer than the readable beat: an unresolved route must still keep the
     cover mounted, proving dismissal follows commit rather than a timer. */
  await page.waitForTimeout(560);
  await expect(loader).toBeVisible();

  releaseChunk();
  await expect(page).toHaveURL(/\/contact$/);
  await expect(page.locator('form')).toBeAttached({ timeout: 10_000 });
  await expect(loader).toHaveCount(0, { timeout: 3000 });
  await expect(page.locator('form')).toBeVisible();
});

test('a cached route revisit still gets the complete navigation screen', async ({ page }) => {
  /* A direct visit puts the Products chunk into React.lazy and the browser
     cache. Returning to it proves feedback does not depend on chunk latency. */
  await gotoReady(page, '/products');
  await expect(page.locator('.product-card').first()).toBeVisible();
  await expect(page.locator('.navigation-loader, #boot-splash')).toHaveCount(0);

  await page.locator('nav.nav .nav__logo').click();
  await expect(page.locator('.navigation-loader')).toBeVisible();
  /* Home intentionally has featured product cards too. The catalogue filter
     is the route-specific marker that proves the outgoing Products page was
     removed while the single navigation cover is visible. */
  await expect(page.locator('.filter-bar')).toHaveCount(0);
  await expect(page.locator('.hero')).toBeAttached();
  await expect(page.locator('.navigation-loader')).toHaveCount(0, { timeout: 3000 });
  await expect(page.locator('.hero')).toBeVisible();

  await page.locator('.nav__links a[href="/products"]').click();
  const cachedLoader = page.locator('.navigation-loader');
  await expect(cachedLoader).toBeVisible();
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('.hero')).toHaveCount(0);
  await expect(cachedLoader).toHaveCount(0, { timeout: 3000 });
  await expect(page.locator('.product-card').first()).toBeVisible();
});

test('a first visit defaults to light even when the operating system is dark', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => localStorage.removeItem('ky_theme'));
  await gotoReady(page, '/');

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#dc143c');
  expect(await page.evaluate(() => localStorage.getItem('ky_theme'))).toBe('light');
});

test('dark mode applies and survives a reload', async ({ page }) => {
  await gotoReady(page, '/');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'light');

  await page.locator('nav.nav .theme-toggle').first().click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#120a0d');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(html).toHaveAttribute('data-theme', 'dark');

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

    /* Ordering requires a verified account now, so the journey starts with
       one. The signup itself is covered in account.spec.js; here it is
       setup, driven through the API to keep this test about buying. */
    await gotoReady(page, '/shop');
    await signUpCustomer(page, { phone: uniquePhone() });
    await addAddress(page);

    await gotoReady(page, '/shop/dezmaye-gold-80');
    await page.locator('.sp-buy__row .btn').click();
    await expect(page.locator('.nav__cart-badge')).toHaveText(faNum(1));

    await page.locator('.nav__cart').click();
    await routeSettled(page, /\/shop\/cart$/);
    await expect(page.locator('.cart-table__row').nth(1)).toBeVisible();

    await (await one(page, '.cart-summary button.btn--primary')).click();
    await routeSettled(page, /\/shop\/checkout$/);

    /* The saved address is preselected — most customers have exactly one and
       should not have to choose anything. */
    const form = page.locator('.checkout-form');
    await expect(form.locator('.checkout-addr__item.is-on')).toHaveCount(1);

    await form.locator('button[type="submit"]').click();

    /* Wait for whichever side resolves, then report the refusal text — a
       bare URL assertion only ever said "still on /shop/checkout". */
    await expect(page.locator('.order-hero .code, .note.err').first()).toBeVisible({ timeout: 20_000 });
    expect(await page.locator('.note.err').allTextContents(), 'checkout refused the order').toEqual([]);
    await expect(page).toHaveURL(/\/shop\/order\//, { timeout: 20_000 });
    await expect(await one(page, '.order-hero .code')).not.toBeEmpty();
    expect(errors).toEqual([]);
  });

  test('checkout without an address says so instead of failing silently', async ({ page }) => {
    await gotoReady(page, '/shop');
    await signUpCustomer(page, { phone: uniquePhone() }); // no address saved
    await gotoReady(page, '/shop/dezmaye-gold-500');
    await page.locator('.sp-buy__row .btn').click();
    await gotoReady(page, '/shop/checkout');

    await page.locator('.checkout-form button[type="submit"]').click();
    await expect(page.locator('.checkout-form .note.err')).toBeVisible();
    /* and it must not have navigated away */
    await expect(page).toHaveURL(/\/shop\/checkout$/);
  });

  test('a signed-out visitor is sent to sign in, not to a dead end', async ({ page }) => {
    await gotoReady(page, '/shop/dezmaye-gold-80');
    await page.locator('.sp-buy__row .btn').click();
    await page.goto('/shop/checkout', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/shop\/login/, { timeout: 20_000 });
    await expect(page.locator('.auth-card')).toBeVisible();
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

/* The transparent navbar is only legible over a dark hero. A page without one
   — a shop product, the cart, checkout, a product detail page — used to paint
   white links on a white page, so the whole header disappeared in light mode.
   The rule is now "solid unless a hero is actually behind it", and this
   measures the result the visitor gets rather than the class name: the link
   colour must have real contrast against whatever is painted behind it. */
const srgb = (c) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const lum = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
const parse = (s) => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
const ratio = (a, b) => {
  const [x, y] = [lum(parse(a)), lum(parse(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/* Only genuinely hero-less routes belong here. /shop/cart and /shop/checkout
   render a PageHero, so their bar is transparent over a dark ground and was
   never part of this bug — the first run of this test said so by failing the
   precondition. */
for (const route of ['/shop/dezmaye-gold-80', '/products/dezmaye-gold-80']) {
  test(`the header is readable at the top of ${route} @mobile`, async ({ page }) => {
    await gotoReady(page, route);
    /* Precondition, not decoration: if a hero appears here one day the
       transparent bar becomes correct again and this test must be revisited
       rather than quietly measuring the wrong thing. */
    await expect(page.locator('.hero, .page-hero, .shop-showcase')).toHaveCount(0);

    /* Read the bar's own background, not the body's: the solid state paints
       a translucent surface over the page. */
    const { fg, bg } = await page.evaluate(() => {
      const link = document.querySelector('.nav__links a.nav__link');
      const bar = document.querySelector('.nav__bar') || document.querySelector('.nav');
      return {
        fg: getComputedStyle(link).color,
        bg: getComputedStyle(bar).backgroundColor,
      };
    });

    /* A transparent bar reports rgba(0, 0, 0, 0) — which is exactly the
       broken state on a page with no hero, so treat it as a failure rather
       than computing contrast against nothing. */
    expect(bg, `navbar is transparent on ${route}, so its white text sits on the page itself`).not.toMatch(/, 0\)$/);
    expect(ratio(fg, bg), `nav link contrast on ${route}`).toBeGreaterThan(4.5);
  });
}
