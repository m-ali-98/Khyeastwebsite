import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Check,
  Maximize2,
  Minimize2,
  Quote,
  Redo2,
  RemoveFormatting,
  Underline as UnderlineIcon,
  Undo2,
  X,
} from 'lucide-react';
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

export function UploadButton({ onUploaded, accept = 'image/*,video/mp4,video/webm', label = 'بارگذاری فایل', icon = 'upload', small = false }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const UploadIcon = Icons[icon] || Icons.upload;
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');

  const pick = async (file) => {
    setBusy(true);
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
        <UploadIcon size={16} />
        {busy ? 'در حال بارگذاری…' : label}
      </button>
      {err && <small style={{ color: 'var(--crimson-ink)' }}>{err}</small>}
      {!err && note && <small style={{ color: 'var(--muted)' }}>{note}</small>}
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

/* ---------------- rich text editor (links / images / videos) ---------------- */
const EMPTY_FORMATS = {
  bold: false,
  italic: false,
  underline: false,
  unordered: false,
  ordered: false,
  link: false,
  block: 'p',
};

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
  holder.querySelectorAll('p,h2,h3,h4,li,blockquote,figcaption,br').forEach((element) => element.append(' '));
  const text = (holder.textContent || '').replace(/\s+/g, ' ').trim();
  return {
    words: text ? text.split(' ').length : 0,
    characters: Array.from(text).length,
  };
}

function safeMediaSource(kind, url) {
  if (typeof document === 'undefined' || !url) return '';
  const candidate = kind === 'image'
    ? `<img src="${escapeHtml(url)}" alt="">`
    : `<video src="${escapeHtml(url)}" controls></video>`;
  const holder = document.createElement('div');
  holder.innerHTML = sanitizeHtml(candidate);
  return holder.querySelector(kind === 'image' ? 'img[src]' : 'video[src]')?.getAttribute('src') || '';
}

function plainTextMarkup(text) {
  const clean = String(text || '').replace(/\r\n?/g, '\n');
  return clean
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`)
    .join('');
}

function removeBrowserFormattingArtifacts(root) {
  if (!root) return;
  root.querySelectorAll('[style],[class]').forEach((element) => {
    element.removeAttribute('style');
    element.removeAttribute('class');
  });
  root.querySelectorAll('span,font').forEach((element) => element.replaceWith(...element.childNodes));
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

  const safePreview = useMemo(() => (preview ? sanitizeHtml(html) : ''), [html, preview]);
  const stats = useMemo(() => textStatistics(html), [html]);
  const mediaPreviewUrl = useMemo(
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
      if (event.key === 'Escape' && fullscreen && !linkDialog && !mediaDialog) setFullscreen(false);
    };
    document.addEventListener('keydown', leaveFullscreen);
    return () => document.removeEventListener('keydown', leaveFullscreen);
  }, [fullscreen, linkDialog, mediaDialog]);

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
    setFormats({
      bold: commandState('bold') || Boolean(closestInside(element, 'strong,b', ref.current)),
      italic: commandState('italic') || Boolean(closestInside(element, 'em,i', ref.current)),
      underline: commandState('underline') || Boolean(closestInside(element, 'u', ref.current)),
      unordered: commandState('insertUnorderedList') || Boolean(closestInside(element, 'ul', ref.current)),
      ordered: commandState('insertOrderedList') || Boolean(closestInside(element, 'ol', ref.current)),
      link: Boolean(closestInside(element, 'a', ref.current)),
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
    const media = event.target.closest?.('img,video');
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
    const media = mediaDialog.kind === 'image'
      ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(mediaDialog.alt.trim())}">`
      : `<video src="${escapeHtml(url)}" controls preload="metadata"></video>`;
    const caption = mediaDialog.caption.trim()
      ? `<figcaption>${escapeHtml(mediaDialog.caption.trim())}</figcaption>`
      : '';
    const markup = sanitizeHtml(`<figure>${media}${caption}</figure>`);
    const holder = document.createElement('div');
    holder.innerHTML = markup;
    const valid = holder.querySelector(mediaDialog.kind === 'image' ? 'img[src]' : 'video[src]');
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
            <ToolButton title="پاک‌کردن قالب‌بندی" onClick={() => exec('removeFormat')}><RemoveFormatting size={16} /></ToolButton>
          </div>

          <div className="rte__group" aria-label="فهرست‌ها">
            <ToolButton title="فهرست نقطه‌ای" active={formats.unordered} onClick={() => exec('insertUnorderedList')}><Icons.list size={16} /></ToolButton>
            <ToolButton title="فهرست شماره‌ای" active={formats.ordered} onClick={() => exec('insertOrderedList')}><Icons.listOrdered size={16} /></ToolButton>
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
            {notice || (preview ? 'این پیش‌نمایش همان محتوای پاک‌سازی‌شده برای انتشار است.' : 'برای ویرایش رسانه دوبار روی آن بزنید؛ فایل را می‌توانید داخل متن رها کنید.')}
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
              <input autoFocus dir="ltr" inputMode="url" placeholder="https://… یا /uploads/…" value={mediaDialog.url} onChange={(event) => setMediaDialog((current) => ({ ...current, url: event.target.value, error: '' }))} />
            </label>
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
            {mediaPreviewUrl && (
              <div className="rte-dialog__media-preview" aria-label="پیش‌نمایش رسانه">
                {mediaDialog.kind === 'image'
                  ? <img src={mediaPreviewUrl} alt={mediaDialog.alt || ''} />
                  : <video src={mediaPreviewUrl} controls preload="metadata" />}
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
