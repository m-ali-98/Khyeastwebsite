import { Link } from 'react-router-dom';
import { Icons, Reveal, SectionHead, Counter, PageHero, CTABand, Marquee } from '../components/ui';
import { STATS, TIMELINE, MANAGERS, FACT_SHEETS } from '../data/site';

function Mission() {
  const cards = [
    {
      icon: 'star',
      title: 'ماموریت ما',
      text: 'تولید محصولات بیوتکنولوژی باکیفیت و پایدار برای تامین نیاز صنایع غذایی و پخت نان ایران و جهان، با استفاده از فناوری‌های نوین اروپایی و دانش فنی متخصصان داخلی؛ در راستای ارتقای سلامت جامعه، حمایت از تولید ملی و توسعه صادرات غیرنفتی.',
    },
    {
      icon: 'globe',
      title: 'چشم‌انداز ما',
      text: 'تبدیل شدن به برترین تولیدکننده خمیرمایه در منطقه خاورمیانه و آسیای مرکزی تا افق ۱۴۱۰، با حضور فعال در بیش از ۷۰ کشور دنیا، توسعه پیوسته محصولات نوین بیوتکنولوژی و ارتقای استانداردهای کیفیت به سطح بین‌المللی.',
    },
  ];
  return (
    <section className="section">
      <div className="container">
        <SectionHead
          overline="ماموریت و چشم‌انداز"
          title={
            <>
              تعهد ما به کیفیت، نوآوری و <em>رشد پایدار</em>
            </>
          }
        />
        <div className="contact-grid">
          {cards.map((c, i) => {
            const Ic = Icons[c.icon];
            return (
              <Reveal key={c.title} delay={i * 0.12} className="card contact-card">
                <div className="contact-card__icon">
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

function Timeline() {
  return (
    <section className="section section--soft">
      <div className="container">
        <SectionHead
          overline="تاریخچه و نقاط عطف"
          title={
            <>
              مسیر رشد و بالندگی <em>در گذر زمان</em>
            </>
          }
        />
        <div className="timeline">
          {TIMELINE.map((t, i) => (
            <Reveal key={t.year} delay={0.05 * i} className="tl-item">
              <span className="tl-year">{t.year}</span>
              <h3>{t.title}</h3>
              <p>{t.text}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Stats() {
  return (
    <section className="section stats-band">
      <div className="container">
        <div className="stats-grid">
          {STATS.map((s, i) => (
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

function Managers() {
  return (
    <section className="section">
      <div className="container">
        <SectionHead
          overline="تیم مدیریتی"
          title={
            <>
              مدیران <em>شرکت خمیر مایه خوزستان</em>
            </>
          }
          sub="تیمی با تجربه در صنعت بیوتکنولوژی و تجارت بین‌الملل"
        />
        <div className="certs-grid">
          {MANAGERS.map((m, i) => (
            <Reveal key={m.name} delay={i * 0.1} className="card cert-card">
              <div className="cert-card__icon">
                <Icons.users size={30} />
              </div>
              <h3>{m.name}</h3>
              <p>{m.role}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Factory() {
  const iconMap = { factory: 'factory', area: 'area', gear: 'gear', lab: 'flask', temp: 'temp', box: 'box' };
  return (
    <section className="section section--soft">
      <div className="container">
        <div className="split">
          <Reveal x={40} y={0}>
            <div className="split__media">
              <span className="badge-float">۶۵,۰۰۰ متر مربع</span>
              <div className="img-main">
                <img src="/assets/img/factory.jpg" alt="کارخانه خمیرمایه خوزستان" loading="lazy" />
              </div>
            </div>
          </Reveal>
          <Reveal x={-40} y={0} delay={0.1}>
            <span className="overline">مشخصات کارخانه و زیرساخت</span>
            <h2 className="section-title">
              زیرساختی در شأن <em>نان ملت</em>
            </h2>
            <div className="features-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 26 }}>
              {FACT_SHEETS.map((f) => {
                const Ic = Icons[iconMap[f.icon]] || Icons.factory;
                return (
                  <div key={f.title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div className="icon-badge" style={{ width: 44, height: 44, borderRadius: 13 }}>
                      <Ic size={20} />
                    </div>
                    <div>
                      <strong style={{ fontSize: 14.5 }}>{f.title}</strong>
                      <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>{f.text}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 30 }}>
              <Link to="/quality" className="btn btn--primary">
                سیستم کنترل کیفیت
                <Icons.arrow size={18} />
              </Link>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

export default function About() {
  return (
    <>
      <PageHero
        title="درباره شرکت خمیر مایه خوزستان"
        sub="پیشگام در صنعت بیوتکنولوژی و تولید مخمر نان کشور؛ روایتی سه دهه‌ای از کیفیت، از دزفول تا بیش از ۵۰ کشور جهان."
        image="/assets/img/factory.jpg"
        crumb="خانه"
      />
      <Marquee />

      <section className="section">
        <div className="container">
          <div className="split">
            <Reveal x={40} y={0}>
              <span className="overline">داستان ما</span>
              <h2 className="section-title">
                از یک ثبت ساده در ۱۳۷۰ تا <em>خانواده‌ای بین‌المللی</em>
              </h2>
              <p style={{ color: 'var(--muted)' }}>
                کارخانجات خمیرمایه خوزستان در استان خوزستان (دزفول) و خمیرمایه برتر در استان کرمانشاه،
                تحت مدیریت واحد و یکپارچه، با هدف ارتقای سلامت جامعه و تولید محصولات بیوتکنولوژی
                باکیفیت برای صنایع غذایی و پخت نان، بیش از سه دهه است که فعالیت مستمر دارند.
              </p>
              <p style={{ color: 'var(--muted)' }}>
                این شرکت با استفاده از خطوط مدرن طراحی‌شده توسط کمپانی صاحب‌نام Frings اتریش و
                به‌کارگیری دانش فنی متخصصان بیوتکنولوژی داخلی، توانسته است محصولاتی با ماندگاری
                طولانی، فعالیت آنزیمی پایدار و کیفیت یکنواخت به بازار ایران و بیش از ۵۰ کشور جهان
                عرضه نماید.
              </p>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 26 }}>
                <Link to="/products" className="btn btn--primary">
                  مشاهده سبد محصولات
                  <Icons.arrow size={18} />
                </Link>
                <Link to="/contact" className="btn btn--outline">
                  ارتباط با کارخانه و دفاتر
                </Link>
              </div>
            </Reveal>
            <Reveal x={-40} y={0} delay={0.1}>
              <div className="split__media">
                <span className="badge-float">+۳۰ سال تجربه</span>
                <div className="img-main">
                  <img src="/assets/img/hero-wheat.jpg" alt="مزرعه گندم" loading="lazy" />
                </div>
                <div className="img-float">
                  <img src="/assets/img/bread-slicing.jpg" alt="اولین برش نان" loading="lazy" />
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      <Mission />
      <Timeline />
      <Stats />
      <Managers />
      <Factory />
      <CTABand
        title="آماده‌ایم داستان بعدی را با شما بنویسیم"
        text="از همکاری در صادرات تا تأمین خمیرمایه خطوط پخت صنعتی؛ گفت‌وگو با یک پیام شروع می‌شود."
      />
    </>
  );
}
