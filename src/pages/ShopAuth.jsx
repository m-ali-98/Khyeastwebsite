/* ==========================================================================
   Sign in / register / reset — one page, three paths.

   Registration is a three-step flow on purpose: phone, code, then password
   and name. Asking for everything at once and only then discovering the
   number is unreachable wastes the customer's time and one SMS.
   ========================================================================== */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Icons, Reveal, PageHero, PasswordInput } from '../components/ui';
import PagePending from '../components/PagePending';
import { useContent } from '../content/ContentContext';
import { useAccount } from '../shop/AccountContext';
import usePageMeta from '../hooks/usePageMeta';

const faDigits = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

export default function ShopAuth() {
  const { t } = useContent();
  const account = useAccount();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/shop/account';

  const [mode, setMode] = useState(params.get('mode') === 'register' ? 'register' : 'login');
  const [step, setStep] = useState('phone'); // phone → code → details
  const [form, setForm] = useState({ phone: '', password: '', code: '', name: '' });
  const [ticket, setTicket] = useState('');
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef(null);

  usePageMeta(t('shop.auth.title'));

  /* Already signed in? There is nothing to do on this page. */
  useEffect(() => {
    if (account.status === 'in') navigate(next, { replace: true });
  }, [account.status, navigate, next]);

  /* The resend countdown. One interval, cleared on unmount. */
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus();
  }, [step]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const fail = (e, fallback) => setNote({ kind: 'err', msg: e?.message || t(fallback) });

  const switchMode = (m) => {
    setMode(m);
    setStep('phone');
    setNote(null);
    setTicket('');
    setForm((f) => ({ ...f, code: '', password: '' }));
  };

  const purpose = mode === 'reset' ? 'reset' : 'register';

  const sendCode = async () => {
    setBusy(true);
    setNote(null);
    try {
      const d = await account.requestCode(form.phone, purpose);
      setStep('code');
      setCooldown(d.resendAfter || 90);
      setNote({ kind: 'ok', msg: t('shop.auth.codeSent') });
    } catch (e) {
      /* 429 carries its own, more useful sentence (how long to wait). */
      if (e.retryAfter) setCooldown(e.retryAfter);
      fail(e, 'shop.auth.errServer');
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setNote(null);
    try {
      const d = await account.verifyCode(form.phone, form.code, purpose);
      setTicket(d.ticket);
      setStep('details');
    } catch (e) {
      fail(e, 'shop.auth.errCode');
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    setNote(null);
    try {
      if (mode === 'reset') await account.resetPassword(ticket, form.password);
      else await account.register({ ticket, password: form.password, name: form.name });
      navigate(next, { replace: true });
    } catch (e) {
      fail(e, 'shop.auth.errServer');
    } finally {
      setBusy(false);
    }
  };

  const login = async () => {
    setBusy(true);
    setNote(null);
    try {
      await account.login(form.phone, form.password);
      navigate(next, { replace: true });
    } catch (e) {
      fail(e, 'shop.auth.errServer');
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e) => {
    e.preventDefault();
    if (busy) return;
    if (mode === 'login') return login();
    if (step === 'phone') return sendCode();
    if (step === 'code') return verify();
    return finish();
  };

  if (account.status !== 'out') {
    return (
      <section className="section">
        <div className="container">
          <PagePending label={t('shop.auth.title')} />
        </div>
      </section>
    );
  }

  return (
    <>
      <PageHero title={t('shop.auth.title')} sub={t('shop.auth.sub')} crumb={t('nav.shop')} />

      <section className="section">
        <div className="container">
          <Reveal className="auth-card">
            <div className="auth-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'login'}
                className={`auth-tab ${mode === 'login' ? 'is-active' : ''}`}
                onClick={() => switchMode('login')}
              >
                {t('shop.auth.tabLogin')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'register'}
                className={`auth-tab ${mode === 'register' ? 'is-active' : ''}`}
                onClick={() => switchMode('register')}
              >
                {t('shop.auth.tabRegister')}
              </button>
            </div>

            {mode === 'reset' && <h2 className="auth-card__title">{t('shop.auth.resetTitle')}</h2>}

            <form onSubmit={onSubmit} noValidate>
              {/* The phone is shown read-only once a code is on its way, so
                  the number being verified is always visible. */}
              <label className="field">
                <span>{t('shop.auth.phone')}</span>
                <input
                  type="tel"
                  dir="ltr"
                  inputMode="numeric"
                  autoComplete="tel"
                  placeholder={t('shop.auth.phoneHint')}
                  value={form.phone}
                  onChange={set('phone')}
                  readOnly={step !== 'phone' && mode !== 'login'}
                  required
                />
              </label>

              {mode === 'login' && (
                <label className="field">
                  <span>{t('shop.auth.password')}</span>
                  <PasswordInput autoComplete="current-password" value={form.password} onChange={set('password')} required />
                </label>
              )}

              {mode !== 'login' && step === 'code' && (
                <>
                  <label className="field">
                    <span>{t('shop.auth.code')}</span>
                    <input
                      ref={codeRef}
                      type="text"
                      dir="ltr"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={5}
                      value={form.code}
                      onChange={set('code')}
                      required
                    />
                  </label>
                  <div className="auth-row">
                    <button type="button" className="linkish" onClick={() => setStep('phone')}>
                      {t('shop.auth.changeNumber')}
                    </button>
                    <button type="button" className="linkish" onClick={sendCode} disabled={cooldown > 0 || busy}>
                      {cooldown > 0 ? t('shop.auth.resendIn').replace('{s}', faDigits(cooldown)) : t('shop.auth.resend')}
                    </button>
                  </div>
                </>
              )}

              {mode !== 'login' && step === 'details' && (
                <>
                  {mode === 'register' && (
                    <label className="field">
                      <span>{t('shop.auth.name')}</span>
                      <input type="text" autoComplete="name" value={form.name} onChange={set('name')} required />
                    </label>
                  )}
                  <label className="field">
                    <span>{mode === 'reset' ? t('shop.auth.passwordNew') : t('shop.auth.password')}</span>
                    <PasswordInput autoComplete="new-password" value={form.password} onChange={set('password')} required />
                    <small className="field__hint">{t('shop.auth.passwordHint')}</small>
                  </label>
                </>
              )}

              {note && <p className={`note ${note.kind === 'err' ? 'err' : 'ok'}`}>{note.msg}</p>}

              <button className="btn btn--primary btn--block" type="submit" disabled={busy}>
                {mode === 'login'
                  ? t('shop.auth.doLogin')
                  : step === 'phone'
                    ? t('shop.auth.sendCode')
                    : step === 'code'
                      ? t('shop.auth.verify')
                      : mode === 'reset'
                        ? t('shop.auth.pwSave') || t('shop.auth.doLogin')
                        : t('shop.auth.doRegister')}
                <Icons.arrow size={17} />
              </button>
            </form>

            <div className="auth-foot">
              {mode === 'login' ? (
                <>
                  <button type="button" className="linkish" onClick={() => switchMode('reset')}>
                    {t('shop.auth.forgot')}
                  </button>
                  <button type="button" className="linkish" onClick={() => switchMode('register')}>
                    {t('shop.auth.noAccount')}
                  </button>
                </>
              ) : (
                <button type="button" className="linkish" onClick={() => switchMode('login')}>
                  {t('shop.auth.haveAccount')}
                </button>
              )}
            </div>
          </Reveal>

          <p className="auth-back">
            <Link to="/shop">{t('shop.order.back')}</Link>
          </p>
        </div>
      </section>
    </>
  );
}
