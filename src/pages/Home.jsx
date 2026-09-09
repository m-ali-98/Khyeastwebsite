import { useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, useScroll, useTransform } from 'framer-motion';
import { Icons, Reveal, SectionHead, Counter, Marquee, CTABand, hl } from '../components/ui';
import { ProductCard, PostCard, BrandCard } from '../components/cards';
import { useContent } from '../content/ContentContext';

function Hero() {
  const ref = useRef(null);
  const { t, m } = useContent();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], [0, 180]);
  const opacity = useTransform(scrollYProgress, [0, 0.85], [1, 0]);

  const sloganWords = t('global.slogan').split(' ');

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
        <img src={m('home.hero.bg')} alt={t('global.company.name')} />
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
            {t('home.hero.badge')}
          </motion.span>

          <h1 className="hero__slogan">
            {sloganWords.map((w, i) => (
              <motion.span
                key={i}
                className={`word ${i >= sloganWords.length - 3 ? 'accent' : ''}`}
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
            {t('home.hero.title')}
          </motion.p>

          <motion.p
            className="hero__desc"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 1.3 }}
          >
            {t('home.hero.desc')}
          </motion.p>

          <motion.div
            className="hero__actions"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 1.45 }}
          >
            <Link to="/products" className="btn btn--primary">
              {t('home.hero.btnProducts')}
              <Icons.arrow size={18} />
            </Link>
            <Link to="/about" className="btn btn--ghost">
              {t('home.hero.btnAbout')}
            </Link>
          </motion.div>
        </div>
      </motion.div>

      <motion.div className="hero__scroll" style={{ opacity }}>
        <span className="mouse" />
        {t('home.hero.scroll')}
      </motion.div>
    </section>
  );
}

function Intro() {
  const { t, m, l } = useContent();
  return (
    <section className="section">
      <div className="container">
        <div className="split">
          <Reveal x={40} y={0}>
            <div className="split__media">
              <span className="badge-float">{t('home.intro.badge')}</span>
              <div className="img-main">
                <img src={m('home.intro.imgMain')} alt={t('home.intro.overline')} loading="lazy" />
              </div>
              <div className="img-float">
                <img src={m('home.intro.imgFloat')} alt={t('home.intro.btnQuality')} loading="lazy" />
              </div>
            </div>
          </Reveal>

          <Reveal x={-40} y={0} delay={0.1}>
            <span className="overline">{t('home.intro.overline')}</span>
            <h2 className="section-title">{hl(t('home.intro.title'))}</h2>
            <p style={{ color: 'var(--muted)', fontSize: 16 }}>{t('home.intro.p1')}</p>
            <ul className="check-list">
              {[1, 2, 3, 4].map((i) => (
                <li key={i}>
                  <Icons.check size={20} />
                  {t(`home.intro.check${i}`)}
                </li>
              ))}
            </ul>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <Link to={l('home.intro.more')} className="btn btn--primary">
                {t('home.intro.btnMore')}
                <Icons.arrow size={18} />
              </Link>
              <Link to={l('home.intro.quality')} className="btn btn--outline">
                {t('home.intro.btnQuality')}
              </Link>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function Brands() {
  const { t, brands } = useContent();
  return (
    <section className="section section--soft">
      <div className="container">
        <SectionHead overline={t('home.brands.overline')} title={hl(t('home.brands.title'))} sub={t('home.brands.sub')} />
        <div className="brands-grid">
          {brands.map((b, i) => (
            <BrandCard key={b.id} brand={b} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturedProducts() {
  const { t, products } = useContent();
  const featured = products.filter((p) => p.featured).slice(0, 4);
  return (
    <section className="section">
      <div className="container">
        <SectionHead overline={t('home.products.overline')} title={hl(t('home.products.title'))} sub={t('home.products.sub')} />
        <div className="products-grid">
          {featured.map((p, i) => (
            <ProductCard key={p.slug} product={p} index={i} />
          ))}
        </div>
        <Reveal className="text-center mt-40">
          <Link to="/products" className="btn btn--outline">
            {t('home.products.btnAll')}
            <Icons.arrow size={18} />
          </Link>
        </Reveal>
      </div>
    </section>
  );
}

function Process() {
  const { t, col } = useContent();
  return (
    <section className="section section--soft" style={{ overflow: 'hidden' }}>
      <div className="container">
        <SectionHead overline={t('home.process.overline')} title={hl(t('home.process.title'))} sub={t('home.process.sub')} />
        <div className="steps">
          {col('process').map((s, i) => (
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
  const { t, col } = useContent();
  return (
    <section className="section">
      <div className="container">
        <SectionHead overline={t('home.features.overline')} title={hl(t('home.features.title'))} />
        <div className="features-grid">
          {col('features').map((f, i) => {
            const Ic = Icons[f.icon] || Icons.star;
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
  const { col } = useContent();
  return (
    <section className="section stats-band">
      <div className="container">
        <div className="stats-grid">
          {col('homeStats').map((s, i) => (
            <Reveal key={s.label} delay={i * 0.1} className="stat">
              <div className="stat__value">
                <Counter to={Number(s.value)} suffix={s.suffix} />
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
  const { t, col } = useContent();
  return (
    <section className="section section--soft">
      <div className="container">
        <SectionHead overline={t('home.certs.overline')} title={hl(t('home.certs.title'))} />
        <div className="certs-grid">
          {col('certs')
            .slice(0, 4)
            .map((c, i) => {
              const Ic = Icons[c.icon] || Icons.shield;
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
            {t('home.certs.link')}
            <Icons.arrow size={18} />
          </Link>
        </Reveal>
      </div>
    </section>
  );
}

function BlogTeaser() {
  const { t, posts } = useContent();
  return (
    <section className="section">
      <div className="container">
        <SectionHead overline={t('home.blog.overline')} title={hl(t('home.blog.title'))} sub={t('home.blog.sub')} />
        <div className="posts-grid">
          {posts.slice(0, 3).map((p, i) => (
            <PostCard key={p.slug} post={p} index={i} />
          ))}
        </div>
        <Reveal className="text-center mt-40">
          <Link to="/blog" className="btn btn--outline">
            {t('home.blog.btnAll')}
            <Icons.arrow size={18} />
          </Link>
        </Reveal>
      </div>
    </section>
  );
}

function BreadBanner() {
  const ref = useRef(null);
  const { t, m } = useContent();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], [-60, 60]);

  return (
    <section className="section" style={{ padding: 0 }} ref={ref}>
      <div style={{ position: 'relative', height: '62vh', minHeight: 420, overflow: 'hidden' }}>
        <motion.img className="parallax-img" src={m('home.banner.bg')} alt={t('global.slogan')} style={{ y, scale: 1.15 }} />
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
              {t('home.banner.en')}
            </p>
            <h2 style={{ color: '#fff', fontSize: 'clamp(26px, 4.4vw, 52px)', fontWeight: 900, margin: 0, lineHeight: 1.8 }}>
              «{t('global.slogan')}»
            </h2>
            <p style={{ color: 'rgba(255,255,255,.75)', maxWidth: 560, margin: '14px auto 0' }}>
              {t('home.banner.note')}
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
