/* Offsite replication must verify the local SHA-256 before invoking Restic,
   then check the encrypted repository before pruning its retention set. */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0;
let fail = 0;
const check = (ok, name, detail = '') => {
  if (ok) pass += 1;
  else {
    fail += 1;
    console.log(`LEAK ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ky-restic-script-'));
const bin = path.join(temp, 'bin');
const backups = path.join(temp, 'backups');
const log = path.join(temp, 'restic.log');
const password = path.join(temp, 'password');
fs.mkdirSync(bin, { recursive: true });
fs.mkdirSync(backups, { recursive: true });
fs.writeFileSync(password, 'test-only-password', { mode: 0o600 });

const restic = path.join(bin, 'restic');
fs.writeFileSync(restic, `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >>"$RESTIC_TEST_LOG"
`, { mode: 0o755 });

const archive = path.join(backups, 'khyeast-20261024T120000Z.tar');
fs.writeFileSync(archive, 'validated archive bytes');
const hash = spawnSync('sha256sum', [archive], { encoding: 'utf8' }).stdout.split(/\s+/)[0];
fs.writeFileSync(`${archive}.sha256`, `${hash}  ${path.basename(archive)}\n`);

const run = () => spawnSync('bash', [path.join(ROOT, 'ops', 'replicate-khyeast-restic')], {
  cwd: ROOT,
  encoding: 'utf8',
  env: {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    BACKUP_DEST: backups,
    RESTIC_REPOSITORY: 'test:encrypted-repository',
    RESTIC_PASSWORD_FILE: password,
    RESTIC_TEST_LOG: log,
  },
});

try {
  const result = run();
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
  check(result.status === 0, 'a verified local archive reaches the offsite workflow', `${result.status} ${result.stderr}`);
  check(calls[0]?.startsWith('backup --tag khyeast-validated-archive -- '), 'Restic receives only the completed archive and checksum', calls.join(' | '));
  check(calls[1] === 'check', 'repository metadata is checked after upload', calls.join(' | '));
  check(
    calls[2]?.includes('forget') && calls[2].includes('--group-by host,tags') && calls[2].includes('--keep-daily 14') && calls[2].includes('--prune') && calls[3] === 'cache --cleanup',
    'remote retention and the local Restic cache are pruned only after verification',
    calls.join(' | '),
  );

  fs.writeFileSync(`${archive}.sha256`, `${'0'.repeat(64)}  ${path.basename(archive)}\n`);
  fs.writeFileSync(log, '');
  const corrupt = run();
  check(
    corrupt.status !== 0 && fs.readFileSync(log, 'utf8') === '',
    'a bad local checksum fails before any repository call',
    `${corrupt.status} ${corrupt.stderr}`,
  );

  fs.writeFileSync(`${archive}.sha256`, `${hash}  ${path.basename(archive)}\n`);
  const staleTime = new Date(Date.now() - 31 * 60 * 60 * 1000);
  fs.utimesSync(archive, staleTime, staleTime);
  fs.writeFileSync(log, '');
  const stale = run();
  check(
    stale.status !== 0 && fs.readFileSync(log, 'utf8') === '',
    'an old archive cannot be repeatedly uploaded to hide a failed local timer',
    `${stale.status} ${stale.stderr}`,
  );
} catch (error) {
  check(false, 'offsite script harness', error?.stack || String(error));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log(`${pass}/${pass + fail}`);
if (fail) process.exit(1);
