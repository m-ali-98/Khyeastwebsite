import { Link } from 'react-router-dom';
import { Icons, Reveal, SectionHead, Counter, PageHero, CTABand, hl } from '../components/ui';
import { useContent } from '../content/ContentContext';
import { imgProps, SIZES } from '../lib/img';

const PLANT_OFFICE_IDS = new Set(['dezful', 'kermanshah']);
const withoutTrailingLocation = (title = '') => title.replace(/\s*\([^()]*\)\s*$/, '');

function Mission() {
  const { t } = useContent();
  const cards = [
    { icon: 'star', title: t('about.mission.missionLabel'), text: t('about.mission.mission') },
    { icon: 'globe', title: t('about.mission.visionLabel'), text: t('about.mission.vision') },
  ];
  return (
    <section className="section section--continuation about-mission">
      <div className="container">
        <SectionHead overline={t('about.mission.overline')} title={hl(t('about.mission.title'))} />
        <div className="contact-grid about-mission__grid">
          {cards.map((c, i) => {
            const Ic = Icons[c.icon];
            return (
              <Reveal key={c.title} delay={i * 0.12} className="card principle-card">
                <div className="principle-card__icon">
                  <Ic size={26} />
                </div>
                <div>
                  <h3>{c.title}</h3>
                  <p>{c.text}</p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default function About() {
  const { t, m, col } = useContent();
  const timeline = col('timeline');
  const facts = col('facts');
  const stats = col('stats');
  const plantOffices = col('offices').filter((office) => PLANT_OFFICE_IDS.has(office.id));

  /* The Contact directory is the single source of truth for plant names and
     addresses. Replace the old one-line location summary in `facts` with one
     card per plant so an Admin edit cannot leave the About page out of sync.
     The city is already stated in each full address, so this compact section
     omits Contact's trailing parenthetical city label from the card title. */
  const infrastructureFacts = [
    ...(plantOffices.length
      ? plantOffices.map((office) => ({
          id: `plant-${office.id}`,
          icon: office.icon || 'factory',
          title: withoutTrailingLocation(office.title),
          text: office.address,
        }))
      : facts.slice(0, 1)),
    ...facts.slice(1),
  ];

  return (
    <>
      <PageHero className="about-hero" title={t('about.hero.title')} sub={t('about.hero.sub')} image={m('about.hero.img')} />

      <section className="section section--airy about-story">
        <div className="container">
          <div className="split about-story__layout">
            <Reveal className="section-copy" x={40} y={0}>
              <span className="overline">{t('about.story.overline')}</span>
              <h2 className="section-title">{hl(t('about.story.title'))}</h2>
              <p>{t('about.story.p1')}</p>
              <p>{t('about.story.p2')}</p>
              <div className="button-row">
                <Link to="/products" className="btn btn--primary">
                  {t('about.story.btnProducts')}
                  <Icons.arrow size={18} />
                </Link>
                <Link to="/contact" className="btn btn--outline">
                  {t('about.story.btnContact')}
                </Link>
              </div>
            </Reveal>
            <Reveal x={-40} y={0} delay={0.1}>
              <div className="split__media">
                <span className="badge-float">{t('about.story.badge')}</span>
                <div className="img-main">
                  <img {...imgProps(m('about.story.imgMain'), SIZES.half)} alt={t('about.story.overline')} loading="lazy" />
                </div>
                <div className="img-float">
                  <img {...imgProps(m('about.story.imgFloat'), SIZES.inset)} alt={t('global.slogan')} loading="lazy" />
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      <Mission />

      <section className="section section--soft about-timeline">
        <div className="container">
          <SectionHead overline={t('about.timeline.overline')} title={hl(t('about.timeline.title'))} />
          <div className="timeline">
            {timeline.map((item, i) => (
              <Reveal key={item.year} delay={0.05 * i} className="tl-item">
                <div className="tl-item__card">
                  <span className="tl-year">{item.year}</span>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="section stats-band about-stats">
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

      <section className="section section--soft section--airy about-factory">
        <div className="container">
          <div className="split about-factory__layout">
            <Reveal x={40} y={0}>
              <div className="split__media">
                <div className="img-main">
                  <img {...imgProps(m('about.factory.img'), SIZES.half)} alt={t('about.factory.overline')} loading="lazy" />
                </div>
              </div>
            </Reveal>
            <Reveal className="section-copy" x={-40} y={0} delay={0.1}>
              <span className="overline">{t('about.factory.overline')}</span>
              <h2 className="section-title">{hl(t('about.factory.title'))}</h2>
              <div className="fact-grid">
                {infrastructureFacts.map((f, index) => {
                  const Ic = Icons[f.icon] || Icons.factory;
                  return (
                    <div key={f.id || `${index}-${f.title}`} className="fact-item">
                      <div className="icon-badge">
                        <Ic size={20} />
                      </div>
                      <div>
                        <strong>{f.title}</strong>
                        <p>{f.text}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="fact-actions">
                <Link to="/quality" className="btn btn--primary">
                  {t('about.factory.btn')}
                  <Icons.arrow size={18} />
                </Link>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      <CTABand title={t('about.cta.title')} text={t('about.cta.text')} />
    </>
  );
}
