import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { ObjectStore } from '../src/services/objects/store.js';
import { sourceKey } from '../src/services/objects/provenance.js';
import type { TrustAnchor } from '../src/services/objects/provenance.js';
import type { ExpectedArtifact } from '../src/core/download/integrity.js';
import { HashPool } from '../src/services/workers/hash-pool.js';
import { StorageClient } from '../src/services/workers/storage-client.js';
import { DatabaseSync } from 'node:sqlite';

const entry = new URL('../src/services/workers/entry.js', import.meta.url);
const bytes = Buffer.from('trusted fixture bytes');
const expected: ExpectedArtifact = { algorithm: 'sha1', digest: createHash('sha1').update(bytes).digest('hex'), size: bytes.length, provenanceId: 'fixture:library-a' };
const anchor: TrustAnchor = { kind: 'mojang-version', algorithm: 'sha1', digest: 'a'.repeat(40) };
const objectDigest = createHash('sha256').update(bytes).digest('hex');
interface Fixture { root: string; store: ObjectStore; client: StorageClient; pool: HashPool; metadata: string; storeRoot: string }
async function fixture(work: (context: Fixture) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'oucl-objects-'));
  const metadata = path.join(root, 'metadata'); const storeRoot = path.join(root, 'store');
  await mkdir(metadata); await mkdir(storeRoot);
  const pool = new HashPool(entry); const client = await StorageClient.open(entry, metadata);
  const store = await ObjectStore.open(storeRoot, client, pool);
  const context = { root, metadata, storeRoot, pool, client, store };
  try { await work(context); }
  finally { await context.store.close(); await context.client.close(); await pool.close(); await rm(root, { recursive: true, force: true }); }
}
const objectFile = (root: string): string => path.join(root, 'objects', 'sha256', objectDigest.slice(0, 2), objectDigest);
async function stage(store: ObjectStore, data = bytes): Promise<string> {
  const staging = await store.createStaging(); await writeFile(staging.file, data); return staging.id;
}

test('real object commits deduplicate bytes but preserve independent source evidence', async () => fixture(async context => {
  const { store, storeRoot } = context;
  const alternate = { ...expected, provenanceId: 'fixture:library-b' };
  const first = await stage(store); const second = await stage(store);
  const results = await Promise.all([store.commit(first, expected, anchor), store.commit(second, alternate, anchor)]);
  assert.equal(results[0]!.digest, results[1]!.digest); assert.notEqual(results[0]!.sourceKey, results[1]!.sourceKey);
  assert.deepEqual(await readFile(objectFile(storeRoot)), bytes);
  assert.equal((await readdir(path.dirname(objectFile(storeRoot)))).filter(name => /^[a-f0-9]{64}$/.test(name)).length, 1);
  assert.equal((await readdir(objectFile(storeRoot) + '.sources')).length, 2);
  assert.equal((await store.lookup(expected, anchor))?.digest, objectDigest);
  assert.equal(await store.lookup({ ...expected, provenanceId: 'unproven' }, anchor), undefined);
  await assert.rejects(ObjectStore.open(storeRoot, context.client, context.pool), { code: 'STORE_BUSY' });
}));

test('same-sized wrong bytes never enter objects and malformed artifact facts reject early', async () => fixture(async ({ store, storeRoot }) => {
  const id = await stage(store, Buffer.alloc(bytes.length, 0));
  await assert.rejects(store.commit(id, expected, anchor), { code: 'HASH_MISMATCH' });
  assert.equal((await readdir(path.join(storeRoot, 'objects', 'sha256'))).length, 0);
  await store.discardStaging(id);
  await assert.rejects(store.commit('../outside', expected, anchor), { code: 'INVALID_ARTIFACT' });
  await assert.rejects(store.lookup({ ...expected, size: -1 }, anchor), { code: 'INVALID_ARTIFACT' });
  await assert.rejects(store.lookup(expected, { ...anchor, digest: 'bad' }), { code: 'INVALID_ARTIFACT' });
}));

test('missing disposable SQLite index is rebuilt from proofs without losing durable tasks', async () => fixture(async context => {
  const ownerId = '00000000-0000-4000-8000-000000000001'; const requestId = '00000000-0000-4000-8000-000000000002';
  const task = await context.client.accept(ownerId, requestId, 'download', 'a'.repeat(64));
  await context.store.commit(await stage(context.store), expected, anchor);
  await context.store.close(); await context.client.close();
  await rm(path.join(context.metadata, 'objects-index.sqlite'));
  context.client = await StorageClient.open(entry, context.metadata);
  context.store = await ObjectStore.open(context.storeRoot, context.client, context.pool);
  assert.equal(await context.store.lookup(expected, anchor), undefined);
  assert.equal((await context.client.get(ownerId, task.taskId))?.taskId, task.taskId);
  assert.equal(await context.store.rebuildIndex(), 1);
  assert.equal((await context.store.lookup(expected, anchor))?.digest, objectDigest);
  assert.equal((await context.client.accept(ownerId, requestId, 'download', 'a'.repeat(64))).taskId, task.taskId);
}));

test('interrupted append-only commits preserve orphan bytes and recover only proven sources', async () => {
  for (const point of ['object-committed', 'proof-committed'] as const) await fixture(async ({ store, storeRoot }) => {
    await assert.rejects(store.commit(await stage(store), expected, anchor, async checkpoint => {
      if (checkpoint === point) throw new Error('simulated interruption');
    }), { code: 'OBJECT_IO' });
    assert.deepEqual(await readFile(objectFile(storeRoot)), bytes);
    assert.equal(await store.rebuildIndex(), point === 'proof-committed' ? 1 : 0);
    assert.equal((await store.lookup(expected, anchor)) !== undefined, point === 'proof-committed');
    await store.commit(await stage(store), expected, anchor);
    assert.equal((await store.lookup(expected, anchor))?.digest, objectDigest);
  });
});

test('corrupt existing object is never overwritten by a new commit or reused through an index', async () => fixture(async ({ store, storeRoot }) => {
  await store.commit(await stage(store), expected, anchor);
  const target = objectFile(storeRoot); await chmod(target, 0o666); await writeFile(target, Buffer.alloc(bytes.length, 1));
  await assert.rejects(store.lookup(expected, anchor), { code: 'HASH_MISMATCH' });
  const fresh = await stage(store);
  await assert.rejects(store.commit(fresh, expected, anchor), { code: 'HASH_MISMATCH' });
  assert.deepEqual(await readFile(target), Buffer.alloc(bytes.length, 1));
  await store.discardStaging(fresh);
}));

test('broken provenance cannot acquire trust from a valid object or index hint', async () => fixture(async ({ store, storeRoot }) => {
  await store.commit(await stage(store), expected, anchor);
  const proof = path.join(objectFile(storeRoot) + '.sources', `${sourceKey(expected, anchor)}.json`);
  await writeFile(proof, '{"schemaVersion":2}');
  await assert.rejects(store.lookup(expected, anchor), { code: 'NEEDS_RECOVERY' });
  await assert.rejects(store.rebuildIndex(), { code: 'NEEDS_RECOVERY' });
  assert.deepEqual(await readFile(objectFile(storeRoot)), bytes);
}));

test('unknown cache schema blocks object search while durable tasks stay readable', async () => fixture(async context => {
  const ownerId = '00000000-0000-4000-8000-000000000001'; const requestId = '00000000-0000-4000-8000-000000000002';
  const task = await context.client.accept(ownerId, requestId, 'download', 'a'.repeat(64));
  await context.store.commit(await stage(context.store), expected, anchor);
  await context.store.close(); await context.client.close();
  const db = new DatabaseSync(path.join(context.metadata, 'objects-index.sqlite')); db.exec('PRAGMA user_version=2'); db.close();
  context.client = await StorageClient.open(entry, context.metadata);
  context.store = await ObjectStore.open(context.storeRoot, context.client, context.pool);
  await assert.rejects(context.store.lookup(expected, anchor), { code: 'NEEDS_RECOVERY' });
  assert.equal((await context.client.get(ownerId, task.taskId))?.taskId, task.taskId);
  assert.deepEqual(await readFile(objectFile(context.storeRoot)), bytes);
}));
