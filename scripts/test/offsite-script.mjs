/* The VPS may append a checksum-verified snapshot and remove only ephemeral
   locks, but must never hold credentials that can check, forget, prune, or
   delete repository history. Those operations run from a trusted host. */
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
if [[ "$1" == backup && " $* " == *" --no-lock "* ]]; then
  printf 'upstream Restic does not honor --no-lock for backup\\n' >&2
  exit 73
fi
`, { mode: 0o755 });

const archive = path.join(backups, 'khyeast-20261024T120000Z.tar');
fs.writeFileSync(archive, 'validated archive bytes');
const hash = spawnSync('sha256sum', [archive], { encoding: 'utf8' }).stdout.split(/\s+/)[0];
fs.writeFileSync(`${archive}.sha256`, `${hash}  ${path.basename(archive)}\n`);

const envFor = (extra = {}) => ({
  ...process.env,
  PATH: `${bin}:${process.env.PATH}`,
  BACKUP_DEST: backups,
  RESTIC_REPOSITORY: 'test:encrypted-repository',
  RESTIC_PASSWORD_FILE: password,
  RESTIC_TEST_LOG: log,
  RESTIC_APPEND_ONLY: 'true',
  ...extra,
});
const run = (extra = {}) => spawnSync('bash', [path.join(ROOT, 'ops', 'replicate-khyeast-restic')], {
  cwd: ROOT,
  encoding: 'utf8',
  env: envFor(extra),
});
const maintain = () => spawnSync('bash', [path.join(ROOT, 'ops', 'maintain-khyeast-restic')], {
  cwd: ROOT,
  encoding: 'utf8',
  env: envFor(),
});

try {
  const result = run();
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
  check(result.status === 0, 'a verified local archive reaches the offsite workflow', `${result.status} ${result.stderr}`);
  check(
    calls[0]?.startsWith('backup --tag khyeast-validated-archive -- '),
    'the append-only upload receives only the completed archive and checksum',
    calls.join(' | '),
  );
  check(
    calls.length === 1
      && !calls.some((call) => /\b(check|forget|prune|unlock)\b/.test(call))
      && !calls.some((call) => /(^|\s)--no-lock(?:\s|$)/.test(call)),
    'the VPS job has no destructive operation and does not rely on backup ignoring its repository lock',
    calls.join(' | '),
  );
  const guide = fs.readFileSync(path.join(ROOT, 'docs', 'khyeast-linux-deployment-guide.html'), 'utf8');
  check(
    guide.includes('One-time proof of the append-only credential')
      && guide.includes('A mock command or an environment variable claiming “append only” is not evidence.')
      && guide.includes('confirm that the supposedly denied probe snapshot still exists'),
    'the runbook requires a real provider denial test and independent full-access verification',
  );

  fs.writeFileSync(log, '');
  const unconfirmed = run({ RESTIC_APPEND_ONLY: 'false' });
  check(
    unconfirmed.status !== 0 && fs.readFileSync(log, 'utf8') === '',
    'replication refuses to run until provider-side append-only access is explicitly confirmed',
    `${unconfirmed.status} ${unconfirmed.stderr}`,
  );

  fs.writeFileSync(log, '');
  const maintained = maintain();
  const maintenanceCalls = fs.readFileSync(log, 'utf8').trim().split('\n');
  check(maintained.status === 0, 'the trusted maintenance workflow completes', `${maintained.status} ${maintained.stderr}`);
  check(
    maintenanceCalls[0] === 'check' &&
      maintenanceCalls[1]?.includes('forget') &&
      maintenanceCalls[1].includes('--group-by host,tags') &&
      maintenanceCalls[1].includes('--keep-daily 14') &&
      maintenanceCalls[1].includes('--prune') &&
      maintenanceCalls[2] === 'check' &&
      maintenanceCalls[3] === 'cache --cleanup',
    'only the separate maintenance workflow checks and prunes retention',
    maintenanceCalls.join(' | '),
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
