/* Crash-safe JSON persistence for small authoritative state files.

   Writing directly to the destination can truncate the only good copy if the
   process or host stops between open() and write(). Build and fsync a complete
   sibling first, then replace the destination with one atomic rename. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const fileMode = (file, fallback) => {
  try {
    return fs.statSync(file).mode & 0o777;
  } catch {
    return fallback;
  }
};

export function writeJsonAtomicSync(file, value, { mode = 0o600 } = {}) {
  /* Serialize before touching the filesystem. A circular or otherwise invalid
     value must leave both the destination and its directory unchanged. */
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) throw new TypeError('JSON value is not serializable');

  const directory = path.dirname(file);
  const basename = path.basename(file);
  const destinationMode = fileMode(file, mode);
  const temporary = path.join(
    directory,
    `.${basename}.tmp-${process.pid}-${crypto.randomBytes(8).toString('hex')}`,
  );

  let descriptor = null;
  try {
    descriptor = fs.openSync(
      temporary,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
      destinationMode,
    );
    fs.writeFileSync(descriptor, serialized, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;

    /* On the production Linux filesystem this is one atomic replacement: a
       reader sees either the complete old file or the complete new file. */
    fs.renameSync(temporary, file);

    /* Persist the directory entry as well when the platform permits opening a
       directory for fsync. Some development platforms reject this operation;
       the atomic rename above still remains the important safety boundary. */
    let directoryDescriptor = null;
    try {
      directoryDescriptor = fs.openSync(directory, fs.constants.O_RDONLY);
      fs.fsyncSync(directoryDescriptor);
    } catch (error) {
      /* Windows and a few filesystems do not support directory fsync. Do not
         hide a genuine Linux I/O failure behind that portability exception. */
      const unsupported = ['EINVAL', 'ENOTSUP', 'EBADF', 'EISDIR'].includes(error?.code) ||
        (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error?.code));
      if (!unsupported) throw error;
    } finally {
      if (directoryDescriptor !== null) {
        try { fs.closeSync(directoryDescriptor); } catch {}
      }
    }
  } catch (error) {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch {}
    }
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}
