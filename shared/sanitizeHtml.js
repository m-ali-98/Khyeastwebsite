/* Shared rich-text sanitiser.
 *
 * Admin-authored HTML crosses two trust boundaries: it is cleaned on the
 * server before persistence and again in the browser before it reaches
 * dangerouslySetInnerHTML. Keep this module DOM-implementation agnostic so
 * Linkedom and real browsers execute exactly the same policy.
 */

export const MAX_HTML_INPUT_LENGTH = 250_000;
export const MAX_HTML_DEPTH = 128;
export const MAX_HTML_NODES = 20_000;

const ALLOWED = new Set([
  'P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'H2', 'H3', 'H4',
  'UL', 'OL', 'LI', 'A', 'IMG', 'VIDEO', 'BLOCKQUOTE', 'FIGURE', 'FIGCAPTION', 'SOURCE',
]);

/* These elements can alter parsing, fetch executable resources, submit data,
 * or hide active markup in a secondary DOM tree. Their complete subtrees are
 * discarded; ordinary formatting wrappers that are not allowlisted are only
 * unwrapped so pasted text is not needlessly lost. */
const DROP_WITH_CONTENT = new Set([
  'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'BASE',
  'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'OPTION',
  'TEMPLATE', 'NOSCRIPT', 'NOEMBED', 'SVG', 'MATH', 'TITLE', 'PLAINTEXT',
]);

const ATTRS = {
  A: new Set(['href', 'title', 'target']),
  IMG: new Set(['src', 'alt']),
  VIDEO: new Set(['src', 'controls', 'preload']),
  SOURCE: new Set(['src', 'type']),
};

const BASE_URL = 'https://khyeast.invalid/';
const CONTROL = /[\u0000-\u001F\u007F]/g;

/** Return a safe serialised URL or an empty string.
 *
 * A single-origin relative URL is allowed, as are explicit http(s) URLs.
 * Scheme-relative and backslash-confused values are rejected before URL
 * parsing because browsers normalise them into external destinations. */
function safeUrl(raw, kind) {
  const value = String(raw ?? '').trim().replace(CONTROL, '');
  if (!value) return '';
  if (value.startsWith('//') || value.includes('\\')) return '';

  const explicitScheme = value.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (explicitScheme) {
    if (explicitScheme === 'http' || explicitScheme === 'https') return value;
    if (kind === 'href' && (explicitScheme === 'mailto' || explicitScheme === 'tel')) return value;
    return '';
  }

  try {
    const parsed = new URL(value, BASE_URL);
    /* This rejects //evil.example and every other relative spelling that URL
       resolves away from our own origin. */
    if (parsed.origin !== new URL(BASE_URL).origin) return '';
    return value;
  } catch {
    return '';
  }
}

/** Remove every source attribute, while retaining only the first value for
 * each lowercase allowlisted name. Rebuilding from this clean map avoids DOM
 * implementations such as Linkedom preserving an attacker-controlled `HREF`
 * while `removeAttribute('href')` removes a different casing. */
function takeAllowedAttributes(element, tag) {
  const allowed = ATTRS[tag] || new Set();
  const clean = new Map();
  const source = Array.from(element.attributes || []);

  for (const attr of source) {
    const name = String(attr.name || '').toLowerCase();
    if (allowed.has(name) && !clean.has(name)) clean.set(name, String(attr.value || ''));
  }
  for (const attr of source) element.removeAttribute(String(attr.name || ''));
  return clean;
}

function setTextAttribute(element, name, value, maxLength = 1000) {
  const clean = String(value || '').slice(0, maxLength);
  if (clean) element.setAttribute(name, clean);
}

/** Canonicalise one allowed element. Returns false when the whole element is
 * unsafe and must be removed. */
function rebuildAttributes(element, tag) {
  const attrs = takeAllowedAttributes(element, tag);

  if (tag === 'A') {
    const href = safeUrl(attrs.get('href'), 'href');
    if (href) element.setAttribute('href', href);
    setTextAttribute(element, 'title', attrs.get('title'));
    if (href && (/^https?:\/\//i.test(href) || attrs.get('target') === '_blank')) {
      element.setAttribute('target', '_blank');
      element.setAttribute('rel', 'noopener noreferrer');
    }
    return true;
  }

  if (tag === 'IMG') {
    if (attrs.has('src')) {
      const src = safeUrl(attrs.get('src'), 'src');
      if (!src) return false;
      element.setAttribute('src', src);
    }
    setTextAttribute(element, 'alt', attrs.get('alt'), 2000);
    return true;
  }

  if (tag === 'VIDEO') {
    if (attrs.has('src')) {
      const src = safeUrl(attrs.get('src'), 'src');
      if (!src) return false;
      element.setAttribute('src', src);
    }
    if (attrs.has('controls')) element.setAttribute('controls', '');
    const preload = String(attrs.get('preload') || '').toLowerCase();
    if (['none', 'metadata', 'auto'].includes(preload)) element.setAttribute('preload', preload);
    return true;
  }

  if (tag === 'SOURCE') {
    const src = safeUrl(attrs.get('src'), 'src');
    if (!src) return false;
    element.setAttribute('src', src);
    setTextAttribute(element, 'type', attrs.get('type'), 200);
    return true;
  }

  return true;
}

function pushChildren(stack, node, depth) {
  const children = Array.from(node.childNodes || []);
  for (let index = children.length - 1; index >= 0; index -= 1) {
    stack.push({ node: children[index], depth });
  }
}

/** Sanitise the children of `root` in place, without recursive JavaScript.
 * The explicit node/depth bounds make pathological authenticated input fail
 * closed instead of overflowing either Node's or a browser's call stack. */
export function sanitizeDomRoot(root) {
  const stack = [];
  pushChildren(stack, root, 1);
  let visited = 0;

  while (stack.length) {
    const { node, depth } = stack.pop();
    if (!node?.parentNode) continue;
    visited += 1;
    if (visited > MAX_HTML_NODES) {
      root.replaceChildren();
      return root;
    }

    /* Comments are never persisted. In particular, this removes malformed
       `--!>` boundaries whose meaning differs between server and browser HTML
       parsers and could otherwise expose active markup after reparse. */
    if (node.nodeType === 8) {
      node.remove();
      continue;
    }
    if (node.nodeType !== 1) continue;

    const tag = String(node.tagName || '').toUpperCase();
    if (DROP_WITH_CONTENT.has(tag) || (ALLOWED.has(tag) && depth > MAX_HTML_DEPTH)) {
      node.remove();
      continue;
    }

    if (!ALLOWED.has(tag)) {
      const parent = node.parentNode;
      const promoted = Array.from(node.childNodes || []);
      for (const child of promoted) parent.insertBefore(child, node);
      node.remove();
      for (let index = promoted.length - 1; index >= 0; index -= 1) {
        stack.push({ node: promoted[index], depth });
      }
      continue;
    }

    if (!rebuildAttributes(node, tag)) {
      node.remove();
      continue;
    }
    pushChildren(stack, node, depth + 1);
  }
  return root;
}

/** Sanitize with an explicit parser. Used by Node at the storage boundary. */
export function sanitizeHtmlWithParser(html, DOMParserImpl) {
  if (typeof DOMParserImpl !== 'function') throw new Error('DOMParser implementation is required');
  const source = String(html ?? '');
  if (source.length > MAX_HTML_INPUT_LENGTH) return '';
  try {
    const documentRef = new DOMParserImpl().parseFromString('<!doctype html><html><body></body></html>', 'text/html');
    if (!documentRef?.createElement) return '';
    /* Assigning through innerHTML gives the parser a fragment context without
       interpolating input into a wrapper string that `</div>` could escape. */
    const root = documentRef.createElement('div');
    root.innerHTML = source;
    sanitizeDomRoot(root);
    return root.innerHTML;
  } catch {
    /* DOM parsers may themselves recurse while constructing an adversarially
       deep tree. A parser RangeError is untrusted-input failure, not a reason
       to take down the Admin save request or the rendering process. */
    return '';
  }
}

/** Browser entry point. */
export function sanitizeHtml(html) {
  return sanitizeHtmlWithParser(html, globalThis.DOMParser);
}
