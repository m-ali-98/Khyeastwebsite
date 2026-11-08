/* SQLite installation lifecycle: the final schema and defaults are fresh-only,
   incompatible or damaged established state fails closed, and section revisions
   invalidate every worker without rewriting unrelated buckets. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import DEFAULT_STATE from '../../shared/contentDefaults.js';
import * as store from '../../server/db.js';

let pass = 0;
let fail = 0;
const check = (ok, name, detail = '') => {
  if (ok) pass += 1;
  else {
    fail += 1;
    console.log(`LEAK ${name}${detail ? ` — ${detail}` : ''}`);
  }
};
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ky-content-store-'));

try {
  /* 1 + 2: all defaults may become mutable state only for a proven fresh tree. */
  {
    const db = await store.openDB(path.join(root, 'fresh.db'));
    const result = store.initializeStore(db, { freshInstall: true });
    const state = store.readContentSections(db);
    const metaColumns = db.prepare('PRAGMA table_info(content_meta)').all().map((column) => column.name);
    check(
      result.content.status === 'initialized' &&
        isDeepStrictEqual(Object.keys(state).sort(), [...store.CONTENT_SECTIONS].sort()) &&
        isDeepStrictEqual(state.products, DEFAULT_STATE.products) &&
        !metaColumns.includes('source'),
      'a genuinely fresh database receives all nine immutable default sections without provenance scaffolding',
      JSON.stringify(result.content),
    );
    check(
      result.operational.status === 'initialized' &&
        result.operational.products === DEFAULT_STATE.shop.products.length &&
        result.operational.orders === 0 && result.operational.messages === 0,
      'the same fresh transaction initializes operational defaults without importing files',
      JSON.stringify(result.operational),
    );
    db.close();
  }

  /* 3: an empty but established deployment is recovery work, not a fresh app. */
  {
    const db = await store.openDB(path.join(root, 'established-empty.db'));
    const result = store.initializeContentStore(db, { freshInstall: false });
    const operational = store.initializeOperationalStore(db, { freshInstall: false });
    const rows = db.prepare('SELECT COUNT(*) AS count FROM content_sections').get().count;
    const products = db.prepare('SELECT COUNT(*) AS count FROM products').get().count;
    check(
      result.status === 'unavailable' && operational.status === 'unavailable' &&
        Number(rows) === 0 && Number(products) === 0,
      'an unproven empty store fails closed instead of silently initializing defaults',
      JSON.stringify({ content: result, operational }),
    );
    db.close();
  }

  /* 4: a second worker sees the committed initialization and never resets it. */
  {
    const file = path.join(root, 'idempotent.db');
    const first = await store.openDB(file);
    const initialized = store.initializeStore(first, { freshInstall: true }).content;
    const changed = store.readContentSections(first);
    changed.texts['test.persisted'] = 'kept';
    store.replaceContentSections(first, { texts: changed.texts }, { expectedRevision: 1 });
    const second = await store.openDB(file);
    const ready = store.initializeStore(second, { freshInstall: true }).content;
    check(
      initialized.status === 'initialized' && ready.status === 'ready' &&
        ready.revision === 2 && store.readContentSections(second).texts['test.persisted'] === 'kept',
      'repeat initialization preserves committed Admin content',
      JSON.stringify(ready),
    );
    second.close();
    first.close();
  }

  /* 5: missing established rows are never recreated, even with freshInstall. */
  {
    const file = path.join(root, 'missing-established.db');
    const db = await store.openDB(file);
    store.initializeContentStore(db, { freshInstall: true });
    db.prepare("DELETE FROM content_sections WHERE section = 'products'").run();
    const second = store.initializeContentStore(db, { freshInstall: true });
    const rows = Number(db.prepare(
      "SELECT COUNT(*) AS count FROM content_sections WHERE section = 'products'",
    ).get().count);
    check(
      second.status === 'unavailable' && rows === 0,
      'a missing established section remains unavailable until verified recovery',
      JSON.stringify(second),
    );
    db.close();
  }

  /* 6: wrong-type JSON after initialization is preserved and rejected. */
  {
    const file = path.join(root, 'corrupt-established.db');
    const db = await store.openDB(file);
    store.initializeContentStore(db, { freshInstall: true });
    db.prepare("UPDATE content_sections SET value_json = '\"wrong type\"' WHERE section = 'texts'").run();
    let strictFailed = false;
    try { store.readContentSections(db); } catch (error) { strictFailed = error.code === 'CONTENT_UNAVAILABLE'; }
    const second = store.initializeContentStore(db, { freshInstall: true });
    const raw = db.prepare("SELECT value_json FROM content_sections WHERE section = 'texts'").get().value_json;
    check(
      strictFailed && second.status === 'unavailable' && raw === '"wrong type"',
      'corrupt established SQLite content remains untouched and unavailable',
      JSON.stringify(second),
    );
    db.close();
  }

  /* 7 + 8: only a changed bucket advances, and another connection sees both
     the revision and PRAGMA data_version transition. */
  {
    const file = path.join(root, 'revisions.db');
    const first = await store.openDB(file);
    store.initializeContentStore(first, { freshInstall: true });
    const second = await store.openDB(file);
    const beforeToken = store.getContentToken(first);
    const before = store.getContentSectionRevisions(first);
    const state = store.readContentSections(second);
    const changed = store.replaceContentSections(second, {
      texts: { ...state.texts, 'test.revision': 'two' },
    }, { expectedRevision: 1 });
    const after = store.getContentSectionRevisions(first);
    const afterToken = store.getContentToken(first);
    const untouched = store.CONTENT_SECTIONS.filter((section) => section !== 'texts')
      .every((section) => after[section] === before[section]);
    check(
      changed.revision === 2 &&
        isDeepStrictEqual(changed.changedSections, ['texts']) &&
        after.texts === 2 && untouched,
      'a section save advances only that section and the coherent global revision',
      JSON.stringify({ before, after, changed: changed.changedSections }),
    );
    const noOp = store.replaceContentSections(second, {
      texts: { ...changed.state.texts, ignoredUndefined: undefined },
    }, { expectedRevision: 2 });
    check(
      afterToken.revision === 2 &&
        afterToken.dataVersion !== beforeToken.dataVersion &&
        noOp.revision === 2 && noOp.changedSections.length === 0,
      'another worker invalidates its cache token while an identical save stays a no-op',
      JSON.stringify({ beforeToken, afterToken, noOp }),
    );
    second.close();
    first.close();
  }

  /* 9: a non-empty foreign schema is rejected, never changed in place. */
  {
    const file = path.join(root, 'incompatible.db');
    const raw = new DatabaseSync(file);
    raw.exec('CREATE TABLE old_state (value TEXT NOT NULL)');
    raw.close();
    let rejected = false;
    try {
      await store.openDB(file);
    } catch (error) {
      rejected = error.code === 'DB_SCHEMA_INCOMPATIBLE';
    }
    const inspect = new DatabaseSync(file, { readOnly: true });
    const tables = inspect.prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
    ).all().map((row) => row.name);
    inspect.close();
    check(
      rejected && isDeepStrictEqual(tables, ['old_state']),
      'an incompatible database is rejected without imports, ALTERs, or backfills',
      JSON.stringify(tables),
    );
  }

  /* 10: an established tree cannot turn a missing database into a new one. */
  {
    const file = path.join(root, 'absent-established.db');
    let rejected = false;
    try {
      await store.openDB(file, { allowCreate: false });
    } catch (error) {
      rejected = error.code === 'DB_SCHEMA_INCOMPATIBLE';
    }
    check(
      rejected && !fs.existsSync(file),
      'a missing established database is rejected without creating a replacement file',
    );
  }
} catch (error) {
  check(false, 'content-store lifecycle harness', error?.stack || String(error));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`${pass}/${pass + fail}`);
if (fail) process.exit(1);
