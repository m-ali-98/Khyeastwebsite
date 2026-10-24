import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { m as mo } from 'framer-motion';
import Logo from '../components/Logo';
import { Icons, PasswordInput } from '../components/ui';
import { api, useContent } from '../content/ContentContext';
import { ProductsTab, PostsTab, TextsTab, MediaTab, LinksTab, TrustSealsTab, ContactTab, MessagesTab } from './tabs';
import { ShopProductsTab, ShopOrdersTab, ShopCommentsTab, ShopPaymentTab, ShopSmsTab, ShopCustomersTab, AdminSecurityTab } from './shopTabs';
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
const CONTENT_WRITE_TABS = new Set([
  'products', 'posts', 'shop', 'texts', 'translations', 'media', 'links', 'trust', 'contact',
]);

const TABS = [
  { id: 'products', label: 'محصولات', icon: 'pack', group: 'content' },
  { id: 'posts', label: 'وبلاگ', icon: 'posts', group: 'content' },
  { id: 'texts', label: 'متون سایت', icon: 'text', base: true, group: 'content' },
  { id: 'translations', label: 'متون و فهرست‌ها', icon: 'translations', transOnly: true, group: 'content' },
  { id: 'media', label: 'تصاویر صفحات', icon: 'media', group: 'content' },
  { id: 'links', label: 'پیوندها', icon: 'link', group: 'content' },
  { id: 'trust', label: 'نمادهای اعتماد', icon: 'shield', base: true, group: 'content' },
  { id: 'contact', label: 'اطلاعات تماس', icon: 'contact', base: true, group: 'content' },
  { id: 'shop', label: 'فروشگاه — محصولات', icon: 'store', faOnly: true, group: 'commerce' },
  { id: 'orders', label: 'سفارش‌ها', icon: 'orders', faOnly: true, group: 'commerce' },
  { id: 'comments', label: 'دیدگاه‌ها', icon: 'comments', faOnly: true, group: 'commerce' },
  { id: 'payment', label: 'درگاه پرداخت', icon: 'payment', faOnly: true, group: 'commerce' },
  { id: 'customers', label: 'مشتریان', icon: 'users', faOnly: true, group: 'commerce' },
  { id: 'messages', label: 'پیام‌های مردم', icon: 'inbox', group: 'communications' },
  { id: 'sms', label: 'پیامک', icon: 'send', faOnly: true, group: 'communications' },
  { id: 'security', label: 'امنیت و محدودیت‌ها', icon: 'shield', faOnly: true, group: 'system' },
];

const NAV_GROUPS = [
  { id: 'content', label: 'محتوا' },
  { id: 'commerce', label: 'فروشگاه' },
  { id: 'communications', label: 'ارتباطات' },
  { id: 'system', label: 'سامانه' },
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
                /* `mouseenter` also fires when the palette opens underneath a
                   stationary cursor, which silently replaced the keyboard's
                   first option. Pointer movement expresses real mouse intent
                   without making Cmd/Ctrl+K depend on cursor position. */
                onPointerMove={() => setActiveIndex(index)}
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
        <span className="sr-only">در حال آماده‌سازی پنل</span>
        <div className="admin__boot-mark">
          <Logo size={44} className="admin__logo-mark" />
        </div>
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
      await api('/api/auth/login', { method: 'POST', body: { user, pass } });
      onDone();
    } catch (error) {
      setErr(
        error.status === 426
          ? error.message
          : 'نام کاربری یا رمز عبور نادرست است.',
      );
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
        <div className="admin__login-brand" aria-hidden="true">
          <Logo size={34} className="admin__logo-mark" />
        </div>
        <span className="admin__login-kicker">مدیریت امن وب‌سایت</span>
        <h1>پنل مدیریت محتوا</h1>
        <p className="admin__login-intro">شرکت خمیر مایه خوزستان — دسترسی مخصوص مدیر محتوا</p>
        <div className="admin__login-fields">
          <label className="field">
            <span>نام کاربری</span>
            <input value={user} onChange={(e) => setUser(e.target.value)} dir="ltr" autoComplete="username" autoFocus />
          </label>
          <label className="field">
            <span>رمز عبور</span>
            <PasswordInput value={pass} onChange={(e) => setPass(e.target.value)} dir="ltr" autoComplete="current-password" />
          </label>
        </div>
        <button className="btn btn--primary admin__login-submit" disabled={busy} type="submit">
          {busy ? 'در حال بررسی…' : 'ورود به پنل'}
        </button>
        {err && <div className="admin__login-err" role="alert">{err}</div>}
        <footer className="admin__login-footer">
          <Link to="/" className="admin__back-link">
            <Icons.arrow size={14} />
            بازگشت به وب‌سایت
          </Link>
          <span>نشست مدیریت پس از ورود به‌صورت امن نگهداری می‌شود.</span>
        </footer>
      </mo.form>
    </main>
  );
}

function AdminShell() {
  const { backend, contentAvailable, t } = useContent();
  const { locale, isBase } = useAdminLocale();
  const [authed, setAuthed] = useState(null); // null = checking
  const [tab, setTab] = useState('products');
  const [packsReady, setPacksReady] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const paletteOpenRef = useRef(false);
  const returnFocusRef = useRef(null);
  const navToggleRef = useRef(null);
  const navCloseRef = useRef(null);
  const mainRef = useRef(null);

  const visibleTabs = useMemo(
    () => TABS.filter((item) => (isBase ? !item.transOnly : !item.faOnly && !item.base)),
    [isBase],
  );
  const activeTab = visibleTabs.some((item) => item.id === tab) ? tab : visibleTabs[0].id;
  const activeTabMeta = visibleTabs.find((item) => item.id === activeTab) || visibleTabs[0];
  const ActiveTabIcon = Icons[activeTabMeta.icon] || Icons.command;
  const contentReadOnly = backend && !contentAvailable && CONTENT_WRITE_TABS.has(activeTab);
  const selectTab = useCallback((id) => {
    const movingFromDrawer = navOpen;
    setTab(id);
    setNavOpen(false);
    if (movingFromDrawer) {
      window.setTimeout(() => mainRef.current?.focus({ preventScroll: true }), 0);
    }
  }, [navOpen]);
  const paletteCommands = useMemo(
    () =>
      visibleTabs.map((item) => ({
        ...item,
        keywords: `${item.id} مدیریت پنل`,
        run: () => selectTab(item.id),
      })),
    [selectTab, visibleTabs],
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
    /* Older builds stored a bearer token where any script could read it.
       Remove that legacy copy and ask the server about the HttpOnly cookie;
       JavaScript intentionally has no API for reading the new credential. */
    try { localStorage.removeItem('ky_admin_token'); } catch {}
    api('/api/auth/me', { auth: true })
      .then((session) => setAuthed(session?.authenticated !== false))
      .catch(() => setAuthed(false));
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

  /* On tablet and mobile the navigation is a modal drawer. Keep the page from
     moving under it, support Escape, and put keyboard focus where the user can
     immediately continue. The desktop media query never opens this drawer. */
  useEffect(() => {
    if (!navOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setNavOpen(false);
        navToggleRef.current?.focus({ preventScroll: true });
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...(document.querySelectorAll(
        '#admin-navigation a[href], #admin-navigation button:not([disabled]), #admin-navigation input:not([disabled]), #admin-navigation select:not([disabled])',
      ) || [])].filter((element) => element.getClientRects().length);
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
    document.addEventListener('keydown', onKeyDown);
    /* A zero-delay task runs after the pointer/click default action has put
       focus back on the opener; requestAnimationFrame can run before that on
       touch-emulated browsers and lose the race. */
    const focusTimer = window.setTimeout(() => navCloseRef.current?.focus({ preventScroll: true }), 0);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [navOpen]);

  useEffect(() => {
    if (!navOpen || typeof window.matchMedia !== 'function') return undefined;
    const desktop = window.matchMedia('(min-width: 1025px)');
    const closeOnDesktop = (event) => event.matches && setNavOpen(false);
    desktop.addEventListener?.('change', closeOnDesktop);
    return () => desktop.removeEventListener?.('change', closeOnDesktop);
  }, [navOpen]);

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
    security: AdminSecurityTab,
    texts: TextsTab,
    media: MediaTab,
    links: LinksTab,
    trust: TrustSealsTab,
    contact: ContactTab,
    messages: MessagesTab,
  }[activeTab];

  return (
    <div className="admin">
      <div className="admin__shell">
        <header className="admin__mobilebar">
          <button
            ref={navToggleRef}
            type="button"
            className="admin__mobile-action admin__menu-toggle"
            aria-label="باز کردن فهرست پنل"
            aria-controls="admin-navigation"
            aria-expanded={navOpen}
            onClick={() => setNavOpen(true)}
          >
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            <span aria-hidden="true" />
          </button>
          <div className="admin__mobile-current" aria-live="polite">
            <span><ActiveTabIcon size={17} /></span>
            <div>
              <small>بخش فعلی</small>
              <strong>{activeTabMeta.label}</strong>
            </div>
          </div>
          <button
            type="button"
            className="admin__mobile-action"
            onClick={openPalette}
            aria-label="دسترسی سریع به بخش‌ها"
            aria-haspopup="dialog"
          >
            <Icons.search size={19} />
          </button>
        </header>

        <button
          type="button"
          className={`admin__nav-scrim ${navOpen ? 'is-open' : ''}`}
          aria-label="بستن فهرست پنل"
          tabIndex={navOpen ? 0 : -1}
          onClick={() => setNavOpen(false)}
        />

        <aside
          id="admin-navigation"
          className={`admin__side ${navOpen ? 'is-open' : ''}`}
          aria-label="فهرست پنل مدیریت"
          role={navOpen ? 'dialog' : undefined}
          aria-modal={navOpen ? 'true' : undefined}
        >
          <div className="admin__side-head">
            <div className="admin__side-brand">
              <Logo size={40} variant="solid" className="admin__logo-mark" />
              <div>
                <strong>{t('global.company.short')}</strong>
                <small>CONTENT ADMIN</small>
              </div>
            </div>
            <button
              ref={navCloseRef}
              type="button"
              className="admin__side-close"
              aria-label="بستن فهرست پنل"
              onClick={() => {
                setNavOpen(false);
                navToggleRef.current?.focus({ preventScroll: true });
              }}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>

          <div className="admin__side-tools">
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
          </div>

          <nav className="admin__nav" aria-label="بخش‌های مدیریت">
            {NAV_GROUPS.map((group) => {
              const groupTabs = visibleTabs.filter((item) => item.group === group.id);
              if (!groupTabs.length) return null;
              return (
                <section className="admin__nav-section" key={group.id} aria-labelledby={`admin-nav-${group.id}`}>
                  <h2 id={`admin-nav-${group.id}`}>{group.label}</h2>
                  {groupTabs.map((tb) => {
                    const Ic = Icons[tb.icon] || Icons.command;
                    return (
                      <button
                        key={tb.id}
                        type="button"
                        className={activeTab === tb.id ? 'is-active' : ''}
                        aria-current={activeTab === tb.id ? 'page' : undefined}
                        onClick={() => selectTab(tb.id)}
                      >
                        <Ic size={18} />
                        <span>{tb.label}</span>
                      </button>
                    );
                  })}
                </section>
              );
            })}
          </nav>

          <footer className="admin__side-footer">
            <Link to={locale === 'fa' ? '/' : `/${locale}`} target="_blank">
              <Icons.globe size={16} />
              مشاهده وب‌سایت
            </Link>
            <a
              href="#logout"
              onClick={(e) => {
                e.preventDefault();
                /* Tell the server first so the session is revoked and its
                   HttpOnly cookie is cleared. Local UI state is cleared either
                   way — a failed call must never trap the admin in the panel. */
                api('/api/auth/logout', { method: 'POST', auth: true })
                  .catch(() => {})
                  .finally(() => setAuthed(false));
              }}
            >
              <Icons.arrow size={16} />
              خروج از پنل
            </a>
          </footer>
        </aside>
        <main ref={mainRef} className="admin__main" tabIndex={-1}>
          {!backend && (
            <div className="admin__notice admin__notice--error" role="alert">
              <Icons.shield size={19} />
              <div>
                <strong>سرور محتوا در دسترس نیست</strong>
                <span>تغییرات ذخیره نخواهد شد. سرور Node را با دستور <code dir="ltr">npm run server</code> اجرا کنید.</span>
              </div>
            </div>
          )}
          {backend && !contentAvailable && (
            <div id="admin-content-recovery-warning" className="admin__notice admin__notice--error" role="alert">
              <Icons.shield size={19} />
              <div>
                <strong>پنل در حالت بازیابی است</strong>
                <span>فایل content.json گم‌شده، خراب یا ناقص است. محتوای پیش‌فرض فقط برای نمایش موقت بارگذاری شده و بخش‌های محتوایی تا بازیابی فایل معتبر فقط‌خواندنی هستند؛ ابتدا backup را بررسی کنید.</span>
              </div>
            </div>
          )}
          {!isBase && (
            <p className="admin__locale-note">
              در حال ویرایش نسخه {locale === 'en' ? 'انگلیسی' : 'عربی'} سایت. محتوای فارسی پایه است و از تب‌های
              معمولی ویرایش می‌شود؛ در این بخش فقط ترجمه‌ها را وارد یا اصلاح می‌کنید.
            </p>
          )}
          <fieldset
            className="admin__content-boundary"
            disabled={contentReadOnly}
            inert={contentReadOnly || undefined}
            aria-describedby={contentReadOnly ? 'admin-content-recovery-warning' : undefined}
          >
            <Tab />
          </fieldset>
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
