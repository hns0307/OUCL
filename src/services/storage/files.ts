import { lstat, open, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

export const MAX_RECORD_BYTES = 4 * 1024 * 1024;
export type StorageCode = 'INVALID_RECORD' | 'REVISION_CONFLICT' | 'NEEDS_RECOVERY' | 'STORE_BUSY' | 'UNSAFE_PATH' | 'STORAGE_IO';

/** Redacted storage failure; raw operating-system errors never enter UI responses. */
export class StorageError extends Error {
  readonly category: 'validation' | 'biz' | 'disk';
  constructor(readonly code: StorageCode) {
    super(code); this.name = 'StorageError';
    this.category = code === 'INVALID_RECORD' || code === 'UNSAFE_PATH' ? 'validation'
      : code === 'REVISION_CONFLICT' || code === 'STORE_BUSY' ? 'biz' : 'disk';
  }
}

/** Tests only fixed OS error codes, retaining no source error text. */
export function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

/** Requires an already chosen private directory; rejects links at every current ancestor. */
export async function guardDirectory(directory: string): Promise<string> {
  if (!path.isAbsolute(directory)) throw new StorageError('UNSAFE_PATH');
  const resolved = path.resolve(directory);
  const root = path.parse(resolved).root;
  if (process.platform === 'win32' && !/^[a-zA-Z]:\\$/.test(root)) throw new StorageError('UNSAFE_PATH');
  let current = root;
  for (const part of resolved.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new StorageError('UNSAFE_PATH');
  }
  // Windows may expand a harmless 8.3 name (ADMINI~1) even with no linked ancestor.
  // Keep the canonical path after the explicit ancestor checks, rather than rejecting aliases by text.
  return realpath(resolved);
}

/** Reads a bounded regular file through a verified handle; absent is distinct from corrupt. */
export async function readRegular(file: string, maximum = MAX_RECORD_BYTES): Promise<Buffer | undefined> {
  let info;
  try { info = await lstat(file); } catch (error) { if (hasCode(error, 'ENOENT')) return undefined; throw error; }
  if (!info.isFile() || info.isSymbolicLink() || info.size > maximum) throw new StorageError('UNSAFE_PATH');
  const handle = await open(file, 'r');
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino || opened.size > maximum) throw new StorageError('UNSAFE_PATH');
    const bytes = Buffer.alloc(opened.size + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== opened.size) throw new StorageError('NEEDS_RECOVERY');
    return bytes.subarray(0, bytesRead);
  } finally { await handle.close(); }
}

/** Checks SQLite and sidecar entries without trying to interpret binary content. */
export async function guardDatabase(file: string): Promise<boolean> {
  let exists = false;
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try {
      const info = await lstat(file + suffix);
      if (!info.isFile() || info.isSymbolicLink()) throw new StorageError('UNSAFE_PATH');
      if (!suffix) exists = true;
    } catch (error) { if (!hasCode(error, 'ENOENT')) throw error; }
  }
  return exists;
}

/** Reads only the small lease marker, used before removing a lease owned by this process. */
export async function ownsLease(file: string, token: string): Promise<boolean> {
  const info = await lstat(file);
  return info.isFile() && !info.isSymbolicLink() && info.size < 100 && (await readFile(file, 'utf8')) === token;
}
