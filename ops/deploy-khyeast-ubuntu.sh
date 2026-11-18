#!/usr/bin/env bash
# Prepare and publish one tested main-branch release on the single Ubuntu VPS.
# This script is for routine updates after the server has been provisioned; it
# never changes schema, installs root-owned operations files, or deletes data.
set -Eeuo pipefail
umask 077

readonly APP_ROOT=/srv/khyeast
readonly RELEASES_DIR="$APP_ROOT/releases"
readonly CURRENT_LINK="$APP_ROOT/current"
readonly ENV_FILE=/etc/khyeast/khyeast.env
readonly APP_USER=khyeast
readonly APP_SERVICE=khyeast.service
readonly NGINX_SERVICE=nginx.service
readonly LOCAL_BACKUP_SERVICE=khyeast-backup.service
readonly OFFSITE_BACKUP_SERVICE=khyeast-offsite.service
readonly CALLBACK_FALLBACK=/var/www/khyeast-payment-callback-unavailable.html
readonly MIN_FREE_KB=1572864
readonly DEFAULT_REPOSITORY=https://github.com/m-ali-98/Khyeastwebsite.git

REPOSITORY_URL=${KHYEAST_REPO_URL:-$DEFAULT_REPOSITORY}
DRY_RUN=0
CONFIRM_COMMIT=
STAGE_DIR=
RELEASE_DIR=
RELEASES_REAL=
PREVIOUS_RELEASE=
NEXT_LINK="$APP_ROOT/current.next"
NEXT_LINK_CREATED=0
ROLLBACK_COMPATIBLE=0
PUBLIC_ORIGIN=
ORIGIN_HOST=
DB_FILE=
DATA_DIR=
UPLOAD_DIR=
MIGRATION_BACKUP_DIR=
PORT=8787

usage() {
  cat <<'USAGE'
Usage: ops/deploy-khyeast-ubuntu.sh [--dry-run] [--confirm-commit SHA] [--help]

  --dry-run  Clone main, install/test/build, prune dev dependencies, audit
             production packages, and run read-only schema compatibility checks.
             Never backs up, switches the live symlink, or restarts services.
  --confirm-commit SHA
             Non-interactive approval, accepted only if SHA exactly matches
             the full 40-character commit fetched from main.
  --help     Show this help and exit without checking or changing the server.

Optional environment:
  KHYEAST_REPO_URL  Clone URL (use a read-only SSH deploy key for a private repo).

The normal run fetches only origin/main. Initial server provisioning is manual.
Actual schema migrations are never run by this script. A failed post-cutover
check may trigger a guarded code-only rollback after the previous release passes
its read-only schema and service health checks; persistent data is never reverted.
USAGE
}

fail() {
  local message=$1
  local status=${2:-1}
  printf 'deploy-khyeast: ERROR: %s\n' "$message" >&2
  exit "$status"
}

info() {
  printf 'deploy-khyeast: %s\n' "$*"
}

# shellcheck disable=SC2329
warn() {
  printf 'deploy-khyeast: WARNING: %s\n' "$*" >&2
}

assert_persistent_path_outside_releases() {
  local name=$1 configured=$2 resolved
  [[ $configured == /* ]] || fail "$name must be an absolute path outside the release tree"
  resolved=$(sudo realpath -m -- "$configured") || fail "could not resolve configured $name path"
  case "$resolved" in
    "$RELEASES_REAL"|"$RELEASES_REAL"/*)
      fail "$name resolves inside the managed releases directory ($resolved); persistent data must live outside releases"
      ;;
  esac
}

persisted_content_is_healthy() {
  local headers
  headers=$(curl --silent --show-error --fail --head --max-time 10 \
    --resolve "$ORIGIN_HOST:443:127.0.0.1" \
    "$PUBLIC_ORIGIN/api/content") || return 1
  grep -Eiq '^x-khyeast-content-status:[[:space:]]*persisted[[:space:]]*$' <<<"$headers"
}

run_migration_dry_run() {
  local release=$1
  (
    cd "$release"
    sudo -H -u "$APP_USER" -- env \
      PATH="$SERVICE_PATH" \
      DB_FILE="$DB_FILE" \
      DATA_DIR="$DATA_DIR" \
      MIGRATION_BACKUP_DIR="$MIGRATION_BACKUP_DIR" \
      "$NPM_BIN" run db:migrate -- \
        --database "$DB_FILE" \
        --backup-dir "$MIGRATION_BACKUP_DIR" \
        --dry-run
  )
}

# shellcheck disable=SC2329
rollback_code_only() {
  local active_target previous_target candidate_target rollback_link compatibility_status=0
  local healthy=0 attempt

  if [[ ${ROLLBACK_COMPATIBLE:-0} != 1 ]]; then
    warn 'Code rollback guard is not satisfied: the previous release did not pass the schema compatibility preflight.'
    return 1
  fi
  if [[ -z ${RELEASE_DIR:-} || -z ${PREVIOUS_RELEASE:-} || -z ${RELEASES_REAL:-} ]]; then
    warn 'Code rollback guard is missing a verified candidate, previous release, or releases directory.'
    return 1
  fi
  case "$PREVIOUS_RELEASE" in
    "$RELEASES_REAL"/*) ;;
    *) warn "Code rollback guard rejected previous target outside $RELEASES_REAL: $PREVIOUS_RELEASE"; return 1 ;;
  esac
  previous_target=$(realpath -e -- "$PREVIOUS_RELEASE" 2>/dev/null || true)
  candidate_target=$(realpath -e -- "$RELEASE_DIR" 2>/dev/null || true)
  if [[ $previous_target != "$PREVIOUS_RELEASE" || ! -d $PREVIOUS_RELEASE || ! -d $PREVIOUS_RELEASE/.git ||
        $candidate_target != "$RELEASE_DIR" || ! -d $RELEASE_DIR || ! -d $RELEASE_DIR/.git ]]; then
    warn 'Code rollback guard rejected a missing, moved, or invalid release directory.'
    return 1
  fi
  if [[ ! -L $CURRENT_LINK ]]; then
    warn 'Code rollback guard refused to replace current because it is no longer a symlink.'
    return 1
  fi
  active_target=$(realpath -e -- "$CURRENT_LINK" 2>/dev/null || true)
  if [[ $active_target != "$RELEASE_DIR" ]]; then
    warn "Code rollback guard refused to overwrite a current target changed by another operator: ${active_target:-unresolvable}"
    return 1
  fi

  info 'Rechecking the previous release against the current database before code-only rollback'
  if run_migration_dry_run "$PREVIOUS_RELEASE"; then
    :
  else
    compatibility_status=$?
    warn "Code rollback guard failed: previous release database preflight exited $compatibility_status; current code is left in place for manual review."
    return 1
  fi

  previous_target=$(realpath -e -- "$PREVIOUS_RELEASE" 2>/dev/null || true)
  candidate_target=$(realpath -e -- "$RELEASE_DIR" 2>/dev/null || true)
  active_target=$(realpath -e -- "$CURRENT_LINK" 2>/dev/null || true)
  if [[ ! -L $CURRENT_LINK || $active_target != "$RELEASE_DIR" ||
        $previous_target != "$PREVIOUS_RELEASE" || $candidate_target != "$RELEASE_DIR" ||
        ! -d $PREVIOUS_RELEASE/.git || ! -d $RELEASE_DIR/.git ]]; then
    warn 'Code rollback guard refused the symlink switch because a release path or current target changed during the schema recheck.'
    return 1
  fi

  rollback_link="$APP_ROOT/.current.rollback.$$.${RANDOM}"
  if [[ -e $rollback_link || -L $rollback_link ]]; then
    warn "Code rollback guard found an unexpected temporary path: $rollback_link"
    return 1
  fi
  if ! ln -s -- "$PREVIOUS_RELEASE" "$rollback_link"; then
    warn 'Could not create the guarded rollback symlink; current code is left in place.'
    return 1
  fi
  if ! mv -Tf -- "$rollback_link" "$CURRENT_LINK"; then
    rm -f -- "$rollback_link" || true
    warn 'Could not atomically restore the previous code symlink; inspect the live target immediately.'
    return 1
  fi
  active_target=$(realpath -e -- "$CURRENT_LINK" 2>/dev/null || true)
  if [[ $active_target != "$PREVIOUS_RELEASE" ]]; then
    warn "Rollback symlink did not resolve to the verified previous release: ${active_target:-unresolvable}"
    return 1
  fi

  info 'Restarting the service on the previous code release'
  if ! sudo systemctl restart "$APP_SERVICE"; then
    warn 'The previous code symlink is active, but systemd could not restart it; inspect service logs and database state.'
    return 1
  fi
  for ((attempt = 1; attempt <= 30; attempt++)); do
    if sudo systemctl is-active --quiet "$APP_SERVICE" &&
      curl --silent --fail --max-time 8 "http://127.0.0.1:$PORT/api/health" >/dev/null &&
      assert_public_health && persisted_content_is_healthy; then
      healthy=1
      break
    fi
    sleep 2
  done
  active_target=$(realpath -e -- "$CURRENT_LINK" 2>/dev/null || true)
  if [[ $active_target != "$PREVIOUS_RELEASE" ]]; then
    warn "The rollback target changed during recovery: ${active_target:-unresolvable}; inspect the live service immediately."
    return 1
  fi
  if (( healthy != 1 )); then
    warn 'Previous code was restored, but it did not pass service, HTTPS, and persisted-content checks within 60 seconds.'
    warn 'Database and persistent files were not rolled back. Inspect logs and reconcile any orders or payments written by the failed release.'
    return 1
  fi

  warn "Guarded code-only rollback restored $PREVIOUS_RELEASE and the previous service passed health checks."
  warn 'Only the current release symlink and service process were changed. The database and persistent files were not rolled back; writes accepted by the failed release remain.'
  return 0
}

# shellcheck disable=SC2329
cleanup() {
  local status=$?
  trap - EXIT
  trap '' INT TERM
  if [[ -n ${STAGE_DIR:-} && -n ${RELEASES_REAL:-} && -d ${STAGE_DIR:-} && ! -L ${STAGE_DIR:-} ]]; then
    case "$STAGE_DIR" in
      "$RELEASES_REAL"/.deploy-stage.*) rm -rf -- "$STAGE_DIR" || true ;;
    esac
  fi
  if [[ ${NEXT_LINK_CREATED:-0} == 1 && -L ${NEXT_LINK:-} && -n ${RELEASE_DIR:-} ]]; then
    local pending_target
    pending_target=$(readlink -f -- "$NEXT_LINK" 2>/dev/null || true)
    if [[ $pending_target == "$RELEASE_DIR" ]]; then rm -f -- "$NEXT_LINK" || true; fi
  fi
  if (( status != 0 )) && [[ -n ${PREVIOUS_RELEASE:-} ]]; then
    local active_target
    active_target=$(realpath -e -- "$CURRENT_LINK" 2>/dev/null || true)
    if [[ -n ${RELEASE_DIR:-} && $active_target == "$RELEASE_DIR" ]]; then
      rollback_code_only || true
    elif [[ $active_target != "$PREVIOUS_RELEASE" ]]; then
      warn "deployment failed while current=${active_target:-unresolvable} (preflight current was $PREVIOUS_RELEASE); guarded rollback was not attempted because the target no longer matches this candidate."
    fi
  fi
  exit "$status"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

read_config_value() {
  local key=$1
  sudo "$NODE_BIN" - "$ENV_FILE" "$key" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const key = process.argv[3];
for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
  if (!match || match[1] !== key) continue;
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  process.stdout.write(value);
  break;
}
NODE
}

read_public_origin() {
  sudo "$NODE_BIN" - "$ENV_FILE" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
let raw = '';
for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*PUBLIC_ORIGIN\s*=\s*(.*?)\s*$/i);
  if (!match) continue;
  raw = match[1].trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))) raw = raw.slice(1, -1);
  break;
}
try {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash || (url.port && url.port !== '443')) {
    throw new Error('invalid public origin');
  }
  process.stdout.write(url.origin);
} catch {
  console.error('PUBLIC_ORIGIN must be a valid HTTPS origin on port 443.');
  process.exitCode = 1;
}
NODE
}

check_installed_copy() {
  local source=$1
  local installed=$2
  [[ -f $source ]] || fail "release is missing required operations file: $source"
  sudo test -f "$installed" || fail "required installed operations file is missing: $installed"
  if ! sudo cmp -s -- "$source" "$installed"; then
    fail "reviewed operations file differs: $installed; update and verify it manually, reload systemd if needed, then retry"
  fi
}

run_oneshot_and_verify() {
  local unit=$1
  info "Running required safety job: $unit"
  sudo systemctl start "$unit" || fail "$unit failed; no code cutover was performed"
  local result exit_status condition
  result=$(sudo systemctl show --property=Result --value "$unit")
  exit_status=$(sudo systemctl show --property=ExecMainStatus --value "$unit")
  condition=$(sudo systemctl show --property=ConditionResult --value "$unit")
  [[ $result == success && $exit_status == 0 && $condition != no ]] || \
    fail "$unit did not complete successfully (Result=$result, ExecMainStatus=$exit_status, ConditionResult=${condition:-unset})"
}

assert_public_health() {
  curl --silent --fail --max-time 8 \
    --resolve "$ORIGIN_HOST:443:127.0.0.1" \
    "$PUBLIC_ORIGIN/api/health" >/dev/null
}

assert_current_unchanged() {
  local target
  target=$(realpath -e -- "$CURRENT_LINK") || fail 'current release symlink disappeared during deployment'
  [[ $target == "$PREVIOUS_RELEASE" ]] || fail "current release changed during deployment: $target"
  sudo systemctl is-active --quiet "$APP_SERVICE" || fail "$APP_SERVICE stopped during release preparation"
  assert_public_health || fail 'current public health check failed while the candidate was being prepared'
}

assert_persisted_content() {
  persisted_content_is_healthy || fail 'public /api/content is unavailable or its content status is not persisted; refusing deployment'
}

while (($#)); do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --confirm-commit)
      (($# >= 2)) || fail '--confirm-commit requires the full reviewed SHA from a previous --dry-run'
      CONFIRM_COMMIT=$2
      [[ $CONFIRM_COMMIT =~ ^[0-9a-f]{40}$ ]] || fail '--confirm-commit must be a full lowercase 40-character SHA'
      shift 2
      ;;
    *) fail "unknown option: $1 (use --help)" ;;
  esac
done
[[ $DRY_RUN -eq 0 || -z $CONFIRM_COMMIT ]] || fail '--dry-run and --confirm-commit cannot be combined'
[[ -n $REPOSITORY_URL && $REPOSITORY_URL != *$'\n'* ]] || fail 'KHYEAST_REPO_URL is invalid'
[[ ! $REPOSITORY_URL =~ ^https?://[^/]*@ ]] || \
  fail 'do not embed repository credentials in KHYEAST_REPO_URL; configure a read-only SSH deploy key'

(( EUID != 0 )) || fail 'run as the human deployment account, not root'
DEPLOY_USER=$(id -un)
NODE_BIN=$(command -v node || true)
NPM_BIN=$(command -v npm || true)
[[ -n $NODE_BIN && -x $NODE_BIN ]] || fail 'Node.js is not installed or not on PATH'
[[ -n $NPM_BIN && -x $NPM_BIN ]] || fail 'npm is not installed or not on PATH'

for command in git curl systemctl sudo flock realpath stat df awk grep readlink mktemp date cmp; do
  command -v "$command" >/dev/null 2>&1 || fail "required command is missing: $command"
done

NODE_VERSION=$($NODE_BIN -p 'process.versions.node')
NODE_MAJOR=${NODE_VERSION%%.*}
if [[ ! $NODE_MAJOR =~ ^[0-9]+$ ]] || (( NODE_MAJOR < 22 )); then
  fail "Node.js 22 or newer is required (found $NODE_VERSION)"
fi

[[ -d $APP_ROOT && ! -L $APP_ROOT ]] || fail "$APP_ROOT must be a real directory, not a symlink"
[[ -d $RELEASES_DIR && ! -L $RELEASES_DIR ]] || fail "$RELEASES_DIR must be a real directory, not a symlink"
[[ -w $APP_ROOT && -w $RELEASES_DIR ]] || fail "$DEPLOY_USER must own and be able to write $APP_ROOT and $RELEASES_DIR"
[[ $(stat -c '%U' "$APP_ROOT") == "$DEPLOY_USER" ]] || fail "$APP_ROOT is not owned by deployment user $DEPLOY_USER"
[[ $(stat -c '%U' "$RELEASES_DIR") == "$DEPLOY_USER" ]] || fail "$RELEASES_DIR is not owned by deployment user $DEPLOY_USER"
APP_ROOT_REAL=$(realpath -e -- "$APP_ROOT")
RELEASES_REAL=$(realpath -e -- "$RELEASES_DIR")
[[ $APP_ROOT_REAL == "$APP_ROOT" && $RELEASES_REAL == "$APP_ROOT/releases" ]] || \
  fail 'deployment paths resolve unexpectedly; refusing to follow an alternate directory'

exec 9>"$APP_ROOT/.deploy.lock"
flock -n 9 || fail 'another deployment is already running'

[[ -L $CURRENT_LINK ]] || fail "$CURRENT_LINK must already point to a validated release; this script is not for first installation"
PREVIOUS_RELEASE=$(realpath -e -- "$CURRENT_LINK")
[[ -d $PREVIOUS_RELEASE ]] || fail 'current release target is not a directory'
case "$PREVIOUS_RELEASE" in
  "$RELEASES_REAL"/*) ;;
  *) fail "current release points outside $RELEASES_REAL" ;;
esac
[[ -d $PREVIOUS_RELEASE/.git ]] || fail 'current release is not a Git checkout'
[[ -z $(git -C "$PREVIOUS_RELEASE" status --porcelain) ]] || \
  fail 'current release has tracked or untracked changes; inspect it before deploying'

sudo -v || fail 'sudo authorization failed'
sudo test -r "$ENV_FILE" || fail "$ENV_FILE is missing or unreadable"
[[ $(sudo stat -c '%U' "$ENV_FILE") == root ]] || fail "$ENV_FILE must be root-owned"
ENV_MODE=$(sudo stat -c '%a' "$ENV_FILE")
[[ $ENV_MODE =~ ^[0-7]+$ ]] || fail 'could not validate environment-file permissions'
(( (8#$ENV_MODE & 077) == 0 )) || fail "$ENV_FILE must not be readable or writable by group/other (expected mode 600 or stricter)"

if ! PUBLIC_ORIGIN=$(read_public_origin); then
  fail 'could not read a safe HTTPS PUBLIC_ORIGIN from the root-owned environment file'
fi
ORIGIN_HOST=$($NODE_BIN -e 'console.log(new URL(process.argv[1]).hostname)' "$PUBLIC_ORIGIN")
DB_FILE=$(read_config_value DB_FILE)
DATA_DIR=$(read_config_value DATA_DIR)
UPLOAD_DIR=$(read_config_value UPLOAD_DIR)
MIGRATION_BACKUP_DIR=$(read_config_value MIGRATION_BACKUP_DIR)
PORT=$(read_config_value PORT)
[[ -n $DATA_DIR ]] || fail 'DATA_DIR must be explicitly configured outside the release tree'
[[ -n $UPLOAD_DIR ]] || fail 'UPLOAD_DIR must be explicitly configured outside the release tree'
DB_FILE=${DB_FILE:-$DATA_DIR/khyeast.db}
MIGRATION_BACKUP_DIR=${MIGRATION_BACKUP_DIR:-/var/lib/khyeast/migration-backups}
PORT=${PORT:-8787}
[[ $DB_FILE == /* && $DATA_DIR == /* && $UPLOAD_DIR == /* && $MIGRATION_BACKUP_DIR == /* ]] || \
  fail 'DB_FILE, DATA_DIR, UPLOAD_DIR and MIGRATION_BACKUP_DIR must be absolute paths'
assert_persistent_path_outside_releases DB_FILE "$DB_FILE"
assert_persistent_path_outside_releases DATA_DIR "$DATA_DIR"
assert_persistent_path_outside_releases UPLOAD_DIR "$UPLOAD_DIR"
assert_persistent_path_outside_releases MIGRATION_BACKUP_DIR "$MIGRATION_BACKUP_DIR"
if [[ ! $PORT =~ ^[0-9]+$ ]] || (( 10#$PORT < 1 || 10#$PORT > 65535 )); then
  fail 'PORT must be an integer from 1 to 65535'
fi
sudo test -f "$DB_FILE" || fail "production database is missing: $DB_FILE"
sudo test -d "$DATA_DIR" || fail "persistent data directory is missing: $DATA_DIR"
sudo test -d "$UPLOAD_DIR" || fail "persistent upload directory is missing: $UPLOAD_DIR"
if ! sudo -u "$APP_USER" test -r "$DB_FILE" || ! sudo -u "$APP_USER" test -w "$DB_FILE"; then
  fail "service user $APP_USER must be able to read and write $DB_FILE"
fi
DB_PARENT=$(dirname -- "$DB_FILE")
for persistent_dir in "$DATA_DIR" "$UPLOAD_DIR" "$DB_PARENT"; do
  if ! sudo -u "$APP_USER" test -r "$persistent_dir" ||
    ! sudo -u "$APP_USER" test -w "$persistent_dir" ||
    ! sudo -u "$APP_USER" test -x "$persistent_dir"; then
    fail "service user $APP_USER needs read/write/traverse access to persistent directory $persistent_dir"
  fi
done
SERVICE_PATH="$(dirname -- "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin"
sudo -H -u "$APP_USER" -- env PATH="$SERVICE_PATH" "$NODE_BIN" --version >/dev/null || \
  fail "service user $APP_USER cannot run the deployment Node.js binary"
sudo -H -u "$APP_USER" -- env PATH="$SERVICE_PATH" "$NPM_BIN" --version >/dev/null || \
  fail "service user $APP_USER cannot run the deployment npm binary"

sudo systemctl is-active --quiet "$APP_SERVICE" || fail "$APP_SERVICE must already be active"
sudo systemctl is-active --quiet "$NGINX_SERVICE" || fail "$NGINX_SERVICE must already be active"
curl --silent --show-error --fail --max-time 8 "http://127.0.0.1:$PORT/api/health" >/dev/null || \
  fail 'current Node service failed its local health check'
assert_public_health || fail 'current public HTTPS health check failed through local Nginx'
assert_persisted_content

AVAILABLE_KB=$(df -Pk "$RELEASES_DIR" | awk 'NR == 2 { print $4 }')
[[ $AVAILABLE_KB =~ ^[0-9]+$ ]] || fail 'could not determine free space for releases'
(( AVAILABLE_KB >= MIN_FREE_KB )) || \
  fail "less than 1.5 GiB is free for a safe staged release (${AVAILABLE_KB} KiB available); review old releases manually"

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
STAGE_DIR=$(mktemp -d "$RELEASES_REAL/.deploy-stage.XXXXXXXX")
info 'Cloning the approved origin/main (repository URL is not echoed)'
git clone --depth 1 --single-branch --branch main --no-tags -- "$REPOSITORY_URL" "$STAGE_DIR"
COMMIT=$(git -C "$STAGE_DIR" rev-parse --verify HEAD)
[[ $COMMIT =~ ^[0-9a-f]{40}$ ]] || fail 'could not identify the fetched main commit'
if [[ -n $CONFIRM_COMMIT && $CONFIRM_COMMIT != "$COMMIT" ]]; then
  fail "main has advanced or changed since review (confirmed $CONFIRM_COMMIT, fetched $COMMIT); run --dry-run again"
fi
SHORT_COMMIT=${COMMIT:0:12}
RELEASE_DIR="$RELEASES_REAL/$STAMP-$SHORT_COMMIT"
[[ ! -e $RELEASE_DIR && ! -L $RELEASE_DIR ]] || fail "release directory already exists: $RELEASE_DIR"
[[ -z $(git -C "$STAGE_DIR" status --porcelain) ]] || fail 'fresh checkout is unexpectedly dirty'

info "Candidate: main@$COMMIT"
printf '  %s\n' "$(git -C "$STAGE_DIR" log -1 --format='%s')"

# Root-owned operational templates are intentionally not installed by a code
# update. Stop if the release expects different privileged files or CSP-bound
# fallback HTML so an operator can review and apply those changes separately.
check_installed_copy "$STAGE_DIR/ops/backup-khyeast" /usr/local/sbin/backup-khyeast
check_installed_copy "$STAGE_DIR/ops/replicate-khyeast-restic" /usr/local/sbin/replicate-khyeast-restic
check_installed_copy "$STAGE_DIR/ops/systemd/khyeast-backup.service" /etc/systemd/system/khyeast-backup.service
check_installed_copy "$STAGE_DIR/ops/systemd/khyeast-backup.timer" /etc/systemd/system/khyeast-backup.timer
check_installed_copy "$STAGE_DIR/ops/systemd/khyeast-offsite.service" /etc/systemd/system/khyeast-offsite.service
check_installed_copy "$STAGE_DIR/ops/systemd/khyeast-offsite.timer" /etc/systemd/system/khyeast-offsite.timer
check_installed_copy "$STAGE_DIR/ops/systemd/khyeast-quarantine-purge.service" /etc/systemd/system/khyeast-quarantine-purge.service
check_installed_copy "$STAGE_DIR/ops/systemd/khyeast-quarantine-purge.timer" /etc/systemd/system/khyeast-quarantine-purge.timer
check_installed_copy "$STAGE_DIR/ops/payment-callback-unavailable.html" "$CALLBACK_FALLBACK"

info 'Installing the lockfile-defined dependencies'
(
  cd "$STAGE_DIR"
  "$NPM_BIN" ci
  info 'Running npm test (production-origin build and non-E2E checks; E2E is not run)'
  PUBLIC_ORIGIN="$PUBLIC_ORIGIN" "$NPM_BIN" test
  info 'Removing build/test-only dependencies from the deployable release'
  "$NPM_BIN" prune --omit=dev
  "$NPM_BIN" audit --omit=dev --audit-level=high
)

test -f "$STAGE_DIR/dist/index.html" || fail 'production build did not produce dist/index.html'
test -f "$STAGE_DIR/dist/sitemap.xml" || fail 'production build did not produce dist/sitemap.xml'
test -f "$STAGE_DIR/dist/sitemap.xsl" || fail 'production build did not produce dist/sitemap.xsl'
grep -Fq "<loc>$PUBLIC_ORIGIN/" "$STAGE_DIR/dist/sitemap.xml" || \
  fail 'built sitemap does not use the configured production origin'

# Give the locked service account read-only access before the database preflight.
sudo chown -R "$DEPLOY_USER:$APP_USER" "$STAGE_DIR"
sudo chmod -R o-rwx "$STAGE_DIR"
sudo chmod -R g+rX "$STAGE_DIR"

info 'Checking the candidate schema with a read-only migration dry-run'
MIGRATION_STATUS=0
if run_migration_dry_run "$STAGE_DIR"; then
  :
else
  MIGRATION_STATUS=$?
fi
case "$MIGRATION_STATUS" in
  0) ;;
  3) fail 'the candidate reports a pending schema migration; no migration was run. Review and run npm run db:migrate manually, then retry the deployment' 3 ;;
  *) fail "candidate schema preflight failed with exit $MIGRATION_STATUS; no migration or cutover was performed" ;;
esac

info 'Checking that the previous release can still validate the current database'
ROLLBACK_SCHEMA_STATUS=0
if run_migration_dry_run "$PREVIOUS_RELEASE"; then
  :
else
  ROLLBACK_SCHEMA_STATUS=$?
fi
(( ROLLBACK_SCHEMA_STATUS == 0 )) || \
  fail "previous release is not schema-compatible with the current database (read-only check exited $ROLLBACK_SCHEMA_STATUS); refusing a cutover that cannot be safely rolled back by code alone"
ROLLBACK_COMPATIBLE=1

if (( DRY_RUN == 1 )); then
  info "Dry run passed for main@$COMMIT. No live backup, symlink switch, service restart, or database write was performed."
  exit 0
fi

info "Ready to deploy main@$COMMIT to $PUBLIC_ORIGIN"
if [[ -n $CONFIRM_COMMIT ]]; then
  info 'The full fetched SHA matches --confirm-commit.'
else
  [[ -t 0 ]] || fail 'non-interactive use requires --confirm-commit with the full SHA reviewed from a prior --dry-run'
  printf 'Type the first 12 characters of the commit (%s) to continue: ' "$SHORT_COMMIT"
  IFS= read -r CONFIRMATION
  [[ $CONFIRMATION == "$SHORT_COMMIT" ]] || fail 'commit confirmation did not match; no live backup or cutover was performed'
fi

assert_current_unchanged
run_oneshot_and_verify "$LOCAL_BACKUP_SERVICE"
run_oneshot_and_verify "$OFFSITE_BACKUP_SERVICE"
assert_current_unchanged

info 'Publishing the tested release directory'
mv -- "$STAGE_DIR" "$RELEASE_DIR"
STAGE_DIR=

[[ ! -e $NEXT_LINK && ! -L $NEXT_LINK ]] || fail "$NEXT_LINK already exists; inspect it and remove it manually before retrying"
ln -s -- "$RELEASE_DIR" "$NEXT_LINK"
NEXT_LINK_CREATED=1
mv -Tf -- "$NEXT_LINK" "$CURRENT_LINK"
NEXT_LINK_CREATED=0

info 'Restarting the existing Node service'
sudo systemctl restart "$APP_SERVICE" || fail 'systemd restart failed after cutover'

healthy=0
for ((attempt = 1; attempt <= 30; attempt++)); do
  if assert_public_health; then
    healthy=1
    break
  fi
  sleep 2
done
(( healthy == 1 )) || fail 'new release did not pass public HTTPS health checks within 60 seconds'
assert_persisted_content

SITEMAP=$(curl --silent --show-error --fail --max-time 15 \
  --resolve "$ORIGIN_HOST:443:127.0.0.1" \
  "$PUBLIC_ORIGIN/sitemap.xml") || fail 'deployed sitemap request failed'
grep -Fq "<loc>$PUBLIC_ORIGIN/" <<<"$SITEMAP" || fail 'deployed sitemap does not contain the production origin'
ROBOTS=$(curl --silent --show-error --fail --max-time 10 \
  --resolve "$ORIGIN_HOST:443:127.0.0.1" \
  "$PUBLIC_ORIGIN/robots.txt") || fail 'deployed robots.txt request failed'
grep -Fq "Sitemap: $PUBLIC_ORIGIN/sitemap.xml" <<<"$ROBOTS" || fail 'robots.txt does not advertise the deployed sitemap'

info 'Deployment passed all post-cutover checks.'
printf '  New release:      %s\n' "$RELEASE_DIR"
printf '  Previous release: %s\n' "$PREVIOUS_RELEASE"
printf '  Commit:           %s\n' "$COMMIT"
printf '  Health:           %s/api/health\n' "$PUBLIC_ORIGIN"
info 'Old releases are retained; disk cleanup is deliberately a separate reviewed action.'
exit 0
