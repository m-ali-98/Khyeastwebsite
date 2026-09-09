/* ==========================================================================
   Locale + theme runtime.
   --------------------------------------------------------------------------
   URL scheme (decided with the client):
     /            → Persian  (no prefix — every legacy URL keeps working)
     /en/…        → English
     /ar/…        → Arabic

   The prefix is handled by React Router's `basename`, so every existing
   <Link to="/products"> inside the pages resolves to /en/products on the
   English site without touching a single page component.
   ========================================================================== */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_LOCALE, LOCALES, LOCALE_CODES, getLocaleMeta, shopEnabled } from '../../shared/i18n/index.js';

const Ctx = createContext(null);

export { LOCALES, LOCALE_CODES, DEFAULT_LOCALE };

const STORE_KEY = 'ky_locale';
const THEME_KEY = 'ky_theme';

/** Read the locale out of a raw pathname (`/en/products` → `en`). */
export function localeFromPath(pathname = '/') {
  const seg = pathname.split('/')[1];
  return LOCALE_CODES.includes(seg) && seg !== DEFAULT_LOCALE ? seg : DEFAULT_LOCALE;
}

/** Strip the locale prefix off a pathname (`/en/products` → `/products`). */
export function stripLocale(pathname = '/') {
  const loc = localeFromPath(pathname);
  if (loc === DEFAULT_LOCALE) return pathname || '/';
  const rest = pathname.slice(`/${loc}`.length);
  return rest || '/';
}

/** Build an absolute path for a locale (`'en', '/products'` → `/en/products`). */
export function localePath(locale, path = '/') {
  const clean = path.startsWith('/') ? path : `/${path}`;
  if (locale === DEFAULT_LOCALE) return clean;
  return clean === '/' ? `/${locale}` : `/${locale}${clean}`;
}

/* ------------------------------------------------------------------ theme */

const prefersDark = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)')?.matches;

const readTheme = () => {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {}
  return prefersDark() ? 'dark' : 'light';
};

/* --------------------------------------------------------------- provider */

export function LocaleProvider({ children }) {
  const locale = typeof window !== 'undefined' ? localeFromPath(window.location.pathname) : DEFAULT_LOCALE;
  const meta = getLocaleMeta(locale);

  const [theme, setTheme] = useState(() => (typeof window === 'undefined' ? 'light' : readTheme()));

  /* keep <html lang/dir/data-theme> in sync — SCSS keys the dark palette off
     [data-theme="dark"] and the RTL/LTR rules off [dir] */
  useEffect(() => {
    const el = document.documentElement;
    el.lang = meta.htmlLang;
    el.dir = meta.dir;
    el.setAttribute('data-locale', locale);
  }, [locale, meta.htmlLang, meta.dir]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {}
  }, [theme]);

  const toggleTheme = useCallback(() => setTheme((v) => (v === 'dark' ? 'light' : 'dark')), []);

  /* Switching language is a real navigation: the whole app (including the
     content overlay, direction and fonts) is rebuilt for the new locale. */
  const switchLocale = useCallback(
    (next) => {
      if (next === locale) return;
      try {
        localStorage.setItem(STORE_KEY, next);
      } catch {}
      const rest = stripLocale(window.location.pathname);
      /* the shop only exists on the Persian site — land on the home page
         instead of a 404 when leaving Persian from a shop URL */
      const target = !shopEnabled(next) && rest.startsWith('/shop') ? '/' : rest;
      window.location.assign(localePath(next, target) + window.location.search + window.location.hash);
    },
    [locale]
  );

  const value = useMemo(
    () => ({
      locale,
      dir: meta.dir,
      meta,
      locales: LOCALES,
      isRTL: meta.dir === 'rtl',
      shopEnabled: shopEnabled(locale),
      switchLocale,
      theme,
      isDark: theme === 'dark',
      toggleTheme,
      setTheme,
      /** absolute path inside the current locale */
      lp: (path) => localePath(locale, path),
    }),
    [locale, meta, switchLocale, theme, toggleTheme]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useLocale = () => useContext(Ctx) || {
  locale: DEFAULT_LOCALE,
  dir: 'rtl',
  isRTL: true,
  shopEnabled: true,
  locales: LOCALES,
  theme: 'light',
  isDark: false,
  switchLocale: () => {},
  toggleTheme: () => {},
  lp: (p) => p,
};
