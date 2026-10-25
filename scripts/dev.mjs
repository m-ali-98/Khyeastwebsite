/* Start both halves of the development setup with one command.
 *
 *   npm run dev:all
 *
 * Vite serves the UI on :5173 with hot reload, and proxies /api and /uploads
 * to the API server on :8787 (see the `proxy` block in vite.config.js). Vite
 * alone gives you a site with no content, no admin panel and no uploaded
 * images; the API alone gives you no hot reload. They are both needed, which
 * is a thing that is easy to forget at the start of a session and confusing
 * for a few minutes afterwards.
 *
 * Output from the two is prefixed so it is obvious which one is talking, and
 * Ctrl-C stops both — a stray API server holding the database open is the
 * usual cause of the "cannot clear .e2e-data" message later.
 *
 * For the real production build instead:  npm run build && npm run server
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* npm is a .cmd on Windows and spawn() will not find it without a shell. */
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const COLOUR = { api: '\x1b[36m', ui: '\x1b[35m', off: '\x1b[0m' };
const children = [];

function start(name, args) {
  const child = spawn(npm, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  const tag = `${COLOUR[name]}[${name}]${COLOUR.off} `;

  const print = (stream) => (data) => {
    const text = String(data).replace(/\s+$/, '');
    if (text) console.log(text.split('\n').map((l) => tag + l).join('\n'));
    void stream;
  };
  child.stdout.on('data', print('out'));
  child.stderr.on('data', print('err'));

  child.on('exit', (code) => {
    /* If either half dies the other is useless, so do not leave half a dev
       environment running and looking healthy. */
    console.log(`${tag}exited (${code})`);
    stopAll();
    process.exit(code ?? 1);
  });

  children.push(child);
  return child;
}

function stopAll() {
  for (const c of children) {
    if (c.exitCode === null) {
      try {
        c.kill();
      } catch {
        /* already gone */
      }
    }
  }
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopAll();
    process.exit(0);
  });
}

console.log('\nAPI  → http://localhost:8787   (content, admin, uploads)');
console.log('Site → http://localhost:5173   ← open this one\n');

start('api', ['run', 'server']);
start('ui', ['run', 'dev']);
