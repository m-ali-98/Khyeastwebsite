/* Shared browser-test helpers. */
import { expect } from '@playwright/test';
import { E2E } from '../playwright.config.js';

/* Noise that is not a defect in this site: a missing favicon in a scratch
   build, and the benign ResizeObserver notice Chromium emits when an element
   is resized inside an observer callback (framer-motion does this). Anything
   else that reaches console.error is treated as a failure, because that is
   how an undefined constant or a bad key surfaces in a real browser. */
const IGNORED = [
  /favicon/i,
  /ResizeObserver loop/i,
  /Download the React DevTools/i,
];

export function watchConsole(page) {
  const errors = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (IGNORED.some((re) => re.test(text))) return;
    errors.push(text);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

/* The lazy route chunk, the content fetch and the fonts all resolve
   independently. Waiting for networkidle alone is flaky on a warm cache, so
   wait for the route's own content to exist. */
export async function gotoReady(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('main, .admin')).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
}

export async function loginAdmin(page) {
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  const card = page.locator('.admin__login-card');
  const side = page.locator('.admin__side');

  /* The panel renders neither until BOTH the session check and the three
     translation dictionaries have resolved, which on a cold chunk cache can
     take a while. Wait for whichever appears instead of assuming the login
     card is up within a fixed window. */
  await expect(card.or(side).first()).toBeVisible({ timeout: 30_000 });

  /* Already signed in from an earlier test in the same browser context. */
  if (await side.isVisible()) return;
  await card.locator('input').first().fill(E2E.user);
  await card.locator('input[type="password"]').fill(E2E.pass);
  await card.getByRole('button', { name: 'ورود به پنل' }).click();
  await expect(side).toBeVisible({ timeout: 20_000 });
}

export const adminTab = (page, label) => page.locator('.admin__side button', { hasText: label });

/* Persian digits — the site renders every number through faNum(), so a
   literal '2' will never be found in the DOM. */
export const faNum = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

export { E2E };
