import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { AnimatePresence, motion, useScroll } from 'framer-motion';
import Logo from './Logo';
import { Icons, socialIcon } from './ui';
import { COMPANY } from '../data/site';
import { BRANDS } from '../data/products';

export const NAV_LINKS = [
  { to: '/', label: 'خانه', end: true },
  { to: '/about', label: 'درباره ما' },
  { to: '/products', label: 'محصولات' },
  { to: '/export', label: 'صادرات' },
  { to: '/quality', label: 'کیفیت و گواهینامه‌ها' },
  { to: '/blog', label: 'وبلاگ' },
  { to: '/contact', label: 'تماس با ما' },
];

function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  return <motion.div className="scroll-progress" style={{ scaleX: scrollYProgress }} />;
}

function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const location = useLocation();

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

  return (
    <>
      <nav className={`nav ${scrolled && !open ? 'is-scrolled' : ''}`}>
        <div className="nav__topbar">
          <div className="container nav__topbar-inner">
            <div className="nav__topbar-socials">
              {COMPANY.socials.map((s) => {
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
              <a href={`mailto:${COMPANY.email}`}>
                <Icons.mail size={15} />
                {COMPANY.email}
              </a>
              <a href={`tel:${COMPANY.phoneSales}`}>
                <Icons.phone size={15} />
                {COMPANY.phoneSalesFa}
              </a>
            </div>
          </div>
        </div>

        <div className="container nav__bar">
          <Link to="/" className="nav__logo" aria-label={COMPANY.nameFa}>
            <Logo />
            <span className="nav__logo-text">
              <strong>{COMPANY.nameShort}</strong>
              <small>{COMPANY.nameEn}</small>
            </span>
          </Link>

          <div className="nav__links">
            {NAV_LINKS.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) => `nav__link ${isActive ? 'active' : ''}`}
              >
                {l.label}
              </NavLink>
            ))}
          </div>

          <Link to="/contact" className="btn btn--primary btn--sm nav__cta">
            استعلام قیمت
          </Link>

          <button
            className={`nav__burger ${open ? 'is-open' : ''}`}
            onClick={() => setOpen((v) => !v)}
            aria-label="منو"
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
            {NAV_LINKS.map((l, i) => (
              <motion.div
                key={l.to}
                initial={{ opacity: 0, x: 40 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 + i * 0.06, duration: 0.45 }}
              >
                <NavLink to={l.to} end={l.end} className={({ isActive }) => `m-link ${isActive ? 'active' : ''}`}>
                  {l.label}
                  <Icons.arrow size={20} />
                </NavLink>
              </motion.div>
            ))}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="m-slogan"
            >
              {COMPANY.slogan}
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
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__grid">
          <div>
            <Link to="/" className="nav__logo" style={{ marginBottom: 8 }}>
              <Logo size={44} />
              <span className="nav__logo-text">
                <strong style={{ color: '#fff' }}>{COMPANY.nameShort}</strong>
                <small>{COMPANY.nameEn}</small>
              </span>
            </Link>
            <p className="footer__slogan">«{COMPANY.slogan}»</p>
            <p>
              تولیدکننده خمیرمایه خشک فوری با برندهای دزمایه، شتاب، ایکس پاور و نان مایه؛ با بیش از سه دهه
              سابقه و صادرات به بیش از ۵۰ کشور جهان.
            </p>
            <div className="footer__socials">
              {COMPANY.socials.map((s) => {
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
            <h4>دسترسی سریع</h4>
            <ul>
              {NAV_LINKS.filter((l) => l.to !== '/').map((l) => (
                <li key={l.to}>
                  <Link to={l.to}>
                    <Icons.arrow size={14} />
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4>برندهای ما</h4>
            <ul>
              {BRANDS.map((b) => (
                <li key={b.id}>
                  <Link to={`/products?brand=${b.id}`}>
                    <Icons.wheat size={14} />
                    {b.fa} ({b.en})
                  </Link>
                </li>
              ))}
              <li>
                <Link to="/products">
                  <Icons.pack size={14} />
                  همه محصولات
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4>تماس با ما</h4>
            <ul>
              <li>
                <a href={`mailto:${COMPANY.email}`}>
                  <Icons.mail size={15} />
                  {COMPANY.email}
                </a>
              </li>
              <li>
                <a href={`tel:${COMPANY.phoneSales}`}>
                  <Icons.phone size={15} />
                  واحد فروش: {COMPANY.phoneSalesFa}
                </a>
              </li>
              <li style={{ lineHeight: 1.9 }}>
                <Icons.pin size={15} style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: 8 }} />
                تهران، پاسداران، خیابان اسلامی، خیابان مومن‌نژاد، پلاک ۵۵
              </li>
              <li style={{ lineHeight: 1.9 }}>
                <Icons.factory size={15} style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: 8 }} />
                دزفول، کیلومتر ۱۲ جاده شوشتر، شهرک صنعتی یک
              </li>
            </ul>
          </div>
        </div>

        <div className="footer__bottom">
          <span>© {new Date().getFullYear().toLocaleString('fa-IR')} — شرکت خمیر مایه خوزستان. کلیه حقوق محفوظ است.</span>
          <span>{COMPANY.sloganEn}</span>
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
