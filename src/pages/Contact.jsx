import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Icons, Reveal, PageHero, socialIcon } from '../components/ui';
import { useContent } from '../content/ContentContext';

function OfficeCard({ office, index }) {
  const Ic = Icons[office.icon] || Icons.pin;
  return (
    <Reveal delay={index * 0.1} className="card contact-card">
      <div className="contact-card__icon">
        <Ic size={26} />
      </div>
      <div>
        <h3>{office.title}</h3>
        <p>{office.address}</p>
        <p style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {(office.phones || []).map((ph) => (
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
  const { t, col, backend } = useContent();
  const subjects = col('subjects');
  const [form, setForm] = useState({ name: '', phone: '', email: '', subject: subjects[0] || '', message: '' });
  const [sent, setSent] = useState(false);
  const [errors, setErrors] = useState({});
  const [sending, setSending] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.name.trim()) errs.name = t('contact.form.errName');
    if (!form.phone.trim()) errs.phone = t('contact.form.errPhone');
    if (!form.message.trim()) errs.message = t('contact.form.errMessage');
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSending(true);
    try {
      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      setSent(true);
    } catch {
      if (backend) setErrors({ submit: t('contact.form.errSend') });
      else setSent(true);
    } finally {
      setSending(false);
    }
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
            <h3 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 10px' }}>{t('contact.form.successTitle')}</h3>
            <p style={{ color: 'var(--muted)', maxWidth: 420, margin: '0 auto 26px' }}>
              {t('contact.form.successText')}
            </p>
            <button className="btn btn--outline" onClick={() => setSent(false)}>
              {t('contact.form.again')}
            </button>
          </motion.div>
        ) : (
          <motion.form
            key="form"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -14 }}
            onSubmit={submit}
            noValidate
          >
            <h3 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 800 }}>{t('contact.form.title')}</h3>
            <p style={{ color: 'var(--muted)', margin: '0 0 26px', fontSize: 14.5 }}>{t('contact.form.sub')}</p>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="name">{t('contact.form.name')}</label>
                <input id="name" value={form.name} onChange={set('name')} />
                {errors.name && <small style={{ color: 'var(--crimson)' }}>{errors.name}</small>}
              </div>
              <div className="field">
                <label htmlFor="phone">{t('contact.form.phone')}</label>
                <input id="phone" value={form.phone} onChange={set('phone')} inputMode="tel" />
                {errors.phone && <small style={{ color: 'var(--crimson)' }}>{errors.phone}</small>}
              </div>
              <div className="field">
                <label htmlFor="email">{t('contact.form.email')}</label>
                <input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={set('email')}
                  dir="ltr"
                  style={{ textAlign: 'left' }}
                />
              </div>
              <div className="field">
                <label htmlFor="subject">{t('contact.form.subject')}</label>
                <select id="subject" value={form.subject} onChange={set('subject')}>
                  {subjects.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="field field--full">
                <label htmlFor="message">{t('contact.form.message')}</label>
                <textarea id="message" value={form.message} onChange={set('message')} />
                {errors.message && <small style={{ color: 'var(--crimson)' }}>{errors.message}</small>}
              </div>
              <div className="field--full">
                <motion.button type="submit" className="btn btn--primary" whileTap={{ scale: 0.97 }} disabled={sending}>
                  {t('contact.form.submit')}
                  <Icons.send size={18} />
                </motion.button>
                {errors.submit && <small style={{ color: 'var(--crimson)', marginInlineStart: 14 }}>{errors.submit}</small>}
              </div>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function Contact() {
  const { t, m, col } = useContent();
  const offices = col('offices');
  const socials = col('socials');

  return (
    <>
      <PageHero title={t('contact.hero.title')} sub={t('contact.hero.sub')} image={m('contact.hero.img')} />

      <section className="section">
        <div className="container">
          <div className="contact-grid" style={{ marginBottom: 24 }}>
            {offices.map((o, i) => (
              <OfficeCard key={o.id} office={o} index={i} />
            ))}
            <Reveal delay={0.3} className="card contact-card">
              <div className="contact-card__icon">
                <Icons.whatsapp size={26} />
              </div>
              <div>
                <h3>{t('contact.quick.title')}</h3>
                <p>{t('contact.quick.text')}</p>
                <p style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                  <a href={`mailto:${t('global.email')}`}>
                    <Icons.mail size={14} style={{ display: 'inline-block', verticalAlign: '-2px', marginLeft: 5 }} />
                    {t('global.email')}
                  </a>
                  {socials.map((s) => {
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
