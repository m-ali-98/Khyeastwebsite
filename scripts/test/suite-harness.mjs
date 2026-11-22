import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export async function runNodeSuite(file, { cwd, timeout }) {
  try {
    const { stdout } = await execute(process.execPath, [file], { cwd, timeout });
    return { stdout, failed: false, error: '' };
  } catch (cause) {
    return {
      stdout: String(cause?.stdout || ''),
      failed: true,
      error: String(cause?.stderr || cause?.message || cause).trim(),
    };
  }
}

export function summarizeNodeSuite({ stdout = '', failed = false, error = '' }) {
  const line = stdout.trim().split('\n').pop() || '';
  const ratio = line.match(/(\d+)\/(\d+)/);
  const leaks = stdout
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith('LEAK'));
  const ok = !failed && Boolean(ratio) && ratio[1] === ratio[2];
  const detail = leaks.join('; ') || error || (ratio ? ratio[0] : 'missing N/M summary');

  return { line, ratio, leaks, ok, detail };
}
