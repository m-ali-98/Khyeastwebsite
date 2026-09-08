import { useEffect, useRef, useState } from 'react';
import { Icons } from '../components/ui';
import { api } from '../content/ContentContext';
import { sanitizeHtml } from '../content/sanitize';

/* ---------------- simple field ---------------- */
export function Field({ label, value, onChange, type = 'text', dir, textarea, rows = 3, options }) {
  return (
    <label className="field" style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: 0 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-2)' }}>{label}</span>
      {textarea ? (
        <textarea rows={rows} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
      ) : type === 'select' ? (
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          {(options || []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input type={type} dir={dir} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

/* ---------------- upload button (photos & videos) ---------------- */
export function UploadButton({ onUploaded, accept = 'image/*,video/mp4,video/webm', label = 'بارگذاری فایل', small = false }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const pick = async (file) => {
    setBusy(true);
    setErr('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api('/api/upload', { method: 'POST', formData: fd, auth: true });
      onUploaded(res.url);
    } catch (e) {
      setErr('بارگذاری ممکن نشد');
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = '';
    }
  };

  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])}
      />
      <button type="button" className={`btn btn--outline ${small ? 'btn--sm' : ''}`} onClick={() => ref.current?.click()} disabled={busy}>
        <Icons.pack size={16} />
        {busy ? 'در حال بارگذاری…' : label}
      </button>
      {err && <small style={{ color: 'var(--crimson)' }}>{err}</small>}
    </>
  );
}

/* ---------------- list of strings ---------------- */
export function StringListEditor({ items = [], onChange, label = 'مورد', addLabel = 'افزودن مورد' }) {
  const set = (i, v) => onChange(items.map((it, idx) => (idx === i ? v : it)));
  const remove = (i) => onChange(items.filter((_, idx) => idx !== i));
  return (
    <div className="admin__list">
      {items.map((it, i) => (
        <div className="admin__row" key={i}>
          <input
            value={it}
            onChange={(e) => set(i, e.target.value)}
            style={{ flex: 1, border: '1.5px solid var(--line)', borderRadius: 10, padding: '10px 14px', fontSize: 14, outline: 'none' }}
          />
          <button type="button" className="admin__iconbtn danger" onClick={() => remove(i)} title="حذف">
            <Icons.arrow size={15} style={{ transform: 'rotate(90deg)' }} />
          </button>
        </div>
      ))}
      <button type="button" className="btn btn--outline btn--sm" style={{ justifySelf: 'start' }} onClick={() => onChange([...items, ''])}>
        + {addLabel}
      </button>
    </div>
  );
}

/* ---------------- list of [key, value] pairs ---------------- */
export function PairListEditor({ items = [], onChange, kLabel = 'عنوان', vLabel = 'مقدار' }) {
  const set = (i, which, v) =>
    onChange(items.map((it, idx) => (idx === i ? [which === 0 ? v : it[0], which === 1 ? v : it[1]] : it)));
  const remove = (i) => onChange(items.filter((_, idx) => idx !== i));
  return (
    <div className="admin__list">
      {items.map(([k, v], i) => (
        <div className="admin__grid2" key={i} style={{ gap: 8 }}>
          <input
            placeholder={kLabel}
            value={k}
            onChange={(e) => set(i, 0, e.target.value)}
            style={{ border: '1.5px solid var(--line)', borderRadius: 10, padding: '10px 14px', fontSize: 14, outline: 'none' }}
          />
          <div className="admin__row">
            <input
              placeholder={vLabel}
              value={v}
              onChange={(e) => set(i, 1, e.target.value)}
              style={{ flex: 1, border: '1.5px solid var(--line)', borderRadius: 10, padding: '10px 14px', fontSize: 14, outline: 'none' }}
            />
            <button type="button" className="admin__iconbtn danger" onClick={() => remove(i)} title="حذف">
              ✕
            </button>
          </div>
        </div>
      ))}
      <button type="button" className="btn btn--outline btn--sm" style={{ justifySelf: 'start' }} onClick={() => onChange([...items, ['', '']])}>
        + افزودن ردیف
      </button>
    </div>
  );
}

/* ---------------- rich text editor (links / images / videos) ---------------- */
export function RichEditor({ value, onChange }) {
  const ref = useRef(null);
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current && ref.current) {
      ref.current.innerHTML = sanitizeHtml(value);
      mounted.current = true;
    }
  }, [value]);

  const exec = (cmd, arg = null) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    emit();
  };

  const emit = () => onChange(ref.current ? ref.current.innerHTML : value);

  const addLink = () => {
    const url = window.prompt('نشانی پیوند (https:// یا / یا mailto: یا tel:):', 'https://');
    if (!url) return;
    exec('createLink', url);
  };

  const insertMedia = (url, kind) => {
    ref.current?.focus();
    if (kind === 'image') document.execCommand('insertHTML', false, `<img src="${url}" alt="" />`);
    else document.execCommand('insertHTML', false, `<video src="${url}" controls preload="metadata"></video>`);
    emit();
  };

  const B = ({ onClick, children, title }) => (
    <button type="button" title={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {children}
    </button>
  );

  return (
    <div className="rte">
      <div className="rte__bar">
        <B title="سرتیتر" onClick={() => exec('formatBlock', '<h2>')}>H2</B>
        <B title="زیرسرتیتر" onClick={() => exec('formatBlock', '<h3>')}>H3</B>
        <B title="پاراگراف" onClick={() => exec('formatBlock', '<p>')}>P</B>
        <B title="درشت" onClick={() => exec('bold')}>
          <b>B</b>
        </B>
        <B title="کج" onClick={() => exec('italic')}>
          <i>I</i>
        </B>
        <B title="فهرست نقطه‌ای" onClick={() => exec('insertUnorderedList')}>• list</B>
        <B title="فهرست شماره‌ای" onClick={() => exec('insertOrderedList')}>1. list</B>
        <B title="افزودن پیوند به متن انتخاب‌شده" onClick={addLink}>
          🔗 پیوند
        </B>
        <B title="حذف پیوند" onClick={() => exec('unlink')}>
          ⛓️‍💥 حذف پیوند
        </B>
        <UploadButton
          small
          label="📷 تصویر"
          accept="image/*"
          onUploaded={(url) => insertMedia(url, 'image')}
        />
        <UploadButton
          small
          label="🎬 ویدیو"
          accept="video/mp4,video/webm"
          onUploaded={(url) => insertMedia(url, 'video')}
        />
      </div>
      <div ref={ref} className="rte__area" contentEditable suppressContentEditableWarning onInput={emit} onBlur={emit} />
      <div className="rte__hint">
        برای افزودن پیوند، ابتدا متن را انتخاب کنید سپس دکمه «پیوند» را بزنید. استایل و کد HTML دلخواه پذیرفته
        نمی‌شود؛ فقط ساختار متن، پیوند، تصویر و ویدیو ذخیره می‌گردد.
      </div>
    </div>
  );
}
