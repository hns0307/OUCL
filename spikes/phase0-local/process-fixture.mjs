import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const worker = fileURLToPath(new URL('./storage-worker.mjs', import.meta.url));

/** Kills only the child created here after its explicit boundary acknowledgement. */
export async function killAt(mode, root, boundary, extraArgs = []) {
  const child = fork(worker, [mode, root, boundary, ...extraArgs], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const ended = once(child, 'exit');
  let timer;
  try {
    const message = await Promise.race([
      once(child, 'message'),
      ended.then(() => { throw new Error('CHILD_EXITED_BEFORE_BOUNDARY: ' + stderr); }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('CHILD_TIMEOUT')), 15000);
        timer.unref();
      }),
    ]);
    assert.equal(message[0].checkpoint, boundary);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill('SIGKILL');
    await ended;
  }
}
