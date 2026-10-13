import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { m as mo, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { Icons, Reveal, SectionHead, Counter, CTABand, hl, useNum } from '../components/ui';
import { ProductCard, PostCard, BrandCard } from '../components/cards';
import { useContent } from '../content/ContentContext';
import { imgProps, SIZES } from '../lib/img';

function Hero() {
  const ref = useRef(null);
  const { t, m } = useContent();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  /* Parallax is scroll-linked motion, which MotionConfig's reducedMotion
     setting does not cover — it only governs time-based animations. A visitor
     who asked for less motion gets a hero that simply stays put. */
  const reduce = useReducedMotion();
  const yRaw = useTransform(scrollYProgress, [0, 1], [0, 180]);
  const opacityRaw = useTransform(scrollYProgress, [0, 0.85], [1, 0]);
  const y = reduce ? 0 : yRaw;
  const opacity = reduce ? 1 : opacityRaw;

  /* One composed entrance reads as a deliberate brand reveal. The previous
     per-word cascade kept the primary call to action waiting for 1.45s and
     made the hero feel assembled from effects. Reduced-motion visitors get
     the final state immediately. */
  const entrance = reduce
    ? {}
    : {
        initial: { opacity: 0, y: 24 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.65, delay: 0.12, ease: [0.22, 1, 0.36, 1] },
      };

  const sloganWords = t('global.slogan').split(' ');

  return (
    <section className="hero" ref={ref}>
      <div className="hero__bg">
        <img {...imgProps(m('home.hero.bg'), SIZES.full)} alt={t('global.company.name')} fetchPriority="high" />
      </div>
      <div className="hero__overlay" />

      <mo.div className="hero__inner" style={{ y, opacity }}>
        <mo.div className="container" {...entrance}>
          <span className="hero__badge">
            <i />
            {t('home.hero.badge')}
          </span>

          <h1 className="hero__slogan">
            {sloganWords.map((w, i) => (
              <span key={i} className={`word ${i >= sloganWords.length - 3 ? 'accent' : ''}`}>
                {w}
                {'\u00A0'}
              </span>
            ))}
          </h1>

          <p className="hero__title">{t('home.hero.title')}</p>
          <p className="hero__desc">{t('home.hero.desc')}</p>

          <div className="hero__actions">
            <Link to="/products" className="btn btn--primary">
              {t('home.hero.btnProducts')}
              <Icons.arrow size={18} />
            </Link>
            <Link to="/about" className="btn btn--ghost">
              {t('home.hero.btnAbout')}
            </Link>
          </div>
        </mo.div>
      </mo.div>

      <mo.div className="hero__scroll" style={{ opacity }}>
        <span className="mouse" />
        {t('home.hero.scroll')}
      </mo.div>
    </section>
  );
}

function Intro() {
  const { t, m, l } = useContent();
  return (
    <section className="section section--airy">
      <div className="container">
        <div className="split">
          <Reveal x={40} y={0}>
            <div className="split__media">
              <span className="badge-float">{t('home.intro.badge')}</span>
              <div className="img-main">
                <img {...imgProps(m('home.intro.imgMain'), SIZES.half)} alt={t('home.intro.overline')} loading="lazy" />
              </div>
              <div className="img-float">
                <img {...imgProps(m('home.intro.imgFloat'), SIZES.inset)} alt={t('home.intro.btnQuality')} loading="lazy" />
              </div>
            </div>
          </Reveal>

          <Reveal className="section-copy" x={-40} y={0} delay={0.1}>
            <span className="overline">{t('home.intro.overline')}</span>
            <h2 className="section-title">{hl(t('home.intro.title'))}</h2>
            <p>{t('home.intro.p1')}</p>
            <ul className="check-list">
              {[1, 2, 3, 4].map((i) => (
                <li key={i}>
                  <Icons.check size={20} />
                  {t(`home.intro.check${i}`)}
                </li>
              ))}
            </ul>
            <div className="button-row">
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
    <section className="section section--soft section--compact">
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
        <SectionHead
          overline={t('home.products.overline')}
          title={hl(t('home.products.title'))}
          sub={t('home.products.sub')}
          align="start"
        />
        <div className="products-grid">
          {featured.map((p, i) => (
            <ProductCard key={p.slug} product={p} index={i} />
          ))}
        </div>
        <Reveal className="section-action">
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
  const num = useNum();
  return (
    <section className="section section--soft" style={{ overflow: 'hidden' }}>
      <div className="container">
        <SectionHead overline={t('home.process.overline')} title={hl(t('home.process.title'))} sub={t('home.process.sub')} />
        <div className="steps">
          {col('process').map((s, i) => (
            <Reveal key={s.title} delay={i * 0.14} className="step">
              <div className="step__num">{num(i + 1)}</div>
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
        <SectionHead overline={t('home.features.overline')} title={hl(t('home.features.title'))} align="start" />
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
        <Reveal className="section-action">
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
        <SectionHead
          overline={t('home.blog.overline')}
          title={hl(t('home.blog.title'))}
          sub={t('home.blog.sub')}
          align="start"
        />
        <div className="posts-grid">
          {posts.slice(0, 3).map((p, i) => (
            <PostCard key={p.slug} post={p} index={i} />
          ))}
        </div>
        <Reveal className="section-action">
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
  const reduce = useReducedMotion();
  const yRaw = useTransform(scrollYProgress, [0, 1], [-60, 60]);
  const y = reduce ? 0 : yRaw;

  return (
    <section className="section section--flush media-band media-band--tall" ref={ref}>
      <mo.img className="parallax-img" {...imgProps(m('home.banner.bg'), SIZES.full)} alt={t('global.slogan')} style={{ y, scale: 1.15 }} />
      <div className="media-band__overlay">
        <Reveal>
          <p className="media-band__eyebrow">{t('home.banner.en')}</p>
          <h2 className="media-band__title">«{t('global.slogan')}»</h2>
          <p className="media-band__text">{t('home.banner.note')}</p>
        </Reveal>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <>
      <Hero />
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
