import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion, useScroll, useTransform } from 'framer-motion';
import { useRef } from 'react';
import { Icons, Reveal, SectionHead, Counter, Marquee, CTABand } from '../components/ui';
import { ProductCard, PostCard, BrandCard } from '../components/cards';
import { COMPANY, HOME_STATS, PROCESS_STEPS, CERTS } from '../data/site';
import { BRANDS, PRODUCTS } from '../data/products';
import { POSTS } from '../data/posts';

const SLOGAN_WORDS = COMPANY.slogan.split(' ');

function Hero() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], [0, 180]);
  const opacity = useTransform(scrollYProgress, [0, 0.85], [1, 0]);

  const particles = useMemo(
    () =>
      Array.from({ length: 22 }).map((_, i) => ({
        right: `${(i * 37 + 13) % 100}%`,
        size: 3 + ((i * 7) % 6),
        delay: `${(i * 0.9) % 12}s`,
        duration: `${11 + ((i * 3) % 9)}s`,
      })),
    []
  );

  return (
    <section className="hero" ref={ref}>
      <div className="hero__bg">
        <img src="/assets/img/hero-wheat.jpg" alt="مزرعه گندم طلایی در سپیده‌دم" />
      </div>
      <div className="hero__overlay" />
      <div className="hero__particles" aria-hidden="true">
        {particles.map((p, i) => (
          <span
            key={i}
            style={{
              right: p.right,
              bottom: '-2vh',
              width: p.size,
              height: p.size,
              animationDelay: p.delay,
              animationDuration: p.duration,
            }}
          />
        ))}
      </div>

      <motion.div className="hero__inner" style={{ y, opacity }}>
        <div className="container">
          <motion.span
            className="hero__badge"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
          >
            <i />
            بیش از سه دهه پیشگام در صنعت بیوتکنولوژی و مخمر نان کشور
          </motion.span>

          <h1 className="hero__slogan">
            {SLOGAN_WORDS.map((w, i) => (
              <motion.span
                key={i}
                className={`word ${i >= SLOGAN_WORDS.length - 3 ? 'accent' : ''}`}
                initial={{ opacity: 0, y: 46, rotate: 3 }}
                animate={{ opacity: 1, y: 0, rotate: 0 }}
                transition={{ duration: 0.8, delay: 0.35 + i * 0.11, ease: [0.22, 1, 0.36, 1] }}
              >
                {w}
                {'\u00A0'}
              </motion.span>
            ))}
          </h1>

          <motion.p
            className="hero__title"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 1.15 }}
          >
            {COMPANY.nameFa} — تولیدکننده خمیرمایه خشک فوری دزمایه، شتاب، ایکس پاور و نان مایه
          </motion.p>

          <motion.p
            className="hero__desc"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 1.3 }}
          >
            خطوط تولید کارخانه توسط شرکت Frings اتریش و بر اساس آخرین تکنولوژی روز اروپا طراحی و
            راه‌اندازی شده است؛ بیش از نیمی از محصولات ما به کشورهای همسایه، CIS، آفریقا، اروپا و
            آمریکای جنوبی صادر می‌شود.
          </motion.p>

          <motion.div
            className="hero__actions"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 1.45 }}
          >
            <Link to="/products" className="btn btn--primary">
              مشاهده محصولات
              <Icons.arrow size={18} />
            </Link>
            <Link to="/about" className="btn btn--ghost">
              بیشتر بدانید
            </Link>
          </motion.div>
        </div>
      </motion.div>

      <motion.div className="hero__scroll" style={{ opacity }}>
        <span className="mouse" />
        اسکرول
      </motion.div>
    </section>
  );
}

function Intro() {
  return (
    <section className="section">
      <div className="container">
        <div className="split">
          <Reveal x={40} y={0}>
            <div className="split__media">
              <span className="badge-float">از سال ۱۳۷۰</span>
              <div className="img-main">
                <img src="/assets/img/factory.jpg" alt="خط تولید مدرن خمیرمایه" loading="lazy" />
              </div>
              <div className="img-float">
                <img src="/assets/img/laboratory.jpg" alt="آزمایشگاه کنترل کیفیت" loading="lazy" />
              </div>
            </div>
          </Reveal>

          <Reveal x={-40} y={0} delay={0.1}>
            <span className="overline">درباره خمیرمایه خوزستان</span>
            <h2 className="section-title">
              پیشگام در صنعت بیوتکنولوژی و <em>تولید مخمر نان</em> کشور
            </h2>
            <p style={{ color: 'var(--muted)', fontSize: 16 }}>
              کارخانجات خمیرمایه خوزستان در استان خوزستان (دزفول) و خمیرمایه برتر در استان کرمانشاه،
              تحت مدیریت واحد و یکپارچه، با هدف ارتقای سلامت جامعه و تولید محصولات بیوتکنولوژی
              باکیفیت برای صنایع غذایی و پخت نان، بیش از سه دهه است که فعالیت مستمر دارند.
            </p>
            <ul className="check-list">
              <li>
                <Icons.check size={20} />
                خطوط تولید طراحی‌شده توسط کمپانی صاحب‌نام Frings اتریش
              </li>
              <li>
                <Icons.check size={20} />
                عضو رسمی موسسه تحقیقاتی خمیرمایه برلین آلمان (VH Berlin)
              </li>
              <li>
                <Icons.check size={20} />
                دارای گواهینامه‌های ISO 9001:2015 آلمان، حلال و استاندارد ملی ایران
              </li>
              <li>
                <Icons.check size={20} />
                صادرات پایدار به بیش از ۵۰ کشور در پنج قاره
              </li>
            </ul>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <Link to="/about" className="btn btn--primary">
                بیشتر بدانید
                <Icons.arrow size={18} />
              </Link>
              <Link to="/quality" className="btn btn--outline">
                مدیریت کیفیت
              </Link>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function Brands() {
  return (
    <section className="section section--soft">
      <div className="container">
        <SectionHead
          overline="برندهای تجاری"
          title={
            <>
              چهار برند معتبر، <em>یک استاندارد کیفیت</em>
            </>
          }
          sub="محصول خمیرمایه خشک فوری خود را با نام‌های تجاری دزمایه، شتاب، ایکس پاور و نان مایه روانه بازارهای داخلی و خارجی می‌کنیم."
        />
        <div className="brands-grid">
          {BRANDS.map((b, i) => (
            <BrandCard key={b.id} brand={b} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturedProducts() {
  const featured = PRODUCTS.filter((p) => p.featured).slice(0, 4);
  return (
    <section className="section">
      <div className="container">
        <SectionHead
          overline="محصولات برگزیده"
          title={
            <>
              خمیرمایه خشک فوری برای <em>هر نوع پخت</em>
            </>
          }
          sub="از ساشه خانگی تا کیسه‌های صادراتی ۲۰ کیلوگرمی؛ همه با یک پیمان کیفیت."
        />
        <div className="products-grid">
          {featured.map((p, i) => (
            <ProductCard key={p.slug} product={p} index={i} />
          ))}
        </div>
        <Reveal className="text-center mt-40">
          <Link to="/products" className="btn btn--outline">
            مشاهده همه محصولات
            <Icons.arrow size={18} />
          </Link>
        </Reveal>
      </div>
    </section>
  );
}

function Process() {
  return (
    <section className="section section--soft" style={{ overflow: 'hidden' }}>
      <div className="container">
        <SectionHead
          overline="مسیر کیفیت"
          title={
            <>
              {COMPANY.slogan.split('؛')[0]}؛ <em>تا اولین برش نان</em>
            </>
          }
          sub="داستان ما از دانه گندم آغاز می‌شود و در عطر نان تازه به پایان می‌رسد."
        />
        <div className="steps">
          {PROCESS_STEPS.map((s, i) => (
            <Reveal key={s.title} delay={i * 0.14} className="step">
              <div className="step__num">{(i + 1).toLocaleString('fa-IR')}</div>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Features() {
  const items = [
    { icon: 'star', title: 'کیفیت بالای محصولات', text: 'استاندارد ISO 9001 آلمان، گواهینامه حلال و عضویت موسسه تحقیقاتی خمیرمایه برلین.' },
    { icon: 'pack', title: 'بسته‌بندی مناسب', text: 'بسته‌بندی وکیوم، ساشه و کیسه با ماندگاری دو سال از تاریخ تولید.' },
    { icon: 'send', title: 'ارسال به سراسر دنیا', text: 'صادرات به کشورهای همسایه، CIS، آفریقا، اروپا و آمریکای جنوبی.' },
    { icon: 'discount', title: 'تخفیف ویژه محصولات', text: 'قیمت رقابتی برای سفارشات عمده و همکاری با نانوایی‌ها و کارگاه‌ها.' },
    { icon: 'leaf', title: 'مرغوب‌ترین مواد اولیه', text: 'تهیه‌شده از بهترین مواد اولیه با کنترل کیفی مستمر در آزمایشگاه پیشرفته.' },
    { icon: 'flask', title: 'VH برلین و بیوتکنولوژی', text: 'خطوط تولید توسط شرکت Frings اتریش بر اساس آخرین تکنولوژی اروپا.' },
  ];
  return (
    <section className="section">
      <div className="container">
        <SectionHead
          overline="چرا خمیرمایه خوزستان؟"
          title={
            <>
              دلایلی که نانوایان و صنایع، <em>به ما اعتماد می‌کنند</em>
            </>
          }
        />
        <div className="features-grid">
          {items.map((f, i) => {
            const Ic = Icons[f.icon];
            return (
              <Reveal key={f.title} delay={(i % 3) * 0.12} className="card feature-card">
                <div className="feature-card__icon">
                  <Ic size={26} />
                </div>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function StatsBand() {
  return (
    <section className="section stats-band">
      <div className="container">
        <div className="stats-grid">
          {HOME_STATS.map((s, i) => (
            <Reveal key={s.label} delay={i * 0.1} className="stat">
              <div className="stat__value">
                <Counter to={s.value} suffix={s.suffix} />
              </div>
              <div className="stat__label">{s.label}</div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function CertsPreview() {
  return (
    <section className="section section--soft">
      <div className="container">
        <SectionHead
          overline="استانداردها و گواهینامه‌ها"
          title={
            <>
              کیفیتی که <em>مهر تأیید جهانی</em> دارد
            </>
          }
        />
        <div className="certs-grid">
          {CERTS.slice(0, 4).map((c, i) => {
            const iconMap = { iso: 'shield', halal: 'check', haccp: 'flask', iran: 'star' };
            const Ic = Icons[iconMap[c.id]] || Icons.shield;
            return (
              <Reveal key={c.id} delay={i * 0.1} className="card cert-card">
                <div className="cert-card__icon">
                  <Ic size={30} />
                </div>
                <h3>{c.title}</h3>
                <p>{c.text}</p>
              </Reveal>
            );
          })}
        </div>
        <Reveal className="text-center mt-40">
          <Link to="/quality" className="link-arrow">
            مشاهده همه گواهینامه‌ها و سیستم کنترل کیفیت
            <Icons.arrow size={18} />
          </Link>
        </Reveal>
      </div>
    </section>
  );
}

function BlogTeaser() {
  return (
    <section className="section">
      <div className="container">
        <SectionHead
          overline="وبلاگ تخصصی"
          title={
            <>
              از دانش خمیرمایه تا <em>هنر پخت نان</em>
            </>
          }
          sub="مقالات تخصصی در زمینه خمیرمایه، نانوایی و صنایع غذایی"
        />
        <div className="posts-grid">
          {POSTS.map((p, i) => (
            <PostCard key={p.slug} post={p} index={i} />
          ))}
        </div>
        <Reveal className="text-center mt-40">
          <Link to="/blog" className="btn btn--outline">
            همه مقالات
            <Icons.arrow size={18} />
          </Link>
        </Reveal>
      </div>
    </section>
  );
}

function BreadBanner() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], [-60, 60]);

  return (
    <section className="section" style={{ padding: 0 }} ref={ref}>
      <div style={{ position: 'relative', height: '62vh', minHeight: 420, overflow: 'hidden' }}>
        <motion.img
          className="parallax-img"
          src="/assets/img/bread-slicing.jpg"
          alt="اولین برش نان"
          style={{ y, scale: 1.15 }}
          loading="lazy"
        />
        <style>{`
          .parallax-img { position:absolute; inset:-15% 0; width:100%; height:130%; object-fit:cover; }
        `}</style>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(to top, rgba(27,4,10,.88), rgba(77,5,20,.35))',
            display: 'grid',
            placeItems: 'center',
            textAlign: 'center',
            padding: 24,
          }}
        >
          <Reveal>
            <p style={{ color: 'rgba(255,255,255,.85)', fontSize: 15, letterSpacing: '.14em', margin: '0 0 10px' }}>
              {COMPANY.sloganEn}
            </p>
            <h2 style={{ color: '#fff', fontSize: 'clamp(26px, 4.4vw, 52px)', fontWeight: 900, margin: 0, lineHeight: 1.8 }}>
              «{COMPANY.slogan}»
            </h2>
            <p style={{ color: 'rgba(255,255,255,.75)', maxWidth: 560, margin: '14px auto 0' }}>
              هر بسته خمیرمایه ما، پیمانی است میان مزرعه گندم و سفره شما.
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <>
      <Hero />
      <Marquee />
      <Intro />
      <Brands />
      <FeaturedProducts />
      <Process />
      <BreadBanner />
      <Features />
      <StatsBand />
      <CertsPreview />
      <BlogTeaser />
      <CTABand />
    </>
  );
}
