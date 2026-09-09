import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import Logo from '../components/Logo';
import { Icons } from '../components/ui';
import { api, tokenGet, tokenSet, useContent } from '../content/ContentContext';
import { ProductsTab, PostsTab, TextsTab, MediaTab, LinksTab, ContactTab, MessagesTab } from './tabs';
import { ShopProductsTab, ShopOrdersTab, ShopCommentsTab, ShopPaymentTab } from './shopTabs';
import { TranslationsTab } from './i18nTab';
import { ProductsTransTab, PostsTransTab } from './entityTrans';
import { AdminLocaleProvider, useAdminLocale } from './adminLocale';
import { useLocale } from '../i18n/LocaleContext';
import { loadAllPacks } from '../../shared/i18n/index.js';
import './admin.scss';

/* `base: true` = tab edits the Persian source content. When the admin is
   editing English or Arabic, those tabs are replaced by the translation
   editor, while the language-neutral tabs (images, links, orders, messages)
   stay available. */
const TABS = [
  { id: 'products', label: 'محصولات', icon: 'pack' },
  { id: 'posts', label: 'وبلاگ', icon: 'doc' },
  { id: 'shop', label: 'فروشگاه — محصولات', icon: 'box', faOnly: true },
  { id: 'orders', label: 'سفارش‌ها', icon: 'send', faOnly: true },
  { id: 'comments', label: 'دیدگاه‌ها', icon: 'users', faOnly: true },
  { id: 'payment', label: 'درگاه پرداخت', icon: 'gear', faOnly: true },
  { id: 'texts', label: 'متون سایت', icon: 'spark', base: true },
  { id: 'translations', label: 'متون و فهرست‌ها', icon: 'globe', transOnly: true },
  { id: 'media', label: 'تصاویر صفحات', icon: 'star' },
  { id: 'links', label: 'پیوندها', icon: 'globe' },
  { id: 'contact', label: 'اطلاعات تماس', icon: 'phone', base: true },
  { id: 'messages', label: 'پیام‌های مردم', icon: 'mail' },
];

/* Light / dark switch for the panel. Shares the site-wide theme, so whichever
   the admin picks here is also what they see on the public site. */
function AdminThemeBar() {
  const { theme, setTheme } = useLocale();
  return (
    <div className="admin__themebar">
      <span>نمای پنل</span>
      <div className="admin__themebtns">
        <button type="button" className={theme === 'light' ? 'is-active' : ''} onClick={() => setTheme('light')}>
          <Icons.sun size={14} />
          روشن
        </button>
        <button type="button" className={theme === 'dark' ? 'is-active' : ''} onClick={() => setTheme('dark')}>
          <Icons.moon size={14} />
          تاریک
        </button>
      </div>
    </div>
  );
}

/* Language selector for the panel itself. */
function AdminLangBar() {
  const { locale, setLocale, locales } = useAdminLocale();
  return (
    <div className="admin__langbar">
      <span>زبان محتوا</span>
      <div className="admin__langbtns">
        {locales.map((lo) => (
          <button
            key={lo.code}
            className={locale === lo.code ? 'is-active' : ''}
            onClick={() => setLocale(lo.code)}
            type="button"
          >
            {lo.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Login({ onDone }) {
  const { isDark, toggleTheme } = useLocale();
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
      {/* the sidebar toggle is not mounted yet, so the login screen carries
          its own so the panel can be opened straight into the right theme */}
      <button
        type="button"
        className="admin__login-theme"
        onClick={toggleTheme}
        aria-label={isDark ? 'نمای روشن' : 'نمای تاریک'}
        title={isDark ? 'نمای روشن' : 'نمای تاریک'}
      >
        {isDark ? <Icons.sun size={17} /> : <Icons.moon size={17} />}
      </button>
      <motion.form className="admin__login-card" initial={{ opacity: 0, y: 26 }} animate={{ opacity: 1, y: 0 }} onSubmit={submit}>
        <div style={{ display: 'grid', placeItems: 'center' }}>
          <Logo size={54} className="admin__logo-mark" />
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

function AdminShell() {
  const { backend, t } = useContent();
  const { locale, isBase } = useAdminLocale();
  const [authed, setAuthed] = useState(null); // null = checking
  const [tab, setTab] = useState('products');
  const [packsReady, setPacksReady] = useState(false);

  /* The panel edits every language, so it needs both dictionaries in memory —
     the translation editors read them for their placeholders and the Persian
     tabs read them to work out which items are still untranslated. */
  useEffect(() => {
    let alive = true;
    loadAllPacks().finally(() => alive && setPacksReady(true));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!tokenGet()) return setAuthed(false);
    api('/api/auth/me', { auth: true })
      .then(() => setAuthed(true))
      .catch(() => {
        tokenSet('');
        setAuthed(false);
      });
  }, []);

  if (authed === null || !packsReady)
    return <div className="admin" style={{ display: 'grid', placeItems: 'center', minHeight: '100svh' }}>…</div>;
  if (!authed) return <div className="admin">{<Login onDone={() => setAuthed(true)} />}</div>;

  const visibleTabs = TABS.filter((tb) => (isBase ? !tb.transOnly : !tb.faOnly && !tb.base));
  const activeTab = visibleTabs.some((tb) => tb.id === tab) ? tab : visibleTabs[0].id;

  /* Products and Blog exist in all three languages, but the Persian tabs edit
     the base content while the other languages edit the translation layer. */
  const Tab = {
    products: isBase ? ProductsTab : ProductsTransTab,
    posts: isBase ? PostsTab : PostsTransTab,
    translations: TranslationsTab,
    shop: ShopProductsTab,
    orders: ShopOrdersTab,
    comments: ShopCommentsTab,
    payment: ShopPaymentTab,
    texts: TextsTab,
    media: MediaTab,
    links: LinksTab,
    contact: ContactTab,
    messages: MessagesTab,
  }[activeTab];

  return (
    <div className="admin">
      <div className="admin__shell">
        <aside className="admin__side">
          <div className="admin__side-brand">
            <Logo size={40} variant="solid" className="admin__logo-mark" />
            <div>
              <strong>{t('global.company.short')}</strong>
              <small>CONTENT ADMIN</small>
            </div>
          </div>
          <AdminLangBar />
          <AdminThemeBar />
          {visibleTabs.map((tb) => {
            const Ic = Icons[tb.icon];
            return (
              <button key={tb.id} className={activeTab === tb.id ? 'is-active' : ''} onClick={() => setTab(tb.id)}>
                <Ic size={18} />
                {tb.label}
              </button>
            );
          })}
          <div className="spacer" />
          <Link to={locale === 'fa' ? '/' : `/${locale}`} target="_blank">
            <Icons.globe size={15} style={{ display: 'inline-block', verticalAlign: '-3px', marginInlineEnd: 6 }} />
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
            <Icons.arrow size={15} style={{ display: 'inline-block', verticalAlign: '-3px', marginInlineEnd: 6 }} />
            خروج از پنل
          </a>
        </aside>
        <main className="admin__main">
          {!backend && (
            <p style={{ background: 'var(--crimson-soft)', color: 'var(--crimson-700)', borderRadius: 12, padding: '10px 16px', marginBottom: 18 }}>
              سرور محتوا در دسترس نیست؛ تغییرات ذخیره نخواهد شد. (سرور Node را اجرا کنید: npm run server)
            </p>
          )}
          {!isBase && (
            <p className="admin__locale-note">
              در حال ویرایش نسخه {locale === 'en' ? 'انگلیسی' : 'عربی'} سایت. محتوای فارسی پایه است و از تب‌های
              معمولی ویرایش می‌شود؛ در این بخش فقط ترجمه‌ها را وارد یا اصلاح می‌کنید.
            </p>
          )}
          <Tab />
        </main>
      </div>
    </div>
  );
}

export default function AdminApp() {
  return (
    <AdminLocaleProvider>
      <AdminShell />
    </AdminLocaleProvider>
  );
}
