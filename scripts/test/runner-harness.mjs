import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runNodeSuite, summarizeNodeSuite } from './suite-harness.mjs';

let pass = 0;
let fail = 0;
const check = (condition, label, detail = '') => {
  if (condition) {
    pass += 1;
    return;
  }
  fail += 1;
  console.log(`LEAK ${label}${detail ? ` — ${detail}` : ''}`);
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'khyeast-runner-'));
try {
  const passing = path.join(root, 'passing.mjs');
  fs.writeFileSync(passing, "console.log('2/2');\n");
  const passingResult = await runNodeSuite(passing, { cwd: root, timeout: 5000 });
  const passingSummary = summarizeNodeSuite(passingResult);
  check(passingSummary.ok, 'a passing child suite remains successful', JSON.stringify(passingSummary));

  const failing = path.join(root, 'failing.mjs');
  fs.writeFileSync(
    failing,
    "console.log('LEAK preserved child diagnostic');\nconsole.log('1/2');\nprocess.exitCode = 1;\n",
  );
  const failingResult = await runNodeSuite(failing, { cwd: root, timeout: 5000 });
  const failingSummary = summarizeNodeSuite(failingResult);
  check(failingResult.failed && !failingSummary.ok, 'a non-zero child suite fails the aggregate runner');
  check(failingSummary.line === '1/2', 'the rejected child summary is preserved', failingSummary.line);
  check(
    failingSummary.leaks.includes('LEAK preserved child diagnostic'),
    'the rejected child diagnostic is preserved',
    failingSummary.leaks.join('; '),
  );
  check(
    failingSummary.detail.includes('preserved child diagnostic'),
    'the preserved diagnostic is used in the aggregate failure detail',
    failingSummary.detail,
  );

  const malformed = path.join(root, 'malformed.mjs');
  fs.writeFileSync(malformed, "console.log('finished without a ratio');\n");
  const malformedSummary = summarizeNodeSuite(
    await runNodeSuite(malformed, { cwd: root, timeout: 5000 }),
  );
  check(
    !malformedSummary.ok && malformedSummary.detail === 'missing N/M summary',
    'a child without an N/M summary fails closed',
    JSON.stringify(malformedSummary),
  );
} catch (error) {
  check(false, 'runner harness', error?.stack || String(error));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`${pass}/${pass + fail}`);
if (fail) process.exitCode = 1;
