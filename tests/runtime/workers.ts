import { app } from 'electron';
import { mkdir, open, rm } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setInterval, clearInterval, setTimeout, clearTimeout } from 'node:timers';
import { StorageClient } from '../../src/services/workers/storage-client.js';
import { HashPool } from '../../src/services/workers/hash-pool.js';
import { controlTask } from '../../src/core/task/machine.js';

const root = process.argv[2]; const entry = process.argv[3];
assert.ok(root && path.basename(root).startsWith('oucl-runtime-workers-') && entry && path.isAbsolute(entry));
app.setPath('userData', path.join(root, 'profile'));
const deadline = setTimeout(() => { app.exit(1); }, 30000);

void app.whenReady().then(async () => {
  let client: StorageClient | undefined;
  const pool = new HashPool(entry, 2);
  try {
    const storeDirectory = path.join(root, 'metadata'); await mkdir(storeDirectory);
    const ownerId = '00000000-0000-4000-8000-000000000001';
    const requestId = '00000000-0000-4000-8000-000000000002';
    client = await StorageClient.open(entry, storeDirectory);
    const task = await client.accept(ownerId, requestId, 'download', 'a'.repeat(64));
    assert.equal((await client.accept(ownerId, requestId, 'download', 'a'.repeat(64))).taskId, task.taskId);
    await client.update(ownerId, task.taskId, 1, controlTask(task.execution, 'start').execution);
    await client.close();
    client = await StorageClient.open(entry, storeDirectory);
    assert.equal((await client.get(ownerId, task.taskId))?.execution.state, 'needsRecovery');
    await client.close(); client = undefined;
    const file = path.join(root, 'hash-input.bin'); const block = Buffer.alloc(1024 * 1024, 17);
    const sha1 = createHash('sha1'); const sha256 = createHash('sha256');
    const handle = await open(file, 'wx');
    try { for (let i = 0; i < 64; i++) { await handle.write(block); sha1.update(block); sha256.update(block); } }
    finally { await handle.close(); }
    let ticks = 0; let progressEvents = 0;
    const timer = setInterval(() => { ticks++; }, 5);
    const began = performance.now();
    let result;
    try { result = await pool.hash(file, { maximumBytes: 64 * 1024 * 1024, onProgress: () => { progressEvents++; } }); }
    finally { clearInterval(timer); }
    const hashElapsedMs = Math.round(performance.now() - began);
    assert.deepEqual(result, { size: 64 * 1024 * 1024, sha1: sha1.digest('hex'), sha256: sha256.digest('hex') });
    assert.ok(ticks > 0); assert.ok(progressEvents > 0);
    const controller = new AbortController();
    await assert.rejects(pool.hash(file, { maximumBytes: result.size, signal: controller.signal, onProgress: () => { controller.abort(); } }), { code: 'CANCELLED' });
    await rm(file); await pool.close();
    console.log('OUCL_WORKERS_RESULT:' + JSON.stringify({ status: 'PASS', electron: process.versions.electron, node: process.versions.node,
      builtWorkerUsed: true, storageAcceptanceIdempotent: true, interruptedTaskProtected: true, hashBytes: result.size,
      hashElapsedMs, hashMatched: true, parentEventLoopTicks: ticks,
      progressEvents, cancellationJoined: true, fileHandleReleased: true }));
    clearTimeout(deadline); app.exit(0);
  } catch (error) {
    await pool.close(); await client?.close().catch(() => {});
    console.log('OUCL_WORKERS_RESULT:' + JSON.stringify({ status: 'FAIL', code: error instanceof Error && 'code' in error ? error.code : 'RUNTIME_ASSERTION' }));
    clearTimeout(deadline); app.exit(1);
  }
}).catch(() => { clearTimeout(deadline); app.exit(1); });
