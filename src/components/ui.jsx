import { useEffect, useRef, useState } from 'react';
import { motion, useInView, animate } from 'framer-motion';
import { Link } from 'react-router-dom';
import { COMPANY } from '../data/site';

export const faNum = (n) => Number(n).toLocaleString('fa-IR');

/* ------------------------------------------------------------------ */
/*  Icons (inline SVG, stroke-based)                                   */
/* ------------------------------------------------------------------ */
const S = ({ children, size = 22, ...rest }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...rest}
  >
    {children}
  </svg>
);

export const Icons = {
  wheat: (p) => (
    <S {...p}>
      <path d="M12 22V8" />
      <path d="M12 12c-3.5-.6-5.5-2.8-5.5-6 3.2 0 5.5 2.4 5.5 6z" />
      <path d="M12 12c3.5-.6 5.5-2.8 5.5-6-3.2 0-5.5 2.4-5.5 6z" />
      <path d="M12 17c-3.5-.6-5.5-2.8-5.5-6 3.2 0 5.5 2.4 5.5 6z" />
      <path d="M12 17c3.5-.6 5.5-2.8 5.5-6-3.2 0-5.5 2.4-5.5 6z" />
      <path d="M12 8c0-2.5.8-4.5 0-6-.8 1.5 0 3.5 0 6z" />
    </S>
  ),
  phone: (p) => (
    <S {...p}>
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.13.96.36 1.9.7 2.8a2 2 0 0 1-.45 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.45c.9.34 1.84.57 2.8.7A2 2 0 0 1 22 16.9z" />
    </S>
  ),
  mail: (p) => (
    <S {...p}>
      <rect x="2" y="4" width="20" height="16" rx="3" />
      <path d="m22 7-10 6L2 7" />
    </S>
  ),
  whatsapp: (p) => (
    <S {...p}>
      <path d="M3 21l1.65-4.8a8.5 8.5 0 1 1 3.4 3.4L3 21z" />
      <path d="M9 10a5 5 0 0 0 5 5l1-1.5 2 1a1.5 1.5 0 0 1-2 2 8 8 0 0 1-7-7 1.5 1.5 0 0 1 2-2l1 2L9 10z" />
    </S>
  ),
  telegram: (p) => (
    <S {...p}>
      <path d="m22 3-19 8 6 2 2 6 3-4 5 3 3-15z" />
      <path d="m9 13 9-8" />
    </S>
  ),
  facebook: (p) => (
    <S {...p}>
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3V2z" />
    </S>
  ),
  pin: (p) => (
    <S {...p}>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
      <circle cx="12" cy="10" r="3" />
    </S>
  ),
  globe: (p) => (
    <S {...p}>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </S>
  ),
  check: (p) => (
    <S {...p}>
      <circle cx="12" cy="12" r="10" />
      <path d="m8 12.5 2.7 2.7L16 9.5" />
    </S>
  ),
  arrow: (p) => (
    <S {...p}>
      <path d="M19 12H5" />
      <path d="m11 18-6-6 6-6" />
    </S>
  ),
  shield: (p) => (
    <S {...p}>
      <path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10z" />
      <path d="m9 11.5 2.2 2.2L15.5 9" />
    </S>
  ),
  pack: (p) => (
    <S {...p}>
      <path d="M21 8v8a2 2 0 0 1-1 1.73l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.73l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </S>
  ),
  send: (p) => (
    <S {...p}>
      <path d="M5 18H3V6a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v1" />
      <path d="M18 9h3l-3 9h-2" />
      <circle cx="7.5" cy="18" r="2" />
      <circle cx="15.5" cy="18" r="2" />
      <path d="M9.5 18H14" />
    </S>
  ),
  discount: (p) => (
    <S {...p}>
      <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z" />
      <path d="M7 7h.01" />
      <path d="m16 8-8 8" />
      <circle cx="9" cy="15" r="1.4" />
      <circle cx="15" cy="9" r="1.4" />
    </S>
  ),
  flask: (p) => (
    <S {...p}>
      <path d="M10 2v7L4.5 19a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 9V2" />
      <path d="M8.5 2h7" />
      <path d="M7 15h10" />
    </S>
  ),
  factory: (p) => (
    <S {...p}>
      <path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z" />
      <path d="M17 18h1" />
      <path d="M12 18h1" />
      <path d="M7 18h1" />
    </S>
  ),
  gear: (p) => (
    <S {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h0a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h0a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v0a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />
    </S>
  ),
  area: (p) => (
    <S {...p}>
      <path d="M3 3h18v18H3z" />
      <path d="M3 9h6V3" />
      <path d="M21 15h-6v6" />
    </S>
  ),
  temp: (p) => (
    <S {...p}>
      <path d="M14 4a2 2 0 1 0-4 0v10.5a4 4 0 1 0 4 0V4z" />
      <path d="M12 14V9" />
    </S>
  ),
  box: (p) => (
    <S {...p}>
      <rect x="3" y="7" width="18" height="14" rx="2" />
      <path d="M3 11h18" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </S>
  ),
  clock: (p) => (
    <S {...p}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </S>
  ),
  doc: (p) => (
    <S {...p}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M9 13h6" />
      <path d="M9 17h6" />
    </S>
  ),
  star: (p) => (
    <S {...p}>
      <path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" />
    </S>
  ),
  users: (p) => (
    <S {...p}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9.5" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M15 3.13a4 4 0 0 1 0 7.75" />
    </S>
  ),
  leaf: (p) => (
    <S {...p}>
      <path d="M11 20A7 7 0 0 1 4 13c0-5 4-9 10-10 4.5-.8 7 1 7 1s-1 8-4 12a7.5 7.5 0 0 1-6 4z" />
      <path d="M4 21c4-6 8-9 12-11" />
    </S>
  ),
  bread: (p) => (
    <S {...p}>
      <path d="M4 10a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3c0 1.3-.8 2.2-2 2.6V19a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-6.4c-1.2-.4-2-1.3-2-2.6z" />
      <path d="M10 12v4" />
      <path d="M14 12v4" />
    </S>
  ),
  spark: (p) => (
    <S {...p}>
      <path d="M12 2v4" />
      <path d="M12 18v4" />
      <path d="m4.9 4.9 2.8 2.8" />
      <path d="m16.3 16.3 2.8 2.8" />
      <path d="M2 12h4" />
      <path d="M18 12h4" />
      <path d="m4.9 19.1 2.8-2.8" />
      <path d="m16.3 7.7 2.8-2.8" />
    </S>
  ),
};

export const socialIcon = (id) => Icons[id] || Icons.globe;

/* ------------------------------------------------------------------ */
/*  Scroll reveal wrapper                                              */
/* ------------------------------------------------------------------ */
export function Reveal({ children, delay = 0, y = 34, x = 0, className = '', once = true, style }) {
  return (
    <motion.div
      className={className}
      style={style}
      initial={{ opacity: 0, y, x }}
      whileInView={{ opacity: 1, y: 0, x: 0 }}
      viewport={{ once, margin: '-70px' }}
      transition={{ duration: 0.75, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Section heading                                                    */
/* ------------------------------------------------------------------ */
export function SectionHead({ overline, title, sub, light = false }) {
  return (
    <Reveal className="section-head">
      {overline && <span className="overline">{overline}</span>}
      <h2 className="section-title" style={light ? { color: '#fff' } : undefined}>
        {title}
      </h2>
      {sub && (
        <p className="section-sub" style={light ? { color: 'rgba(255,255,255,.78)' } : undefined}>
          {sub}
        </p>
      )}
    </Reveal>
  );
}

/* ------------------------------------------------------------------ */
/*  Animated counter                                                   */
/* ------------------------------------------------------------------ */
export function Counter({ to, suffix = '', duration = 2.2 }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  const [val, setVal] = useState(0);

  useEffect(() => {
    if (!inView) return undefined;
    const controls = animate(0, to, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setVal(Math.round(v)),
    });
    return () => controls.stop();
  }, [inView, to, duration]);

  return (
    <span ref={ref}>
      {faNum(val)}
      {suffix}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Slogan marquee band                                                */
/* ------------------------------------------------------------------ */
export function Marquee({ repeat = 4 }) {
  const Item = () => (
    <span className="marquee__item">
      {COMPANY.slogan}
      <Icons.wheat size={24} />
      {COMPANY.nameShort}
      <Icons.wheat size={24} />
    </span>
  );
  return (
    <div className="marquee" aria-hidden="true">
      <div className="marquee__track">
        {Array.from({ length: repeat }).map((_, i) => (
          <Item key={i} />
        ))}
        {Array.from({ length: repeat }).map((_, i) => (
          <Item key={`b-${i}`} />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Inner-page hero                                                    */
/* ------------------------------------------------------------------ */
export function PageHero({ title, sub, image, crumb = 'صفحه اصلی' }) {
  return (
    <header className="page-hero">
      {image && (
        <div className="page-hero__img">
          <img src={image} alt="" loading="lazy" />
        </div>
      )}
      <div className="container">
        <motion.nav
          className="breadcrumb"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <Link to="/">{crumb}</Link>
          <span className="sep">/</span>
          <span>{title}</span>
        </motion.nav>
        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
        >
          {title}
        </motion.h1>
        {sub && (
          <motion.p
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            {sub}
          </motion.p>
        )}
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/*  CTA band                                                           */
/* ------------------------------------------------------------------ */
export function CTABand({
  title = 'همین امروز با ما همراه شوید',
  text = 'واحد بازرگانی خمیرمایه خوزستان برای استعلام قیمت، درخواست نمونه و مشاوره فنی در کنار شماست.',
  primary = { to: '/contact', label: 'درخواست استعلام قیمت' },
  secondary = { href: `tel:${COMPANY.phoneSales}`, label: `تماس: ${COMPANY.phoneSalesFa}` },
}) {
  return (
    <section className="section section--tight">
      <div className="container">
        <Reveal>
          <div className="cta-band">
            <div>
              <h2>{title}</h2>
              <p>{text}</p>
            </div>
            <div className="cta-band__actions">
              <Link className="btn btn--light" to={primary.to}>
                {primary.label}
                <Icons.arrow size={18} />
              </Link>
              <a className="btn btn--ghost" href={secondary.href}>
                <Icons.phone size={18} />
                {secondary.label}
              </a>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
