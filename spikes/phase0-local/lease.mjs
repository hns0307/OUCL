import { open, realpath, lstat, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Cooperative experiment only: resolves aliases, exclusively creates a marker. */
export async function acquireLease(root, leaveEmpty = false) {
  const canonical = await realpath(root);
  if (!path.basename(canonical).startsWith('oucl-phase0-') || !(await lstat(canonical)).isDirectory()) throw new Error('NOT_FIXTURE');
  const marker = path.join(canonical, '.oucl-experiment-lease');
  let handle;
  try { handle = await open(marker, 'wx'); }
  catch (error) { if (error.code === 'EEXIST') return { status: 'busy' }; throw error; }
  const token = randomUUID();
  try {
    if (!leaveEmpty) await handle.writeFile(JSON.stringify({ token, pid: process.pid }));
    await handle.sync();
  } finally { await handle.close(); }
  return { status: 'acquired', token };
}

/** Does not reclaim stale/foreign markers; never guesses by PID or age. */
export async function releaseLease(root, token) {
  const canonical = await realpath(root);
  if (!path.basename(canonical).startsWith('oucl-phase0-')) throw new Error('NOT_FIXTURE');
  const marker = path.join(canonical, '.oucl-experiment-lease');
  try {
    const info = await lstat(marker);
    if (!info.isFile() || info.isSymbolicLink()) return false;
    const owner = JSON.parse(await readFile(marker, 'utf8'));
    if (owner?.token !== token || typeof token !== 'string') return false;
    await unlink(marker); return true;
  } catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return false; throw error; }
}
