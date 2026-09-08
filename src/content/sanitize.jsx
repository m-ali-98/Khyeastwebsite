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

  const walk = (node) => {
    for (const child of [...node.children]) {
      if (!ALLOWED_TAGS.has(child.tagName)) {
        // unwrap: keep safe text/children of structural containers, drop the rest
        if (['STYLE', 'SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META'].includes(child.tagName)) {
          child.remove();
          continue;
        }
        while (child.firstChild) node.insertBefore(child.firstChild, child);
        child.remove();
        walk(node);
        return;
      }
      const allowed = ALLOWED_ATTRS[child.tagName] || [];
      for (const attr of [...child.attributes]) {
        const n = attr.name.toLowerCase();
        if (!allowed.includes(n)) {
          child.removeAttribute(attr.name);
          continue;
        }
        if (n === 'href') {
          const v = safeUrl(attr.value, 'href');
          if (!v) child.removeAttribute('href');
          else {
            child.setAttribute('href', v);
            if (/^https?:/i.test(v)) {
              child.setAttribute('target', '_blank');
              child.setAttribute('rel', 'noopener noreferrer');
            }
          }
        }
        if (n === 'src') {
          const v = safeUrl(attr.value, 'src');
          if (!v) child.remove();
          else child.setAttribute('src', v);
        }
        if (n === 'target' && child.getAttribute('target') !== '_blank') child.removeAttribute('target');
      }
      walk(child);
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
