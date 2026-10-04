/* Build the scratch data directory the e2e server runs against.

   The server resolves DATA_DIR / UPLOAD_DIR / DB_FILE from the environment,
   so everything the browser tests write — new products, orders, comments,
   uploaded files — lands in .e2e-data/ and is thrown away on the next run.
   The real server/data/ is never opened.

   The content file is seeded from the repository's own content.json when it
   exists, so the tests exercise the catalogue you actually ship rather than
   an empty default state. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

export default function globalSetup() {
  const dataDir = path.join(ROOT, '.e2e-data');

  /* A stale database from a previous run would carry its orders, its stock
     levels and its rate-limiter history into this one. Start clean. */
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dataDir, 'uploads', 'images'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'uploads', 'videos'), { recursive: true });

  const live = path.join(ROOT, 'server', 'data', 'content.json');
  if (fs.existsSync(live)) fs.copyFileSync(live, path.join(dataDir, 'content.json'));

  return undefined;
}
