import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { AnimatePresence, motion, useScroll } from 'framer-motion';
import Logo from './Logo';
import { Icons, socialIcon, hl, faNum, NUM_LOCALE } from './ui';
import { useContent } from '../content/ContentContext';
import { useShop } from '../shop/ShopContext';
import { useLocale } from '../i18n/LocaleContext';

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
function ThemeToggle() {
  const { isDark, toggleTheme } = useLocale();
  return (
    <button
      type="button"
      className={`theme-toggle ${isDark ? 'is-dark' : ''}`}
      onClick={toggleTheme}
      aria-label={isDark ? 'Light mode' : 'Dark mode'}
      aria-pressed={isDark}
    >
      <span className="theme-toggle__track">
        <span className="theme-toggle__thumb">{isDark ? <Icons.moon size={13} /> : <Icons.sun size={13} />}</span>
      </span>
    </button>
  );
}

function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  return <motion.div className="scroll-progress" style={{ scaleX: scrollYProgress }} />;
}

function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const { t, l, col } = useContent();
  const { count } = useShop() || { count: 0 };
  const { shopEnabled } = useLocale();
  const navLinks = NAV_LINKS.filter((link) => !link.shopOnly || shopEnabled);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  const socials = col('socials');

  return (
    <>
      <nav className={`nav ${scrolled && !open ? 'is-scrolled' : ''}`}>
        <div className="nav__topbar">
          <div className="container nav__topbar-inner">
            <div className="nav__topbar-socials">
              {socials.map((s) => {
                const Ic = socialIcon(s.id);
                return (
                  <a key={s.id} href={s.href} target="_blank" rel="noreferrer">
                    <Ic size={15} />
                    {s.label}
                  </a>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 18 }}>
              <a href={`mailto:${t('global.email')}`}>
                <Icons.mail size={15} />
                {t('global.email')}
              </a>
              <a href={l('sales.tel')}>
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
            <Logo />
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

          {shopEnabled && (
            <Link to="/shop/cart" className="nav__cart" aria-label={t('shop.cart.title')}>
              <Icons.box size={20} />
              {count > 0 && <span className="nav__cart-badge">{faNum(count)}</span>}
            </Link>
          )}

          <Link to="/contact" className="btn btn--primary btn--sm nav__cta">
            {t('nav.cta')}
          </Link>

          <button
            className={`nav__burger ${open ? 'is-open' : ''}`}
            onClick={() => setOpen((v) => !v)}
            aria-label={t('nav.home')}
            aria-expanded={open}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {open && (
          <motion.div
            className="mobile-menu"
            initial={{ clipPath: 'circle(0% at 92% 6%)', opacity: 0 }}
            animate={{ clipPath: 'circle(150% at 92% 6%)', opacity: 1 }}
            exit={{ clipPath: 'circle(0% at 92% 6%)', opacity: 0 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          >
            {navLinks.map((link, i) => (
              <motion.div
                key={link.to}
                initial={{ opacity: 0, x: 40 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 + i * 0.06, duration: 0.45 }}
              >
                <NavLink to={link.to} end={link.end} className={({ isActive }) => `m-link ${isActive ? 'active' : ''}`}>
                  {t(link.key)}
                  <Icons.arrow size={20} />
                </NavLink>
              </motion.div>
            ))}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.55 }}
              className="m-controls"
            >
              <LangSwitch block />
              <ThemeToggle />
            </motion.div>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="m-slogan"
            >
              {t('global.slogan')}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 600);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <AnimatePresence>
      {show && (
        <motion.button
          className="to-top"
          initial={{ opacity: 0, y: 24, scale: 0.8 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.8 }}
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="بازگشت به بالا"
        >
          <Icons.arrow size={20} style={{ transform: 'rotate(90deg)' }} />
        </motion.button>
      )}
    </AnimatePresence>
  );
}

function Footer() {
  const { t, l, col, brands } = useContent();
  const { shopEnabled, locale } = useLocale();
  const socials = col('socials');
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__grid">
          <div>
            <Link to="/" className="nav__logo" style={{ marginBottom: 8 }}>
              <Logo size={44} />
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
            <h4>{t('footer.quickTitle')}</h4>
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
            <h4>{t('footer.brandsTitle')}</h4>
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
            <h4>{t('footer.contactTitle')}</h4>
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
      <ScrollProgress />
      <Navbar />
      {children}
      <Footer />
      <BackToTop />
    </>
  );
}
