#!/usr/bin/env node
/* Daily, non-interactive expiry for the upload recycle bin.

   Run this from a systemd timer (or a cPanel cron job) as the same service
   account that owns UPLOAD_DIR. It deliberately knows nothing about live
   content: only batches already quarantined for the full fixed retention
   period are eligible, and unknown directory names remain untouched. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  purgeExpiredUploadQuarantine,
  UPLOAD_QUARANTINE_RETENTION_MS,
} from '../server/uploadCleanup.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uploadDir = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(ROOT, 'server', 'uploads');

try {
  const stat = fs.statSync(uploadDir);
  if (!stat.isDirectory()) throw new Error('UPLOAD_DIR is not a directory');

  const result = purgeExpiredUploadQuarantine(uploadDir, {
    retentionMs: UPLOAD_QUARANTINE_RETENTION_MS,
  });
  const report = {
    ok: result.stuck.length === 0,
    uploadDir,
    retentionDays: Math.round(UPLOAD_QUARANTINE_RETENTION_MS / (24 * 60 * 60 * 1000)),
    purgedBatches: result.batches,
    purgedFiles: result.files,
    purgedBytes: result.bytes,
    stuck: result.stuck,
    completedAt: new Date().toISOString(),
  };
  console.log(JSON.stringify(report));
  if (result.stuck.length) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    uploadDir,
    error: error?.message || String(error),
    completedAt: new Date().toISOString(),
  }));
  process.exitCode = 1;
}
