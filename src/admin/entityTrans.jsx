/* ==========================================================================
   Products & Blog, in English / Arabic.
   --------------------------------------------------------------------------
   These are full editors, not flat key/value rows: the same layout as the
   Persian tabs (list → edit form, spec tables, usage lists, rich body), but
   every input edits the translation and shows the Persian original beside it.

   Structure — slug, brand, images, "featured", the NUMBER of spec rows — is
   deliberately NOT editable here. It belongs to the base language, so adding
   a product or a spec row is done once in Persian and every language inherits
   it. That keeps the three versions of the site permanently in sync.
   ========================================================================== */
import { useMemo, useState } from 'react';
import { Icons } from '../components/ui';
import { useContent } from '../content/ContentContext';
import { sanitizeHtml } from '../content/sanitize';
import { getPack } from '../../shared/i18n/index.js';
import { useAdminLocale } from './adminLocale';
import { RichEditor } from './editors';
import {
  TransField,
  TransStringList,
  TransPairList,
  SharedFieldsNote,
  eff,
  effList,
  effPairs,
  pruneValue,
} from './transFields';

const LANG_NAME = { en: 'انگلیسی', ar: 'عربی' };

/* Write `patch` into state.i18n[locale][bucket][slug], dropping any field that
   is identical to the shipped translation. */
function useEntitySave(bucket) {
  const { state, save } = useContent();
  const { locale } = useAdminLocale();
  const pack = getPack(locale) || {};

  return (slug, draft) => {
    const shipped = pack[bucket]?.[slug] || {};
    const kept = {};
    for (const [k, v] of Object.entries(draft)) {
      const pruned = pruneValue(v, shipped[k]);
      if (pruned !== undefined) kept[k] = pruned;
    }

    const locData = { ...(state.i18n?.[locale] || {}) };
    const bucketData = { ...(locData[bucket] || {}) };
    if (Object.keys(kept).length) bucketData[slug] = kept;
    else delete bucketData[slug];
    locData[bucket] = bucketData;

    save({ ...state, i18n: { ...(state.i18n || {}), [locale]: locData } });
  };
}

/* ---------------------------------------------------------------- shared UI */

function TransList({ items, title, sub, subtitle, onEdit, translatedOf }) {
  return (
    <div className="admin__panel">
      <div className="admin__head">
        <div>
          <h1>{title}</h1>
          <p>{sub}</p>
        </div>
      </div>
      <div className="admin__list">
        {items.map((it) => {
          const done = translatedOf(it);
          return (
            <div className="admin__item" key={it.slug}>
              <img src={it.image} alt="" />
              <div>
                <b>{it.displayTitle}</b>
                <small>{subtitle(it)}</small>
              </div>
              <div className="admin__actions">
                <span className={`admin__badge ${done === 'full' ? 'ok' : done === 'part' ? 'warn' : ''}`}>
                  {done === 'full' ? 'ترجمه شده' : done === 'part' ? 'ناقص' : 'پیش‌فرض'}
                </span>
                <button className="admin__iconbtn" title="ویرایش ترجمه" onClick={() => onEdit(it)}>
                  ✎
                </button>
              </div>
            </div>
          );
        })}
        {!items.length && <p className="admin__hint">موردی برای ترجمه وجود ندارد.</p>}
      </div>
    </div>
  );
}

function EditHead({ kicker, title, onBack, onSave, savedAt }) {
  return (
    <div className="admin__head admin__head--sticky">
      <div>
        <p className="admin__kicker">{kicker}</p>
        <h1>{title}</h1>
      </div>
      <div className="admin__row">
        {savedAt && <span className="admin__saved">ذخیره شد ✓</span>}
        <button className="btn btn--primary" onClick={onSave}>
          ذخیره ترجمه
        </button>
        <button className="btn btn--outline" onClick={onBack}>
          بازگشت
        </button>
      </div>
    </div>
  );
}

/* ================================================================ products */

export function ProductsTransTab() {
  const { state } = useContent();
  const { locale } = useAdminLocale();
  const pack = getPack(locale) || {};
  const persist = useEntitySave('products');
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saved, setSaved] = useState(false);

  const overrides = state.i18n?.[locale]?.products || {};

  const open = (p) => {
    const o = overrides[p.slug] || {};
    const s = pack.products?.[p.slug] || {};
    setDraft({
      title: eff(o.title, s.title, p.title),
      weight: eff(o.weight, s.weight, p.weight),
      pack: eff(o.pack, s.pack, p.pack),
      short: eff(o.short, s.short, p.short),
      specs: effPairs(o.specs, s.specs, p.specs || []),
      analysis: effPairs(o.analysis, s.analysis, p.analysis || []),
      usage: effList(o.usage, s.usage, p.usage || []),
      storage: effList(o.storage, s.storage, p.storage || []),
    });
    setEditing(p);
  };

  const commit = () => {
    persist(editing.slug, draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const items = useMemo(
    () =>
      (state.products || []).map((p) => {
        const o = overrides[p.slug] || {};
        const s = pack.products?.[p.slug] || {};
        return {
          ...p,
          displayTitle: eff(o.title, s.title, p.title),
          _has: Object.keys(o).length,
          _shipped: Object.keys(s).length,
        };
      }),
    [state.products, overrides, pack.products]
  );

  if (editing && draft) {
    return (
      <div className="admin__panel">
        <EditHead
          kicker={`ترجمه ${LANG_NAME[locale]} — محصول`}
          title={editing.title}
          onBack={() => setEditing(null)}
          onSave={commit}
          savedAt={saved}
        />

        <SharedFieldsNote items={['شناسه (slug)', 'برند', 'تصویر محصول', 'وضعیت «برگزیده»', 'تعداد ردیف‌های جدول']} />

        <div className="admin__grid2">
          <TransField label="عنوان محصول" base={editing.title} value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} />
          <TransField label="وزن / اندازه" base={editing.weight} value={draft.weight} onChange={(v) => setDraft({ ...draft, weight: v })} />
        </div>
        <div className="admin__grid2">
          <TransField label="نوع بسته‌بندی" base={editing.pack} value={draft.pack} onChange={(v) => setDraft({ ...draft, pack: v })} />
          <div />
        </div>
        <TransField
          label="توضیح کوتاه"
          base={editing.short}
          value={draft.short}
          onChange={(v) => setDraft({ ...draft, short: v })}
          textarea
        />

        <TransPairList
          label="جدول مشخصات"
          base={editing.specs || []}
          value={draft.specs}
          onChange={(v) => setDraft({ ...draft, specs: v })}
        />
        <TransStringList
          label="راهنمای مصرف"
          base={editing.usage || []}
          value={draft.usage}
          onChange={(v) => setDraft({ ...draft, usage: v })}
        />
        <TransPairList
          label="آنالیز آزمایشگاهی"
          base={editing.analysis || []}
          value={draft.analysis}
          onChange={(v) => setDraft({ ...draft, analysis: v })}
        />
        <TransStringList
          label="شرایط نگهداری"
          base={editing.storage || []}
          value={draft.storage}
          onChange={(v) => setDraft({ ...draft, storage: v })}
        />

        <div className="admin__row" style={{ marginTop: 26 }}>
          <button className="btn btn--primary" onClick={commit}>
            ذخیره ترجمه
          </button>
          <button className="btn btn--outline" onClick={() => setEditing(null)}>
            بازگشت به فهرست
          </button>
        </div>
      </div>
    );
  }

  return (
    <TransList
      title={`محصولات — نسخه ${LANG_NAME[locale]}`}
      sub="ترجمه عنوان، مشخصات، آنالیز و راهنمای مصرف هر محصول. افزودن یا حذف محصول از نسخه فارسی انجام می‌شود."
      items={items}
      subtitle={(p) => `${p.weight} · ${p.pack}`}
      translatedOf={(p) => (p._has ? 'full' : p._shipped ? 'part' : '')}
      onEdit={open}
    />
  );
}

/* =================================================================== posts */

export function PostsTransTab() {
  const { state } = useContent();
  const { locale } = useAdminLocale();
  const pack = getPack(locale) || {};
  const persist = useEntitySave('posts');
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saved, setSaved] = useState(false);
  const [showFa, setShowFa] = useState(false);

  const overrides = state.i18n?.[locale]?.posts || {};

  const open = (p) => {
    const o = overrides[p.slug] || {};
    const s = pack.posts?.[p.slug] || {};
    setDraft({
      title: eff(o.title, s.title, p.title),
      excerpt: eff(o.excerpt, s.excerpt, p.excerpt),
      category: eff(o.category, s.category, p.category),
      date: eff(o.date, s.date, p.date),
      readTime: eff(o.readTime, s.readTime, p.readTime),
      body: eff(o.body, s.body, p.body),
    });
    setEditing(p);
    setShowFa(false);
  };

  const commit = () => {
    persist(editing.slug, { ...draft, body: sanitizeHtml(draft.body) });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const items = useMemo(
    () =>
      (state.posts || []).map((p) => {
        const o = overrides[p.slug] || {};
        const s = pack.posts?.[p.slug] || {};
        return {
          ...p,
          displayTitle: eff(o.title, s.title, p.title),
          _has: Object.keys(o).length,
          _shipped: Object.keys(s).length,
        };
      }),
    [state.posts, overrides, pack.posts]
  );

  if (editing && draft) {
    return (
      <div className="admin__panel">
        <EditHead
          kicker={`ترجمه ${LANG_NAME[locale]} — مقاله`}
          title={editing.title}
          onBack={() => setEditing(null)}
          onSave={commit}
          savedAt={saved}
        />

        <SharedFieldsNote items={['شناسه (slug)', 'تصویر شاخص']} />

        <TransField label="عنوان مقاله" base={editing.title} value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} />
        <div className="admin__grid2">
          <TransField label="دسته‌بندی" base={editing.category} value={draft.category} onChange={(v) => setDraft({ ...draft, category: v })} />
          <TransField label="تاریخ نمایش" base={editing.date} value={draft.date} onChange={(v) => setDraft({ ...draft, date: v })} />
        </div>
        <TransField
          label="زمان مطالعه (دقیقه)"
          base={editing.readTime}
          value={draft.readTime}
          onChange={(v) => setDraft({ ...draft, readTime: v })}
          hint="در نسخه انگلیسی عدد لاتین و در عربی عدد عربی وارد کنید"
        />
        <TransField
          label="چکیده"
          base={editing.excerpt}
          value={draft.excerpt}
          onChange={(v) => setDraft({ ...draft, excerpt: v })}
          textarea
          rows={2}
        />

        <div className="admin__tf-group">
          <div className="admin__row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>متن مقاله</h3>
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setShowFa((v) => !v)}>
              <Icons.doc size={15} />
              {showFa ? 'بستن متن فارسی' : 'نمایش متن فارسی'}
            </button>
          </div>
          <p className="admin__hint">
            همان ویرایشگر نسخه فارسی: سرتیتر، فهرست، پیوند، تصویر و ویدیو. برای ترجمه می‌توانید متن فارسی را
            کنار دست خود باز کنید.
          </p>
          {showFa && (
            <div className="admin__fa-body" dir="rtl" dangerouslySetInnerHTML={{ __html: sanitizeHtml(editing.body) }} />
          )}
          <div dir={locale === 'ar' ? 'rtl' : 'ltr'}>
            <RichEditor key={`${editing.slug}-${locale}`} value={draft.body} onChange={(v) => setDraft({ ...draft, body: v })} />
          </div>
        </div>

        <div className="admin__row" style={{ marginTop: 26 }}>
          <button className="btn btn--primary" onClick={commit}>
            ذخیره ترجمه
          </button>
          <button className="btn btn--outline" onClick={() => setEditing(null)}>
            بازگشت به فهرست
          </button>
        </div>
      </div>
    );
  }

  return (
    <TransList
      title={`وبلاگ — نسخه ${LANG_NAME[locale]}`}
      sub="ترجمه عنوان، چکیده و متن کامل هر مقاله. افزودن یا حذف مقاله از نسخه فارسی انجام می‌شود."
      items={items}
      subtitle={(p) => `${p.date} · ${p.category}`}
      translatedOf={(p) => (p._has ? 'full' : p._shipped ? 'part' : '')}
      onEdit={open}
    />
  );
}
