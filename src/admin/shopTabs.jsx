import { useEffect, useMemo, useRef, useState } from 'react';
import { Icons } from '../components/ui';
import { api, useContent } from '../content/ContentContext';
import { sanitizeHtmlResult, richTextRejectionMessage } from '../content/sanitize';
import { Field, UploadButton, PairListEditor, RichEditor } from './editors';
import { formatMoney } from '../shop/ShopContext';

const clone = (v) => JSON.parse(JSON.stringify(v));
const slugify = (s) =>
  String(s)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, '-')
    .replace(/^-+|-+$/g, '');
const num = (v, fallback = 0) => {
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : fallback;
};

const ORDER_STATUS = ['pending_payment', 'paid', 'shipped', 'delivered', 'cancelled'];
const STATUS_FA = {
  pending_payment: 'در انتظار پرداخت',
  paid: 'پرداخت‌شده',
  shipped: 'ارسال‌شده',
  delivered: 'تحویل‌شده',
  cancelled: 'لغو شده',
};
const PAYMENT_ATTEMPT_STATUS_FA = {
  issued: 'صادرشده',
  verified: 'تأییدشده؛ نیازمند رسیدگی',
  settled: 'تسویه‌کننده سفارش',
  reversing: 'reverse در حال انجام',
  reversal_failed: 'reverse ناموفق',
  reversed: 'بازگردانده‌شده',
};

/* Merchants scan different facts first, so the two long operational lists do
   not hard-code one idea of an "important" column. The primary identifier and
   the detail control always stay visible; everything else can be tailored and
   is remembered locally for that browser. */
const ORDER_LIST_COLUMNS = [
  { id: 'customer', label: 'مشتری' },
  { id: 'date', label: 'تاریخ' },
  { id: 'total', label: 'مبلغ' },
  { id: 'status', label: 'وضعیت' },
];
const CUSTOMER_LIST_COLUMNS = [
  { id: 'phone', label: 'موبایل' },
  { id: 'orders', label: 'سفارش‌ها' },
  { id: 'addresses', label: 'نشانی‌ها' },
  { id: 'joined', label: 'عضویت' },
  { id: 'state', label: 'وضعیت' },
];

const defaultColumnIds = (columns) => columns.map((column) => column.id);

function storedColumnIds(storageKey, columns) {
  const defaults = defaultColumnIds(columns);
  if (typeof window === 'undefined') return defaults;
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey));
    if (!Array.isArray(value)) return defaults;
    const known = new Set(defaults);
    return [...new Set(value.filter((id) => known.has(id)))];
  } catch {
    /* Storage can be blocked or carry an old/corrupt value. Neither should be
       able to take an operational admin list down. */
    return defaults;
  }
}

function useColumnVisibility(storageKey, columns) {
  const [visibleIds, setVisibleIds] = useState(() => storedColumnIds(storageKey, columns));

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(visibleIds));
    } catch {
      /* A privacy mode may reject writes; the in-memory preference still works
         for the current visit. */
    }
  }, [storageKey, visibleIds]);

  const toggle = (id) =>
    setVisibleIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  const reset = () => setVisibleIds(defaultColumnIds(columns));

  return { visible: new Set(visibleIds), toggle, reset };
}

function ColumnPicker({ id, label, primaryLabel, columns, visibility }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const keyboard = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', keyboard);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', keyboard);
    };
  }, [open]);

  return (
    <div className="column-picker" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="column-picker__trigger"
        aria-label={`تنظیم ستون‌های ${label}`}
        aria-expanded={open}
        aria-controls={open ? `${id}-columns` : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <Icons.gear size={15} />
        ستون‌ها
        <span aria-hidden="true">{visibility.visible.size + 1}</span>
      </button>
      {open && (
        <div className="column-picker__menu" id={`${id}-columns`} role="group" aria-label={`ستون‌های ${label}`}>
          <div className="column-picker__title">
            <b>نمایش ستون‌ها</b>
            <small>«{primaryLabel}» همیشه نمایش داده می‌شود.</small>
          </div>
          <div className="column-picker__options">
            {columns.map((column) => (
              <label key={column.id}>
                <input
                  type="checkbox"
                  checked={visibility.visible.has(column.id)}
                  onChange={() => visibility.toggle(column.id)}
                />
                <span>{column.label}</span>
              </label>
            ))}
          </div>
          <button
            type="button"
            className="column-picker__reset"
            onClick={() => {
              visibility.reset();
              setOpen(false);
              triggerRef.current?.focus();
            }}
          >
            نمایش همه ستون‌ها
          </button>
        </div>
      )}
    </div>
  );
}

/* The showcase is content, not presentation: admins choose only the image,
   destination and accessible description. Layout, motion and styling remain
   fixed in the public component. */
const showcaseSeed = (value) => {
  const valid = Array.isArray(value)
    ? value.filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    : [];
  return valid.length ? valid : [{
    id: 'shop-showcase-default',
    image: '/assets/img/bread-slicing.webp',
    href: '/products',
    alt: 'برش نان تازه تهیه‌شده با خمیرمایه خوزستان',
  }];
};

function ShopShowcaseEditor({ items, onSave }) {
  const [slides, setSlides] = useState(() => clone(showcaseSeed(items)));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => setSlides(clone(showcaseSeed(items))), [items]);

  const change = (index, field, value) => setSlides((current) => current.map((slide, slideIndex) => (
    slideIndex === index ? { ...slide, [field]: value } : slide
  )));
  const move = (index, direction) => setSlides((current) => {
    const target = index + direction;
    if (target < 0 || target >= current.length) return current;
    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const add = () => setSlides((current) => [...current, {
    id: `shop-showcase-${Date.now()}-${current.length}`,
    image: '',
    href: '',
    alt: '',
  }]);
  const remove = (index) => {
    if (slides.length <= 1) return;
    setSlides((current) => current.filter((_, slideIndex) => slideIndex !== index));
  };
  const saveSlides = async () => {
    const clean = slides.map((slide, index) => ({
      id: String(slide.id || `shop-showcase-${Date.now()}-${index}`),
      image: String(slide.image || '').trim(),
      href: String(slide.href || '').trim(),
      alt: String(slide.alt || '').trim(),
    }));
    if (clean.some((slide) => !slide.image || !slide.href || !slide.alt)) {
      window.alert('تصویر، پیوند و متن جایگزین برای همه اسلایدها الزامی است.');
      return;
    }
    if (clean.some((slide) => !/^\/(?!\/)/.test(slide.href) && !/^https?:\/\//i.test(slide.href))) {
      window.alert('پیوند باید با / آغاز شود یا یک نشانی کامل http/https باشد.');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      await onSave(clean);
      setMessage('ویترین فروشگاه ذخیره شد.');
    } catch {
      setMessage('ذخیره ویترین ممکن نشد؛ اتصال را بررسی کنید.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="shop-showcase-editor" aria-labelledby="shop-showcase-editor-title">
      <div className="shop-showcase-editor__head">
        <div>
          <h2 id="shop-showcase-editor-title">ویترین تصویری فروشگاه</h2>
          <p>یک یا چند تصویر تعیین کنید. هر تصویر به صفحه‌ای جداگانه پیوند می‌خورد و ترتیب نمایش از بالا به پایین است.</p>
        </div>
        <button type="button" className="btn btn--outline btn--sm" onClick={add}>
          + افزودن تصویر
        </button>
      </div>

      <div className="shop-showcase-editor__list">
        {slides.map((slide, index) => (
          <article className="shop-showcase-editor__item" key={slide.id || index}>
            <div className="shop-showcase-editor__preview">
              {slide.image ? <img src={slide.image} alt="" /> : <Icons.image size={28} />}
              <span>تصویر {new Intl.NumberFormat('fa-IR').format(index + 1)}</span>
            </div>
            <div className="shop-showcase-editor__fields">
              <div className="shop-showcase-editor__image-row">
                <Field label="نشانی تصویر" value={slide.image || ''} dir="ltr" onChange={(value) => change(index, 'image', value)} />
                <UploadButton
                  accept="image/*"
                  label="بارگذاری تصویر"
                  onUploaded={(url) => change(index, 'image', url)}
                />
              </div>
              <div className="admin__grid2">
                <Field label="پیوند صفحه (مثلاً /products)" value={slide.href || ''} dir="ltr" onChange={(value) => change(index, 'href', value)} />
                <Field label="متن جایگزین تصویر" value={slide.alt || ''} onChange={(value) => change(index, 'alt', value)} />
              </div>
            </div>
            <div className="shop-showcase-editor__actions" aria-label={`مرتب‌سازی تصویر ${index + 1}`}>
              <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label="انتقال به بالا">↑</button>
              <button type="button" onClick={() => move(index, 1)} disabled={index === slides.length - 1} aria-label="انتقال به پایین">↓</button>
              <button type="button" className="is-danger" onClick={() => remove(index)} disabled={slides.length === 1} aria-label="حذف تصویر">
                <Icons.trash size={16} />
              </button>
            </div>
          </article>
        ))}
      </div>

      <div className="shop-showcase-editor__footer">
        <button type="button" className="btn btn--primary" onClick={saveSlides} disabled={saving}>
          {saving ? 'در حال ذخیره…' : 'ذخیره ویترین'}
        </button>
        {message && <span role="status">{message}</span>}
      </div>
    </section>
  );
}

/* ================= shop products ================= */
export function ShopProductsTab() {
  const { state, save, reload, brands, products: catalog } = useContent();
  const shop = state.shop || { display: {}, products: [] };
  const items = shop.products || [];
  const display = shop.display || {};
  const [draft, setDraft] = useState(null);
  const [draftOriginalSlug, setDraftOriginalSlug] = useState(null);
  const [busy, setBusy] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [note, setNote] = useState(null);

  /* Stock moves on its own: every customer order and every order-status change
     in the orders tab changes it. This page loads once, so the numbers below
     age while the admin works — the button pulls the live figures back in. */
  const refresh = async () => {
    setBusy(true);
    setNote(null);
    try {
      await reload();
      setNote({ text: 'موجودی و اطلاعات محصولات بروزرسانی شد.' });
    } catch {
      setNote({ text: 'بروزرسانی ممکن نشد؛ اتصال را بررسی کنید.', bad: true });
    } finally {
      setBusy(false);
    }
  };

  const commitShop = (next, options) => save({ ...state, shop: { ...shop, ...next } }, options);

  const startNew = () => {
    setDraftOriginalSlug(null);
    setDraft({
      slug: `shop-${Date.now()}`,
      title: '',
      brand: brands[0]?.id,
      productSlug: '',
      unit: '',
      image: '/assets/products/dezmaye-gold.webp',
      price: 0,
      oldPrice: null,
      stock: 10,
      active: true,
      featured: false,
      commentsLocked: false,
      short: '',
      description: '',
      specs: [['وزن خالص', '']],
    });
  };

  const saveDraft = async () => {
    const sanitizedDescription = sanitizeHtmlResult(draft.description || '');
    if (!sanitizedDescription.ok) return window.alert(richTextRejectionMessage(sanitizedDescription));
    const clean = {
      ...draft,
      slug: slugify(draft.slug),
      price: Math.max(0, Math.round(num(draft.price))),
      oldPrice: draft.oldPrice ? Math.max(0, Math.round(num(draft.oldPrice))) : null,
      stock: Math.round(num(draft.stock, -1)),
      description: sanitizedDescription.html,
      specs: (draft.specs || []).filter(([k, v]) => k || v),
    };
    /* slugify() no longer invents a slug, so the blank case is caught here
       instead of silently becoming shop-1712… */
    if (!clean.slug) return window.alert('شناسه (slug) نمی‌تواند خالی باشد.');
    if (draftOriginalSlug && clean.slug !== draftOriginalSlug)
      return window.alert('شناسه محصول موجود قابل تغییر نیست؛ برای شناسه تازه، محصول جدید بسازید.');
    if (items.some((product) => product.slug === clean.slug && product.slug !== draftOriginalSlug))
      return window.alert('شناسه محصول باید یکتا باشد.');
    if (clean.active !== false && clean.price <= 0)
      return window.alert('برای محصول فعال، قیمت باید بیشتر از صفر ریال باشد.');
    if (!Number.isSafeInteger(clean.stock) || clean.stock < -1)
      return window.alert('موجودی باید ۱- (نامحدود) یا عددی نامنفی باشد.');
    if (clean.oldPrice && clean.oldPrice <= clean.price) clean.oldPrice = null;

    const existing = draftOriginalSlug
      ? items.find((product) => product.slug === draftOriginalSlug)
      : null;
    const nextProducts = existing
      ? items.map((product) => (product.slug === draftOriginalSlug ? clean : product))
      : [clean, ...items];

    setSavingDraft(true);
    setNote(null);
    try {
      /* Metadata saves preserve live inventory on the server. If this was an
         intentional stock edit, apply it separately with the value the admin
         saw; a sale in the meantime then produces 409 instead of disappearing. */
      await commitShop({ products: nextProducts }, { optimistic: false });
      if (existing && clean.slug === existing.slug && Number(clean.stock) !== Number(existing.stock)) {
        await api(`/api/shop-admin/products/${encodeURIComponent(clean.slug)}/stock`, {
          method: 'PATCH',
          auth: true,
          body: { stock: clean.stock, expectedStock: existing.stock },
        });
      }
      await reload();
      setDraft(null);
      setDraftOriginalSlug(null);
      setNote({ text: 'محصول و موجودی زنده ذخیره شد.' });
    } catch (error) {
      await reload().catch(() => {});
      if (error.status === 409) {
        window.alert(error.detail || 'موجودی در همین فاصله تغییر کرده است. اطلاعات تازه شد؛ مقدار جدید را بررسی کنید.');
      } else {
        window.alert(error.message || 'ذخیره محصول ممکن نشد.');
      }
    } finally {
      setSavingDraft(false);
    }
  };

  const remove = (slug) => {
    if (!window.confirm('این محصول از فروشگاه حذف شود؟ (دیدگاه‌های آن باقی می‌مانند)')) return;
    commitShop({ products: items.filter((p) => p.slug !== slug) });
  };

  if (draft) {
    return (
      <div className="admin__panel">
        <div className="admin__head">
          <h1>{draftOriginalSlug ? 'ویرایش محصول فروشگاه' : 'محصول جدید فروشگاه'}</h1>
        </div>
        <div className="admin__grid2">
          <Field label="عنوان محصول" value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} />
          <Field
            label="برند"
            value={draft.brand}
            onChange={(v) => setDraft({ ...draft, brand: v })}
            type="select"
            options={brands.map((b) => ({ value: b.id, label: `${b.fa} (${b.en})` }))}
          />
        </div>
        <div className="admin__grid2" style={{ marginTop: 12 }}>
          <Field label="واحد فروش (مثلاً بسته ۸۰ گرمی وکیوم)" value={draft.unit} onChange={(v) => setDraft({ ...draft, unit: v })} />
          <Field
            label="محصول مرتبط در کاتالوگ سایت"
            value={draft.productSlug}
            onChange={(v) => setDraft({ ...draft, productSlug: v })}
            type="select"
            options={[{ value: '', label: '— بدون پیوند —' }, ...catalog.map((p) => ({ value: p.slug, label: p.title }))]}
          />
        </div>
        <div className="admin__grid2" style={{ marginTop: 12 }}>
          <Field label="قیمت (ریال)" type="number" dir="ltr" value={draft.price} onChange={(v) => setDraft({ ...draft, price: v })} />
          <Field label="قیمت قبل از تخفیف (ریال — اختیاری)" type="number" dir="ltr" value={draft.oldPrice ?? ''} onChange={(v) => setDraft({ ...draft, oldPrice: v })} />
        </div>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
          معادل: {formatMoney(num(draft.price), 'rial')} · {formatMoney(num(draft.price), 'toman')}
        </p>
        <div className="admin__grid2" style={{ marginTop: 12 }}>
          <Field label="موجودی انبار (عدد؛ برای نامحدود: ۱-)" type="number" dir="ltr" value={draft.stock} onChange={(v) => setDraft({ ...draft, stock: v })} />
          <Field label="شناسه یکتا (slug)" value={draft.slug} dir="ltr" onChange={(v) => setDraft({ ...draft, slug: slugify(v) || v })} />
        </div>
        <div className="admin__row" style={{ marginTop: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>تصویر محصول:</span>
          {draft.image && <img src={draft.image} alt="" style={{ width: 84, height: 60, objectFit: 'cover', borderRadius: 8 }} />}
          <UploadButton accept="image/*" label="بارگذاری تصویر جدید" onUploaded={(url) => setDraft({ ...draft, image: url })} />
          <input
            value={draft.image}
            dir="ltr"
            onChange={(e) => setDraft({ ...draft, image: e.target.value })}
            style={{ flex: 1, border: '1.5px solid var(--line)', borderRadius: 10, padding: '8px 12px', fontSize: 12.5 }}
          />
        </div>
        <div className="admin__row" style={{ marginTop: 12, gap: 22, flexWrap: 'wrap' }}>
          <label className="admin__row" style={{ gap: 8 }}>
            <input type="checkbox" checked={!!draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
            فعال (در فروشگاه نمایش داده شود)
          </label>
          <label className="admin__row" style={{ gap: 8 }}>
            <input type="checkbox" checked={!!draft.featured} onChange={(e) => setDraft({ ...draft, featured: e.target.checked })} />
            برگزیده (نمایش در ویترین فروشگاه صفحه اصلی)
          </label>
          <label className="admin__row" style={{ gap: 8 }}>
            <input type="checkbox" checked={!!draft.commentsLocked} onChange={(e) => setDraft({ ...draft, commentsLocked: e.target.checked })} />
            بستن (قفل) بخش دیدگاه‌های این محصول
          </label>
        </div>
        <div style={{ marginTop: 14 }}>
          <Field label="توضیح کوتاه (روی کارت محصول)" textarea value={draft.short} onChange={(v) => setDraft({ ...draft, short: v })} />
        </div>
        <h3 style={{ margin: '22px 0 10px' }}>توضیحات کامل (با امکان پیوند، عکس و ویدیو)</h3>
        <RichEditor value={draft.description} onChange={(v) => setDraft({ ...draft, description: v })} />
        <h3 style={{ margin: '22px 0 10px' }}>جدول مشخصات</h3>
        <PairListEditor items={draft.specs} onChange={(v) => setDraft({ ...draft, specs: v })} />
        <div className="admin__row" style={{ marginTop: 24 }}>
          <button className="btn btn--primary" onClick={saveDraft} disabled={savingDraft}>
            {savingDraft ? 'در حال ذخیره…' : 'ذخیره محصول'}
          </button>
          <button
            className="btn btn--outline"
            disabled={savingDraft}
            onClick={() => {
              setDraft(null);
              setDraftOriginalSlug(null);
            }}
          >
            انصراف
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin__panel">
      <div className="admin__head">
        <div>
          <h1>فروشگاه — محصولات</h1>
          <p>افزودن، ویرایش، قیمت‌گذاری و حذف محصولات فروشگاه اینترنتی</p>
        </div>
        <div className="admin__row" style={{ gap: 8 }}>
          <button className="btn btn--outline" onClick={refresh} disabled={busy}>
            <Icons.refresh size={16} />
            {busy ? 'در حال بروزرسانی…' : 'بروزرسانی'}
          </button>
          <button className="btn btn--primary" onClick={startNew}>
            + محصول جدید
          </button>
        </div>
      </div>
      {note && (
        <p style={{ color: note.bad ? 'var(--crimson)' : 'var(--muted)', marginTop: -4 }}>{note.text}</p>
      )}
      <ShopShowcaseEditor
        items={display.showcase}
        onSave={(showcase) => commitShop({ display: { ...display, showcase } })}
      />
      <div className="admin__section-label">
        <h2>محصولات فروشگاه</h2>
        <span>{new Intl.NumberFormat('fa-IR').format(items.length)} محصول</span>
      </div>
      <div className="admin__list">
        {items.map((p) => (
          <div className="admin__item" key={p.slug}>
            <img src={p.image} alt="" />
            <div>
              <b>{p.title}</b>
              <small>
                {formatMoney(p.price, display.displayUnit === 'toman' ? 'toman' : 'rial')} · موجودی:{' '}
                {Number(p.stock) < 0 ? 'نامحدود' : new Intl.NumberFormat('fa-IR').format(p.stock)} ·{' '}
                {p.active ? 'فعال' : 'غیرفعال'}
                {p.commentsLocked ? ' · دیدگاه‌ها بسته' : ''}
              </small>
            </div>
            <div className="admin__actions">
              <button
                className="admin__iconbtn"
                title="ویرایش"
                onClick={() => {
                  setDraftOriginalSlug(p.slug);
                  setDraft(clone(p));
                }}
              >
                <Icons.edit size={16} />
              </button>
              <button className="admin__iconbtn danger" title="حذف" onClick={() => remove(p.slug)}>
                <Icons.trash size={16} />
              </button>
            </div>
          </div>
        ))}
        {!items.length && <p style={{ color: 'var(--muted)' }}>هنوز محصولی در فروشگاه نیست.</p>}
      </div>

      <h3 style={{ margin: '28px 0 12px' }}>تنظیمات فروشگاه</h3>
      <div className="admin__grid2">
        <Field
          label="واحد نمایش قیمت"
          value={display.displayUnit || 'rial'}
          onChange={(v) => commitShop({ display: { ...display, displayUnit: v } })}
          type="select"
          options={[
            { value: 'rial', label: 'ریال' },
            { value: 'toman', label: 'تومان' },
          ]}
        />
        <Field label="عنوان واحد پول" value={display.currencyLabel || 'ریال'} onChange={(v) => commitShop({ display: { ...display, currencyLabel: v } })} />
      </div>
      <div className="admin__grid2" style={{ marginTop: 12 }}>
        <Field label="هزینه ارسال (ریال)" type="number" dir="ltr" value={display.shippingCost ?? 0} onChange={(v) => commitShop({ display: { ...display, shippingCost: num(v) } })} />
        <Field label="ارسال رایگان برای خریدهای بالای (ریال — صفر یعنی غیرفعال)" type="number" dir="ltr" value={display.freeShippingOver ?? 0} onChange={(v) => commitShop({ display: { ...display, freeShippingOver: num(v) } })} />
      </div>
      <Field label="تلفن پشتیبانی فروشگاه" value={display.supportPhone || ''} onChange={(v) => commitShop({ display: { ...display, supportPhone: v } })} />
      <div className="admin__row" style={{ marginTop: 14, gap: 22, flexWrap: 'wrap' }}>
        <label className="admin__row" style={{ gap: 8 }}>
          <input type="checkbox" checked={display.enabled !== false} onChange={(e) => commitShop({ display: { ...display, enabled: e.target.checked } })} />
          فروشگاه فعال باشد
        </label>
        <label className="admin__row" style={{ gap: 8 }}>
          <input type="checkbox" checked={display.commentsEnabled !== false} onChange={(e) => commitShop({ display: { ...display, commentsEnabled: e.target.checked } })} />
          ثبت دیدگاه در فروشگاه مجاز باشد
        </label>
        <label className="admin__row" style={{ gap: 8 }}>
          <input type="checkbox" checked={display.commentsRequireApproval !== false} onChange={(e) => commitShop({ display: { ...display, commentsRequireApproval: e.target.checked } })} />
          دیدگاه‌ها پیش از نمایش، نیازمند تأیید مدیر باشند
        </label>
      </div>
    </div>
  );
}

/* ================= security + rate limits ================= */
const RATE_FIELDS = [
  ['message', 'پیام‌های تماس'],
  ['comment', 'دیدگاه‌های فروشگاه'],
  ['order', 'ثبت سفارش'],
  ['paymentRetry', 'تلاش دوباره برای پرداخت'],
  ['paymentCallback', 'بازگشت درگاه برای هر authority نگاشت‌شده'],
  ['adminLogin', 'ورود ناموفق مدیر'],
  ['otpPhone', 'ارسال کد به هر شماره'],
  ['otpIp', 'ارسال کد از هر IP'],
  ['customerLogin', 'ورود ناموفق هر مشتری'],
  ['customerLoginIp', 'ورود مشتری از هر IP'],
  ['register', 'تکمیل ثبت‌نام از هر IP'],
];

const faDuration = (milliseconds) => {
  const minutes = Math.round(Number(milliseconds || 0) / 60_000);
  return minutes >= 60 && minutes % 60 === 0
    ? `${new Intl.NumberFormat('fa-IR').format(minutes / 60)} ساعت`
    : `${new Intl.NumberFormat('fa-IR').format(minutes)} دقیقه`;
};

export function AdminSecurityTab() {
  const [snapshot, setSnapshot] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      setSnapshot(await api('/api/admin/security', { auth: true }));
    } catch (requestError) {
      setError(requestError.status === 401 ? 'نشست مدیر منقضی شده است.' : 'دریافت تنظیمات امنیتی ممکن نشد.');
    }
  };

  useEffect(() => { load(); }, []);

  const changeMax = (kind, value) => {
    const max = Math.max(1, Math.min(100_000, Math.round(num(value, 1))));
    setSnapshot((current) => ({
      ...current,
      rateLimits: {
        ...current.rateLimits,
        rules: {
          ...current.rateLimits.rules,
          [kind]: { ...current.rateLimits.rules[kind], max },
        },
      },
    }));
  };

  const save = async () => {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const result = await api('/api/admin/security', {
        method: 'PUT',
        auth: true,
        body: { rateLimits: snapshot.rateLimits },
      });
      setSnapshot(result);
      setMessage('تنظیمات محدودیت درخواست‌ها ذخیره شد.');
    } catch (requestError) {
      setError(requestError.status === 401 ? 'نشست مدیر منقضی شده است.' : 'ذخیره تنظیمات ممکن نشد.');
    } finally {
      setBusy(false);
    }
  };

  if (!snapshot && !error) return <div className="admin__panel"><p>در حال دریافت تنظیمات امنیتی…</p></div>;

  const proxy = snapshot?.proxy || {};
  const rateLimits = snapshot?.rateLimits;
  const proxyStatus = {
    direct: 'درخواست مستقیم است؛ هدر پراکسی IP دیده نشد.',
    resolved: 'IP واقعی بازدیدکننده از زنجیره پراکسی استخراج شد.',
    'forwarded-header-not-trusted': 'هدر پراکسی رسیده اما IP مؤثر هنوز IP اتصال Node است؛ TRUST_PROXY را روی سرور بررسی کنید.',
  }[proxy.status] || 'وضعیت پراکسی نامشخص است.';
  const protocolSource = {
    'direct-tls': 'TLS مستقیم Node',
    'forwarded-proto': 'X-Forwarded-Proto معتبر',
    'public-origin-trusted-proxy': 'PUBLIC_ORIGIN و Host روی پراکسی معتبر',
    'plain-http': 'HTTP بدون اثبات HTTPS',
  }[proxy.protocolSource] || 'نامشخص';
  const sharedLimits = snapshot?.rateLimitScope?.sharedAcrossWorkers;
  const protocolNeedsAttention = String(proxy.publicOrigin || '').startsWith('https://') && proxy.protocol !== 'https';

  return (
    <div className="admin__panel security-admin" data-testid="admin-security">
      <div className="admin__head">
        <div>
          <h1>امنیت و محدودیت درخواست‌ها</h1>
          <p>مشاهده IP و پروتکل مؤثر پشت Apache/Passenger و تنظیم سقف‌های ضدسوءاستفاده</p>
        </div>
        <button type="button" className="btn btn--outline" onClick={load} disabled={busy}>
          <Icons.refresh size={16} />
          بررسی دوباره
        </button>
      </div>

      {error && <p className="security-admin__notice is-bad" role="alert">{error}</p>}
      {message && <p className="security-admin__notice" role="status">{message}</p>}

      {snapshot && (
        <>
          <section className="security-admin__card" aria-labelledby="proxy-diagnostics-title">
            <div className="security-admin__card-head">
              <div>
                <h2 id="proxy-diagnostics-title">تشخیص IP، پروتکل و پراکسی</h2>
                <p>{proxyStatus}</p>
              </div>
              <span className={`security-admin__state is-${proxy.status || 'unknown'}`}>
                {proxy.status === 'resolved' ? 'پراکسی درست' : proxy.status === 'direct' ? 'اتصال مستقیم' : 'نیازمند بررسی'}
              </span>
            </div>
            <p className={`security-admin__notice ${protocolNeedsAttention ? 'is-bad' : ''}`} role="status">
              پروتکل مؤثر: <b dir="ltr">{proxy.protocol || '—'}</b> — {protocolSource}
            </p>
            <dl className="security-admin__diagnostics">
              <div><dt>IP مؤثر (req.ip)</dt><dd dir="ltr">{proxy.clientIp || '—'}</dd></div>
              <div><dt>IP اتصال Node</dt><dd dir="ltr">{proxy.socketIp || '—'}</dd></div>
              <div><dt>پروتکل Express</dt><dd dir="ltr">{proxy.expressProtocol || '—'}</dd></div>
              <div><dt>X-Forwarded-Proto</dt><dd dir="ltr">{proxy.forwardedProto || '—'}</dd></div>
              <div><dt>Host درخواست</dt><dd dir="ltr">{proxy.requestHost || '—'}</dd></div>
              <div><dt>PUBLIC_ORIGIN</dt><dd dir="ltr">{proxy.publicOrigin || '—'}</dd></div>
              <div><dt>X-Forwarded-For</dt><dd dir="ltr">{proxy.forwardedFor || '—'}</dd></div>
              <div><dt>trust proxy</dt><dd dir="ltr">{proxy.setting || '—'}</dd></div>
            </dl>
            <p className="security-admin__help">
              پراکسی باید <code>X-Forwarded-Proto: https</code> را ارسال کند. اگر میزبان این هدر را حذف کند،
              سرور فقط وقتی HTTPS را از <code>PUBLIC_ORIGIN</code> نتیجه می‌گیرد که اتصال Node از پراکسی مورد اعتماد آمده
              و Host نیز با origin یا <code>TRUSTED_HOSTS</code> تطبیق داشته باشد. پذیرش همه پراکسی‌ها
              (<code>TRUST_PROXY=true</code>) توصیه نمی‌شود.
            </p>
          </section>

          <section className="security-admin__card" aria-labelledby="rate-limits-title">
            <div className="security-admin__card-head">
              <div>
                <h2 id="rate-limits-title">محدودیت درخواست‌ها</h2>
                <p>
                  سقف‌ها محافظه‌کارانه و {sharedLimits ? 'از طریق SQLite بین همه workerهای Passenger مشترک‌اند' : 'برای این فرایند اعمال می‌شوند'}؛
                  فقط درخواست معتبر یا تلاش ناموفقِ قابل‌سوءاستفاده شمرده می‌شود.
                </p>
              </div>
              <label className="security-admin__switch">
                <input
                  type="checkbox"
                  checked={rateLimits.enabled}
                  onChange={(event) => setSnapshot({
                    ...snapshot,
                    rateLimits: { ...rateLimits, enabled: event.target.checked },
                  })}
                />
                <span>{rateLimits.enabled ? 'محدودیت‌ها فعال' : 'همه محدودیت‌ها غیرفعال'}</span>
              </label>
            </div>

            {!rateLimits.enabled && (
              <p className="security-admin__warning" role="note">
                همه سقف‌ها، از جمله ورود مدیر و ارسال کد پیامکی، غیرفعال خواهند بود. فقط برای عیب‌یابی کوتاه‌مدت استفاده کنید.
              </p>
            )}

            <div className="security-admin__limits">
              {RATE_FIELDS.map(([kind, label]) => {
                const rule = rateLimits.rules[kind];
                return (
                  <label className="security-admin__limit" key={kind}>
                    <span>{label}</span>
                    <small>در {faDuration(rule.windowMs)}</small>
                    <input
                      type="number"
                      min="1"
                      max="100000"
                      dir="ltr"
                      value={rule.max}
                      onChange={(event) => changeMax(kind, event.target.value)}
                    />
                  </label>
                );
              })}
            </div>

            <div className="admin__row security-admin__actions">
              <button type="button" className="btn btn--primary" onClick={save} disabled={busy}>
                {busy ? 'در حال ذخیره…' : 'ذخیره تنظیمات امنیتی'}
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/* ================= shop orders ================= */
export function ShopOrdersTab() {
  const [orders, setOrders] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(null);
  const [notes, setNotes] = useState({});
  const [gw, setGw] = useState({}); // per-order gateway result
  const [savingStatus, setSavingStatus] = useState({});
  const [feedback, setFeedback] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const columns = useColumnVisibility('khyeast.admin.columns.orders.v1', ORDER_LIST_COLUMNS);

  const load = async () => {
    try {
      setErr('');
      const d = await api('/api/shop-admin', { auth: true });
      setOrders(d.orders || []);
    } catch (e) {
      setErr(e.status === 401 ? 'نشست مدیر منقضی شده؛ دوباره وارد شوید.' : 'دریافت سفارش‌ها ممکن نشد.');
    }
  };
  useEffect(() => {
    load();
  }, []);

  const explainOrderError = (error, fallback) =>
    error.status === 409
      ? error.detail || 'موجودی برای بازگرداندن این سفارش کافی نیست؛ ابتدا موجودی محصول را افزایش دهید.'
      : error.status === 401
        ? 'نشست مدیر منقضی شده؛ دوباره وارد شوید.'
        : fallback;

  /* Status is deliberately separate from the detail editor: this is the hot
     path for fulfilment, so paid → shipped is one direct, optimistic action.
     The server remains authoritative and a failed stock re-reservation rolls
     the row back with the existing 409 explanation. */
  const changeStatus = async (id, status) => {
    const previous = orders?.find((order) => order.id === id)?.status;
    if (!previous || previous === status || savingStatus[id]) return;

    setErr('');
    setFeedback('');
    setSavingStatus((current) => ({ ...current, [id]: true }));
    setOrders((current) => current?.map((order) => (order.id === id ? { ...order, status } : order)));
    try {
      await api(`/api/shop-admin/orders/${id}`, { method: 'PATCH', body: { status }, auth: true });
      setFeedback(`وضعیت سفارش به «${STATUS_FA[status]}» تغییر کرد.`);
      await load();
    } catch (error) {
      setOrders((current) => current?.map((order) => (order.id === id ? { ...order, status: previous } : order)));
      setErr(explainOrderError(error, 'تغییر وضعیت سفارش ممکن نشد.'));
    } finally {
      setSavingStatus((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
  };

  /* Ask the gateway, or hand the money back. Both answer into the same
     per-order slot, so a result can never appear under the wrong order. */
  const gateway = async (id, action) => {
    setGw((g) => ({ ...g, [id]: { msg: 'در حال ارتباط با درگاه…' } }));
    try {
      const d = await api(`/api/shop-admin/orders/${id}/${action}`, { method: 'POST', auth: true });
      if (action === 'reverse') {
        setGw((g) => ({ ...g, [id]: { msg: 'مبلغ بازگردانده و سفارش لغو شد.' } }));
        load();
      } else {
        setGw((g) => ({
          ...g,
          [id]: { msg: d.settled ? 'درگاه: این پرداخت تأیید شده است.' : `درگاه: ${d.status || d.message || 'بدون نتیجه'}`, err: !d.ok },
        }));
      }
    } catch (e) {
      setGw((g) => ({ ...g, [id]: { msg: e.message || 'ارتباط با درگاه ممکن نشد.', err: true } }));
    }
  };

  const reverseAttempt = async (orderId, authority) => {
    const key = `${orderId}:${authority}`;
    setGw((current) => ({ ...current, [key]: { msg: 'در حال بازیابی reverse این تلاش…' } }));
    try {
      const result = await api(
        `/api/shop-admin/orders/${encodeURIComponent(orderId)}/payment-attempts/${encodeURIComponent(authority)}/reverse`,
        { method: 'POST', auth: true },
      );
      setGw((current) => ({
        ...current,
        [key]: { msg: result.reclaimed ? 'claim متوقف‌شده بازیابی و مبلغ بازگردانده شد.' : 'مبلغ این تلاش بازگردانده شد.' },
      }));
      await load();
    } catch (error) {
      setGw((current) => ({
        ...current,
        [key]: { msg: error.message || 'بازگرداندن این تلاش ممکن نشد.', err: true },
      }));
      /* The failed claim and durable attention flag are server state too; show
         them immediately instead of requiring a manual panel refresh. */
      await load();
    }
  };

  const patch = async (id, body, method = 'PATCH') => {
    setErr('');
    setFeedback('');
    try {
      await api(`/api/shop-admin/orders/${id}`, { method, body, auth: true });
      if (method === 'PATCH') setFeedback('تغییرات سفارش ذخیره شد.');
      await load();
    } catch (e) {
      setErr(explainOrderError(e, method === 'DELETE' ? 'حذف سفارش ممکن نشد.' : 'ذخیره تغییرات سفارش ممکن نشد.'));
    }
  };

  const fa = (rial) => new Intl.NumberFormat('fa-IR').format(Math.round(rial || 0));
  const gridStyle = {
    '--visible-columns': String(columns.visible.size),
    '--grid-min-width': `${236 + columns.visible.size * 118}px`,
  };
  const attentionCount = orders?.filter((order) => order.needsAttention).length || 0;
  const archivedCount = orders?.filter((order) => order.archived).length || 0;
  const visibleOrders = orders?.filter((order) => Boolean(order.archived) === showArchived) || [];

  return (
    <div className="admin__panel">
      <div className="admin__head">
        <div>
          <h1>سفارش‌های فروشگاه</h1>
          <p>مشاهده، تغییر وضعیت و پیگیری سفارش‌های ثبت‌شده</p>
        </div>
        <div className="admin__head-actions">
          <ColumnPicker
            id="order"
            label="سفارش‌ها"
            primaryLabel="کد سفارش"
            columns={ORDER_LIST_COLUMNS}
            visibility={columns}
          />
          <button
            className={`btn btn--outline ${showArchived ? 'is-active' : ''}`}
            type="button"
            aria-pressed={showArchived}
            onClick={() => {
              setOpen(null);
              setShowArchived((current) => !current);
            }}
          >
            <Icons.box size={16} />
            {showArchived ? 'سفارش‌های جاری' : `بایگانی (${fa(archivedCount)})`}
          </button>
          <button className="btn btn--outline" type="button" onClick={load}>
            <Icons.refresh size={16} />
            به‌روزرسانی
          </button>
        </div>
      </div>
      <div className="sr-only" role="status" aria-live="polite">{feedback}</div>
      {err && <p className="ord__error" role="alert">{err}</p>}
      {attentionCount > 0 && (
        <div className="ord__attention-summary" role="alert">
          <strong>{fa(attentionCount)} سفارش نیازمند رسیدگی فوری است</strong>
          <span>بازگرداندن خودکار وجه کامل نشده است؛ سفارش نشان‌دار را بررسی و پس از حل موضوع، هشدار آن را تأیید کنید.</span>
        </div>
      )}
      {orders === null && !err && <p style={{ color: 'var(--muted)' }}>در حال دریافت…</p>}
      {orders?.length === 0 && <p style={{ color: 'var(--muted)' }}>هنوز سفارشی ثبت نشده است.</p>}
      {orders !== null && orders.length > 0 && visibleOrders.length === 0 && (
        <p style={{ color: 'var(--muted)' }}>
          {showArchived ? 'هنوز سفارشی بایگانی نشده است.' : 'همه سفارش‌ها بایگانی شده‌اند.'}
        </p>
      )}

      {visibleOrders.length > 0 && (
        <div
          className="admin-data-grid admin-data-grid--orders"
          style={gridStyle}
          role="region"
          aria-label="فهرست سفارش‌ها"
          tabIndex={0}
        >
          <div className="admin-data-grid__header ord__grid" aria-hidden="true">
            <span>کد سفارش</span>
            {columns.visible.has('customer') && <span>مشتری</span>}
            {columns.visible.has('date') && <span>تاریخ</span>}
            {columns.visible.has('total') && <span>مبلغ</span>}
            {columns.visible.has('status') && <span>وضعیت</span>}
            <span />
          </div>

          <div className="ord__list">
            {visibleOrders.map((o) => {
              const expanded = open === o.id;
              const detailId = `order-detail-${String(o.id).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
              const at = new Date(o.at);
              const validDate = !Number.isNaN(at.getTime());
              const paymentAttempts = Array.isArray(o.paymentAttempts) ? o.paymentAttempts : [];
              const hasProtectedPayment = paymentAttempts.length > 0 || (
                o.provider !== 'offline' && Boolean(
                  o.payRef || o.paidAt || ['paid', 'shipped', 'delivered'].includes(o.status),
                )
              );
              return (
                <article
                  className={`ord__item ${expanded ? 'is-open' : ''} ${o.status === 'pending_payment' ? 'is-attention' : ''} ${o.needsAttention ? 'is-needs-attention' : ''}`}
                  key={o.id}
                >
                  <div className="ord__row ord__grid">
                    <button
                      type="button"
                      className="ord__identity"
                      onClick={() => setOpen(expanded ? null : o.id)}
                      aria-expanded={expanded}
                      aria-controls={expanded ? detailId : undefined}
                    >
                      <b dir="ltr">{o.code}</b>
                      {o.needsAttention && <span className="ord__attention-badge">نیازمند رسیدگی</span>}
                    </button>

                    {columns.visible.has('customer') && (
                      <span className="ord__customer">
                        <b>{o.customer?.name || '—'}</b>
                        <small dir="ltr">{o.customer?.phone ? localPhone(o.customer.phone) : '—'}</small>
                      </span>
                    )}
                    {columns.visible.has('date') && (
                      <time className="ord__date" dateTime={o.at}>
                        <span>{validDate ? at.toLocaleDateString('fa-IR') : '—'}</span>
                        <small>{validDate ? at.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }) : ''}</small>
                      </time>
                    )}
                    {columns.visible.has('total') && <b className="ord__total">{fa(o.total)} <small>ریال</small></b>}
                    {columns.visible.has('status') && (
                      <select
                        className={`ord__status is-${o.status}`}
                        value={o.status}
                        onChange={(e) => changeStatus(o.id, e.target.value)}
                        disabled={Boolean(savingStatus[o.id])}
                        aria-label={`وضعیت سفارش ${o.code}`}
                        aria-busy={Boolean(savingStatus[o.id])}
                      >
                        {ORDER_STATUS.map((status) => (
                          <option key={status} value={status}>{STATUS_FA[status]}</option>
                        ))}
                      </select>
                    )}
                    <button
                      type="button"
                      className="ord__expand"
                      onClick={() => setOpen(expanded ? null : o.id)}
                      aria-label={`${expanded ? 'بستن' : 'نمایش'} جزئیات سفارش ${o.code}`}
                      aria-expanded={expanded}
                      aria-controls={expanded ? detailId : undefined}
                    >
                      <Icons.arrow size={16} />
                    </button>
                  </div>

                  {expanded && (
                    <div className="ord__detail" id={detailId} role="region" aria-label={`جزئیات سفارش ${o.code}`}>
                      {o.needsAttention && (
                        <div className="ord__attention-alert" role="alert">
                          <div>
                            <strong>بازگرداندن وجه این سفارش هنوز نیازمند پیگیری است</strong>
                            <p>وضعیت را از درگاه بررسی کنید و فقط پس از بازگشت وجه یا حل دستی موضوع، این هشدار را پاک کنید.</p>
                          </div>
                          <button
                            type="button"
                            className="btn btn--outline btn--sm"
                            onClick={() =>
                              window.confirm('تأیید می‌کنید موضوع بازگرداندن وجه این سفارش کاملاً رسیدگی شده است؟') &&
                              patch(o.id, { needsAttention: false })
                            }
                          >
                            <Icons.check size={15} />
                            رسیدگی شد؛ پاک‌کردن هشدار
                          </button>
                        </div>
                      )}
                      <p className="ord__detail-title">اقلام سفارش</p>
                      <div className="ord__items">
                        {(o.items || []).map((it) => (
                          <p key={it.slug}>
                            <span>{it.title} × {fa(it.qty)}</span>
                            <b>{fa(it.sum)} ریال</b>
                          </p>
                        ))}
                      </div>
                      <p className="ord__summary">
                        جمع اقلام {fa(o.subtotal)} + ارسال {o.shipping === 0 ? 'رایگان' : `${fa(o.shipping)} ریال`} = <b>{fa(o.total)} ریال</b>
                      </p>
                      <p className="ord__address">
                        آدرس: {o.customer?.city || '—'} — {o.customer?.address || '—'}
                        {o.customer?.postal ? ` (کد پستی ${o.customer.postal})` : ''}
                        {o.customer?.note ? ` — توضیحات: ${o.customer.note}` : ''}
                      </p>
                      <p className="ord__payment">
                        درگاه: {o.provider === 'zarinpal' ? 'زرین‌پال' : '—'}
                        {o.payAuthority ? ` · اتوریتی: ${String(o.payAuthority).slice(0, 40)}` : ''}
                        {o.payRef ? ` · شناسه پیگیری: ${String(o.payRef).slice(0, 30)}` : ''}
                        {o.paidAt ? ` · پرداخت: ${new Date(o.paidAt).toLocaleString('fa-IR')}` : ''}
                      </p>
                      {paymentAttempts.length > 0 && (
                        <div className="ord__attempts">
                          <p className="ord__detail-title">تلاش‌های پرداخت</p>
                          {paymentAttempts.map((attempt) => {
                            const attemptKey = `${o.id}:${attempt.authority}`;
                            const canRetryReverse =
                              attempt.authority !== o.payAuthority &&
                              ['verified', 'reversing', 'reversal_failed'].includes(attempt.status);
                            return (
                              <div className="ord__attempt" key={attempt.authority}>
                                <div>
                                  <b dir="ltr">{attempt.authority}</b>
                                  <small>
                                    {PAYMENT_ATTEMPT_STATUS_FA[attempt.status] || attempt.status}
                                    {attempt.refId ? ` · ref_id: ${attempt.refId}` : ''}
                                    {attempt.reversalStartedAt
                                      ? ` · شروع reverse: ${new Date(attempt.reversalStartedAt).toLocaleString('fa-IR')}`
                                      : ''}
                                  </small>
                                  {attempt.lastError && <small className="is-error">خطا: {attempt.lastError}</small>}
                                </div>
                                {canRetryReverse && (
                                  <button
                                    type="button"
                                    className="btn btn--outline btn--sm ord__delete"
                                    onClick={() =>
                                      window.confirm('reverse همین تلاش پرداخت دوباره اجرا شود؟ پرداخت اصلی سفارش دست‌نخورده می‌ماند.') &&
                                      reverseAttempt(o.id, attempt.authority)
                                    }
                                  >
                                    بازیابی reverse این تلاش
                                  </button>
                                )}
                                {gw[attemptKey] && (
                                  <span className={`pay__msg ${gw[attemptKey].err ? 'is-err' : ''}`}>{gw[attemptKey].msg}</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <div className="admin__row ord__detail-actions">
                        <button
                          type="button"
                          className="btn btn--outline btn--sm"
                          disabled={!o.archived && o.needsAttention}
                          title={!o.archived && o.needsAttention ? 'ابتدا هشدار مالی این سفارش را رسیدگی کنید.' : undefined}
                          onClick={() => patch(o.id, { archived: !o.archived })}
                        >
                          <Icons.box size={15} />
                          {o.archived ? 'بازگرداندن به سفارش‌های جاری' : 'بایگانی سفارش'}
                        </button>
                        {!o.archived && (
                          <button
                            type="button"
                            className="btn btn--outline btn--sm ord__delete"
                            disabled={hasProtectedPayment}
                            title={hasProtectedPayment ? 'سفارش دارای تلاش پرداخت آنلاین است و برای نگاشت callback و سوابق مالی باید نگهداری شود.' : undefined}
                            onClick={() => window.confirm('این سفارش حذف شود؟') && patch(o.id, null, 'DELETE')}
                          >
                            {hasProtectedPayment ? 'حذف غیرفعال — تلاش پرداخت' : 'حذف سفارش'}
                          </button>
                        )}
                      </div>

                      {/* Gateway inquiry and reversal both require the original
                          authority, not the post-settlement ref_id. */}
                      {o.payAuthority && o.provider === 'zarinpal' && (
                        <div className="admin__row ord__gateway">
                          <button type="button" className="btn btn--outline btn--sm" onClick={() => gateway(o.id, 'inquire')}>
                            استعلام وضعیت از درگاه
                          </button>
                          {(o.status === 'paid' || o.needsAttention) && (
                            <button
                              type="button"
                              className="btn btn--outline btn--sm ord__delete"
                              onClick={() =>
                                window.confirm('مبلغ این سفارش به خریدار بازگردانده شود؟ این کار فقط تا ۳۰ دقیقه پس از پرداخت ممکن است و سفارش لغو می‌شود.') &&
                                gateway(o.id, 'reverse')
                              }
                            >
                              بازگرداندن وجه
                            </button>
                          )}
                          {gw[o.id] && <span className={`pay__msg ${gw[o.id].err ? 'is-err' : ''}`}>{gw[o.id].msg}</span>}
                        </div>
                      )}
                      <div className="ord__note">
                        <Field
                          label="یادداشت داخلی (فقط برای مدیر)"
                          textarea
                          rows={2}
                          value={notes[o.id] ?? o.adminNote ?? ''}
                          onChange={(value) => setNotes({ ...notes, [o.id]: value })}
                        />
                        <button
                          type="button"
                          className="btn btn--outline btn--sm"
                          onClick={() => patch(o.id, { adminNote: notes[o.id] ?? o.adminNote ?? '' })}
                        >
                          ذخیره یادداشت
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
/* ================= shop comments ================= */
export function ShopCommentsTab() {
  const { state } = useContent();
  const shop = state.shop || { products: [] };
  const [comments, setComments] = useState(null);
  const [err, setErr] = useState('');
  const [replies, setReplies] = useState({});

  const load = async () => {
    try {
      setErr('');
      const d = await api('/api/shop-admin', { auth: true });
      setComments(d.comments || []);
    } catch (e) {
      setErr(e.status === 401 ? 'نشست مدیر منقضی شده؛ دوباره وارد شوید.' : 'دریافت دیدگاه‌ها ممکن نشد.');
    }
  };
  useEffect(() => {
    load();
  }, []);

  const patch = async (id, body, method = 'PATCH') => {
    await api(`/api/shop-admin/comments/${id}`, { method, body, auth: true });
    load();
  };

  const titleOf = (slug) => (shop.products || []).find((p) => p.slug === slug)?.title || slug;

  return (
    <div className="admin__panel">
      <div className="admin__head">
        <div>
          <h1>دیدگاه‌های فروشگاه</h1>
          <p>تأیید، پاسخ‌گویی و حذف دیدگاه‌ها؛ قفل بخش دیدگاه‌ها از تب «فروشگاه — محصولات»</p>
        </div>
        <button className="btn btn--outline" onClick={load}>
          <Icons.refresh size={16} />
          به‌روزرسانی
        </button>
      </div>
      {err && <p style={{ color: 'var(--crimson-ink)' }}>{err}</p>}
      {comments === null && !err && <p style={{ color: 'var(--muted)' }}>در حال دریافت…</p>}
      {comments?.length === 0 && <p style={{ color: 'var(--muted)' }}>هنوز دیدگاهی ثبت نشده است.</p>}
      {comments?.map((c) => (
        <div className="msg" key={c.id}>
          <div className="msg__head" style={{ cursor: 'default' }}>
            <div>
              <b>{c.name}</b> <small>· {titleOf(c.slug)}</small>
              <div>
                <small>{new Date(c.at).toLocaleString('fa-IR')}</small>
              </div>
            </div>
            <span className={`msg__badge ${c.approved ? 'read' : ''}`}>{c.approved ? 'تأییدشده' : 'در انتظار تأیید'}</span>
          </div>
          <div className="msg__body">
            <p style={{ whiteSpace: 'pre-wrap', lineHeight: 2 }}>{c.text}</p>
            {c.reply && (
              <p style={{ background: 'var(--bg-soft)', borderRadius: 10, padding: '10px 14px', fontSize: 13, lineHeight: 2, margin: '10px 0' }}>
                <b style={{ color: 'var(--crimson-ink)' }}>پاسخ مدیر: </b>
                {c.reply}
              </p>
            )}
            <Field
              label={c.reply ? 'ویرایش پاسخ' : 'پاسخ به دیدگاه'}
              textarea
              rows={2}
              value={replies[c.id] ?? c.reply ?? ''}
              onChange={(v) => setReplies({ ...replies, [c.id]: v })}
            />
            <div className="admin__row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
              <button className="btn btn--primary btn--sm" onClick={() => patch(c.id, { reply: replies[c.id] ?? c.reply ?? '' })}>
                <Icons.send size={15} /> ذخیره پاسخ
              </button>
              {c.reply && (
                <button className="btn btn--outline btn--sm" onClick={() => patch(c.id, { reply: null })}>
                  حذف پاسخ
                </button>
              )}
              <button className="btn btn--outline btn--sm" onClick={() => patch(c.id, { approved: !c.approved })}>
                {c.approved ? 'برگشت به «در انتظار تأیید»' : 'تأیید و نمایش در سایت'}
              </button>
              <button className="btn btn--outline btn--sm" style={{ color: 'var(--crimson-ink)' }} onClick={() => window.confirm('این دیدگاه حذف شود؟') && patch(c.id, null, 'DELETE')}>
                حذف دیدگاه
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ================= payment gateway ================= */
export function ShopPaymentTab() {
  const [cfg, setCfg] = useState(null);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  /* gateway tools */
  const [unverified, setUnverified] = useState(null);
  const [tools, setTools] = useState({ msg: '', kind: 'ok' });
  const [feeAmount, setFeeAmount] = useState('1000000');
  const [fee, setFee] = useState(null);
  const [tx, setTx] = useState(null);
  const [txFilter, setTxFilter] = useState('PAID');
  /* A refund is keyed on a ledger row's session id, so the form is opened
     from a row rather than asking the admin to paste an id from somewhere
     else — that is the mistake this UI exists to prevent. */
  const [refundFor, setRefundFor] = useState(null);
  const [refund, setRefund] = useState({ amount: '', orderCode: '', method: 'PAYA', reason: 'CUSTOMER_REQUEST', description: '' });
  const [refunds, setRefunds] = useState(null);
  const [statusId, setStatusId] = useState('');
  const [rStatus, setRStatus] = useState(null);

  const faQ = (n) => Number(n || 0).toLocaleString('fa-IR');
  const say = (kind, msg) => {
    setTools({ kind, msg });
    setTimeout(() => setTools({ kind: 'ok', msg: '' }), 5000);
  };

  const load = async () => {
    try {
      setErr('');
      setCfg(await api('/api/shop-admin/payment', { auth: true }));
    } catch (e) {
      setErr(e.status === 401 ? 'نشست مدیر منقضی شده؛ دوباره وارد شوید.' : 'دریافت تنظیمات ممکن نشد.');
    }
  };
  useEffect(() => {
    load();
  }, []);

  const saveCfg = async () => {
    setBusy(true);
    setOk(false);
    try {
      const d = await api('/api/shop-admin/payment', { method: 'PUT', body: cfg, auth: true });
      setCfg(d.payment);
      setOk(true);
      setTimeout(() => setOk(false), 2500);
    } catch {
      setErr('ذخیره تنظیمات ممکن نشد.');
    } finally {
      setBusy(false);
    }
  };

  const loadUnverified = async () => {
    setUnverified('loading');
    try {
      const d = await api('/api/shop-admin/payment/unverified', { auth: true });
      setUnverified(d.unverified || []);
      if (!d.ok && d.error) say('err', d.error);
    } catch {
      setUnverified([]);
      say('err', 'دریافت فهرست تراکنش‌های تأیید‌نشده ممکن نشد.');
    }
  };

  const settle = async (authority) => {
    try {
      const d = await api(`/api/shop-admin/payment/unverified/${authority}/verify`, { method: 'POST', auth: true });
      say('ok', `سفارش ${d.order.code} تأیید و «پرداخت‌شده» شد.`);
      loadUnverified();
    } catch (e) {
      say('err', e.message || 'تأیید این تراکنش ممکن نشد.');
    }
  };

  const getFee = async () => {
    setFee('loading');
    try {
      const d = await api(`/api/shop-admin/payment/fee?amount=${encodeURIComponent(feeAmount)}`, { auth: true });
      setFee(d);
    } catch {
      setFee({ ok: false, error: 'محاسبه کارمزد ممکن نشد.' });
    }
  };

  const loadTx = async () => {
    setTx('loading');
    try {
      setTx(await api(`/api/shop-admin/payment/transactions?filter=${txFilter}&limit=20`, { auth: true }));
    } catch {
      setTx({ ok: false, error: 'دریافت تراکنش‌ها ممکن نشد.', transactions: [] });
    }
  };

  const openRefund = (row) => {
    setRefundFor(row);
    setRefund({ amount: String(row.amount || ''), orderCode: '', method: 'PAYA', reason: 'CUSTOMER_REQUEST', description: '' });
  };

  const sendRefund = async () => {
    try {
      await api('/api/shop-admin/payment/refunds', {
        method: 'POST',
        body: { sessionId: refundFor.id, ...refund },
        auth: true,
      });
      say('ok', `برگشت وجه ثبت شد${refund.orderCode ? ` و سفارش ${refund.orderCode} لغو شد` : ''}.`);
      /* Prefill the status box with the session just refunded, so checking
         it is one click rather than copying an id around. */
      setStatusId(String(refundFor.id));
      setRefundFor(null);
      loadRefunds();
    } catch (e) {
      say('err', e.message || 'برگشت وجه ممکن نشد.');
    }
  };

  const checkRefund = async () => {
    setRStatus('loading');
    try {
      setRStatus(await api(`/api/shop-admin/payment/refunds/${encodeURIComponent(statusId)}`, { auth: true }));
    } catch {
      setRStatus({ ok: false, error: 'بررسی وضعیت ممکن نشد.' });
    }
  };

  const loadRefunds = async () => {
    setRefunds('loading');
    try {
      const d = await api('/api/shop-admin/payment/refunds?limit=20', { auth: true });
      setRefunds(d);
    } catch {
      setRefunds({ ok: false, error: 'دریافت فهرست برگشت‌ها ممکن نشد.', refunds: [] });
    }
  };

  if (!cfg && !err) return <div className="admin__panel"><p style={{ color: 'var(--muted)' }}>در حال دریافت…</p></div>;

  return (
    <div className="admin__panel">
      <div className="admin__head">
        <div>
          <h1>درگاه پرداخت — زرین‌پال</h1>
          <p>اتصال، تأیید تراکنش‌های معلق، بازگرداندن وجه و گزارش‌ها</p>
        </div>
      </div>
      {err && <p style={{ color: 'var(--crimson-ink)' }}>{err}</p>}

      {cfg && (
        <>
          <p className="pay__state" data-ok={cfg.canPay ? '1' : '0'}>
            {cfg.canPay
              ? `● آماده دریافت پرداخت — ${cfg.zarinpalSandbox ? 'محیط آزمایشی' : 'محیط اصلی'}`
              : '● پرداخت آنلاین غیرفعال است؛ سفارش‌ها با وضعیت «در انتظار پرداخت» ثبت می‌شوند.'}
          </p>

          <Field
            label="درگاه فعال"
            value={cfg.provider}
            onChange={(v) => setCfg({ ...cfg, provider: v })}
            type="select"
            options={[
              { value: 'offline', label: 'غیرفعال — سفارش‌ها بدون پرداخت آنلاین ثبت می‌شوند' },
              { value: 'zarinpal', label: 'زرین‌پال (ZarinPal)' },
            ]}
          />

          {cfg.provider === 'zarinpal' && (
            <div style={{ marginTop: 14, display: 'grid', gap: 14 }}>
              <Field
                label={cfg.hasZarinpalMerchant ? 'Merchant ID — برای تغییر، شناسه جدید را وارد کنید' : 'Merchant ID'}
                dir="ltr"
                value={cfg.zarinpalMerchant}
                onChange={(v) => setCfg({ ...cfg, zarinpalMerchant: v })}
              />
              {cfg.hasZarinpalMerchant && !cfg.zarinpalMerchantValid && (
                <p style={{ fontSize: 12, color: 'var(--crimson-ink)', lineHeight: 2, margin: 0 }}>
                  شناسه ذخیره‌شده قالب درست (UUID ۳۶ کاراکتری) ندارد؛ تا اصلاح آن، سفارش‌ها بدون پرداخت آنلاین ثبت می‌شوند.
                </p>
              )}
              <label className="admin__row" style={{ gap: 8 }}>
                <input type="checkbox" checked={!!cfg.zarinpalSandbox} onChange={(e) => setCfg({ ...cfg, zarinpalSandbox: e.target.checked })} />
                حالت آزمایشی (Sandbox)
              </label>

              <details className="pay__more">
                <summary>تنظیمات گزارش تراکنش‌ها (اختیاری)</summary>
                <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 2 }}>
                  فقط برای «لیست تراکنش‌های ترمینال» لازم است؛ پرداخت بدون این دو کار می‌کند. Access Token را از بخش «نشست‌های فعال» پنل زرین‌پال بگیرید.
                </p>
                <div style={{ display: 'grid', gap: 14 }}>
                  <Field
                    label={cfg.hasZarinpalAccessToken ? 'Access Token — برای تغییر، مقدار جدید را وارد کنید' : 'Access Token'}
                    dir="ltr"
                    value={cfg.zarinpalAccessToken}
                    onChange={(v) => setCfg({ ...cfg, zarinpalAccessToken: v })}
                  />
                  <Field label="شناسه ترمینال (Terminal ID)" dir="ltr" value={cfg.zarinpalTerminalId} onChange={(v) => setCfg({ ...cfg, zarinpalTerminalId: v })} />
                </div>
              </details>
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <Field label="نشانی پایه بازگشت از درگاه (اختیاری)" dir="ltr" value={cfg.callbackBase} onChange={(v) => setCfg({ ...cfg, callbackBase: v })} />
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8, lineHeight: 2 }}>
              اگر سایت پشت پروکسی یا دامنه دیگری سرو می‌شود، نشانی کامل سایت را وارد کنید؛ مثال:{' '}
              <code dir="ltr">https://khuzestanyeast-co.com</code> — در غیر این صورت خالی بگذارید.
            </p>
          </div>

          <div className="admin__row" style={{ marginTop: 22 }}>
            <button className="btn btn--primary" onClick={saveCfg} disabled={busy}>
              ذخیره تنظیمات درگاه
            </button>
            {ok && <span style={{ color: 'var(--admin-ok)', fontWeight: 800, fontSize: 13 }}>✓ ذخیره شد</span>}
          </div>

          {tools.msg && <p className={`pay__msg ${tools.kind === 'err' ? 'is-err' : ''}`}>{tools.msg}</p>}

          {/* ---------- unverified: money paid but never settled ---------- */}
          <section className="pay__tool">
            <header>
              <div>
                <h2>تراکنش‌های تأیید‌نشده</h2>
                <p>پرداخت‌هایی که مشتری انجام داده ولی تأیید نشده‌اند — مثلاً وقتی صفحه بازگشت بسته شده است. این مبلغ از حساب مشتری خارج شده و تا تأیید نشدن، به حساب شما ننشسته است.</p>
              </div>
              <button className="btn btn--outline btn--sm" onClick={loadUnverified} disabled={!cfg.canPay}>
                بررسی
              </button>
            </header>

            {unverified === 'loading' && <p className="pay__none">در حال دریافت…</p>}
            {Array.isArray(unverified) && unverified.length === 0 && <p className="pay__none">تراکنش تأیید‌نشده‌ای وجود ندارد.</p>}
            {Array.isArray(unverified) && unverified.length > 0 && (
              <table className="pay__table">
                <thead>
                  <tr>
                    <th>سفارش</th>
                    <th>مبلغ درگاه</th>
                    <th>کد پرداخت</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {unverified.map((u) => (
                    <tr key={u.authority}>
                      <td>
                        {u.order ? (
                          <>
                            <b dir="ltr">{u.order.code}</b>
                            <small> — {u.order.customer}</small>
                          </>
                        ) : (
                          <small>سفارش متناظری پیدا نشد</small>
                        )}
                      </td>
                      <td>{faQ(u.amount)} ریال</td>
                      <td dir="ltr" className="pay__mono">{u.authority.slice(0, 12)}…</td>
                      <td>
                        {u.order && (
                          <button className="btn btn--primary btn--sm" onClick={() => settle(u.authority)}>
                            تأیید و ثبت پرداخت
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* ---------- fee ---------- */}
          <section className="pay__tool">
            <header>
              <div>
                <h2>محاسبه کارمزد</h2>
                <p>کارمزد زرین‌پال برای یک مبلغ مشخص، پیش از ساخت تراکنش.</p>
              </div>
            </header>
            <div className="admin__row" style={{ gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 200px' }}>
                <Field label="مبلغ (ریال)" type="number" dir="ltr" value={feeAmount} onChange={setFeeAmount} />
              </div>
              <button className="btn btn--outline" onClick={getFee} disabled={!cfg.canPay}>
                محاسبه
              </button>
            </div>
            {fee === 'loading' && <p className="pay__none">در حال محاسبه…</p>}
            {fee && fee !== 'loading' && (
              <p className={`pay__msg ${fee.ok ? '' : 'is-err'}`}>
                {fee.ok
                  ? `مبلغ ${faQ(fee.amount)} ریال · کارمزد ${faQ(fee.fee)} ریال · پرداخت‌کننده کارمزد: ${
                      fee.feeType === 'Payer' ? 'مشتری' : 'پذیرنده'
                    }${fee.suggestedAmount ? ` · مبلغ پیشنهادی برای تسویه: ${faQ(fee.suggestedAmount)} ریال` : ''}`
                  : fee.error}
              </p>
            )}
          </section>

          {/* ---------- terminal ledger ---------- */}
          <section className="pay__tool">
            <header>
              <div>
                <h2>لیست تراکنش‌های ترمینال</h2>
                <p>گزارش مستقیم از زرین‌پال. نیازمند Access Token و شناسه ترمینال.</p>
              </div>
              <div className="admin__row" style={{ gap: 8 }}>
                <select value={txFilter} onChange={(e) => setTxFilter(e.target.value)}>
                  {['PAID', 'VERIFIED', 'ACTIVE', 'REFUNDED', 'TRASH'].map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
                <button className="btn btn--outline btn--sm" onClick={loadTx} disabled={!cfg.canLedger}>
                  دریافت
                </button>
              </div>
            </header>
            {!cfg.canLedger && <p className="pay__none">برای این گزارش، Access Token و شناسه ترمینال را در بالا وارد کنید.</p>}
            {tx === 'loading' && <p className="pay__none">در حال دریافت…</p>}
            {tx && tx !== 'loading' && !tx.ok && <p className="pay__msg is-err">{tx.error}</p>}
            {tx && tx !== 'loading' && tx.ok && tx.transactions.length === 0 && <p className="pay__none">تراکنشی با این فیلتر وجود ندارد.</p>}
            {tx && tx !== 'loading' && tx.ok && tx.transactions.length > 0 && (
              <table className="pay__table">
                <thead>
                  <tr>
                    <th>شناسه</th>
                    <th>وضعیت</th>
                    <th>مبلغ</th>
                    <th>تاریخ</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {tx.transactions.map((t) => (
                    <tr key={t.id}>
                      <td dir="ltr" className="pay__mono">{String(t.id).slice(0, 14)}</td>
                      <td>{t.status}</td>
                      <td>{faQ(t.amount)} ریال</td>
                      <td dir="ltr">{String(t.created_at || '').slice(0, 16)}</td>
                      <td>
                        <button className="btn btn--outline btn--sm" onClick={() => openRefund(t)}>
                          برگشت وجه
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* ---------- refunds ---------- */}
          <section className="pay__tool">
            <header>
              <div>
                <h2>برگشت وجه</h2>
                <p>
                  بازگرداندن مبلغ پس از بسته‌شدن مهلت ۳۰ دقیقه‌ای «ریورس». برای هر تراکنش، از دکمه «برگشت وجه» در جدول بالا شروع کنید.
                  نیازمند Access Token و شناسه ترمینال است.
                </p>
              </div>
              <div className="admin__row" style={{ gap: 8 }}>
                <button className="btn btn--outline btn--sm" onClick={loadRefunds} disabled={!cfg.canLedger}>
                  فهرست برگشت‌ها
                </button>
              </div>
            </header>

            {refundFor && (
              <div className="pay__refund">
                <p>
                  تراکنش <b dir="ltr">{String(refundFor.id).slice(0, 18)}</b> — مبلغ اصلی {faQ(refundFor.amount)} ریال
                </p>
                <div className="pay__refund-grid">
                  <Field label="مبلغ برگشتی (ریال — حداقل ۲۰٬۰۰۰)" type="number" dir="ltr" value={refund.amount} onChange={(v) => setRefund({ ...refund, amount: v })} />
                  <Field
                    label="روش"
                    type="select"
                    value={refund.method}
                    onChange={(v) => setRefund({ ...refund, method: v })}
                    options={[
                      { value: 'PAYA', label: 'عادی (پایا) — واریز در سیکل بعدی پایا' },
                      { value: 'CARD', label: 'آنی (کارت) — واریز فوری' },
                    ]}
                  />
                  <Field
                    label="دلیل"
                    type="select"
                    value={refund.reason}
                    onChange={(v) => setRefund({ ...refund, reason: v })}
                    options={[
                      { value: 'CUSTOMER_REQUEST', label: 'درخواست مشتری' },
                      { value: 'DUPLICATE_TRANSACTION', label: 'تراکنش تکراری' },
                      { value: 'SUSPICIOUS_TRANSACTION', label: 'تراکنش مشکوک' },
                      { value: 'OTHER', label: 'سایر' },
                    ]}
                  />
                  <Field label="کد سفارش (اختیاری — سفارش لغو و موجودی برگردانده می‌شود)" dir="ltr" value={refund.orderCode} onChange={(v) => setRefund({ ...refund, orderCode: v })} />
                </div>
                <Field label="توضیح (اختیاری)" value={refund.description} onChange={(v) => setRefund({ ...refund, description: v })} />
                <div className="admin__row" style={{ gap: 10 }}>
                  <button className="btn btn--primary btn--sm" onClick={sendRefund}>
                    ثبت برگشت وجه
                  </button>
                  <button className="btn btn--outline btn--sm" onClick={() => setRefundFor(null)}>
                    انصراف
                  </button>
                </div>
              </div>
            )}

            {/* The documented way to answer "did it go through": the session's
                own timeline, looked up by the id the refund was made against. */}
            <div className="admin__row" style={{ gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
              <div style={{ flex: '1 1 200px' }}>
                <Field label="بررسی وضعیت استرداد — شناسه تراکنش (session id)" dir="ltr" value={statusId} onChange={setStatusId} />
              </div>
              <button className="btn btn--outline btn--sm" onClick={checkRefund} disabled={!cfg.canLedger || !statusId}>
                بررسی وضعیت
              </button>
            </div>
            {rStatus === 'loading' && <p className="pay__none">در حال بررسی…</p>}
            {rStatus && rStatus !== 'loading' && (
              <p className={`pay__msg ${rStatus.ok ? '' : 'is-err'}`}>
                {rStatus.ok
                  ? rStatus.refundStatus
                    ? `وضعیت استرداد: ${rStatus.refundStatus} · مبلغ ${faQ(rStatus.refundAmount)} ریال · ${String(rStatus.refundTime).slice(0, 16)}`
                    : `این تراکنش (${rStatus.status}) هنوز استردادی ندارد.`
                  : rStatus.error}
              </p>
            )}

            {!cfg.canLedger && <p className="pay__none">برای برگشت وجه، Access Token و شناسه ترمینال را در بالا وارد کنید.</p>}
            {refunds === 'loading' && <p className="pay__none">در حال دریافت…</p>}
            {refunds && refunds !== 'loading' && !refunds.ok && <p className="pay__msg is-err">{refunds.error}</p>}
            {refunds && refunds !== 'loading' && refunds.ok && refunds.refunds.length === 0 && <p className="pay__none">برگشت وجهی ثبت نشده است.</p>}
            {refunds && refunds !== 'loading' && refunds.ok && refunds.refunds.length > 0 && (
              <table className="pay__table">
                <thead>
                  <tr>
                    <th>شناسه</th>
                    <th>مبلغ</th>
                    <th>وضعیت</th>
                    <th>تاریخ</th>
                  </tr>
                </thead>
                <tbody>
                  {refunds.refunds.map((rf) => (
                    <tr key={rf.id}>
                      <td dir="ltr" className="pay__mono">{String(rf.id).slice(0, 14)}</td>
                      <td>{faQ(rf.amount)} ریال</td>
                      <td>{rf.status}</td>
                      <td dir="ltr">{String(rf.created_at || '').slice(0, 16)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <div style={{ background: 'var(--bg-soft)', borderRadius: 14, padding: '16px 20px', marginTop: 22, fontSize: 13, lineHeight: 2.3 }}>
            <b>نکات مهم:</b>
            <ul style={{ margin: '6px 18px 0', listStyle: 'disc' }}>
              <li>مبالغ فروشگاه به <b>ریال</b> ذخیره و با واحد صریح <code dir="ltr">IRR</code> به زرین‌پال ارسال می‌شوند؛ هیچ تبدیلی به تومان انجام نمی‌شود.</li>
              <li>حداقل مبلغ قابل پرداخت <b>۱۰٬۰۰۰ ریال</b> است.</li>
              <li>مبلغِ تأیید همیشه از دیتابیس خودمان خوانده می‌شود، نه از آدرس بازگشت؛ دستکاری لینک بازگشت نمی‌تواند سفارش را با مبلغ دیگری تسویه کند.</li>
              <li><b>ریورس</b> («بازگرداندن وجه» در تب سفارش‌ها) فقط تا <b>۳۰ دقیقه</b> پس از پرداخت، بدون کارمزد و با merchant_id انجام می‌شود؛ آی‌پی سرور باید روی درگاه ثبت باشد (در غیر این صورت خطای ۶۲-).</li>
              <li><b>برگشت وجه</b> محدودیت زمانی ندارد ولی از مسیر دیگری (GraphQL) و با Access Token انجام می‌شود و شناسه‌اش از «لیست تراکنش‌ها» می‌آید، نه از کد بازگشت پرداخت. حداقل مبلغ قابل استرداد <b>۲۰٬۰۰۰ ریال</b> است.</li>
              <li>روش <b>پایا</b> مبلغ را در سیکل بعدی پایا واریز می‌کند و روش <b>آنی (کارت)</b> بلافاصله؛ وضعیت نهایی را از «بررسی وضعیت استرداد» دنبال کنید.</li>
              <li>کلیدها فقط سمت سرور نگهداری می‌شوند و در این صفحه ماسک‌شده دیده می‌شوند.</li>
              <li>اتصال از طریق نمونه‌کد رسمی <code dir="ltr">zarinpal-node-sdk</code> انجام می‌شود.</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

/* ================= SMS (sms.ir) ================= */
/* Settings, a live readiness readout, a test send and the recent log.
   The API key is write-only: the server returns a mask, and posting the mask
   back means "unchanged" — so an admin can edit the line number without
   re-typing a credential they may not have to hand. */
export function ShopSmsTab() {
  const [cfg, setCfg] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [log, setLog] = useState([]);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testMsg, setTestMsg] = useState('');

  const apply = (d) => {
    setCfg(d.sms);
    setReadiness(d.readiness);
    setLog(d.log || []);
  };

  const load = async () => {
    try {
      setErr('');
      apply(await api('/api/shop-admin/sms', { auth: true }));
    } catch (e) {
      setErr(e.status === 401 ? 'نشست مدیر منقضی شده؛ دوباره وارد شوید.' : 'دریافت تنظیمات پیامک ممکن نشد.');
    }
  };
  useEffect(() => {
    load();
  }, []);

  const saveCfg = async () => {
    setBusy(true);
    setOk(false);
    try {
      const d = await api('/api/shop-admin/sms', { method: 'PUT', body: cfg, auth: true });
      setCfg(d.sms);
      setReadiness(d.readiness);
      setOk(true);
      setTimeout(() => setOk(false), 2500);
    } catch {
      setErr('ذخیره تنظیمات پیامک ممکن نشد.');
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setTestMsg('در حال ارسال…');
    try {
      const d = await api('/api/shop-admin/sms/test', { method: 'POST', body: { phone: testTo }, auth: true });
      setTestMsg(d.ok ? '✓ ارسال شد' : `ارسال نشد: ${d.error || 'نامشخص'}`);
    } catch (e) {
      setTestMsg(e.status === 400 ? 'شماره موبایل معتبر نیست.' : 'ارسال ممکن نشد.');
    }
    load();
  };

  if (!cfg && !err) return <div className="admin__panel"><p style={{ color: 'var(--muted)' }}>در حال دریافت…</p></div>;

  return (
    <div className="admin__panel">
      <div className="admin__head">
        <div>
          <h1>پیامک (sms.ir)</h1>
          <p>ارسال لینک پیگیری سفارش و کد تأیید — جابه‌جایی بین کلید آزمایشی و اصلی بدون تغییر کد</p>
        </div>
      </div>
      {err && <p style={{ color: 'var(--crimson-ink)' }}>{err}</p>}
      {cfg && (
        <>
          {readiness && (
            <p style={{ fontSize: 13, fontWeight: 800, color: readiness.ready ? 'var(--admin-ok)' : 'var(--crimson)', lineHeight: 2 }}>
              {readiness.ready
                ? cfg.provider === 'log'
                  ? '● حالت آزمایشی داخلی: پیامکی ارسال نمی‌شود و فقط در گزارش ثبت می‌گردد.'
                  : `● آماده ارسال — ${cfg.environment === 'production' ? 'کلید اصلی' : 'کلید آزمایشی'}`
                : `● ناقص است؛ این موارد وارد نشده: ${readiness.missing.join('، ')}`}
            </p>
          )}

          <Field
            label="سرویس پیامک"
            value={cfg.provider}
            onChange={(v) => setCfg({ ...cfg, provider: v })}
            type="select"
            options={[
              { value: 'log', label: 'غیرفعال — فقط ثبت در گزارش (بدون ارسال واقعی)' },
              { value: 'smsir', label: 'sms.ir' },
            ]}
          />

          {cfg.provider === 'smsir' && (
            <div style={{ marginTop: 14, display: 'grid', gap: 14 }}>
              <Field
                label="محیط"
                value={cfg.environment}
                onChange={(v) => setCfg({ ...cfg, environment: v })}
                type="select"
                options={[
                  { value: 'sandbox', label: 'آزمایشی (Sandbox) — کلید تست' },
                  { value: 'production', label: 'اصلی (Production) — کلید واقعی' },
                ]}
              />
              <Field
                label={cfg.hasApiKey ? 'API Key — برای تغییر، کلید جدید را وارد کنید' : 'API Key'}
                dir="ltr"
                value={cfg.apiKey}
                onChange={(v) => setCfg({ ...cfg, apiKey: v })}
              />
              <Field label="شماره خط ارسال (Line Number)" dir="ltr" value={cfg.lineNumber} onChange={(v) => setCfg({ ...cfg, lineNumber: v })} />
              <Field
                label="شناسه قالب کد تأیید (Verify Template ID)"
                dir="ltr"
                value={cfg.verifyTemplateId || ''}
                onChange={(v) => setCfg({ ...cfg, verifyTemplateId: v })}
              />
              <Field
                label="شناسه قالب ثبت سفارش (اختیاری)"
                dir="ltr"
                value={cfg.orderTemplateId || ''}
                onChange={(v) => setCfg({ ...cfg, orderTemplateId: v })}
              />
            </div>
          )}

          <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
            <label className="admin__row" style={{ gap: 8 }}>
              <input type="checkbox" checked={cfg.onOrder !== false} onChange={(e) => setCfg({ ...cfg, onOrder: e.target.checked })} />
              ارسال پیامک «سفارش ثبت شد» همراه لینک پیگیری
            </label>
            <label className="admin__row" style={{ gap: 8 }}>
              <input type="checkbox" checked={!!cfg.onStatus} onChange={(e) => setCfg({ ...cfg, onStatus: e.target.checked })} />
              ارسال پیامک هنگام تغییر وضعیت سفارش (پرداخت‌شده، ارسال‌شده…)
            </label>
            <Field
              label="سقف ارسال روزانه (۰ یعنی بدون محدودیت)"
              dir="ltr"
              type="number"
              value={cfg.dailyCap}
              onChange={(v) => setCfg({ ...cfg, dailyCap: v })}
            />
          </div>

          <div className="admin__row" style={{ marginTop: 22 }}>
            <button className="btn btn--primary" onClick={saveCfg} disabled={busy}>
              ذخیره تنظیمات پیامک
            </button>
            {ok && <span style={{ color: 'var(--admin-ok)', fontWeight: 800, fontSize: 13 }}>✓ ذخیره شد</span>}
          </div>

          <div style={{ background: 'var(--bg-soft)', borderRadius: 14, padding: '16px 20px', marginTop: 22 }}>
            <b style={{ fontSize: 13 }}>ارسال پیامک آزمایشی</b>
            <div className="admin__row" style={{ marginTop: 10, gap: 10, alignItems: 'flex-end' }}>
              <div style={{ flex: '1 1 220px' }}>
                <Field label="شماره موبایل" dir="ltr" value={testTo} onChange={setTestTo} />
              </div>
              <button className="btn btn--outline" onClick={sendTest} disabled={!testTo}>
                ارسال
              </button>
              {testMsg && <span style={{ fontSize: 13, fontWeight: 700 }}>{testMsg}</span>}
            </div>
          </div>

          <h2 style={{ fontSize: 15, marginTop: 26, marginBottom: 10 }}>آخرین پیامک‌ها</h2>
          {log.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 13 }}>هنوز پیامکی ثبت نشده است.</p>}
          <div className="admin__list">
            {log.map((row) => (
              <div className="admin__item" key={row.id} style={{ alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 800 }}>
                    <span dir="ltr">{row.phone}</span>
                    <span style={{ color: 'var(--muted)', fontWeight: 600 }}> — {row.kind}</span>
                    {row.ref && <span style={{ color: 'var(--muted)', fontWeight: 600 }}> — {row.ref}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'pre-wrap', marginTop: 4 }}>{row.text}</div>
                  {!row.ok && row.error && <div style={{ fontSize: 12, color: 'var(--crimson-ink)', marginTop: 4 }}>{row.error}</div>}
                </div>
                <span className={`msg__badge ${row.ok ? 'read' : ''}`}>{row.ok ? 'ارسال شد' : 'ناموفق'}</span>
              </div>
            ))}
          </div>

          <div style={{ background: 'var(--bg-soft)', borderRadius: 14, padding: '16px 20px', marginTop: 22, fontSize: 13, lineHeight: 2.3 }}>
            <b>راه‌اندازی در پنل sms.ir:</b>
            <ul style={{ margin: '6px 18px 0', listStyle: 'disc' }}>
              <li>یک <b>خط ارسال</b> تهیه کنید و شماره آن را در فیلد بالا بگذارید.</li>
              <li>برای کد تأیید، در بخش «قالب‌های پیامکی» یک قالب با پارامتر <code dir="ltr">CODE</code> بسازید و شناسه آن را وارد کنید؛ ارسال کد با متن آزاد توسط اپراتور فیلتر می‌شود.</li>
              <li>برای پیامک سفارش هم بهتر است یک قالب با پارامترهای <code dir="ltr">CODE</code> و <code dir="ltr">LINK</code> ثبت شود، چون پیامک حاوی لینک روی خطوط اشتراکی معمولاً مسدود می‌گردد.</li>
              <li>کلید API فقط روی سرور نگهداری می‌شود؛ در این صفحه هرگز کامل نمایش داده نمی‌شود.</li>
              <li>اگر ارسال پیامک با خطا روبه‌رو شود، سفارش مشتری همچنان ثبت می‌شود و خطا در همین گزارش ثبت می‌گردد.</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

/* ================= customers ================= */
/* Read-mostly on purpose. The admin can see who someone is, what they have
   ordered and where they want it, and can block an abusive account. There is
   no edit-their-address button — a shipping address the customer did not
   write is a parcel sent to the wrong door with nobody to blame. */

/* Identifiers, not amounts: a phone number through a quantity formatter
   comes out as ۹٬۲۱۰٬۷۵۰٬۴۱۲. */
const faId = (v) => String(v ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const faQty = (n) => Number(n || 0).toLocaleString('fa-IR');
const localPhone = (p) => faId(String(p || '').replace(/^98/, '0'));
const faDate = (iso) => (iso ? faId(new Date(iso).toLocaleDateString('fa-IR')) : '—');

const CUSTOMER_STATUS = {
  pending_payment: 'در انتظار پرداخت',
  paid: 'پرداخت‌شده',
  shipped: 'ارسال‌شده',
  delivered: 'تحویل‌شده',
  cancelled: 'لغو شده',
};

function CustomerDetail({ data, blocked, onBlock }) {
  if (!data) return <p className="cust__loading">در حال دریافت…</p>;
  const { customer, orders, addresses } = data;
  const spent = orders.filter((o) => o.status !== 'cancelled').reduce((n, o) => n + Number(o.total || 0), 0);

  return (
    <div className="cust__detail">
      <div className="cust__facts">
        <div>
          <span>ایمیل</span>
          <b dir="ltr">{customer.email || '—'}</b>
        </div>
        <div>
          <span>عضویت</span>
          <b>{faDate(customer.at)}</b>
        </div>
        <div>
          <span>آخرین ورود</span>
          <b>{faDate(customer.lastLoginAt)}</b>
        </div>
        <div>
          <span>مجموع خرید</span>
          <b>{faQty(spent)} ریال</b>
        </div>
      </div>

      <section className="cust__block">
        <h3>سفارش‌ها</h3>
        {orders.length === 0 ? (
          <p className="cust__none">سفارشی ثبت نشده است.</p>
        ) : (
          <table className="cust__table">
            <thead>
              <tr>
                <th>کد</th>
                <th>تاریخ</th>
                <th>مبلغ</th>
                <th>وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.code}>
                  <td dir="ltr" className="cust__mono">{o.code}</td>
                  <td>{faDate(o.at)}</td>
                  <td>{faQty(o.total)} ریال</td>
                  <td>
                    <span className={`cust__pill is-${o.status}`}>{CUSTOMER_STATUS[o.status] || o.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="cust__block">
        <h3>نشانی‌ها</h3>
        {addresses.length === 0 ? (
          <p className="cust__none">نشانی ثبت نشده است.</p>
        ) : (
          <div className="cust__addrs">
            {addresses.map((a) => (
              <article className={`cust__addr ${a.isDefault ? 'is-default' : ''}`} key={a.id}>
                <header>
                  <b>{a.title}</b>
                  {a.isDefault && <span className="cust__pill is-default">پیش‌فرض</span>}
                </header>
                <p>
                  {a.province}، {a.city}، {a.address}
                  {a.plaque && `، پلاک ${faId(a.plaque)}`}
                  {a.unit && `، واحد ${faId(a.unit)}`}
                </p>
                <dl>
                  <div>
                    <dt>گیرنده</dt>
                    <dd>{a.receiver}</dd>
                  </div>
                  <div>
                    <dt>موبایل</dt>
                    <dd dir="ltr">{localPhone(a.phone)}</dd>
                  </div>
                  <div>
                    <dt>کد پستی</dt>
                    <dd dir="ltr">{faId(a.postal)}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <footer className="cust__danger">
        <div>
          <b>{blocked ? 'این حساب مسدود است' : 'مسدود کردن حساب'}</b>
          <span>مسدودسازی ورودهای فعلی را هم قطع می‌کند، برگشت‌پذیر است و سفارش‌ها را حذف نمی‌کند.</span>
        </div>
        <button className={`btn ${blocked ? 'btn--outline' : 'btn--primary'}`} onClick={onBlock}>
          {blocked ? 'رفع مسدودی حساب' : 'مسدود کردن حساب'}
        </button>
      </footer>
    </div>
  );
}

export function ShopCustomersTab() {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const detailRequest = useRef(0);
  const columns = useColumnVisibility('khyeast.admin.columns.customers.v1', CUSTOMER_LIST_COLUMNS);

  const load = async () => {
    try {
      setErr('');
      const d = await api('/api/shop-admin/customers', { auth: true });
      setRows(d.customers || []);
    } catch (e) {
      setErr(e.status === 401 ? 'نشست مدیر منقضی شده؛ دوباره وارد شوید.' : 'دریافت فهرست مشتریان ممکن نشد.');
    }
  };
  useEffect(() => {
    load();
  }, []);

  const show = async (id) => {
    if (open === id) {
      detailRequest.current += 1;
      setOpen(null);
      return;
    }
    const request = ++detailRequest.current;
    setOpen(id);
    setDetail(null);
    setErr('');
    try {
      const next = await api(`/api/shop-admin/customers/${id}`, { auth: true });
      if (detailRequest.current === request) setDetail(next);
    } catch {
      if (detailRequest.current === request) setErr('دریافت اطلاعات مشتری ممکن نشد.');
    }
  };

  const setBlocked = async (id, blocked) => {
    try {
      setErr('');
      await api(`/api/shop-admin/customers/${id}`, { method: 'PATCH', body: { blocked }, auth: true });
      const d = await api('/api/shop-admin/customers', { auth: true });
      setRows(d.customers || []);
      setDetail(await api(`/api/shop-admin/customers/${id}`, { auth: true }));
    } catch {
      setErr('تغییر وضعیت حساب مشتری ممکن نشد.');
    }
  };

  /* Searching by digits must work whichever way the number is written, so
     needle and haystack are both reduced to Latin digits and the leading
     zero is dropped — stored numbers are 98…, typed ones are 0…. */
  const norm = (v) => String(v || '').replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  const needle = norm(q).trim().replace(/^0/, '');
  const list = (rows || []).filter(
    (customer) =>
      !needle || norm(customer.phone).includes(needle) || String(customer.name || '').includes(q.trim()),
  );
  const gridStyle = {
    '--visible-columns': String(columns.visible.size),
    '--grid-min-width': `${244 + columns.visible.size * 108}px`,
  };

  return (
    <div className="admin__panel">
      <div className="admin__head">
        <div>
          <h1>مشتریان</h1>
          <p>حساب‌های ثبت‌شده با شماره موبایل تأییدشده</p>
        </div>
        <div className="admin__head-actions">
          {rows && <span className="cust__count">{faQty(rows.length)} حساب</span>}
          <ColumnPicker
            id="customer"
            label="مشتریان"
            primaryLabel="نام مشتری"
            columns={CUSTOMER_LIST_COLUMNS}
            visibility={columns}
          />
        </div>
      </div>

      {err && <p className="cust__err" role="alert">{err}</p>}

      <div className="admin__search cust__search">
        <input
          placeholder="جست‌وجو با نام یا شماره موبایل…"
          aria-label="جست‌وجوی مشتریان"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {!rows && !err && <p className="cust__loading">در حال دریافت…</p>}
      {rows && list.length === 0 && (
        <p className="cust__none">{rows.length ? 'مشتری‌ای با این مشخصات پیدا نشد.' : 'هنوز مشتری‌ای ثبت‌نام نکرده است.'}</p>
      )}

      {list.length > 0 && (
        <div
          className="admin-data-grid admin-data-grid--customers"
          style={gridStyle}
          role="region"
          aria-label="فهرست مشتریان"
          tabIndex={0}
        >
          <div className="admin-data-grid__header cust__grid" aria-hidden="true">
            <span>مشتری</span>
            {columns.visible.has('phone') && <span>موبایل</span>}
            {columns.visible.has('orders') && <span>سفارش‌ها</span>}
            {columns.visible.has('addresses') && <span>نشانی‌ها</span>}
            {columns.visible.has('joined') && <span>عضویت</span>}
            {columns.visible.has('state') && <span>وضعیت</span>}
            <span />
          </div>

          <div className="cust__list">
            {list.map((c) => {
              const expanded = open === c.id;
              const detailId = `customer-detail-${String(c.id).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
              return (
                <article className={`cust ${expanded ? 'is-open' : ''} ${c.blocked ? 'is-blocked' : ''}`} key={c.id}>
                  <button
                    type="button"
                    className="cust__row cust__grid"
                    onClick={() => show(c.id)}
                    aria-expanded={expanded}
                    aria-controls={expanded ? detailId : undefined}
                  >
                    <span className="cust__identity">
                      <span className="cust__avatar" aria-hidden="true">
                        {(c.name || '؟').trim().charAt(0)}
                      </span>
                      <span className="cust__id"><b>{c.name || '—'}</b></span>
                    </span>
                    {columns.visible.has('phone') && <span className="cust__phone" dir="ltr">{localPhone(c.phone)}</span>}
                    {columns.visible.has('orders') && (
                      <span className="cust__metric"><b>{faQty(c.orderCount)}</b><small>سفارش</small></span>
                    )}
                    {columns.visible.has('addresses') && (
                      <span className="cust__metric"><b>{faQty(c.addressCount)}</b><small>نشانی</small></span>
                    )}
                    {columns.visible.has('joined') && <span className="cust__since">{faDate(c.at)}</span>}
                    {columns.visible.has('state') && (
                      <span className={`cust__pill ${c.blocked ? 'is-blocked' : 'is-active'}`}>
                        {c.blocked ? 'مسدود' : 'فعال'}
                      </span>
                    )}
                    <Icons.arrow size={16} className="cust__chev" />
                  </button>

                  {expanded && (
                    <div id={detailId} role="region" aria-label={`جزئیات مشتری ${c.name || c.phone}`}>
                      <CustomerDetail data={detail} blocked={c.blocked} onBlock={() => setBlocked(c.id, !c.blocked)} />
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
