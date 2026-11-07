/* Editorial SQLite lifecycle: defaults are fresh-install-only, legacy JSON is a
   guarded one-time input, corrupt established state fails closed, and section
   revisions invalidate every worker without rewriting unrelated buckets. */
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
const clone = (value) => JSON.parse(JSON.stringify(value));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ky-content-store-'));
const missing = path.join(root, 'missing.json');

try {
  /* 1: DEFAULT_STATE may become mutable state only for a proven fresh tree. */
  {
    const db = await store.openDB(path.join(root, 'fresh.db'));
    const result = store.initializeContentStore(db, { LEGACY_CONTENT_FILE: missing, freshInstall: true });
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
    const result = store.initializeContentStore(db, { LEGACY_CONTENT_FILE: missing, freshInstall: false });
    const rows = db.prepare('SELECT COUNT(*) AS count FROM content_sections').get().count;
    check(
      result.status === 'unavailable' && Number(rows) === 0,
      'an unproven empty store fails closed instead of silently reseeding defaults',
      JSON.stringify(result),
    );
    db.close();
  }

  /* 3: import exact legacy arrays, including media today's editor rejects. */
  const migrationDir = path.join(root, 'migration');
  fs.mkdirSync(migrationDir);
  const legacyFile = path.join(migrationDir, 'content.json');
  const legacy = clone(DEFAULT_STATE);
  legacy.texts = { 'legacy.only': 'preserved' };
  legacy.products = [{
    slug: 'legacy-product',
    title: 'Legacy',
    image: 'http://old.example/product.jpg',
    images: ['http://old.example/product.jpg', 'javascript:old', 'http://old.example/product.jpg'],
    custom: { untouched: true },
  }];
  legacy.shop = { products: clone(DEFAULT_STATE.shop.products), display: { enabled: false } };
  fs.writeFileSync(legacyFile, JSON.stringify(legacy, null, 2));
  {
    const db = await store.openDB(path.join(migrationDir, 'khyeast.db'));
    const result = store.initializeContentStore(db, { LEGACY_CONTENT_FILE: legacyFile, freshInstall: false });
    const imported = store.readContentSections(db);
    check(
      result.status === 'initialized' &&
        result.source === 'legacy-content-json' &&
        isDeepStrictEqual(imported.products, legacy.products) &&
        imported.texts['legacy.only'] === 'preserved' &&
        Object.keys(imported.texts).length > 1 &&
        fs.existsSync(legacyFile),
      'legacy content imports transactionally without normalizing invalid historical product rows',
      JSON.stringify(imported.products),
    );

    /* 4: archive only after operational migration, tolerate a worker race, and
       prove loss of the DB cannot re-import that stale snapshot. */
    store.seedFromLegacy(db, {
      LEGACY_CONTENT_FILE: legacyFile,
      SHOP_FILE: path.join(migrationDir, 'missing-shop.json'),
      MESSAGES_FILE: path.join(migrationDir, 'missing-messages.json'),
    });
    const firstArchive = store.archiveImportedLegacyContent(db, legacyFile);
    const secondArchive = store.archiveImportedLegacyContent(db, legacyFile);
    db.close();
    const archiveExists = firstArchive.file && fs.existsSync(firstArchive.file);
    fs.rmSync(path.join(migrationDir, 'khyeast.db'), { force: true });
    fs.rmSync(path.join(migrationDir, 'khyeast.db-wal'), { force: true });
    fs.rmSync(path.join(migrationDir, 'khyeast.db-shm'), { force: true });
    const lost = await store.openDB(path.join(migrationDir, 'khyeast.db'));
    const afterLoss = store.initializeContentStore(lost, { LEGACY_CONTENT_FILE: legacyFile, freshInstall: false });
    lost.close();
    check(
      firstArchive.status === 'archived' &&
        secondArchive.status === 'already-archived' &&
        archiveExists &&
        !fs.existsSync(legacyFile) &&
        afterLoss.status === 'unavailable',
      'successful migration archives its source and prevents stale re-import after database loss',
      JSON.stringify({ firstArchive, secondArchive, afterLoss }),
    );
  }

  /* 5: malformed migration input remains untouched for operator recovery. */
  {
    const corruptLegacy = path.join(root, 'corrupt-content.json');
    const bytes = '{ definitely not JSON';
    fs.writeFileSync(corruptLegacy, bytes);
    const db = await store.openDB(path.join(root, 'corrupt-legacy.db'));
    const result = store.initializeContentStore(db, { LEGACY_CONTENT_FILE: corruptLegacy, freshInstall: true });
    check(
      result.status === 'unavailable' && fs.readFileSync(corruptLegacy, 'utf8') === bytes,
      'a corrupt legacy source is preserved and blocks default initialization',
      JSON.stringify(result),
    );
    db.close();
  }

  /* 6: corruption after initialization is never overwritten by bootstrap. */
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
} catch (error) {
  check(false, 'content-store lifecycle harness', error?.stack || String(error));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`${pass}/${pass + fail}`);
if (fail) process.exit(1);
