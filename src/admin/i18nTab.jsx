/* ==========================================================================
   Admin — translation editing.
   --------------------------------------------------------------------------
   Persian is the base content and is edited in the ordinary tabs. English and
   Arabic are stored as a thin override layer at `state.i18n[locale]`, applied
   on top of the shipped translation (shared/i18n/<locale>.js), which is itself
   applied on top of the Persian base.

   So each field here shows:
     • the Persian original (read-only reference)
     • the current translation as the placeholder (shipped default)
     • an input that, once filled, overrides it
   Leaving a field empty simply keeps the shipped translation — nothing is
   ever lost, and the admin never has to retype a whole language.
   ========================================================================== */
import { useEffect, useMemo, useState } from 'react';
import { useContent } from '../content/ContentContext';
import { getPack } from '../../shared/i18n/index.js';
import { useAdminLocale } from './adminLocale';

const clone = (v) => JSON.parse(JSON.stringify(v));

const GROUPS = [
  ['all', 'همه'],
  ['global', 'سراسری'],
  ['nav', 'منو'],
  ['home', 'صفحه اصلی'],
  ['about', 'درباره ما'],
  ['products', 'محصولات'],
  ['product', 'جزئیات محصول'],
  ['export', 'صادرات'],
  ['quality', 'کیفیت'],
  ['blog', 'وبلاگ'],
  ['contact', 'تماس'],
  ['footer', 'فوتر'],
];

/* Fields that carry human language, per entity type. */
const PRODUCT_TEXT = ['title', 'weight', 'pack', 'short'];
const PRODUCT_LIST = ['usage', 'storage'];
const PRODUCT_PAIRS = ['specs', 'analysis'];
const POST_TEXT = ['title', 'excerpt', 'category', 'date', 'readTime'];

const LABELS = {
  title: 'عنوان',
  weight: 'وزن / اندازه',
  pack: 'بسته‌بندی',
  short: 'توضیح کوتاه',
  excerpt: 'چکیده',
  category: 'دسته‌بندی',
  date: 'تاریخ',
  readTime: 'زمان مطالعه',
  usage: 'راهنمای مصرف',
  storage: 'شرایط نگهداری',
  specs: 'جدول مشخصات',
  analysis: 'آنالیز آزمایشگاهی',
  body: 'متن کامل',
  tagline: 'شعار برند',
  fa: 'نام برند',
  label: 'برچسب',
  text: 'متن',
  address: 'نشانی',
  role: 'سمت',
  value: 'مقدار',
  suffix: 'پسوند',
};

/* -------------------------------------------------------------- primitives */

function TransRow({ base, shipped, value, onChange, label, long }) {
  const rows = long || String(base || '').length > 90 ? 3 : 1;
  return (
    <div className="admin__trans-row">
      <div className="admin__trans-label">
        {label && <strong>{label}</strong>}
        <span className="admin__trans-base" title="متن فارسی (مرجع)">
          {base || <em>—</em>}
        </span>
      </div>
      <textarea
        rows={rows}
        value={value ?? ''}
        placeholder={shipped || ''}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** Edit a translated list of plain strings. */
function ListTrans({ base = [], shipped = [], value, onChange, label }) {
  const list = value || [];
  const set = (i, v) => {
    const next = [...(value || [])];
    while (next.length < base.length) next.push('');
    next[i] = v;
    onChange(next.some((x) => x) ? next : undefined);
  };
  return (
    <div className="admin__trans-block">
      <h4>{label}</h4>
      {base.map((b, i) => (
        <TransRow key={i} base={b} shipped={shipped[i]} value={list[i]} onChange={(v) => set(i, v)} />
      ))}
    </div>
  );
}

/** Edit a translated list of [key, value] pairs. */
function PairTrans({ base = [], shipped = [], value, onChange, label }) {
  const list = value || [];
  const set = (i, col, v) => {
    const next = base.map((b, idx) => [...(list[idx] || ['', ''])]);
    next[i][col] = v;
    onChange(next.some(([a, b]) => a || b) ? next : undefined);
  };
  return (
    <div className="admin__trans-block">
      <h4>{label}</h4>
      {base.map(([bk, bv], i) => (
        <div className="admin__grid2" key={i} style={{ gap: 8 }}>
          <TransRow base={bk} shipped={shipped[i]?.[0]} value={list[i]?.[0]} onChange={(v) => set(i, 0, v)} />
          <TransRow base={bv} shipped={shipped[i]?.[1]} value={list[i]?.[1]} onChange={(v) => set(i, 1, v)} />
        </div>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------------- tab */

export function TranslationsTab() {
  const { state, save } = useContent();
  const { locale } = useAdminLocale();
  const [section, setSection] = useState('texts');
  const [group, setGroup] = useState('all');
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState(() => clone(state.i18n?.[locale] || {}));
  const [saved, setSaved] = useState(false);

  useEffect(() => setDraft(clone(state.i18n?.[locale] || {})), [locale, state.i18n]);

  /* autosave, same debounce as the other tabs */
  useEffect(() => {
    const current = state.i18n?.[locale] || {};
    if (JSON.stringify(draft) === JSON.stringify(current)) return undefined;
    const id = setTimeout(() => {
      save({ ...state, i18n: { ...(state.i18n || {}), [locale]: draft } });
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    }, 800);
    return () => clearTimeout(id);
  }, [draft]);

  const pack = getPack(locale) || {};
  const base = state; // Persian

  const setIn = (path, value) => {
    setDraft((d) => {
      const next = clone(d);
      let node = next;
      for (let i = 0; i < path.length - 1; i += 1) {
        const k = path[i];
        if (node[k] === undefined || node[k] === null) node[k] = typeof path[i + 1] === 'number' ? [] : {};
        node = node[k];
      }
      const last = path[path.length - 1];
      if (value === undefined || value === '') delete node[last];
      else node[last] = value;
      return next;
    });
  };

  /* ---- texts ---- */
  const textKeys = useMemo(() => {
    const all = Object.keys(base.texts || {});
    return all.filter(
      (k) =>
        /* the shop is Persian-only, so its strings are not translated */
        !k.startsWith('shop.') &&
        (group === 'all' || k.startsWith(`${group}.`)) &&
        (!q ||
          k.includes(q) ||
          String(base.texts[k]).includes(q) ||
          String(pack.texts?.[k] || '').toLowerCase().includes(q.toLowerCase()))
    );
  }, [base.texts, pack.texts, group, q]);

  const SECTIONS = [
    ['texts', 'متون صفحات'],
    ['collections', 'فهرست‌ها'],
    ['products', 'محصولات'],
    ['posts', 'مقالات'],
    ['brands', 'برندها'],
  ];

  return (
    <div className="admin__panel">
      <div className="admin__head">
        <div>
          <h1>ترجمه‌ها — {locale === 'en' ? 'English' : 'العربية'}</h1>
          <p>
            متن فارسی در سمت راست هر ردیف نمایش داده می‌شود. اگر کادر را خالی بگذارید، ترجمه پیش‌فرض سایت
            (که همین حالا نمایش داده می‌شود) استفاده می‌گردد. تغییرات خودکار ذخیره می‌شود.
          </p>
        </div>
        {saved && <span className="admin__saved">ذخیره شد ✓</span>}
      </div>

      <div className="admin__row" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        {SECTIONS.map(([id, label]) => (
          <button key={id} className={`filter-chip ${section === id ? 'is-active' : ''}`} onClick={() => setSection(id)}>
            {label}
          </button>
        ))}
      </div>

      {section === 'texts' && (
        <>
          <div className="admin__search">
            <input placeholder="جستجو در کلید، متن فارسی یا ترجمه…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="admin__row" style={{ marginBottom: 18, flexWrap: 'wrap' }}>
            {GROUPS.map(([g, label]) => (
              <button key={g} className={`filter-chip ${group === g ? 'is-active' : ''}`} onClick={() => setGroup(g)}>
                {label}
              </button>
            ))}
          </div>
          <div className="admin__texts">
            {textKeys.map((k) => (
              <div className="admin__trans-item" key={k}>
                <code>{k}</code>
                <TransRow
                  base={base.texts[k]}
                  shipped={pack.texts?.[k]}
                  value={draft.texts?.[k]}
                  onChange={(v) => setIn(['texts', k], v)}
                />
              </div>
            ))}
            {!textKeys.length && <p style={{ color: 'var(--muted)' }}>موردی یافت نشد.</p>}
          </div>
        </>
      )}

      {section === 'collections' &&
        Object.entries(base.collections || {}).map(([key, list]) => (
          <div className="admin__trans-group" key={key}>
            <h3>{key}</h3>
            {(list || []).map((item, i) =>
              typeof item === 'string' ? (
                <TransRow
                  key={i}
                  label={`${i + 1}.`}
                  base={item}
                  shipped={pack.collections?.[key]?.[i]}
                  value={draft.collections?.[key]?.[i]}
                  onChange={(val) => setIn(['collections', key, i], val)}
                />
              ) : (
              Object.entries(item)
                .filter(([f, v]) => typeof v === 'string' && ['label', 'title', 'text', 'address', 'role', 'value', 'suffix'].includes(f))
                .map(([f, v]) => (
                  <TransRow
                    key={`${i}-${f}`}
                    label={`${i + 1}. ${LABELS[f] || f}`}
                    base={v}
                    shipped={pack.collections?.[key]?.[i]?.[f]}
                    value={draft.collections?.[key]?.[i]?.[f]}
                    onChange={(val) => setIn(['collections', key, i, f], val)}
                  />
                ))
              )
            )}
          </div>
        ))}

      {section === 'products' &&
        (base.products || []).map((p) => (
          <div className="admin__trans-group" key={p.slug}>
            <h3>
              {p.title} <code>{p.slug}</code>
            </h3>
            {PRODUCT_TEXT.map((f) => (
              <TransRow
                key={f}
                label={LABELS[f]}
                base={p[f]}
                shipped={pack.products?.[p.slug]?.[f]}
                value={draft.products?.[p.slug]?.[f]}
                onChange={(v) => setIn(['products', p.slug, f], v)}
              />
            ))}
            {PRODUCT_PAIRS.map((f) => (
              <PairTrans
                key={f}
                label={LABELS[f]}
                base={p[f] || []}
                shipped={pack.products?.[p.slug]?.[f] || []}
                value={draft.products?.[p.slug]?.[f]}
                onChange={(v) => setIn(['products', p.slug, f], v)}
              />
            ))}
            {PRODUCT_LIST.map((f) => (
              <ListTrans
                key={f}
                label={LABELS[f]}
                base={p[f] || []}
                shipped={pack.products?.[p.slug]?.[f] || []}
                value={draft.products?.[p.slug]?.[f]}
                onChange={(v) => setIn(['products', p.slug, f], v)}
              />
            ))}
          </div>
        ))}

      {section === 'posts' &&
        (base.posts || []).map((p) => (
          <div className="admin__trans-group" key={p.slug}>
            <h3>
              {p.title} <code>{p.slug}</code>
            </h3>
            {POST_TEXT.map((f) => (
              <TransRow
                key={f}
                label={LABELS[f]}
                base={p[f]}
                shipped={pack.posts?.[p.slug]?.[f]}
                value={draft.posts?.[p.slug]?.[f]}
                onChange={(v) => setIn(['posts', p.slug, f], v)}
              />
            ))}
            <div className="admin__trans-block">
              <h4>{LABELS.body}</h4>
              <p className="admin__hint">متن کامل مقاله به‌صورت HTML ساده (پاراگراف، سرتیتر و فهرست).</p>
              <textarea
                className="admin__trans-html"
                rows={14}
                dir={locale === 'ar' ? 'rtl' : 'ltr'}
                placeholder={pack.posts?.[p.slug]?.body || ''}
                value={draft.posts?.[p.slug]?.body ?? ''}
                onChange={(e) => setIn(['posts', p.slug, 'body'], e.target.value)}
              />
            </div>
          </div>
        ))}

      {section === 'brands' &&
        (base.brands || []).map((b) => (
          <div className="admin__trans-group" key={b.id}>
            <h3>
              {b.fa} <code>{b.id}</code>
            </h3>
            {['fa', 'tagline'].map((f) => (
              <TransRow
                key={f}
                label={LABELS[f]}
                base={b[f]}
                shipped={pack.brands?.[b.id]?.[f]}
                value={draft.brands?.[b.id]?.[f]}
                onChange={(v) => setIn(['brands', b.id, f], v)}
              />
            ))}
          </div>
        ))}
    </div>
  );
}

export default TranslationsTab;
