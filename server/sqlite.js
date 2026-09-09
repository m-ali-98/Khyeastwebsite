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
     db.transaction(fn)  -> callable, runs inside BEGIN/COMMIT/ROLLBACK
     db.close()
   ========================================================================== */

/** Wrap node:sqlite's DatabaseSync in the better-sqlite3-shaped API. */
function wrapNodeSqlite(DatabaseSync, file) {
  const raw = new DatabaseSync(file);

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

  let depth = 0; // support nested transaction() calls safely
  const transaction = (fn) =>
    function (...args) {
      if (depth > 0) return fn.apply(this, args);
      depth++;
      raw.exec('BEGIN');
      try {
        const out = fn.apply(this, args);
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        try {
          raw.exec('ROLLBACK');
        } catch {}
        throw e;
      } finally {
        depth--;
      }
    };

  return {
    driver: 'node:sqlite',
    exec: (sql) => raw.exec(sql),
    pragma: (str) => raw.exec(`PRAGMA ${str};`),
    prepare,
    transaction,
    close: () => raw.close(),
  };
}

/** Wrap better-sqlite3 (already has this API; only `driver` is added). */
function wrapBetterSqlite(Database, file) {
  const raw = new Database(file);
  raw.driver = 'better-sqlite3';
  return raw;
}

export async function createDatabase(file) {
  try {
    const { default: Database } = await import('better-sqlite3');
    return wrapBetterSqlite(Database, file);
  } catch {
    const { DatabaseSync } = await import('node:sqlite');
    return wrapNodeSqlite(DatabaseSync, file);
  }
}
