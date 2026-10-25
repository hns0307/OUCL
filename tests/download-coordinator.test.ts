import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DownloadCoordinator } from '../src/services/download/coordinator.js';
import { DownloadError } from '../src/services/download/types.js';
import type { DownloadSpec, TransferOptions } from '../src/services/download/types.js';
import { sourceKey } from '../src/services/objects/provenance.js';
import type { ObjectRef } from '../src/services/objects/store.js';
import { ObjectStore } from '../src/services/objects/store.js';
import { ArtifactTransfer } from '../src/services/download/artifact-transfer.js';
import { HttpTransfer } from '../src/services/download/http.js';
import { HashPool } from '../src/services/workers/hash-pool.js';
import { StorageClient } from '../src/services/workers/storage-client.js';

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const spec: DownloadSpec = { url: 'https://piston-data.mojang.com/objects/fixture/a.jar',
  expected: { algorithm: 'sha1', digest: 'a'.repeat(40), size: 8, provenanceId: 'fixture:a' },
  anchor: { kind: 'mojang-version', algorithm: 'sha1', digest: 'b'.repeat(40) } };
const differentProof: DownloadSpec = { ...spec, expected: { ...spec.expected, provenanceId: 'fixture:b' }, anchor: { ...spec.anchor, digest: 'c'.repeat(40) } };
function ref(value: DownloadSpec): ObjectRef { return { digest: 'd'.repeat(64), size: value.expected.size, sourceKey: sourceKey(value.expected, value.anchor) }; }
async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!condition()) { if (Date.now() > deadline) throw new Error('TEST_CONDITION_TIMEOUT'); await new Promise<void>(resolve => setImmediate(resolve)); }
}
interface Call { spec: DownloadSpec; options: TransferOptions; done: () => void; fail: (error: Error) => void; abort: () => void }
class ControlledTransfer {
  readonly calls: Call[] = [];
  autoAbort = true;
  run(value: DownloadSpec, options: TransferOptions = {}): Promise<ObjectRef> {
    return new Promise((resolve, reject) => {
      const finish = (): void => { options.signal?.removeEventListener('abort', abort); resolve(ref(value)); };
      const abort = (): void => { if (this.autoAbort) { options.signal?.removeEventListener('abort', abort); reject(new DownloadError('CANCELLED')); } };
      options.signal?.addEventListener('abort', abort, { once: true });
      this.calls.push({ spec: value, options, done: finish, fail: error => { options.signal?.removeEventListener('abort', abort); reject(error); }, abort: () => { reject(new DownloadError('CANCELLED')); } });
    });
  }
}
const attestor = { async adopt(digest: string, expected: DownloadSpec['expected'], anchor: DownloadSpec['anchor']): Promise<ObjectRef> {
  return { digest, size: expected.size, sourceKey: sourceKey(expected, anchor) };
} };

test('one cancelled installer cannot interrupt another, including independent source evidence', async () => {
  const physical = new ControlledTransfer(); const coordinator = new DownloadCoordinator(physical, attestor, 1);
  try {
    const a = coordinator.request(spec, { consumerId: id(1) }); const b = coordinator.request(differentProof, { consumerId: id(2) });
    assert.equal(physical.calls.length, 1);
    await a.cancel(); await assert.rejects(a.result, { code: 'CANCELLED' });
    assert.equal(physical.calls[0]!.options.signal?.aborted, false);
    physical.calls[0]!.done(); assert.equal((await b.result).sourceKey, sourceKey(differentProof.expected, differentProof.anchor));
    await assert.rejects(b.cancel(), { code: 'CANCEL_TOO_LATE' });
  } finally { await coordinator.close(); }
});

test('paused consumers hold completion and revalidate their object when resuming', async () => {
  const physical = new ControlledTransfer(); let adoptions = 0;
  const coordinator = new DownloadCoordinator(physical, { async adopt(...args) { adoptions++; return attestor.adopt(...args); } }, 1);
  try {
    const a = coordinator.request(spec, { consumerId: id(1) }); const b = coordinator.request(spec, { consumerId: id(2) });
    let settled = false; void a.result.then(() => { settled = true; }, () => { settled = true; });
    await a.pause(); physical.calls[0]!.done(); await b.result;
    assert.equal(a.state(), 'paused'); assert.equal(settled, false); assert.equal(physical.calls[0]!.options.signal?.aborted, false);
    await a.resume(); await a.result; assert.equal(adoptions, 1); assert.equal(physical.calls.length, 1);
  } finally { await coordinator.close(); }
});

test('all-paused transport joins before resume starts a new attempt', async () => {
  const physical = new ControlledTransfer(); physical.autoAbort = false;
  const coordinator = new DownloadCoordinator(physical, attestor, 1);
  try {
    const a = coordinator.request(spec, { consumerId: id(1) }); const b = coordinator.request(spec, { consumerId: id(2) });
    await a.pause(); const paused = b.pause();
    assert.equal(b.state(), 'pausing'); assert.equal(physical.calls[0]!.options.signal?.aborted, true);
    physical.calls[0]!.abort(); await paused;
    assert.equal(b.state(), 'paused'); await a.resume(); assert.equal(physical.calls.length, 2);
    physical.calls[1]!.done(); await a.result; await b.resume(); await b.result;
  } finally { physical.autoAbort = true; await coordinator.close(); }
});

test('last cancellation waits for physical cleanup and a new consumer waits for that old attempt', async () => {
  const physical = new ControlledTransfer(); physical.autoAbort = false;
  const coordinator = new DownloadCoordinator(physical, attestor, 1);
  try {
    const a = coordinator.request(spec, { consumerId: id(1) }); const cancelling = a.cancel();
    assert.equal(a.state(), 'cancelling'); const b = coordinator.request(spec, { consumerId: id(2) }); assert.equal(physical.calls.length, 1);
    physical.calls[0]!.abort(); await cancelling; await assert.rejects(a.result, { code: 'CANCELLED' });
    await until(() => physical.calls.length === 2); physical.calls[1]!.done(); await b.result;
  } finally { physical.autoAbort = true; await coordinator.close(); }
});

test('bounded admission and per-consumer callback failures do not kill other demand', async () => {
  const physical = new ControlledTransfer(); const coordinator = new DownloadCoordinator(physical, attestor, 1, 1, 2);
  try {
    const a = coordinator.request(spec, { consumerId: id(1), onProgress: () => { throw new Error('private callback'); } });
    const b = coordinator.request(spec, { consumerId: id(2) });
    assert.throws(() => coordinator.request(spec, { consumerId: id(3) }), { code: 'QUEUE_FULL' });
    physical.calls[0]!.options.onProgress?.(4, 8); await assert.rejects(a.result, { code: 'CALLBACK_FAILED' });
    assert.equal(physical.calls[0]!.options.signal?.aborted, false); physical.calls[0]!.done(); await b.result;
    assert.throws(() => coordinator.request(spec, { consumerId: '../x' }), { code: 'INVALID_CONSUMER' });
  } finally { await coordinator.close(); }
});

test('global concurrency stays bounded and failure evidence is redacted for every consumer', async () => {
  const physical = new ControlledTransfer(); const coordinator = new DownloadCoordinator(physical, attestor, 1);
  try {
    const a = coordinator.request(spec, { consumerId: id(1) });
    const other = { ...spec, expected: { ...spec.expected, digest: 'e'.repeat(40) } };
    const b = coordinator.request(other, { consumerId: id(2) }); assert.equal(physical.calls.length, 1);
    physical.calls[0]!.fail(new Error('private path and stack'));
    await assert.rejects(a.result, error => error instanceof Error && error.message === 'TRANSFER_IO');
    await until(() => physical.calls.length === 2); physical.calls[1]!.done(); await b.result;
  } finally { await coordinator.close(); }
});

test('physical cleanup failure takes precedence over a cancellation request', async () => {
  const physical = new ControlledTransfer(); physical.autoAbort = false;
  const coordinator = new DownloadCoordinator(physical, attestor, 1);
  try {
    const a = coordinator.request(spec, { consumerId: id(1) });
    const cancelled = assert.rejects(a.cancel(), { code: 'NEEDS_RECOVERY' });
    physical.calls[0]!.fail(new DownloadError('NEEDS_RECOVERY'));
    await cancelled; await assert.rejects(a.result, { code: 'NEEDS_RECOVERY' }); assert.equal(a.state(), 'failed');
  } finally { await coordinator.close(); }
});

test('close joins failed source-proof work and reports its failure rather than fake cancellation', async () => {
  const physical = new ControlledTransfer(); let fail: (error: Error) => void = () => {}; let begun = false;
  const proof = new Promise<ObjectRef>((_resolve, reject) => { fail = reject; });
  const coordinator = new DownloadCoordinator(physical, { adopt() { begun = true; return proof; } });
  const a = coordinator.request(spec, { consumerId: id(1) }); const b = coordinator.request(spec, { consumerId: id(2) });
  await a.pause(); physical.calls[0]!.done(); await b.result; await a.resume(); await until(() => begun);
  const closing = assert.rejects(coordinator.close(), { code: 'NEEDS_RECOVERY' });
  fail(new DownloadError('NEEDS_RECOVERY')); await closing; await assert.rejects(a.result, { code: 'NEEDS_RECOVERY' });
});

test('close joins in-flight source-proof writes and never delivers to a cancelled consumer', async () => {
  const physical = new ControlledTransfer(); let release: (value: ObjectRef) => void = () => {};
  const proof = new Promise<ObjectRef>(resolve => { release = resolve; }); let begun = false;
  const coordinator = new DownloadCoordinator(physical, { adopt() { begun = true; return proof; } });
  const a = coordinator.request(differentProof, { consumerId: id(1) });
  const b = coordinator.request(differentProof, { consumerId: id(2) });
  // The physical origin is this spec; pause/resume forces an independent on-disk revalidation.
  await a.pause(); physical.calls[0]!.done(); await b.result;
  await a.resume(); await until(() => begun);
  let closed = false; const closing = coordinator.close().then(() => { closed = true; });
  await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(closed, false);
  release(ref(differentProof)); await closing; await assert.rejects(a.result, { code: 'CANCELLED' });
});

test('real HTTP/object pipeline shares one transfer and writes both independently verified source proofs', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'oucl-coordinator-')); const metadata = path.join(root, 'metadata'); const objectRoot = path.join(root, 'store');
  await mkdir(metadata); await mkdir(objectRoot); const entry = new URL('../src/services/workers/entry.js', import.meta.url);
  const pool = new HashPool(entry); const client = await StorageClient.open(entry, metadata); const objects = await ObjectStore.open(objectRoot, client, pool);
  const payload = Buffer.from('shared installer payload'); let requests = 0; let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const actual = { ...spec, expected: { ...spec.expected, digest: createHash('sha1').update(payload).digest('hex'), size: payload.length } };
  const alternative = { ...actual, anchor: differentProof.anchor, expected: { ...actual.expected, provenanceId: 'fixture:second' } };
  const physical = new ArtifactTransfer(new HttpTransfer(async () => { requests++; await gate; return new Response(payload, { headers: { 'content-length': String(payload.length) } }); }), client, objects);
  const coordinator = new DownloadCoordinator(physical, objects);
  try {
    const a = coordinator.request(actual, { consumerId: id(1) }); const b = coordinator.request(alternative, { consumerId: id(2) });
    await until(() => requests === 1); release(); const [one, two] = await Promise.all([a.result, b.result]);
    assert.equal(requests, 1); assert.equal(one.digest, two.digest); assert.notEqual(one.sourceKey, two.sourceKey);
    assert.equal((await objects.lookup(alternative.expected, alternative.anchor))?.digest, one.digest);
  } finally { await coordinator.close(); await objects.close(); await client.close(); await pool.close(); await rm(root, { recursive: true, force: true }); }
});
