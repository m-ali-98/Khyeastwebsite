/* Safe accounting for administrator uploads.

   Upload references can live almost anywhere in persisted content (gallery
   arrays, rich HTML, trust seals, page media, or video fields), so this module
   walks the complete state rather than maintaining a fragile field allowlist.
   Responsive WebP masters and their width variants are treated as one family:
   one reference keeps the entire family and one cleanup quarantines all of it. */
import fs from 'node:fs';
import path from 'node:path';
import { UPLOAD_LADDER } from '../shared/uploadSizes.js';

export const UNUSED_UPLOAD_GRACE_MS = 24 * 60 * 60 * 1000;
export const UPLOAD_QUARANTINE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_UNUSED_UPLOAD_BATCH = 1000;

const QUARANTINE_DIR = '.quarantine';
const KINDS = ['images', 'videos'];
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const MASTER_RE = /^(.*)-w\d+\.webp$/i;
const WIDTHS = [...new Set(UPLOAD_LADDER.map(Number).filter(Number.isFinite))]
  .sort((a, b) => b - a)
  .join('|');
const VARIANT_RE = new RegExp(`^(.*)-(?:${WIDTHS})\\.webp$`, 'i');
/* Stop at every character that cannot occur in a server-generated filename.
   A fixed delimiter allowlist is unsafe here: rich text can put paths before
   entities, Markdown punctuation, a backslash, or future syntax we did not
   predict. Dots remain valid inside names, then sentence punctuation is
   stripped after the match. This deliberately prefers a false reference over
   falsely declaring a live file unused. */
const EMBEDDED_UPLOAD_RE = /\/uploads\/(images|videos)\/([A-Za-z0-9][A-Za-z0-9_.-]*)/g;
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
        const name = match[2].replace(/\.+$/, '');
        if (SAFE_NAME.test(name)) references.add(`${match[1]}/${name}`);
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
    quarantineDays: Math.round(UPLOAD_QUARANTINE_RETENTION_MS / (24 * 60 * 60 * 1000)),
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

/** Move one exact upload or responsive family out of the public tree.
 *
 * The batch directory keeps the original kind/name layout, which makes a
 * manual restore unambiguous, while its leading epoch records the earliest
 * time it may be purged. Moving within UPLOAD_DIR stays on one filesystem and
 * is atomic per file. */
export function quarantineUploadSet(uploadDir, url, {
  now = Date.now(),
  retentionMs = UPLOAD_QUARANTINE_RETENTION_MS,
} = {}) {
  const target = parseUploadUrl(url);
  if (!target) return { invalid: true, moved: [], stuck: [], bytes: 0, batch: '', restoreUntil: '' };
  const sourceDir = path.join(uploadDir, target.kind);
  const targetFamily = familyKey(target.kind, target.name);
  let entries = [];
  try {
    entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  } catch {
    return { invalid: false, moved: [], stuck: [], bytes: 0, batch: '', restoreUntil: '' };
  }
  const names = entries
    .filter((entry) => entry.isFile() && SAFE_NAME.test(entry.name) && familyKey(target.kind, entry.name) === targetFamily)
    .map((entry) => entry.name)
    .sort();
  if (!names.length) return { invalid: false, moved: [], stuck: [], bytes: 0, batch: '', restoreUntil: '' };

  const quarantineRoot = path.join(uploadDir, QUARANTINE_DIR);
  fs.mkdirSync(quarantineRoot, { recursive: true, mode: 0o700 });
  const batchDir = fs.mkdtempSync(path.join(quarantineRoot, `${Math.trunc(Number(now) || Date.now())}-`));
  const destinationDir = path.join(batchDir, target.kind);
  fs.mkdirSync(destinationDir, { recursive: true, mode: 0o700 });

  const moved = [];
  const stuck = [];
  let bytes = 0;
  for (const name of names) {
    const source = path.join(sourceDir, name);
    const destination = path.join(destinationDir, name);
    let size = 0;
    try { size = fs.statSync(source).size; } catch {}
    try {
      fs.renameSync(source, destination);
      moved.push(name);
      bytes += size;
    } catch {
      stuck.push(name);
    }
  }

  if (!moved.length) {
    try { fs.rmSync(batchDir, { recursive: true, force: true }); } catch {}
    return { invalid: false, moved, stuck, bytes, batch: '', restoreUntil: '' };
  }

  const createdAt = new Date(Number(now) || Date.now());
  const safeRetention = Math.max(0, Number(retentionMs) || 0);
  const restoreUntil = new Date(createdAt.getTime() + safeRetention).toISOString();
  try {
    fs.writeFileSync(
      path.join(batchDir, 'manifest.json'),
      JSON.stringify({
        createdAt: createdAt.toISOString(),
        restoreUntil,
        originalUrl: url,
        files: moved.map((name) => ({ kind: target.kind, name })),
      }, null, 2),
      { mode: 0o600 },
    );
  } catch {
    /* The kind/name directory remains sufficient for a manual restore. */
  }
  return {
    invalid: false,
    moved,
    stuck,
    bytes,
    batch: path.basename(batchDir),
    restoreUntil,
  };
}

const quarantineTreeStats = (root) => {
  const stack = [root];
  let files = 0;
  let bytes = 0;
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const item = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(item);
      else if (entry.isFile()) {
        files += 1;
        try { bytes += fs.statSync(item).size; } catch {}
      }
    }
  }
  return { files, bytes };
};

/** Permanently purge only quarantine batches whose encoded creation time is
 * older than the retention period. The daily CLI calls this automatically;
 * confirmed cleanup also invokes it opportunistically. Unknown names stay. */
export function purgeExpiredUploadQuarantine(uploadDir, {
  now = Date.now(),
  retentionMs = UPLOAD_QUARANTINE_RETENTION_MS,
} = {}) {
  const root = path.join(uploadDir, QUARANTINE_DIR);
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch {
    return { batches: 0, files: 0, bytes: 0, stuck: [] };
  }
  const safeNow = Number(now) || Date.now();
  const safeRetention = Math.max(0, Number(retentionMs) || 0);
  let batches = 0;
  let files = 0;
  let bytes = 0;
  const stuck = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = entry.name.match(/^(\d{10,})-/);
    const createdAt = match ? Number(match[1]) : NaN;
    if (!Number.isFinite(createdAt) || safeNow - createdAt < safeRetention) continue;
    const batch = path.join(root, entry.name);
    const stats = quarantineTreeStats(batch);
    try {
      fs.rmSync(batch, { recursive: true, force: true });
      batches += 1;
      files += stats.files;
      bytes += stats.bytes;
    } catch {
      stuck.push(entry.name);
    }
  }
  return { batches, files, bytes, stuck };
}

/**
 * Rescan at confirmation time, then quarantine only URLs that are still old
 * and unused. A file referenced between preview and confirmation is skipped.
 * Expired batches are also purged opportunistically during confirmation; the
 * independent daily command means expiry no longer depends on another Admin
 * cleanup. Preview itself never performs a destructive operation.
 */
export function deleteUnusedUploads(uploadDir, content, urls, options = {}) {
  const requested = [...new Set(Array.isArray(urls) ? urls.filter((url) => typeof url === 'string') : [])]
    .slice(0, MAX_UNUSED_UPLOAD_BATCH);
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const retentionMs = Number.isFinite(Number(options.quarantineRetentionMs))
    ? Math.max(0, Number(options.quarantineRetentionMs))
    : UPLOAD_QUARANTINE_RETENTION_MS;
  const current = listUnusedUploads(uploadDir, content, { ...options, now, limit: MAX_UNUSED_UPLOAD_BATCH });
  const candidates = new Map(current.items.map((item) => [item.url, item]));
  const purged = purgeExpiredUploadQuarantine(uploadDir, { now, retentionMs });
  const quarantined = [];
  const skipped = [];
  const stuck = [];
  let bytes = 0;

  for (const url of requested) {
    const candidate = candidates.get(url);
    if (!candidate) {
      skipped.push(url);
      continue;
    }
    const result = quarantineUploadSet(uploadDir, url, { now, retentionMs });
    if (result.moved.length) {
      quarantined.push({
        url,
        fileCount: result.moved.length,
        bytes: result.bytes,
        batch: result.batch,
        restoreUntil: result.restoreUntil,
      });
      bytes += result.bytes;
    }
    for (const name of result.stuck) stuck.push(`/uploads/${candidate.type === 'image' ? 'images' : 'videos'}/${name}`);
    if (!result.moved.length && !result.stuck.length) skipped.push(url);
  }

  return {
    /* `removed` is retained as an API-compatibility alias: these entries were
       removed from the live public tree, but remain recoverable in quarantine. */
    removed: quarantined,
    quarantined,
    skipped,
    stuck,
    bytes,
    quarantineDays: Math.round(retentionMs / (24 * 60 * 60 * 1000)),
    purged,
  };
}
