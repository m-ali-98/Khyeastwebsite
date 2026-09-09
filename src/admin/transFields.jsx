/* ==========================================================================
   Building blocks for editing a translated entity (product / blog post).
   --------------------------------------------------------------------------
   Every control shows the Persian original next to the input as a reference,
   and the input itself is PRE-FILLED with the translation that is currently
   live (the admin's own override if there is one, otherwise the translation
   shipped with the site). So the editor always looks like a normal form in
   the target language rather than a pile of empty boxes.

   On save, any field still identical to the shipped translation is dropped,
   so the stored override stays small and future improvements to the shipped
   dictionary still reach fields the admin never touched.
   ========================================================================== */
import { Icons } from '../components/ui';

/* -------------------------------------------------------------- utilities */

export const eff = (override, shipped, base) => {
  if (override !== undefined && override !== null && override !== '') return override;
  if (shipped !== undefined && shipped !== null && shipped !== '') return shipped;
  return base ?? '';
};

/** Effective value for a list of strings, row by row. */
export const effList = (override, shipped, base = []) =>
  base.map((b, i) => eff(override?.[i], shipped?.[i], b));

/** Effective value for a list of [key, value] pairs. */
export const effPairs = (override, shipped, base = []) =>
  base.map((row, i) => [eff(override?.[i]?.[0], shipped?.[i]?.[0], row[0]), eff(override?.[i]?.[1], shipped?.[i]?.[1], row[1])]);

/** Drop everything that matches the shipped translation, so we only persist
    what the admin actually changed. Returns undefined when nothing is left. */
export const pruneValue = (value, shipped) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (JSON.stringify(value) === JSON.stringify(shipped)) return undefined;
  return value;
};

/* ----------------------------------------------------------------- fields */

export function TransField({ label, base, value, onChange, textarea, rows = 3, dir, hint }) {
  return (
    <div className="admin__tf">
      <div className="admin__tf-head">
        <span className="admin__tf-label">{label}</span>
        {hint && <span className="admin__tf-hint">{hint}</span>}
      </div>
      <div className="admin__tf-body">
        <div className="admin__tf-ref" title="متن فارسی (مرجع)">
          <span className="admin__tf-reftag">فارسی</span>
          {base || <em>—</em>}
        </div>
        {textarea ? (
          <textarea rows={rows} dir={dir} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <input dir={dir} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
        )}
      </div>
    </div>
  );
}

/** Translated list of plain strings; the number of rows follows the Persian
    original, because the structure belongs to the base language. */
export function TransStringList({ label, base = [], value = [], onChange }) {
  const set = (i, v) => {
    const next = [...value];
    while (next.length < base.length) next.push('');
    next[i] = v;
    onChange(next);
  };
  return (
    <div className="admin__tf-group">
      <h3>{label}</h3>
      {base.map((b, i) => (
        <TransField key={i} label={`${i + 1}`} base={b} value={value[i]} onChange={(v) => set(i, v)} textarea rows={2} />
      ))}
      {!base.length && <p className="admin__hint">در نسخه فارسی موردی ثبت نشده است.</p>}
    </div>
  );
}

/** Translated list of [title, value] pairs (spec tables, lab analysis). */
export function TransPairList({ label, base = [], value = [], onChange }) {
  const set = (i, col, v) => {
    const next = base.map((_, idx) => [...(value[idx] || ['', ''])]);
    next[i][col] = v;
    onChange(next);
  };
  return (
    <div className="admin__tf-group">
      <h3>{label}</h3>
      {base.map(([bk, bv], i) => (
        <div className="admin__tf-pair" key={i}>
          <TransField label="عنوان" base={bk} value={value[i]?.[0]} onChange={(v) => set(i, 0, v)} />
          <TransField label="مقدار" base={bv} value={value[i]?.[1]} onChange={(v) => set(i, 1, v)} />
        </div>
      ))}
      {!base.length && <p className="admin__hint">در نسخه فارسی ردیفی ثبت نشده است.</p>}
    </div>
  );
}

/** Fields that belong to the base language and are shared by every locale. */
export function SharedFieldsNote({ items }) {
  return (
    <div className="admin__shared">
      <Icons.shield size={16} />
      <div>
        <strong>مشترک بین همه زبان‌ها</strong>
        <p>
          این موارد ساختار محتوا هستند و فقط از نسخه فارسی تغییر می‌کنند:{' '}
          {items.join('، ')}.
        </p>
      </div>
    </div>
  );
}
