import React from 'react';
import { LazyMotion, MotionConfig, domAnimation } from 'framer-motion';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/vazirmatn';
import './styles/fonts.scss';
import './styles/global.scss';
import './styles/shop.scss';
import './styles/inner-pages.scss';
import App from './App';
import { ContentProvider } from './content/ContentContext';
import { ShopProvider } from './shop/ShopContext';
import { AccountProvider } from './shop/AccountContext';
import { LocaleProvider } from './i18n/LocaleContext';
import { loadPack } from '../shared/i18n/index.js';
import { localeFromPath } from './i18n/LocaleContext';

/* The English / Arabic dictionaries are separate chunks; the Persian site
   never downloads them. Wait for the active one before the first render so
   the page never flashes Persian on the way to another language. The inline
   splash is dismissed by the readiness coordinator in App.jsx only after fresh
   content is loaded and the active route — including a lazy chunk — has
   actually rendered. */
loadPack(localeFromPath(window.location.pathname)).finally(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      {/* reducedMotion="user" makes framer-motion honour the OS setting.
          The CSS @media rule cannot do this on its own: motion components
          animate through the Web Animations API from JS, where a CSS
          !important override has no effect. */}
      {/* LazyMotion + the `m` component ship only the animation features this
          site uses. The full `motion` component bundles every feature it
          *could* need — drag, layout projection, pan, SVG path morphing — and
          none of it is tree-shakeable, because `motion.div` is a proxy that
          resolves at runtime. `strict` turns any stray `motion.*` into a
          build-time-visible error instead of silently restoring the weight. */}
      <LazyMotion features={domAnimation} strict>
        <MotionConfig reducedMotion="user">
          <LocaleProvider>
            <ContentProvider>
              <AccountProvider>
                <ShopProvider>
                <App />
              </ShopProvider>
              </AccountProvider>
            </ContentProvider>
          </LocaleProvider>
        </MotionConfig>
      </LazyMotion>
    </React.StrictMode>
  );
});
