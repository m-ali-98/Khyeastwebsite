import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useContent } from '../content/ContentContext';
import { observeReveal } from '../lib/motion';
import { renderHighlight } from '../content/sanitize';
import { useLocale } from '../i18n/LocaleContext';
import { imgProps, SIZES } from '../lib/img';
import {
  ArrowLeft,
  ArrowRight,
  BadgePercent,
  Bold,
  CircleCheck,
  ClipboardList,
  Clock3,
  ContactRound,
  CreditCard,
  Croissant,
  Eye,
  EyeOff,
  Factory,
  FilePenLine,
  FileText,
  FlaskConical,
  Globe2,
  Image,
  Images,
  Inbox,
  Italic,
  Languages,
  Leaf,
  Link2,
  List,
  ListOrdered,
  Mail,
  MapPin,
  MessageSquareText,
  Moon,
  Newspaper,
  Package,
  PackageCheck,
  Phone,
  RefreshCw,
  ScanLine,
  Send,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Star,
  Store,
  Sun,
  Thermometer,
  Trash2,
  Truck,
  Unlink2,
  Upload,
  Users,
  Video,
  Wheat,
  Pencil,
} from 'lucide-react';

export const hl = renderHighlight;

/* Persian digits — used by the shop, which is the Persian site only. */
/* QUANTITIES. Grouped with thousands separators: ۹٬۲۱۰٬۷۵۰ rial, ۱۲ items. */
export const faNum = (n) => Number(n).toLocaleString('fa-IR');

/* IDENTIFIERS. Phone numbers, postal codes, plaques, order codes, dates.
   These are digit strings, not amounts: running a phone number through the
   quantity formatter printed ۹٬۲۱۰٬۷۵۰٬۴۱۲ — a price, not a number anyone
   can dial. It also survives a value that is not purely numeric (a date
   like ۱۴۰۴/۰۷/۱۳, or a plaque like 12/B), where Number() yields NaN and
   the quantity formatter prints «ناعدد». */
export const faId = (v) => String(v ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

/* Digit shapes per language: Persian, Arabic-Indic and Latin respectively. */
export const NUM_LOCALE = { fa: 'fa-IR', ar: 'ar-EG', en: 'en-US' };
export const useNum = () => {
  const { locale } = useLocale();
  return (n) => Number(n).toLocaleString(NUM_LOCALE[locale] || 'fa-IR');
};

/* ------------------------------------------------------------------ */
/*  Icon system                                                       */
/* ------------------------------------------------------------------ */
/*
   Product/UI symbols come from one optical family (Lucide) rather than a
   mixture of hand-drawn paths. A slightly lighter shared stroke keeps 14px
   utility icons and 30px feature icons visually consistent.

   Social networks are the exception: their recognisable official marks are
   filled artwork, not generic line symbols. The three paths below are the
   Simple Icons v16.35 marks (CC0), embedded directly so three tiny marks do
   not pull a second icon package into the public bundle.
*/
const lineIcon = (Glyph) => {
  function AppIcon({ strokeWidth = 1.8, ...props }) {
    const labelled = Boolean(props['aria-label']);
    return (
      <Glyph
        strokeWidth={strokeWidth}
        aria-hidden={labelled ? undefined : 'true'}
        focusable="false"
        {...props}
      />
    );
  }
  AppIcon.displayName = `Icon(${Glyph.displayName || Glyph.name || 'Lucide'})`;
  return AppIcon;
};

const brandIcon = (path, name) => {
  function BrandIcon({ size = 22, ...props }) {
    const labelled = Boolean(props['aria-label']);
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        stroke="none"
        aria-hidden={labelled ? undefined : 'true'}
        focusable="false"
        {...props}
      >
        <path d={path} />
      </svg>
    );
  }
  BrandIcon.displayName = `${name}Mark`;
  return BrandIcon;
};

const ArrowLeftIcon = lineIcon(ArrowLeft);
const ArrowRightIcon = lineIcon(ArrowRight);
function DirectionalArrow({ className = '', ...props }) {
  const { isRTL } = useLocale();
  const arrowProps = {
    ...props,
    className: `icon-directional ${className}`.trim(),
  };
  return isRTL ? <ArrowLeftIcon {...arrowProps} /> : <ArrowRightIcon {...arrowProps} />;
}

const WhatsAppMark = brandIcon(
  'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z',
  'WhatsApp',
);
const TelegramMark = brandIcon(
  'M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z',
  'Telegram',
);
const FacebookMark = brandIcon(
  'M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z',
  'Facebook',
);

export const Icons = {
  sun: lineIcon(Sun),
  moon: lineIcon(Moon),
  wheat: lineIcon(Wheat),
  phone: lineIcon(Phone),
  mail: lineIcon(Mail),
  pin: lineIcon(MapPin),
  globe: lineIcon(Globe2),
  check: lineIcon(CircleCheck),
  arrow: DirectionalArrow,
  eye: lineIcon(Eye),
  eyeOff: lineIcon(EyeOff),
  shield: lineIcon(ShieldCheck),
  pack: lineIcon(PackageCheck),
  box: lineIcon(Package),
  cart: lineIcon(ShoppingCart),
  shipping: lineIcon(Truck),
  store: lineIcon(Store),
  orders: lineIcon(ClipboardList),
  send: lineIcon(Send),
  discount: lineIcon(BadgePercent),
  flask: lineIcon(FlaskConical),
  factory: lineIcon(Factory),
  gear: lineIcon(Settings2),
  area: lineIcon(ScanLine),
  temp: lineIcon(Thermometer),
  clock: lineIcon(Clock3),
  doc: lineIcon(FileText),
  star: lineIcon(Star),
  users: lineIcon(Users),
  leaf: lineIcon(Leaf),
  bread: lineIcon(Croissant),
  spark: lineIcon(Sparkles),
  edit: lineIcon(Pencil),
  trash: lineIcon(Trash2),
  refresh: lineIcon(RefreshCw),
  upload: lineIcon(Upload),
  link: lineIcon(Link2),
  unlink: lineIcon(Unlink2),
  image: lineIcon(Image),
  media: lineIcon(Images),
  video: lineIcon(Video),
  bold: lineIcon(Bold),
  italic: lineIcon(Italic),
  list: lineIcon(List),
  listOrdered: lineIcon(ListOrdered),
  comments: lineIcon(MessageSquareText),
  payment: lineIcon(CreditCard),
  translations: lineIcon(Languages),
  posts: lineIcon(Newspaper),
  text: lineIcon(FilePenLine),
  contact: lineIcon(ContactRound),
  inbox: lineIcon(Inbox),
  whatsapp: WhatsAppMark,
  telegram: TelegramMark,
  facebook: FacebookMark,
};

export const socialIcon = (id) => Icons[String(id || '').toLowerCase()] || Icons.globe;

/* ------------------------------------------------------------------ */
/*  Scroll reveal wrapper                                              */
/* ------------------------------------------------------------------ */
/* Scroll reveal.

   This used to be a framer-motion component, which meant one JS animation
   loop and one IntersectionObserver per instance — 63 of them on the longer
   pages. It is now a plain div driven by a single shared observer that just
   toggles a class, letting the browser run the transition on the compositor.
   Same choreography, a fraction of the main-thread cost, and smoother
   precisely on the devices that were struggling.

   The travel distance is passed as a custom property so the stylesheet can
   shorten or cancel it per motion tier. */
/* Stagger delays are handed in per item (delay={i * 0.12}), which reads well
   for three or four cards but turns a twelve-item grid into a second and a
   half of drip-feed. Cap it: past this point every remaining item shares the
   last slot, so long lists stay lively. Reduced from 0.32 to 0.2 for snappier
   page load feel. */
const MAX_STAGGER = 0.2;

export function Reveal({ children, delay = 0, y = 26, x = 0, className = '', style, as: Tag = 'div', ...rest }) {
  const ref = useRef(null);

  useEffect(() => observeReveal(ref.current), []);

  const d = Math.min(delay, MAX_STAGGER);

  return (
    <Tag
      ref={ref}
      {...rest}
      className={`reveal ${className}`.trim()}
      style={{
        '--rv-y': `${y}px`,
        '--rv-x': `${x}px`,
        '--rv-delay': d ? `${d}s` : '0s',
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}

/* ------------------------------------------------------------------ */
/*  Section heading                                                    */
/* ------------------------------------------------------------------ */
export function SectionHead({ overline, title, sub, light = false, align = 'center' }) {
  const alignment = align === 'start' ? 'start' : 'center';
  return (
    <Reveal className={`section-head section-head--${alignment}`}>
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
  const [val, setVal] = useState(0);
  const num = useNum();

  /* Counting from 0 to a number is four lines of requestAnimationFrame. Doing
     it through framer's imperative animate() pulled its whole animation
     engine into the entry chunk for the sake of one easing curve. */
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    let raf = 0;
    const ease = (t) => 1 - Math.pow(1 - t, 3); // the [0.22,1,0.36,1] feel
    const run = () => {
      const started = performance.now();
      const tick = (now) => {
        const p = Math.min(1, (now - started) / (duration * 1000));
        setVal(Math.round(ease(p) * to));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };

    if (typeof IntersectionObserver !== 'function') {
      setVal(to);
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        io.disconnect();
        run();
      },
      { rootMargin: '-60px' },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [to, duration]);

  return (
    <span ref={ref}>
      {num(val)}
      {suffix}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Inner-page hero                                                    */
/* ------------------------------------------------------------------ */
export function PageHero({ title, sub, image, crumb }) {
  const { t } = useContent();
  /* `||`, not `??`: a caller passing t('some.missing.key') gets an empty
     string, not undefined, and an empty string here renders a link with no
     text at all — invisible to a mouse and nameless to a screen reader.
     Falling back on any falsy value means a mistyped key degrades to the
     home label instead of producing an unusable link. */
  crumb = crumb || t('nav.breadcrumb.home');
  return (
    <header className="page-hero">
      {image && (
        <div className="page-hero__img">
          <img {...imgProps(image, SIZES.full)} alt="" loading="lazy" />
        </div>
      )}
      <div className="container">
        <Reveal as="nav" className="breadcrumb" y={14}>
          <Link to="/">{crumb}</Link>
          <span className="sep">/</span>
          <span>{title}</span>
        </Reveal>
        <Reveal as="h1" delay={0.12} y={30}>
          {title}
        </Reveal>
        {sub && (
          <Reveal as="p" delay={0.24} y={24}>
            {sub}
          </Reveal>
        )}
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/*  CTA band                                                           */
/* ------------------------------------------------------------------ */
export function CTABand({ title, text, primary, secondary }) {
  const { t, l } = useContent();
  title = title ?? t('home.cta.title');
  text = text ?? t('home.cta.text');
  primary = primary ?? { to: l('home.cta.primary'), label: t('home.cta.btnPrimary') };
  secondary = secondary ?? { href: l('sales.tel'), label: t('home.cta.btnPhone') };
  return (
    <section className="section section--compact">
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

/* ==========================================================================
   Password input with a reveal toggle.

   Shared by the customer login and the admin login so the two behave the
   same way. Points worth keeping:

   - It is a <button type="button">. Inside a form, a button with no type
     submits it, so the first tap on the eye would post a half-typed login.
   - The label says what the next press will do and is announced to screen
     readers; the icon alone is not a label.
   - Revealing is per-field and resets on unmount — nothing remembers that a
     password was once visible.
   ========================================================================== */
export function PasswordInput({ value, onChange, autoComplete = 'current-password', dir = 'ltr', showLabel = 'نمایش رمز عبور', hideLabel = 'پنهان کردن رمز عبور', ...rest }) {
  const [shown, setShown] = useState(false);
  return (
    <span className="pw-field">
      <input
        {...rest}
        type={shown ? 'text' : 'password'}
        dir={dir}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
      />
      <button
        type="button"
        className="pw-field__eye"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? hideLabel : showLabel}
        aria-pressed={shown}
        title={shown ? hideLabel : showLabel}
      >
        {shown ? <Icons.eyeOff size={18} /> : <Icons.eye size={18} />}
      </button>
    </span>
  );
}
