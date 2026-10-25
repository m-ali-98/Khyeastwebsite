/* First-paint theme contract.
   The inline head script runs before React and is the only thing preventing a
   wrong-theme flash, so exercise that exact script rather than duplicating its
   decisions in a test helper. This also locks the product decision that a new
   visitor starts in light mode even when their OS prefers dark. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'src/styles/global.scss'), 'utf8');
const runtime = fs.readFileSync(path.join(ROOT, 'src/i18n/LocaleContext.jsx'), 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
const startup = scripts.find((source) => source.includes("localStorage.getItem('ky_theme')"));

let passed = 0;
let total = 0;
const leaks = [];
const check = (condition, label) => {
  total += 1;
  if (condition) passed += 1;
  else leaks.push(label);
};

function firstPaint({ saved, pathname = '/', osDark = true } = {}) {
  const attributes = {};
  let themeColor = '#dc143c';
  const root = {
    lang: '',
    dir: '',
    style: {},
    setAttribute(name, value) { attributes[name] = String(value); },
  };
  const document = {
    documentElement: root,
    getElementById() { return null; },
    querySelector(selector) {
      if (selector === 'meta[name="theme-color"]') {
        return { setAttribute(name, value) { if (name === 'content') themeColor = String(value); } };
      }
      return null;
    },
    addEventListener(_name, callback) { callback(); },
  };
  const context = {
    document,
    location: { pathname },
    localStorage: { getItem: () => saved ?? null },
    /* Kept deliberately dark to prove startup no longer follows it. */
    window: { matchMedia: () => ({ matches: osDark }) },
  };
  vm.runInNewContext(startup, context);
  return { attributes, root, themeColor };
}

check(Boolean(startup), 'inline startup theme script is missing');
if (startup) {
  const first = firstPaint();
  check(first.attributes['data-theme'] === 'light', 'new visitor did not default to light');
  check(first.root.style.colorScheme === 'light', 'native controls did not start in light mode');
  check(first.themeColor === '#dc143c', 'light browser chrome colour is wrong');

  const dark = firstPaint({ saved: 'dark' });
  check(dark.attributes['data-theme'] === 'dark', 'saved dark preference was ignored');
  check(dark.root.style.colorScheme === 'dark', 'native controls did not follow saved dark mode');
  check(dark.themeColor === '#120a0d', 'dark browser chrome colour is wrong');

  check(firstPaint({ saved: 'not-a-theme' }).attributes['data-theme'] === 'light', 'invalid preference did not recover to light');
  const en = firstPaint({ pathname: '/en/products' });
  check(en.root.lang === 'en' && en.root.dir === 'ltr', 'English first-paint direction regressed');
  const ar = firstPaint({ pathname: '/ar' });
  check(ar.root.lang === 'ar' && ar.root.dir === 'rtl', 'Arabic first-paint direction regressed');
}

check(/<html[^>]*data-theme="light"/i.test(html), 'HTML has no explicit light default');
check(/:root\s*\{[\s\S]*?color-scheme:\s*light;/m.test(css), 'light native color-scheme token is missing');
check(/\[data-theme='dark'\][\s\S]*?color-scheme:\s*dark;/m.test(css), 'dark native color-scheme token is missing');
check(!/prefers-color-scheme:\s*dark/.test(runtime), 'React runtime still auto-selects the OS dark theme');
const body = css.match(/body\s*\{([\s\S]*?)\n\}/)?.[1] || '';
check(!/transition\s*:[^;]*(?:background|color)/.test(body), 'body still animates full-viewport paint on theme changes');

/* Small text and white labels are the places a brighter dark-mode crimson can
   silently fail. Assert the semantic token pairs, not one component snapshot. */
const lightTokens = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] || '';
const darkTokens = css.match(/\[data-theme='dark'\]\s*\{([\s\S]*?)\n\}/)?.[1] || '';
const token = (block, name) => block.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1];
const luminance = (hex) => {
  const rgb = hex.slice(1).match(/../g).map((pair) => parseInt(pair, 16) / 255);
  const linear = rgb.map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
};
const contrast = (foreground, background) => {
  if (!foreground || !background) return 0;
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};
check(contrast(token(lightTokens, 'crimson-solid'), '#ffffff') >= 4.5, 'light filled crimson fails white-label AA contrast');
check(contrast(token(darkTokens, 'crimson-solid'), '#ffffff') >= 4.5, 'dark filled crimson fails white-label AA contrast');
check(contrast(token(lightTokens, 'crimson-ink'), token(lightTokens, 'surface')) >= 4.5, 'light crimson text fails AA contrast');
check(contrast(token(darkTokens, 'crimson-ink'), token(darkTokens, 'surface')) >= 4.5, 'dark crimson text fails AA contrast');
check(contrast(token(lightTokens, 'ok'), token(lightTokens, 'surface')) >= 4.5, 'light success text fails AA contrast');
check(contrast(token(darkTokens, 'ok'), token(darkTokens, 'surface')) >= 4.5, 'dark success text fails AA contrast');
check(contrast(token(lightTokens, 'warn'), token(lightTokens, 'surface')) >= 4.5, 'light warning text fails AA contrast');
check(contrast(token(darkTokens, 'warn'), token(darkTokens, 'surface')) >= 4.5, 'dark warning text fails AA contrast');

for (const leak of leaks) console.log(`LEAK ${leak}`);
console.log(`${passed}/${total}`);
