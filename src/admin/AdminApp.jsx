import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import Logo from '../components/Logo';
import { Icons } from '../components/ui';
import { api, tokenGet, tokenSet, useContent } from '../content/ContentContext';
import { ProductsTab, PostsTab, TextsTab, MediaTab, LinksTab, ContactTab, MessagesTab } from './tabs';
import './admin.scss';

const TABS = [
  { id: 'products', label: 'محصولات', icon: 'pack' },
  { id: 'posts', label: 'وبلاگ', icon: 'doc' },
  { id: 'texts', label: 'متون سایت', icon: 'spark' },
  { id: 'media', label: 'تصاویر صفحات', icon: 'star' },
  { id: 'links', label: 'پیوندها', icon: 'globe' },
  { id: 'contact', label: 'اطلاعات تماس', icon: 'phone' },
  { id: 'messages', label: 'پیام‌های مردم', icon: 'mail' },
];

function Login({ onDone }) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const { token } = await api('/api/auth/login', { method: 'POST', body: { user, pass } });
      tokenSet(token);
      onDone();
    } catch {
      setErr('نام کاربری یا رمز عبور نادرست است.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin__login">
      <motion.form className="admin__login-card" initial={{ opacity: 0, y: 26 }} animate={{ opacity: 1, y: 0 }} onSubmit={submit}>
        <div style={{ display: 'grid', placeItems: 'center' }}>
          <Logo size={54} />
        </div>
        <h1>پنل مدیریت محتوا</h1>
        <p>شرکت خمیر مایه خوزستان — دسترسی مخصوص مدیر محتوا</p>
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 700 }}>نام کاربری</span>
          <input value={user} onChange={(e) => setUser(e.target.value)} dir="ltr" autoFocus />
        </label>
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 700 }}>رمز عبور</span>
          <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} dir="ltr" />
        </label>
        <button className="btn btn--primary" disabled={busy} type="submit">
          ورود به پنل
        </button>
        {err && <div className="admin__login-err">{err}</div>}
        <p style={{ marginTop: 18, fontSize: 12 }}>
          <Link to="/">← بازگشت به وب‌سایت</Link>
        </p>
      </motion.form>
    </div>
  );
}

export default function AdminApp() {
  const { backend, t } = useContent();
  const [authed, setAuthed] = useState(null); // null = checking
  const [tab, setTab] = useState('products');

  useEffect(() => {
    if (!tokenGet()) return setAuthed(false);
    api('/api/auth/me', { auth: true })
      .then(() => setAuthed(true))
      .catch(() => {
        tokenSet('');
        setAuthed(false);
      });
  }, []);

  if (authed === null) return <div className="admin" style={{ display: 'grid', placeItems: 'center', minHeight: '100svh' }}>…</div>;
  if (!authed) return <div className="admin">{<Login onDone={() => setAuthed(true)} />}</div>;

  const Tab = { products: ProductsTab, posts: PostsTab, texts: TextsTab, media: MediaTab, links: LinksTab, contact: ContactTab, messages: MessagesTab }[tab];

  return (
    <div className="admin">
      <div className="admin__shell">
        <aside className="admin__side">
          <div className="admin__side-brand">
            <Logo size={40} />
            <div>
              <strong>{t('global.company.short')}</strong>
              <small>CONTENT ADMIN</small>
            </div>
          </div>
          {TABS.map((tb) => {
            const Ic = Icons[tb.icon];
            return (
              <button key={tb.id} className={tab === tb.id ? 'is-active' : ''} onClick={() => setTab(tb.id)}>
                <Ic size={18} />
                {tb.label}
              </button>
            );
          })}
          <div className="spacer" />
          <Link to="/" target="_blank">
            <Icons.globe size={15} style={{ display: 'inline-block', verticalAlign: '-3px', marginLeft: 6 }} />
            مشاهده وب‌سایت
          </Link>
          <a
            href="#logout"
            onClick={(e) => {
              e.preventDefault();
              tokenSet('');
              setAuthed(false);
            }}
          >
            <Icons.arrow size={15} style={{ display: 'inline-block', verticalAlign: '-3px', marginLeft: 6 }} />
            خروج از پنل
          </a>
        </aside>
        <main className="admin__main">
          {!backend && (
            <p style={{ background: 'var(--crimson-soft)', color: 'var(--crimson-700)', borderRadius: 12, padding: '10px 16px', marginBottom: 18 }}>
              سرور محتوا در دسترس نیست؛ تغییرات ذخیره نخواهد شد. (سرور Node را اجرا کنید: npm run server)
            </p>
          )}
          <Tab />
        </main>
      </div>
    </div>
  );
}
