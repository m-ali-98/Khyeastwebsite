/* Boot one route in an isolated process and report what rendered.
   Isolation matters: React's module registry and the route prefetch cache
   leak between boots inside a single process and cause false failures. */
import { boot } from './dom.mjs';

const route = process.argv[2] || '/';
const [pathname, search] = route.split('?');
const r = await boot(pathname, { search: search ? '?' + search : '', wait: 2200 });

/* A link with no text is invisible to a mouse and nameless to a screen
   reader, and it is produced by something as ordinary as a mistyped
   translation key — t() returns '' and the markup still renders an <a>.
   Cheap to detect here, on every route, rather than only on the handful of
   pages the browser suite audits. Links carrying an image or an aria-label
   are named by those instead. */
const namelessLinks = [...r.doc.querySelectorAll('a')]
  .filter((a) => {
    if (a.textContent.trim()) return false;
    if (a.getAttribute('aria-label') || a.getAttribute('title')) return false;
    return !a.querySelector('img, svg');
  })
  .map((a) => `a[href="${a.getAttribute('href') || ''}"]`)
  .slice(0, 3);

/* Headings are how a screen-reader user skims a page, and a skipped level
   tells them a section is missing. This is the second time the same bug has
   shipped — the shop product page jumped h1 to h3, then the account panel
   did — so it is worth catching on every route rather than on the handful
   the browser suite audits.

   Only increases are checked: going back up (h3 then h2) is a new section
   at a higher level, which is correct. */
const levels = [...r.doc.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => Number(h.tagName[1]));
const headingSkips = [];
let previous = 0;
for (const level of levels) {
  if (previous && level > previous + 1) headingSkips.push(`h${previous} → h${level}`);
  previous = level;
}

console.log(JSON.stringify({
  path: route,
  chars: r.text.length,
  errors: r.errors.slice(0, 4),
  namelessLinks,
  headingSkips: headingSkips.slice(0, 3),
  excerpt: r.text.slice(0, 70),
}));
process.exit(0);
