import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { StorageClient } from '../src/services/workers/storage-client.js';
import { HashPool } from '../src/services/workers/hash-pool.js';
import { parseReply, parseStorageRequest } from '../src/services/workers/protocol.js';
import { controlTask } from '../src/core/task/machine.js';

const entry = new URL('../src/services/workers/entry.js', import.meta.url);
const fakeEntry = new URL('./fixtures/worker.js', import.meta.url);
const ownerId = '00000000-0000-4000-8000-000000000001';
const requestId = '00000000-0000-4000-8000-000000000002';
async function fixture(work: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'oucl-workers-'));
  try { await work(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test('private worker messages reject extra keys, scripts, paths, unknown errors and versions', () => {
  const valid = { version: 1, id: requestId, command: { kind: 'get', ownerId, taskId: requestId } };
  assert.deepEqual(parseStorageRequest(valid), valid);
  assert.throws(() => parseStorageRequest({ ...valid, script: 'execute' }));
  assert.throws(() => parseStorageRequest({ ...valid, version: 2 }));
  assert.throws(() => parseStorageRequest({ ...valid, command: { kind: 'get', ownerId, taskId: '../../file' } }));
  assert.throws(() => parseStorageRequest({ ...valid, command: { kind: 'sql', sql: 'DELETE' } }));
  assert.throws(() => parseStorageRequest({ ...valid, command: { kind: 'close', directory: 'arbitrary' } }));
  assert.throws(() => parseStorageRequest({ ...valid, command: { kind: 'update', ownerId, taskId: requestId, expectedRevision: 1, execution: {} } }));
  assert.throws(() => parseReply({ version: 1, kind: 'response', id: requestId, ok: false, code: 'PRIVATE_ERROR' }));
  assert.throws(() => parseReply({ version: 1, kind: 'startup-failed', code: 'WORKER_FAILED', stack: 'private' }));
  assert.throws(() => parseReply({ version: 1, kind: 'hash-progress', bytesDone: 2, bytesTotal: 1 }));
  assert.throws(() => parseReply({ version: 1, kind: 'hash-result', result: { size: 1, sha1: '', sha256: '' } }));
});

test('real storage worker persists idempotent acceptance and protects interrupted task state', async () => fixture(async root => {
  let client = await StorageClient.open(entry, root);
  try {
    const accepted = await client.accept(ownerId, requestId, 'download', 'a'.repeat(64));
    assert.equal((await client.accept(ownerId, requestId, 'download', 'a'.repeat(64))).taskId, accepted.taskId);
    const running = controlTask(accepted.execution, 'start').execution;
    await client.update(ownerId, accepted.taskId, 1, running);
    await assert.rejects(client.update(ownerId, accepted.taskId, 1, running), { code: 'REVISION_CONFLICT' });
    await client.close();
    client = await StorageClient.open(entry, root);
    assert.equal((await client.get(ownerId, accepted.taskId))?.execution.state, 'needsRecovery');
  } finally { await client.close(); }
}));

test('storage request queue is bounded and reserves a draining close slot', async () => fixture(async root => {
  const client = await StorageClient.open(entry, root);
  const reads = Array.from({ length: 32 }, () => client.get(ownerId, requestId));
  await assert.rejects(client.get(ownerId, requestId), { code: 'QUEUE_FULL' });
  await Promise.all([Promise.all(reads), client.close()]);
}));

test('storage caller timeout retains its queue slot and does not pretend mutation was cancelled', async () => {
  const client = await StorageClient.open(fakeEntry, 'delay', 1000);
  try {
    await assert.rejects(client.accept(ownerId, requestId, 'download', 'a'.repeat(64)), { code: 'TIMEOUT' });
    const reads = Array.from({ length: 31 }, () => client.get(ownerId, requestId));
    await assert.rejects(client.get(ownerId, requestId), { code: 'QUEUE_FULL' });
    await Promise.all(reads);
    assert.equal(await client.get(ownerId, requestId), undefined);
  } finally { await client.close(); }
});

test('worker crash becomes a fixed redacted failure and close waits for exit', async () => {
  const client = await StorageClient.open(fakeEntry, 'crash');
  await assert.rejects(client.get(ownerId, requestId), error => error instanceof Error && error.message === 'WORKER_FAILED');
  await client.close();
});

test('real streamed hashes match known bytes and the parent event loop stays responsive', async () => fixture(async root => {
  const file = path.join(root, 'large.bin'); const block = Buffer.alloc(1024 * 1024, 123);
  const handle = await open(file, 'wx');
  const sha1 = createHash('sha1'); const sha256 = createHash('sha256');
  try { for (let i = 0; i < 64; i++) { await handle.write(block); sha1.update(block); sha256.update(block); } }
  finally { await handle.close(); }
  const pool = new HashPool(entry, 1);
  let ticks = 0; let progress = 0;
  const timer = setInterval(() => { ticks++; }, 5);
  try {
    const result = await pool.hash(file, { maximumBytes: 64 * 1024 * 1024, onProgress: (done, total) => { assert.ok(done >= progress); assert.ok(done <= total); progress = done; } });
    assert.deepEqual(result, { size: 64 * 1024 * 1024, sha1: sha1.digest('hex'), sha256: sha256.digest('hex') });
    assert.ok(ticks > 0); assert.ok(progress > 0);
    await assert.rejects(pool.hash(file, { maximumBytes: 1 }), { code: 'FILE_TOO_LARGE' });
  } finally { clearInterval(timer); await pool.close(); }
}));

test('hash cancellation waits for worker exit and leaves input bytes untouched', async () => fixture(async root => {
  const file = path.join(root, 'input.bin'); await writeFile(file, Buffer.alloc(8 * 1024 * 1024));
  const pool = new HashPool(entry, 1); const controller = new AbortController();
  try {
    await assert.rejects(pool.hash(file, { maximumBytes: 8 * 1024 * 1024, signal: controller.signal,
      onProgress: () => { controller.abort(); } }), { code: 'CANCELLED' });
    // Removing the input after cancellation proves no worker still holds its Windows file handle.
    await rm(file);
  } finally { await pool.close(); }
}));

test('hash queue has a fixed budget and queued cancellation starts no worker', async () => fixture(async root => {
  const file = path.join(root, 'input.bin'); await writeFile(file, Buffer.alloc(1024 * 1024));
  const pool = new HashPool(entry, 1);
  const controllers = Array.from({ length: 33 }, () => new AbortController());
  const hashes = controllers.map(controller => pool.hash(file, { maximumBytes: 1024 * 1024, signal: controller.signal }));
  const outcomes = Promise.allSettled(hashes);
  await assert.rejects(pool.hash(file, { maximumBytes: 1024 * 1024 }), { code: 'QUEUE_FULL' });
  for (const controller of controllers) controller.abort();
  await pool.close();
  const results = await outcomes;
  assert.ok(results.every(result => result.status === 'rejected' && (result.reason as { code: string }).code === 'CANCELLED'));
  await assert.rejects(pool.hash(file, { maximumBytes: 1 }), { code: 'WORKER_FAILED' });
}));

test('failed worker startup preserves corrupt metadata rather than replacing it', async () => fixture(async root => {
  await writeFile(path.join(root, 'unknown.json'), 'sentinel');
  await assert.rejects(StorageClient.open(entry, root), { code: 'NEEDS_RECOVERY' });
  await assert.rejects(StorageClient.open(new URL('./missing-worker.js', import.meta.url), root), { code: 'WORKER_FAILED' });
  assert.throws(() => new HashPool(entry, 0), { code: 'INVALID_MESSAGE' });
}));
