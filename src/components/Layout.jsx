import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { AnimatePresence, m as mo } from 'framer-motion';
import Logo from './Logo';
import { Icons, socialIcon, hl, faNum, NUM_LOCALE } from './ui';
import { useContent } from '../content/ContentContext';
import { useShop } from '../shop/ShopContext';
import { useLocale } from '../i18n/LocaleContext';
import { activeTrustSeals } from '../../shared/trustSeals.js';
import { DEFAULT_STATE } from '../../shared/contentDefaults.js';
import { localizeState } from '../../shared/i18n/index.js';
import { isStorefrontEnabled } from '../../shared/shopAvailability.js';

export const NAV_LINKS = [
  { to: '/', key: 'nav.home', end: true },
  { to: '/about', key: 'nav.about' },
  { to: '/products', key: 'nav.products' },
  { to: '/shop', key: 'nav.shop', shopOnly: true },
  { to: '/export', key: 'nav.export' },
  { to: '/quality', key: 'nav.quality' },
  { to: '/blog', key: 'nav.blog' },
  { to: '/gallery', key: 'nav.gallery' },
  { to: '/sales-representatives', key: 'nav.salesRepresentatives', faOnly: true },
  { to: '/contact', key: 'nav.contact' },
];

/* Quality is supporting corporate evidence, so it belongs beside the company
   overview. Export remains top-level: international buyers should not have to
   guess that a commercial destination is hidden beneath “About us”. */
const HEADER_NAV_ITEMS = [
  {
    key: 'nav.about',
    children: [
      { to: '/about', key: 'nav.aboutOverview' },
      { to: '/quality', key: 'nav.quality' },
    ],
  },
  { to: '/products', key: 'nav.products' },
  { to: '/shop', key: 'nav.shop', shopOnly: true },
  { to: '/export', key: 'nav.export' },
  { to: '/blog', key: 'nav.blog' },
  { to: '/gallery', key: 'nav.gallery' },
  { to: '/sales-representatives', key: 'nav.salesRepresentatives', faOnly: true },
];

/* ---------------------------------------------------------------------------
   Language switcher — a native-name dropdown in the desktop utility bar and
   the existing segmented control in the mobile menu. Switching is a full
   navigation to the other locale's URL.
   --------------------------------------------------------------------------- */
const LANGUAGE_GROUP_LABEL = {
  fa: 'انتخاب زبان',
  en: 'Language selection',
  ar: 'اختيار اللغة',
  ru: 'Выбор языка',
};

const CHANGE_LANGUAGE_LABEL = {
  fa: (current) => `تغییر زبان؛ زبان فعلی: ${current}`,
  en: (current) => `Change language; current language: ${current}`,
  ar: (current) => `تغيير اللغة؛ اللغة الحالية: ${current}`,
  ru: (current) => `Сменить язык; текущий язык: ${current}`,
};

function LangSwitch({ block = false, open: controlledOpen, onOpenChange }) {
  const { locale, locales, switchLocale } = useLocale();
  const [localOpen, setLocalOpen] = useState(false);
  const open = typeof controlledOpen === 'boolean' ? controlledOpen : localOpen;
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const current = locales.find((item) => item.code === locale) || locales[0];
  const groupLabel = LANGUAGE_GROUP_LABEL[locale] || LANGUAGE_GROUP_LABEL.en;
  const setExpanded = useCallback((next) => {
    if (typeof controlledOpen !== 'boolean') setLocalOpen(next);
    onOpenChange?.(next);
  }, [controlledOpen, onOpenChange]);

  useEffect(() => {
    if (block || !open) return undefined;

    const closeOnOutsidePointer = (event) => {
      if (rootRef.current?.contains(event.target)) return;
      setExpanded(false);
    };
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setExpanded(false);
      triggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [block, open, setExpanded]);

  if (block) {
    return (
      <div className="lang-switch lang-switch--block" role="group" aria-label={groupLabel}>
        {locales.map((lo) => (
          <button
            key={lo.code}
            type="button"
            className={`lang-switch__btn ${lo.code === locale ? 'is-active' : ''}`}
            onClick={() => switchLocale(lo.code)}
            aria-current={lo.code === locale ? 'true' : undefined}
            title={lo.label}
          >
            <span className="lang-switch__short">{lo.short}</span>
            <span className="lang-switch__label">{lo.label}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={`lang-switch lang-switch--desktop ${open ? 'is-open' : ''}`}
      role="group"
      aria-label={groupLabel}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="lang-switch__trigger"
        aria-label={(CHANGE_LANGUAGE_LABEL[locale] || CHANGE_LANGUAGE_LABEL.en)(current.label)}
        aria-expanded={open}
        aria-controls="desktop-language-options"
        onClick={() => setExpanded(!open)}
      >
        <Icons.globe size={16} aria-hidden="true" />
        <span className="lang-switch__current" lang={current.htmlLang} dir={current.dir}>{current.label}</span>
        <Icons.chevron size={14} className="lang-switch__trigger-chevron" aria-hidden="true" />
      </button>

      <div
        id="desktop-language-options"
        className="lang-switch__menu"
        role="group"
        aria-label={groupLabel}
        hidden={!open}
      >
        {locales.map((lo) => (
          <button
            key={lo.code}
            type="button"
            className={`lang-switch__option ${lo.code === locale ? 'is-active' : ''}`}
            onClick={() => {
              setExpanded(false);
              switchLocale(lo.code);
            }}
            aria-current={lo.code === locale ? 'true' : undefined}
          >
            <span className="lang-switch__option-name" lang={lo.htmlLang} dir={lo.dir}>{lo.label}</span>
            <span className="lang-switch__option-code" aria-hidden="true">{lo.short}</span>
            {lo.code === locale && <Icons.check className="lang-switch__option-check" size={16} aria-hidden="true" />}
          </button>
        ))}
      </div>
    </div>
  );
}

/* Dark mode: the crimson accent stays, the white canvas becomes near-black. */
const THEME_ACTION = {
  fa: { light: 'تغییر به نمای روشن', dark: 'تغییر به نمای تاریک' },
  en: { light: 'Switch to light mode', dark: 'Switch to dark mode' },
  ar: { light: 'التبديل إلى الوضع الفاتح', dark: 'التبديل إلى الوضع الداكن' },
  ru: { light: 'Переключить на светлую тему', dark: 'Переключить на тёмную тему' },
};

const mobileMenuFocusable = (menu) => menu
  ? Array.from(menu.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]'))
    .filter((element) => element.tabIndex >= 0 && !element.closest('[hidden], [aria-hidden="true"]'))
  : [];

function ThemeToggle() {
  const { locale, isDark, toggleTheme } = useLocale();
  const label = THEME_ACTION[locale]?.[isDark ? 'light' : 'dark'] || THEME_ACTION.en[isDark ? 'light' : 'dark'];
  return (
    <button
      type="button"
      className={`theme-toggle ${isDark ? 'is-dark' : ''}`}
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      aria-pressed={isDark}
    >
      <span className="theme-toggle__track">
        <span className="theme-toggle__thumb">{isDark ? <Icons.moon size={13} /> : <Icons.sun size={13} />}</span>
      </span>
    </button>
  );
}

function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [mobileAboutOpen, setMobileAboutOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const aboutTriggerRef = useRef(null);
  const mobileMenuRef = useRef(null);
  const burgerRef = useRef(null);
  const menuWasOpen = useRef(false);
  const location = useLocation();
  const { t, l, col } = useContent();
  const { count, display } = useShop() || { count: 0, display: {} };
  const { shopEnabled, isRTL, locale } = useLocale();
  const storefrontEnabled = isStorefrontEnabled(shopEnabled, display);
  const navItems = HEADER_NAV_ITEMS.filter((item) =>
    (!item.shopOnly || storefrontEnabled) && (!item.faOnly || locale === 'fa')
  );
  const aboutIsActive = ['/about', '/quality'].some(
    (path) => location.pathname === path || location.pathname.startsWith(`${path}/`),
  );
  const menuOffset = isRTL ? 28 : -28;

  /* The scroll listener fires dozens of times a second, but the navbar only
     has two states. Read the scroll position inside rAF (so it is never a
     forced synchronous layout mid-scroll) and only call setState when the
     boolean actually flips — otherwise every scroll event re-rendered the
     whole navbar, its links, socials and cart badge. */
  useEffect(() => {
    let frame = 0;
    let last = window.scrollY > 40;
    setScrolled(last);

    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const next = window.scrollY > 40;
        if (next !== last) {
          last = next;
          setScrolled(next);
          if (next) setLanguageOpen(false);
        }
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  /* The transparent navbar only works over a dark hero. On a page that has
     none — a shop product, the cart, checkout, an order — white links sat on
     a white page and the header was simply invisible in light mode. So the
     bar is solid whenever there is no hero behind it, not merely when the
     visitor has scrolled.

     The hero belongs to a lazily-loaded route chunk, so it is not in the DOM
     on the first frame after a navigation. Start from "no hero" (solid, i.e.
     always legible, never the broken state), then observe the route subtree.
     Unlike a fixed one-second polling window, this still catches a hero that
     arrives after a genuinely slow chunk. */
  const [hasHero, setHasHero] = useState(false);
  useEffect(() => {
    setHasHero(false);
    let observer;

    const look = () => {
      if (!document.querySelector('.hero, .page-hero, .shop-showcase')) return false;
      setHasHero(true);
      observer?.disconnect();
      return true;
    };

    if (!look()) {
      observer = new MutationObserver(look);
      observer.observe(document.getElementById('root') || document.body, { childList: true, subtree: true });
      look();
    }
    return () => observer?.disconnect();
  }, [location.pathname]);

  useEffect(() => {
    setOpen(false);
    setAboutOpen(false);
    setMobileAboutOpen(false);
    setLanguageOpen(false);
  }, [location.pathname]);

  /* The drawer and the desktop navigation swap at the same CSS breakpoint.
     Close an open drawer as soon as a resize or orientation change crosses
     that boundary; otherwise its fixed overlay and body scroll lock can
     survive after the desktop header has appeared. */
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1101px)');
    const desktopUtilities = window.matchMedia('(min-width: 901px)');
    const closeDrawerOnDesktop = (event) => {
      if (!event.matches) return;
      setOpen(false);
      setMobileAboutOpen(false);
    };
    const closeLanguageOnMobile = (event) => {
      if (!event.matches) setLanguageOpen(false);
    };
    desktop.addEventListener('change', closeDrawerOnDesktop);
    desktopUtilities.addEventListener('change', closeLanguageOnMobile);
    closeDrawerOnDesktop(desktop);
    closeLanguageOnMobile(desktopUtilities);
    return () => {
      desktop.removeEventListener('change', closeDrawerOnDesktop);
      desktopUtilities.removeEventListener('change', closeLanguageOnMobile);
    };
  }, []);

  /* Re-open the corporate section when the drawer is launched from one of its
     child routes. Everywhere else it starts collapsed, keeping the top-level
     information architecture easy to scan. */
  useEffect(() => {
    setMobileAboutOpen(open && aboutIsActive);
  }, [open, aboutIsActive]);

  useEffect(() => {
    if (!aboutOpen) return undefined;
    const closeDesktopAbout = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setAboutOpen(false);
      aboutTriggerRef.current?.focus();
    };
    window.addEventListener('keydown', closeDesktopAbout);
    return () => window.removeEventListener('keydown', closeDesktopAbout);
  }, [aboutOpen]);

  const trapMobileMenuFocus = (event) => {
    if (event.key !== 'Tab') return;
    const items = mobileMenuFocusable(mobileMenuRef.current);
    if (!items.length) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    const inside = mobileMenuRef.current?.contains(active);
    if (event.shiftKey && (!inside || active === first)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (!inside || active === last)) {
      event.preventDefault();
      first.focus();
    }
  };

  /* Apply the modal page state before the browser paints the opened menu.
     Focus stays within the drawer while it is open and returns to the trigger
     when it closes, including when a link changes routes. */
  useLayoutEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    document.body.classList.toggle('is-mobile-menu-open', open);
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    if (open) {
      mobileMenuFocusable(mobileMenuRef.current)[0]?.focus();
      window.addEventListener('keydown', closeOnEscape);
    } else if (menuWasOpen.current) {
      burgerRef.current?.focus();
    }
    menuWasOpen.current = open;
    return () => {
      document.body.style.overflow = '';
      document.body.classList.remove('is-mobile-menu-open');
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const socials = col('socials');

  return (
    <>
      <nav
        className={`nav ${scrolled || !hasHero ? 'is-scrolled' : ''} ${!hasHero && !scrolled ? 'is-solid-at-top' : ''} ${open ? 'is-menu-open' : ''} ${languageOpen && !scrolled ? 'is-language-open' : ''}`.trim()}
        aria-label={t('nav.main')}
      >
        <div className="nav__topbar">
          <div className="container nav__topbar-inner">
            <div className="nav__topbar-socials">
              {socials.map((s) => {
                const Ic = socialIcon(s.id);
                return (
                  <a key={s.id} href={s.href} target="_blank" rel="noreferrer" aria-label={s.label}>
                    <Ic size={15} />
                    <span>{s.label}</span>
                  </a>
                );
              })}
            </div>
            <div className="nav__topbar-tools">
              <a className="nav__topbar-email" href={`mailto:${t('global.email')}`}>
                <Icons.mail size={15} />
                {t('global.email')}
              </a>
              <a className="nav__topbar-phone" href={l('sales.tel')}>
                <Icons.phone size={15} />
                <bdi dir="ltr">{t('global.sales.phone.fa')}</bdi>
              </a>
              <LangSwitch open={languageOpen} onOpenChange={setLanguageOpen} />
              <ThemeToggle />
            </div>
          </div>
        </div>

        <div className="container nav__bar">
          <Link to="/" className="nav__logo" aria-label={t('global.company.name')}>
            <Logo variant="solid" />
            <span className="nav__logo-text">
              <strong>{t('global.company.short')}</strong>{' '}
              <small dir="ltr">{t('global.company.en')}</small>
            </span>
          </Link>

          <div className="nav__links">
            {navItems.map((item) => {
              if (item.children) {
                return (
                  <div
                    className="nav__group"
                    key={item.key}
                    onBlurCapture={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget)) setAboutOpen(false);
                    }}
                  >
                    <button
                      ref={aboutTriggerRef}
                      type="button"
                      className={`nav__link nav__link--trigger ${aboutIsActive ? 'active' : ''}`}
                      aria-expanded={aboutOpen}
                      aria-controls="about-navigation"
                      onClick={() => setAboutOpen((value) => !value)}
                    >
                      <span>{t(item.key)}</span>
                      <Icons.chevron size={15} className={aboutOpen ? 'is-open' : ''} aria-hidden="true" />
                    </button>
                    <div
                      id="about-navigation"
                      className="nav__dropdown"
                      role="group"
                      aria-label={t(item.key)}
                      hidden={!aboutOpen}
                    >
                      {item.children.map((child) => (
                        <NavLink
                          key={child.to}
                          to={child.to}
                          end
                          className={({ isActive }) => `nav__dropdown-link ${isActive ? 'active' : ''}`}
                          onClick={() => setAboutOpen(false)}
                        >
                          {t(child.key)}
                          <Icons.arrow size={15} />
                        </NavLink>
                      ))}
                    </div>
                  </div>
                );
              }
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `nav__link ${isActive ? 'active' : ''}`}
                >
                  {t(item.key)}
                </NavLink>
              );
            })}
          </div>

          {/* One cluster, so the bar is three regions — logo, links, actions
              — instead of five siblings sharing one gap. The icon buttons
              sit tighter to each other than to the call to action, which is
              what makes them read as a pair rather than as clutter. */}
          <div className="nav__actions">
            {storefrontEnabled && (
              <div className="nav__icons">
                <Link to="/shop/cart" className="nav__icon nav__cart" aria-label={t('shop.cart.title')}>
                  <Icons.cart size={19} />
                  {count > 0 && <span className="nav__cart-badge">{faNum(count)}</span>}
                </Link>

                {/* One destination either way: the panel bounces a signed-out
                    visitor to the login page, so the header does not have to
                    know the session state to render the right link. The whole
                    icon cluster leaves the layout when the shop is disabled. */}
                <Link to="/shop/account" className="nav__icon nav__account" aria-label={t('shop.account.title')}>
                  <Icons.users size={19} />
                </Link>
              </div>
            )}

            <Link to="/contact" className="btn btn--primary btn--sm nav__cta">
              {t('nav.contact')}
            </Link>

            <button
              ref={burgerRef}
              className={`nav__burger ${open ? 'is-open' : ''}`}
              onClick={() => {
                setAboutOpen(false);
                setOpen((value) => !value);
              }}
              aria-label={t(open ? 'nav.close' : 'nav.menu')}
              aria-expanded={open}
              aria-controls="mobile-navigation"
            >
              <span />
              <span />
              <span />
            </button>
          </div>
        </div>
      </nav>

      <AnimatePresence>
        {open && (
          <mo.nav
            ref={mobileMenuRef}
            id="mobile-navigation"
            className="mobile-menu"
            onKeyDown={trapMobileMenuFocus}
            aria-label={t('nav.mobile')}
            initial={{ opacity: 0, x: menuOffset }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: menuOffset }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            {navItems.map((item, i) => {
              const motionProps = {
                initial: { opacity: 0, x: menuOffset * 0.35 },
                animate: { opacity: 1, x: 0 },
                transition: { delay: 0.025 + Math.min(i, 4) * 0.018, duration: 0.2 },
              };
              if (item.children) {
                return (
                  <mo.div key={item.key} className="m-nav-group" {...motionProps}>
                    <button
                      type="button"
                      className={`m-link m-link--group ${aboutIsActive ? 'active' : ''}`}
                      aria-expanded={mobileAboutOpen}
                      aria-controls="mobile-about-navigation"
                      onClick={() => setMobileAboutOpen((value) => !value)}
                    >
                      {t(item.key)}
                      <Icons.chevron size={20} className={mobileAboutOpen ? 'is-open' : ''} aria-hidden="true" />
                    </button>
                    <AnimatePresence initial={false}>
                      {mobileAboutOpen && (
                        <mo.div
                          id="mobile-about-navigation"
                          className="m-submenu"
                          role="group"
                          aria-label={t(item.key)}
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                        >
                          <div className="m-submenu__inner">
                            {item.children.map((child) => (
                              <NavLink
                                key={child.to}
                                to={child.to}
                                end
                                className={({ isActive }) => `m-sublink ${isActive ? 'active' : ''}`}
                              >
                                {t(child.key)}
                                <Icons.arrow size={17} />
                              </NavLink>
                            ))}
                          </div>
                        </mo.div>
                      )}
                    </AnimatePresence>
                  </mo.div>
                );
              }
              return (
                <mo.div key={item.to} {...motionProps}>
                  <NavLink to={item.to} end={item.end} className={({ isActive }) => `m-link ${isActive ? 'active' : ''}`}>
                    {t(item.key)}
                    <Icons.arrow size={20} />
                  </NavLink>
                </mo.div>
              );
            })}
            <mo.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.08, duration: 0.18 }}
              className="m-controls"
            >
              <LangSwitch block />
              <Link to="/contact" className="btn btn--primary m-contact-cta">
                <Icons.mail size={15} aria-hidden="true" />
                <span>{t('nav.contact')}</span>
              </Link>
              <ThemeToggle />
            </mo.div>
          </mo.nav>
        )}
      </AnimatePresence>
    </>
  );
}

function BackToTop() {
  const { locale } = useLocale();
  const [show, setShow] = useState(false);
  const label = {
    fa: 'بازگشت به بالا',
    en: 'Back to top',
    ar: 'العودة إلى الأعلى',
    ru: 'Наверх',
  }[locale];
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 600);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <AnimatePresence>
      {show && (
        <mo.button
          className="to-top"
          initial={{ opacity: 0, y: 24, scale: 0.8 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.8 }}
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label={label}
        >
          <Icons.arrow size={20} style={{ transform: 'rotate(90deg)' }} />
        </mo.button>
      )}
    </AnimatePresence>
  );
}

function TrustSealLink({ seal }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [seal.image]);

  return (
    <a
      className="footer__trust-link"
      href={seal.href}
      target="_blank"
      rel="noopener nofollow"
      referrerPolicy="origin"
      title={seal.label}
    >
      {failed ? (
        <span className="footer__trust-fallback">
          <Icons.shield size={25} />
          <small>{seal.label}</small>
        </span>
      ) : (
        <img
          id={seal.imageId || undefined}
          src={seal.image}
          alt={seal.label}
          title={seal.label}
          width="75"
          height="75"
          loading="lazy"
          decoding="async"
          referrerPolicy="origin"
          onError={() => setFailed(true)}
        />
      )}
    </a>
  );
}

function Footer() {
  const { t, l, col, brands, state } = useContent();
  const { shopEnabled, locale } = useLocale();
  const storefrontEnabled = isStorefrontEnabled(shopEnabled, state.shop?.display);
  const socials = col('socials');
  const offices = col('offices');
  const defaultOffices = localizeState(DEFAULT_STATE, locale)?.collections?.offices ?? [];
  const secondPlant = offices.find((office) => office.id === 'kermanshah')
    || defaultOffices.find((office) => office.id === 'kermanshah');
  const SecondPlantIcon = Icons[secondPlant?.icon] || Icons.factory;
  const trustSeals = activeTrustSeals(col('trustSeals'));
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__grid">
          <div>
            <Link to="/" className="nav__logo" style={{ marginBottom: 8 }}>
              <Logo size={44} variant="solid" />
              <span className="nav__logo-text">
                <strong style={{ color: '#fff' }}>{t('global.company.short')}</strong>{' '}
                <small dir="ltr">{t('global.company.en')}</small>
              </span>
            </Link>
            <p className="footer__slogan">«{t('global.slogan')}»</p>
            <p>{t('footer.about')}</p>
            <div className="footer__socials">
              {socials.map((s) => {
                const Ic = socialIcon(s.id);
                return (
                  <a key={s.id} href={s.href} target="_blank" rel="noreferrer" aria-label={s.label}>
                    <Ic size={19} />
                  </a>
                );
              })}
            </div>
          </div>

          <div>
            <h2>{t('footer.quickTitle')}</h2>
            <ul>
              {NAV_LINKS.filter((link) =>
                link.to !== '/' && (!link.shopOnly || storefrontEnabled) && (!link.faOnly || locale === 'fa')
              ).map((link) => (
                <li key={link.to}>
                  <Link to={link.to}>
                    <Icons.arrow size={14} />
                    {t(link.key)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2>{t('footer.brandsTitle')}</h2>
            <ul>
              {brands.map((b) => (
                <li key={b.id}>
                  <Link to={`/products?brand=${b.id}`}>
                    <Icons.wheat size={14} />
                    {b.fa}{locale === 'en' ? '' : ` (${b.en})`}
                  </Link>
                </li>
              ))}
              <li>
                <Link to="/products">
                  <Icons.pack size={14} />
                  {t('footer.allProducts')}
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h2>{t('footer.contactTitle')}</h2>
            <ul>
              <li>
                <a href={`mailto:${t('global.email')}`}>
                  <Icons.mail size={15} />
                  {t('global.email')}
                </a>
              </li>
              <li>
                <a href={l('sales.tel')}>
                  <Icons.phone size={15} />
                  <span>{t('footer.sales')} <bdi dir="ltr">{t('global.sales.phone.fa')}</bdi></span>
                </a>
              </li>
              <li style={{ lineHeight: 1.9 }}>
                <Icons.pin size={15} style={{ display: 'inline-block', verticalAlign: 'middle', marginInlineEnd: 8 }} />
                {t('footer.address1')}
              </li>
              <li style={{ lineHeight: 1.9 }}>
                <Icons.factory size={15} style={{ display: 'inline-block', verticalAlign: 'middle', marginInlineEnd: 8 }} />
                {t('footer.address2')}
              </li>
              {secondPlant && (
                <li style={{ lineHeight: 1.9 }}>
                  <SecondPlantIcon size={15} style={{ display: 'inline-block', verticalAlign: 'middle', marginInlineEnd: 8 }} />
                  <span>{secondPlant.address}</span>
                </li>
              )}
            </ul>
          </div>
        </div>

        {trustSeals.length > 0 && (
          <section className="footer__trust" aria-labelledby="footer-trust-title">
            <div className="footer__trust-heading">
              <h2 id="footer-trust-title">{t('footer.trustTitle')}</h2>
              <span aria-hidden="true">{trustSeals.length.toLocaleString(NUM_LOCALE[locale] || 'fa-IR')}</span>
            </div>
            <div className="footer__trust-list">
              {trustSeals.map((seal) => <TrustSealLink seal={seal} key={seal.id} />)}
            </div>
          </section>
        )}

        <div className="footer__bottom">
          <span>
            © {new Date().getFullYear().toLocaleString(NUM_LOCALE[locale] || 'fa-IR', { useGrouping: false })}{' '}
            {t('footer.copy')}
          </span>
          <span>{t('global.slogan.en')}</span>
        </div>
      </div>
    </footer>
  );
}

export default function Layout({ children }) {
  const { pathname } = useLocation();
  const { locale } = useLocale();
  const skipLabel = {
    fa: 'پرش به محتوای اصلی',
    en: 'Skip to main content',
    ar: 'تخطّي إلى المحتوى الرئيسي',
    ru: 'Перейти к основному содержимому',
  }[locale] || 'Skip to main content';

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname]);

  return (
    <>
      <a className="skip-link" href="#main-content">{skipLabel}</a>
      <Navbar />
      {children}
      <Footer />
      <BackToTop />
    </>
  );
}
