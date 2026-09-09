/* Boot one route in an isolated process and report what rendered.
   Isolation matters: React's module registry and the route prefetch cache
   leak between boots inside a single process and cause false failures. */
import { boot } from './dom.mjs';

const route = process.argv[2] || '/';
const [pathname, search] = route.split('?');
const r = await boot(pathname, { search: search ? '?' + search : '', wait: 2200 });

console.log(JSON.stringify({
  path: route,
  chars: r.text.length,
  errors: r.errors.slice(0, 4),
  excerpt: r.text.slice(0, 70),
}));
process.exit(0);
