import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Maximize2,
  Minimize2,
  Palette,
  Quote,
  Redo2,
  RemoveFormatting,
  Table2,
  Underline as UnderlineIcon,
  Undo2,
  X,
} from 'lucide-react';
import { Icons } from '../components/ui';
import { api } from '../content/ContentContext';
import { RICH_TEXT_COLOR_IDS, RICH_TEXT_TABLE_LIMITS, sanitizeHtml } from '../content/sanitize';
import {
  cleanProductImageUrl,
  isAllowedProductImageUrl,
  MAX_PRODUCT_IMAGES,
} from '../../shared/productImages.js';
import { canonicalVideoEmbedUrl, getVideoEmbedProvider } from '../../shared/videoEmbeds.js';

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
/* bytes → «۲۱۰ کیلوبایت» / «۳٫۸ مگابایت» */
const kb = (n) =>
  n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toLocaleString('fa-IR', { maximumFractionDigits: 1 })} مگابایت`
    : `${Math.round(n / 1024).toLocaleString('fa-IR')} کیلوبایت`;

async function uploadAdminAsset(file) {
  const fd = new FormData();
  fd.append('file', file);
  return api('/api/upload', { method: 'POST', formData: fd, auth: true });
}

export function UploadButton({ onUploaded, onBusyChange, disabled = false, accept = 'image/*,video/mp4,video/webm', label = 'بارگذاری فایل', icon = 'upload', small = false }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const UploadIcon = Icons[icon] || Icons.upload;
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');

  const pick = async (file) => {
    if (disabled || busy) return;
    setBusy(true);
    onBusyChange?.(true);
    setErr('');
    setNote('');
    try {
      const res = await uploadAdminAsset(file);
      onUploaded(res.url);
      /* Say what happened to the file. The server shrinks photos on upload,
         and silent processing is the kind of thing that makes someone think
         the panel mangled their picture. */
      if (res.optimised && res.originalBytes > res.bytes) {
        setNote(`بهینه شد: ${kb(res.originalBytes)} ← ${kb(res.bytes)}`);
      } else {
        setNote('بارگذاری شد');
      }
    } catch (e) {
      setErr('بارگذاری ممکن نشد');
    } finally {
      setBusy(false);
      onBusyChange?.(false);
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
        disabled={disabled || busy}
        onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])}
      />
      <button type="button" className={`btn btn--outline ${small ? 'btn--sm' : ''}`} onClick={() => ref.current?.click()} disabled={disabled || busy}>
        <UploadIcon size={16} />
        {busy ? 'در حال بارگذاری…' : label}
      </button>
      {err && <small style={{ color: 'var(--crimson-ink)' }}>{err}</small>}
      {!err && note && <small style={{ color: 'var(--muted)' }}>{note}</small>}
    </>
  );
}

/* ---------------- ordered product gallery ---------------- */
export function ProductImagesEditor({ images = [], onChange, onBusyChange, trustedOrigins = [], max = MAX_PRODUCT_IMAGES }) {
  const picker = useRef(null);
  const mounted = useRef(true);
  const urlId = useId();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const items = Array.isArray(images) ? images.slice(0, max) : [];

  useEffect(() => {
    /* React Strict Mode mounts, cleans up, and mounts effects again in
       development. Reset the flag in setup so that rehearsal cannot make a
       live editor ignore every completed upload. */
    mounted.current = true;
    return () => {
      mounted.current = false;
      onBusyChange?.(false);
    };
  }, []);

  const commit = (next) => onChange(next.slice(0, max));
  const clearNotice = () => {
    setMessage('');
    setError('');
  };

  const addUrl = () => {
    clearNotice();
    const clean = cleanProductImageUrl(url);
    if (!clean) {
      setError('نشانی معتبر نیست. فقط مسیر داخلی امن یا نشانی کامل HTTPS بدون اطلاعات ورود مجاز است.');
      return;
    }
    if (!isAllowedProductImageUrl(clean, trustedOrigins)) {
      setError('مبدأ این تصویر در سیاست امنیتی سایت مجاز نیست؛ تصویر را بارگذاری کنید یا از مبدأ HTTPS مورد اعتماد استفاده کنید.');
      return;
    }
    if (items.includes(clean)) {
      setError('این تصویر از قبل در گالری است.');
      return;
    }
    if (items.length >= max) {
      setError(`حداکثر ${max.toLocaleString('fa-IR')} تصویر مجاز است.`);
      return;
    }
    commit([...items, clean]);
    setUrl('');
    setMessage('تصویر به انتهای گالری افزوده شد.');
  };

  const uploadMany = async (fileList) => {
    const selected = Array.from(fileList || []);
    if (!selected.length) return;
    clearNotice();

    const slots = Math.max(0, max - items.length);
    if (!slots) {
      setError(`گالری به سقف ${max.toLocaleString('fa-IR')} تصویر رسیده است.`);
      if (picker.current) picker.current.value = '';
      return;
    }

    const files = selected.slice(0, slots);
    setBusy(true);
    onBusyChange?.(true);
    let next = [...items];
    let uploaded = 0;
    let failed = 0;
    try {
      /* The upload endpoint intentionally accepts one file per request so each
         photo passes through the existing validation and responsive optimiser. */
      for (const file of files) {
        try {
          const result = await uploadAdminAsset(file);
          const image = cleanProductImageUrl(result.url);
          if (image && !next.includes(image)) {
            next.push(image);
            uploaded += 1;
          }
        } catch {
          failed += 1;
        }
      }
      if (mounted.current) {
        if (uploaded) commit(next);
        if (uploaded) setMessage(`${uploaded.toLocaleString('fa-IR')} تصویر بارگذاری شد.`);
        if (selected.length > files.length) {
          setError(`${(selected.length - files.length).toLocaleString('fa-IR')} فایل به‌دلیل سقف گالری بارگذاری نشد.`);
        } else if (failed) {
          setError(`بارگذاری ${failed.toLocaleString('fa-IR')} تصویر ممکن نشد.`);
        }
      }
    } finally {
      if (mounted.current) {
        setBusy(false);
        onBusyChange?.(false);
        if (picker.current) picker.current.value = '';
      }
    }
  };

  const replace = (index, value) => commit(items.map((item, itemIndex) => (itemIndex === index ? value : item)));
  const remove = (index) => {
    clearNotice();
    commit(items.filter((_, itemIndex) => itemIndex !== index));
  };
  const move = (from, to) => {
    if (to < 0 || to >= items.length || from === to) return;
    clearNotice();
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    commit(next);
  };
  const makePrimary = (index) => move(index, 0);

  return (
    <section className="admin-product-gallery" aria-labelledby={`${urlId}-title`} aria-busy={busy}>
      <div className="admin-product-gallery__head">
        <div>
          <h3 id={`${urlId}-title`}>تصاویر محصول</h3>
          <p>تصویر اول، عکس اصلی کارت‌ها و نتایج جست‌وجو است. ترتیب این فهرست در صفحه محصول نمایش داده می‌شود.</p>
        </div>
        <span className="admin-product-gallery__count">
          {items.length.toLocaleString('fa-IR')} / {max.toLocaleString('fa-IR')}
        </span>
      </div>

      <div className="admin-product-gallery__add">
        <input
          ref={picker}
          className="admin-product-gallery__picker"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
          aria-label="انتخاب چند تصویر برای بارگذاری"
          tabIndex={-1}
          multiple
          onChange={(event) => uploadMany(event.target.files)}
        />
        <button
          type="button"
          className="btn btn--outline"
          onClick={() => picker.current?.click()}
          disabled={busy || items.length >= max}
        >
          <Icons.upload size={16} />
          {busy ? 'در حال بارگذاری تصاویر…' : 'انتخاب و بارگذاری چند تصویر'}
        </button>

        <div className="admin-product-gallery__url">
          <label htmlFor={urlId}>یا نشانی تصویر</label>
          <div>
            <input
              id={urlId}
              dir="ltr"
              inputMode="url"
              placeholder="/uploads/images/product.webp"
              value={url}
              disabled={busy || items.length >= max}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                addUrl();
              }}
            />
            <button type="button" className="btn btn--outline btn--sm" onClick={addUrl} disabled={busy || items.length >= max || !url.trim()}>
              افزودن
            </button>
          </div>
        </div>
      </div>

      <div className="admin-product-gallery__status" aria-live="polite">
        {error ? <span className="is-error">{error}</span> : message ? <span>{message}</span> : null}
      </div>

      {items.length ? (
        <ol className="admin-product-gallery__list">
          {items.map((item, index) => {
            const preview = cleanProductImageUrl(item);
            return (
              <li className="admin-product-gallery__item" key={index}>
                <div className="admin-product-gallery__preview">
                  {preview ? <img src={preview} alt="" /> : <Icons.image size={26} aria-hidden="true" />}
                  {index === 0 && <span>تصویر اصلی</span>}
                </div>
                <label>
                  <span>نشانی تصویر {(index + 1).toLocaleString('fa-IR')}</span>
                  <input dir="ltr" value={item ?? ''} disabled={busy} onChange={(event) => replace(index, event.target.value)} />
                </label>
                <div className="admin-product-gallery__item-actions">
                  {index > 0 && (
                    <button type="button" className="admin-product-gallery__primary" onClick={() => makePrimary(index)} disabled={busy}>
                      انتخاب به‌عنوان اصلی
                    </button>
                  )}
                  <button
                    type="button"
                    className="admin__iconbtn"
                    title="انتقال به قبل"
                    aria-label={`انتقال تصویر ${index + 1} به قبل`}
                    onClick={() => move(index, index - 1)}
                    disabled={busy || index === 0}
                  >
                    <ArrowUp size={15} />
                  </button>
                  <button
                    type="button"
                    className="admin__iconbtn"
                    title="انتقال به بعد"
                    aria-label={`انتقال تصویر ${index + 1} به بعد`}
                    onClick={() => move(index, index + 1)}
                    disabled={busy || index === items.length - 1}
                  >
                    <ArrowDown size={15} />
                  </button>
                  <button
                    type="button"
                    className="admin__iconbtn danger"
                    title="حذف تصویر"
                    aria-label={`حذف تصویر ${index + 1}`}
                    onClick={() => remove(index)}
                    disabled={busy}
                  >
                    <Icons.trash size={15} />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="admin-product-gallery__empty">هنوز تصویری انتخاب نشده است.</p>
      )}
    </section>
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
            <Icons.trash size={15} />
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
              <Icons.trash size={15} />
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

/* -------- rich text editor (formatting / tables / links / media) -------- */
const EMPTY_FORMATS = {
  bold: false,
  italic: false,
  underline: false,
  unordered: false,
  ordered: false,
  link: false,
  table: false,
  color: '',
  block: 'p',
};

const RICH_TEXT_COLORS = Object.freeze([
  { id: 'ink', label: 'متن اصلی', hex: '#1b1114' },
  { id: 'crimson', label: 'زرشکی', hex: '#c01034' },
  { id: 'blue', label: 'آبی', hex: '#145da0' },
  { id: 'green', label: 'سبز', hex: '#187a3c' },
  { id: 'amber', label: 'کهربایی', hex: '#805400' },
  { id: 'purple', label: 'بنفش', hex: '#6d3fa3' },
].filter((color) => RICH_TEXT_COLOR_IDS.includes(color.id)));
const {
  minRows: MIN_RICH_TABLE_ROWS,
  maxRows: MAX_RICH_TABLE_ROWS,
  minColumns: MIN_RICH_TABLE_COLUMNS,
  maxColumns: MAX_RICH_TABLE_COLUMNS,
  maxCaptionLength: MAX_RICH_TABLE_CAPTION,
} = RICH_TEXT_TABLE_LIMITS;

const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

function closestInside(node, selector, root) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  const match = element?.closest?.(selector);
  return match && root?.contains(match) ? match : null;
}

function dialogTitleId(id) {
  return `editor-dialog-${id.replaceAll(':', '')}`;
}

function EditorDialog({ title, onClose, children, wide = false }) {
  const id = dialogTitleId(useId());
  const panelRef = useRef(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const handleKeys = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(panelRef.current?.querySelectorAll(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      ) || []).filter((element) => !element.hidden && element.getClientRects().length);
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
    document.addEventListener('keydown', handleKeys);
    return () => document.removeEventListener('keydown', handleKeys);
  }, [onClose]);

  return (
    <div className="rte-dialog__backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={panelRef} className={`rte-dialog${wide ? ' rte-dialog--wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id}>
        <header className="rte-dialog__header">
          <h3 id={id}>{title}</h3>
          <button type="button" className="rte-dialog__close" onClick={onClose} aria-label="بستن پنجره">
            <X size={18} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function textStatistics(html) {
  if (typeof document === 'undefined') return { words: 0, characters: 0 };
  const holder = document.createElement('div');
  holder.innerHTML = html || '';
  holder.querySelectorAll('p,h2,h3,h4,li,blockquote,figcaption,caption,th,td,br').forEach((element) => element.append(' '));
  const text = (holder.textContent || '').replace(/\s+/g, ' ').trim();
  return {
    words: text ? text.split(' ').length : 0,
    characters: Array.from(text).length,
  };
}

function safeMediaSource(kind, url) {
  if (typeof document === 'undefined' || !url) return null;
  const holder = document.createElement('div');

  if (kind === 'video') {
    const provider = getVideoEmbedProvider(url);
    const embedUrl = canonicalVideoEmbedUrl(url);
    if (provider && !embedUrl) return null;
    if (embedUrl) {
      holder.innerHTML = sanitizeHtml(
        `<iframe src="${escapeHtml(embedUrl)}" title="Video preview"></iframe>`,
      );
      const src = holder.querySelector('iframe[src]')?.getAttribute('src');
      return src ? { type: 'embed', url: src } : null;
    }
  }

  const candidate = kind === 'image'
    ? `<img src="${escapeHtml(url)}" alt="">`
    : `<video src="${escapeHtml(url)}" controls></video>`;
  holder.innerHTML = sanitizeHtml(candidate);
  const media = holder.querySelector(kind === 'image' ? 'img[src]' : 'video[src]');
  const src = media?.getAttribute('src');
  return src ? { type: kind === 'image' ? 'image' : 'video', url: src } : null;
}

function plainTextMarkup(text) {
  const clean = String(text || '').replace(/\r\n?/g, '\n');
  return clean
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`)
    .join('');
}

function normalizedCssColor(value) {
  if (typeof document === 'undefined' || !value) return '';
  const probe = document.createElement('span');
  probe.style.color = String(value);
  return probe.style.color.toLowerCase().replaceAll(/\s+/g, '');
}

function richTextColorId(value) {
  const normalized = normalizedCssColor(value);
  return RICH_TEXT_COLORS.find((color) => normalizedCssColor(color.hex) === normalized)?.id || '';
}

function removeBrowserFormattingArtifacts(root) {
  if (!root) return;

  /* execCommand still has the best cross-browser range splitting, but engines
     emit either <span style="color:…"> or the old <font color="…">. Convert
     only our fixed palette to semantic attributes before stripping every
     browser/paste styling hook. */
  root.querySelectorAll('font').forEach((element) => {
    const color = richTextColorId(element.getAttribute('color'));
    if (!color) {
      element.replaceWith(...element.childNodes);
      return;
    }
    const span = document.createElement('span');
    span.setAttribute('data-text-color', color);
    span.append(...element.childNodes);
    element.replaceWith(span);
  });

  root.querySelectorAll('[style],[class]').forEach((element) => {
    const color = richTextColorId(element.style?.color);
    element.removeAttribute('style');
    element.removeAttribute('class');
    if (!color) return;
    if (element.tagName === 'SPAN') {
      element.setAttribute('data-text-color', color);
      return;
    }
    if (['BR', 'IMG', 'VIDEO', 'SOURCE', 'FIGURE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'UL', 'OL'].includes(element.tagName)) return;
    const span = document.createElement('span');
    span.setAttribute('data-text-color', color);
    span.append(...element.childNodes);
    element.append(span);
  });

  root.querySelectorAll('span').forEach((element) => {
    const color = String(element.getAttribute('data-text-color') || '').toLowerCase();
    for (const attribute of Array.from(element.attributes)) element.removeAttribute(attribute.name);
    if (RICH_TEXT_COLOR_IDS.includes(color)) {
      element.setAttribute('data-text-color', color);
    } else {
      element.replaceWith(...element.childNodes);
    }
  });
}

function readRichTable(table) {
  const matrix = Array.from(table?.rows || []).map((row) => (
    Array.from(row.cells || []).map((cell) => cell.innerHTML)
  ));
  const columns = Math.max(MIN_RICH_TABLE_COLUMNS, ...matrix.map((row) => row.length));
  return {
    rows: Math.min(MAX_RICH_TABLE_ROWS, Math.max(MIN_RICH_TABLE_ROWS, matrix.length)),
    columns: Math.min(MAX_RICH_TABLE_COLUMNS, columns),
    caption: table?.caption?.textContent?.trim() || '',
    matrix,
  };
}

function richTableMarkup({ rows, columns, caption, matrix = [] }) {
  const body = Array.from({ length: rows }, (_, rowIndex) => {
    const cells = Array.from({ length: columns }, (_, columnIndex) => {
      const existing = sanitizeHtml(matrix[rowIndex]?.[columnIndex] || '');
      const fallback = rowIndex === 0
        ? `عنوان ${new Intl.NumberFormat('fa-IR').format(columnIndex + 1)}`
        : '&nbsp;';
      const content = existing || fallback;
      return rowIndex === 0
        ? `<th scope="col">${content}</th>`
        : `<td>${content}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  });
  const head = body.shift();
  return `<figure data-rich-table><table><caption>${escapeHtml(caption)}</caption>` +
    `<thead>${head}</thead><tbody>${body.join('')}</tbody></table></figure>`;
}

export function RichEditor({
  value = '',
  onChange,
  placeholder = 'متن خود را اینجا بنویسید…',
  label = 'ویرایشگر متن',
}) {
  const ref = useRef(null);
  const mounted = useRef(false);
  const lastEmitted = useRef(null);
  const savedRange = useRef(null);
  const hintId = `rte-hint-${useId().replaceAll(':', '')}`;
  const [html, setHtml] = useState('');
  const [formats, setFormats] = useState(EMPTY_FORMATS);
  const [preview, setPreview] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState('');
  const [linkDialog, setLinkDialog] = useState(null);
  const [mediaDialog, setMediaDialog] = useState(null);
  const [tableDialog, setTableDialog] = useState(null);

  const safePreview = useMemo(() => (preview ? sanitizeHtml(html) : ''), [html, preview]);
  const stats = useMemo(() => textStatistics(html), [html]);
  const mediaPreview = useMemo(
    () => safeMediaSource(mediaDialog?.kind, mediaDialog?.url),
    [mediaDialog?.kind, mediaDialog?.url],
  );

  useEffect(() => {
    if (!ref.current) return;
    const clean = sanitizeHtml(value || '');
    if (!mounted.current) {
      ref.current.innerHTML = clean;
      setHtml(clean);
      mounted.current = true;
      return;
    }
    if (String(value ?? '') !== lastEmitted.current && document.activeElement !== ref.current) {
      ref.current.innerHTML = clean;
      setHtml(clean);
    }
  }, [value]);

  useEffect(() => {
    if (!fullscreen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [fullscreen]);

  useEffect(() => {
    const leaveFullscreen = (event) => {
      if (event.key === 'Escape' && fullscreen && !linkDialog && !mediaDialog && !tableDialog) setFullscreen(false);
    };
    document.addEventListener('keydown', leaveFullscreen);
    return () => document.removeEventListener('keydown', leaveFullscreen);
  }, [fullscreen, linkDialog, mediaDialog, tableDialog]);

  const publish = (next = ref.current?.innerHTML || '') => {
    setHtml(next);
    lastEmitted.current = next;
    onChange(next);
  };

  const rememberSelection = () => {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !ref.current) return false;
    const range = selection.getRangeAt(0);
    if (!ref.current.contains(range.commonAncestorContainer)) return false;
    savedRange.current = range.cloneRange();
    return true;
  };

  const restoreSelection = () => {
    const root = ref.current;
    if (!root) return null;
    let range = savedRange.current;
    if (!range || !root.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(root);
      range.collapse(false);
      savedRange.current = range.cloneRange();
    }
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    root.focus();
    return range;
  };

  const contextElement = () => {
    const root = ref.current;
    const selection = window.getSelection();
    let range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || !root?.contains(range.commonAncestorContainer)) range = savedRange.current;
    if (!range || !root?.contains(range.commonAncestorContainer)) return null;
    return range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
  };

  const refreshFormats = () => {
    if (!ref.current) return;
    const element = contextElement();
    if (!element) return;
    const block = closestInside(element, 'h2,h3,h4,blockquote,p,li', ref.current);
    const blockName = block && ['H2', 'H3', 'H4', 'BLOCKQUOTE'].includes(block.tagName)
      ? block.tagName.toLowerCase()
      : 'p';
    const commandState = (command) => {
      try {
        return Boolean(document.queryCommandState?.(command));
      } catch {
        return false;
      }
    };
    const color = closestInside(element, 'span[data-text-color]', ref.current)
      ?.getAttribute('data-text-color') || '';
    setFormats({
      bold: commandState('bold') || Boolean(closestInside(element, 'strong,b', ref.current)),
      italic: commandState('italic') || Boolean(closestInside(element, 'em,i', ref.current)),
      underline: commandState('underline') || Boolean(closestInside(element, 'u', ref.current)),
      unordered: commandState('insertUnorderedList') || Boolean(closestInside(element, 'ul', ref.current)),
      ordered: commandState('insertOrderedList') || Boolean(closestInside(element, 'ol', ref.current)),
      link: Boolean(closestInside(element, 'a', ref.current)),
      table: Boolean(closestInside(element, 'table', ref.current)),
      color: RICH_TEXT_COLOR_IDS.includes(color) ? color : '',
      block: blockName,
    });
  };

  useEffect(() => {
    const track = () => {
      if (rememberSelection()) refreshFormats();
    };
    document.addEventListener('selectionchange', track);
    return () => document.removeEventListener('selectionchange', track);
  }, []);

  const exec = (command, argument = null) => {
    restoreSelection();
    document.execCommand(command, false, argument);
    rememberSelection();
    publish();
    refreshFormats();
  };

  const applyTextColor = (colorId) => {
    const color = RICH_TEXT_COLORS.find((item) => item.id === colorId);
    const range = restoreSelection();
    if (!color || !range || range.collapsed) {
      setNotice('برای تغییر رنگ، ابتدا بخشی از متن را انتخاب کنید.');
      refreshFormats();
      return;
    }
    let applied = false;
    try {
      document.execCommand('styleWithCSS', false, true);
      applied = document.execCommand('foreColor', false, color.hex);
    } finally {
      try { document.execCommand('styleWithCSS', false, false); } catch {}
    }
    if (!applied) {
      setNotice('مرورگر نتوانست رنگ انتخاب‌شده را اعمال کند.');
      return;
    }
    removeBrowserFormattingArtifacts(ref.current);
    rememberSelection();
    publish();
    refreshFormats();
    setNotice(`رنگ «${color.label}» اعمال شد.`);
  };

  const insertHtml = (markup) => {
    const range = restoreSelection();
    const markerId = `rte-cursor-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const markedUp = `${markup}<span id="${markerId}">&#8288;</span>`;
    let inserted = false;
    try {
      /* A temporary marker makes the post-insert caret deterministic. Without
         it Chromium can leave the caret inside a newly inserted figure, so
         the next paragraph becomes part of its caption. */
      document.execCommand('styleWithCSS', false, false);
      inserted = document.execCommand('insertHTML', false, markedUp);
    } catch {
      inserted = false;
    }
    if (inserted) {
      const marker = ref.current?.querySelector(`#${markerId}`);
      if (marker?.parentNode) {
        const cursor = document.createRange();
        cursor.setStart(marker.parentNode, Array.prototype.indexOf.call(marker.parentNode.childNodes, marker));
        cursor.collapse(true);
        marker.remove();
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(cursor);
      }
    } else if (range) {
      const template = document.createElement('template');
      template.innerHTML = markup;
      const fragment = template.content;
      const last = fragment.lastChild;
      range.deleteContents();
      range.insertNode(fragment);
      if (last) {
        range.setStartAfter(last);
        range.collapse(true);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    /* insertHTML may copy the editor's computed colour/font size into inline
       spans even though the supplied fragment is clean. Remove those browser
       artifacts so pasted content stays as strict as the sanitizer output. */
    removeBrowserFormattingArtifacts(ref.current);
    rememberSelection();
    publish();
    refreshFormats();
  };

  const closeLinkDialog = () => {
    setLinkDialog(null);
    requestAnimationFrame(() => {
      restoreSelection();
      refreshFormats();
    });
  };

  const closeMediaDialog = () => {
    setMediaDialog(null);
    requestAnimationFrame(() => {
      restoreSelection();
      refreshFormats();
    });
  };

  const closeTableDialog = () => {
    setTableDialog(null);
    requestAnimationFrame(() => {
      restoreSelection();
      refreshFormats();
    });
  };

  const openTableDialog = () => {
    rememberSelection();
    const table = closestInside(contextElement(), 'table', ref.current);
    if (table) {
      const target = table.closest('figure[data-rich-table]') || table;
      const range = document.createRange();
      range.selectNode(target);
      savedRange.current = range;
      setTableDialog({ editing: true, ...readRichTable(table), error: '' });
      return;
    }
    setTableDialog({
      editing: false,
      rows: 4,
      columns: 3,
      caption: '',
      matrix: [],
      error: '',
    });
  };

  const submitTable = (event) => {
    event.preventDefault();
    const rows = Number(tableDialog.rows);
    const columns = Number(tableDialog.columns);
    const caption = tableDialog.caption.trim();
    if (!Number.isInteger(rows) || rows < MIN_RICH_TABLE_ROWS || rows > MAX_RICH_TABLE_ROWS) {
      setTableDialog((current) => ({ ...current, error: `تعداد ردیف باید بین ${MIN_RICH_TABLE_ROWS.toLocaleString('fa-IR')} و ${MAX_RICH_TABLE_ROWS.toLocaleString('fa-IR')} باشد.` }));
      return;
    }
    if (!Number.isInteger(columns) || columns < MIN_RICH_TABLE_COLUMNS || columns > MAX_RICH_TABLE_COLUMNS) {
      setTableDialog((current) => ({ ...current, error: `تعداد ستون باید بین ${MIN_RICH_TABLE_COLUMNS.toLocaleString('fa-IR')} و ${MAX_RICH_TABLE_COLUMNS.toLocaleString('fa-IR')} باشد.` }));
      return;
    }
    if (!caption || Array.from(caption).length > MAX_RICH_TABLE_CAPTION) {
      setTableDialog((current) => ({ ...current, error: `یک عنوان روشن و حداکثر ${MAX_RICH_TABLE_CAPTION.toLocaleString('fa-IR')} نویسه‌ای برای جدول وارد کنید.` }));
      return;
    }
    const markup = sanitizeHtml(richTableMarkup({
      rows,
      columns,
      caption,
      matrix: tableDialog.matrix,
    }));
    const holder = document.createElement('div');
    holder.innerHTML = markup;
    if (!holder.querySelector('figure[data-rich-table] table > thead th[scope="col"]')) {
      setTableDialog((current) => ({ ...current, error: 'ساختار جدول معتبر نیست.' }));
      return;
    }
    const wasEditing = tableDialog.editing;
    setTableDialog(null);
    insertHtml(markup);
    setNotice(wasEditing ? 'جدول به‌روزرسانی شد.' : 'جدول افزوده شد؛ متن سلول‌ها را مستقیم ویرایش کنید.');
  };

  const deleteTable = () => {
    if (!tableDialog?.editing) return;
    if (!window.confirm('این جدول و همه محتوای سلول‌های آن حذف شود؟')) return;
    setTableDialog(null);
    insertHtml('<p><br></p>');
    setNotice('جدول حذف شد.');
  };

  const openLinkDialog = () => {
    rememberSelection();
    const element = contextElement();
    const link = closestInside(element, 'a', ref.current);
    if (link) {
      const range = document.createRange();
      range.selectNode(link);
      savedRange.current = range;
    }
    const selectedText = link?.textContent || savedRange.current?.toString() || '';
    setLinkDialog({
      editing: Boolean(link),
      text: selectedText,
      url: link?.getAttribute('href') || 'https://',
      title: link?.getAttribute('title') || '',
      error: '',
    });
  };

  const submitLink = (event) => {
    event.preventDefault();
    const text = linkDialog.text.trim();
    const url = linkDialog.url.trim();
    if (!text || !url) {
      setLinkDialog((current) => ({ ...current, error: 'متن و نشانی پیوند را وارد کنید.' }));
      return;
    }
    const markup = sanitizeHtml(
      `<a href="${escapeHtml(url)}" title="${escapeHtml(linkDialog.title.trim())}">${escapeHtml(text)}</a>`,
    );
    const holder = document.createElement('div');
    holder.innerHTML = markup;
    if (!holder.querySelector('a[href]')) {
      setLinkDialog((current) => ({ ...current, error: 'این نشانی ایمن یا معتبر نیست.' }));
      return;
    }
    setLinkDialog(null);
    insertHtml(markup);
    setNotice(linkDialog.editing ? 'پیوند به‌روزرسانی شد.' : 'پیوند افزوده شد.');
  };

  const unlink = () => {
    restoreSelection();
    const element = contextElement();
    const link = closestInside(element, 'a', ref.current);
    if (link) {
      const range = document.createRange();
      range.selectNodeContents(link);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    document.execCommand('unlink', false);
    rememberSelection();
    publish();
    refreshFormats();
    setNotice('پیوند حذف شد.');
  };

  const openMediaDialog = (kind) => {
    rememberSelection();
    setMediaDialog({ kind, url: '', alt: '', caption: '', editing: false, error: '' });
  };

  const editMedia = (event) => {
    const media = event.target.closest?.('img,video,iframe');
    if (!media || !ref.current?.contains(media)) return;
    event.preventDefault();
    const figure = media.closest('figure');
    const target = figure && ref.current.contains(figure) ? figure : media;
    const range = document.createRange();
    range.selectNode(target);
    savedRange.current = range;
    setMediaDialog({
      kind: media.tagName === 'IMG' ? 'image' : 'video',
      url: media.getAttribute('src') || media.querySelector('source')?.getAttribute('src') || '',
      alt: media.getAttribute('alt') || '',
      caption: figure?.querySelector('figcaption')?.textContent || '',
      editing: true,
      error: '',
    });
  };

  const submitMedia = (event) => {
    event.preventDefault();
    const url = mediaDialog.url.trim();
    if (!url) {
      setMediaDialog((current) => ({ ...current, error: 'نشانی فایل را وارد یا فایل را بارگذاری کنید.' }));
      return;
    }

    const captionText = mediaDialog.caption.trim();
    let media;
    if (mediaDialog.kind === 'image') {
      media = `<img src="${escapeHtml(url)}" alt="${escapeHtml(mediaDialog.alt.trim())}">`;
    } else {
      const provider = getVideoEmbedProvider(url);
      const embedUrl = canonicalVideoEmbedUrl(url);
      if (provider && !embedUrl) {
        setMediaDialog((current) => ({
          ...current,
          error: 'پیوند امن و معتبر HTTPS از YouTube، Aparat یا Vimeo وارد کنید.',
        }));
        return;
      }
      media = embedUrl
        ? `<iframe src="${escapeHtml(embedUrl)}" title="${escapeHtml(captionText || 'پخش‌کننده ویدیو')}"></iframe>`
        : `<video src="${escapeHtml(url)}" controls preload="metadata"></video>`;
    }

    const caption = captionText ? `<figcaption>${escapeHtml(captionText)}</figcaption>` : '';
    const markup = sanitizeHtml(`<figure>${media}${caption}</figure>`);
    const holder = document.createElement('div');
    holder.innerHTML = markup;
    const valid = holder.querySelector(
      mediaDialog.kind === 'image' ? 'img[src]' : 'video[src],iframe[src]',
    );
    if (!valid) {
      setMediaDialog((current) => ({ ...current, error: 'نشانی فایل ایمن یا معتبر نیست.' }));
      return;
    }
    const wasEditing = mediaDialog.editing;
    setMediaDialog(null);
    insertHtml(markup);
    setNotice(wasEditing ? 'رسانه به‌روزرسانی شد.' : 'رسانه افزوده شد.');
  };

  const prepareMediaFile = async (file) => {
    const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : '';
    if (!kind) {
      setNotice('فقط فایل تصویر یا ویدیوی پشتیبانی‌شده را انتخاب کنید.');
      return;
    }
    setUploading(true);
    setNotice('در حال بارگذاری فایل…');
    try {
      const result = await uploadAdminAsset(file);
      setMediaDialog({
        kind,
        url: result.url,
        alt: kind === 'image' ? file.name.replace(/\.[^.]+$/, '').replaceAll(/[-_]+/g, ' ') : '',
        caption: '',
        editing: false,
        error: '',
      });
      setNotice(result.optimised && result.originalBytes > result.bytes ? 'تصویر بارگذاری و بهینه شد.' : 'فایل بارگذاری شد.');
    } catch {
      setNotice('بارگذاری فایل انجام نشد. دوباره تلاش کنید.');
    } finally {
      setUploading(false);
    }
  };

  const handlePaste = (event) => {
    rememberSelection();
    const fileItem = Array.from(event.clipboardData?.items || []).find(
      (item) => item.kind === 'file' && /^(image|video)\//.test(item.type),
    );
    if (fileItem) {
      event.preventDefault();
      const file = fileItem.getAsFile();
      if (file) prepareMediaFile(file);
      return;
    }
    const rich = event.clipboardData?.getData('text/html');
    const text = event.clipboardData?.getData('text/plain') || '';
    event.preventDefault();
    const cleaned = sanitizeHtml(rich || plainTextMarkup(text));
    if (!cleaned && (rich || text)) {
      setNotice('محتوای چسبانده‌شده قابل استفاده نبود.');
      return;
    }
    insertHtml(cleaned);
    setNotice(rich ? 'قالب‌بندی ناسازگار هنگام چسباندن پاک شد.' : 'متن چسبانده شد.');
  };

  const handleDrop = (event) => {
    const file = event.dataTransfer?.files?.[0];
    setDragging(false);
    if (!file) return;
    event.preventDefault();
    const pointRange = document.caretRangeFromPoint?.(event.clientX, event.clientY);
    if (pointRange && ref.current?.contains(pointRange.commonAncestorContainer)) savedRange.current = pointRange.cloneRange();
    else rememberSelection();
    prepareMediaFile(file);
  };

  const handleInput = () => {
    setNotice('');
    removeBrowserFormattingArtifacts(ref.current);
    rememberSelection();
    publish();
    refreshFormats();
  };

  const ToolButton = ({ title, onClick, active, children, disabled = false, className = '' }) => (
    <button
      type="button"
      className={`${active ? 'is-active ' : ''}${className}`.trim()}
      title={title}
      aria-label={title}
      aria-pressed={typeof active === 'boolean' ? active : undefined}
      disabled={disabled || preview}
      onMouseDown={(event) => {
        event.preventDefault();
        rememberSelection();
      }}
      onClick={onClick}
    >
      {children}
    </button>
  );

  const blockValue = ['h2', 'h3', 'h4', 'p'].includes(formats.block) ? formats.block : 'p';

  return (
    <>
      <div className={`rte${fullscreen ? ' is-fullscreen' : ''}${dragging ? ' is-dragging' : ''}`} role="region" aria-label={label}>
        <div className="rte__bar" role="toolbar" aria-label="ابزارهای قالب‌بندی متن">
          <div className="rte__group rte__group--history" aria-label="تاریخچه ویرایش">
            <ToolButton title="واگرد (Ctrl+Z)" onClick={() => exec('undo')}><Undo2 size={16} /></ToolButton>
            <ToolButton title="از نو (Ctrl+Shift+Z)" onClick={() => exec('redo')}><Redo2 size={16} /></ToolButton>
          </div>

          <div className="rte__group" aria-label="ساختار متن">
            <select
              aria-label="نوع پاراگراف"
              title="نوع پاراگراف"
              value={blockValue}
              disabled={preview}
              onMouseDown={rememberSelection}
              onChange={(event) => exec('formatBlock', event.target.value)}
            >
              <option value="p">پاراگراف</option>
              <option value="h2">عنوان ۲</option>
              <option value="h3">عنوان ۳</option>
              <option value="h4">عنوان ۴</option>
            </select>
            <ToolButton title="نقل‌قول" active={formats.block === 'blockquote'} onClick={() => exec('formatBlock', formats.block === 'blockquote' ? 'p' : 'blockquote')}>
              <Quote size={16} />
            </ToolButton>
          </div>

          <div className="rte__group" aria-label="قالب‌بندی نویسه">
            <ToolButton title="درشت (Ctrl+B)" active={formats.bold} onClick={() => exec('bold')}><Icons.bold size={16} /></ToolButton>
            <ToolButton title="کج (Ctrl+I)" active={formats.italic} onClick={() => exec('italic')}><Icons.italic size={16} /></ToolButton>
            <ToolButton title="زیرخط (Ctrl+U)" active={formats.underline} onClick={() => exec('underline')}><UnderlineIcon size={16} /></ToolButton>
            <label className="rte__color-select" title="رنگ متن">
              <Palette size={15} aria-hidden="true" />
              <span className="sr-only">رنگ متن</span>
              <select
                aria-label="رنگ متن"
                value={formats.color}
                disabled={preview}
                onMouseDown={rememberSelection}
                onChange={(event) => applyTextColor(event.target.value)}
              >
                <option value="" disabled>رنگ متن</option>
                {RICH_TEXT_COLORS.map((color) => (
                  <option key={color.id} value={color.id}>● {color.label}</option>
                ))}
              </select>
            </label>
            <ToolButton title="پاک‌کردن قالب‌بندی" onClick={() => exec('removeFormat')}><RemoveFormatting size={16} /></ToolButton>
          </div>

          <div className="rte__group" aria-label="فهرست‌ها">
            <ToolButton title="فهرست نقطه‌ای" active={formats.unordered} onClick={() => exec('insertUnorderedList')}><Icons.list size={16} /></ToolButton>
            <ToolButton title="فهرست شماره‌ای" active={formats.ordered} onClick={() => exec('insertOrderedList')}><Icons.listOrdered size={16} /></ToolButton>
          </div>

          <div className="rte__group" aria-label="جدول">
            <ToolButton title="افزودن یا ویرایش جدول" active={formats.table} onClick={openTableDialog}>
              <Table2 size={16} /><span className="rte__button-text">جدول</span>
            </ToolButton>
          </div>

          <div className="rte__group" aria-label="پیوند و رسانه">
            <ToolButton title="افزودن یا ویرایش پیوند (Ctrl+K)" active={formats.link} onClick={openLinkDialog}>
              <Icons.link size={16} /><span className="rte__button-text">پیوند</span>
            </ToolButton>
            <ToolButton title="حذف پیوند" onClick={unlink}><Icons.unlink size={16} /></ToolButton>
            <ToolButton title="افزودن تصویر" onClick={() => openMediaDialog('image')}><Icons.image size={16} /><span className="rte__button-text">تصویر</span></ToolButton>
            <ToolButton title="افزودن ویدیو" onClick={() => openMediaDialog('video')}><Icons.video size={16} /><span className="rte__button-text">ویدیو</span></ToolButton>
          </div>

          <div className="rte__group rte__group--view" aria-label="حالت نمایش">
            <button
              type="button"
              className={preview ? 'is-active' : ''}
              aria-pressed={preview}
              aria-label={preview ? 'بازگشت به ویرایش' : 'پیش‌نمایش امن'}
              onClick={() => setPreview((current) => !current)}
              title={preview ? 'بازگشت به ویرایش' : 'پیش‌نمایش امن'}
            >
              {preview ? <Icons.edit size={16} /> : <Icons.eye size={16} />}
              <span className="rte__button-text">{preview ? 'ویرایش' : 'پیش‌نمایش'}</span>
            </button>
            <button
              type="button"
              aria-pressed={fullscreen}
              aria-label={fullscreen ? 'خروج از تمام‌صفحه' : 'ویرایش تمام‌صفحه'}
              onClick={() => setFullscreen((current) => !current)}
              title={fullscreen ? 'خروج از تمام‌صفحه' : 'ویرایش تمام‌صفحه'}
            >
              {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          </div>
        </div>

        <div className="rte__canvas">
          <div
            ref={ref}
            className="rte__area"
            contentEditable="true"
            suppressContentEditableWarning
            role="textbox"
            aria-label={label}
            aria-multiline="true"
            aria-describedby={hintId}
            data-placeholder={placeholder}
            hidden={preview}
            spellCheck="true"
            onInput={handleInput}
            onBlur={() => publish()}
            onFocus={() => { rememberSelection(); refreshFormats(); }}
            onMouseUp={() => { rememberSelection(); refreshFormats(); }}
            onKeyUp={() => { rememberSelection(); refreshFormats(); }}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
                event.preventDefault();
                event.stopPropagation();
                rememberSelection();
                openLinkDialog();
              }
            }}
            onPaste={handlePaste}
            onDragEnter={(event) => {
              if (Array.from(event.dataTransfer?.types || []).includes('Files')) {
                event.preventDefault();
                setDragging(true);
              }
            }}
            onDragOver={(event) => {
              if (Array.from(event.dataTransfer?.types || []).includes('Files')) {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
              }
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
            }}
            onDrop={handleDrop}
            onDoubleClick={editMedia}
          />
          <div
            className="rte__area rte__preview"
            hidden={!preview}
            aria-label="پیش‌نمایش متن"
            onClick={(event) => event.target.closest?.('a') && event.preventDefault()}
          >
            {safePreview
              ? <div dangerouslySetInnerHTML={{ __html: safePreview }} />
              : <p className="rte__preview-empty">هنوز متنی برای پیش‌نمایش وجود ندارد.</p>}
          </div>
          {dragging && <div className="rte__drop-message"><Icons.upload size={24} />فایل را برای بارگذاری رها کنید</div>}
          {uploading && <div className="rte__uploading" role="status"><span className="spinner" />در حال بارگذاری فایل…</div>}
        </div>

        <div className="rte__status" id={hintId}>
          <span className="rte__status-message" role="status" aria-live="polite">
            {notice || (preview ? 'این پیش‌نمایش همان محتوای پاک‌سازی‌شده برای انتشار است.' : 'برای ویرایش جدول، داخل آن کلیک کنید و دکمه جدول را بزنید؛ فایل را نیز می‌توانید داخل متن رها کنید.')}
          </span>
          <span className="rte__stats" aria-label={`${stats.words} واژه و ${stats.characters} نویسه`}>
            {stats.words.toLocaleString('fa-IR')} واژه · {stats.characters.toLocaleString('fa-IR')} نویسه
          </span>
        </div>
      </div>

      {linkDialog && (
        <EditorDialog title={linkDialog.editing ? 'ویرایش پیوند' : 'افزودن پیوند'} onClose={closeLinkDialog}>
          <form className="rte-dialog__body" onSubmit={submitLink}>
            <label>
              <span>متن پیوند</span>
              <input autoFocus value={linkDialog.text} onChange={(event) => setLinkDialog((current) => ({ ...current, text: event.target.value, error: '' }))} />
            </label>
            <label>
              <span>نشانی پیوند</span>
              <input dir="ltr" inputMode="url" placeholder="https://example.com یا /products" value={linkDialog.url} onChange={(event) => setLinkDialog((current) => ({ ...current, url: event.target.value, error: '' }))} />
            </label>
            <label>
              <span>عنوان راهنما <small>(اختیاری)</small></span>
              <input value={linkDialog.title} onChange={(event) => setLinkDialog((current) => ({ ...current, title: event.target.value, error: '' }))} />
            </label>
            <p className="rte-dialog__help">پیوندهای بیرونی هنگام انتشار در زبانه تازه و به‌صورت ایمن باز می‌شوند.</p>
            {linkDialog.error && <p className="rte-dialog__error" role="alert">{linkDialog.error}</p>}
            <div className="rte-dialog__actions">
              <button type="button" className="btn btn--outline" onClick={closeLinkDialog}>انصراف</button>
              <button type="submit" className="btn btn--primary"><Check size={16} />{linkDialog.editing ? 'ذخیره تغییرات' : 'افزودن پیوند'}</button>
            </div>
          </form>
        </EditorDialog>
      )}

      {tableDialog && (
        <EditorDialog title={tableDialog.editing ? 'ویرایش جدول' : 'افزودن جدول'} onClose={closeTableDialog} wide>
          <form className="rte-dialog__body" onSubmit={submitTable}>
            <p className="rte-dialog__help">
              ردیف نخست همیشه عنوان ستون‌هاست. پس از افزودن، متن هر سلول را مستقیم داخل ویرایشگر تغییر دهید.
            </p>
            <div className="rte-dialog__table-grid">
              <label>
                <span>تعداد ردیف <small>(همراه ردیف عنوان)</small></span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={MIN_RICH_TABLE_ROWS}
                  max={MAX_RICH_TABLE_ROWS}
                  value={tableDialog.rows}
                  onChange={(event) => setTableDialog((current) => ({ ...current, rows: event.target.value, error: '' }))}
                />
              </label>
              <label>
                <span>تعداد ستون</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={MIN_RICH_TABLE_COLUMNS}
                  max={MAX_RICH_TABLE_COLUMNS}
                  value={tableDialog.columns}
                  onChange={(event) => setTableDialog((current) => ({ ...current, columns: event.target.value, error: '' }))}
                />
              </label>
            </div>
            <label>
              <span>عنوان جدول</span>
              <input
                autoFocus
                maxLength={MAX_RICH_TABLE_CAPTION}
                value={tableDialog.caption}
                onChange={(event) => setTableDialog((current) => ({ ...current, caption: event.target.value, error: '' }))}
                placeholder="برای نمونه: مشخصات فنی محصولات"
              />
              <small>عنوان برای خوانندگان صفحه و کاربران صفحه‌خوان نمایش داده می‌شود.</small>
            </label>
            {tableDialog.editing && (
              <p className="rte-dialog__help">کاهش تعداد ردیف یا ستون، سلول‌های خارج از اندازه جدید را حذف می‌کند.</p>
            )}
            {tableDialog.error && <p className="rte-dialog__error" role="alert">{tableDialog.error}</p>}
            <div className="rte-dialog__actions">
              {tableDialog.editing && (
                <button type="button" className="btn btn--outline rte-dialog__delete" onClick={deleteTable}>
                  <Icons.trash size={16} />حذف جدول
                </button>
              )}
              <button type="button" className="btn btn--outline" onClick={closeTableDialog}>انصراف</button>
              <button type="submit" className="btn btn--primary"><Check size={16} />{tableDialog.editing ? 'ذخیره تغییرات' : 'افزودن جدول'}</button>
            </div>
          </form>
        </EditorDialog>
      )}

      {mediaDialog && (
        <EditorDialog title={`${mediaDialog.editing ? 'ویرایش' : 'افزودن'} ${mediaDialog.kind === 'image' ? 'تصویر' : 'ویدیو'}`} onClose={closeMediaDialog} wide>
          <form className="rte-dialog__body" onSubmit={submitMedia}>
            <div className="rte-dialog__upload-row">
              <UploadButton
                small
                label={mediaDialog.kind === 'image' ? 'بارگذاری تصویر' : 'بارگذاری ویدیو'}
                icon={mediaDialog.kind === 'image' ? 'image' : 'video'}
                accept={mediaDialog.kind === 'image' ? 'image/*' : 'video/mp4,video/webm'}
                onUploaded={(url) => setMediaDialog((current) => ({ ...current, url, error: '' }))}
              />
              <span>یا نشانی فایل را وارد کنید</span>
            </div>
            <label>
              <span>نشانی {mediaDialog.kind === 'image' ? 'تصویر' : 'ویدیو'}</span>
              <input
                autoFocus
                dir="ltr"
                inputMode="url"
                placeholder={mediaDialog.kind === 'image'
                  ? 'https://… یا /uploads/…'
                  : 'YouTube، Aparat، Vimeo یا /uploads/video.mp4'}
                value={mediaDialog.url}
                onChange={(event) => setMediaDialog((current) => ({ ...current, url: event.target.value, error: '' }))}
              />
            </label>
            {mediaDialog.kind === 'video' && (
              <p className="rte-dialog__help">
                پیوندهای YouTube، Aparat و Vimeo به‌صورت امن تعبیه می‌شوند؛ بارگذاری فایل و نشانی مستقیم ویدیو نیز همچنان قابل استفاده است.
              </p>
            )}
            {mediaDialog.kind === 'image' && (
              <label>
                <span>متن جایگزین تصویر</span>
                <input value={mediaDialog.alt} onChange={(event) => setMediaDialog((current) => ({ ...current, alt: event.target.value }))} placeholder="تصویر را کوتاه و روشن توصیف کنید" />
                <small>برای دسترس‌پذیری مهم است؛ فقط برای تصویر کاملاً تزئینی خالی بگذارید.</small>
              </label>
            )}
            <label>
              <span>زیرنویس <small>(اختیاری)</small></span>
              <input value={mediaDialog.caption} onChange={(event) => setMediaDialog((current) => ({ ...current, caption: event.target.value }))} />
            </label>
            {mediaPreview && (
              <div className="rte-dialog__media-preview" aria-label="پیش‌نمایش رسانه">
                {mediaPreview.type === 'image'
                  ? <img src={mediaPreview.url} alt={mediaDialog.alt || ''} />
                  : mediaPreview.type === 'embed'
                    ? <iframe
                        src={mediaPreview.url}
                        title={mediaDialog.caption.trim() || 'پیش‌نمایش ویدیو'}
                        loading="lazy"
                        referrerPolicy="strict-origin-when-cross-origin"
                        allow="encrypted-media; fullscreen; picture-in-picture"
                        allowFullScreen
                      />
                    : <video src={mediaPreview.url} controls preload="metadata" />}
                {mediaDialog.caption && <small>{mediaDialog.caption}</small>}
              </div>
            )}
            {mediaDialog.error && <p className="rte-dialog__error" role="alert">{mediaDialog.error}</p>}
            <div className="rte-dialog__actions">
              <button type="button" className="btn btn--outline" onClick={closeMediaDialog}>انصراف</button>
              <button type="submit" className="btn btn--primary"><Check size={16} />{mediaDialog.editing ? 'ذخیره تغییرات' : 'افزودن به متن'}</button>
            </div>
          </form>
        </EditorDialog>
      )}
    </>
  );
}
