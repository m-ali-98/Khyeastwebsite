/* Safe accounting for administrator uploads.

   Upload references can live almost anywhere in persisted content (gallery
   arrays, rich HTML, trust seals, page media, or video fields), so this module
   walks the complete state rather than maintaining a fragile field allowlist.
   Responsive WebP masters and their width variants are treated as one family:
   one reference keeps the entire family and one cleanup removes all of it. */
import fs from 'node:fs';
import path from 'node:path';
import { UPLOAD_LADDER } from '../shared/uploadSizes.js';

export const UNUSED_UPLOAD_GRACE_MS = 24 * 60 * 60 * 1000;
export const MAX_UNUSED_UPLOAD_BATCH = 1000;

const KINDS = ['images', 'videos'];
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const MASTER_RE = /^(.*)-w\d+\.webp$/i;
const WIDTHS = [...new Set(UPLOAD_LADDER.map(Number).filter(Number.isFinite))]
  .sort((a, b) => b - a)
  .join('|');
const VARIANT_RE = new RegExp(`^(.*)-(?:${WIDTHS})\\.webp$`, 'i');
const EMBEDDED_UPLOAD_RE = /\/uploads\/(images|videos)\/([A-Za-z0-9][A-Za-z0-9_.-]*)(?=[?#"'()\s<>,]|$)/g;
const EXACT_UPLOAD_RE = /^\/uploads\/(images|videos)\/([A-Za-z0-9][A-Za-z0-9_.-]*)$/;

/* HTML parsers resolve character references inside src/href values. Decode a
   deliberately tiny ASCII subset before scanning so a rich-text reference
   such as &#47;uploads&#47;images&#47;x.webp cannot be mistaken for an orphan. */
const searchableText = (value) => value
  .replace(/&#(?:x([0-9a-f]{1,2})|([0-9]{1,3}));/gi, (whole, hex, decimal) => {
    const code = Number.parseInt(hex || decimal, hex ? 16 : 10);
    return code >= 32 && code <= 126 ? String.fromCharCode(code) : whole;
  })
  .replace(/&sol;/gi, '/')
  .replace(/&period;/gi, '.')
  .replace(/&hyphen;/gi, '-')
  .replace(/&lowbar;/gi, '_')
  .replace(/&quest;/gi, '?')
  .replace(/&num;/gi, '#')
  .replace(/%([0-9a-f]{2})/gi, (whole, hex) => {
    const decoded = String.fromCharCode(Number.parseInt(hex, 16));
    return /^[A-Za-z0-9/_.-]$/.test(decoded) ? decoded : whole;
  });

const responsiveStem = (kind, name) => {
  if (kind !== 'images') return '';
  return name.match(MASTER_RE)?.[1] || name.match(VARIANT_RE)?.[1] || '';
};

const familyKey = (kind, name) => {
  const stem = responsiveStem(kind, name);
  return stem ? `${kind}:responsive:${stem}` : `${kind}:file:${name}`;
};

export function parseUploadUrl(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(EXACT_UPLOAD_RE);
  if (!match || !SAFE_NAME.test(match[2])) return null;
  return { kind: match[1], name: match[2], url: value };
}

/** Collect every local upload mentioned anywhere in a persisted state tree. */
export function collectUploadReferences(value, { maxNodes = 250_000 } = {}) {
  const references = new Set();
  const seen = new WeakSet();
  const stack = [value];
  let nodes = 0;

  while (stack.length && nodes < maxNodes) {
    const current = stack.pop();
    nodes += 1;
    if (typeof current === 'string') {
      for (const match of searchableText(current).matchAll(EMBEDDED_UPLOAD_RE)) {
        if (SAFE_NAME.test(match[2])) references.add(`${match[1]}/${match[2]}`);
      }
      continue;
    }
    if (!current || typeof current !== 'object') continue;
    if (seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
    } else {
      for (const item of Object.values(current)) stack.push(item);
    }
  }
  /* Never turn a resource bound into a false "unused" verdict. Refusing the
     scan is safer than deleting a reference that happened to be beyond it. */
  if (stack.length) {
    throw Object.assign(new Error('upload reference scan exceeded its safety limit'), {
      code: 'UPLOAD_REFERENCE_SCAN_LIMIT',
    });
  }
  return references;
}

const diskGroups = (uploadDir) => {
  const groups = new Map();
  for (const kind of KINDS) {
    const dir = path.join(uploadDir, kind);
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !SAFE_NAME.test(entry.name)) continue;
      let stat;
      try {
        stat = fs.statSync(path.join(dir, entry.name));
      } catch {
        continue;
      }
      const key = familyKey(kind, entry.name);
      if (!groups.has(key)) groups.set(key, { key, kind, files: [] });
      groups.get(key).files.push({ name: entry.name, bytes: stat.size, mtimeMs: stat.mtimeMs });
    }
  }
  return groups;
};

const representative = (group) => {
  const sorted = [...group.files].sort((a, b) => a.name.localeCompare(b.name));
  return sorted.find((file) => MASTER_RE.test(file.name)) || sorted[0];
};

/**
 * List only complete upload families that have no persisted reference and
 * whose newest member is older than the grace period. Fresh uploads are not
 * candidates because an Admin editor may still be composing an unsaved draft.
 */
export function listUnusedUploads(uploadDir, content, {
  now = Date.now(),
  graceMs = UNUSED_UPLOAD_GRACE_MS,
  limit = MAX_UNUSED_UPLOAD_BATCH,
} = {}) {
  const referencedFamilies = new Set();
  for (const reference of collectUploadReferences(content)) {
    const slash = reference.indexOf('/');
    const kind = reference.slice(0, slash);
    const name = reference.slice(slash + 1);
    referencedFamilies.add(familyKey(kind, name));
  }

  const candidates = [];
  for (const group of diskGroups(uploadDir).values()) {
    if (referencedFamilies.has(group.key)) continue;
    const modifiedAt = Math.max(...group.files.map((file) => file.mtimeMs));
    if (!Number.isFinite(modifiedAt) || now - modifiedAt < graceMs) continue;
    const display = representative(group);
    candidates.push({
      url: `/uploads/${group.kind}/${display.name}`,
      name: display.name,
      type: group.kind === 'images' ? 'image' : 'video',
      bytes: group.files.reduce((sum, file) => sum + file.bytes, 0),
      fileCount: group.files.length,
      modifiedAt: new Date(modifiedAt).toISOString(),
    });
  }

  candidates.sort((a, b) => a.modifiedAt.localeCompare(b.modifiedAt) || a.url.localeCompare(b.url));
  const safeLimit = Math.max(0, Math.min(MAX_UNUSED_UPLOAD_BATCH, Number(limit) || 0));
  const items = candidates.slice(0, safeLimit);
  return {
    items,
    totalCount: candidates.length,
    totalBytes: candidates.reduce((sum, item) => sum + item.bytes, 0),
    truncated: candidates.length > items.length,
    graceHours: Math.round(graceMs / (60 * 60 * 1000)),
  };
}

export function isUploadReferenced(url, content) {
  const target = parseUploadUrl(url);
  if (!target) return false;
  const targetFamily = familyKey(target.kind, target.name);
  for (const reference of collectUploadReferences(content)) {
    const slash = reference.indexOf('/');
    if (familyKey(reference.slice(0, slash), reference.slice(slash + 1)) === targetFamily) return true;
  }
  return false;
}

/** Remove one exact file or one responsive-image family, never arbitrary paths. */
export function deleteUploadSet(uploadDir, url) {
  const target = parseUploadUrl(url);
  if (!target) return { invalid: true, removed: [], stuck: [], bytes: 0 };
  const dir = path.join(uploadDir, target.kind);
  const targetFamily = familyKey(target.kind, target.name);
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { invalid: false, removed: [], stuck: [], bytes: 0 };
  }

  const names = entries
    .filter((entry) => entry.isFile() && SAFE_NAME.test(entry.name) && familyKey(target.kind, entry.name) === targetFamily)
    .map((entry) => entry.name);
  const removed = [];
  const stuck = [];
  let bytes = 0;
  for (const name of names) {
    const file = path.join(dir, name);
    let size = 0;
    try { size = fs.statSync(file).size; } catch {}
    try {
      fs.unlinkSync(file);
      removed.push(name);
      bytes += size;
    } catch {
      stuck.push(name);
    }
  }
  return { invalid: false, removed, stuck, bytes };
}

/**
 * Rescan at confirmation time, then remove only URLs that are still old and
 * unused. A file referenced between preview and confirmation is skipped.
 */
export function deleteUnusedUploads(uploadDir, content, urls, options = {}) {
  const requested = [...new Set(Array.isArray(urls) ? urls.filter((url) => typeof url === 'string') : [])]
    .slice(0, MAX_UNUSED_UPLOAD_BATCH);
  const current = listUnusedUploads(uploadDir, content, { ...options, limit: MAX_UNUSED_UPLOAD_BATCH });
  const candidates = new Map(current.items.map((item) => [item.url, item]));
  const removed = [];
  const skipped = [];
  const stuck = [];
  let bytes = 0;

  for (const url of requested) {
    const candidate = candidates.get(url);
    if (!candidate) {
      skipped.push(url);
      continue;
    }
    const result = deleteUploadSet(uploadDir, url);
    if (result.removed.length) {
      removed.push({ url, fileCount: result.removed.length, bytes: result.bytes });
      bytes += result.bytes;
    }
    for (const name of result.stuck) stuck.push(`/uploads/${candidate.type === 'image' ? 'images' : 'videos'}/${name}`);
    if (!result.removed.length && !result.stuck.length) skipped.push(url);
  }

  return { removed, skipped, stuck, bytes };
}
