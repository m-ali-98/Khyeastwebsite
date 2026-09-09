import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/vazirmatn';
import '@fontsource-variable/inter';
import './styles/global.scss';
import './styles/shop.scss';
import App from './App';
import { ContentProvider } from './content/ContentContext';
import { ShopProvider } from './shop/ShopContext';
import { LocaleProvider } from './i18n/LocaleContext';
import { loadPack } from '../shared/i18n/index.js';
import { detectTier, applyTier, currentTier } from './lib/motion';
import { localeFromPath } from './i18n/LocaleContext';

/* The English / Arabic dictionaries are separate chunks; the Persian site
   never downloads them. Wait for the active one before the first render so
   the page never flashes Persian on the way to another language. */
/* Fade the inline splash out rather than yanking it, and only once the first
   real frame is on screen — removing it the instant render() returns can
   expose an unpainted page for a frame on a slow device. */
function dismissSplash() {
  const splash = document.getElementById('boot-splash');
  if (!splash) return;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      splash.classList.add('is-done');
      /* match the CSS transition; remove() rather than display:none so the
         element stops costing anything at all */
      setTimeout(() => splash.remove(), 260);
    });
  });
}

/* The inline script in index.html already set data-motion before first paint.
   Re-assert it here so the two implementations can never drift apart, and so
   the attribute is still correct if that script was stripped by a proxy. */
if (!document.documentElement.getAttribute('data-motion')) applyTier(detectTier());

loadPack(localeFromPath(window.location.pathname)).finally(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <LocaleProvider>
        <ContentProvider>
          <ShopProvider>
            <App />
          </ShopProvider>
        </ContentProvider>
      </LocaleProvider>
    </React.StrictMode>
  );

  dismissSplash();
});
