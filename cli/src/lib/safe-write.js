import { writeFileSync, renameSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { randomBytes } from 'crypto';

/**
 * Atomically write JSON to a file using write-to-temp-then-rename.
 * renameSync is atomic on POSIX; on Windows it is close enough for
 * single-process coordination (the only gap is cross-process, which
 * we guard against at the protocol level).
 */
export function safeWriteJson(filePath, data) {
  const dir = dirname(filePath);
  const tmpName = `.tmp-${randomBytes(6).toString('hex')}.json`;
  const tmpPath = join(dir, tmpName);

  mkdirSync(dir, { recursive: true });
  writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n');

  try {
    renameSync(tmpPath, filePath);
  } catch (err) {
    try { unlinkSync(tmpPath); } catch {}
    throw err;
  }
}

/**
 * Atomically write plain text to a file.
 */
export function safeWriteText(filePath, text) {
  const dir = dirname(filePath);
  const tmpName = `.tmp-${randomBytes(6).toString('hex')}`;
  const tmpPath = join(dir, tmpName);

  mkdirSync(dir, { recursive: true });
  writeFileSync(tmpPath, text);

  try {
    renameSync(tmpPath, filePath);
  } catch (err) {
    try { unlinkSync(tmpPath); } catch {}
    throw err;
  }
}
