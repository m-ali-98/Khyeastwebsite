import { useEffect, useMemo, useState } from 'react';
import { Icons } from '../components/ui';
import { api, useContent } from '../content/ContentContext';
import { sanitizeHtmlResult, richTextRejectionMessage } from '../content/sanitize';
import { Field, UploadButton, StringListEditor, PairListEditor, RichEditor } from './editors';
import { getPack, LOCALES } from '../../shared/i18n/index.js';
import {
  MAX_TRUST_SEALS,
  safeHttpsUrl,
  safeTrustImageUrl,
  validateTrustSeals,
} from '../../shared/trustSeals.js';

/* Badge shown on Persian list rows: which other languages still fall back to
   Persian for this item, so a newly added product/post is never quietly left
   untranslated on /en and /ar. */
function TransStatus({ bucket, slug, state }) {
  const pending = LOCALES.filter((lo) => lo.code !== 'fa').filter((lo) => {
    const override = state.i18n?.[lo.code]?.[bucket]?.[slug];
    const shipped = getPack(lo.code)?.[bucket]?.[slug];
    return !override && !shipped;
  });
  if (!pending.length) return null;
  return (
    <span className="admin__badge warn" title="این مورد در این زبان‌ها هنوز ترجمه نشده و متن فارسی نمایش داده می‌شود">
      بدون ترجمه: {pending.map((lo) => lo.short).join(' / ')}
    </span>
  );
}

const clone = (v) => JSON.parse(JSON.stringify(v));
const localIsoDate = () => {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
};

/* Deleting a product/post must also drop its translations, otherwise a stale
   override lingers in the database and would silently re-attach itself if the
   same slug were ever reused for a different item. */
/* Renaming a slug must carry the translations across with it, otherwise they
   would be stranded under the old key. */
const renameTranslations = (i18n, bucket, from, to) => {
  if (!i18n || typeof i18n !== 'object' || from === to) return i18n;
  const next = {};
  for (const [loc, data] of Object.entries(i18n)) {
    if (!data || typeof data !== 'object' || !data[bucket]?.[from]) {
      next[loc] = data;
      continue;
    }
    const bucketData = { ...data[bucket] };
    bucketData[to] = bucketData[from];
    delete bucketData[from];
    next[loc] = { ...data, [bucket]: bucketData };
  }
  return next;
};

const dropTranslations = (i18n, bucket, slug) => {
  if (!i18n || typeof i18n !== 'object') return i18n;
  const next = {};
  for (const [loc, data] of Object.entries(i18n)) {
    if (!data || typeof data !== 'object' || !data[bucket]?.[slug]) {
      next[loc] = data;
      continue;
    }
    const bucketData = { ...data[bucket] };
    delete bucketData[slug];
    next[loc] = { ...data, [bucket]: bucketData };
  }
  return next;
};
/* No fallback: an empty box must stay empty so the save guard below can say
   so. Inventing `item-1712…` behind the admin's back gave the product a
   permanent machine URL they never chose. */
const slugify = (s) =>
  String(s)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, '-')
    .replace(/^-+|-+$/g, '');

/* The slug is the URL and the lookup key. A blank one produces /products/ ,
   which collides with the index route, and a duplicate makes the second item
   permanently unreachable because every lookup is a .find() that stops at the
   first match. Both are rejected here so the admin sees why, rather than
   having the save bounced by the server. */
const checkSlug = (list, slug, orig, what) => {
  const clean = String(slug || '').trim();
  if (!clean) return `شناسه (slug) نمی‌تواند خالی باشد.`;
  if (clean.length > 120) return `شناسه (slug) باید حداکثر ۱۲۰ نویسه باشد.`;
  if (!/^[a-z0-9\u0600-\u06FF]+(?:-[a-z0-9\u0600-\u06FF]+)*$/.test(clean))
    return `شناسه «${clean}» معتبر نیست؛ فقط حروف، عدد و خط تیره مجاز است (بدون فاصله و اسلش).`;
  if (list.some((p) => p.slug === clean && p.slug !== orig))
    return `${what} دیگری با شناسه «${clean}» وجود دارد؛ شناسه باید یکتا باشد.`;
  return '';
};

/* ================= products ================= */
export function ProductsTab() {
  const { state, save, brands } = useContent();
  const [draft, setDraft] = useState(null);

  const commit = (next) => save({ ...state, products: next });

  const startNew = () =>
    setDraft({
      slug: `product-${Date.now()}`,
      brand: brands[0]?.id,
      title: '',
      weight: '',
      pack: '',
      image: '/assets/products/dezmaye-gold.webp',
      featured: false,
      short: '',
      specs: [['وزن خالص', '']],
      usage: [''],
      analysis: [['', '']],
      storage: [''],
    });

  const saveDraft = () => {
    const { _orig, ...rest } = draft;
    const clean = { ...rest, body: undefined };
    clean.specs = (clean.specs || []).filter(([k, v]) => k || v);
    clean.usage = (clean.usage || []).filter((u) => u);
    clean.analysis = (clean.analysis || []).filter(([k, v]) => k || v);
    clean.storage = (clean.storage || []).filter((u) => u);

    const slugErr = checkSlug(state.products, clean.slug, _orig, 'محصول');
    if (slugErr) return window.alert(slugErr);
    clean.slug = String(clean.slug).trim();

    /* `_orig` is the slug the form was opened with: it tells a rename apart
       from a brand-new product, so editing the slug updates the existing item
       (and moves its translations) instead of silently cloning it. */
    const editing = _orig && state.products.some((p) => p.slug === _orig);
    const next = editing
      ? state.products.map((p) => (p.slug === _orig ? clean : p))
      : state.products.some((p) => p.slug === clean.slug)
        ? state.products.map((p) => (p.slug === clean.slug ? clean : p))
        : [clean, ...state.products];

    save({
      ...state,
      products: next,
      i18n: editing ? renameTranslations(state.i18n, 'products', _orig, clean.slug) : state.i18n,
    });
    setDraft(null);
  };

  const remove = (slug) => {
    if (!window.confirm('این محصول حذف شود؟ ترجمه‌های انگلیسی و عربی آن نیز حذف می‌شود.')) return;
    save({
      ...state,
      products: state.products.filter((p) => p.slug !== slug),
      i18n: dropTranslations(state.i18n, 'products', slug),
    });
  };

  if (draft) {
    return (
      <div className="admin__panel">
        <div className="admin__head">
          <h1>{draft._orig ? 'ویرایش محصول' : 'محصول جدید'}</h1>
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
          <Field label="وزن / اندازه" value={draft.weight} onChange={(v) => setDraft({ ...draft, weight: v })} />
          <Field label="نوع بسته‌بندی" value={draft.pack} onChange={(v) => setDraft({ ...draft, pack: v })} />
        </div>
        <div style={{ marginTop: 12 }}>
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
        <label className="admin__row" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={!!draft.featured} onChange={(e) => setDraft({ ...draft, featured: e.target.checked })} />
          نمایش در «محصولات برگزیده» صفحه اصلی
        </label>
        <div style={{ marginTop: 14 }}>
          <Field label="توضیح کوتاه" textarea value={draft.short} onChange={(v) => setDraft({ ...draft, short: v })} />
        </div>
        <div className="admin__grid2" style={{ marginTop: 12 }}>
          <Field label="عنوان سئو (اختیاری)" value={draft.seoTitle} onChange={(v) => setDraft({ ...draft, seoTitle: v })} />
          <Field label="توضیح سئو (اختیاری)" value={draft.seoDescription} onChange={(v) => setDraft({ ...draft, seoDescription: v })} />
        </div>
        <h3 style={{ margin: '22px 0 10px' }}>جدول مشخصات</h3>
        <PairListEditor items={draft.specs} onChange={(v) => setDraft({ ...draft, specs: v })} />
        <h3 style={{ margin: '22px 0 10px' }}>راهنمای مصرف</h3>
        <StringListEditor items={draft.usage} onChange={(v) => setDraft({ ...draft, usage: v })} />
        <h3 style={{ margin: '22px 0 10px' }}>آنالیز آزمایشگاهی</h3>
        <PairListEditor items={draft.analysis} onChange={(v) => setDraft({ ...draft, analysis: v })} />
        <h3 style={{ margin: '22px 0 10px' }}>شرایط نگهداری</h3>
        <StringListEditor items={draft.storage} onChange={(v) => setDraft({ ...draft, storage: v })} />
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
          <h1>محصولات</h1>
          <p>ایجاد، ویرایش و حذف محصولات صفحه «محصولات»</p>
        </div>
        <button className="btn btn--primary" onClick={startNew}>
          + محصول جدید
        </button>
      </div>
      <div className="admin__list">
        {state.products.map((p) => (
          <div className="admin__item" key={p.slug}>
            <img src={p.image} alt="" />
            <div>
              <b>{p.title}</b>
              <small>
                {p.weight} · {p.pack} {p.featured ? '· برگزیده' : ''}
              </small>
            </div>
            <div className="admin__actions">
              <TransStatus bucket="products" slug={p.slug} state={state} />
              <button className="admin__iconbtn" title="ویرایش" onClick={() => setDraft({ ...clone(p), _orig: p.slug })}>
                <Icons.edit size={16} />
              </button>
              <button className="admin__iconbtn danger" title="حذف" onClick={() => remove(p.slug)}>
                <Icons.trash size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================= posts ================= */
export function PostsTab() {
  const { state, save } = useContent();
  const [draft, setDraft] = useState(null);

  const commit = (next) => save({ ...state, posts: next });

  const startNew = () =>
    setDraft({
      slug: `post-${Date.now()}`,
      title: '',
      excerpt: '',
      /* Match the long form the shipped posts use ("۲۵ مرداد ۱۴۰۵") rather
         than the numeric default ("۱۴۰۵/۶/۲۱"), so a new post does not look
         different from the existing ones in the blog list. */
      date: new Date().toLocaleDateString('fa-IR', { day: 'numeric', month: 'long', year: 'numeric' }),
      /* Machine-readable publication date for BlogPosting JSON-LD and the
         sitemap. The Persian display date remains independently editable. */
      publishedAt: localIsoDate(),
      category: 'دسته‌بندی نشده',
      image: '/assets/img/bread-slicing.webp',
      readTime: '۵',
      body: '<p></p>',
    });

  const saveDraft = async () => {
    const { _orig, ...rest } = draft;
    const sanitizedBody = sanitizeHtmlResult(rest.body);
    if (!sanitizedBody.ok) return window.alert(richTextRejectionMessage(sanitizedBody));
    const clean = {
      ...rest,
      body: sanitizedBody.html,
      updatedAt: localIsoDate(),
    };

    const slugErr = checkSlug(state.posts, clean.slug, _orig, 'مقاله');
    if (slugErr) return window.alert(slugErr);
    clean.slug = String(clean.slug).trim();

    const editing = _orig && state.posts.some((p) => p.slug === _orig);
    const next = editing
      ? state.posts.map((p) => (p.slug === _orig ? clean : p))
      : state.posts.some((p) => p.slug === clean.slug)
        ? state.posts.map((p) => (p.slug === clean.slug ? clean : p))
        : [clean, ...state.posts];

    try {
      await save({
        ...state,
        posts: next,
        i18n: editing ? renameTranslations(state.i18n, 'posts', _orig, clean.slug) : state.i18n,
      }, { optimistic: false });
      setDraft(null);
    } catch (error) {
      window.alert(error.message || 'ذخیره مقاله ممکن نشد؛ هیچ تغییری ذخیره نشد.');
    }
  };

  const remove = (slug) => {
    if (!window.confirm('این مقاله حذف شود؟ ترجمه‌های انگلیسی و عربی آن نیز حذف می‌شود.')) return;
    save({
      ...state,
      posts: state.posts.filter((p) => p.slug !== slug),
      i18n: dropTranslations(state.i18n, 'posts', slug),
    });
  };

  if (draft) {
    return (
      <div className="admin__panel">
        <div className="admin__head">
          <h1>{draft._orig ? 'ویرایش مقاله' : 'مقاله جدید'}</h1>
        </div>
        <Field label="عنوان مقاله" value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} />
        <div className="admin__grid2" style={{ marginTop: 12 }}>
          <Field label="دسته‌بندی" value={draft.category} onChange={(v) => setDraft({ ...draft, category: v })} />
          <Field label="تاریخ نمایش" value={draft.date} onChange={(v) => setDraft({ ...draft, date: v })} />
        </div>
        <div className="admin__grid2" style={{ marginTop: 12 }}>
          <Field label="تاریخ استاندارد انتشار (SEO)" type="date" value={draft.publishedAt} onChange={(v) => setDraft({ ...draft, publishedAt: v })} />
          <Field label="زمان مطالعه (دقیقه)" value={draft.readTime} onChange={(v) => setDraft({ ...draft, readTime: v })} />
        </div>
        <div style={{ marginTop: 12 }}>
          <Field label="شناسه یکتا (slug)" value={draft.slug} dir="ltr" onChange={(v) => setDraft({ ...draft, slug: slugify(v) || v })} />
        </div>
        <div style={{ marginTop: 12 }}>
          <Field label="چکیده" textarea rows={2} value={draft.excerpt} onChange={(v) => setDraft({ ...draft, excerpt: v })} />
        </div>
        <div className="admin__grid2" style={{ marginTop: 12 }}>
          <Field label="عنوان سئو (اختیاری)" value={draft.seoTitle} onChange={(v) => setDraft({ ...draft, seoTitle: v })} />
          <Field label="توضیح سئو (اختیاری)" value={draft.seoDescription} onChange={(v) => setDraft({ ...draft, seoDescription: v })} />
        </div>
        <div className="admin__row" style={{ marginTop: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>تصویر شاخص:</span>
          {draft.image && <img src={draft.image} alt="" style={{ width: 84, height: 60, objectFit: 'cover', borderRadius: 8 }} />}
          <UploadButton accept="image/*" label="بارگذاری تصویر" onUploaded={(url) => setDraft({ ...draft, image: url })} />
          <input
            value={draft.image}
            aria-label="نشانی تصویر شاخص"
            dir="ltr"
            onChange={(e) => setDraft({ ...draft, image: e.target.value })}
            style={{ flex: 1, border: '1.5px solid var(--line)', borderRadius: 10, padding: '8px 12px', fontSize: 12.5 }}
          />
        </div>
        <h2 style={{ margin: '22px 0 6px', fontSize: '1.05rem' }}>متن مقاله</h2>
        <p className="admin__hint">متن را مانند صفحه نهایی قالب‌بندی کنید؛ پیوند، تصویر، ویدیو، زیرنویس و پیش‌نمایش در دسترس است.</p>
        <RichEditor
          value={draft.body}
          onChange={(v) => setDraft({ ...draft, body: v })}
          placeholder="متن مقاله را بنویسید یا محتوای پاک‌سازی‌شده را اینجا بچسبانید…"
          label="ویرایشگر متن مقاله"
        />
        <div className="admin__row" style={{ marginTop: 24 }}>
          <button className="btn btn--primary" onClick={saveDraft}>
            ذخیره مقاله
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
          <h1>وبلاگ</h1>
          <p>ایجاد، ویرایش و حذف مقالات صفحه «وبلاگ»</p>
        </div>
        <button className="btn btn--primary" onClick={startNew}>
          + مقاله جدید
        </button>
      </div>
      <div className="admin__list">
        {state.posts.map((p) => (
          <div className="admin__item" key={p.slug}>
            <img src={p.image} alt="" />
            <div>
              <b>{p.title}</b>
              <small>
                {p.date} · {p.category}
              </small>
            </div>
            <div className="admin__actions">
              <TransStatus bucket="posts" slug={p.slug} state={state} />
              <button className="admin__iconbtn" title="ویرایش" onClick={() => setDraft({ ...clone(p), _orig: p.slug })}>
                <Icons.edit size={16} />
              </button>
              <button className="admin__iconbtn danger" title="حذف" onClick={() => remove(p.slug)}>
                <Icons.trash size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================= texts ================= */
const GROUPS = [
  ['seo', 'عنوان‌های سئو'],
  ['global', 'عمومی و شعار'],
  ['nav', 'منو و breadcrumb'],
  ['home', 'صفحه اصلی'],
  ['about', 'درباره ما'],
  ['products', 'محصولات'],
  ['product', 'جزئیات محصول'],
  ['export', 'صادرات'],
  ['quality', 'کیفیت'],
  ['blog', 'وبلاگ'],
  ['shop', 'فروشگاه'],
  ['contact', 'تماس با ما'],
  ['footer', 'فوتر'],
  ['nf', 'صفحه ۴۰۴'],
];

export function TextsTab() {
  const { state, save } = useContent();
  const [draft, setDraft] = useState(() => clone(state.texts));
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('all');

  useEffect(() => setDraft(clone(state.texts)), [state.texts]);

  useEffect(() => {
    const id = setTimeout(() => {
      if (JSON.stringify(draft) !== JSON.stringify(state.texts)) save({ ...state, texts: draft });
    }, 700);
    return () => clearTimeout(id);
  }, [draft]);

  const keys = useMemo(
    () =>
      Object.keys(draft).filter(
        (k) =>
          (group === 'all' || k.startsWith(`${group}.`)) &&
          (!q || k.includes(q) || String(draft[k]).includes(q))
      ),
    [draft, q, group]
  );

  return (
    <div className="admin__panel">
      <div className="admin__head">
        <div>
          <h1>متون سایت</h1>
          <p>ویرایش همه متن‌های صفحات؛ تغییرات به‌صورت خودکار ذخیره می‌شود</p>
        </div>
      </div>
      <div className="admin__search">
        <input placeholder="جستجو در کلید یا متن…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="admin__row" style={{ marginBottom: 18 }}>
        <button className={`filter-chip ${group === 'all' ? 'is-active' : ''}`} onClick={() => setGroup('all')}>
          همه
        </button>
        {GROUPS.map(([g, label]) => (
          <button key={g} className={`filter-chip ${group === g ? 'is-active' : ''}`} onClick={() => setGroup(g)}>
            {label}
          </button>
        ))}
      </div>
      <div className="admin__texts">
        {keys.map((k) => (
          <div className="admin__text-row" key={k}>
            <code>{k}</code>
            <textarea rows={String(draft[k]).length > 90 ? 3 : 1} value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
          </div>
        ))}
        {!keys.length && <p style={{ color: 'var(--muted)' }}>موردی یافت نشد.</p>}
      </div>
    </div>
  );
}

/* ================= media ================= */
export function MediaTab() {
  const { state, save } = useContent();
  const set = (k, v) => save({ ...state, media: { ...state.media, [k]: v } });
  return (
    <div className="admin__panel">
      <div className="admin__head">
        <div>
          <h1>تصاویر صفحات</h1>
          <p>تصویر هر بخش از سایت را جایگزین کنید (بارگذاری فایل یا نشانی دلخواه)</p>
        </div>
      </div>
      <div className="admin__list">
        {Object.keys(state.media).map((k) => (
          <div className="admin__item" key={k} style={{ gridTemplateColumns: '96px 1fr auto' }}>
            <img src={state.media[k]} alt="" style={{ width: 96, height: 60 }} />
            <div>
              <b style={{ direction: 'ltr', textAlign: 'left', fontSize: 12.5 }}>{k}</b>
              <input
                value={state.media[k]}
                dir="ltr"
                onChange={(e) => set(k, e.target.value)}
                style={{ width: '100%', border: '1.5px solid var(--line)', borderRadius: 10, padding: '8px 12px', fontSize: 12.5, marginTop: 6 }}
              />
            </div>
            <UploadButton accept="image/*" small label="بارگذاری" onUploaded={(url) => set(k, url)} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================= links ================= */
export function LinksTab() {
  const { state, save } = useContent();
  const set = (k, v) => save({ ...state, links: { ...state.links, [k]: v } });
  return (
    <div className="admin__panel">
      <div className="admin__head">
        <div>
          <h1>پیوندها (لینک‌ها)</h1>
          <p>نشانی دکمه‌ها، تلفن‌ها و شبکه‌های اجتماعی اصلی سایت</p>
        </div>
      </div>
      <div className="admin__texts">
        {Object.keys(state.links).map((k) => (
          <div className="admin__text-row" key={k}>
            <code>{k}</code>
            <input dir="ltr" value={state.links[k]} onChange={(e) => set(k, e.target.value)} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================= footer trust seals ================= */
const trustSealSeed = (value) => (Array.isArray(value)
  ? value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)).slice(0, MAX_TRUST_SEALS)
  : []);

export function TrustSealsTab() {
  const { state, save } = useContent();
  const source = state.collections?.trustSeals;
  const [seals, setSeals] = useState(() => clone(trustSealSeed(source)));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => setSeals(clone(trustSealSeed(source))), [source]);

  const change = (index, field, value) => setSeals((current) => current.map((seal, sealIndex) => (
    sealIndex === index ? { ...seal, [field]: value } : seal
  )));
  const add = () => setSeals((current) => {
    if (current.length >= MAX_TRUST_SEALS) return current;
    return [...current, {
      id: `trust-${Date.now()}-${current.length + 1}`,
      label: '',
      href: '',
      image: '',
      imageId: '',
      active: false,
    }];
  });
  const remove = (index) => setSeals((current) => current.filter((_, sealIndex) => sealIndex !== index));
  const move = (index, direction) => setSeals((current) => {
    const target = index + direction;
    if (target < 0 || target >= current.length) return current;
    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });

  const saveSeals = async () => {
    const clean = seals.map((seal, index) => {
      const hrefRaw = String(seal.href || '').trim();
      const imageRaw = String(seal.image || '').trim();
      return {
        id: String(seal.id || `trust-${Date.now()}-${index + 1}`).trim(),
        label: String(seal.label || '').trim(),
        href: hrefRaw ? (safeHttpsUrl(hrefRaw) || hrefRaw) : '',
        image: imageRaw ? (safeTrustImageUrl(imageRaw) || imageRaw) : '',
        imageId: String(seal.imageId || '').trim(),
        active: Boolean(seal.active),
      };
    });
    const issue = validateTrustSeals(clean);
    if (issue) {
      const text = issue.includes('at most')
        ? 'حداکثر چهار نماد قابل ثبت است.'
        : issue.includes('active but incomplete')
          ? 'برای نماد فعال، نام، لینک اعتبارسنجی و نشانی تصویر الزامی است.'
          : issue.includes('.href')
            ? 'لینک اعتبارسنجی باید یک نشانی کامل و امن https باشد.'
            : issue.includes('imageId') && issue.includes('duplicate')
              ? 'شناسه تصویر هر نماد باید یکتا باشد.'
              : issue.includes('imageId')
                ? 'شناسه اختیاری تصویر باید با حرف آغاز شود و فقط شامل حروف، عدد، خط تیره یا زیرخط باشد.'
                : issue.includes('.image')
                  ? 'نشانی تصویر باید https باشد یا از فایل بارگذاری‌شده سایت استفاده کند.'
                  : 'اطلاعات نمادها معتبر نیست؛ فیلدهای هر ردیف را بررسی کنید.';
      setMessage({ text, bad: true });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await save({
        ...state,
        collections: { ...state.collections, trustSeals: clean },
      });
      setSeals(clean);
      setMessage({ text: 'نمادهای اعتماد ذخیره شدند.' });
    } catch (error) {
      setMessage({ text: error?.message || 'ذخیره نمادها ممکن نشد؛ اتصال را بررسی کنید.', bad: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin__panel">
      <div className="admin__head">
        <div>
          <h1>نمادهای اعتماد فوتر</h1>
          <p>تا چهار نماد مانند eNamad، مجوز اتحادیه یا نشان‌های اعتبارسنجی دیگر را بدون تغییر کد سایت مدیریت کنید.</p>
        </div>
      </div>

      <section className="shop-showcase-editor trust-seal-editor" data-testid="trust-seals-editor" aria-labelledby="trust-seal-editor-title">
        <div className="shop-showcase-editor__head">
          <div>
            <h2 id="trust-seal-editor-title">نمادهای قابل نمایش</h2>
            <p>
              لینک مقصد و نشانی تصویر را از کد ارائه‌دهنده وارد کنید. برای eNamad مقدار href در «لینک اعتبارسنجی» و مقدار src در «نشانی تصویر» قرار می‌گیرد.
            </p>
          </div>
          <button type="button" className="btn btn--outline btn--sm" onClick={add} disabled={seals.length >= MAX_TRUST_SEALS}>
            + افزودن نماد ({seals.length.toLocaleString('fa-IR')}/{MAX_TRUST_SEALS.toLocaleString('fa-IR')})
          </button>
        </div>

        {!seals.length && (
          <div className="trust-seal-editor__empty">
            <Icons.shield size={28} />
            <strong>هنوز نمادی ثبت نشده است.</strong>
            <span>تا زمانی که نمادی اضافه و فعال نشود، هیچ بخش خالی در فوتر نمایش داده نمی‌شود.</span>
          </div>
        )}

        <div className="shop-showcase-editor__list">
          {seals.map((seal, index) => (
            <article className="shop-showcase-editor__item trust-seal-editor__item" key={seal.id || index}>
              <div className="shop-showcase-editor__preview trust-seal-editor__preview">
                {/^\/(?!\/)/.test(String(seal.image || '').trim()) ? (
                  <img key={seal.image} src={seal.image} alt="" />
                ) : (
                  <Icons.shield size={30} />
                )}
                <span>نماد {(index + 1).toLocaleString('fa-IR')}</span>
              </div>

              <div className="shop-showcase-editor__fields">
                <div className="admin__grid2">
                  <Field
                    label={`نام نماد ${(index + 1).toLocaleString('fa-IR')}`}
                    value={seal.label || ''}
                    onChange={(value) => change(index, 'label', value)}
                  />
                  <label className="trust-seal-editor__toggle">
                    <input
                      type="checkbox"
                      checked={Boolean(seal.active)}
                      onChange={(event) => change(index, 'active', event.target.checked)}
                    />
                    <span>نمایش این نماد در فوتر</span>
                  </label>
                </div>
                <div className="admin__grid2">
                  <Field
                    label="لینک اعتبارسنجی (href)"
                    value={seal.href || ''}
                    dir="ltr"
                    onChange={(value) => change(index, 'href', value)}
                  />
                  <Field
                    label="شناسه تصویر (id) — اختیاری"
                    value={seal.imageId || ''}
                    dir="ltr"
                    onChange={(value) => change(index, 'imageId', value)}
                  />
                </div>
                <div className="shop-showcase-editor__image-row">
                  <Field
                    label="نشانی تصویر نماد (src)"
                    value={seal.image || ''}
                    dir="ltr"
                    onChange={(value) => change(index, 'image', value)}
                  />
                  <UploadButton
                    accept="image/*"
                    small
                    label="بارگذاری تصویر"
                    onUploaded={(url) => change(index, 'image', url)}
                  />
                  {safeHttpsUrl(seal.image) && (
                    <a
                      className="btn btn--outline btn--sm"
                      href={safeHttpsUrl(seal.image)}
                      target="_blank"
                      rel="noopener"
                      referrerPolicy="origin"
                    >
                      مشاهده تصویر
                    </a>
                  )}
                </div>
              </div>

              <div className="shop-showcase-editor__actions" aria-label={`مرتب‌سازی نماد ${index + 1}`}>
                <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label="انتقال نماد به بالا">↑</button>
                <button type="button" onClick={() => move(index, 1)} disabled={index === seals.length - 1} aria-label="انتقال نماد به پایین">↓</button>
                <button type="button" className="is-danger" onClick={() => remove(index)} aria-label="حذف نماد">
                  <Icons.trash size={16} />
                </button>
              </div>
            </article>
          ))}
        </div>

        <div className="shop-showcase-editor__footer">
          <button type="button" className="btn btn--primary" onClick={saveSeals} disabled={saving}>
            {saving ? 'در حال ذخیره…' : 'ذخیره نمادها'}
          </button>
          {message && <span role="status" className={message.bad ? 'is-bad' : ''}>{message.text}</span>}
        </div>
      </section>
    </div>
  );
}

/* ================= contact info ================= */
export function ContactTab() {
  const { state, save } = useContent();
  const c = state.collections;

  const patchCollections = (next) => save({ ...state, collections: next });
  const setText = (k, v) => save({ ...state, texts: { ...state.texts, [k]: v } });
  const setLink = (k, v) => save({ ...state, links: { ...state.links, [k]: v } });

  const setOffice = (id, patch) =>
    patchCollections({ ...c, offices: c.offices.map((o) => (o.id === id ? { ...o, ...patch } : o)) });
  const addOffice = () =>
    patchCollections({ ...c, offices: [...c.offices, { id: `office-${Date.now()}`, icon: 'pin', title: 'دفتر جدید', address: '', phones: [] }] });
  const removeOffice = (id) => window.confirm('این دفتر/کارخانه حذف شود؟') && patchCollections({ ...c, offices: c.offices.filter((o) => o.id !== id) });

  const setSocial = (id, patch) =>
    patchCollections({ ...c, socials: c.socials.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const addSocial = () => patchCollections({ ...c, socials: [...c.socials, { id: `social-${Date.now()}`, label: 'شبکه جدید', href: 'https://' }] });
  const removeSocial = (id) => patchCollections({ ...c, socials: c.socials.filter((s) => s.id !== id) });

  return (
    <div className="admin__panel">
      <div className="admin__head">
        <div>
          <h1>اطلاعات تماس</h1>
          <p>تلفن‌ها، نشانی‌ها و شبکه‌های اجتماعی هدر و فوتر</p>
        </div>
      </div>

      <div className="admin__grid2">
        <Field label="ایمیل اصلی" dir="ltr" value={state.texts['global.email']} onChange={(v) => setText('global.email', v)} />
        <Field label="تلفن واحد فروش (نمایش فارسی)" value={state.texts['global.sales.phone.fa']} onChange={(v) => setText('global.sales.phone.fa', v)} />
        <Field label="لینک تلفن فروش" dir="ltr" value={state.links['sales.tel']} onChange={(v) => setLink('sales.tel', v)} />
        <Field label="لینک واتس‌اپ" dir="ltr" value={state.links['sales.whatsapp']} onChange={(v) => setLink('sales.whatsapp', v)} />
      </div>

      <h3 style={{ margin: '26px 0 12px' }}>دفاتر و کارخانه‌ها</h3>
      {c.offices.map((o) => (
        <div key={o.id} style={{ border: '1px solid var(--line)', borderRadius: 14, padding: 16, marginBottom: 14 }}>
          <div className="admin__grid2">
            <Field label="عنوان" value={o.title} onChange={(v) => setOffice(o.id, { title: v })} />
            <Field label="آیکون" value={o.icon} onChange={(v) => setOffice(o.id, { icon: v })} />
          </div>
          <div style={{ marginTop: 10 }}>
            <Field label="نشانی" textarea rows={2} value={o.address} onChange={(v) => setOffice(o.id, { address: v })} />
          </div>
          <h4 style={{ margin: '12px 0 8px', fontSize: 13.5 }}>تلفن‌ها</h4>
          {(o.phones || []).map((ph, i) => (
            <div className="admin__grid2" key={i} style={{ marginBottom: 8 }}>
              <input
                value={ph.fa}
                placeholder="نمایش فارسی"
                onChange={(e) => setOffice(o.id, { phones: o.phones.map((x, idx) => (idx === i ? { ...x, fa: e.target.value } : x)) })}
                style={{ border: '1.5px solid var(--line)', borderRadius: 10, padding: '9px 12px', fontSize: 13.5 }}
              />
              <div className="admin__row">
                <input
                  value={ph.tel}
                  dir="ltr"
                  placeholder="tel: 021..."
                  onChange={(e) => setOffice(o.id, { phones: o.phones.map((x, idx) => (idx === i ? { ...x, tel: e.target.value } : x)) })}
                  style={{ flex: 1, border: '1.5px solid var(--line)', borderRadius: 10, padding: '9px 12px', fontSize: 13.5 }}
                />
                <button
                  className="admin__iconbtn danger"
                  title="حذف"
                  aria-label="حذف"
                  onClick={() => setOffice(o.id, { phones: o.phones.filter((_, idx) => idx !== i) })}
                >
                  <Icons.trash size={16} />
                </button>
              </div>
            </div>
          ))}
          <div className="admin__row">
            <button className="btn btn--outline btn--sm" onClick={() => setOffice(o.id, { phones: [...(o.phones || []), { fa: '', tel: '' }] })}>
              + افزودن تلفن
            </button>
            <button className="btn btn--outline btn--sm" style={{ color: 'var(--crimson-ink)' }} onClick={() => removeOffice(o.id)}>
              حذف این دفتر
            </button>
          </div>
        </div>
      ))}
      <button className="btn btn--outline" onClick={addOffice}>
        + افزودن دفتر / کارخانه
      </button>

      <h3 style={{ margin: '26px 0 12px' }}>شبکه‌های اجتماعی (هدر و فوتر)</h3>
      {c.socials.map((s) => (
        <div className="admin__grid2" key={s.id} style={{ marginBottom: 10 }}>
          <Field label="نام" value={s.label} onChange={(v) => setSocial(s.id, { label: v })} />
          <div className="admin__row">
            <input
              value={s.href}
              dir="ltr"
              onChange={(e) => setSocial(s.id, { href: e.target.value })}
              style={{ flex: 1, border: '1.5px solid var(--line)', borderRadius: 10, padding: '10px 14px', fontSize: 13.5 }}
            />
            <button className="admin__iconbtn danger" title="حذف" aria-label="حذف" onClick={() => removeSocial(s.id)}>
              <Icons.trash size={16} />
            </button>
          </div>
        </div>
      ))}
      <button className="btn btn--outline" onClick={addSocial}>
        + افزودن شبکه اجتماعی
      </button>

      <h3 style={{ margin: '26px 0 12px' }}>موضوعات فرم تماس</h3>
      <StringListEditor items={c.subjects} onChange={(v) => patchCollections({ ...c, subjects: v })} addLabel="افزودن موضوع" />
    </div>
  );
}

/* ================= messages ================= */
export function MessagesTab() {
  const [messages, setMessages] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(null);

  const load = async () => {
    try {
      setErr('');
      setMessages(await api('/api/messages', { auth: true }));
    } catch (e) {
      setErr(e.status === 401 ? 'نشست مدیر منقضی شده؛ دوباره وارد شوید.' : 'دریافت پیام‌ها ممکن نشد.');
    }
  };
  useEffect(() => {
    load();
  }, []);

  const patch = async (id, body, method = 'PATCH') => {
    await api(`/api/messages/${id}`, { method, body, auth: true });
    load();
  };

  return (
    <div className="admin__panel">
      <div className="admin__head">
        <div>
          <h1>پیام‌های فرم تماس</h1>
          <p>پیام‌های ارسال‌شده از فرم «ارسال پیام و استعلام قیمت»</p>
        </div>
        <button className="btn btn--outline" onClick={load}>
          <Icons.refresh size={16} />
          به‌روزرسانی
        </button>
      </div>
      {err && <p style={{ color: 'var(--crimson-ink)' }}>{err}</p>}
      {messages === null && !err && <p style={{ color: 'var(--muted)' }}>در حال دریافت…</p>}
      {messages?.length === 0 && <p style={{ color: 'var(--muted)' }}>هنوز پیامی ثبت نشده است.</p>}
      {messages?.map((m) => (
        <div className="msg" key={m.id}>
          <div className={`msg__head ${m.read ? '' : 'unread'}`} onClick={() => setOpen(open === m.id ? null : m.id)}>
            <div>
              <b>{m.name}</b> <small>· {m.phone}</small>
              <div>
                <small>{m.subject}</small>
              </div>
            </div>
            <small style={{ marginInlineStart: 12 }}>{new Date(m.at).toLocaleString('fa-IR')}</small>
            <span className={`msg__badge ${m.read ? 'read' : ''}`}>{m.read ? 'خوانده‌شده' : 'خوانده‌نشده'}</span>
          </div>
          {open === m.id && (
            <div className="msg__body">
              {m.email && (
                <p>
                  <small>ایمیل: {m.email}</small>
                </p>
              )}
              <p style={{ whiteSpace: 'pre-wrap', lineHeight: 2 }}>{m.message}</p>
              <div className="admin__row">
                <button className="btn btn--outline btn--sm" onClick={() => patch(m.id, { read: !m.read })}>
                  {m.read ? 'علامت به‌عنوان خوانده‌نشده' : 'علامت به‌عنوان خوانده‌شده'}
                </button>
                <button className="btn btn--outline btn--sm" style={{ color: 'var(--crimson-ink)' }} onClick={() => patch(m.id, null, 'DELETE')}>
                  حذف پیام
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
