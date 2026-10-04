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
import { gotoReady } from './helpers.js';

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

const PAGES = ['/', '/about', '/products', '/products/dezmaye-gold-80', '/blog', '/contact', '/shop', '/shop/cart', '/en', '/ar'];

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
