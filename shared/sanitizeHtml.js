/* Shared rich-text sanitiser.
 *
 * Admin-authored HTML crosses two trust boundaries: it is cleaned on the
 * server before persistence and again in the browser before it reaches
 * dangerouslySetInnerHTML. Keep this module DOM-implementation agnostic so
 * Linkedom and real browsers execute exactly the same policy.
 */
import { canonicalVideoEmbedUrl } from './videoEmbeds.js';

export const MAX_HTML_INPUT_LENGTH = 250_000;
export const MAX_HTML_DEPTH = 128;
export const MAX_HTML_NODES = 20_000;
export const RICH_TEXT_COLOR_IDS = Object.freeze([
  'ink', 'crimson', 'blue', 'green', 'amber', 'purple',
]);
export const RICH_TEXT_TABLE_LIMITS = Object.freeze({
  minRows: 2,
  maxRows: 20,
  minColumns: 2,
  maxColumns: 8,
  maxCaptionLength: 200,
});

const RICH_TEXT_COLORS = new Set(RICH_TEXT_COLOR_IDS);
const ALLOWED = new Set([
  'P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'SPAN', 'H2', 'H3', 'H4',
  'UL', 'OL', 'LI', 'A', 'IMG', 'VIDEO', 'IFRAME', 'BLOCKQUOTE', 'FIGURE', 'FIGCAPTION', 'SOURCE',
  'TABLE', 'CAPTION', 'THEAD', 'TBODY', 'TR', 'TH', 'TD',
]);

/* These elements can alter parsing, fetch executable resources, submit data,
 * or hide active markup in a secondary DOM tree. Their complete subtrees are
 * discarded; the sole iframe exception is canonicalized to one reviewed video
 * provider and stripped of all fallback children below. Ordinary formatting
 * wrappers that are not allowlisted are only unwrapped so pasted text survives. */
const DROP_WITH_CONTENT = new Set([
  'SCRIPT', 'STYLE', 'OBJECT', 'EMBED', 'LINK', 'META', 'BASE',
  'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'OPTION',
  'TEMPLATE', 'NOSCRIPT', 'NOEMBED', 'SVG', 'MATH', 'TITLE', 'PLAINTEXT',
]);

const ATTRS = {
  A: new Set(['href', 'title', 'target']),
  IMG: new Set(['src', 'alt']),
  VIDEO: new Set(['src', 'controls', 'preload']),
  IFRAME: new Set(['src', 'title']),
  SOURCE: new Set(['src', 'type']),
  SPAN: new Set(['data-text-color']),
  FIGURE: new Set(['data-rich-table']),
  TH: new Set(['scope']),
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

  if (tag === 'IFRAME') {
    const src = canonicalVideoEmbedUrl(attrs.get('src'));
    if (!src) return false;
    const title = String(attrs.get('title') || '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .trim()
      .slice(0, 200);
    element.setAttribute('src', src);
    element.setAttribute('title', title || 'Video player');
    element.setAttribute('loading', 'lazy');
    element.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    element.setAttribute('allow', 'encrypted-media; fullscreen; picture-in-picture');
    element.setAttribute('allowfullscreen', '');
    return true;
  }

  if (tag === 'SOURCE') {
    const src = safeUrl(attrs.get('src'), 'src');
    if (!src) return false;
    element.setAttribute('src', src);
    setTextAttribute(element, 'type', attrs.get('type'), 200);
    return true;
  }

  if (tag === 'SPAN') {
    const color = String(attrs.get('data-text-color') || '').toLowerCase();
    if (RICH_TEXT_COLORS.has(color)) element.setAttribute('data-text-color', color);
    return true;
  }

  if (tag === 'FIGURE') {
    if (attrs.has('data-rich-table')) element.setAttribute('data-rich-table', '');
    return true;
  }

  if (tag === 'TH') {
    const scope = String(attrs.get('scope') || '').toLowerCase();
    if (scope === 'col' || scope === 'row') element.setAttribute('scope', scope);
    return true;
  }

  return true;
}

const TABLE_STRUCTURE_TAGS = new Set(['CAPTION', 'THEAD', 'TBODY', 'TR', 'TH', 'TD']);
const directElements = (node, tag) => Array.from(node?.children || [])
  .filter((child) => String(child.tagName || '').toUpperCase() === tag);
const rowCells = (row) => Array.from(row?.children || [])
  .filter((child) => ['TH', 'TD'].includes(String(child.tagName || '').toUpperCase()));

/* A table is published only in the exact bounded structure produced by the
 * editor. This keeps every persisted table captioned, responsive (the figure
 * is its scroll container), and free of pasted layout tricks such as ragged
 * rows or nested tables. */
function isSemanticRichTable(table) {
  const figure = table?.parentElement;
  if (String(figure?.tagName || '').toUpperCase() !== 'FIGURE' || !figure.hasAttribute('data-rich-table')) return false;
  const figureChildren = Array.from(figure.children || []);
  if (figureChildren.length !== 1 || figureChildren[0] !== table) return false;
  if (Array.from(figure.childNodes || []).some((child) => (
    child !== table && (child.nodeType !== 3 || String(child.textContent || '').trim())
  ))) return false;

  const captions = directElements(table, 'CAPTION');
  const heads = directElements(table, 'THEAD');
  const bodies = directElements(table, 'TBODY');
  const tableTags = Array.from(table.children || []).map((child) => String(child.tagName || '').toUpperCase());
  if (captions.length !== 1 || heads.length !== 1 || bodies.length !== 1 || tableTags.join(',') !== 'CAPTION,THEAD,TBODY') return false;
  const caption = String(captions[0].textContent || '').trim();
  if (!caption || Array.from(caption).length > RICH_TEXT_TABLE_LIMITS.maxCaptionLength) return false;

  const headRows = directElements(heads[0], 'TR');
  const bodyRows = directElements(bodies[0], 'TR');
  const rows = [...headRows, ...bodyRows];
  if (headRows.length !== 1 || bodyRows.length < 1 ||
      heads[0].children.length !== headRows.length || bodies[0].children.length !== bodyRows.length) return false;
  if (rows.length < RICH_TEXT_TABLE_LIMITS.minRows || rows.length > RICH_TEXT_TABLE_LIMITS.maxRows) return false;

  const headerCells = rowCells(headRows[0]);
  if (headerCells.length !== headRows[0].children.length) return false;
  const columns = headerCells.length;
  if (columns < RICH_TEXT_TABLE_LIMITS.minColumns || columns > RICH_TEXT_TABLE_LIMITS.maxColumns) return false;
  if (!headerCells.every((cell) => (
    String(cell.tagName || '').toUpperCase() === 'TH' &&
    String(cell.getAttribute('scope') || '').toLowerCase() === 'col'
  ))) return false;

  return bodyRows.every((row) => {
    const cells = rowCells(row);
    return cells.length === row.children.length && cells.length === columns && cells.every((cell) => {
      const tag = String(cell.tagName || '').toUpperCase();
      return tag === 'TD' || (tag === 'TH' && String(cell.getAttribute('scope') || '').toLowerCase() === 'row');
    });
  });
}

function isTableStructureNode(node, tag) {
  const table = node?.closest?.('table');
  if (!table || !isSemanticRichTable(table)) return false;
  const parentTag = String(node.parentElement?.tagName || '').toUpperCase();
  if (tag === 'CAPTION' || tag === 'THEAD' || tag === 'TBODY') return node.parentElement === table;
  if (tag === 'TR') {
    return ['THEAD', 'TBODY'].includes(parentTag) && node.parentElement?.parentElement === table;
  }
  if (tag === 'TH' || tag === 'TD') {
    const section = node.parentElement?.parentElement;
    return parentTag === 'TR' && ['THEAD', 'TBODY'].includes(String(section?.tagName || '').toUpperCase()) && section?.parentElement === table;
  }
  return false;
}

function pushChildren(stack, node, depth) {
  const children = Array.from(node.childNodes || []);
  for (let index = children.length - 1; index >= 0; index -= 1) {
    stack.push({ node: children[index], depth });
  }
}

function unwrapNode(stack, node, depth) {
  const parent = node.parentNode;
  const promoted = Array.from(node.childNodes || []);
  for (const child of promoted) parent.insertBefore(child, node);
  node.remove();
  for (let index = promoted.length - 1; index >= 0; index -= 1) {
    stack.push({ node: promoted[index], depth });
  }
}

/** Sanitise the children of `root` in place, without recursive JavaScript.
 * The explicit node/depth bounds make pathological authenticated input fail
 * closed instead of overflowing either Node's or a browser's call stack. */
function sanitizeDomRootDetailed(root) {
  const stack = [];
  pushChildren(stack, root, 1);
  let visited = 0;

  const reject = (code, limit) => {
    root.replaceChildren();
    return { ok: false, code, limit, visited };
  };

  while (stack.length) {
    const { node, depth } = stack.pop();
    if (!node?.parentNode) continue;
    visited += 1;
    if (visited > MAX_HTML_NODES) return reject('node-limit', MAX_HTML_NODES);

    /* Comments are never persisted. In particular, this removes malformed
       `--!>` boundaries whose meaning differs between server and browser HTML
       parsers and could otherwise expose active markup after reparse. */
    if (node.nodeType === 8) {
      node.remove();
      continue;
    }
    if (node.nodeType !== 1) continue;

    const tag = String(node.tagName || '').toUpperCase();
    if (ALLOWED.has(tag) && depth > MAX_HTML_DEPTH) {
      return reject('depth-limit', MAX_HTML_DEPTH);
    }
    if (DROP_WITH_CONTENT.has(tag)) {
      node.remove();
      continue;
    }

    if (!ALLOWED.has(tag)) {
      unwrapNode(stack, node, depth);
      continue;
    }

    if (!rebuildAttributes(node, tag)) {
      node.remove();
      continue;
    }
    /* Iframes have no authored fallback content. Discard all children before
       any descendant can become active in a reparsed browsing context. */
    if (tag === 'IFRAME') {
      node.replaceChildren();
      continue;
    }
    /* A span is meaningful only as one of our semantic, theme-aware text
       colours. Unwrap every other span so pasted layout hooks do not survive
       merely because colour support needs this tag. */
    if (tag === 'SPAN' && !node.hasAttribute('data-text-color')) {
      unwrapNode(stack, node, depth);
      continue;
    }
    if ((tag === 'TABLE' && !isSemanticRichTable(node)) ||
        (TABLE_STRUCTURE_TAGS.has(tag) && !isTableStructureNode(node, tag))) {
      unwrapNode(stack, node, depth);
      continue;
    }
    pushChildren(stack, node, depth + 1);
  }

  /* Re-check after dangerous descendants were dropped: a caption containing
     only a script, for example, becomes empty and must invalidate the table.
     The second pass can only unwrap already-visited nodes; it cannot introduce
     unbounded work or bypass attribute rebuilding. */
  Array.from(root.querySelectorAll?.('table') || []).forEach((table) => {
    if (!isSemanticRichTable(table)) unwrapNode([], table, 0);
  });
  Array.from(root.querySelectorAll?.('caption,thead,tbody,tr,th,td') || []).forEach((node) => {
    const tag = String(node.tagName || '').toUpperCase();
    if (!isTableStructureNode(node, tag)) unwrapNode([], node, 0);
  });
  Array.from(root.querySelectorAll?.('figure[data-rich-table]') || []).forEach((figure) => {
    const table = directElements(figure, 'TABLE')[0];
    if (!table || !isSemanticRichTable(table)) unwrapNode([], figure, 0);
  });
  return { ok: true, visited };
}

/** Preserve the original DOM helper contract for browser callers while the
 * server-facing detailed API below can distinguish rejection from valid empty
 * HTML. */
export function sanitizeDomRoot(root) {
  sanitizeDomRootDetailed(root);
  return root;
}

/** Sanitize with an explicit parser and report why untrusted input was refused.
 * The ordinary string-returning wrapper remains fail-closed for browser
 * rendering; persistence code must use this result and reject the save. */
export function sanitizeHtmlResultWithParser(html, DOMParserImpl) {
  if (typeof DOMParserImpl !== 'function') throw new Error('DOMParser implementation is required');
  let source;
  try {
    source = String(html ?? '');
  } catch {
    return { ok: false, html: '', code: 'invalid-input' };
  }
  if (source.length > MAX_HTML_INPUT_LENGTH) {
    return { ok: false, html: '', code: 'input-too-large', limit: MAX_HTML_INPUT_LENGTH, actual: source.length };
  }
  try {
    const documentRef = new DOMParserImpl().parseFromString('<!doctype html><html><body></body></html>', 'text/html');
    if (!documentRef?.createElement) return { ok: false, html: '', code: 'parser-error' };
    /* Assigning through innerHTML gives the parser a fragment context without
       interpolating input into a wrapper string that `</div>` could escape. */
    const root = documentRef.createElement('div');
    root.innerHTML = source;
    const result = sanitizeDomRootDetailed(root);
    if (!result.ok) return { ...result, html: '' };
    return { ok: true, html: root.innerHTML, visited: result.visited };
  } catch {
    /* DOM parsers may themselves recurse while constructing an adversarially
       deep tree. Report the refusal so persistence can return 400 rather than
       silently replacing the field with an empty string. */
    return { ok: false, html: '', code: 'parser-error' };
  }
}

/** Sanitize with an explicit parser. Used by browsers and compatibility
 * callers that need a fail-closed string rather than persistence validation. */
export function sanitizeHtmlWithParser(html, DOMParserImpl) {
  return sanitizeHtmlResultWithParser(html, DOMParserImpl).html;
}

/** Browser entry points. Rendering uses the fail-closed string API; Admin
 * persistence flows may use the detailed result to explain a refused bound. */
export function sanitizeHtmlResult(html) {
  return sanitizeHtmlResultWithParser(html, globalThis.DOMParser);
}

export function sanitizeHtml(html) {
  return sanitizeHtmlResult(html).html;
}
