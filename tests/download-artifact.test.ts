import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ArtifactTransfer } from '../src/services/download/artifact-transfer.js';
import { HttpTransfer } from '../src/services/download/http.js';
import type { DownloadSpec } from '../src/services/download/types.js';
import { sourceKey } from '../src/services/objects/provenance.js';
import { ObjectStore } from '../src/services/objects/store.js';
import { HashPool } from '../src/services/workers/hash-pool.js';
import { StorageClient } from '../src/services/workers/storage-client.js';

const payload = Buffer.alloc(32768, 31);
const spec: DownloadSpec = { url: 'https://piston-data.mojang.com/objects/fixture/client.jar',
  expected: { algorithm: 'sha1', digest: createHash('sha1').update(payload).digest('hex'), size: payload.length, provenanceId: 'fixture:client' },
  anchor: { kind: 'mojang-version', algorithm: 'sha1', digest: 'a'.repeat(40) } };
const key = sourceKey(spec.expected, spec.anchor);
const entry = new URL('../src/services/workers/entry.js', import.meta.url);
interface Fixture { metadata: string; objectRoot: string; client: StorageClient; objects: ObjectStore; pool: HashPool }
async function fixture(work: (f: Fixture) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'oucl-artifact-')); const metadata = path.join(root, 'metadata'); const objectRoot = path.join(root, 'store');
  await mkdir(metadata); await mkdir(objectRoot);
  const pool = new HashPool(entry); const client = await StorageClient.open(entry, metadata);
  const objects = await ObjectStore.open(objectRoot, client, pool); const f = { metadata, objectRoot, client, objects, pool };
  try { await work(f); } finally { await f.objects.close(); await f.client.close(); await pool.close(); await rm(root, { recursive: true, force: true }); }
}
const full = (bytes = payload): Response => new Response(bytes, { headers: { 'content-length': String(bytes.length), etag: '"fixture-v1"' } });

test('physical transfer persists before writing and commits only verified bytes, then reuses the object', async () => fixture(async f => {
  let requests = 0;
  const http = new HttpTransfer(async () => {
    requests++; const accepted = await f.client.getTransfer(key);
    assert.equal(accepted?.bytesDone, 0); assert.equal(accepted?.state, 'partial'); return full();
  });
  const transfer = new ArtifactTransfer(http, f.client, f.objects);
  const object = await transfer.run(spec);
  assert.equal(object.digest, createHash('sha256').update(payload).digest('hex'));
  assert.equal((await f.client.getTransfer(key))?.state, 'committed');
  assert.deepEqual(await transfer.run(spec), object); assert.equal(requests, 1);
}));

test('interrupted HTTP bytes survive a normal worker/store restart and resume with validators', async () => fixture(async f => {
  const half = payload.length / 2; let first = true;
  const fetcher: typeof fetch = async (_url, options) => {
    const headers = new Headers(options?.headers);
    if (first) {
      first = false; let sent = false;
      return new Response(new ReadableStream<Uint8Array>({ async pull(controller) {
        if (!sent) { sent = true; controller.enqueue(payload.subarray(0, half)); }
        else { await new Promise(resolve => setTimeout(resolve, 60)); controller.error(new Error('simulated connection loss')); }
      } }), { headers: { 'content-length': String(payload.length), etag: '"fixture-v1"' } });
    }
    assert.equal(headers.get('range'), `bytes=${half}-`); assert.equal(headers.get('if-range'), '"fixture-v1"');
    return new Response(payload.subarray(half), { status: 206, headers: { 'content-length': String(half), 'content-range': `bytes ${half}-${payload.length - 1}/${payload.length}`, etag: '"fixture-v1"' } });
  };
  await assert.rejects(new ArtifactTransfer(new HttpTransfer(fetcher), f.client, f.objects).run(spec));
  assert.equal((await f.client.getTransfer(key))?.bytesDone, half);
  await f.objects.close(); await f.client.close();
  f.client = await StorageClient.open(entry, f.metadata); f.objects = await ObjectStore.open(f.objectRoot, f.client, f.pool);
  const object = await new ArtifactTransfer(new HttpTransfer(fetcher), f.client, f.objects).run(spec);
  assert.equal(object.digest, createHash('sha256').update(payload).digest('hex'));
}));

test('wrong digest never commits and a retry restarts rather than trusting the bad prefix', async () => fixture(async f => {
  let requests = 0;
  const transfer = new ArtifactTransfer(new HttpTransfer(async (_url, options) => {
    assert.equal(new Headers(options?.headers).get('range'), null); requests++;
    return full(requests === 1 ? Buffer.alloc(payload.length, 99) : payload);
  }), f.client, f.objects);
  await assert.rejects(transfer.run(spec), { code: 'HASH_MISMATCH' });
  assert.equal(await f.objects.lookup(spec.expected, spec.anchor), undefined);
  assert.equal((await f.client.getTransfer(key))?.bytesDone, 0);
  await transfer.run(spec); assert.equal(requests, 2);
}));

test('object commit with a lost final journal acknowledgement is reconciled without a second download', async () => fixture(async f => {
  let requests = 0;
  const http = new HttpTransfer(async () => { requests++; return full(); });
  const uncertain = new ArtifactTransfer(http, {
    getTransfer: value => f.client.getTransfer(value),
    async saveTransfer(revision, next) { if (next.state === 'committed') throw new Error('simulated final acknowledgement loss'); await f.client.saveTransfer(revision, next); },
  }, f.objects);
  await assert.rejects(uncertain.run(spec), { code: 'TRANSFER_IO' });
  assert.equal((await f.client.getTransfer(key))?.state, 'complete');
  await new ArtifactTransfer(http, f.client, f.objects).run(spec);
  assert.equal((await f.client.getTransfer(key))?.state, 'committed'); assert.equal(requests, 1);
}));

test('one physical engine rejects a concurrent same-identity writer rather than racing its staging file', async () => fixture(async f => {
  let release: () => void = () => {}; const gate = new Promise<void>(resolve => { release = resolve; });
  const transfer = new ArtifactTransfer(new HttpTransfer(async () => { await gate; return full(); }), f.client, f.objects);
  const first = transfer.run(spec); await assert.rejects(transfer.run(spec), { code: 'TRANSFER_BUSY' }); release(); await first;
  const abort = new AbortController(); abort.abort();
  await assert.rejects(transfer.run(spec, { signal: abort.signal }), { code: 'CANCELLED' });
}));

test('lost acknowledgement after a successful final commit does not rewrite terminal state', async () => fixture(async f => {
  let requests = 0;
  const http = new HttpTransfer(async () => { requests++; return full(); });
  const uncertain = new ArtifactTransfer(http, {
    getTransfer: value => f.client.getTransfer(value),
    async saveTransfer(revision, next) { await f.client.saveTransfer(revision, next); if (next.state === 'committed') throw new Error('simulated lost acknowledgement'); },
  }, f.objects);
  await assert.rejects(uncertain.run(spec), { code: 'TRANSFER_IO' });
  assert.equal((await f.client.getTransfer(key))?.state, 'committed');
  await new ArtifactTransfer(http, f.client, f.objects).run(spec); assert.equal(requests, 1);
}));

test('cancellation during a verified-cache lookup wins before returning the object', async () => fixture(async f => {
  const http = new HttpTransfer(async () => full());
  await new ArtifactTransfer(http, f.client, f.objects).run(spec);
  const abort = new AbortController(); const lookup = f.objects.lookup.bind(f.objects);
  f.objects.lookup = async (expected, anchor) => { const object = await lookup(expected, anchor); abort.abort(); return object; };
  await assert.rejects(new ArtifactTransfer(http, f.client, f.objects).run(spec, { signal: abort.signal }), { code: 'CANCELLED' });
}));

test('verified cache cannot hide a contradictory authoritative committed object identity', async () => fixture(async f => {
  const http = new HttpTransfer(async () => full());
  await new ArtifactTransfer(http, f.client, f.objects).run(spec);
  const transfer = new ArtifactTransfer(http, {
    async getTransfer(value) { const record = await f.client.getTransfer(value); return record && { ...record, objectDigest: '0'.repeat(64) }; },
    saveTransfer: (revision, record) => f.client.saveTransfer(revision, record),
  }, f.objects);
  await assert.rejects(transfer.run(spec), { code: 'NEEDS_RECOVERY' });
}));
