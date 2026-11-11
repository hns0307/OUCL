import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { HashPool } from '../workers/hash-pool.js';
import { guardDirectory } from '../storage/files.js';
import { GameProcessError } from '../launch/process.js';

/** Ephemeral observation of the native tree already verified by trusted extraction. */
export interface NativeFileFact { relative: string; size: number; sha256: string }
/** Reads only; never repairs, creates directories or follows a native-tree link. */
export async function readNativeSnapshot(directory: string, hashes: Pick<HashPool, 'hash'>, signal: AbortSignal): Promise<NativeFileFact[]> {
  const files: NativeFileFact[] = []; let count = 0; let total = 0;
  const visit = async (folder: string, relative: string): Promise<void> => {
    if (signal.aborted) throw new GameProcessError('CANCELLED');
    await guardDirectory(folder);
    const names = (await readdir(folder)).sort();
    for (const name of names) {
      if (signal.aborted) throw new GameProcessError('CANCELLED');
      if (++count > 4096) throw new GameProcessError('NEEDS_RECOVERY');
      const file = path.join(folder, name); const key = relative ? `${relative}/${name}` : name;
      const before = await lstat(file);
      if (before.isSymbolicLink()) throw new GameProcessError('NEEDS_RECOVERY');
      if (before.isDirectory()) { await visit(file, key); continue; }
      total += before.size;
      if (!before.isFile() || before.size > 64 * 1024 ** 2 || total > 256 * 1024 ** 2) throw new GameProcessError('NEEDS_RECOVERY');
      const measured = await hashes.hash(file, { maximumBytes: before.size, signal });
      const after = await lstat(file);
      if (after.isSymbolicLink() || !after.isFile() || before.ino !== after.ino || before.dev !== after.dev
        || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || measured.size !== before.size) throw new GameProcessError('NEEDS_RECOVERY');
      files.push({ relative: key, size: measured.size, sha256: measured.sha256 });
    }
    if (JSON.stringify(names) !== JSON.stringify((await readdir(folder)).sort())) throw new GameProcessError('NEEDS_RECOVERY');
  };
  await visit(directory, ''); return files;
}
