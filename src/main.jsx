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
import { localeFromPath } from './i18n/LocaleContext';

/* The English / Arabic dictionaries are separate chunks; the Persian site
   never downloads them. Wait for the active one before the first render so
   the page never flashes Persian on the way to another language. */
loadPack(localeFromPath(window.location.pathname)).finally(() => {
  /* Remove the inline boot splash as soon as React takes over the DOM. */
  const splash = document.getElementById('boot-splash');
  if (splash) splash.remove();

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
});
