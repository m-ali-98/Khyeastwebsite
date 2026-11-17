import { useRef } from 'react';
import { m as mo, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { Reveal, SectionHead, Counter, PageHero, CTABand, hl, useNum } from '../components/ui';
import ExportWorldMap from '../components/ExportWorldMap';
import { useContent } from '../content/ContentContext';
import { imgProps, SIZES } from '../lib/img';

export default function Export() {
  const num = useNum();
  const { t, m, l, col } = useContent();
  const regions = col('regions');
  const steps = col('exportSteps');
  const stats = col('exportStats');

  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const reduce = useReducedMotion();
  const yRaw = useTransform(scrollYProgress, [0, 1], [-70, 70]);
  const y = reduce ? 0 : yRaw;

  return (
    <>
      <PageHero className="export-hero" title={t('export.hero.title')} sub={t('export.hero.sub')} image={m('export.hero.img')} />

      <section ref={ref} className="section section--compact export-story">
        <div className="container">
          <div className="media-band export-story__panel">
            <mo.img className="parallax-img" {...imgProps(m('export.banner.img'), SIZES.full)} alt={t('export.hero.title')} style={{ y, scale: 1.15 }} loading="lazy" decoding="async" />
            <div className="media-band__overlay">
              <Reveal>
                <h2 className="media-band__title">{t('export.banner.title')}</h2>
                <p className="media-band__text">{t('export.banner.text')}</p>
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      <section className="section section--soft export-regions">
        <div className="container">
          <SectionHead overline={t('export.regions.overline')} title={hl(t('export.regions.title'))} align="start" />
          <ExportWorldMap regions={regions} />
        </div>
      </section>

      <section className="section stats-band export-stats">
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

      <section className="section export-process">
        <div className="container">
          <SectionHead overline={t('export.steps.overline')} title={hl(t('export.steps.title'))} />
          <div className="steps">
            {steps.map((s, i) => (
              <Reveal key={s.title} delay={i * 0.14} className="step">
                <div className="step__num">{num(i + 1)}</div>
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
