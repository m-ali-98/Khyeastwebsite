/* ==========================================================================
   The customer's own panel: orders, addresses, profile.
   ========================================================================== */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icons, Reveal, PageHero, faNum, faId, PasswordInput } from '../components/ui';
import PagePending from '../components/PagePending';
import { useContent } from '../content/ContentContext';
import { useAccount } from '../shop/AccountContext';
import { useShop } from '../shop/ShopContext';
import { PROVINCES } from '../../shared/iranGeo.js';
import usePageMeta from '../hooks/usePageMeta';

const STATUS_FA = {
  pending_payment: 'در انتظار پرداخت',
  paid: 'پرداخت‌شده',
  shipped: 'ارسال‌شده',
  delivered: 'تحویل‌شده',
  cancelled: 'لغو شده',
};

const EMPTY_ADDRESS = {
  title: '',
  receiver: '',
  phone: '',
  province: '',
  city: '',
  address: '',
  plaque: '',
  unit: '',
  postal: '',
  note: '',
};

/* Defined at module scope, not inside AddressForm.
   A component declared inside another component is a brand-new type on every
   render, so React cannot match it to the previous tree: it unmounts the old
   input and mounts a fresh one. The DOM node the visitor was typing into no
   longer exists, so focus — and the caret — go with it, which is why typing
   stopped dead after a single character. */
function AddrField({ name, label, value, onChange, error, type = 'text', dir, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children || <input type={type} dir={dir} value={value ?? ''} onChange={onChange} />}
      {error && <small className="field__err">{error}</small>}
    </label>
  );
}

function AddressForm({ initial, onSave, onCancel, t }) {
  const [a, setA] = useState({ ...EMPTY_ADDRESS, ...initial });
  const [fields, setFields] = useState({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setA({ ...a, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    setFields({});
    try {
      await onSave(a);
    } catch (ex) {
      /* The server names the broken field; showing it under that field is
         the difference between "fix this" and "something was wrong". */
      setErr(ex.message);
      setFields(ex.fields || {});
    } finally {
      setBusy(false);
    }
  };

  /* Bound explicitly rather than through a local wrapper component: a
     component defined inside this function would itself be a new type on
     every render, which is the bug being fixed. A plain object of shared
     props keeps the element type stable. */
  const bind = (name) => ({ name, value: a[name], onChange: set(name), error: fields[name] });

  return (
    <form className="addr-form" onSubmit={submit} noValidate>
      <div className="addr-form__grid">
        <AddrField {...bind('title')} label={t('shop.account.addrTitle')} />
        <AddrField {...bind('receiver')} label={t('shop.account.receiver')} />
        <AddrField {...bind('phone')} label={t('shop.account.receiverPhone')} type="tel" dir="ltr" />
        <AddrField {...bind('province')} label={t('shop.account.province')}>
          <select value={a.province} onChange={set('province')}>
            <option value="">{t('shop.account.selectProvince')}</option>
            {PROVINCES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </AddrField>
        <AddrField {...bind('city')} label={t('shop.account.city')} />
        <AddrField {...bind('postal')} label={t('shop.account.postal')} dir="ltr" />
        <AddrField {...bind('plaque')} label={t('shop.account.plaque')} />
        <AddrField {...bind('unit')} label={t('shop.account.unit')} />
      </div>
      <AddrField {...bind('address')} label={t('shop.account.address')}>
        <textarea rows={2} value={a.address} onChange={set('address')} />
      </AddrField>
      <AddrField {...bind('note')} label={t('shop.account.addrNote')} />

      {err && <p className="note err">{err}</p>}

      <div className="addr-form__actions">
        <button className="btn btn--primary" type="submit" disabled={busy}>
          {t('shop.account.saveAddress')}
        </button>
        <button className="btn btn--outline" type="button" onClick={onCancel}>
          {t('shop.account.cancel')}
        </button>
      </div>
    </form>
  );
}

export default function ShopAccount() {
  const { t } = useContent();
  const { money } = useShop();
  const account = useAccount();
  const navigate = useNavigate();
  const [tab, setTab] = useState('orders');
  const [editing, setEditing] = useState(null); // 'new' | address id
  const [profile, setProfile] = useState({ name: '', email: '' });
  const [pw, setPw] = useState({ current: '', password: '' });
  const [note, setNote] = useState(null);

  usePageMeta(t('shop.account.title'));

  /* 'loading' is distinct from 'out' so a refresh does not bounce a
     signed-in customer to the login page for one frame.

     `leaving` covers the other direction: signing out also makes the status
     'out', and without it this guard raced the logout button and sent the
     visitor to a login page asking them to sign in again — immediately
     after they asked to sign out. A ref, not state, because the guard must
     see the new value in the same tick. */
  const leaving = useRef(false);
  useEffect(() => {
    if (leaving.current) return;
    if (account.status === 'out') navigate('/shop/login?next=/shop/account', { replace: true });
  }, [account.status, navigate]);

  useEffect(() => {
    if (account.customer) setProfile({ name: account.customer.name || '', email: account.customer.email || '' });
  }, [account.customer]);

  if (account.status !== 'in') {
    return (
      <section className="section">
        <div className="container">
          <PagePending label={t('shop.account.title')} />
        </div>
      </section>
    );
  }

  const say = (kind, msg) => {
    setNote({ kind, msg });
    setTimeout(() => setNote(null), 3000);
  };

  const saveAddress = async (a) => {
    if (editing === 'new') await account.addAddress(a);
    else await account.updateAddress(editing, a);
    setEditing(null);
    say('ok', t('shop.account.saved'));
  };

  const saveProfile = async (e) => {
    e.preventDefault();
    try {
      await account.saveProfile(profile);
      say('ok', t('shop.account.saved'));
    } catch (ex) {
      say('err', ex.message);
    }
  };

  const savePassword = async (e) => {
    e.preventDefault();
    try {
      await account.changePassword(pw.current, pw.password);
      setPw({ current: '', password: '' });
      say('ok', t('shop.account.pwDone'));
    } catch (ex) {
      say('err', ex.message);
    }
  };

  const TABS = [
    ['orders', t('shop.account.tabOrders'), 'orders'],
    ['addresses', t('shop.account.tabAddresses'), 'pin'],
    ['profile', t('shop.account.tabProfile'), 'users'],
  ];

  return (
    <>
      <PageHero title={t('shop.account.title')} sub={t('shop.account.sub')} crumb={t('nav.shop')} />

      <section className="section">
        <div className="container acc-layout">
          <aside className="acc-side">
            <div className="acc-who">
              <strong>{account.customer.name}</strong>
              <span dir="ltr">{faId(account.customer.phoneLocal)}</span>
            </div>
            <nav className="acc-nav">
              {TABS.map(([id, label, icon]) => {
                const Ic = Icons[icon];
                return (
                  <button key={id} className={`acc-nav__item ${tab === id ? 'is-active' : ''}`} onClick={() => setTab(id)}>
                    <Ic size={17} />
                    {label}
                  </button>
                );
              })}
              <button
                className="acc-nav__item acc-nav__item--out"
                onClick={async () => {
                  leaving.current = true;
                  await account.logout();
                  /* replace, so Back does not return to a panel that is no
                     longer readable */
                  navigate('/shop', { replace: true });
                }}
              >
                {t('shop.account.logout')}
              </button>
            </nav>
          </aside>

          <div className="acc-main">
            {note && <p className={`note ${note.kind === 'err' ? 'err' : 'ok'}`}>{note.msg}</p>}

            {tab === 'orders' && (
              <Reveal>
                {account.orders.length === 0 ? (
                  <div className="acc-empty">
                    <p>{t('shop.account.noOrders')}</p>
                    <Link className="btn btn--primary" to="/shop">
                      {t('shop.account.goShop')}
                    </Link>
                  </div>
                ) : (
                  <div className="acc-orders">
                    {account.orders.map((o) => (
                      <article className="acc-order" key={o.code}>
                        <header>
                          <span className="acc-order__code" dir="ltr">
                            {o.code}
                          </span>
                          <span className={`acc-order__status is-${o.status}`}>{STATUS_FA[o.status] || o.status}</span>
                        </header>
                        <div className="acc-order__body">
                          <span>{faId(new Date(o.at).toLocaleDateString('fa-IR'))}</span>
                          <span>{money(o.total)}</span>
                          <span>
                            {faNum(o.items.length)} {t('shop.cart.items') || 'قلم'}
                          </span>
                        </div>
                        <Link className="btn btn--outline btn--sm" to={`/shop/order/${o.code}?token=${o.trackToken}`}>
                          {t('shop.account.viewOrder')}
                        </Link>
                      </article>
                    ))}
                  </div>
                )}
              </Reveal>
            )}

            {tab === 'addresses' && (
              <Reveal>
                {editing ? (
                  <AddressForm
                    t={t}
                    initial={editing === 'new' ? {} : account.addresses.find((x) => x.id === editing)}
                    onSave={saveAddress}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <>
                    <button className="btn btn--primary" onClick={() => setEditing('new')}>
                      <Icons.pin size={17} />
                      {t('shop.account.addAddress')}
                    </button>
                    {account.addresses.length === 0 && <p className="acc-empty">{t('shop.account.noAddresses')}</p>}
                    <div className="acc-addresses">
                      {account.addresses.map((a) => (
                        <article className={`acc-addr ${a.isDefault ? 'is-default' : ''}`} key={a.id}>
                          <header>
                            <strong>{a.title}</strong>
                            {a.isDefault && <span className="acc-addr__badge">{t('shop.account.isDefault')}</span>}
                          </header>
                          <p>
                            {a.province}، {a.city}، {a.address}
                            {a.plaque && `، پلاک ${faId(a.plaque)}`}
                            {a.unit && `، واحد ${faId(a.unit)}`}
                          </p>
                          <p className="acc-addr__meta">
                            {a.receiver} — <span dir="ltr">{faId(a.phone.replace(/^98/, '0'))}</span> — {t('shop.account.postal')}:{' '}
                            <span dir="ltr">{faId(a.postal)}</span>
                          </p>
                          <div className="acc-addr__actions">
                            <button className="linkish" onClick={() => setEditing(a.id)}>
                              {t('shop.account.edit')}
                            </button>
                            {!a.isDefault && (
                              <button className="linkish" onClick={() => account.makeDefault(a.id)}>
                                {t('shop.account.makeDefault')}
                              </button>
                            )}
                            <button
                              className="linkish danger"
                              onClick={() => {
                                if (window.confirm(t('shop.account.confirmDel'))) account.removeAddress(a.id);
                              }}
                            >
                              {t('shop.account.del')}
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </>
                )}
              </Reveal>
            )}

            {tab === 'profile' && (
              <Reveal className="acc-profile">
                <form onSubmit={saveProfile}>
                  {/* The page's h1 is the hero title, so these are h2. They
                      are also siblings doing the same job: giving one of
                      them a heading and not the other left the second form
                      looking like part of the first to anyone navigating by
                      structure. */}
                  <h2>{t('shop.account.tabProfile')}</h2>
                  <label className="field">
                    <span>{t('shop.account.phoneFixed')}</span>
                    {/* The phone is the account identity and is verified, so
                        it is not editable inline — changing it has to go
                        through a code sent to the new number. */}
                    <input type="tel" dir="ltr" value={account.customer.phoneLocal} readOnly disabled />
                  </label>
                  <label className="field">
                    <span>{t('shop.account.name')}</span>
                    <input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
                  </label>
                  <label className="field">
                    <span>{t('shop.account.email')}</span>
                    <input type="email" dir="ltr" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
                  </label>
                  <button className="btn btn--primary" type="submit">
                    {t('shop.account.saveProfile')}
                  </button>
                </form>

                <form onSubmit={savePassword} className="acc-pw">
                  <h2>{t('shop.account.pwTitle')}</h2>
                  <label className="field">
                    <span>{t('shop.account.pwCurrent')}</span>
                    <PasswordInput autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
                  </label>
                  <label className="field">
                    <span>{t('shop.account.pwNew')}</span>
                    <PasswordInput autoComplete="new-password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} />
                  </label>
                  <button className="btn btn--outline" type="submit">
                    {t('shop.account.pwSave')}
                  </button>
                </form>
              </Reveal>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
