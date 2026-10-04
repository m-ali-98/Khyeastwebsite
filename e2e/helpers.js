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

/** Wait until a client-side route change has finished.
 *
 *  Page transitions use <AnimatePresence mode="popLayout">, so while the old
 *  page animates out BOTH routes are in the DOM. That is what produced the
 *  "resolved to 2 elements" failures: a form filled on the outgoing copy, then
 *  submitted on the incoming empty one, or the reverse. Waiting for a single
 *  <main> is the honest signal that the new page owns the document. */
/** The one live copy of `selector`, and a printed explanation when there is
 *  more than one.
 *
 *  Page transitions keep the outgoing route mounted for a moment, so a
 *  selector can legitimately resolve twice mid-flight. Blind .first() hid
 *  that and picked the stale copy; a bare strict locator fails with nothing
 *  but a count. This takes the live copy — the incoming page is appended
 *  last — and logs where each duplicate sits so the structure is visible in
 *  the run output instead of being guessed at. */
export async function one(page, selector) {
  const loc = page.locator(selector);
  await expect(loc.first()).toBeVisible({ timeout: 15_000 });
  const n = await loc.count();
  if (n > 1) {
    const paths = await page.evaluate((sel) => {
      const describe = (el) => {
        const parts = [];
        for (let p = el; p && p !== document.documentElement; p = p.parentElement)
          parts.push(p.tagName.toLowerCase() + (typeof p.className === 'string' && p.className ? '.' + p.className.trim().split(/\s+/).join('.') : ''));
        return parts.reverse().join(' > ');
      };
      return [...document.querySelectorAll(sel)].map(describe);
    }, selector);
    console.log(`[e2e] "${selector}" matched ${n} elements; using the last:\n    ${paths.join('\n    ')}`);
  }
  return loc.last();
}

export async function routeSettled(page, urlRe) {
  if (urlRe) await expect(page).toHaveURL(urlRe);
  await expect(page.locator('main')).toHaveCount(1, { timeout: 10_000 });
  await animationsSettled(page);
}

/** Resolve once every finite animation has landed.
 *
 *  Looping decorative ones (the hero particles) never finish, so they are
 *  excluded — waiting on them would simply burn the timeout. */
export async function animationsSettled(page) {
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
