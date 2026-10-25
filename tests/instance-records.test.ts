import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { instanceRecordId, parseInstanceIndex, parseInstanceRecord, parseInstanceSummary } from '../src/services/storage/instance-records.js';
import type { InstanceMetadata, InstanceRecord, InstanceSummary } from '../src/services/storage/instance-records.js';
import { StorageClient } from '../src/services/workers/storage-client.js';
import { RecordStore } from '../src/services/storage/records.js';
import { parseReply, parseStorageRequest } from '../src/services/workers/protocol.js';

const id = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const worker = new URL('../src/services/workers/entry.js', import.meta.url);
const sha1 = (body: string): string => createHash('sha1').update(body).digest('hex');
function summary(revision = 1): InstanceSummary {
  return { instanceId: id(1), rootId: id(2), taskId: id(3), displayName: '社团原版', mcVersionId: '1.20.1', isolation: 'on', state: 'installing', revision };
}
function metadata(): InstanceMetadata {
  const assetIndexBody = '{"objects":{}}\n';
  const body = JSON.stringify({ id: '1.20.1', mainClass: 'net.minecraft.client.main.Main', libraries: [],
    downloads: { client: { url: 'https://piston-data.mojang.com/objects/fixture/client.jar', sha1: 'a'.repeat(40), size: 8 } },
    assetIndex: { id: '5', url: 'https://piston-meta.mojang.com/v1/packages/fixture/5.json', sha1: sha1(assetIndexBody), size: Buffer.byteLength(assetIndexBody) } }) + '\n';
  return { versionDocuments: { '1.20.1': body }, metadataSha1ByVersion: { '1.20.1': sha1(body) }, assetIndexBody };
}
function loaderInstallMetadata(): InstanceMetadata {
  const base = metadata(); const profile = JSON.stringify({ id: 'fabric-loader-0.20.1-1.20.1', inheritsFrom: '1.20.1',
    mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient', arguments: { game: [], jvm: [] },
    libraries: [{ name: 'net.fabricmc:fabric-loader:0.20.1', url: 'https://maven.fabricmc.net/' }] });
  const digest = 'd'.repeat(40); const profileSha256 = createHash('sha256').update(profile).digest('hex');
  return { ...base, environment: { os: 'windows', arch: 'x64', osVersion: '10.0', features: {} }, loader: {
    kind: 'fabric', version: '0.20.1', profileBody: profile,
    profileSourceUrl: 'https://meta.fabricmc.net/v2/versions/loader/1.20.1/0.20.1/profile/json', profileSha256,
    libraries: [{ path: 'net/fabricmc/fabric-loader/0.20.1/fabric-loader-0.20.1.jar', spec: {
      url: 'https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.20.1/fabric-loader-0.20.1.jar',
      expected: { algorithm: 'sha1', digest, size: 32, provenanceId: `loader:fabric:${digest}` },
      anchor: { kind: 'loader-maven', algorithm: 'sha256', digest: 'e'.repeat(64) }
    } }]
  } };
}
function ready(revision = 1): InstanceRecord {
  const artifactId = `sha1-${'a'.repeat(40)}`;
  return { formatVersion: 2, loader: { kind: 'vanilla' }, summary: { ...summary(revision), state: 'ready' }, phase: 'ready', metadata: metadata(),
    objects: { [artifactId]: { digest: 'b'.repeat(64), size: 8, sourceKey: 'c'.repeat(64) } },
    receipts: [{ area: 'version', path: 'client.jar', artifactId, mode: 'copy' }] };
}
async function fixture(work: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'oucl-instances-'));
  try { await work(root); }
  finally { assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir())); await rm(root, { recursive: true, force: true }); }
}

test('instance summaries and indexes have exact bounded fields, canonical IDs and independent revisions', () => {
  assert.deepEqual(parseInstanceSummary(summary()), summary());
  assert.equal(parseInstanceSummary({ ...summary(), instanceId: id(255).toUpperCase() }).instanceId, id(255));
  assert.equal(instanceRecordId(id(255).toUpperCase()), `instance-${id(255)}`);
  assert.deepEqual(parseInstanceIndex({ items: [summary()] }), { items: [summary()] });
  for (const invalid of [{ ...summary(), extra: true }, { ...summary(), instanceId: '../file' }, { ...summary(), displayName: ' hidden' },
    { ...summary(), displayName: 'private\0name' }, { ...summary(), isolation: false }, { ...summary(), state: 'complete' }, { ...summary(), revision: 0 }]) {
    assert.throws(() => parseInstanceSummary(invalid), { code: 'INVALID_RECORD' });
  }
  assert.throws(() => instanceRecordId('../file'), { code: 'INVALID_RECORD' });
  assert.throws(() => parseInstanceIndex({ items: [summary(), summary()] }), { code: 'INVALID_RECORD' });
  assert.throws(() => parseInstanceIndex({ items: Array.from({ length: 1001 }, (_, i) => ({ ...summary(), instanceId: id(i + 1) })) }), { code: 'INVALID_RECORD' });
});

test('instance phases cannot claim ready without all materialization checkpoints', () => {
  assert.deepEqual(parseInstanceRecord({ summary: summary(), phase: 'reserved' }),
    { formatVersion: 2, loader: { kind: 'vanilla' }, summary: summary(), phase: 'reserved' });
  assert.deepEqual(parseInstanceRecord(ready()), ready());
  for (const invalid of [{ summary: summary(), phase: 'ready' }, { summary: { ...summary(), state: 'ready' }, phase: 'ready' },
    { summary: summary(), phase: 'prepared' }, { summary: summary(), phase: 'downloaded', metadata: metadata() },
    { ...ready(), metadata: undefined }, { ...ready(), receipts: [] }, { ...ready(), objects: {} }, { ...ready(), arbitraryPath: 'private' }]) {
    assert.throws(() => parseInstanceRecord(invalid), { code: 'INVALID_RECORD' });
  }
  assert.equal(parseInstanceRecord({ summary: { ...summary(), state: 'failed' }, phase: 'failed' }).summary.state, 'failed');
  assert.deepEqual(parseInstanceRecord({ formatVersion: 2, loader: { kind: 'fabric', version: '0.20.1' }, summary: summary(), phase: 'reserved' }).loader,
    { kind: 'fabric', version: '0.20.1' });
  for (const invalid of [
    { formatVersion: 3, loader: { kind: 'vanilla' }, summary: summary(), phase: 'reserved' },
    { formatVersion: 2, summary: summary(), phase: 'reserved' },
    { loader: { kind: 'vanilla' }, summary: summary(), phase: 'reserved' },
    { formatVersion: 2, loader: { kind: 'fabric' }, summary: summary(), phase: 'reserved' }
  ]) assert.throws(() => parseInstanceRecord(invalid), { code: 'INVALID_RECORD' });
});

test('instance metadata preserves original bytes and rejects mismatched keys, hashes, index bytes and foreign ancestry', () => {
  const valid = metadata(); assert.equal(parseInstanceRecord({ summary: summary(), phase: 'prepared', metadata: valid }).metadata?.assetIndexBody, valid.assetIndexBody);
  const changedBody = valid.versionDocuments['1.20.1']!.replace('"size":8', '"size":9');
  const foreignBody = valid.versionDocuments['1.20.1']!.replace('1.20.1', 'foreign');
  for (const invalid of [
    { ...valid, versionDocuments: { '1.20.1': changedBody } },
    { ...valid, metadataSha1ByVersion: {} },
    { ...valid, metadataSha1ByVersion: { ...valid.metadataSha1ByVersion, foreign: 'a'.repeat(40) } },
    { ...valid, assetIndexBody: valid.assetIndexBody.trim() },
    { ...valid, versionDocuments: { '1.20.1': foreignBody }, metadataSha1ByVersion: { '1.20.1': sha1(foreignBody) } },
    { ...valid, versionDocuments: { '1.20.1': '{bad JSON' }, metadataSha1ByVersion: { '1.20.1': sha1('{bad JSON') } },
    { ...valid, versionDocuments: { ...valid.versionDocuments, foreign: foreignBody }, metadataSha1ByVersion: { ...valid.metadataSha1ByVersion, foreign: sha1(foreignBody) } },
  ]) assert.throws(() => parseInstanceRecord({ summary: summary(), phase: 'prepared', metadata: invalid }), { code: 'INVALID_RECORD' });
});

test('instance object refs and receipts reject paths, unknown fields, conflicts and absent content identities', () => {
  const valid = ready(); const receipt = valid.receipts![0]!; const artifactId = receipt.artifactId;
  for (const invalid of [
    { ...valid, objects: { '../../foreign': valid.objects![artifactId] } },
    { ...valid, objects: { [artifactId]: { ...valid.objects![artifactId], sourceKey: 'wrong' } } },
    { ...valid, objects: { [artifactId]: { ...valid.objects![artifactId], path: 'private' } } },
    { ...valid, receipts: [{ ...receipt, path: '../player.dat' }] },
    { ...valid, receipts: [{ ...receipt, artifactId: `sha1-${'d'.repeat(40)}` }] },
    { ...valid, receipts: [receipt, { ...receipt, path: 'CLIENT.jar' }] },
    { ...valid, receipts: [{ ...receipt, path: 'folder' }, { ...receipt, path: 'folder/client.jar' }] },
    { ...valid, receipts: [{ ...receipt, path: 'folder/client.jar' }, { ...receipt, path: 'folder' }] },
    { ...valid, receipts: [{ ...receipt, mode: 'hardlink' }] },
  ]) assert.throws(() => parseInstanceRecord(invalid), { code: 'INVALID_RECORD' });
});

test('instance body and metadata budgets are checked before accepting persistent JSON', () => {
  const valid = metadata();
  assert.throws(() => parseInstanceRecord({ summary: summary(), phase: 'prepared', metadata: { ...valid, assetIndexBody: ' '.repeat(2 * 1024 ** 2 + 1) } }), { code: 'INVALID_RECORD' });
  assert.throws(() => parseInstanceRecord({ ...ready(), unknown: ' '.repeat(4 * 1024 ** 2) }), { code: 'INVALID_RECORD' });
});

test('instance metadata persists the exact bounded Windows rule environment instead of guessing it on reopen', () => {
  const input = { ...metadata(), environment: { os: 'windows' as const, arch: 'x64' as const, osVersion: '10.0.22631', features: { is_demo_user: false } } };
  assert.deepEqual(parseInstanceRecord({ summary: summary(), phase: 'prepared', metadata: input }).metadata?.environment, input.environment);
  for (const environment of [{ ...input.environment, os: 'linux' }, { ...input.environment, arch: 'x86' }, { ...input.environment, osVersion: 'private\0path' },
    { ...input.environment, features: { flag: 'true' } }, { ...input.environment, unknown: true }]) {
    assert.throws(() => parseInstanceRecord({ summary: summary(), phase: 'prepared', metadata: { ...input, environment } }), { code: 'INVALID_RECORD' });
  }
});

test('loader metadata is revalidated from original profile bytes and per-library source proofs', () => {
  const input = loaderInstallMetadata(); const record = parseInstanceRecord({ formatVersion: 2, loader: { kind: 'fabric', version: '0.20.1' },
    summary: summary(), phase: 'prepared', metadata: input });
  assert.deepEqual(record.metadata?.loader, input.loader);
  for (const loader of [
    { ...input.loader, profileSha256: 'f'.repeat(64) },
    { ...input.loader, profileSourceUrl: 'https://meta.fabricmc.net/v2/versions/loader/1.20.1/latest/profile/json' },
    { ...input.loader, libraries: input.loader!.libraries.map(item => ({ ...item, path: '../bad.jar' })) },
    { ...input.loader, libraries: input.loader!.libraries.map(item => ({ ...item, spec: { ...item.spec, anchor: { kind: 'loader-profile', algorithm: 'sha256', digest: input.loader!.profileSha256 } } })) },
    { ...input.loader, libraries: input.loader!.libraries.map(item => ({ ...item, spec: { ...item.spec, anchor: { ...item.spec.anchor, kind: 'mojang-version' } } })) }
  ]) assert.throws(() => parseInstanceRecord({ formatVersion: 2, loader: { kind: 'fabric', version: '0.20.1' },
    summary: summary(), phase: 'prepared', metadata: { ...input, loader } }), { code: 'INVALID_RECORD' });
  assert.throws(() => parseInstanceRecord({ formatVersion: 2, loader: { kind: 'fabric', version: '0.20.1' },
    summary: summary(), phase: 'prepared', metadata: { ...input, environment: undefined } }), { code: 'INVALID_RECORD' });
  assert.throws(() => parseInstanceRecord({ formatVersion: 2, loader: { kind: 'quilt', version: '0.20.1' },
    summary: summary(), phase: 'prepared', metadata: input }), { code: 'INVALID_RECORD' });
  assert.throws(() => parseInstanceRecord({ formatVersion: 2, loader: { kind: 'vanilla' },
    summary: summary(), phase: 'prepared', metadata: input }), { code: 'INVALID_RECORD' });
});

test('private instance worker commands and replies reject arbitrary records, foreign IDs and mismatched revisions', () => {
  const request = { version: 1, id: id(4), command: { kind: 'instance:set', instanceId: id(1), expectedRevision: 0, data: ready() } };
  assert.deepEqual(parseStorageRequest(request), request);
  for (const command of [{ ...request.command, instanceId: id(2) }, { ...request.command, expectedRevision: 1 },
    { ...request.command, file: 'private' }, { kind: 'instance:get', instanceId: '../file' }, { kind: 'instances:set', expectedRevision: 0, data: { arbitrary: [] } },
    { kind: 'record:set', recordId: 'instance-foreign', data: ready() }]) {
    assert.throws(() => parseStorageRequest({ ...request, command }));
  }
  const reply = { version: 1, kind: 'response', id: id(4), ok: true, instance: { schemaVersion: 1, revision: 1, data: ready() } };
  assert.deepEqual(parseReply(reply), reply);
  assert.throws(() => parseReply({ ...reply, instance: { ...reply.instance, revision: 2 } }));
  assert.throws(() => parseReply({ ...reply, instances: { schemaVersion: 1, revision: 1, data: { items: [] } } }));
});

test('real instance storage worker CAS persists through close/reopen without altering tasks or object hints', async () => fixture(async root => {
  let client = await StorageClient.open(worker, root);
  try {
    assert.equal(await client.readInstances(), undefined); assert.equal(await client.readInstance(id(1)), undefined);
    const task = await client.accept(id(2), id(3), 'install', 'a'.repeat(64));
    await client.remember('b'.repeat(64), { digest: 'c'.repeat(64), size: 8 });
    const index = await client.writeInstances(0, { items: [summary()] }); assert.equal(index.revision, 1);
    const reserved = await client.writeInstance(id(1), 0, { summary: summary(), phase: 'reserved' }); assert.equal(reserved.revision, 1);
    const prepared: InstanceRecord = { formatVersion: 2, loader: { kind: 'vanilla' }, summary: summary(2), phase: 'prepared', metadata: metadata() };
    assert.equal((await client.writeInstance(id(1), 1, prepared)).data.phase, 'prepared');
    await assert.rejects(client.writeInstance(id(1), 1, prepared), { code: 'REVISION_CONFLICT' });
    await assert.rejects(client.writeInstances(0, { items: [summary()] }), { code: 'REVISION_CONFLICT' });
    await assert.rejects(client.writeInstance(id(2), 1, prepared));
    await client.close(); client = await StorageClient.open(worker, root);
    assert.equal((await client.readInstance(id(1)))?.data.phase, 'prepared');
    assert.equal((await client.readInstances())?.data.items[0]?.state, 'installing');
    assert.equal((await client.get(id(2), task.taskId))?.taskId, task.taskId);
    assert.equal((await client.lookup('b'.repeat(64)))?.digest, 'c'.repeat(64));
    const disk = JSON.parse(await readFile(path.join(root, `${instanceRecordId(id(1))}.json`), 'utf8')) as { revision: number };
    assert.equal(disk.revision, 2);
  } finally { await client.close(); }
}));

test('instance record and index commit separately so a half-completed index is never promoted to ready', async () => fixture(async root => {
  let client = await StorageClient.open(worker, root);
  try {
    await client.writeInstances(0, { items: [summary()] }); await client.writeInstance(id(1), 0, { summary: summary(), phase: 'reserved' });
    await client.writeInstance(id(1), 1, ready(2)); await client.close(); client = await StorageClient.open(worker, root);
    assert.equal((await client.readInstances())?.data.items[0]?.state, 'installing');
    assert.equal((await client.readInstance(id(1)))?.data.phase, 'ready');
    await client.writeInstances(1, { items: [ready(2).summary] }); assert.equal((await client.readInstances())?.data.items[0]?.state, 'ready');
  } finally { await client.close(); }
}));

test('instance checkpoints reuse original JSON recovery instead of adding a parallel database schema', async () => fixture(async root => {
  const store = await RecordStore.open(root);
  try {
    await store.recover(); await store.write(instanceRecordId(id(1)), 0, { summary: summary(), phase: 'reserved' }, parseInstanceRecord);
    await assert.rejects(store.write(instanceRecordId(id(1)), 1, ready(2), parseInstanceRecord, async point => {
      if (point === 'renamed') throw new Error('injected interruption');
    }), { code: 'NEEDS_RECOVERY' });
    await store.recover(); await store.recover();
    assert.equal((await store.read(instanceRecordId(id(1)), parseInstanceRecord))?.data.phase, 'ready');
  } finally { await store.close(); }
}));

test('instance storage does not create or accept arbitrary caller-selected parent directories', async () => fixture(async root => {
  const directory = path.join(root, 'registered'); await mkdir(directory); const client = await StorageClient.open(worker, directory);
  try { await assert.rejects(client.readInstance('../../outside')); assert.equal(await client.readInstance(id(99)), undefined); }
  finally { await client.close(); }
}));
