import { mkdtemp, lstat, readdir, unlink, rmdir, open, rename } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

/** Creates a unique disposable root; only this new tree can be cleaned. */
export async function fixture(parent = tmpdir()) {
  const root = await mkdtemp(path.join(parent, 'oucl-phase0-'));
  return { root, cleanup: () => clean(root, root) };
}

/** Removes leaves without following links; rejects targets outside the fixture. */
async function clean(root, entry) {
  const relative = path.relative(root, entry);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(root).startsWith('oucl-phase0-')) {
    throw new Error('OUTSIDE_FIXTURE');
  }
  const info = await lstat(entry);
  if (info.isSymbolicLink() || !info.isDirectory()) return unlink(entry);
  for (const child of await readdir(entry)) await clean(root, path.join(entry, child));
  await rmdir(entry);
}

/** Returns a deterministic digest of bytes, not a source trust claim. */
export function digest(bytes, algorithm = 'sha256') {
  return createHash(algorithm).update(bytes).digest('hex');
}

/** Flushes an experiment JSON then renames on the same volume. */
export async function atomicJson(file, value, failBeforeRename = false) {
  const temporary = file + '.tmp';
  const handle = await open(temporary, 'wx');
  try {
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
  } finally { await handle.close(); }
  if (failBeforeRename) throw new Error('INJECTED_DISK_FULL');
  await rename(temporary, file);
}
