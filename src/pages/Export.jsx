import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { Icons, Reveal, SectionHead, Counter, PageHero, CTABand, hl } from '../components/ui';
import { useContent } from '../content/ContentContext';

export default function Export() {
  const { t, m, l, col } = useContent();
  const regions = col('regions');
  const steps = col('exportSteps');
  const stats = col('exportStats');

  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], [-70, 70]);

  return (
    <>
      <PageHero title={t('export.hero.title')} sub={t('export.hero.sub')} image={m('export.hero.img')} />

      <section ref={ref} style={{ position: 'relative', height: '52vh', minHeight: 380, overflow: 'hidden' }}>
        <motion.img className="parallax-img" src={m('export.banner.img')} alt={t('export.hero.title')} style={{ y, scale: 1.15 }} loading="lazy" decoding="async" />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(to top, rgba(27,4,10,.9), rgba(77,5,20,.25))',
            display: 'grid',
            placeItems: 'center',
            textAlign: 'center',
            padding: 24,
          }}
        >
          <Reveal>
            <h2 style={{ color: '#fff', fontSize: 'clamp(24px, 4vw, 46px)', fontWeight: 900, margin: 0, lineHeight: 1.8 }}>
              {t('export.banner.title')}
            </h2>
            <p style={{ color: 'rgba(255,255,255,.8)', maxWidth: 620, margin: '12px auto 0' }}>
              {t('export.banner.text')}
            </p>
          </Reveal>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHead overline={t('export.regions.overline')} title={hl(t('export.regions.title'))} />
          <div className="features-grid">
            {regions.map((r, i) => {
              const Ic = Icons[r.icon] || Icons.globe;
              return (
                <Reveal key={r.title} delay={(i % 3) * 0.12} className="card feature-card">
                  <div className="feature-card__icon">
                    <Ic size={26} />
                  </div>
                  <h3>{r.title}</h3>
                  <p>{r.text}</p>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      <section className="section stats-band">
        <div className="container">
          <div className="stats-grid">
            {stats.map((s, i) => (
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

      <section className="section">
        <div className="container">
          <SectionHead overline={t('export.steps.overline')} title={hl(t('export.steps.title'))} />
          <div className="steps">
            {steps.map((s, i) => (
              <Reveal key={s.title} delay={i * 0.14} className="step">
                <div className="step__num">{(i + 1).toLocaleString('fa-IR')}</div>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <CTABand
        title={t('export.cta.title')}
        text={t('export.cta.text')}
        primary={{ to: '/contact', label: t('export.cta.btn') }}
        secondary={{ href: l('sales.whatsapp'), label: t('export.cta.btnWhatsapp') }}
      />
    </>
  );
}
