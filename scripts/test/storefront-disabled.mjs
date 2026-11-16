/* M10 regression: pausing the storefront must hide purchase/navigation
   controls without taking public catalogue product details offline. Render the
   real page component in a MemoryRouter so this check does not depend on the
   route-one harness's browser globals. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LazyMotion, MotionConfig, domAnimation } from 'framer-motion';
import { parseHTML } from 'linkedom';
import { createServer } from 'vite';
import { isStorefrontEnabled } from '../../shared/shopAvailability.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let pass = 0;
let fail = 0;
const check = (ok, name, detail = '') => {
  if (ok) pass += 1;
  else {
    fail += 1;
    console.log(`LEAK ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

check(!isStorefrontEnabled(true, { enabled: false }), 'an operator-disabled storefront is unavailable');
check(isStorefrontEnabled(true, { enabled: true }), 'an enabled Persian storefront remains available');
check(!isStorefrontEnabled(false, { enabled: true }), 'the storefront remains locale-gated');
const appSource = fs.readFileSync(path.join(ROOT, 'src/App.jsx'), 'utf8');
check(
  appSource.includes('{shopEnabled && (') &&
    appSource.includes('<Route path="/shop/order/:code"') &&
    appSource.includes('<Route path="/shop/login"') &&
    appSource.includes('<Route path="/shop/account"'),
  'existing order history, login and account routes stay available while sales are paused',
);

const vite = await createServer({
  root: ROOT,
  configFile: path.join(ROOT, 'vite.config.js'),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

try {
  const [defaults, content, locale, shop, layout, detail] = await Promise.all([
    vite.ssrLoadModule('/shared/contentDefaults.js'),
    vite.ssrLoadModule('/src/content/ContentContext.jsx'),
    vite.ssrLoadModule('/src/i18n/LocaleContext.jsx'),
    vite.ssrLoadModule('/src/shop/ShopContext.jsx'),
    vite.ssrLoadModule('/src/components/Layout.jsx'),
    vite.ssrLoadModule('/src/pages/ProductDetail.jsx'),
  ]);
  const state = defaults.default;
  const product = state.products.find((item) => item.slug === 'dezmaye-gold-80');
  const renderPage = (enabled) => {
    state.shop.display.enabled = enabled;
    const app = React.createElement(
      locale.LocaleProvider,
      null,
      React.createElement(
        content.ContentProvider,
        null,
        React.createElement(
          shop.ShopProvider,
          null,
          React.createElement(
            LazyMotion,
            { features: domAnimation, strict: true },
            React.createElement(
              MotionConfig,
              { reducedMotion: 'user' },
              React.createElement(
                MemoryRouter,
                { initialEntries: ['/products/dezmaye-gold-80'] },
                React.createElement(
                  Routes,
                  null,
                  React.createElement(Route, {
                    path: '/products/:slug',
                    element: React.createElement(
                      layout.default,
                      null,
                      React.createElement(detail.default),
                    ),
                  }),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    const markup = renderToStaticMarkup(app);
    return parseHTML(`<!doctype html><html><body>${markup}</body></html>`).document;
  };

  const disabled = renderPage(false);
  const title = disabled.querySelector('.catalog-detail__title')?.textContent.trim() || '';
  check(Boolean(product) && title === product.title, 'catalogue product details still render when shopping is paused', title);
  check(
    Boolean(disabled.querySelector('.catalog-detail__spec tbody tr')),
    'catalogue specifications remain available when shopping is paused',
  );
  check(
    !disabled.querySelector('.catalog-detail__actions a[href^="/shop"]'),
    'the product purchase CTA is hidden while the storefront is disabled',
  );
  check(
    !disabled.querySelector('.nav__account') && !disabled.querySelector('.nav__cart'),
    'header account and cart controls are hidden while the storefront is disabled',
  );
  check(
    !disabled.querySelector('.nav a[href="/shop"]') && !disabled.querySelector('.footer a[href="/shop"]'),
    'disabled storefront links are removed from header and footer navigation',
  );

  const enabled = renderPage(true);
  const buy = enabled.querySelector('.catalog-detail__actions a[href^="/shop"]');
  check(Boolean(buy), 'enabling the storefront restores the catalogue purchase CTA');
  check(
    buy?.getAttribute('href') === '/shop/dezmaye-gold-80',
    'the enabled CTA retains the Admin-selected shop-product relationship',
    buy?.getAttribute('href') || '',
  );
} finally {
  await vite.close();
}

console.log(`${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
