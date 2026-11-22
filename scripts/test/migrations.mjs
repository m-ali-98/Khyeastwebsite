/* Explicit migration runner: reviewed paths only, transactional rollback,
   data-version fencing, verified pre-change backups, and no implicit creation. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../../server/db.js';
import { createDatabase } from '../../server/sqlite.js';
import {
  createVerifiedMigrationBackup,
  executeMigrationPlan,
  inspectMigrationState,
  migrateDatabase,
  migrationBackupPreflight,
  planSchemaMigrations,
} from '../../server/migrations.js';

let pass = 0;
let fail = 0;
const check = (condition, label, detail = '') => {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log(`LEAK ${label}${detail ? ` — ${detail}` : ''}`);
  }
};
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ky-migrations-'));
const freshDatabase = async (name) => {
  const file = path.join(root, name);
  const db = await store.openDB(file);
  store.initializeStore(db, { freshInstall: true });
  return { file, db };
};
const migrationV2 = {
  id: '001-add-migration-probe',
  from: 1,
  to: 2,
  description: 'Add a test-only probe table',
  onlineCompatible: false,
  validateSource: store.validateCurrentSchema,
  up(db) {
    db.exec('CREATE TABLE migration_probe (value TEXT NOT NULL)');
    db.prepare('INSERT INTO migration_probe(value) VALUES (?)').run('preserved');
  },
};
const validateV2 = (db) => {
  if (inspectMigrationState(db).schemaVersion !== 2) throw new Error('not schema v2');
  const columns = db.prepare('PRAGMA table_info(migration_probe)').all().map((column) => column.name);
  if (columns.join(',') !== 'value') throw new Error('migration_probe contract is invalid');
};

try {
  check(planSchemaMigrations(1).length === 0, 'the current schema has an empty explicit plan');

  for (const [operation, code, label] of [
    [() => planSchemaMigrations(2, 1, []), 'DB_SCHEMA_NEWER_THAN_CODE', 'newer databases are never downgraded'],
    [() => planSchemaMigrations(1, 2, []), 'DB_MIGRATION_PATH_MISSING', 'missing versions are never inferred'],
    [
      () => planSchemaMigrations(1, 3, [{ ...migrationV2, to: 3 }]),
      'DB_MIGRATION_REGISTRY_INVALID',
      'a migration cannot skip a schema version',
    ],
    [
      () => planSchemaMigrations(1, 2, [{ ...migrationV2, validateSource: undefined }]),
      'DB_MIGRATION_REGISTRY_INVALID',
      'every migration must declare its exact source-schema validator',
    ],
  ]) {
    let actual = '';
    try { operation(); } catch (error) { actual = error.code; }
    check(actual === code, label, actual);
  }

  {
    const directory = path.join(root, 'unsafe-backup-permissions');
    fs.mkdirSync(directory, { mode: 0o755 });
    fs.chmodSync(directory, 0o755);
    let code = '';
    try { migrationBackupPreflight(path.join(root, 'unused.db'), directory, 0); }
    catch (error) { code = error.code; }
    check(
      process.platform === 'win32' || code === 'DB_MIGRATION_BACKUP_PERMISSIONS',
      'migration backups refuse group/world-readable directories',
      code,
    );
  }

  /* Matching application/version pragmas are not enough: an exact source
     schema contract must pass before a recovery point or DDL is attempted. */
  {
    const { file, db } = await freshDatabase('source-schema-drift.db');
    db.exec('DROP INDEX idx_messages_at');
    db.close();
    const backupDirectory = path.join(root, 'source-schema-drift-backups');
    let code = '';
    try {
      await migrateDatabase({
        databaseFile: file,
        backupDirectory,
        appStopped: true,
        targetVersion: 2,
        migrations: [migrationV2],
        validateFinal: validateV2,
        minimumFreeBytes: 0,
      });
    } catch (error) { code = error.code; }
    const unchanged = await createDatabase(file, { readOnly: true, mustExist: true });
    const state = inspectMigrationState(unchanged);
    const probeCount = unchanged.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' AND name = 'migration_probe'",
    ).get()?.count;
    unchanged.close();
    check(
      code === 'DB_SCHEMA_INCOMPATIBLE' && state.schemaVersion === 1 &&
        Number(probeCount) === 0 && !fs.existsSync(backupDirectory),
      'source-schema drift is refused before backup or migration writes',
      code,
    );
  }

  /* A SQLite-native snapshot is verified before any schema statement runs. */
  {
    const { file, db } = await freshDatabase('backup-source.db');
    const backupDirectory = path.join(root, 'verified-backups');
    let sourceValidationCalls = 0;
    const backup = await createVerifiedMigrationBackup(db, {
      databaseFile: file,
      backupDirectory,
      fromVersion: 1,
      targetVersion: 2,
      validateSource(snapshot) {
        sourceValidationCalls += 1;
        store.validateCurrentSchema(snapshot);
      },
      minimumFreeBytes: 0,
      now: new Date('2026-09-08T12:00:00.000Z'),
    });
    const manifest = JSON.parse(fs.readFileSync(backup.manifest, 'utf8'));
    const hash = crypto.createHash('sha256').update(fs.readFileSync(backup.file)).digest('hex');
    const snapshot = await createDatabase(backup.file, { readOnly: true, mustExist: true });
    const snapshotState = inspectMigrationState(snapshot);
    snapshot.close();
    check(
      fs.existsSync(backup.file) && fs.existsSync(backup.manifest) && sourceValidationCalls === 1 &&
        manifest.kind === 'khyeast-pre-schema-migration' && manifest.sha256 === hash &&
        snapshotState.applicationId === store.DATABASE_APPLICATION_ID && snapshotState.schemaVersion === 1,
      'pre-migration backup is SQLite-consistent, checksummed and manifested',
      JSON.stringify(manifest),
    );
    db.close();
  }

  /* Every step and user_version update shares one outer transaction. */
  {
    const { db } = await freshDatabase('rollback.db');
    const second = {
      id: '002-fail-deliberately',
      from: 2,
      to: 3,
      description: 'Prove the full plan rolls back',
      onlineCompatible: false,
      validateSource: validateV2,
      up(database) {
        database.exec('CREATE TABLE should_rollback (value TEXT)');
        throw new Error('deliberate failure');
      },
    };
    const plan = planSchemaMigrations(1, 3, [migrationV2, second]);
    let rejected = false;
    try { executeMigrationPlan(db, plan); } catch (error) { rejected = error.message === 'deliberate failure'; }
    const tables = db.prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN ('migration_probe', 'should_rollback')",
    ).all();
    check(
      rejected && inspectMigrationState(db).schemaVersion === 1 && tables.length === 0,
      'a failed multi-step migration rolls back DDL, data and user_version together',
    );
    db.close();
  }

  /* A write committed after the snapshot fence forces a retry instead of
     migrating state newer than its recovery point. */
  {
    const { file, db } = await freshDatabase('data-fence.db');
    const expected = inspectMigrationState(db).dataVersion;
    const writer = await createDatabase(file, { mustExist: true });
    writer.prepare("INSERT INTO settings(key, value) VALUES ('migration.test.race', '\"changed\"')").run();
    writer.close();
    let code = '';
    try {
      executeMigrationPlan(db, planSchemaMigrations(1, 2, [migrationV2]), {
        expectedDataVersion: expected,
        validateFinal: validateV2,
      });
    } catch (error) { code = error.code; }
    check(
      code === 'DB_MIGRATION_SOURCE_CHANGED' && inspectMigrationState(db).schemaVersion === 1,
      'the data-version fence rejects writes newer than the verified snapshot',
      code,
    );
    db.close();
  }

  /* Dry-run is useful before downtime and never requires the stop attestation. */
  {
    const { file, db } = await freshDatabase('dry-run.db');
    db.close();
    const backupDirectory = path.join(root, 'dry-run-backups');
    const result = await migrateDatabase({
      databaseFile: file,
      backupDirectory,
      dryRun: true,
      targetVersion: 2,
      migrations: [migrationV2],
      validateFinal: validateV2,
      minimumFreeBytes: 0,
    });
    const current = await createDatabase(file, { readOnly: true, mustExist: true });
    const version = inspectMigrationState(current).schemaVersion;
    current.close();
    check(
      result.status === 'planned' && result.requiresStoppedApp && version === 1 &&
        !fs.existsSync(backupDirectory),
      'dry-run reports downtime requirements without changing database or filesystem',
      JSON.stringify(result),
    );
  }

  /* Offline migrations fail before backup unless the operator explicitly
     attests that every worker has drained. */
  {
    const { file, db } = await freshDatabase('stop-required.db');
    db.close();
    const backupDirectory = path.join(root, 'stop-required-backups');
    let code = '';
    try {
      await migrateDatabase({
        databaseFile: file,
        backupDirectory,
        targetVersion: 2,
        migrations: [migrationV2],
        validateFinal: validateV2,
        minimumFreeBytes: 0,
      });
    } catch (error) { code = error.code; }
    check(
      code === 'DB_MIGRATION_APP_STOP_REQUIRED' && !fs.existsSync(backupDirectory),
      'offline migration requires --app-stopped before creating a backup or taking locks',
      code,
    );
  }

  /* End-to-end execution publishes a v1 backup and commits the reviewed v2
     contract only after backup and in-transaction validation succeed. */
  {
    const { file, db } = await freshDatabase('end-to-end.db');
    db.close();
    const backupDirectory = path.join(root, 'end-to-end-backups');
    const result = await migrateDatabase({
      databaseFile: file,
      backupDirectory,
      appStopped: true,
      targetVersion: 2,
      migrations: [migrationV2],
      validateFinal: validateV2,
      minimumFreeBytes: 0,
    });
    const migrated = await createDatabase(file, { readOnly: true, mustExist: true });
    const value = migrated.prepare('SELECT value FROM migration_probe').get()?.value;
    const version = inspectMigrationState(migrated).schemaVersion;
    migrated.close();
    const backup = await createDatabase(result.backup.file, { readOnly: true, mustExist: true });
    const backupVersion = inspectMigrationState(backup).schemaVersion;
    const backupProbe = backup.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' AND name = 'migration_probe'",
    ).get()?.count;
    backup.close();
    check(
      result.status === 'migrated' && result.plan.join(',') === migrationV2.id &&
        version === 2 && value === 'preserved' && backupVersion === 1 && Number(backupProbe) === 0,
      'explicit migration keeps a verified pre-change recovery point and commits the reviewed plan',
      JSON.stringify(result),
    );
  }

  /* Current production schema is a strict no-op: no needless backup directory. */
  {
    const { file, db } = await freshDatabase('current.db');
    db.close();
    const backupDirectory = path.join(root, 'current-backups');
    const result = await migrateDatabase({ databaseFile: file, backupDirectory, minimumFreeBytes: 0 });
    check(
      result.status === 'up-to-date' && result.plan.length === 0 && !fs.existsSync(backupDirectory),
      'current databases validate without a write or backup',
      JSON.stringify(result),
    );
  }

  /* A missing path is recovery/installation work, never an empty database. */
  {
    const file = path.join(root, 'must-not-be-created.db');
    let code = '';
    try { await migrateDatabase({ databaseFile: file }); } catch (error) { code = error.code; }
    check(
      code === 'DB_MIGRATION_DATABASE_MISSING' && !fs.existsSync(file),
      'migration command refuses to create a missing database',
      code,
    );
  }

  /* A foreign SQLite file is preserved byte-for-byte. */
  {
    const file = path.join(root, 'foreign.db');
    const foreign = await createDatabase(file);
    foreign.exec('CREATE TABLE foreign_state (value TEXT)');
    foreign.close();
    const before = fs.readFileSync(file);
    let code = '';
    try { await migrateDatabase({ databaseFile: file }); } catch (error) { code = error.code; }
    check(
      code === 'DB_MIGRATION_WRONG_APPLICATION' && before.equals(fs.readFileSync(file)),
      'foreign databases are rejected without mutation',
      code,
    );
  }
} catch (error) {
  check(false, 'migration harness', error?.stack || String(error));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`${pass}/${pass + fail}`);
if (fail) process.exit(1);
