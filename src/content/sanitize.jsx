/* ==========================================================================
   Strict HTML sanitizer for admin-authored rich text.
   Only a tiny whitelist of structural tags survives; every style attribute,
   class, script, event handler and non-whitelisted tag is stripped so the
   content admin can NEVER alter site styling or inject code.
   ========================================================================== */

const ALLOWED_TAGS = new Set([
  'P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'H2', 'H3', 'H4',
  'UL', 'OL', 'LI', 'A', 'IMG', 'VIDEO', 'BLOCKQUOTE', 'FIGURE', 'FIGCAPTION', 'SOURCE',
]);

const ALLOWED_ATTRS = {
  A: ['href', 'title', 'target'],
  IMG: ['src', 'alt'],
  VIDEO: ['src', 'controls', 'preload'],
  SOURCE: ['src', 'type'],
};

const safeUrl = (url, kind) => {
  const v = String(url || '').trim();
  if (kind === 'href') return /^(https?:|mailto:|tel:|\/|#)/i.test(v) ? v : null;
  if (kind === 'src') return /^(https?:|\/)/i.test(v) && !/^\/\//.test(v) ? v : null;
  return null;
};

export function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(`<div id="root">${String(html || '')}</div>`, 'text/html');
  const root = doc.getElementById('root');

  const DROP = new Set(['STYLE', 'SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META']);

  /* Inspect one element in place: drop it, unwrap it, or clean its attributes
     and descend. `parent` is where its children are lifted to when unwrapped. */
  const inspect = (el, parent) => {
    if (!ALLOWED_TAGS.has(el.tagName)) {
      if (DROP.has(el.tagName)) {
        el.remove();
        return;
      }
      /* Lift the children into place and inspect only those, rather than
         restarting the scan of the whole parent. Restarting made this
         quadratic — pasting from Word or Google Docs produces thousands of
         <span> wrappers, and 1600 of them cost 124 ms while 800 cost 36 ms. */
      const promoted = [...el.childNodes];
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      el.remove();
      for (const node of promoted) {
        if (node.parentNode === parent && node.nodeType === 1) inspect(node, parent);
      }
      return;
    }

    const allowed = ALLOWED_ATTRS[el.tagName] || [];
    for (const attr of [...el.attributes]) {
      const n = attr.name.toLowerCase();
      if (!allowed.includes(n)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (n === 'href') {
        const v = safeUrl(attr.value, 'href');
        if (!v) el.removeAttribute('href');
        else {
          el.setAttribute('href', v);
          if (/^https?:/i.test(v)) {
            el.setAttribute('target', '_blank');
            el.setAttribute('rel', 'noopener noreferrer');
          }
        }
      }
      if (n === 'src') {
        const v = safeUrl(attr.value, 'src');
        if (!v) {
          el.remove();
          return;
        }
        el.setAttribute('src', v);
      }
      if (n === 'target' && el.getAttribute('target') !== '_blank') el.removeAttribute('target');
    }
    walk(el);
  };

  const walk = (node) => {
    for (const child of [...node.children]) {
      if (child.parentNode === node) inspect(child, node);
    }
  };

  walk(root);
  return root.innerHTML;
}

/* Tiny inline highlight markup for plain texts: [[accent part]] */
export function renderHighlight(text = '') {
  const parts = String(text).split(/\[\[(.+?)\]\]/g);
  return parts.map((p, i) => (i % 2 === 1 ? <em key={i}>{p}</em> : <span key={i}>{p}</span>));
}
