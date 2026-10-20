import { useEffect, useLayoutEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { AnimatePresence, m as mo } from 'framer-motion';
import Logo from './Logo';
import { Icons, socialIcon, hl, faNum, NUM_LOCALE } from './ui';
import { useContent } from '../content/ContentContext';
import { useShop } from '../shop/ShopContext';
import { useLocale } from '../i18n/LocaleContext';
import { activeTrustSeals } from '../../shared/trustSeals.js';

export const NAV_LINKS = [
  { to: '/', key: 'nav.home', end: true },
  { to: '/about', key: 'nav.about' },
  { to: '/products', key: 'nav.products' },
  { to: '/shop', key: 'nav.shop', shopOnly: true },
  { to: '/export', key: 'nav.export' },
  { to: '/quality', key: 'nav.quality' },
  { to: '/blog', key: 'nav.blog' },
  { to: '/contact', key: 'nav.contact' },
];

/* ---------------------------------------------------------------------------
   Language switcher — a compact segmented control in the top bar and inside
   the mobile menu. Switching is a full navigation to the other locale's URL.
   --------------------------------------------------------------------------- */
function LangSwitch({ block = false }) {
  const { locale, locales, switchLocale } = useLocale();
  return (
    <div className={`lang-switch ${block ? 'lang-switch--block' : ''}`} role="group" aria-label="Language">
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

/* Dark mode: the crimson accent stays, the white canvas becomes near-black. */
const THEME_ACTION = {
  fa: { light: 'تغییر به نمای روشن', dark: 'تغییر به نمای تاریک' },
  en: { light: 'Switch to light mode', dark: 'Switch to dark mode' },
  ar: { light: 'التبديل إلى الوضع الفاتح', dark: 'التبديل إلى الوضع الداكن' },
};

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
  const location = useLocation();
  const { t, l, col } = useContent();
  const { count, display } = useShop() || { count: 0, display: {} };
  const { shopEnabled, isRTL } = useLocale();
  const storefrontEnabled = shopEnabled && display.enabled !== false;
  const navLinks = NAV_LINKS.filter((link) => !link.shopOnly || storefrontEnabled);
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

  useEffect(() => setOpen(false), [location.pathname]);

  /* Apply the modal page state before the browser paints the opened menu.
     The shop showcase keeps a large composited image track and several blur
     layers alive; leaving those visible underneath an animating full-screen
     panel made the first mobile menu frame noticeably late on that route.
     The menu background is opaque, so suspending the covered page is visually
     identical and gives the tap response the same budget on every page. */
  useLayoutEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    document.body.classList.toggle('is-mobile-menu-open', open);
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    if (open) window.addEventListener('keydown', closeOnEscape);
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
        className={`nav ${scrolled || !hasHero ? 'is-scrolled' : ''} ${open ? 'is-menu-open' : ''}`.trim()}
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
                {t('global.sales.phone.fa')}
              </a>
              <LangSwitch />
              <ThemeToggle />
            </div>
          </div>
        </div>

        <div className="container nav__bar">
          <Link to="/" className="nav__logo" aria-label={t('global.company.name')}>
            <Logo variant="solid" />
            <span className="nav__logo-text">
              <strong>{t('global.company.short')}</strong>
              <small>{t('global.company.en')}</small>
            </span>
          </Link>

          <div className="nav__links">
            {navLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) => `nav__link ${isActive ? 'active' : ''}`}
              >
                {t(link.key)}
              </NavLink>
            ))}
          </div>

          {/* One cluster, so the bar is three regions — logo, links, actions
              — instead of five siblings sharing one gap. The icon buttons
              sit tighter to each other than to the call to action, which is
              what makes them read as a pair rather than as clutter. */}
          <div className="nav__actions">
            {shopEnabled && (
              <div className="nav__icons">
                {storefrontEnabled && (
                  <Link to="/shop/cart" className="nav__icon nav__cart" aria-label={t('shop.cart.title')}>
                    <Icons.cart size={19} />
                    {count > 0 && <span className="nav__cart-badge">{faNum(count)}</span>}
                  </Link>
                )}

                {/* One destination either way: the panel bounces a signed-out
                    visitor to the login page, so the header does not have to
                    know the session state to render the right link. */}
                <Link to="/shop/account" className="nav__icon nav__account" aria-label={t('shop.account.title')}>
                  <Icons.users size={19} />
                </Link>
              </div>
            )}

            <Link to={storefrontEnabled ? '/shop' : '/contact'} className="btn btn--primary btn--sm nav__cta">
              {t(storefrontEnabled ? 'nav.shopCta' : 'nav.cta')}
            </Link>

            <button
              className={`nav__burger ${open ? 'is-open' : ''}`}
              onClick={() => setOpen((v) => !v)}
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
            id="mobile-navigation"
            className="mobile-menu"
            aria-label={t('nav.mobile')}
            initial={{ opacity: 0, x: menuOffset }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: menuOffset }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            {navLinks.map((link, i) => (
              <mo.div
                key={link.to}
                initial={{ opacity: 0, x: menuOffset * 0.35 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.025 + Math.min(i, 4) * 0.018, duration: 0.2 }}
              >
                <NavLink to={link.to} end={link.end} className={({ isActive }) => `m-link ${isActive ? 'active' : ''}`}>
                  {t(link.key)}
                  <Icons.arrow size={20} />
                </NavLink>
              </mo.div>
            ))}
            <mo.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.1, duration: 0.18 }}
              className="m-controls"
            >
              <LangSwitch block />
              <ThemeToggle />
            </mo.div>
            <mo.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.12, duration: 0.18 }}
              className="m-slogan"
            >
              {t('global.slogan')}
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
  const { t, l, col, brands } = useContent();
  const { shopEnabled, locale } = useLocale();
  const socials = col('socials');
  const trustSeals = activeTrustSeals(col('trustSeals'));
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__grid">
          <div>
            <Link to="/" className="nav__logo" style={{ marginBottom: 8 }}>
              <Logo size={44} variant="solid" />
              <span className="nav__logo-text">
                <strong style={{ color: '#fff' }}>{t('global.company.short')}</strong>
                <small>{t('global.company.en')}</small>
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
              {NAV_LINKS.filter((link) => link.to !== '/' && (!link.shopOnly || shopEnabled)).map((link) => (
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
                  {t('footer.sales')} {t('global.sales.phone.fa')}
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

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname]);

  return (
    <>
      <Navbar />
      {children}
      <Footer />
      <BackToTop />
    </>
  );
}
