/* Atomic JSON persistence must never turn a failed serialization into a
   truncated authoritative file. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeJsonAtomicSync } from '../../server/jsonFile.js';

let pass = 0;
let fail = 0;
const check = (ok, name, detail = '') => {
  if (ok) pass += 1;
  else {
    fail += 1;
    console.log(`LEAK ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ky-atomic-json-'));
const file = path.join(root, 'content.json');

try {
  fs.writeFileSync(file, JSON.stringify({ version: 1 }), { mode: 0o640 });
  writeJsonAtomicSync(file, { version: 2, nested: { healthy: true } });
  const written = JSON.parse(fs.readFileSync(file, 'utf8'));
  check(written.version === 2 && written.nested?.healthy === true, 'a complete JSON document atomically replaces the old one');
  if (process.platform !== 'win32') {
    check((fs.statSync(file).mode & 0o777) === 0o640, 'replacement preserves the destination file mode');
  }
  check(
    !fs.readdirSync(root).some((name) => name.includes('.tmp-')),
    'a successful write leaves no temporary sibling behind',
    fs.readdirSync(root).join(' '),
  );

  const before = fs.readFileSync(file, 'utf8');
  const circular = {};
  circular.self = circular;
  let refused = false;
  try {
    writeJsonAtomicSync(file, circular);
  } catch {
    refused = true;
  }
  check(refused, 'an unserializable value is refused');
  check(fs.readFileSync(file, 'utf8') === before, 'a refused write leaves the authoritative file byte-for-byte intact');
  check(
    !fs.readdirSync(root).some((name) => name.includes('.tmp-')),
    'a refused write leaves no temporary sibling behind',
  );
} catch (error) {
  check(false, 'atomic JSON harness', error?.stack || String(error));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`${pass}/${pass + fail}`);
if (fail) process.exit(1);
