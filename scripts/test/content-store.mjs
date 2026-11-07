/* Editorial SQLite lifecycle: defaults are fresh-install-only, established
   missing/corrupt state fails closed, and section revisions invalidate every
   worker without rewriting unrelated buckets. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
  /* 1: DEFAULT_STATE may become mutable state only for a proven fresh tree. */
  {
    const db = await store.openDB(path.join(root, 'fresh.db'));
    const result = store.initializeContentStore(db, { freshInstall: true });
    const state = store.readContentSections(db);
    check(
      result.status === 'initialized' &&
        result.source === 'defaults-fresh-install' &&
        isDeepStrictEqual(Object.keys(state).sort(), [...store.CONTENT_SECTIONS].sort()) &&
        isDeepStrictEqual(state.products, DEFAULT_STATE.products),
      'a genuinely fresh database receives all nine immutable default sections',
      JSON.stringify(result),
    );
    db.close();
  }

  /* 2: an empty but established deployment is recovery work, not a fresh app. */
  {
    const db = await store.openDB(path.join(root, 'established-empty.db'));
    const result = store.initializeContentStore(db, { freshInstall: false });
    const rows = db.prepare('SELECT COUNT(*) AS count FROM content_sections').get().count;
    check(
      result.status === 'unavailable' && Number(rows) === 0,
      'an unproven empty store fails closed instead of silently reseeding defaults',
      JSON.stringify(result),
    );
    db.close();
  }

  /* 3: a second worker sees the committed initialization and never resets it. */
  {
    const file = path.join(root, 'idempotent.db');
    const first = await store.openDB(file);
    const initialized = store.initializeContentStore(first, { freshInstall: true });
    const changed = store.readContentSections(first);
    changed.texts['test.persisted'] = 'kept';
    store.replaceContentSections(first, { texts: changed.texts }, { expectedRevision: 1 });
    const second = await store.openDB(file);
    const ready = store.initializeContentStore(second, { freshInstall: true });
    check(
      initialized.status === 'initialized' && ready.status === 'ready' &&
        ready.revision === 2 && store.readContentSections(second).texts['test.persisted'] === 'kept',
      'repeat initialization preserves committed Admin content',
      JSON.stringify(ready),
    );
    second.close();
    first.close();
  }

  /* 4: missing established rows are never recreated, even with freshInstall. */
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

  /* 5: wrong-type JSON after initialization is preserved and rejected. */
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

  /* 6 + 7: only a changed bucket advances, and another connection sees both
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
} catch (error) {
  check(false, 'content-store lifecycle harness', error?.stack || String(error));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`${pass}/${pass + fail}`);
if (fail) process.exit(1);
