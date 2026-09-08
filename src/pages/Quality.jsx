import { Icons, Reveal, SectionHead, PageHero, CTABand } from '../components/ui';
import { CERTS } from '../data/site';

const QC_STEPS = [
  { icon: 'leaf', t: 'کنترل مواد اولیه', d: 'نمونه‌برداری و آزمون هر محموله مواد اولیه پیش از ورود به خط تولید.' },
  { icon: 'flask', t: 'پایش حین تولید', d: 'کنترل لحظه‌ای پارامترهای تخمیر، خشک‌کردن و دانه‌بندی در اتاق کنترل.' },
  { icon: 'pack', t: 'آزمون محصول نهایی', d: 'سنجش قدرت تخمیر، رطوبت و خلوص سویه در آزمایشگاه مجهز کارخانه.' },
  { icon: 'globe', t: 'پایش بین‌المللی VH برلین', d: 'ارسال ماهانه نمونه به انستیتو تحقیقاتی VH برلین برای آزمون مقایسه‌ای.' },
];

export default function Quality() {
  const iconMap = {
    iso: 'shield',
    halal: 'check',
    haccp: 'flask',
    iran: 'star',
    vh: 'globe',
    frings: 'gear',
    lab: 'temp',
    export: 'send',
  };
  return (
    <>
      <PageHero
        title="مدیریت کیفیت و گواهینامه‌ها"
        sub="تضمین بالاترین استانداردهای ایمنی مواد غذایی و کنترل کیفیت در هر مرحله از تولید؛ از ماده اولیه تا اولین برش نان."
        image="/assets/img/laboratory.jpg"
      />

      <section className="section">
        <div className="container">
          <div className="split">
            <Reveal x={40} y={0}>
              <div className="split__media">
                <span className="badge-float">VH Berlin Member</span>
                <div className="img-main">
                  <img src="/assets/img/laboratory.jpg" alt="آزمایشگاه کنترل کیفیت" loading="lazy" />
                </div>
              </div>
            </Reveal>
            <Reveal x={-40} y={0} delay={0.1}>
              <span className="overline">کنترل کیفیت در هر مرحله</span>
              <h2 className="section-title">
                کیفیتی جهانی، <em>پایش‌شده در برلین</em>
              </h2>
              <p style={{ color: 'var(--muted)' }}>
                تیم کنترل کیفیت خمیرمایه خوزستان در تلاش شبانه‌روزی در راستای دستیابی به کیفیتی
                جهانی و شناسایی ارزش‌های رقابتی است که رضایت کامل مشتریان را فراهم می‌نماید. این تیم
                به‌طور مستمر از کلیه مواد اولیه، مراحل تولید و محصولات نهایی نمونه‌برداری و آزمون
                می‌کند.
              </p>
              <p style={{ color: 'var(--muted)' }}>
                شرکت خمیرمایه خوزستان به منظور تأیید روش‌های آزمون و مقایسه‌های بین‌آزمایشگاهی،
                سال‌هاست به عضویت انستیتو تحقیقات VH برلین درآمده و ماهانه نمونه‌هایی از محصولات و
                مواد اولیه خود را به این مرکز در آلمان ارسال می‌کند؛ یکی از معتبرترین مراکز تحقیقاتی
                دنیا در زمینه مخمر نان.
              </p>
              <ul className="check-list">
                <li>
                  <Icons.check size={20} />
                  آزمون قدرت تخمیر هر بچ تولید پیش از خروج از کارخانه
                </li>
                <li>
                  <Icons.check size={20} />
                  پایش رطوبت، خاکستر و پروتئین مطابق استاندارد ملی ایران
                </li>
                <li>
                  <Icons.check size={20} />
                  ممیزی دوره‌ای داخلی بر پایه BS EN ISO 9001:2015
                </li>
              </ul>
            </Reveal>
          </div>
        </div>
      </section>

      <section className="section section--soft">
        <div className="container">
          <SectionHead
            overline="گواهینامه‌ها و افتخارات"
            title={
              <>
                مهرهای تأییدی که <em>داستان ما را امضا می‌کنند</em>
              </>
            }
          />
          <div className="certs-grid">
            {CERTS.map((c, i) => {
              const Ic = Icons[iconMap[c.id]] || Icons.shield;
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
          <SectionHead
            overline="چرخه پایش کیفیت"
            title={
              <>
                چهار ایستگاه، <em>صفر مماشات</em>
              </>
            }
          />
          <div className="steps">
            {QC_STEPS.map((s, i) => {
              const Ic = Icons[s.icon];
              return (
                <Reveal key={s.t} delay={i * 0.14} className="step">
                  <div className="step__num" style={{ fontSize: 0 }}>
                    <Ic size={34} />
                  </div>
                  <h3>{s.t}</h3>
                  <p>{s.d}</p>
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
                <h2>تقدیرنامه‌ها و جوایز</h2>
                <p>
                  تمرکز بر بازار و تعهد به ایجاد ارزش برای مشتری، ما را موفق به دریافت تقدیرنامه‌های
                  متعددی از سازمان‌ها و وزارتخانه‌های دولتی نموده است؛ از جمله تقدیرنامه صادرکننده
                  نمونه استانی و تقدیرنامه بانک توسعه صادرات ایران.
                </p>
              </div>
              <div className="cta-band__actions">
                <a className="btn btn--light" href="mailto:info@khuzestanyeast-co.com">
                  <Icons.doc size={18} />
                  درخواست مستندات کیفی
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
