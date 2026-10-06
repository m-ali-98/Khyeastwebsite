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

/* ================= shop products ================= */
export function ShopProductsTab() {
  const { state, save, reload, brands, products: catalog } = useContent();
  const shop = state.shop || { display: {}, products: [] };
  const items = shop.products || [];
  const display = shop.display || {};
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
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
    /* slugify() no longer invents a slug, so the blank case is caught here
       instead of silently becoming shop-1712… */
    if (!clean.slug) return window.alert('شناسه (slug) نمی‌تواند خالی باشد.');
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
        <div className="admin__row" style={{ gap: 8 }}>
          <button className="btn btn--outline" onClick={refresh} disabled={busy}>
            {busy ? '… در حال بروزرسانی' : '⟳ بروزرسانی'}
          </button>
          <button className="btn btn--primary" onClick={startNew}>
            + محصول جدید
          </button>
        </div>
      </div>
      {note && (
        <p style={{ color: note.bad ? 'var(--crimson)' : 'var(--muted)', marginTop: -4 }}>{note.text}</p>
      )}
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
  const [gw, setGw] = useState({}); // per-order gateway result

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

  const patch = async (id, body, method = 'PATCH') => {
    setErr('');
    try {
      await api(`/api/shop-admin/orders/${id}`, { method, body, auth: true });
    } catch (e) {
      /* Taking an order out of «لغو شده» re-reserves its stock, which the
         server refuses with 409 when the units are no longer available. The
         select would otherwise just snap back with no explanation. */
      setErr(
        e.status === 409
          ? e.detail || 'موجودی برای بازگرداندن این سفارش کافی نیست؛ ابتدا موجودی محصول را افزایش دهید.'
          : e.status === 401
            ? 'نشست مدیر منقضی شده؛ دوباره وارد شوید.'
            : 'تغییر وضعیت سفارش ممکن نشد.',
      );
    }
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
                درگاه: {o.provider === 'zarinpal' ? 'زرین‌پال' : '—'}
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

              {/* Gateway actions, only where they can do something: an order
                  with no payment reference has nothing to ask about. */}
              {o.payRef && o.provider === 'zarinpal' && (
                <div className="admin__row" style={{ marginTop: 10, flexWrap: 'wrap', gap: 10 }}>
                  <button className="btn btn--outline btn--sm" onClick={() => gateway(o.id, 'inquire')}>
                    استعلام وضعیت از درگاه
                  </button>
                  {o.status === 'paid' && (
                    <button
                      className="btn btn--outline btn--sm"
                      style={{ color: 'var(--crimson)' }}
                      onClick={() =>
                        window.confirm('مبلغ این سفارش به خریدار بازگردانده شود؟ این کار فقط تا ۳۰ دقیقه پس از پرداخت ممکن است و سفارش لغو می‌شود.') &&
                        gateway(o.id, 'reverse')
                      }
                    >
                      بازگرداندن وجه
                    </button>
                  )}
                  {gw[o.id] && <span className={`pay__msg ${gw[o.id].err ? 'is-err' : ''}`} style={{ margin: 0 }}>{gw[o.id].msg}</span>}
                </div>
              )}
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
      setRefundFor(null);
      loadRefunds();
    } catch (e) {
      say('err', e.message || 'برگشت وجه ممکن نشد.');
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
      {err && <p style={{ color: 'var(--crimson)' }}>{err}</p>}

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
                <p style={{ fontSize: 12, color: 'var(--crimson)', lineHeight: 2, margin: 0 }}>
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
                  ? `مبلغ ${faQ(fee.amount)} ریال · کارمزد ${faQ(fee.fee)} ریال · پرداخت‌کننده کارمزد: ${fee.feeType === 'Payer' ? 'مشتری' : 'پذیرنده'}`
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
              <button className="btn btn--outline btn--sm" onClick={loadRefunds} disabled={!cfg.canLedger}>
                فهرست برگشت‌ها
              </button>
            </header>

            {refundFor && (
              <div className="pay__refund">
                <p>
                  تراکنش <b dir="ltr">{String(refundFor.id).slice(0, 18)}</b> — مبلغ اصلی {faQ(refundFor.amount)} ریال
                </p>
                <div className="pay__refund-grid">
                  <Field label="مبلغ برگشتی (ریال)" type="number" dir="ltr" value={refund.amount} onChange={(v) => setRefund({ ...refund, amount: v })} />
                  <Field
                    label="روش"
                    type="select"
                    value={refund.method}
                    onChange={(v) => setRefund({ ...refund, method: v })}
                    options={[
                      { value: 'PAYA', label: 'پایا (واریز به حساب)' },
                      { value: 'CARD', label: 'کارت به کارت' },
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
              <li><b>برگشت وجه</b> محدودیت زمانی ندارد ولی از مسیر دیگری (GraphQL) و با Access Token انجام می‌شود و شناسه‌اش از «لیست تراکنش‌ها» می‌آید، نه از کد بازگشت پرداخت.</li>
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
      {err && <p style={{ color: 'var(--crimson)' }}>{err}</p>}
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
                  {!row.ok && row.error && <div style={{ fontSize: 12, color: 'var(--crimson)', marginTop: 4 }}>{row.error}</div>}
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
      setOpen(null);
      return;
    }
    setOpen(id);
    setDetail(null);
    try {
      setDetail(await api(`/api/shop-admin/customers/${id}`, { auth: true }));
    } catch {
      setErr('دریافت اطلاعات مشتری ممکن نشد.');
    }
  };

  const setBlocked = async (id, blocked) => {
    await api(`/api/shop-admin/customers/${id}`, { method: 'PATCH', body: { blocked }, auth: true });
    const d = await api('/api/shop-admin/customers', { auth: true });
    setRows(d.customers || []);
    setDetail(await api(`/api/shop-admin/customers/${id}`, { auth: true }));
  };

  /* Searching by digits must work whichever way the number is written, so
     needle and haystack are both reduced to Latin digits and the leading
     zero is dropped — stored numbers are 98…, typed ones are 0…. */
  const norm = (v) => String(v || '').replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  const needle = norm(q).trim().replace(/^0/, '');
  const list = (rows || []).filter((c) => !needle || norm(c.phone).includes(needle) || c.name.includes(q.trim()));

  return (
    <div className="admin__panel">
      <div className="admin__head">
        <div>
          <h1>مشتریان</h1>
          <p>حساب‌های ثبت‌شده با شماره موبایل تأییدشده</p>
        </div>
        {rows && <span className="cust__count">{faQty(rows.length)} حساب</span>}
      </div>

      {err && <p className="cust__err">{err}</p>}

      <div className="admin__search">
        <input placeholder="جست‌وجو با نام یا شماره موبایل…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {!rows && !err && <p className="cust__loading">در حال دریافت…</p>}
      {rows && list.length === 0 && (
        <p className="cust__none">{rows.length ? 'مشتری‌ای با این مشخصات پیدا نشد.' : 'هنوز مشتری‌ای ثبت‌نام نکرده است.'}</p>
      )}

      <div className="cust__list">
        {list.map((c) => (
          <article className={`cust ${open === c.id ? 'is-open' : ''} ${c.blocked ? 'is-blocked' : ''}`} key={c.id}>
            <button className="cust__row" onClick={() => show(c.id)} aria-expanded={open === c.id}>
              <span className="cust__avatar" aria-hidden="true">
                {(c.name || '؟').trim().charAt(0)}
              </span>
              <span className="cust__id">
                <b>{c.name || '—'}</b>
                <small dir="ltr">{localPhone(c.phone)}</small>
              </span>
              <span className="cust__stats">
                <span>
                  <b>{faQty(c.orderCount)}</b> سفارش
                </span>
                <span>
                  <b>{faQty(c.addressCount)}</b> نشانی
                </span>
                <span className="cust__since">عضویت {faDate(c.at)}</span>
              </span>
              {c.blocked && <span className="cust__pill is-blocked">مسدود</span>}
              <Icons.arrow size={16} className="cust__chev" />
            </button>

            {open === c.id && (
              <CustomerDetail data={detail} blocked={c.blocked} onBlock={() => setBlocked(c.id, !c.blocked)} />
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
