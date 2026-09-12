import { useEffect, useMemo, useState } from 'react';
import { Icons } from '../components/ui';
import { api, useContent } from '../content/ContentContext';
import { sanitizeHtml } from '../content/sanitize';
import { Field, UploadButton, PairListEditor, RichEditor } from './editors';
import { formatMoney } from '../shop/ShopContext';

const clone = (v) => JSON.parse(JSON.stringify(v));
const slugify = (s) =>
  String(s)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, '-')
    .replace(/^-+|-+$/g, '') || `shop-${Date.now()}`;
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

/* ================= shop products ================= */
export function ShopProductsTab() {
  const { state, save, brands, products: catalog } = useContent();
  const shop = state.shop || { display: {}, products: [] };
  const items = shop.products || [];
  const display = shop.display || {};
  const [draft, setDraft] = useState(null);

  const commitShop = (next) => save({ ...state, shop: { ...shop, ...next } });

  const startNew = () =>
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

  const saveDraft = () => {
    const clean = {
      ...draft,
      slug: slugify(draft.slug),
      price: Math.max(0, Math.round(num(draft.price))),
      oldPrice: draft.oldPrice ? Math.max(0, Math.round(num(draft.oldPrice))) : null,
      stock: Math.round(num(draft.stock, -1)),
      description: sanitizeHtml(draft.description || ''),
      specs: (draft.specs || []).filter(([k, v]) => k || v),
    };
    if (clean.oldPrice && clean.oldPrice <= clean.price) clean.oldPrice = null;
    const exists = items.some((p) => p.slug === clean.slug);
    commitShop({ products: exists ? items.map((p) => (p.slug === clean.slug ? clean : p)) : [clean, ...items] });
    setDraft(null);
  };

  const remove = (slug) => {
    if (!window.confirm('این محصول از فروشگاه حذف شود؟ (دیدگاه‌های آن باقی می‌مانند)')) return;
    commitShop({ products: items.filter((p) => p.slug !== slug) });
  };

  if (draft) {
    return (
      <div className="admin__panel">
        <div className="admin__head">
          <h1>{items.some((p) => p.slug === draft.slug) ? 'ویرایش محصول فروشگاه' : 'محصول جدید فروشگاه'}</h1>
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
            نشان «برگزیده»
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
          <button className="btn btn--primary" onClick={saveDraft}>
            ذخیره محصول
          </button>
          <button className="btn btn--outline" onClick={() => setDraft(null)}>
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
        <button className="btn btn--primary" onClick={startNew}>
          + محصول جدید
        </button>
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
              <button className="admin__iconbtn" title="ویرایش" onClick={() => setDraft(clone(p))}>
                ✎
              </button>
              <button className="admin__iconbtn danger" title="حذف" onClick={() => remove(p.slug)}>
                ✕
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

/* ================= shop orders ================= */
export function ShopOrdersTab() {
  const [orders, setOrders] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(null);
  const [notes, setNotes] = useState({});

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

  const patch = async (id, body, method = 'PATCH') => {
    await api(`/api/shop-admin/orders/${id}`, { method, body, auth: true });
    load();
  };

  const fa = (rial) => new Intl.NumberFormat('fa-IR').format(Math.round(rial || 0));

  return (
    <div className="admin__panel">
      <div className="admin__head">
        <div>
          <h1>سفارش‌های فروشگاه</h1>
          <p>مشاهده، تغییر وضعیت و پیگیری سفارش‌های ثبت‌شده</p>
        </div>
        <button className="btn btn--outline" onClick={load}>
          ⟳ به‌روزرسانی
        </button>
      </div>
      {err && <p style={{ color: 'var(--crimson)' }}>{err}</p>}
      {orders === null && !err && <p style={{ color: 'var(--muted)' }}>در حال دریافت…</p>}
      {orders?.length === 0 && <p style={{ color: 'var(--muted)' }}>هنوز سفارشی ثبت نشده است.</p>}
      {orders?.map((o) => (
        <div className="msg" key={o.id}>
          <div className={`msg__head ${o.status === 'pending_payment' ? 'unread' : ''}`} onClick={() => setOpen(open === o.id ? null : o.id)}>
            <div>
              <b dir="ltr" style={{ letterSpacing: 0.5 }}>{o.code}</b> <small>· {o.customer.name} · {o.customer.phone}</small>
              <div>
                <small>{new Date(o.at).toLocaleString('fa-IR')}</small>
              </div>
            </div>
            <small style={{ marginInlineStart: 12, fontWeight: 800 }}>{fa(o.total)} ریال</small>
            <span className={`msg__badge ${o.status !== 'pending_payment' ? 'read' : ''}`}>{STATUS_FA[o.status] || o.status}</span>
          </div>
          {open === o.id && (
            <div className="msg__body">
              <p style={{ fontWeight: 800, marginBottom: 8 }}>اقلام سفارش:</p>
              {o.items.map((it) => (
                <p key={it.slug} style={{ fontSize: 13 }}>
                  {it.title} × {fa(it.qty)} = {fa(it.sum)} ریال
                </p>
              ))}
              <p style={{ fontSize: 13, marginTop: 8 }}>
                جمع اقلام {fa(o.subtotal)} + ارسال {o.shipping === 0 ? 'رایگان' : `${fa(o.shipping)} ریال`} = <b>{fa(o.total)} ریال</b>
              </p>
              <p style={{ fontSize: 13, lineHeight: 2.1, marginTop: 10 }}>
                آدرس: {o.customer.city} — {o.customer.address}
                {o.customer.postal ? ` (کد پستی ${o.customer.postal})` : ''}
                {o.customer.note ? ` — توضیحات: ${o.customer.note}` : ''}
              </p>
              <p style={{ fontSize: 12, color: 'var(--muted)' }}>
                درگاه: {o.provider === 'zarinpal' ? 'زرین‌پال' : o.provider === 'idpay' ? 'آیدی‌پی' : '—'}
                {o.payRef ? ` · شناسه پرداخت: ${String(o.payRef).slice(0, 30)}` : ''}
                {o.paidAt ? ` · پرداخت: ${new Date(o.paidAt).toLocaleString('fa-IR')}` : ''}
              </p>
              <div className="admin__row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
                <select
                  value={o.status}
                  onChange={(e) => patch(o.id, { status: e.target.value })}
                  style={{ border: '1.5px solid var(--line)', borderRadius: 10, padding: '8px 12px', fontFamily: 'inherit', fontSize: 13 }}
                >
                  {ORDER_STATUS.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_FA[s]}
                    </option>
                  ))}
                </select>
                <button className="btn btn--outline btn--sm" style={{ color: 'var(--crimson)' }} onClick={() => window.confirm('این سفارش حذف شود؟') && patch(o.id, null, 'DELETE')}>
                  حذف سفارش
                </button>
              </div>
              <div style={{ marginTop: 10 }}>
                <Field label="یادداشت داخلی (فقط برای مدیر)" textarea rows={2} value={notes[o.id] ?? o.adminNote ?? ''} onChange={(v) => setNotes({ ...notes, [o.id]: v })} />
                <button className="btn btn--outline btn--sm" style={{ marginTop: 8 }} onClick={() => patch(o.id, { adminNote: notes[o.id] ?? o.adminNote ?? '' })}>
                  ذخیره یادداشت
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
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
          ⟳ به‌روزرسانی
        </button>
      </div>
      {err && <p style={{ color: 'var(--crimson)' }}>{err}</p>}
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
                <b style={{ color: 'var(--crimson)' }}>پاسخ مدیر: </b>
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
              <button className="btn btn--outline btn--sm" style={{ color: 'var(--crimson)' }} onClick={() => window.confirm('این دیدگاه حذف شود؟') && patch(c.id, null, 'DELETE')}>
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
      await api('/api/shop-admin/payment', { method: 'PUT', body: cfg, auth: true });
      setOk(true);
      setTimeout(() => setOk(false), 2500);
    } catch {
      setErr('ذخیره تنظیمات ممکن نشد.');
    } finally {
      setBusy(false);
    }
  };

  if (!cfg && !err) return <div className="admin__panel"><p style={{ color: 'var(--muted)' }}>در حال دریافت…</p></div>;

  return (
    <div className="admin__panel">
      <div className="admin__head">
        <div>
          <h1>درگاه پرداخت</h1>
          <p>اتصال فروشگاه به درگاه پرداخت ایرانی — بدون نیاز به تغییر کد</p>
        </div>
      </div>
      {err && <p style={{ color: 'var(--crimson)' }}>{err}</p>}
      {cfg && (
        <>
          <Field
            label="درگاه فعال"
            value={cfg.provider}
            onChange={(v) => setCfg({ ...cfg, provider: v })}
            type="select"
            options={[
              { value: 'offline', label: 'غیرفعال — سفارش‌ها بدون پرداخت آنلاین ثبت می‌شوند' },
              { value: 'zarinpal', label: 'زرین‌پال (ZarinPal)' },
              { value: 'idpay', label: 'آیدی‌پی (IDPay)' },
            ]}
          />

          {cfg.provider === 'zarinpal' && (
            <div style={{ marginTop: 14 }}>
              <Field label="Merchant ID زرین‌پال" dir="ltr" value={cfg.zarinpalMerchant} onChange={(v) => setCfg({ ...cfg, zarinpalMerchant: v })} />
              <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8, lineHeight: 2 }}>
                merchant_id را از پنل زرین‌پال کپی کنید (برای محیط آزمایشگاه، شناسه‌هایی که با test شروع می‌شوند به‌صورت sandbox استفاده می‌شوند).
              </p>
            </div>
          )}

          {cfg.provider === 'idpay' && (
            <div style={{ marginTop: 14 }}>
              <Field label="API Key آیدی‌پی" dir="ltr" value={cfg.idpayApiKey} onChange={(v) => setCfg({ ...cfg, idpayApiKey: v })} />
              <label className="admin__row" style={{ marginTop: 10, gap: 8 }}>
                <input type="checkbox" checked={!!cfg.idpaySandbox} onChange={(e) => setCfg({ ...cfg, idpaySandbox: e.target.checked })} />
                حالت آزمایشی (Sandbox)
              </label>
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <Field
              label="نشانی پایه بازگشت از درگاه (اختیاری)"
              dir="ltr"
              value={cfg.callbackBase}
              onChange={(v) => setCfg({ ...cfg, callbackBase: v })}
            />
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8, lineHeight: 2 }}>
              اگر سایت پشت پروکسی یا دامنه دیگری سرو می‌شود، نشانی کامل سایت را وارد کنید؛ مثال:{' '}
              <code dir="ltr">https://khuzestanyeast-co.com</code> — در غیر این صورت خالی بگذارید تا از همان دامنه درخواست استفاده شود.
            </p>
          </div>

          <div className="admin__row" style={{ marginTop: 22 }}>
            <button className="btn btn--primary" onClick={saveCfg} disabled={busy}>
              ذخیره تنظیمات درگاه
            </button>
            {ok && <span style={{ color: 'var(--admin-ok)', fontWeight: 800, fontSize: 13 }}>✓ ذخیره شد</span>}
          </div>

          <div style={{ background: 'var(--bg-soft)', borderRadius: 14, padding: '16px 20px', marginTop: 22, fontSize: 13, lineHeight: 2.3 }}>
            <b>نکات مهم:</b>
            <ul style={{ margin: '6px 18px 0', listStyle: 'disc' }}>
              <li>مبالغ فروشگاه به <b>ریال</b> ذخیره می‌شوند و به‌صورت خودکار به <b>تومان</b> (واحد درگاه‌های ایرانی) تبدیل می‌گردند.</li>
              <li>پس از پرداخت موفق، درگاه به نشانی بازگشت (Callback) سایت هدایت می‌شود و وضعیت سفارش خودکار «پرداخت‌شده» می‌گردد.</li>
              <li>کلیدها و شناسه‌ها فقط سمت سرور نگهداری می‌شوند و هرگز در API عمومی سایت منتشر نمی‌شوند.</li>
              <li>تا زمانی که درگاه فعال نشده، سفارش‌ها با وضعیت «در انتظار پرداخت» ثبت می‌شوند و در تب «سفارش‌ها» قابل تغییر وضعیت هستند.</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
