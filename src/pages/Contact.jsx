import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Icons, Reveal, PageHero, socialIcon } from '../components/ui';
import { COMPANY } from '../data/site';

const SUBJECTS = [
  'استعلام قیمت و خرید عمده',
  'همکاری در صادرات خمیرمایه',
  'درخواست نمونه آزمایشگاهی',
  'اخذ نمایندگی توزیع استانی',
  'سایر امور اداری و بازرگانی',
];

function OfficeCard({ office, index }) {
  const iconMap = { tehran: 'pin', dezful: 'factory', kermanshah: 'factory' };
  const Ic = Icons[iconMap[office.id]] || Icons.pin;
  return (
    <Reveal delay={index * 0.1} className="card contact-card">
      <div className="contact-card__icon">
        <Ic size={26} />
      </div>
      <div>
        <h3>{office.title}</h3>
        <p>{office.address}</p>
        <p style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {office.phones.map((ph) => (
            <a key={ph.tel} href={`tel:${ph.tel}`}>
              <Icons.phone size={14} style={{ display: 'inline-block', verticalAlign: '-2px', marginLeft: 5 }} />
              {ph.fa}
            </a>
          ))}
        </p>
      </div>
    </Reveal>
  );
}

function ContactForm() {
  const [form, setForm] = useState({ name: '', phone: '', email: '', subject: SUBJECTS[0], message: '' });
  const [sent, setSent] = useState(false);
  const [errors, setErrors] = useState({});

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.name.trim()) errs.name = 'نام و نام خانوادگی الزامی است.';
    if (!/^09\d{9}$|^0\d{10}$/.test(form.phone.replace(/\s/g, ''))) errs.phone = 'شماره تماس معتبر وارد کنید.';
    if (!form.message.trim()) errs.message = 'متن پیام الزامی است.';
    setErrors(errs);
    if (Object.keys(errs).length === 0) setSent(true);
  };

  return (
    <div className="card" style={{ padding: '40px 40px', position: 'relative', overflow: 'hidden' }}>
      <AnimatePresence mode="wait">
        {sent ? (
          <motion.div
            key="sent"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            style={{ textAlign: 'center', padding: '50px 10px' }}
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 14, delay: 0.1 }}
              style={{
                width: 92,
                height: 92,
                margin: '0 auto 24px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, var(--crimson), var(--crimson-700))',
                display: 'grid',
                placeItems: 'center',
                color: '#fff',
                boxShadow: '0 24px 60px -18px var(--crimson-glow)',
              }}
            >
              <Icons.check size={44} />
            </motion.div>
            <h3 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 10px' }}>پیام شما ثبت شد</h3>
            <p style={{ color: 'var(--muted)', maxWidth: 420, margin: '0 auto 26px' }}>
              کارشناسان واحد بازرگانی در نخستین ساعت کاری با شما تماس می‌گیرند. سپاس از اعتمادتان.
            </p>
            <button className="btn btn--outline" onClick={() => setSent(false)}>
              ارسال پیام دیگر
            </button>
          </motion.div>
        ) : (
          <motion.form key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -14 }} onSubmit={submit} noValidate>
            <h3 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 800 }}>ارسال پیام و استعلام قیمت</h3>
            <p style={{ color: 'var(--muted)', margin: '0 0 26px', fontSize: 14.5 }}>
              فرم زیر را تکمیل کنید؛ واحد بازرگانی خمیرمایه خوزستان در اسرع وقت پاسخ‌گوی شماست.
            </p>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="name">نام و نام خانوادگی *</label>
                <input id="name" value={form.name} onChange={set('name')} placeholder="نام کامل" />
                {errors.name && <small style={{ color: 'var(--crimson)' }}>{errors.name}</small>}
              </div>
              <div className="field">
                <label htmlFor="phone">شماره تماس همراه *</label>
                <input id="phone" value={form.phone} onChange={set('phone')} placeholder="۰۹۱۲۳۴۵۶۷۸۹" inputMode="tel" />
                {errors.phone && <small style={{ color: 'var(--crimson)' }}>{errors.phone}</small>}
              </div>
              <div className="field">
                <label htmlFor="email">پست الکترونیک</label>
                <input id="email" type="email" value={form.email} onChange={set('email')} placeholder="you@company.com" dir="ltr" style={{ textAlign: 'left' }} />
              </div>
              <div className="field">
                <label htmlFor="subject">موضوع درخواست *</label>
                <select id="subject" value={form.subject} onChange={set('subject')}>
                  {SUBJECTS.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="field field--full">
                <label htmlFor="message">متن پیام یا توضیحات سفارش *</label>
                <textarea id="message" value={form.message} onChange={set('message')} placeholder="حجم موردنیاز، نوع بسته‌بندی و مقصد سفارش را بنویسید…" />
                {errors.message && <small style={{ color: 'var(--crimson)' }}>{errors.message}</small>}
              </div>
              <div className="field--full">
                <motion.button type="submit" className="btn btn--primary" whileTap={{ scale: 0.97 }}>
                  ارسال پیام به واحد بازرگانی
                  <Icons.send size={18} />
                </motion.button>
              </div>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function Contact() {
  return (
    <>
      <PageHero
        title="تماس با شرکت خمیر مایه خوزستان"
        sub="برای سفارش، مشاوره فنی، همکاری در صادرات و اخذ نمایندگی، از هر مسیر که راحت‌ترید با ما در ارتباط باشید."
        image="/assets/img/hero-wheat.jpg"
      />

      <section className="section">
        <div className="container">
          <div className="contact-grid" style={{ marginBottom: 24 }}>
            {COMPANY.offices.map((o, i) => (
              <OfficeCard key={o.id} office={o} index={i} />
            ))}
            <Reveal delay={0.3} className="card contact-card">
              <div className="contact-card__icon">
                <Icons.whatsapp size={26} />
              </div>
              <div>
                <h3>ارتباط سریع و شبکه‌های اجتماعی</h3>
                <p>واحد فروش و پشتیبانی، همه‌روزه پاسخ‌گوی شماست.</p>
                <p style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                  <a href={`mailto:${COMPANY.email}`}>
                    <Icons.mail size={14} style={{ display: 'inline-block', verticalAlign: '-2px', marginLeft: 5 }} />
                    {COMPANY.email}
                  </a>
                  {COMPANY.socials.map((s) => {
                    const Ic = socialIcon(s.id);
                    return (
                      <a key={s.id} href={s.href} target="_blank" rel="noreferrer">
                        <Ic size={14} style={{ display: 'inline-block', verticalAlign: '-2px', marginLeft: 5 }} />
                        {s.label}
                      </a>
                    );
                  })}
                </p>
              </div>
            </Reveal>
          </div>

          <Reveal delay={0.1}>
            <ContactForm />
          </Reveal>
        </div>
      </section>
    </>
  );
}
