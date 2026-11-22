/* The promoted production tree deliberately omits editorial originals and
   operator documentation, but keeps the non-browser deployment test suite.
   A marker written by the promotion workflow selects only the handful of
   source-only documentation/archive assertions; runtime checks still run. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const marker = path.join(root, 'scripts', 'test', '.production-tree');
export const productionTree = fs.existsSync(marker);
if (productionTree && fs.readFileSync(marker, 'utf8') !== 'khyeast-production-tree-v1\n') {
  throw new Error('invalid production-tree test profile marker');
}
