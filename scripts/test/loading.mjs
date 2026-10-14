/* Loading UX contract — first paint waits for a real route commit, and every
   client-side navigation shows the orbital screen even when its chunk is held
   by browser-native caching. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const html = read('index.html');
const app = read('src/App.jsx');
const layout = read('src/components/Layout.jsx');
const main = read('src/main.jsx');
const boot = read('src/lib/bootSplash.js');
const fallback = read('src/components/RouteFallback.jsx');
const pagePending = read('src/components/PagePending.jsx');
const adminApp = read('src/admin/AdminApp.jsx');
const dataPages = ['ShopOrder.jsx', 'ShopAccount.jsx', 'ShopAuth.jsx', 'ShopCheckout.jsx']
  .map((file) => read(`src/pages/${file}`))
  .join('\n');
const gate = read('src/hooks/useLoadingGate.js');
const css = read('src/styles/global.scss');

let passed = 0;
let total = 0;
const leaks = [];
const check = (condition, label) => {
  total += 1;
  if (condition) passed += 1;
  else leaks.push(label);
};

check(/<div id="root"><\/div>[\s\S]*id="boot-splash"/.test(html), 'boot splash is not a sibling outside the React root');
check(/class="boot-splash"[\s\S]*role="status"[\s\S]*aria-busy="true"/.test(html), 'boot splash has no accessible pending state');
check(/boot-splash__mark[\s\S]*\/assets\/brand\/logo\.webp/.test(html), 'boot splash does not use the official logo');
check(/boot-splash__content" aria-hidden="true"/.test(html), 'visual loader content is exposed as meaningless accessibility noise');
check(/boot-splash__orbit/.test(html) && !/boot-splash__bar/.test(html), 'boot screen is not using the textless orbital system');
check(!/boot-splash__(?:slogan|eyebrow|status|signature)/.test(html), 'visible copy returned to the text-free boot screen');
check(/boot-splash__a11y[\s\S]*Loading[\s\S]*جارٍ التحميل/.test(html), 'text-free boot screen lost its localized accessible label');
check(/html\[lang='en'\] \.boot-i18n > \[lang='en'\]/.test(html), 'localized accessible copy waits until DOM ready');
const doneRule = html.match(/#boot-splash\.is-done\s*\{([\s\S]*?)\}/)?.[1] || '';
check(/translate3d\(0,\s*-101%/.test(doneRule), 'boot screen no longer reveals with a one-layer transform');
check(!/opacity\s*:/.test(doneRule), 'boot screen exit regressed to a full-page cross-fade');

check(/function RouteCommit\(\{ routeKey, onReady \}\)[\s\S]*dismissBootSplash\(\)[\s\S]*onReady\(routeKey\)/.test(app), 'route commit does not signal real readiness');
check((app.match(/<RouteCommit routeKey=/g) || []).length === 2, 'public and admin Suspense boundaries do not both signal readiness');
check(!/dismissBootSplash/.test(main), 'entrypoint dismisses the splash before the route commits');
check(/requestAnimationFrame\([\s\S]*requestAnimationFrame/.test(boot), 'splash does not wait for a painted route frame');
check(/transitionend/.test(boot) && /safety/.test(boot), 'splash cleanup is not transition-driven and fail-safe');
check(/new MutationObserver\(look\)/.test(layout) && !/tries\+\+ < 60/.test(layout), 'slow lazy heroes can outlive navbar detection');

check(!fs.existsSync(path.join(ROOT, 'src/routes.js')), 'legacy route-prefetch module still exists');
check(!/usePrefetchRoutes|\bprefetch\(|\bisWarm\b/.test(app + fallback), 'custom route warming/cache suppression still exists');
check(/transitioning && <RouteFallback/.test(app), 'navigation loader is not forced for cached routes');
check(/NAVIGATION_BEAT_MS\s*=\s*420/.test(app) && /NAVIGATION_BEAT_MS - elapsed/.test(app), 'cached routes can skip the readable loading-screen beat');
check(/key !== activeKey\.current/.test(app), 'stale route commits can dismiss a newer navigation screen');
check(/<main\s+[\s\S]{0,160}key=/.test(app) && /useTransitions=\{false\}/.test(app) && !/<mo\.main|AnimatePresence/.test(app), 'page transitions still cross-fade or retain an outgoing page layer');
check(/fallback=\{transitioning \|\| bootSplashPresent \? null : <RouteFallback/.test(app), 'cold routes can stack a second loading screen over the navigation or boot gate');
check(/fa:\s*\{/.test(fallback) && /en:\s*\{/.test(fallback) && /ar:\s*\{/.test(fallback), 'route loading accessibility copy is not trilingual');
check(/role="status"[\s\S]*aria-live="polite"[\s\S]*aria-busy="true"/.test(fallback), 'route loader is not announced accessibly');
check(/aria-hidden=\{transitioning[\s\S]*inert=\{transitioning/.test(app), 'covered destination content remains exposed during navigation');
check(/className="sr-only"/.test(fallback) && /navigation-loader__orbit/.test(fallback), 'route loading is not visually text-free with an accessible name');
check(!/route-loader__status/.test(fallback + pagePending), 'visible loading status copy returned');
check(!/<p>در حال آماده‌سازی پنل/.test(adminApp), 'admin loading screen still renders visible copy');
check(!/admin__boot-bar/.test(adminApp), 'admin loading screen still uses the old linear progress bar');

const sheenFrames = css.match(/@keyframes sk-sheen\s*\{([\s\S]*?)\n\}/)?.[1] || '';
check(/translate3d/.test(sheenFrames), 'skeleton sheen is not compositor-transformed');
check(!/background-position/.test(sheenFrames), 'skeleton sheen repaints background-position');
check(/\.navigation-loader\s*\{[\s\S]*position:\s*fixed/.test(css), 'navigation loading screen does not cover page transitions');
check(/navigation-loader__orbit[\s\S]*animation: navigation-loader-orbit/.test(css), 'navigation loader lost its orbital motion');
check(/prefers-reduced-motion:[\s\S]*navigation-loader__orbit/.test(css), 'route loading does not respect reduced motion');
check(/navigator\.connection/.test(gate) && /effectiveType/.test(gate), 'loading delay is no longer connection-aware');
check(/useLoadingGate\(true\)/.test(pagePending), 'post-route data loading is not adaptively gated');
check((dataPages.match(/<PagePending/g) || []).length >= 4, 'shop page data transitions still fall back to bare ellipses');

for (const leak of leaks) console.log(`LEAK ${leak}`);
console.log(`${passed}/${total}`);
