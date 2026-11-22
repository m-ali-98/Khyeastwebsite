/* Promotion must ship the non-browser suite the VPS updater actually runs,
   without shipping browser E2E or the source-only documentation/originals. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/promote-production.yml'), 'utf8');
const npm = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const match = workflow.match(/  PRODUCTION_PATHS: \|\n((?:    .+\n)+)/);
const paths = match ? match[1].trim().split('\n').map((line) => line.trim()) : [];
let passed = 0;
let total = 0;
function check(value, name) {
  total++;
  if (value) passed++;
  else console.log(`LEAK ${name}`);
}

check(paths.includes('scripts/test'), 'promotion includes the suite needed by npm test');
check(!paths.some((entry) => /^(e2e|assets-src|docs)(\/|$)/.test(entry)), 'production tree excludes E2E, documentation and source images');
check(npm.scripts.test.includes('scripts/test/run.mjs'), 'npm test invokes the included non-browser suite');
check(workflow.includes('mapfile -t paths <<< "$PRODUCTION_PATHS"') &&
  workflow.includes('mapfile -t PRODUCTION_FILES <<< "$PRODUCTION_PATHS"'), 'verification and promotion use the same allowlist');
check(workflow.includes('git archive HEAD -- "${paths[@]}"') &&
  workflow.includes('git checkout "$TESTED_SHA" -- "${PRODUCTION_FILES[@]}"'), 'verification and promotion assemble the tested source');
check(workflow.includes('git add -- scripts/test/.production-tree') &&
  workflow.includes('> "$target/scripts/test/.production-tree"'), 'both production trees include the explicit release profile marker');
check(workflow.includes('scripts/test/run.mjs scripts/test/.production-tree') &&
  workflow.includes('scripts/purge-upload-quarantine.mjs|scripts/test/*'), 'both the required-file check and allowed-path guard recognize the test suite');
check(!/npx playwright test|npm run test:e2e/.test(workflow), 'promotion does not run browser E2E');
check(workflow.includes('refs/heads/arena/01a07ff9-khyeastwebsite') &&
  workflow.includes('git show "$GITHUB_SHA:.github/workflows/promote-production.yml" | cmp -s - .github/workflows/promote-production.yml'),
  'promotion runs the reviewed source workflow and rejects a stale dispatched copy');

// A missing marker uses the full source profile; an invalid marker must never
// silently suppress source-only checks. Exercise the real profile module in a
// disposable tree without touching the working checkout or application data.
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'khyeast-release-profile-'));
try {
  const dir = path.join(temporary, 'scripts', 'test');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(root, 'scripts/test/release-profile.mjs'), path.join(dir, 'release-profile.mjs'));
  const script = `import { productionTree } from ${JSON.stringify(pathToFileURL(path.join(dir, 'release-profile.mjs')).href)}; console.log(productionTree)`;
  const run = () => spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  let result = run();
  check(result.status === 0 && result.stdout.trim() === 'false', 'source tree defaults to the full source profile');
  fs.writeFileSync(path.join(dir, '.production-tree'), 'khyeast-production-tree-v1\n');
  result = run();
  check(result.status === 0 && result.stdout.trim() === 'true', 'release marker selects the explicit production profile');
  fs.writeFileSync(path.join(dir, '.production-tree'), 'invalid\n');
  result = run();
  check(result.status !== 0, 'malformed production marker fails closed');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
console.log(`${passed}/${total}`);
if (passed !== total) process.exitCode = 1;
