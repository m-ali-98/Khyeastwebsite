import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const SCRIPT = path.join(ROOT, 'ops', 'deploy-khyeast-ubuntu.sh');
const source = fs.readFileSync(SCRIPT, 'utf8');
const guide = fs.readFileSync(path.join(ROOT, 'docs', 'khyeast-linux-deployment-guide.html'), 'utf8');
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const renderer = fs.readFileSync(path.join(ROOT, 'scripts', 'render-deployment-pdf.mjs'), 'utf8');
let pass = 0;
let total = 0;
const failures = [];
const check = (condition, label, detail = '') => {
  total++;
  if (condition) pass++;
  else failures.push(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
};
const occurrences = (text, value) => text.split(value).length - 1;

const bashSyntax = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
check(bashSyntax.status === 0, 'Ubuntu deployment script parses as Bash', bashSyntax.stderr);
check((fs.statSync(SCRIPT).mode & 0o111) !== 0, 'deployment script is executable in Git');

const help = spawnSync('bash', [SCRIPT, '--help'], { encoding: 'utf8' });
check(
  help.status === 0 && help.stdout.includes('--dry-run') && help.stdout.includes('--confirm-commit') && help.stdout.includes('origin/main'),
  '--help exits safely and explains the reviewed main-branch deployment',
  `${help.status} ${help.stderr}`,
);
const badOption = spawnSync('bash', [SCRIPT, '--not-a-real-option'], { encoding: 'utf8' });
check(badOption.status === 1 && badOption.stderr.includes('unknown option'), 'unknown options fail before server access');
const conflictingOptions = spawnSync('bash', [SCRIPT, '--dry-run', '--confirm-commit', 'a'.repeat(40)], { encoding: 'utf8' });
check(
  conflictingOptions.status === 1 && conflictingOptions.stderr.includes('cannot be combined'),
  'dry-run cannot be combined with commit approval for a live cutover',
);
const embeddedCredentials = spawnSync('bash', [SCRIPT, '--dry-run'], {
  encoding: 'utf8',
  env: { ...process.env, KHYEAST_REPO_URL: 'https://deploy:secret@example.test/repo.git' },
});
check(
  embeddedCredentials.status === 1 && embeddedCredentials.stderr.includes('do not embed repository credentials'),
  'repository credentials in HTTPS clone URLs are rejected before server access',
);

const trapIndex = source.indexOf('trap cleanup EXIT');
const optionLoopIndex = source.indexOf('while (($#))');
check(
  trapIndex > 0 && trapIndex < optionLoopIndex && source.includes("trap 'exit 130' INT") && source.includes("trap 'exit 143' TERM"),
  'EXIT and signal cleanup traps are registered before argument parsing and early failures',
);
check(
  source.includes('case "$STAGE_DIR" in') && source.includes('"$RELEASES_REAL"/.deploy-stage.*) rm -rf'),
  'cleanup only removes its own temporary staging directory',
);
check(source.includes('set -Eeuo pipefail') && source.includes('umask 077'), 'shell errors and temporary files fail closed');
check(source.includes('flock -n 9') && source.includes('current.next') && source.includes('assert_current_unchanged'), 'concurrent deployments are locked, state is rechecked, and symlink publication is atomic');
check(source.includes('--depth 1 --single-branch --branch main'), 'only the approved main branch is fetched as a shallow release');
check(
  source.includes('do not embed repository credentials') && source.includes('repository URL is not echoed'),
  'private-repository credentials are not accepted in the clone URL or echoed in logs',
);
check(
  source.includes('assert_persistent_path_outside_releases') && source.includes('sudo realpath -m') &&
    source.includes('assert_persistent_path_outside_releases DB_FILE') &&
    source.includes('assert_persistent_path_outside_releases DATA_DIR') &&
    source.includes('assert_persistent_path_outside_releases UPLOAD_DIR') &&
    source.includes('assert_persistent_path_outside_releases MIGRATION_BACKUP_DIR'),
  'database, content, upload and migration-backup paths must resolve outside managed releases',
);
check(
  source.includes('DATA_DIR must be explicitly configured') && source.includes('UPLOAD_DIR must be explicitly configured') &&
    source.includes('service user $APP_USER must be able to read and write'),
  'persistent state paths and application-account access fail closed when missing or unsafe',
);

const installIndex = source.indexOf('"$NPM_BIN" ci');
const testIndex = source.indexOf('PUBLIC_ORIGIN="$PUBLIC_ORIGIN" "$NPM_BIN" test');
const pruneIndex = source.indexOf('"$NPM_BIN" prune --omit=dev');
const auditIndex = source.indexOf('"$NPM_BIN" audit --omit=dev --audit-level=high');
check(
  installIndex >= 0 && testIndex > installIndex && pruneIndex > testIndex && auditIndex > pruneIndex &&
    !source.includes('"$NPM_BIN" audit --audit-level=high'),
  'locked install and full tests precede pruning dev tools and auditing production dependencies',
);
check(source.includes('khyeast-backup.service') && source.includes('khyeast-offsite.service'), 'validated local and offsite backups gate cutover');
check(source.includes('x-khyeast-content-status') && source.includes('/sitemap.xml') && source.includes('/robots.txt'), 'post-cutover checks verify persisted content and SEO endpoints');
check(source.includes('check_installed_copy') && source.includes('payment-callback-unavailable.html'), 'privileged maintenance files and callback CSP page must match before release');

const migrationFunctionStart = source.indexOf('run_migration_dry_run() {');
const migrationFunctionEnd = source.indexOf('\n}\n\n# shellcheck disable=SC2329\nrollback_code_only()', migrationFunctionStart);
const migrationFunction = migrationFunctionStart < 0 || migrationFunctionEnd < 0
  ? ''
  : source.slice(migrationFunctionStart, migrationFunctionEnd);
check(
  migrationFunction.includes('"$NPM_BIN" run db:migrate --') && migrationFunction.includes('--dry-run') &&
    occurrences(source, '"$NPM_BIN" run db:migrate --') === 1,
  'the sole migration command is encapsulated as a read-only dry-run',
);
check(
  source.includes('run_migration_dry_run "$STAGE_DIR"') &&
    occurrences(source, 'run_migration_dry_run "$PREVIOUS_RELEASE"') >= 2 &&
    source.includes('ROLLBACK_COMPATIBLE=1') &&
    source.includes('refusing a cutover that cannot be safely rolled back by code alone'),
  'candidate, previous release, and rollback each verify current-schema compatibility before code switching',
);
check(!/npm\s+run\s+db:migrate\s+--(?![\s\S]{0,260}--dry-run)/.test(source), 'no automatic mutating schema migration is present');

const rollbackStart = source.indexOf('rollback_code_only() {');
const rollbackEnd = source.indexOf('\n}\n\n# shellcheck disable=SC2329\ncleanup()', rollbackStart);
const rollback = rollbackStart < 0 || rollbackEnd < 0 ? '' : source.slice(rollbackStart, rollbackEnd);
check(
  rollback.includes('active_target != "$RELEASE_DIR"') &&
    rollback.includes('"$RELEASES_REAL"/*') && rollback.includes('realpath -e') &&
    rollback.includes('mv -Tf -- "$rollback_link" "$CURRENT_LINK"'),
  'code rollback requires the exact candidate target and a verified previous release before atomic switch',
);
check(
  rollback.includes('sudo systemctl restart "$APP_SERVICE"') &&
    rollback.includes('assert_public_health && persisted_content_is_healthy') &&
    rollback.includes('ROLLBACK_COMPATIBLE'),
  'rollback restarts the old service and verifies local/public health and persisted content',
);
check(
  rollback.includes('database and persistent files were not rolled back') &&
    rollback.includes('writes accepted by the failed release remain') &&
    !/(?:cp|mv|rm)[^\n]*(?:DB_FILE|DATA_DIR|UPLOAD_DIR)/i.test(rollback),
  'rollback changes code only and leaves database, persistent data, and accepted writes untouched',
);
const cleanupStart = source.indexOf('cleanup() {');
const cleanupEnd = source.indexOf('\n}\n\ntrap cleanup EXIT', cleanupStart);
const cleanup = cleanupStart < 0 || cleanupEnd < 0 ? '' : source.slice(cleanupStart, cleanupEnd);
check(
  cleanup.includes('(( status != 0 ))') && cleanup.includes('active_target == "$RELEASE_DIR"') && cleanup.includes('rollback_code_only || true'),
  'failed post-cutover operations invoke guarded rollback only while current still points at this candidate',
);
check(!/test:e2e|playwright test/.test(source), 'the deploy script does not run E2E tests');

check(
  guide.includes('ops/deploy-khyeast-ubuntu.sh --dry-run') &&
    guide.includes('--confirm-commit FULL_40_CHARACTER_SHA') &&
    guide.includes('Migrations remain operator-controlled') &&
    guide.includes('Guarded code-only rollback') &&
    guide.includes('never restores the database, uploads, orders, payments, or other persistent data'),
  'deployment PDF source documents guarded code-only rollback and explicit no-migration/no-data-rollback boundaries',
);
check(
  readme.includes('npm prune --omit=dev') && readme.includes('npm audit --omit=dev --audit-level=high') &&
    readme.includes('symlink کد را اتمیک برمی‌گرداند') && readme.includes('هیچ database، upload یا persistent dataای rollback نمی‌شود'),
  'README describes the production-only audit, dev-tool pruning, guarded code fallback, and no data rollback',
);
check(
  guide.includes('8 September 2026') && renderer.includes('8 Sep 2026') && !guide.includes('18 November 2026'),
  'HTML/PDF renderer edition dates match 8 September 2026',
);

for (const failure of failures) console.log(failure);
console.log(`${pass}/${total}`);
if (pass !== total) process.exitCode = 1;
