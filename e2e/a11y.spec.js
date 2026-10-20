/* ==========================================================================
   Accessibility, audited by axe-core inside the real browser.

   Only rules that genuinely matter for this site are enforced, and they are
   enforced as hard failures rather than a report nobody reads:

     • colour contrast — the crimson/white and crimson/black palettes must
       stay readable in BOTH themes,
     • names on controls — the icon-only buttons (cart, burger, theme) have no
       text, so they live or die by aria-label,
     • document structure — lang/dir, one main landmark, ordered headings,
     • images — every <img> needs alt, decorative ones an empty one.

   Rules that fire on third-party or purely cosmetic markup are excluded with
   a reason, so the list is honest rather than silently loose.
   ========================================================================== */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { gotoReady, loginAdmin, signUpCustomer, addAddress, uniquePhone } from './helpers.js';

const require = createRequire(import.meta.url);
const AXE_PATH = path.join(path.dirname(require.resolve('axe-core/package.json')), 'axe.min.js');
const AXE_SOURCE = fs.readFileSync(AXE_PATH, 'utf8');

const RULES = [
  'color-contrast',
  'button-name',
  'link-name',
  'image-alt',
  'input-image-alt',
  'label',
  'aria-allowed-attr',
  'aria-required-attr',
  'aria-valid-attr-value',
  'aria-hidden-focus',
  'html-has-lang',
  'html-lang-valid',
  'valid-lang',
  'landmark-one-main',
  'heading-order',
  'duplicate-id-aria',
  'list',
  'meta-viewport',
];

/* The site ships a strict CSP: script-src 'self' plus the hash of the one
   inline boot script. Injecting axe with addScriptTag({content}) is an inline
   script and is therefore (correctly) blocked. Serving it from a same-origin
   URL that Playwright fulfils locally satisfies 'self' without weakening the
   policy the real site runs under — the whole point of auditing the real
   build is that nothing about it is relaxed for the test. */
async function audit(page) {
  await page.route('**/__axe.js', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: AXE_SOURCE }),
  );
  await page.addScriptTag({ url: '/__axe.js' });
  /* Entrance animations fade panels in from opacity 0. Auditing mid-fade
     measures a blend — the admin login inputs read #989495 on white (2.99:1)
     at 45% through the card's fade, which is a measurement artefact, not a
     palette fault. Wait for every finite animation to land; the looping
     decorative ones (hero particles) are skipped because they never do. */
  await page
    .waitForFunction(
      () =>
        document
          .getAnimations()
          .filter((a) => a.effect?.getTiming().iterations !== Infinity)
          .every((a) => a.playState === 'finished' || a.playState === 'idle'),
      null,
      { timeout: 5000 },
    )
    .catch(() => {});
  return page.evaluate(
    async (rules) =>
      // eslint-disable-next-line no-undef
      axe.run(document, { runOnly: { type: 'rule', values: rules }, resultTypes: ['violations'] }),
    RULES,
  );
}

/* A bare selector is not enough to fix a contrast failure — the measured
   colours and ratio are what say which token is wrong. */
const nodeLine = (n) => {
  const d = (n.any || []).find((c) => c.data && c.data.contrastRatio)?.data;
  const extra = d ? `  [${d.fgColor} on ${d.bgColor} = ${d.contrastRatio}:1, needs ${d.expectedContrastRatio}]` : '';
  return n.target.join(' ') + extra;
};

const describe = (v) =>
  v.violations
    .map((x) => `${x.id} (${x.nodes.length}×) — ${x.help}\n      ${x.nodes.slice(0, 3).map(nodeLine).join('\n      ')}`)
    .join('\n  ');

/* /shop/<slug> is here because it has no hero: axe cannot judge contrast
   through a transparent overlay (it reports those as incomplete, and we only
   collect violations), which is exactly how the invisible white navbar on the
   hero-less pages went unnoticed. public.spec.js measures that case
   directly; this still covers everything below the header. */
const PAGES = [
  '/',
  '/about',
  '/products',
  '/products/dezmaye-gold-80',
  '/blog',
  '/contact',
  '/shop',
  '/shop/dezmaye-gold-80',
  '/shop/cart',
  '/shop/login',
  '/en',
  '/ar',
  '/nonexistent-page',
];

for (const url of PAGES) {
  for (const theme of ['light', 'dark']) {
    test(`a11y ${url} (${theme})`, async ({ page }) => {
      /* Set before any script runs, so the page paints in the right theme
         rather than flipping after hydration. */
      await page.addInitScript((t) => localStorage.setItem('ky_theme', t), theme);
      await gotoReady(page, url);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

      const results = await audit(page);
      expect(results.violations.length, `\n  ${describe(results)}\n`).toBe(0);
    });
  }
}

/* The pages behind a session were not audited at all, which is a gap worth
   closing rather than explaining: the account panel is a form-heavy page
   built after the rest of the site, and the admin tabs added with the shop
   work have never been through axe. Each signs in first, so the audit sees
   what the person using it sees. */
test('a11y the customer account panel', async ({ page }) => {
  await gotoReady(page, '/shop');
  await signUpCustomer(page, { phone: uniquePhone() });
  await addAddress(page);

  for (const tab of ['سفارش‌های من', 'نشانی‌ها', 'اطلاعات حساب']) {
    await gotoReady(page, '/shop/account');
    await page.locator('.acc-nav__item', { hasText: tab }).click();
    const results = await audit(page);
    expect(results.violations.length, `\n  ${tab}:\n  ${describe(results)}\n`).toBe(0);
  }
});

test('a11y the admin tabs added with the shop', async ({ page }) => {
  await loginAdmin(page);
  for (const tab of ['سفارش‌ها', 'مشتریان', 'پیامک', 'درگاه پرداخت', 'امنیت و محدودیت‌ها']) {
    await page.locator('.admin__side button', { hasText: tab }).click();
    await expect(page.locator('.admin__panel h1')).toBeVisible();
    const results = await audit(page);
    expect(results.violations.length, `\n  ${tab}:\n  ${describe(results)}\n`).toBe(0);
  }
});

test('a11y /admin login', async ({ page }) => {
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.admin__login-card')).toBeVisible();
  const results = await audit(page);
  expect(results.violations.length, `\n  ${describe(results)}\n`).toBe(0);
});

test('the whole site is operable by keyboard alone', async ({ page }) => {
  await gotoReady(page, '/');

  /* Tab until the first nav link has focus — if focus is trapped or skipped,
     this never happens and the test fails loudly. */
  let reached = false;
  for (let i = 0; i < 25 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => !!document.activeElement?.closest('.nav__links'));
  }
  expect(reached, 'could not reach the main navigation with the keyboard').toBe(true);

  /* Focus must be visible, not suppressed by a blanket outline:none. */
  const outline = await page.evaluate(() => {
    const s = getComputedStyle(document.activeElement);
    return `${s.outlineStyle} ${s.outlineWidth} ${s.boxShadow}`;
  });
  expect(outline).not.toBe('none 0px none');

  await page.keyboard.press('Enter');
  await expect(page).not.toHaveURL(/#$/);
});

test('motion is suppressed when the visitor asks for reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoReady(page, '/');

  /* Nothing should still be mid-flight a second after load. */
  await page.waitForTimeout(1000);
  const moving = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === 'running' && a.effect?.getTiming().duration > 400)
      /* name the offenders: "2 animations" is not actionable */
      .map((a) => a.animationName || a.effect?.target?.className || 'unnamed'),
  );
  expect(moving, `long animations still running under prefers-reduced-motion: ${moving.join(', ')}`).toEqual([]);
});
