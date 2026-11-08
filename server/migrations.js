/* ==========================================================================
   Explicit SQLite schema migrations.
   --------------------------------------------------------------------------
   Startup remains validation-only. This module is reached exclusively through
   `npm run db:migrate` (or tests) and never from server/index.js.

   Adding a schema revision requires ALL of:
     1. bumping DATABASE_SCHEMA_VERSION and the final schema in server/db.js;
     2. registering one adjacent, synchronous migration below;
     3. updating backup-contract checks, migration tests, and deployment docs.

   A migration is offline by default. Set onlineCompatible: true only after the
   old and new application releases have both been proved safe against the
   expanded schema during a rolling deployment. Destructive/contract changes
   must remain offline and require the operator's --app-stopped attestation.
   ========================================================================== */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  DATABASE_APPLICATION_ID,
  DATABASE_SCHEMA_VERSION,
  validateCurrentSchema,
} from './db.js';
import { createDatabase } from './sqlite.js';

export const DEFAULT_MIGRATION_MIN_FREE_BYTES = 1024 ** 3;
export const DEFAULT_MIGRATION_ATTEMPTS = 3;

/* There is no legacy upgrade in the current release. This registry is the
   reviewed, forward-only place for future versions; never infer a schema from
   whatever columns happen to be present. */
export const SCHEMA_MIGRATIONS = Object.freeze([
  // Example shape (remove this comment when v2 exists):
  // {
  //   id: '001-add-example-column', from: 1, to: 2,
  //   description: 'Add the example column without rewriting existing rows',
  //   onlineCompatible: true,
  //   validateSource(db) { validateSchemaV1(db); },
  //   up(db) { db.exec('ALTER TABLE ...'); },
  // },
]);

const migrationError = (code, message, cause) => Object.assign(
  new Error(message, cause ? { cause } : undefined),
  { code },
);

const pragmaNumber = (db, name) => {
  const row = db.prepare(`PRAGMA ${name}`).get();
  return Number(row?.[name] ?? Object.values(row || {})[0] ?? 0);
};

export function inspectMigrationState(db) {
  return {
    applicationId: pragmaNumber(db, 'application_id'),
    schemaVersion: pragmaNumber(db, 'user_version'),
    dataVersion: pragmaNumber(db, 'data_version'),
  };
}

const validateMigration = (migration) => {
  if (!migration || typeof migration !== 'object' || Array.isArray(migration)) {
    throw migrationError('DB_MIGRATION_REGISTRY_INVALID', 'migration registry contains a non-object entry');
  }
  const { id, from, to, description, onlineCompatible, validateSource, up } = migration;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(id || ''))) {
    throw migrationError('DB_MIGRATION_REGISTRY_INVALID', `invalid migration id: ${String(id || '')}`);
  }
  if (!Number.isSafeInteger(from) || from < 1 || !Number.isSafeInteger(to) || to !== from + 1) {
    throw migrationError('DB_MIGRATION_REGISTRY_INVALID', `${id} must advance exactly one positive schema version`);
  }
  if (typeof description !== 'string' || !description.trim()) {
    throw migrationError('DB_MIGRATION_REGISTRY_INVALID', `${id} has no description`);
  }
  if (typeof onlineCompatible !== 'boolean') {
    throw migrationError('DB_MIGRATION_REGISTRY_INVALID', `${id} must explicitly declare onlineCompatible`);
  }
  if (typeof validateSource !== 'function') {
    throw migrationError('DB_MIGRATION_REGISTRY_INVALID', `${id} has no source-schema validator`);
  }
  if (typeof up !== 'function') {
    throw migrationError('DB_MIGRATION_REGISTRY_INVALID', `${id} has no synchronous up() function`);
  }
};

export function planSchemaMigrations(
  fromVersion,
  targetVersion = DATABASE_SCHEMA_VERSION,
  migrations = SCHEMA_MIGRATIONS,
) {
  if (!Number.isSafeInteger(fromVersion) || fromVersion < 1) {
    throw migrationError('DB_MIGRATION_VERSION_INVALID', `invalid source schema version: ${fromVersion}`);
  }
  if (!Number.isSafeInteger(targetVersion) || targetVersion < 1) {
    throw migrationError('DB_MIGRATION_VERSION_INVALID', `invalid target schema version: ${targetVersion}`);
  }
  if (fromVersion > targetVersion) {
    throw migrationError(
      'DB_SCHEMA_NEWER_THAN_CODE',
      `database schema v${fromVersion} is newer than this release (v${targetVersion}); use matching code`,
    );
  }
  if (!Array.isArray(migrations)) {
    throw migrationError('DB_MIGRATION_REGISTRY_INVALID', 'migration registry must be an array');
  }

  const byFrom = new Map();
  const ids = new Set();
  for (const migration of migrations) {
    validateMigration(migration);
    if (ids.has(migration.id) || byFrom.has(migration.from)) {
      throw migrationError(
        'DB_MIGRATION_REGISTRY_INVALID',
        `duplicate migration id or source version at ${migration.id}`,
      );
    }
    ids.add(migration.id);
    byFrom.set(migration.from, migration);
  }

  const plan = [];
  let version = fromVersion;
  while (version < targetVersion) {
    const migration = byFrom.get(version);
    if (!migration || migration.to > targetVersion) {
      throw migrationError(
        'DB_MIGRATION_PATH_MISSING',
        `no reviewed migration path from schema v${version} to v${version + 1}`,
      );
    }
    plan.push(migration);
    version = migration.to;
  }
  return Object.freeze([...plan]);
}

export function assertDatabaseHealth(db, label = 'database') {
  const integrityRows = db.prepare('PRAGMA integrity_check').all();
  const integrity = integrityRows.map((row) => String(Object.values(row)[0] ?? ''));
  if (integrity.length !== 1 || integrity[0] !== 'ok') {
    throw migrationError(
      'DB_MIGRATION_INTEGRITY_FAILED',
      `${label} failed PRAGMA integrity_check: ${integrity.join('; ') || 'no result'}`,
    );
  }
  const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
  if (foreignKeys.length) {
    throw migrationError(
      'DB_MIGRATION_FOREIGN_KEYS_FAILED',
      `${label} has ${foreignKeys.length} foreign-key violation(s)`,
    );
  }
  return true;
}

const assertApplicationIdentity = (state) => {
  if (state.applicationId !== DATABASE_APPLICATION_ID) {
    throw migrationError(
      'DB_MIGRATION_WRONG_APPLICATION',
      `refusing database with application_id=${state.applicationId}; expected ${DATABASE_APPLICATION_ID}`,
    );
  }
};

const safeInteger = (value, fallback, label) => {
  const parsed = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw migrationError('DB_MIGRATION_CONFIG_INVALID', `${label} must be a non-negative safe integer`);
  }
  return parsed;
};

const fileBytes = (file) => {
  try { return fs.statSync(file).size; } catch { return 0; }
};

export function migrationBackupPreflight(
  databaseFile,
  backupDirectory,
  minimumFreeBytes = DEFAULT_MIGRATION_MIN_FREE_BYTES,
) {
  const reserve = BigInt(safeInteger(minimumFreeBytes, DEFAULT_MIGRATION_MIN_FREE_BYTES, 'minimum free bytes'));
  fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
  const stat = fs.statSync(backupDirectory);
  if (!stat.isDirectory()) {
    throw migrationError('DB_MIGRATION_BACKUP_INVALID', `backup path is not a directory: ${backupDirectory}`);
  }
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    throw migrationError(
      'DB_MIGRATION_BACKUP_PERMISSIONS',
      `backup directory must not grant group/other access (expected mode 0700): ${backupDirectory}`,
    );
  }
  const sourceBytes = BigInt(
    fileBytes(databaseFile) + fileBytes(`${databaseFile}-wal`) + fileBytes(`${databaseFile}-shm`),
  );
  const requiredBytes = sourceBytes * 2n + reserve;
  const filesystem = fs.statfsSync(backupDirectory, { bigint: true });
  const availableBytes = filesystem.bavail * filesystem.bsize;
  if (availableBytes < requiredBytes) {
    throw migrationError(
      'DB_MIGRATION_DISK_SPACE',
      `insufficient backup space: need ${requiredBytes} bytes, have ${availableBytes} bytes`,
    );
  }
  const sourceFilesystem = fs.statfsSync(path.dirname(databaseFile), { bigint: true });
  const sourceAvailableBytes = sourceFilesystem.bavail * sourceFilesystem.bsize;
  const sourceRequiredBytes = sourceBytes + reserve;
  if (sourceAvailableBytes < sourceRequiredBytes) {
    throw migrationError(
      'DB_MIGRATION_DISK_SPACE',
      `insufficient database-filesystem space: need ${sourceRequiredBytes} bytes, have ${sourceAvailableBytes} bytes`,
    );
  }
  return {
    sourceBytes,
    requiredBytes,
    availableBytes,
    sourceRequiredBytes,
    sourceAvailableBytes,
  };
}

const sha256File = (file) => new Promise((resolve, reject) => {
  const hash = crypto.createHash('sha256');
  const input = fs.createReadStream(file);
  input.on('error', reject);
  input.on('data', (chunk) => hash.update(chunk));
  input.on('end', () => resolve(hash.digest('hex')));
});

const syncFile = (file) => {
  const descriptor = fs.openSync(file, 'r');
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
};

const syncDirectory = (directory) => {
  let descriptor;
  try {
    descriptor = fs.openSync(directory, 'r');
    fs.fsyncSync(descriptor);
  } catch (error) {
    /* Windows does not permit fsync on directory handles. File fsync + atomic
       rename remains the strongest available behavior there. */
    if (process.platform !== 'win32') throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
};

const removeBackupFiles = (backup) => {
  if (!backup) return;
  for (const file of [backup.file, backup.manifest]) {
    if (!file) continue;
    try { fs.rmSync(file, { force: true }); } catch {}
  }
};

export async function createVerifiedMigrationBackup(db, {
  databaseFile,
  backupDirectory,
  fromVersion,
  targetVersion,
  validateSource,
  minimumFreeBytes = DEFAULT_MIGRATION_MIN_FREE_BYTES,
  now = new Date(),
} = {}) {
  if (!databaseFile || !backupDirectory) {
    throw migrationError('DB_MIGRATION_BACKUP_INVALID', 'databaseFile and backupDirectory are required');
  }
  if (typeof validateSource !== 'function') {
    throw migrationError('DB_MIGRATION_BACKUP_INVALID', 'a source-schema validator is required');
  }
  migrationBackupPreflight(databaseFile, backupDirectory, minimumFreeBytes);

  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const nonce = crypto.randomBytes(8).toString('hex');
  const stem = `${path.basename(databaseFile)}-schema-v${fromVersion}-to-v${targetVersion}-${stamp}-${nonce}`;
  const finalFile = path.join(backupDirectory, `${stem}.db`);
  const finalManifest = `${finalFile}.json`;
  const pendingFile = path.join(backupDirectory, `.${stem}.db.pending`);
  const pendingManifest = `${pendingFile}.json`;
  let published = false;

  try {
    await db.backup(pendingFile);
    fs.chmodSync(pendingFile, 0o600);

    const snapshot = await createDatabase(pendingFile, { readOnly: true, mustExist: true });
    try {
      const state = inspectMigrationState(snapshot);
      assertApplicationIdentity(state);
      if (state.schemaVersion !== fromVersion) {
        throw migrationError(
          'DB_MIGRATION_BACKUP_INVALID',
          `backup schema changed during snapshot: expected v${fromVersion}, got v${state.schemaVersion}`,
        );
      }
      validateSource(snapshot);
      assertDatabaseHealth(snapshot, 'migration backup');
    } finally {
      snapshot.close();
    }

    syncFile(pendingFile);
    const sha256 = await sha256File(pendingFile);
    const bytes = fs.statSync(pendingFile).size;
    const manifest = {
      format: 1,
      kind: 'khyeast-pre-schema-migration',
      createdAt: now.toISOString(),
      database: path.resolve(databaseFile),
      backup: path.basename(finalFile),
      applicationId: DATABASE_APPLICATION_ID,
      fromVersion,
      targetVersion,
      bytes,
      sha256,
    };
    fs.writeFileSync(pendingManifest, `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    syncFile(pendingManifest);
    fs.renameSync(pendingFile, finalFile);
    fs.renameSync(pendingManifest, finalManifest);
    syncDirectory(backupDirectory);
    published = true;
    return { file: finalFile, manifest: finalManifest, sha256, bytes };
  } finally {
    for (const file of [pendingFile, pendingManifest]) {
      try { fs.rmSync(file, { force: true }); } catch {}
    }
    if (!published) removeBackupFiles({ file: finalFile, manifest: finalManifest });
  }
}

export function executeMigrationPlan(db, plan, {
  expectedDataVersion,
  validateFinal,
} = {}) {
  if (!Array.isArray(plan) || !plan.length) return { applied: [] };
  const applied = [];
  return db.immediateTransaction(() => {
    const initial = inspectMigrationState(db);
    assertApplicationIdentity(initial);
    if (expectedDataVersion !== undefined && initial.dataVersion !== expectedDataVersion) {
      throw migrationError(
        'DB_MIGRATION_SOURCE_CHANGED',
        'database changed after the verified backup; retrying is required',
      );
    }
    if (initial.schemaVersion !== plan[0].from) {
      throw migrationError(
        'DB_MIGRATION_SOURCE_CHANGED',
        `schema changed before migration: expected v${plan[0].from}, got v${initial.schemaVersion}`,
      );
    }

    for (const migration of plan) {
      const current = pragmaNumber(db, 'user_version');
      if (current !== migration.from) {
        throw migrationError(
          'DB_MIGRATION_SOURCE_CHANGED',
          `${migration.id} expected v${migration.from}, got v${current}`,
        );
      }
      migration.validateSource(db);
      const result = migration.up(db);
      if (result && typeof result.then === 'function') {
        throw migrationError(
          'DB_MIGRATION_ASYNC_FORBIDDEN',
          `${migration.id} returned a Promise; migration steps must be synchronous and transactional`,
        );
      }
      db.exec(`PRAGMA user_version = ${migration.to}`);
      applied.push(migration.id);
    }

    if (typeof validateFinal === 'function') validateFinal(db);
    assertDatabaseHealth(db, 'migrated database');
    return { applied: [...applied] };
  })();
}

export async function migrateDatabase({
  databaseFile,
  backupDirectory,
  dryRun = false,
  appStopped = false,
  minimumFreeBytes = DEFAULT_MIGRATION_MIN_FREE_BYTES,
  attempts = DEFAULT_MIGRATION_ATTEMPTS,
  targetVersion = DATABASE_SCHEMA_VERSION,
  migrations = SCHEMA_MIGRATIONS,
  validateFinal = targetVersion === DATABASE_SCHEMA_VERSION ? validateCurrentSchema : undefined,
} = {}) {
  if (!databaseFile || !fs.existsSync(databaseFile)) {
    throw migrationError(
      'DB_MIGRATION_DATABASE_MISSING',
      `database does not exist; migrations never create or initialize state: ${databaseFile || '(unset)'}`,
    );
  }
  const realDatabase = fs.realpathSync(databaseFile);
  const stat = fs.statSync(realDatabase);
  if (!stat.isFile()) {
    throw migrationError('DB_MIGRATION_DATABASE_INVALID', `database path is not a regular file: ${realDatabase}`);
  }
  const realBackupDirectory = path.resolve(
    backupDirectory || path.join(path.dirname(realDatabase), 'migration-backups'),
  );
  const maxAttempts = safeInteger(attempts, DEFAULT_MIGRATION_ATTEMPTS, 'migration attempts');
  if (maxAttempts < 1) {
    throw migrationError('DB_MIGRATION_CONFIG_INVALID', 'migration attempts must be at least 1');
  }

  const db = await createDatabase(realDatabase, { mustExist: true });
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 10000');
  try {
    const initial = inspectMigrationState(db);
    assertApplicationIdentity(initial);
    const plan = planSchemaMigrations(initial.schemaVersion, targetVersion, migrations);
    if (!plan.length) {
      if (typeof validateFinal === 'function') validateFinal(db);
      assertDatabaseHealth(db, 'current database');
      return {
        status: 'up-to-date',
        fromVersion: initial.schemaVersion,
        targetVersion,
        plan: [],
        backup: null,
      };
    }

    plan[0].validateSource(db);
    assertDatabaseHealth(db, 'source database');
    const requiresStoppedApp = plan.some((migration) => migration.onlineCompatible !== true);
    if (dryRun) {
      return {
        status: 'planned',
        fromVersion: initial.schemaVersion,
        targetVersion,
        requiresStoppedApp,
        plan: plan.map(({ id, from, to, description, onlineCompatible }) => ({
          id, from, to, description, onlineCompatible,
        })),
        backup: null,
      };
    }
    if (requiresStoppedApp && !appStopped) {
      throw migrationError(
        'DB_MIGRATION_APP_STOP_REQUIRED',
        'this migration is not declared rolling-deployment compatible; stop/drain every app worker and rerun with --app-stopped',
      );
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const beforeBackup = inspectMigrationState(db);
      if (beforeBackup.schemaVersion === targetVersion) {
        if (typeof validateFinal === 'function') validateFinal(db);
        assertDatabaseHealth(db, 'database migrated by another process');
        return {
          status: 'up-to-date',
          fromVersion: initial.schemaVersion,
          targetVersion,
          plan: [],
          backup: null,
          concurrent: true,
        };
      }
      if (beforeBackup.schemaVersion !== initial.schemaVersion) {
        throw migrationError(
          'DB_MIGRATION_SOURCE_CHANGED',
          `schema changed from v${initial.schemaVersion} to v${beforeBackup.schemaVersion} while planning`,
        );
      }

      const backup = await createVerifiedMigrationBackup(db, {
        databaseFile: realDatabase,
        backupDirectory: realBackupDirectory,
        fromVersion: initial.schemaVersion,
        targetVersion,
        validateSource: plan[0].validateSource,
        minimumFreeBytes,
      });
      const afterBackup = inspectMigrationState(db);
      if (
        afterBackup.dataVersion !== beforeBackup.dataVersion ||
        afterBackup.schemaVersion !== beforeBackup.schemaVersion
      ) {
        removeBackupFiles(backup);
        continue;
      }

      try {
        const result = executeMigrationPlan(db, plan, {
          expectedDataVersion: afterBackup.dataVersion,
          validateFinal,
        });
        return {
          status: 'migrated',
          fromVersion: initial.schemaVersion,
          targetVersion,
          plan: result.applied,
          backup,
          attempt,
        };
      } catch (error) {
        if (error?.code !== 'DB_MIGRATION_SOURCE_CHANGED') throw error;
        removeBackupFiles(backup);
      }
    }

    throw migrationError(
      'DB_MIGRATION_BUSY',
      `database changed during ${maxAttempts} backup attempt(s); drain writers and retry`,
    );
  } finally {
    db.close();
  }
}
