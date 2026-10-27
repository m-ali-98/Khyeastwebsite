/* Loading UX contract — first paint waits for fresh content and a real route
   commit. Client-side navigation revalidates content, but the orbital screen
   appears only when genuine work outlives the adaptive delay. */
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
const content = read('src/content/ContentContext.jsx');
const server = read('server/index.js');
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
check(/boot-splash__halo[\s\S]*boot-splash__orbit"><i><\/i><i><\/i>[\s\S]*boot-splash__mark/.test(html), 'boot and navigation loaders no longer share halo/orbit/particle/mark structure');
check(/\.boot-splash__content\s*\{[\s\S]{0,160}width:\s*clamp\(148px,\s*19vw,\s*184px\)/.test(html)
  && /\.navigation-loader__stage\s*\{[\s\S]{0,160}width:\s*clamp\(148px,\s*19vw,\s*184px\)/.test(css), 'boot and navigation loader stage geometry diverged');
check(/\.boot-splash__mark\s*\{[\s\S]{0,180}width:\s*104px;[\s\S]{0,40}height:\s*104px/.test(html)
  && /\.navigation-loader__mark\s*\{[\s\S]{0,180}width:\s*104px;[\s\S]{0,40}height:\s*104px/.test(css), 'boot and navigation loader logo-disc geometry diverged');
check(!/boot-splash__(?:slogan|eyebrow|status|signature)/.test(html), 'visible copy returned to the text-free boot screen');
check(/boot-splash__a11y[\s\S]*Loading[\s\S]*جارٍ التحميل/.test(html), 'text-free boot screen lost its localized accessible label');
check(/html\[lang='en'\] \.boot-i18n > \[lang='en'\]/.test(html), 'localized accessible copy waits until DOM ready');
const doneRule = html.match(/#boot-splash\.is-done\s*\{([\s\S]*?)\}/)?.[1] || '';
check(/translate3d\(0,\s*-101%/.test(doneRule), 'boot screen no longer reveals with a one-layer transform');
check(!/opacity\s*:/.test(doneRule), 'boot screen exit regressed to a full-page cross-fade');

check(/function RouteCommit\(\{ routeKey, onReady \}\)[\s\S]*onReady\(routeKey\)/.test(app), 'route commit does not signal real readiness');
check((app.match(/<RouteCommit routeKey=/g) || []).length === 2, 'public and admin Suspense boundaries do not both signal readiness');
check(!/dismissBootSplash/.test(main), 'entrypoint dismisses the splash before content and route readiness');
check(/freshKeyRef\.current !== key[\s\S]*setSettledKey\(key\)[\s\S]*dismissBootSplash\(\)/.test(app), 'boot splash is not tied to fresh content plus a committed route');
check(/requestAnimationFrame\([\s\S]*requestAnimationFrame/.test(boot), 'splash does not wait for a painted route frame');
check(/transitionend/.test(boot) && /safety/.test(boot), 'splash cleanup is not transition-driven and fail-safe');
check(/new MutationObserver\(look\)/.test(layout) && !/tries\+\+ < 60/.test(layout), 'slow lazy heroes can outlive navbar detection');

check(!fs.existsSync(path.join(ROOT, 'src/routes.js')), 'legacy route-prefetch module still exists');
check(!/usePrefetchRoutes|\bprefetch\(|\bisWarm\b/.test(app + fallback), 'custom route warming/cache suppression still exists');
check(!/NAVIGATION_BEAT_MS|finishTimer|readable loading-screen beat/.test(app), 'an artificial navigation loading duration still exists');
check(/useLoadingGate\(waiting,\s*\{\s*minVisible:\s*0\s*\}\)/.test(app), 'navigation loading is not adaptively delayed or does not stop immediately');
check(/loaderVisible\s*=\s*waiting\s*&&\s*loaderState\s*===\s*'visible'/.test(app), 'loader visibility is not derived from real pending work');
check((app.match(/loaderVisible && <RouteFallback/g) || []).length === 2, 'public and admin waits do not share the smart loading gate');
check(/useLayoutEffect\(\(\) => \{[\s\S]*reload\(\)[\s\S]*setFreshKey\(routeKey\)/.test(app), 'route changes do not revalidate content before mounting the destination');
check((app.match(/contentIsFresh &&/g) || []).length === 2, 'a destination can mount against stale content');
check(/key !== activeKey\.current/.test(app), 'stale route work can dismiss a newer navigation screen');
check(/<main\s+[\s\S]{0,160}key=/.test(app) && /useTransitions=\{false\}/.test(app) && !/<mo\.main|AnimatePresence/.test(app), 'page transitions still cross-fade or retain an outgoing page layer');
check((app.match(/<Suspense fallback=\{null\}>/g) || []).length === 2, 'route Suspense can stack a second loading screen over the smart gate');
check(/fetch\('\/api\/content',\s*\{\s*cache:\s*'no-store'\s*\}\)/.test(content), 'content refresh can reuse an HTTP-cached response');
check(!/cacheRead|cacheWrite|CACHE_TTL/.test(content), 'persistent stale content cache still exists');
check(/localStorage\.removeItem\(LEGACY_CONTENT_CACHE_KEY\)/.test(content), 'legacy stale browser snapshots are not removed');
check(/app\.get\('\/api\/content'[\s\S]*Cache-Control', 'private, no-store, max-age=0'/.test(server), 'content API responses can still be stored by browsers or intermediaries');
check(/fa:\s*\{/.test(fallback) && /en:\s*\{/.test(fallback) && /ar:\s*\{/.test(fallback), 'route loading accessibility copy is not trilingual');
check(/role="status"[\s\S]*aria-live="polite"[\s\S]*aria-busy="true"/.test(fallback), 'route loader is not announced accessibly');
check(/aria-hidden=\{loaderVisible[\s\S]*inert=\{loaderVisible/.test(app), 'covered destination content remains exposed during navigation');
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
check(/minVisible = MIN_VISIBLE/.test(gate) && /held >= minVisible/.test(gate), 'navigation cannot opt out of an artificial post-load hold');
check(/useLoadingGate\(true\)/.test(pagePending), 'post-route data loading is not adaptively gated');
check((dataPages.match(/<PagePending/g) || []).length >= 4, 'shop page data transitions still fall back to bare ellipses');

for (const leak of leaks) console.log(`LEAK ${leak}`);
console.log(`${passed}/${total}`);
