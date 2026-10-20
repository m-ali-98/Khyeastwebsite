/* ==========================================================================
   Shared strict HTML sanitizer for admin-authored rich text.

   The browser and server deliberately use this exact implementation. The
   caller supplies a DOMParser implementation implicitly (the browser global)
   or explicitly (linkedom on Node), so the persistence boundary cannot drift
   from the preview/runtime boundary.
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

const DROP = new Set(['STYLE', 'SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META']);

const safeUrl = (url, kind) => {
  const value = String(url || '').trim();
  if (kind === 'href') return /^(https?:|mailto:|tel:|\/|#)/i.test(value) ? value : null;
  if (kind === 'src') return /^(https?:|\/)/i.test(value) && !/^\/\//.test(value) ? value : null;
  return null;
};

/** Sanitize with an explicit parser. Used by Node at the storage boundary. */
export function sanitizeHtmlWithParser(html, DOMParserImpl) {
  if (typeof DOMParserImpl !== 'function') throw new Error('DOMParser implementation is required');
  const doc = new DOMParserImpl().parseFromString(`<div id="root">${String(html || '')}</div>`, 'text/html');
  const root = doc.getElementById('root');
  if (!root) return '';

  const walk = (node) => {
    for (const child of [...node.children]) {
      if (child.parentNode === node) inspect(child, node);
    }
  };

  /* Inspect one element in place: drop it, unwrap it, or clean its attributes
     and descend. `parent` receives children lifted from an unwrapped element. */
  const inspect = (element, parent) => {
    if (!ALLOWED_TAGS.has(element.tagName)) {
      if (DROP.has(element.tagName)) {
        element.remove();
        return;
      }
      const promoted = [...element.childNodes];
      while (element.firstChild) parent.insertBefore(element.firstChild, element);
      element.remove();
      for (const node of promoted) {
        if (node.parentNode === parent && node.nodeType === 1) inspect(node, parent);
      }
      return;
    }

    const allowed = ALLOWED_ATTRS[element.tagName] || [];
    for (const attr of [...element.attributes]) {
      const name = attr.name.toLowerCase();
      if (!allowed.includes(name)) {
        element.removeAttribute(attr.name);
        continue;
      }
      if (name === 'href') {
        const value = safeUrl(attr.value, 'href');
        if (!value) element.removeAttribute('href');
        else {
          element.setAttribute('href', value);
          if (/^https?:/i.test(value)) {
            element.setAttribute('target', '_blank');
            element.setAttribute('rel', 'noopener noreferrer');
          }
        }
      }
      if (name === 'src') {
        const value = safeUrl(attr.value, 'src');
        if (!value) {
          element.remove();
          return;
        }
        element.setAttribute('src', value);
      }
      if (name === 'target' && element.getAttribute('target') !== '_blank') {
        element.removeAttribute('target');
      }
    }
    walk(element);
  };

  walk(root);
  return root.innerHTML;
}

/** Browser entry point. */
export function sanitizeHtml(html) {
  return sanitizeHtmlWithParser(html, globalThis.DOMParser);
}
