/* ==========================================================================
   SQLite driver adapter.
   --------------------------------------------------------------------------
   Prefers `better-sqlite3` (fast native driver) and transparently falls back to
   Node's built-in `node:sqlite` when the native module is not compiled — so the
   app boots on any host without a build toolchain.

   Both drivers are exposed through the same small API used by server/db.js:
     db.exec(sql)
     db.pragma('journal_mode = WAL')
     db.prepare(sql).run(...) / .get(...) / .all(...)
     db.transaction(fn)          -> deferred outer transaction
     db.immediateTransaction(fn) -> writer-reserving outer transaction
     await db.backup(path)       -> SQLite-native consistent snapshot
     db.close()
   ========================================================================== */

import fs from 'node:fs';

/** Wrap node:sqlite's DatabaseSync in the better-sqlite3-shaped API. */
function wrapNodeSqlite(DatabaseSync, backupDatabase, file, { readOnly = false } = {}) {
  const raw = readOnly
    ? new DatabaseSync(file, { readOnly: true })
    : new DatabaseSync(file);

  /* node:sqlite returns null-prototype objects; normalise them. */
  const plain = (row) => (row == null ? undefined : { ...row });

  const prepare = (sql) => {
    const st = raw.prepare(sql);
    return {
      run: (...args) => {
        const r = st.run(...args);
        return { changes: Number(r?.changes ?? 0), lastInsertRowid: r?.lastInsertRowid };
      },
      get: (...args) => plain(st.get(...args)),
      all: (...args) => st.all(...args).map((r) => ({ ...r })),
    };
  };

  let depth = 0;
  let savepointSequence = 0;
  /* Match better-sqlite3's nested transaction semantics. A nested operation
     gets a real SAVEPOINT, so a helper that catches its own exception cannot
     accidentally leave half of its writes inside the caller's outer commit. */
  const transactionWithMode = (fn, begin) =>
    function (...args) {
      const outermost = depth === 0;
      const savepoint = `khyeast_nested_${++savepointSequence}`;
      raw.exec(outermost ? begin : `SAVEPOINT ${savepoint}`);
      depth += 1;
      try {
        const out = fn.apply(this, args);
        if (out && typeof out.then === 'function') {
          throw new TypeError('SQLite transaction callbacks must be synchronous');
        }
        raw.exec(outermost ? 'COMMIT' : `RELEASE SAVEPOINT ${savepoint}`);
        return out;
      } catch (error) {
        try {
          if (outermost) raw.exec('ROLLBACK');
          else {
            raw.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
            raw.exec(`RELEASE SAVEPOINT ${savepoint}`);
          }
        } catch {}
        throw error;
      } finally {
        depth -= 1;
      }
    };

  return {
    driver: 'node:sqlite',
    exec: (sql) => raw.exec(sql),
    pragma: (str) => raw.exec(`PRAGMA ${str};`),
    prepare,
    transaction: (fn) => transactionWithMode(fn, 'BEGIN'),
    immediateTransaction: (fn) => transactionWithMode(fn, 'BEGIN IMMEDIATE'),
    backup: (destination) => backupDatabase(raw, destination),
    close: () => raw.close(),
  };
}

/** Wrap better-sqlite3 and add the one adapter method it does not expose. */
function wrapBetterSqlite(Database, file, { readOnly = false, mustExist = false } = {}) {
  const raw = new Database(file, { readonly: readOnly, fileMustExist: mustExist || readOnly });
  raw.driver = 'better-sqlite3';
  raw.immediateTransaction = (fn) => raw.transaction(fn).immediate;
  return raw;
}

export async function createDatabase(file, { readOnly = false, mustExist = false } = {}) {
  if ((mustExist || readOnly) && !fs.existsSync(file)) {
    throw Object.assign(new Error(`SQLite database does not exist: ${file}`), { code: 'DB_FILE_MISSING' });
  }
  try {
    const { default: Database } = await import('better-sqlite3');
    return wrapBetterSqlite(Database, file, { readOnly, mustExist });
  } catch {
    /* Import or native-binding failure: preserve the existing portable
       fallback. The node:sqlite open still reports real path/permission errors. */
    const { DatabaseSync, backup } = await import('node:sqlite');
    return wrapNodeSqlite(DatabaseSync, backup, file, { readOnly });
  }
}
