import { Icons, Reveal, SectionHead, PageHero, CTABand, hl } from '../components/ui';
import { useContent } from '../content/ContentContext';
import SmartImage from '../components/SmartImage';

export default function Quality() {
  const { t, m, col } = useContent();
  const certs = col('certs');
  const qcSteps = col('qcSteps');

  return (
    <>
      <PageHero title={t('quality.hero.title')} sub={t('quality.hero.sub')} image={m('quality.hero.img')} />

      <section className="section">
        <div className="container">
          <div className="split">
            <Reveal x={40} y={0}>
              <div className="split__media">
                <span className="badge-float">{t('quality.lab.badge')}</span>
                <div className="img-main">
                  <SmartImage src={m('quality.lab.img')} alt={t('quality.lab.overline')} />
                </div>
              </div>
            </Reveal>
            <Reveal x={-40} y={0} delay={0.1}>
              <span className="overline">{t('quality.lab.overline')}</span>
              <h2 className="section-title">{hl(t('quality.lab.title'))}</h2>
              <p style={{ color: 'var(--muted)' }}>{t('quality.lab.p1')}</p>
              <p style={{ color: 'var(--muted)' }}>{t('quality.lab.p2')}</p>
              <ul className="check-list">
                {[1, 2, 3].map((i) => (
                  <li key={i}>
                    <Icons.check size={20} />
                    {t(`quality.lab.check${i}`)}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </div>
      </section>

      <section className="section section--soft">
        <div className="container">
          <SectionHead overline={t('quality.certs.overline')} title={hl(t('quality.certs.title'))} />
          <div className="certs-grid">
            {certs.map((c, i) => {
              const Ic = Icons[c.icon] || Icons.shield;
              return (
                <Reveal key={c.id} delay={(i % 4) * 0.1} className="card cert-card">
                  <div className="cert-card__icon">
                    <Ic size={30} />
                  </div>
                  <h3>{c.title}</h3>
                  <p>{c.text}</p>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHead overline={t('quality.steps.overline')} title={hl(t('quality.steps.title'))} />
          <div className="steps">
            {qcSteps.map((s, i) => {
              const Ic = Icons[s.icon] || Icons.flask;
              return (
                <Reveal key={s.title} delay={i * 0.14} className="step">
                  <div className="step__num" style={{ fontSize: 0 }}>
                    <Ic size={34} />
                  </div>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      <section className="section section--soft">
        <div className="container">
          <Reveal>
            <div className="cta-band">
              <div>
                <h2>{t('quality.awards.title')}</h2>
                <p>{t('quality.awards.text')}</p>
              </div>
              <div className="cta-band__actions">
                <a className="btn btn--light" href={`mailto:${t('global.email')}`}>
                  <Icons.doc size={18} />
                  {t('quality.awards.btn')}
                </a>
              </div>
            </div>
          </Reveal>
        </div>
      </section>
      <CTABand />
    </>
  );
}
