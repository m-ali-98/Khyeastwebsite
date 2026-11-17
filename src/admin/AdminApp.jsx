import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { m as mo } from 'framer-motion';
import Logo from '../components/Logo';
import { Icons, PasswordInput } from '../components/ui';
import { api, useContent } from '../content/ContentContext';
import { ProductsTab, PostsTab, TextsTab, MediaTab, LinksTab, TrustSealsTab, ContactTab, MessagesTab } from './tabs';
import SalesRepresentativesTab from './SalesRepresentativesTab';
import { UploadButton } from './editors';
import { ShopProductsTab, ShopOrdersTab, ShopCommentsTab, ShopPaymentTab, ShopSmsTab, ShopCustomersTab, AdminSecurityTab } from './shopTabs';
import { TranslationsTab } from './i18nTab';
import { ProductsTransTab, PostsTransTab } from './entityTrans';
import { AdminLocaleProvider, useAdminLocale } from './adminLocale';
import { useLocale } from '../i18n/LocaleContext';
import useLoadingGate from '../hooks/useLoadingGate';
import { getPack, loadAllPacks } from '../../shared/i18n/index.js';
import {
  GALLERY_CAPTION_MAX,
  GALLERY_DESCRIPTION_MAX,
  MAX_GALLERY_ITEMS,
  cleanGalleryAssetUrl,
  galleryItemsProblem,
  normalizeGalleryItems,
  stripGalleryMediaOverrides,
} from '../../shared/gallery.js';
import './admin.scss';

/* `base: true` = tab edits the Persian source content. When the admin is
   editing English, Arabic or Russian, those tabs are replaced by the
   translation editor, while language-neutral tabs remain available. */
const CONTENT_WRITE_TABS = new Set([
  'products', 'posts', 'gallery', 'shop', 'texts', 'translations', 'media', 'links', 'trust', 'contact',
  'representatives',
]);

const TABS = [
  { id: 'products', label: 'محصولات', icon: 'pack', group: 'content' },
  { id: 'posts', label: 'وبلاگ', icon: 'posts', group: 'content' },
  { id: 'gallery', label: 'گالری', icon: 'media', group: 'content' },
  { id: 'texts', label: 'متون سایت', icon: 'text', base: true, group: 'content' },
  { id: 'translations', label: 'متون و فهرست‌ها', icon: 'translations', transOnly: true, group: 'content' },
  { id: 'media', label: 'تصاویر صفحات', icon: 'media', group: 'content' },
  { id: 'links', label: 'پیوندها', icon: 'link', group: 'content' },
  { id: 'trust', label: 'نمادهای اعتماد', icon: 'shield', base: true, group: 'content' },
  { id: 'contact', label: 'اطلاعات تماس', icon: 'contact', base: true, group: 'content' },
  { id: 'representatives', label: 'نمایندگان فروش', icon: 'pin', base: true, faOnly: true, group: 'content' },
  { id: 'shop', label: 'فروشگاه — محصولات', icon: 'store', faOnly: true, group: 'commerce' },
  { id: 'orders', label: 'سفارش‌ها', icon: 'orders', faOnly: true, group: 'commerce' },
  { id: 'comments', label: 'دیدگاه‌ها', icon: 'comments', faOnly: true, group: 'commerce' },
  { id: 'payment', label: 'درگاه پرداخت', icon: 'payment', faOnly: true, group: 'commerce' },
  { id: 'customers', label: 'مشتریان', icon: 'users', faOnly: true, group: 'commerce' },
  { id: 'messages', label: 'پیام‌های مردم', icon: 'inbox', group: 'communications' },
  { id: 'sms', label: 'پیامک', icon: 'send', faOnly: true, group: 'communications' },
  { id: 'security', label: 'امنیت و محدودیت‌ها', icon: 'shield', faOnly: true, group: 'system' },
];

const ADMIN_LANGUAGE_NAME = { en: 'English', ar: 'العربية', ru: 'Русский' };

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

const GALLERY_PROBLEM_MESSAGES = {
  'gallery-not-array': 'ساختار گالری معتبر نیست.',
  'gallery-too-many': `حداکثر ${MAX_GALLERY_ITEMS.toLocaleString('fa-IR')} رسانه مجاز است.`,
  'gallery-item-invalid': 'یکی از ردیف‌های گالری معتبر نیست.',
  'gallery-id-invalid': 'شناسه پایدار یکی از رسانه‌ها معتبر نیست.',
  'gallery-id-duplicate': 'شناسه دو رسانه یکسان است.',
  'gallery-type-invalid': 'نوع رسانه باید تصویر یا ویدئو باشد.',
  'gallery-src-invalid': 'نشانی رسانه معتبر نیست؛ فقط تصویر داخلی یا ویدئوی MP4/WebM بارگذاری‌شده مجاز است.',
  'gallery-image-poster-invalid': 'تصویر ثابت فقط برای ویدئو قابل استفاده است.',
  'gallery-poster-invalid': 'نشانی تصویر کاور معتبر نیست.',
  'gallery-caption-invalid': `عنوان هر رسانه الزامی و حداکثر ${GALLERY_CAPTION_MAX.toLocaleString('fa-IR')} نویسه است.`,
  'gallery-description-invalid': `توضیحات هر رسانه حداکثر ${GALLERY_DESCRIPTION_MAX.toLocaleString('fa-IR')} نویسه است.`,
};

const galleryClone = (value) => JSON.parse(JSON.stringify(normalizeGalleryItems(value)));
const newGalleryId = () => `gallery-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function GalleryPreview({ item, caption }) {
  const preview = cleanGalleryAssetUrl(item.type === 'video' ? item.poster : item.src, 'image');
  const PlaceholderIcon = item.type === 'video' ? Icons.video : Icons.image;
  return (
    <div className="admin-gallery__preview">
      {preview ? <img src={preview} alt="" /> : <PlaceholderIcon size={34} />}
      {item.type === 'video' && <span><Icons.video size={13} /> ویدئو</span>}
      <small>{caption || 'بدون عنوان'}</small>
    </div>
  );
}

function BaseGalleryTab() {
  const { state, save } = useContent();
  const sourceKey = JSON.stringify(state.gallery || []);
  const [items, setItems] = useState(() => galleryClone(state.gallery));
  const [saving, setSaving] = useState(false);
  const [uploadCount, setUploadCount] = useState(0);
  const [notice, setNotice] = useState({ type: '', text: '' });
  const uploadBusy = uploadCount > 0;
  const controlsDisabled = saving || uploadBusy;

  useEffect(() => {
    setItems(galleryClone(state.gallery));
  }, [sourceKey]);

  const trackUpload = useCallback((active) => {
    setUploadCount((count) => Math.max(0, count + (active ? 1 : -1)));
  }, []);

  const update = (index, key, value) => {
    setNotice({ type: '', text: '' });
    setItems((current) => current.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      if (key === 'type') {
        const src = cleanGalleryAssetUrl(item.src, value);
        return { ...item, type: value, src, poster: value === 'video' ? item.poster : '' };
      }
      return { ...item, [key]: value };
    }));
  };

  const add = (type) => {
    if (items.length >= MAX_GALLERY_ITEMS) return;
    setItems((current) => [...current, {
      id: newGalleryId(),
      type,
      src: '',
      poster: '',
      caption: '',
      description: '',
    }]);
    setNotice({ type: '', text: '' });
  };

  const move = (index, delta) => {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= items.length) return;
    setNotice({ type: '', text: '' });
    setItems((current) => {
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const remove = (index) => {
    setItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setNotice({ type: '', text: '' });
  };

  const publish = async () => {
    const problem = galleryItemsProblem(items);
    if (problem) {
      setNotice({ type: 'error', text: GALLERY_PROBLEM_MESSAGES[problem] || 'اطلاعات گالری کامل نیست.' });
      return;
    }
    const clean = normalizeGalleryItems(items);
    const liveIds = new Set(clean.map((item) => item.id));
    const i18n = Object.fromEntries(Object.entries(state.i18n || {}).map(([locale, data]) => {
      if (!data || typeof data !== 'object' || Array.isArray(data)) return [locale, data];
      const translated = stripGalleryMediaOverrides(data.gallery);
      const gallery = Object.fromEntries(Object.entries(translated).filter(([id]) => liveIds.has(id)));
      return [locale, { ...data, gallery }];
    }));

    setSaving(true);
    setNotice({ type: '', text: '' });
    try {
      await save({ ...state, gallery: clean, i18n }, { optimistic: false });
      setNotice({ type: 'success', text: 'گالری با موفقیت منتشر شد.' });
    } catch (error) {
      setNotice({
        type: 'error',
        text: error?.problem ? (GALLERY_PROBLEM_MESSAGES[error.problem] || error.message) : (error?.message || 'ذخیره گالری ممکن نشد.'),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin__panel admin-gallery" data-testid="admin-gallery-manager">
      <div className="admin__head admin-gallery__head">
        <div>
          <h1>مدیریت گالری</h1>
          <p>تصویر و ویدئو را بارگذاری کنید، کاور و متن بنویسید و با جابه‌جایی ردیف‌ها ترتیب نمایش عمومی را تعیین کنید.</p>
        </div>
        <span className="admin-gallery__count">{items.length.toLocaleString('fa-IR')} / {MAX_GALLERY_ITEMS.toLocaleString('fa-IR')}</span>
      </div>

      <div className="admin-gallery__add">
        <button type="button" className="btn btn--primary" onClick={() => add('image')} disabled={controlsDisabled || items.length >= MAX_GALLERY_ITEMS}>
          <Icons.image size={17} /> افزودن تصویر
        </button>
        <button type="button" className="btn btn--outline" onClick={() => add('video')} disabled={controlsDisabled || items.length >= MAX_GALLERY_ITEMS}>
          <Icons.video size={17} /> افزودن ویدئو
        </button>
      </div>

      {items.length ? (
        <ol className="admin-gallery__list">
          {items.map((item, index) => (
            <li className="admin-gallery__item" key={item.id} data-testid="admin-gallery-item">
              <div className="admin-gallery__item-top">
                <GalleryPreview item={item} caption={item.caption} />
                <div className="admin-gallery__identity">
                  <span className="admin__badge">رسانه {Number(index + 1).toLocaleString('fa-IR')}</span>
                  <code>{item.id}</code>
                  <div className="admin-gallery__type" role="group" aria-label={`نوع رسانه ${index + 1}`}>
                    <button type="button" className={item.type === 'image' ? 'is-active' : ''} onClick={() => update(index, 'type', 'image')} disabled={controlsDisabled}>تصویر</button>
                    <button type="button" className={item.type === 'video' ? 'is-active' : ''} onClick={() => update(index, 'type', 'video')} disabled={controlsDisabled}>ویدئو</button>
                  </div>
                </div>
                <div className="admin-gallery__order">
                  <button type="button" className="admin__iconbtn" onClick={() => move(index, -1)} disabled={controlsDisabled || index === 0} aria-label="انتقال به بالا"><Icons.chevron size={17} /></button>
                  <button type="button" className="admin__iconbtn admin-gallery__down" onClick={() => move(index, 1)} disabled={controlsDisabled || index === items.length - 1} aria-label="انتقال به پایین"><Icons.chevron size={17} /></button>
                  <button type="button" className="admin__iconbtn danger" onClick={() => remove(index)} disabled={controlsDisabled} aria-label="حذف رسانه"><Icons.trash size={17} /></button>
                </div>
              </div>

              <div className="admin-gallery__fields">
                <label className="admin-gallery__field admin-gallery__field--wide">
                  <span>نشانی {item.type === 'video' ? 'ویدئو' : 'تصویر'} *</span>
                  <div className="admin-gallery__upload-row">
                    <input dir="ltr" value={item.src} onChange={(event) => update(index, 'src', event.target.value)} placeholder={item.type === 'video' ? '/uploads/videos/…mp4' : '/uploads/images/…webp'} disabled={controlsDisabled} />
                    <UploadButton
                      small
                      disabled={controlsDisabled}
                      onBusyChange={trackUpload}
                      accept={item.type === 'video' ? 'video/mp4,video/webm' : 'image/jpeg,image/png,image/webp,image/gif,image/avif'}
                      label={item.type === 'video' ? 'بارگذاری ویدئو' : 'بارگذاری تصویر'}
                      icon={item.type === 'video' ? 'video' : 'upload'}
                      onUploaded={(url) => update(index, 'src', url)}
                    />
                  </div>
                </label>

                {item.type === 'video' && (
                  <label className="admin-gallery__field admin-gallery__field--wide">
                    <span>تصویر کاور ویدئو (اختیاری)</span>
                    <div className="admin-gallery__upload-row">
                      <input dir="ltr" value={item.poster} onChange={(event) => update(index, 'poster', event.target.value)} placeholder="/uploads/images/…webp" disabled={controlsDisabled} />
                      <UploadButton small disabled={controlsDisabled} onBusyChange={trackUpload} accept="image/jpeg,image/png,image/webp,image/gif,image/avif" label="بارگذاری کاور" onUploaded={(url) => update(index, 'poster', url)} />
                    </div>
                  </label>
                )}

                <label className="admin-gallery__field">
                  <span>عنوان روی کارت *</span>
                  <input value={item.caption} maxLength={GALLERY_CAPTION_MAX} onChange={(event) => update(index, 'caption', event.target.value)} disabled={controlsDisabled} />
                  <small>{item.caption.length.toLocaleString('fa-IR')} / {GALLERY_CAPTION_MAX.toLocaleString('fa-IR')}</small>
                </label>
                <label className="admin-gallery__field">
                  <span>متن زیر رسانه در پنجره بزرگ</span>
                  <textarea value={item.description} maxLength={GALLERY_DESCRIPTION_MAX} rows="4" onChange={(event) => update(index, 'description', event.target.value)} disabled={controlsDisabled} />
                  <small>{item.description.length.toLocaleString('fa-IR')} / {GALLERY_DESCRIPTION_MAX.toLocaleString('fa-IR')}</small>
                </label>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="admin-empty admin-gallery__empty">
          <span className="admin-empty__icon"><Icons.media size={25} /></span>
          <strong>هنوز رسانه‌ای در گالری نیست</strong>
          <span>با دکمه‌های بالا نخستین تصویر یا ویدئو را اضافه کنید.</span>
        </div>
      )}

      {uploadBusy && <p className="admin-gallery__upload-notice" role="status">بارگذاری در حال انجام است؛ انتشار و جابه‌جایی تا پایان بارگذاری غیرفعال می‌ماند.</p>}
      {notice.text && <p className={`admin-gallery__notice is-${notice.type}`} role="status">{notice.text}</p>}
      <div className="admin-gallery__savebar">
        <p>رسانه‌های حذف‌شده فوراً از فضای ذخیره‌سازی پاک نمی‌شوند؛ فایل‌های بدون استفاده را از بخش «تصاویر صفحات» بازبینی و پاک‌سازی کنید.</p>
        <button type="button" className="btn btn--primary" onClick={publish} disabled={controlsDisabled}>
          {saving ? 'در حال انتشار…' : 'ذخیره و انتشار گالری'}
        </button>
      </div>
    </div>
  );
}

function GalleryTranslationsTab() {
  const { state, save } = useContent();
  const { locale } = useAdminLocale();
  const sourceKey = JSON.stringify(state.i18n?.[locale]?.gallery || {});
  const baseItems = normalizeGalleryItems(state.gallery);
  const [draft, setDraft] = useState(() => stripGalleryMediaOverrides(state.i18n?.[locale]?.gallery));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState({ type: '', text: '' });
  const shipped = getPack(locale)?.gallery || {};
  const direction = locale === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    setDraft(stripGalleryMediaOverrides(state.i18n?.[locale]?.gallery));
  }, [locale, sourceKey]);

  const update = (id, key, value) => {
    setDraft((current) => ({ ...current, [id]: { ...(current[id] || {}), [key]: value } }));
    setNotice({ type: '', text: '' });
  };

  const publish = async () => {
    const gallery = {};
    for (const item of baseItems) {
      const row = draft[item.id] || {};
      const caption = String(row.caption || '').trim();
      const description = String(row.description || '').trim();
      if (caption.length > GALLERY_CAPTION_MAX || description.length > GALLERY_DESCRIPTION_MAX) {
        setNotice({ type: 'error', text: 'یکی از ترجمه‌ها از محدودیت طول مجاز بیشتر است.' });
        return;
      }
      if (caption || description) gallery[item.id] = { ...(caption ? { caption } : {}), ...(description ? { description } : {}) };
    }

    setSaving(true);
    try {
      const i18n = {
        ...(state.i18n || {}),
        [locale]: { ...(state.i18n?.[locale] || {}), gallery },
      };
      await save({ ...state, i18n }, { optimistic: false });
      setNotice({ type: 'success', text: 'ترجمه‌های گالری ذخیره شد.' });
    } catch (error) {
      setNotice({ type: 'error', text: error?.message || 'ذخیره ترجمه‌ها ممکن نشد.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin__panel admin-gallery admin-gallery--translations" data-testid="admin-gallery-translations">
      <div className="admin__head">
        <div>
          <h1>ترجمه گالری — {ADMIN_LANGUAGE_NAME[locale] || 'English'}</h1>
          <p>عنوان کارت و متن زیر رسانه را ترجمه کنید. فایل، نوع و ترتیب رسانه‌ها از نسخه فارسی مشترک است.</p>
        </div>
      </div>

      {baseItems.length ? (
        <div className="admin-gallery__translation-list">
          {baseItems.map((item, index) => {
            const row = draft[item.id] || {};
            const fallback = shipped[item.id] || item;
            return (
              <section className="admin-gallery__translation" key={item.id}>
                <GalleryPreview item={item} caption={row.caption || fallback.caption} />
                <div className="admin-gallery__translation-fields" dir={direction}>
                  <b>{Number(index + 1).toLocaleString(locale)}. {item.caption}</b>
                  <label className="admin-gallery__field">
                    <span>عنوان ترجمه‌شده</span>
                    <input dir={direction} value={row.caption || ''} maxLength={GALLERY_CAPTION_MAX} placeholder={fallback.caption || item.caption} onChange={(event) => update(item.id, 'caption', event.target.value)} disabled={saving} />
                  </label>
                  <label className="admin-gallery__field">
                    <span>متن ترجمه‌شده زیر رسانه</span>
                    <textarea dir={direction} value={row.description || ''} maxLength={GALLERY_DESCRIPTION_MAX} rows="4" placeholder={fallback.description || item.description} onChange={(event) => update(item.id, 'description', event.target.value)} disabled={saving} />
                  </label>
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="admin-empty"><strong>رسانه‌ای برای ترجمه وجود ندارد.</strong></div>
      )}

      {notice.text && <p className={`admin-gallery__notice is-${notice.type}`} role="status">{notice.text}</p>}
      <div className="admin-gallery__savebar">
        <p>خالی گذاشتن هر فیلد، ترجمه آماده سایت و سپس متن فارسی را به‌عنوان جایگزین نمایش می‌دهد.</p>
        <button type="button" className="btn btn--primary" onClick={publish} disabled={saving}>{saving ? 'در حال ذخیره…' : 'ذخیره ترجمه‌های گالری'}</button>
      </div>
    </div>
  );
}

function GalleryTab() {
  const { isBase } = useAdminLocale();
  return isBase ? <BaseGalleryTab /> : <GalleryTranslationsTab />;
}

function AdminShell() {
  const { backend, contentAvailable, contentConflict, refreshing, t } = useContent();
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

  /* On tablet and mobile the navigation is a modal drawer. The rendered shell
     also marks its header/main inert and aria-hidden while open, so pointer,
     keyboard and assistive-technology users all stay inside the dialog. Keep
     the page still, support Escape, and put focus where the user can continue.
     The desktop media query never opens this drawer. */
  useEffect(() => {
    if (!navOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setNavOpen(false);
        /* The opener is inert until React commits the closed state. Focusing it
           synchronously is therefore rejected by browsers; defer restoration
           until the background has become interactive again. */
        window.setTimeout(() => navToggleRef.current?.focus({ preventScroll: true }), 0);
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

  /* Products and Blog exist in all four languages; Persian edits the base
     content while English, Arabic and Russian edit the translation layer. */
  const Tab = {
    products: isBase ? ProductsTab : ProductsTransTab,
    posts: isBase ? PostsTab : PostsTransTab,
    gallery: GalleryTab,
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
    representatives: SalesRepresentativesTab,
    messages: MessagesTab,
  }[activeTab];

  return (
    <div className="admin">
      <div className="admin__shell">
        <header
          className="admin__mobilebar"
          inert={navOpen || undefined}
          aria-hidden={navOpen ? 'true' : undefined}
        >
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
          onClick={() => {
            setNavOpen(false);
            window.setTimeout(() => navToggleRef.current?.focus({ preventScroll: true }), 0);
          }}
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
                window.setTimeout(() => navToggleRef.current?.focus({ preventScroll: true }), 0);
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
        <main
          ref={mainRef}
          className="admin__main"
          tabIndex={-1}
          inert={navOpen || undefined}
          aria-hidden={navOpen ? 'true' : undefined}
        >
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
                <span>محتوای SQLite گم‌شده، خراب، ناقص یا بدون شناسه نسخه معتبر است. محتوای پیش‌فرض فقط برای نمایش موقت بارگذاری شده و بخش‌های محتوایی تا بازیابی پاسخ معتبر فقط‌خواندنی هستند؛ ابتدا backup تأییدشده و نسخه سرور را بررسی کنید.</span>
              </div>
            </div>
          )}
          {contentConflict && (
            <div className="admin__notice admin__notice--error" role="alert">
              <Icons.refresh size={19} />
              <div>
                <strong>نسخه جدیدتری در پنل دیگری ذخیره شده است</strong>
                <span>{refreshing ? 'ذخیره متعارض رد شد و نسخه تازه در حال بارگذاری است…' : 'ذخیره متعارض رد شد و نسخه تازه بارگذاری شد. تغییر موردنظر را بررسی و دوباره اعمال کنید.'}</span>
              </div>
            </div>
          )}
          {!isBase && (
            <p className="admin__locale-note">
              در حال ویرایش نسخه {locale === 'en' ? 'انگلیسی' : locale === 'ar' ? 'عربی' : 'روسی'} سایت. محتوای فارسی پایه است و از تب‌های
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
