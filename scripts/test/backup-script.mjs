/* The production backup wrapper must stage live data, exclude quarantine, and
   fail rather than publishing a partial archive when its copy tool warns. The
   sandbox lacks sqlite3/rsync, so tiny test doubles exercise the shell control
   flow while real tar and SHA-256 verify the result. */
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
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ky-backup-script-'));
const bin = path.join(temp, 'bin');
const state = path.join(temp, 'state');
const data = path.join(state, 'data');
const uploads = path.join(state, 'uploads');
const destination = path.join(temp, 'backups');
const sqliteLog = path.join(temp, 'sqlite.log');
fs.mkdirSync(bin, { recursive: true });
fs.mkdirSync(data, { recursive: true });
fs.mkdirSync(path.join(uploads, 'images'), { recursive: true });
fs.mkdirSync(path.join(uploads, '.quarantine', '1000000000000-old', 'images'), { recursive: true });

const executable = (name, body) => {
  const file = path.join(bin, name);
  fs.writeFileSync(file, body, { mode: 0o755 });
};

executable('sqlite3', `#!/usr/bin/env bash
set -euo pipefail
if [[ -n \${SQLITE_TEST_LOG:-} ]]; then printf '%s\\n' "$*" >>"$SQLITE_TEST_LOG"; fi
case "$*" in
  *"PRAGMA integrity_check"*) printf 'ok\\n'; exit 0 ;;
  *"PRAGMA foreign_key_check"*) exit 0 ;;
esac
readonly=0
if [[ \${1:-} == -readonly ]]; then readonly=1; shift; fi
source_db=$1
input=$(cat)
target=$(printf '%s\\n' "$input" | sed -n "s/^\\.backup '\\(.*\\)'$/\\1/p")
test -n "$target"
if [[ $readonly == 1 && \${FAIL_READONLY_SQLITE_BACKUP:-0} == 1 ]]; then
  printf 'attempt to write a readonly database\\n' >&2
  exit 8
fi
cp -- "$source_db" "$target"
`);
executable('systemctl', `#!/usr/bin/env bash
set -euo pipefail
[[ \${1:-} == is-active ]]
state=\${APP_SERVICE_STATE:-active}
printf '%s\\n' "$state"
[[ $state == active ]]
`);
executable('rsync', `#!/usr/bin/env bash
set -euo pipefail
if [[ \${FAIL_RSYNC:-0} == 1 ]]; then exit 24; fi
source=\${@: -2:1}
destination=\${@: -1}
mkdir -p -- "$destination"
cp -a -- "$source"/. "$destination"/
rm -rf -- "$destination/.quarantine"
`);

const content = {
  texts: {}, media: {}, links: {}, collections: {}, brands: [], products: [], posts: [],
};
fs.writeFileSync(path.join(data, 'content.json'), JSON.stringify(content));
fs.writeFileSync(path.join(data, 'khyeast.db'), 'test sqlite snapshot bytes');
fs.writeFileSync(path.join(uploads, 'images', 'live.webp'), 'live');
fs.writeFileSync(path.join(uploads, '.quarantine', '1000000000000-old', 'images', 'retired.webp'), 'retired');
fs.mkdirSync(destination, { recursive: true });
const expiredArchive = path.join(destination, 'khyeast-20000101T000000Z.tar');
fs.writeFileSync(expiredArchive, 'expired');
fs.writeFileSync(`${expiredArchive}.sha256`, 'expired');
const expiredTime = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
fs.utimesSync(expiredArchive, expiredTime, expiredTime);
fs.utimesSync(`${expiredArchive}.sha256`, expiredTime, expiredTime);

const run = (extra = {}) => spawnSync('bash', [path.join(ROOT, 'ops', 'backup-khyeast')], {
  cwd: ROOT,
  encoding: 'utf8',
  env: {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    BACKUP_DEST: destination,
    KHYEAST_STATE_ROOT: state,
    DATA_DIR: data,
    UPLOAD_DIR: uploads,
    DB_FILE: path.join(data, 'khyeast.db'),
    CONTENT_FILE: path.join(data, 'content.json'),
    RELEASE_DIR: ROOT,
    BACKUP_MIN_FREE_BYTES: '0',
    APP_SERVICE_STATE: 'active',
    SQLITE_TEST_LOG: sqliteLog,
    ...extra,
  },
});

try {
  const result = run();
  const archives = fs.existsSync(destination)
    ? fs.readdirSync(destination).filter((name) => /^khyeast-.*\.tar$/.test(name))
    : [];
  check(result.status === 0 && archives.length === 1, 'the online backup publishes one completed archive', `${result.status} ${result.stderr}`);
  check(
    !fs.existsSync(expiredArchive) && !fs.existsSync(`${expiredArchive}.sha256`),
    'successful backup bounds old local archives and their checksum sidecars',
  );
  const archive = path.join(destination, archives[0] || 'missing');
  const listing = spawnSync('tar', ['-tf', archive], { encoding: 'utf8' });
  check(
    listing.status === 0 &&
      listing.stdout.includes('khyeast/data/content.json') &&
      listing.stdout.includes('khyeast/data/khyeast.db') &&
      listing.stdout.includes('khyeast/uploads/images/live.webp'),
    'the archive contains validated content, SQLite and live uploads',
    listing.stderr,
  );
  check(!listing.stdout.includes('.quarantine') && !listing.stdout.includes('retired.webp'), 'backup archives deliberately exclude quarantine');
  const checksum = spawnSync('sha256sum', ['-c', `${archives[0]}.sha256`], { cwd: destination, encoding: 'utf8' });
  check(checksum.status === 0, 'the published SHA-256 sidecar verifies', checksum.stderr);
  const onlineManifestResult = spawnSync('tar', ['-xOf', archive, 'khyeast/backup-manifest.json'], { encoding: 'utf8' });
  const onlineManifest = JSON.parse(onlineManifestResult.stdout || '{}');
  check(
    onlineManifest.online === true && onlineManifest.databaseSnapshotMode === 'online-sqlite-backup',
    'the manifest records an online SQLite snapshot',
    onlineManifestResult.stdout,
  );

  /* Reproduce the production failure mode: systemd says the app is stopped,
     the source tree is read-only, and opening it through SQLite would fail.
     With no WAL, the script must copy the stable main file into staging and
     validate that writable copy instead. */
  const offlineDestination = path.join(temp, 'offline-backups');
  fs.writeFileSync(sqliteLog, '');
  fs.chmodSync(path.join(data, 'khyeast.db'), 0o444);
  fs.chmodSync(path.join(data, 'content.json'), 0o444);
  fs.chmodSync(data, 0o555);
  const offline = run({
    BACKUP_DEST: offlineDestination,
    APP_SERVICE_STATE: 'inactive',
    FAIL_READONLY_SQLITE_BACKUP: '1',
  });
  fs.chmodSync(data, 0o755);
  fs.chmodSync(path.join(data, 'khyeast.db'), 0o644);
  fs.chmodSync(path.join(data, 'content.json'), 0o644);
  const offlineArchiveName = fs.existsSync(offlineDestination)
    ? fs.readdirSync(offlineDestination).find((name) => /^khyeast-.*\.tar$/.test(name))
    : '';
  const offlineArchive = path.join(offlineDestination, offlineArchiveName || 'missing');
  const offlineManifestResult = spawnSync('tar', ['-xOf', offlineArchive, 'khyeast/backup-manifest.json'], { encoding: 'utf8' });
  const offlineManifest = JSON.parse(offlineManifestResult.stdout || '{}');
  check(
    offline.status === 0 && offlineManifest.online === false && offlineManifest.databaseSnapshotMode === 'offline-clean-copy',
    'a stopped app backs up successfully from a read-only clean SQLite file',
    `${offline.status} ${offline.stderr} ${offlineManifestResult.stdout}`,
  );
  const offlineDatabase = spawnSync('tar', ['-xOf', offlineArchive, 'khyeast/data/khyeast.db'], { encoding: 'utf8' });
  check(offlineDatabase.stdout === 'test sqlite snapshot bytes', 'the stopped-service archive contains the stable main database');
  const offlineSqliteCalls = fs.readFileSync(sqliteLog, 'utf8');
  check(
    offlineSqliteCalls.includes('PRAGMA integrity_check') && offlineSqliteCalls.includes('PRAGMA foreign_key_check'),
    'the stopped-service snapshot passes SQLite integrity and foreign-key checks',
    offlineSqliteCalls,
  );

  const noSpaceDestination = path.join(temp, 'no-space-backups');
  fs.writeFileSync(sqliteLog, '');
  const noSpace = run({ BACKUP_DEST: noSpaceDestination, BACKUP_MIN_FREE_BYTES: '999999999999999' });
  const noSpaceArchives = fs.existsSync(noSpaceDestination)
    ? fs.readdirSync(noSpaceDestination).filter((name) => /^khyeast-.*\.tar$/.test(name))
    : [];
  check(
    noSpace.status !== 0 &&
      noSpaceArchives.length === 0 &&
      noSpace.stderr.includes('insufficient free space') &&
      fs.readFileSync(sqliteLog, 'utf8') === '',
    'insufficient destination space fails before staging or publication',
    `${noSpace.status} ${noSpace.stderr}`,
  );

  const failedDestination = path.join(temp, 'failed-backups');
  const failed = spawnSync('bash', [path.join(ROOT, 'ops', 'backup-khyeast')], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      BACKUP_DEST: failedDestination,
      KHYEAST_STATE_ROOT: state,
      DATA_DIR: data,
      UPLOAD_DIR: uploads,
      DB_FILE: path.join(data, 'khyeast.db'),
      CONTENT_FILE: path.join(data, 'content.json'),
      RELEASE_DIR: ROOT,
      BACKUP_MIN_FREE_BYTES: '0',
      APP_SERVICE_STATE: 'active',
      FAIL_RSYNC: '1',
    },
  });
  const failedArchives = fs.existsSync(failedDestination)
    ? fs.readdirSync(failedDestination).filter((name) => /^khyeast-.*\.tar$/.test(name))
    : [];
  check(failed.status !== 0 && failedArchives.length === 0, 'an rsync warning fails closed without publishing a partial archive', `${failed.status} ${failed.stdout} ${failed.stderr}`);

  const invalidDestination = path.join(temp, 'invalid-content-backups');
  const contentFile = path.join(data, 'content.json');
  const healthyContent = fs.readFileSync(contentFile);
  fs.writeFileSync(contentFile, JSON.stringify({ texts: {} }));
  const invalid = run({ BACKUP_DEST: invalidDestination });
  fs.writeFileSync(contentFile, healthyContent);
  const invalidArchives = fs.existsSync(invalidDestination)
    ? fs.readdirSync(invalidDestination).filter((name) => /^khyeast-.*\.tar$/.test(name))
    : [];
  check(
    invalid.status !== 0 && invalidArchives.length === 0,
    'invalid authoritative content cannot produce a published backup',
    `${invalid.status} ${invalid.stdout} ${invalid.stderr}`,
  );
} catch (error) {
  check(false, 'backup script harness', error?.stack || String(error));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log(`${pass}/${pass + fail}`);
if (fail) process.exit(1);
