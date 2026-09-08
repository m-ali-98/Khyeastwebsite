import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { Icons, Reveal, SectionHead, Counter, PageHero, CTABand } from '../components/ui';
import { COMPANY } from '../data/site';

const EXPORT_STATS = [
  { value: 50, suffix: '+', label: 'کشور مقصد صادرات' },
  { value: 5, suffix: '', label: 'قاره تحت پوشش' },
  { value: 50, suffix: '٪', label: 'سهم صادرات از تولید' },
  { value: 24, suffix: '', label: 'ماه ماندگاری محصول صادراتی' },
];

function HeroParallax() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], [-70, 70]);

  return (
    <section ref={ref} style={{ position: 'relative', height: '52vh', minHeight: 380, overflow: 'hidden' }}>
      <motion.img
        className="parallax-img"
        src="/assets/img/export.jpg"
        alt="صادرات جهانی خمیرمایه"
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
          background: 'linear-gradient(to top, rgba(27,4,10,.9), rgba(77,5,20,.25))',
          display: 'grid',
          placeItems: 'center',
          textAlign: 'center',
          padding: 24,
        }}
      >
        <Reveal>
          <h2 style={{ color: '#fff', fontSize: 'clamp(24px, 4vw, 46px)', fontWeight: 900, margin: 0, lineHeight: 1.8 }}>
            مرزها برای ما، تنها یک خط روی نقشه‌اند
          </h2>
          <p style={{ color: 'rgba(255,255,255,.8)', maxWidth: 620, margin: '12px auto 0' }}>
            بیش از نیمی از تولید ما هر ساله از بندرهای ایران به مقصد پنج قاره بارگیری می‌شود.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

export default function Export() {
  return (
    <>
      <PageHero
        title="صادرات جهانی"
        sub="حضور پایدار برندهای دزمایه، شتاب، ایکس پاور و نان مایه در بازارهای خاورمیانه، CIS، اروپا، آفریقا و آمریکای جنوبی."
        image="/assets/img/export.jpg"
      />

      <HeroParallax />

      <section className="section">
        <div className="container">
          <SectionHead
            overline="جغرافیای حضور"
            title={
              <>
                بازارهایی که به کیفیت ما <em>اعتماد کرده‌اند</em>
              </>
            }
          />
          <div className="features-grid">
            {[
              { icon: 'pin', title: 'کشورهای همسایه', text: 'عراق، افغانستان، پاکستان، ترکیه، ارمنستان و آذربایجان؛ بازارهای نخست و همیشگی ما.' },
              { icon: 'globe', title: 'حوزه CIS', text: 'روسیه، قزاقستان، ازبکستان، ترکمنستان، قرقیزستان و تاجیکستان.' },
              { icon: 'globe', title: 'آفریقا', text: 'مصر، نیجریه، کنیا، سودان و غنا؛ حضور رو به رشد در بازارهای نوظهور.' },
              { icon: 'globe', title: 'اروپا', text: 'اروپای شرقی و مرکزی با رعایت سخت‌گیرانه‌ترین استانداردهای کیفی.' },
              { icon: 'send', title: 'آمریکای جنوبی', text: 'برزیل، ونزوئلا و کلمبیا؛ حضور پایدار در زنجیره نان آمریکای لاتین.' },
              { icon: 'pin', title: 'خلیج فارس و خاورمیانه', text: 'امارات، قطر، کویت و عمان؛ تأمین‌کننده نانوایی‌ها و صنایع منطقه.' },
            ].map((r, i) => {
              const Ic = Icons[r.icon];
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
            {EXPORT_STATS.map((s, i) => (
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

      <section className="section">
        <div className="container">
          <SectionHead
            overline="فرآیند همکاری صادراتی"
            title={
              <>
                از استعلام تا <em>تحویل در مقصد</em>
              </>
            }
          />
          <div className="steps">
            {[
              { t: 'استعلام و آنالیز نیاز', d: 'بررسی بازار مقصد، نوع بسته‌بندی و حجم موردنیاز با تیم بازرگانی.' },
              { t: 'نمونه و مستندات', d: 'ارسال نمونه آزمایشگاهی همراه با آنالیز، گواهی حلال و بهداشت.' },
              { t: 'تولید و بسته‌بندی صادراتی', d: 'بچ اختصاصی با لیبل زبان مقصد و بسته‌بندی مقاوم به حمل‌ونقل.' },
              { t: 'بارگیری و پشتیبانی', d: 'پالت‌بندی استاندارد، اسناد گمرکی کامل و پشتیبانی پس از فروش.' },
            ].map((s, i) => (
              <Reveal key={s.t} delay={i * 0.14} className="step">
                <div className="step__num">{(i + 1).toLocaleString('fa-IR')}</div>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <CTABand
        title="شریک صادراتی بعدی ما شما باشید"
        text="تیم بازرگانی خارجی خمیرمایه خوزستان آماده مذاکره، ارسال نمونه و ثبت سفارش صادراتی است."
        primary={{ to: '/contact', label: 'درخواست همکاری در صادرات' }}
        secondary={{ href: COMPANY.socials[0].href, label: 'گفت‌وگو در واتس‌اپ' }}
      />
    </>
  );
}
