import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { HashPool } from '../src/services/workers/hash-pool.js';
import { parseHashJobRequest, parseReply } from '../src/services/workers/protocol.js';

const entry = new URL('../src/services/workers/entry.js', import.meta.url);
const result = (bytes: Buffer) => ({ size: bytes.length, sha1: createHash('sha1').update(bytes).digest('hex'), sha256: createHash('sha256').update(bytes).digest('hex') });
async function fixture(work: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'oucl-hash-session-'));
  try { await work(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test('sequential small-file hashes reuse one real worker and release each file before success', async () => fixture(async root => {
  const pool = new HashPool(entry, 2);
  try {
    for (let i = 0; i < 40; i++) {
      const bytes = Buffer.alloc(i * 131, i); const file = path.join(root, `${i}.bin`);
      await writeFile(file, bytes);
      assert.deepEqual(await pool.hash(file, { maximumBytes: bytes.length }), result(bytes));
      await rm(file); // Windows removal would fail if the persistent worker retained an open handle.
    }
    assert.equal(pool.spawnedWorkers, 1);
    const closed = pool.close(); assert.equal(pool.close(), closed); await closed;
    await assert.rejects(pool.hash(path.join(root, 'closed'), { maximumBytes: 0 }), { code: 'WORKER_FAILED' });
  } finally { await pool.close(); }
}));

test('cancelled active session exits before rejection and a queued hash uses a fresh worker', async () => fixture(async root => {
  const large = path.join(root, 'large.bin'); const small = path.join(root, 'small.bin');
  const bytes = Buffer.from('the replacement must hash this file');
  await writeFile(large, Buffer.alloc(32 * 1024 * 1024, 61)); await writeFile(small, bytes);
  const pool = new HashPool(entry, 1); const abort = new AbortController();
  try {
    const cancelled = assert.rejects(pool.hash(large, { maximumBytes: 32 * 1024 * 1024, signal: abort.signal, onProgress: () => { abort.abort(); } }), { code: 'CANCELLED' });
    const following = pool.hash(small, { maximumBytes: bytes.length });
    await cancelled; await rm(large);
    assert.deepEqual(await following, result(bytes)); assert.equal(pool.spawnedWorkers, 2);
  } finally { await pool.close(); }
}));

test('queue budget remains concurrency plus 32 waiting jobs and close joins all sessions', async () => fixture(async root => {
  const file = path.join(root, 'input.bin'); await writeFile(file, Buffer.alloc(1024 * 1024));
  const pool = new HashPool(entry, 1);
  const jobs = Array.from({ length: 33 }, () => pool.hash(file, { maximumBytes: 1024 * 1024 }));
  const settled = Promise.allSettled(jobs);
  await assert.rejects(pool.hash(file, { maximumBytes: 1024 * 1024 }), { code: 'QUEUE_FULL' });
  await pool.close();
  assert.ok((await settled).every(item => item.status === 'rejected' && (item.reason as { code: string }).code === 'CANCELLED'));
  assert.equal(pool.spawnedWorkers, 1); await rm(file);
}));

test('strict session schemas require correlated UUIDs and retain legacy single-file replies', () => {
  const request = { version: 1, kind: 'hash-job', jobId: randomUUID(), file: path.resolve('fixture.bin'), maximumBytes: 0 };
  assert.deepEqual(parseHashJobRequest(request), request);
  for (const changed of [{ version: 2 }, { kind: 'execute' }, { jobId: '../x' }, { file: 'relative.bin' }, { maximumBytes: Infinity }, { maximumBytes: -1 }, { script: 'arbitrary' }]) assert.throws(() => parseHashJobRequest({ ...request, ...changed }));
  const bytes = Buffer.from('legacy'); const digest = result(bytes);
  assert.deepEqual(parseReply({ version: 1, kind: 'hash-result', result: digest }), { version: 1, kind: 'hash-result', result: digest });
  assert.deepEqual(parseReply({ version: 1, kind: 'hash-progress', bytesDone: 0, bytesTotal: 1 }), { version: 1, kind: 'hash-progress', bytesDone: 0, bytesTotal: 1 });
  for (const input of [{ version: 1, kind: 'hash-ready', extra: true }, { version: 1, kind: 'hash-job-result', jobId: 'bad', result: digest },
    { version: 1, kind: 'hash-job-progress', jobId: request.jobId, bytesDone: 2, bytesTotal: 1 },
    { version: 1, kind: 'hash-job-failed', jobId: request.jobId, code: 'RAW_STACK' }]) assert.throws(() => parseReply(input));
});

test('well-formed stale replies from a previous job cannot complete or update the next job', async () => fixture(async root => {
  const fake = path.join(root, 'hash-fixture.mjs');
  // Test-only fixed worker emits old correlated messages before the next correct result.
  await writeFile(fake, `import { parentPort } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
let previous;
parentPort.on('message', async job => {
  if (previous) {
    parentPort.postMessage({version:1,kind:'hash-job-progress',jobId:previous.jobId,bytesDone:1,bytesTotal:1});
    parentPort.postMessage(previous);
  }
  const bytes = await readFile(job.file);
  const response = {version:1,kind:'hash-job-result',jobId:job.jobId,result:{size:bytes.length,sha1:createHash('sha1').update(bytes).digest('hex'),sha256:createHash('sha256').update(bytes).digest('hex')}};
  previous = response; parentPort.postMessage(response);
});
parentPort.postMessage({version:1,kind:'hash-ready'});
`);
  const files = path.join(root, 'files'); await mkdir(files);
  const a = path.join(files, 'a.bin'); const b = path.join(files, 'b.bin');
  const first = Buffer.from('first'); const second = Buffer.from('different second'); await writeFile(a, first); await writeFile(b, second);
  const pool = new HashPool(fake, 1); let progress = 0;
  try {
    assert.deepEqual(await pool.hash(a, { maximumBytes: first.length }), result(first));
    assert.deepEqual(await pool.hash(b, { maximumBytes: second.length, onProgress: () => { progress++; } }), result(second));
    assert.equal(progress, 0); assert.equal(pool.spawnedWorkers, 1);
  } finally { await pool.close(); }
}));
