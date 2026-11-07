/* Build the scratch data directory the e2e server runs against.

   This runs as the FIRST step of the webServer command, not as Playwright's
   globalSetup. That ordering matters: Playwright launches the web server
   *before* globalSetup, so wiping the directory from globalSetup meant
   deleting a SQLite file the freshly started server already had open. POSIX
   shrugs at that; Windows refuses with EPERM and the whole run dies.

   Doing it here guarantees the directory is clean before any server touches
   it, on every platform.

   The server resolves DATA_DIR / UPLOAD_DIR / DB_FILE from the environment,
   so everything the browser tests write — products, orders, comments,
   uploads — lands in .e2e-data/ and is thrown away on the next run. The real
   server/data/ is never opened.

   Editorial content is initialized directly from the same immutable
   DEFAULT_STATE path as a genuinely fresh production install; no mutable seed
   file is copied into the fixture. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from '../server/db.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const dataDir = path.join(ROOT, '.e2e-data');

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/* Windows keeps a file locked until the last handle is closed, and closing
   lags process exit by a few hundred milliseconds. A previous run's server
   may therefore still be holding e2e.db. Retry briefly before giving up. */
let lastErr;
for (let attempt = 0; attempt < 6; attempt++) {
  try {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    lastErr = null;
    break;
  } catch (err) {
    lastErr = err;
    sleep(400);
  }
}

if (lastErr) {
  console.error(
    `\n[e2e] cannot clear ${dataDir}\n` +
      `      ${lastErr.message}\n\n` +
      `      Something still has the test database open — almost always a server\n` +
      `      left running by an earlier test run. Close it (or any editor previewing\n` +
      `      the .db file) and try again. Deleting the .e2e-data folder by hand also\n` +
      `      works; it holds nothing but throwaway data.\n`,
  );
  process.exit(1);
}

fs.mkdirSync(path.join(dataDir, 'uploads', 'images'), { recursive: true });
fs.mkdirSync(path.join(dataDir, 'uploads', 'videos'), { recursive: true });

const databaseFile = path.join(dataDir, 'e2e.db');
const database = await store.openDB(databaseFile);
const initialized = store.initializeContentStore(database, { freshInstall: true });
if (!['initialized', 'ready'].includes(initialized.status)) {
  database.close();
  throw new Error(`[e2e] could not initialize SQLite content: ${initialized.reason || initialized.status}`);
}
store.seedFromLegacy(database, {
  SHOP_FILE: path.join(dataDir, 'does-not-exist-shop.json'),
  MESSAGES_FILE: path.join(dataDir, 'does-not-exist-messages.json'),
});
database.close();

/* Local ignored uploads are copied only as fixtures. Shipped defaults do not
   point at them, but retaining the old convenience lets developers test media
   already present in their checkout without making those files authoritative. */
const liveUploads = path.join(ROOT, 'server', 'uploads');
if (fs.existsSync(liveUploads)) {
  fs.cpSync(liveUploads, path.join(dataDir, 'uploads'), { recursive: true, force: true });
}

console.log(`[e2e] scratch data directory ready: ${path.relative(ROOT, dataDir)}`);
