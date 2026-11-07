/* ==========================================================================
   Post-build SEO rendering.

   Produces route-specific HTML for Apache/static hosting and protocol files
   from the same resolver used by React and the Node server. The Node server
   renders from live CMS data at request time; these files are the equivalent
   safe fallback for a cPanel deployment that can only serve dist/.
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import DEFAULT_STATE from '../shared/contentDefaults.js';
import { mergeContentState } from '../shared/contentState.js';
import { loadAllPacks } from '../shared/i18n/index.js';
import {
  DEFAULT_SITE_ORIGIN,
  listRoutablePaths,
  normalizeOrigin,
  renderRobots,
  renderSeoDocument,
  renderSitemap,
  resolveSeo,
} from '../shared/seo.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');
const PAGES = path.join(DIST, 'seo-pages');

/* npm builds often run outside the hosting control panel, so load the same
   ignored .env files the server understands. Real environment variables still
   win and no secret is ever copied into dist. */
for (const envPath of [path.join(ROOT, 'server', '.env'), path.join(ROOT, '.env')]) {
  if (!fs.existsSync(envPath)) continue;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (value) process.env[match[1]] = value;
  }
}
const origin = normalizeOrigin(process.env.SEO_ORIGIN || process.env.PUBLIC_ORIGIN || DEFAULT_SITE_ORIGIN);

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  throw new Error('dist/index.html is missing; run Vite before generate-seo.mjs');
}

await loadAllPacks();

/* Build artifacts are immutable and must not capture a production database or
   an Admin-edited snapshot. Runtime Node rendering uses live SQLite; static
   cPanel output is the shipped DEFAULT_STATE fallback. */
const state = mergeContentState(DEFAULT_STATE, {});
/* Keep generation idempotent: after the first pass dist/index.html already
   contains a crawlable root. The preserved empty-root template is the source
   for every later explicit `npm run seo:generate`. */
const preservedTemplate = path.join(PAGES, '_template.html');
const template = fs.readFileSync(
  fs.existsSync(preservedTemplate) ? preservedTemplate : path.join(DIST, 'index.html'),
  'utf8',
);

fs.rmSync(PAGES, { recursive: true, force: true });
fs.mkdirSync(PAGES, { recursive: true });
fs.writeFileSync(path.join(PAGES, '_template.html'), template);

const options = {
  googleVerification: process.env.GOOGLE_SITE_VERIFICATION || '',
  bingVerification: process.env.BING_SITE_VERIFICATION || '',
};
const usedFileNames = new Set();
const fileName = (route) => {
  const base = route === '/' ? 'home-fa' : route.slice(1).replace(/[^a-zA-Z0-9_-]+/g, '--') || 'route';
  let candidate = `${base}.html`;
  /* Unicode/admin-created slugs can collapse to the same filesystem-safe
     name. Keep the familiar filename when unique and add a deterministic
     suffix only on collision so no route silently overwrites another. */
  if (usedFileNames.has(candidate)) {
    const suffix = crypto.createHash('sha256').update(route).digest('hex').slice(0, 10);
    candidate = `${base}--${suffix}.html`;
  }
  usedFileNames.add(candidate);
  return candidate;
};

const manifest = {};
for (const route of listRoutablePaths(state)) {
  const meta = resolveSeo(route, state, origin);
  if (!meta.indexable || meta.status !== 200) continue;
  const rendered = renderSeoDocument(template, meta, options);
  if (route === '/') fs.writeFileSync(path.join(DIST, 'index.html'), rendered);
  const name = fileName(route);
  fs.writeFileSync(path.join(PAGES, name), rendered);
  manifest[route] = name;
}

/* One noindex shell handles account/admin/order routes in static hosting. The
   current URL remains in the address bar and React still mounts the right UI. */
fs.writeFileSync(
  path.join(PAGES, '_private.html'),
  renderSeoDocument(template, resolveSeo('/admin', state, origin), options),
);
fs.writeFileSync(
  path.join(DIST, '404.html'),
  renderSeoDocument(template, resolveSeo('/this-route-does-not-exist', state, origin), options),
);
fs.writeFileSync(path.join(PAGES, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(path.join(DIST, 'robots.txt'), renderRobots(origin));
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), renderSitemap(state, origin));

/* Vite copies public/.htaccess to dist before this script runs. Populate its
   generated block with exact public routes; unknown routes then receive a
   genuine 404 from Apache rather than a soft-404 SPA response. */
const htaccessPath = path.join(DIST, '.htaccess');
if (fs.existsSync(htaccessPath)) {
  const start = '# SEO-PAGES:START';
  const end = '# SEO-PAGES:END';
  let htaccess = fs.readFileSync(htaccessPath, 'utf8');
  if (!htaccess.includes(start) || !htaccess.includes(end)) {
    throw new Error('SEO route markers are missing from public/.htaccess');
  }
  const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rules = Object.entries(manifest)
    .filter(([route]) => route !== '/')
    .sort(([a], [b]) => b.length - a.length)
    .map(([route, name]) => `RewriteRule ^${escapeRegex(route.slice(1))}$ /seo-pages/${name} [L]`)
    .join('\n  ');
  htaccess = htaccess.replace(
    new RegExp(`${start}[\\s\\S]*?${end}`),
    `${start}\n  ${rules}\n  ${end}`,
  );
  fs.writeFileSync(htaccessPath, htaccess);
}

console.log(`[seo] rendered ${Object.keys(manifest).length} public routes for ${origin}`);
