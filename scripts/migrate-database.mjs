#!/usr/bin/env node
/* Explicit operator entry point for reviewed SQLite schema migrations.
   Application startup never imports this file and remains validation-only. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateDatabase } from '../server/migrations.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SERVER_DIR = path.join(ROOT, 'server');

const loadEnvironmentFile = (file) => {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
    if (value && process.env[key] === undefined) process.env[key] = value;
  }
};

/* Match server/index.js: server/.env wins over the repository-level file, and
   an already exported process variable wins over both. */
loadEnvironmentFile(path.join(SERVER_DIR, '.env'));
loadEnvironmentFile(path.join(ROOT, '.env'));

const usage = `Usage: npm run db:migrate -- [options]

Options:
  --dry-run                 Validate and print the reviewed migration plan only
  --app-stopped             Attest that every application worker is stopped/drained
  --database <path>         Override DB_FILE for this invocation
  --backup-dir <path>       Override MIGRATION_BACKUP_DIR for this invocation
  --help                    Show this help

Exit status:
  0  Current schema or successful migration
  3  Dry-run found a non-empty migration plan (no writes)
  1  Validation/migration failure
  2  Invalid command usage

Environment:
  DB_FILE, DATA_DIR, MIGRATION_BACKUP_DIR
  MIGRATION_MIN_FREE_BYTES  Backup filesystem reserve (default: 1 GiB)
  MIGRATION_ATTEMPTS        Stable backup/data-version attempts (default: 3)

The command never creates a missing database, never infers an unknown schema,
and always makes and verifies a SQLite backup before applying a non-empty plan.
`;

const options = { dryRun: false, appStopped: false };
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === '--help' || argument === '-h') {
    console.log(usage);
    process.exit(0);
  }
  if (argument === '--dry-run') {
    options.dryRun = true;
    continue;
  }
  if (argument === '--app-stopped') {
    options.appStopped = true;
    continue;
  }
  const equalsAt = argument.indexOf('=');
  const inlineName = equalsAt >= 0 ? argument.slice(0, equalsAt) : argument;
  const inlineValue = equalsAt >= 0 ? argument.slice(equalsAt + 1) : undefined;
  if (inlineName === '--database' || inlineName === '--backup-dir') {
    const value = inlineValue ?? args[++index];
    if (!value || value.startsWith('--')) {
      console.error(`db:migrate: ${inlineName} requires a path`);
      process.exit(2);
    }
    if (inlineName === '--database') options.databaseFile = path.resolve(value);
    else options.backupDirectory = path.resolve(value);
    continue;
  }
  console.error(`db:migrate: unknown option: ${argument}\n\n${usage}`);
  process.exit(2);
}

const dataDirectory = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(SERVER_DIR, 'data');
options.databaseFile ||= process.env.DB_FILE
  ? path.resolve(process.env.DB_FILE)
  : path.join(dataDirectory, 'khyeast.db');
const databaseDirectory = path.dirname(options.databaseFile);
const defaultBackupRoot = path.resolve(databaseDirectory) === path.resolve(dataDirectory)
  ? path.dirname(dataDirectory)
  : databaseDirectory;
options.backupDirectory ||= process.env.MIGRATION_BACKUP_DIR
  ? path.resolve(process.env.MIGRATION_BACKUP_DIR)
  : path.join(defaultBackupRoot, 'migration-backups');
options.minimumFreeBytes = process.env.MIGRATION_MIN_FREE_BYTES;
options.attempts = process.env.MIGRATION_ATTEMPTS;

try {
  const result = await migrateDatabase(options);
  if (result.status === 'up-to-date') {
    const concurrent = result.concurrent ? ' (completed concurrently by another migrator)' : '';
    console.log(`db:migrate: schema v${result.targetVersion} is already current${concurrent}; no migration or backup was needed.`);
  } else if (result.status === 'planned') {
    console.log(`db:migrate: plan v${result.fromVersion} -> v${result.targetVersion}`);
    for (const migration of result.plan) {
      console.log(
        `  ${migration.id}: v${migration.from} -> v${migration.to} — ${migration.description} ` +
        `[${migration.onlineCompatible ? 'rolling-compatible' : 'app stop required'}]`,
      );
    }
    console.log('db:migrate: dry run only; database and filesystem were not changed.');
    process.exitCode = 3;
  } else {
    console.log(
      `db:migrate: migrated v${result.fromVersion} -> v${result.targetVersion}: ` +
      result.plan.join(', '),
    );
    console.log(`db:migrate: verified backup: ${result.backup.file}`);
    console.log(`db:migrate: backup sha256: ${result.backup.sha256}`);
  }
} catch (error) {
  console.error(`db:migrate: FAILED [${error?.code || 'ERROR'}] ${error?.message || error}`);
  process.exitCode = 1;
}
