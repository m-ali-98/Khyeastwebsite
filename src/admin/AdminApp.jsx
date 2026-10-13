import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { m as mo } from 'framer-motion';
import Logo from '../components/Logo';
import { Icons, PasswordInput } from '../components/ui';
import { api, tokenGet, tokenSet, useContent } from '../content/ContentContext';
import { ProductsTab, PostsTab, TextsTab, MediaTab, LinksTab, ContactTab, MessagesTab } from './tabs';
import { ShopProductsTab, ShopOrdersTab, ShopCommentsTab, ShopPaymentTab, ShopSmsTab, ShopCustomersTab } from './shopTabs';
import { TranslationsTab } from './i18nTab';
import { ProductsTransTab, PostsTransTab } from './entityTrans';
import { AdminLocaleProvider, useAdminLocale } from './adminLocale';
import { useLocale } from '../i18n/LocaleContext';
import useLoadingGate from '../hooks/useLoadingGate';
import { loadAllPacks } from '../../shared/i18n/index.js';
import './admin.scss';

/* `base: true` = tab edits the Persian source content. When the admin is
   editing English or Arabic, those tabs are replaced by the translation
   editor, while the language-neutral tabs (images, links, orders, messages)
   stay available. */
const TABS = [
  { id: 'products', label: 'محصولات', icon: 'pack' },
  { id: 'posts', label: 'وبلاگ', icon: 'posts' },
  { id: 'shop', label: 'فروشگاه — محصولات', icon: 'store', faOnly: true },
  { id: 'orders', label: 'سفارش‌ها', icon: 'orders', faOnly: true },
  { id: 'comments', label: 'دیدگاه‌ها', icon: 'comments', faOnly: true },
  { id: 'payment', label: 'درگاه پرداخت', icon: 'payment', faOnly: true },
  { id: 'customers', label: 'مشتریان', icon: 'users', faOnly: true },
  { id: 'sms', label: 'پیامک', icon: 'send', faOnly: true },
  { id: 'texts', label: 'متون سایت', icon: 'text', base: true },
  { id: 'translations', label: 'متون و فهرست‌ها', icon: 'translations', transOnly: true },
  { id: 'media', label: 'تصاویر صفحات', icon: 'media' },
  { id: 'links', label: 'پیوندها', icon: 'link' },
  { id: 'contact', label: 'اطلاعات تماس', icon: 'contact', base: true },
  { id: 'messages', label: 'پیام‌های مردم', icon: 'inbox' },
];

/* Persian and Arabic keyboards can produce different code points for the same
   visible word. Normalising both the query and labels makes a command such as
   «مشتریان» discoverable whichever keyboard the merchant is using. */
const normalizeCommandText = (value) =>
  String(value || '')
    .normalize('NFKD')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .toLocaleLowerCase('fa');

function CommandPalette({ commands, activeTab, onClose }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  const optionRefs = useRef([]);
  const filtered = useMemo(() => {
    const needle = normalizeCommandText(query.trim());
    if (!needle) return commands;
    return commands.filter((command) =>
      normalizeCommandText(`${command.label} ${command.keywords || ''}`).includes(needle),
    );
  }, [commands, query]);

  useEffect(() => {
    setActiveIndex(filtered.length ? 0 : -1);
  }, [query, filtered.length]);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (activeIndex < 0) return;
    optionRefs.current[activeIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);

  const execute = (command) => {
    if (!command) return;
    command.run();
    onClose();
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown' && filtered.length) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1 + filtered.length) % filtered.length);
      return;
    }
    if (event.key === 'ArrowUp' && filtered.length) {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + filtered.length) % filtered.length);
      return;
    }
    if (event.key === 'Home' && filtered.length) {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === 'End' && filtered.length) {
      event.preventDefault();
      setActiveIndex(filtered.length - 1);
      return;
    }
    if (event.key === 'Enter' && activeIndex >= 0 && event.target === inputRef.current) {
      event.preventDefault();
      execute(filtered[activeIndex]);
      return;
    }
    if (event.key !== 'Tab') return;

    /* Keep keyboard focus in the modal. The list changes while filtering, so
       query the current controls rather than retaining stale element refs. */
    const focusable = [...(dialogRef.current?.querySelectorAll('input, button:not([disabled])') || [])];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const activeCommand = activeIndex >= 0 ? filtered[activeIndex] : null;

  return (
    <div className="admin-command" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <section
        ref={dialogRef}
        className="admin-command__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-command-title"
        onKeyDown={onKeyDown}
      >
        <h2 id="admin-command-title" className="sr-only">دسترسی سریع به بخش‌های پنل</h2>
        <div className="admin-command__search">
          <Icons.search size={19} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="نام یک بخش را بنویسید…"
            aria-label="جست‌وجوی دستورات"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls="admin-command-results"
            aria-activedescendant={activeCommand ? `admin-command-${activeCommand.id}` : undefined}
          />
          <button type="button" className="admin-command__close" onClick={onClose} aria-label="بستن دسترسی سریع">
            Esc
          </button>
        </div>

        <div className="admin-command__results" id="admin-command-results" role="listbox" aria-label="بخش‌های پنل">
          {filtered.map((command, index) => {
            const CommandIcon = Icons[command.icon] || Icons.command;
            const selected = index === activeIndex;
            return (
              <button
                key={command.id}
                id={`admin-command-${command.id}`}
                ref={(node) => { optionRefs.current[index] = node; }}
                type="button"
                className={selected ? 'is-active' : ''}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => execute(command)}
              >
                <span className="admin-command__icon"><CommandIcon size={18} /></span>
                <span>
                  <b>{command.label}</b>
                  <small>{command.id === activeTab ? 'بخش فعلی' : 'رفتن به بخش'}</small>
                </span>
                {command.id === activeTab && <span className="admin-command__current">اکنون</span>}
              </button>
            );
          })}
          {!filtered.length && (
            <div className="admin-command__empty">
              <Icons.search size={20} />
              بخشی با این عبارت پیدا نشد.
            </div>
          )}
        </div>

        <footer className="admin-command__help" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> پیمایش</span>
          <span><kbd>Enter</kbd> انتخاب</span>
          <span><kbd>Esc</kbd> بستن</span>
        </footer>
      </section>
    </div>
  );
}

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

/* Shown while the session check and the translation dictionaries resolve.
   Uses the same mark and rhythm as the login card so the panel does not appear
   to jump between two unrelated screens. */
function AdminLoading() {
  /* Both the session check and the dictionaries usually resolve in a few
     milliseconds from cache. Rendering a boot screen for that is a flash, so
     hold it back until the wait is real — how long "real" means is derived
     from the connection rather than fixed. */
  const state = useLoadingGate(true);
  if (state === 'hidden') return <div className="admin" />;

  return (
    <div className="admin">
      <div className="admin__boot" role="status" aria-live="polite" aria-busy="true">
        <div className="admin__boot-mark">
          <Logo size={44} className="admin__logo-mark" />
        </div>
        <div className="admin__boot-bar"><span /></div>
        <p>در حال آماده‌سازی پنل…</p>
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
    /* a <main> so the login screen has the one landmark every page needs —
       the shell has .admin__main, this screen had nothing */
    <main className="admin__login">
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
      <mo.form className="admin__login-card" initial={{ opacity: 0, y: 26 }} animate={{ opacity: 1, y: 0 }} onSubmit={submit}>
        <div style={{ display: 'grid', placeItems: 'center' }}>
          <Logo size={30} className="admin__logo-mark" />
        </div>
        <h1>پنل مدیریت محتوا</h1>
        <p>شرکت خمیر مایه خوزستان — دسترسی مخصوص مدیر محتوا</p>
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 700 }}>نام کاربری</span>
          <input value={user} onChange={(e) => setUser(e.target.value)} dir="ltr" autoFocus />
        </label>
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 700 }}>رمز عبور</span>
          <PasswordInput value={pass} onChange={(e) => setPass(e.target.value)} dir="ltr" />
        </label>
        <button className="btn btn--primary" disabled={busy} type="submit">
          ورود به پنل
        </button>
        {err && <div className="admin__login-err">{err}</div>}
        <p style={{ marginTop: 18, fontSize: 12 }}>
          <Link to="/" className="admin__back-link">
            <Icons.arrow size={14} />
            بازگشت به وب‌سایت
          </Link>
        </p>
      </mo.form>
    </main>
  );
}

function AdminShell() {
  const { backend, t } = useContent();
  const { locale, isBase } = useAdminLocale();
  const [authed, setAuthed] = useState(null); // null = checking
  const [tab, setTab] = useState('products');
  const [packsReady, setPacksReady] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const paletteOpenRef = useRef(false);
  const returnFocusRef = useRef(null);

  const visibleTabs = useMemo(
    () => TABS.filter((item) => (isBase ? !item.transOnly : !item.faOnly && !item.base)),
    [isBase],
  );
  const activeTab = visibleTabs.some((item) => item.id === tab) ? tab : visibleTabs[0].id;
  const paletteCommands = useMemo(
    () =>
      visibleTabs.map((item) => ({
        ...item,
        keywords: `${item.id} مدیریت پنل`,
        run: () => setTab(item.id),
      })),
    [visibleTabs],
  );

  const openPalette = useCallback(() => {
    if (paletteOpenRef.current) return;
    paletteOpenRef.current = true;
    returnFocusRef.current = document.activeElement;
    setPaletteOpen(true);
  }, []);

  const closePalette = useCallback(() => {
    if (!paletteOpenRef.current) return;
    paletteOpenRef.current = false;
    setPaletteOpen(false);
    const target = returnFocusRef.current;
    const restore = () => target?.isConnected && target.focus?.({ preventScroll: true });
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(restore);
    else window.setTimeout(restore, 0);
  }, []);

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

  useEffect(() => {
    if (!authed) return undefined;
    const shortcut = (event) => {
      if (event.altKey || (!event.metaKey && !event.ctrlKey) || event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      openPalette();
    };
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, [authed, openPalette]);

  if (authed === null || !packsReady) return <AdminLoading />;
  if (!authed) return <div className="admin">{<Login onDone={() => setAuthed(true)} />}</div>;

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
    customers: ShopCustomersTab,
    sms: ShopSmsTab,
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
          <button
            type="button"
            className="admin__command-open"
            onClick={openPalette}
            aria-haspopup="dialog"
            aria-keyshortcuts="Meta+K Control+K"
          >
            <Icons.command size={17} />
            <span>دسترسی سریع</span>
            <kbd>⌘ / Ctrl K</kbd>
          </button>
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
              /* Tell the server first so the token is revoked, not merely
                 forgotten by this browser. The local state is cleared either
                 way — a failed call must never trap the admin in the panel. */
              api('/api/auth/logout', { method: 'POST', auth: true })
                .catch(() => {})
                .finally(() => {
                  tokenSet('');
                  setAuthed(false);
                });
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
      {paletteOpen && (
        <CommandPalette commands={paletteCommands} activeTab={activeTab} onClose={closePalette} />
      )}
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
