import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveClientVersion } from '../src/core/version/resolve.js';
import { parseAssetIndex } from '../src/core/install/assets.js';
import { planVanillaInstall } from '../src/core/install/plan.js';
import type { PreparedInstallMetadata } from '../src/services/catalog/install-metadata.js';
import { DownloadCoordinator } from '../src/services/download/coordinator.js';
import { DownloadError } from '../src/services/download/types.js';
import type { DownloadSpec, TransferOptions } from '../src/services/download/types.js';
import { InstallDownloadService } from '../src/services/install/downloads.js';
import { importAssetIndex } from '../src/services/install/metadata-object.js';
import { ObjectStore } from '../src/services/objects/store.js';
import type { ObjectRef } from '../src/services/objects/store.js';
import { sourceKey } from '../src/services/objects/provenance.js';

const sha1 = (bytes: string | Buffer): string => createHash('sha1').update(bytes).digest('hex');
const content = new Map<string, Buffer>();
function artifact(name: string, body: string) {
  const bytes = Buffer.from(body); const hash = sha1(bytes); content.set(hash, bytes);
  return { url: `https://libraries.minecraft.net/fixture/${name}.jar`, sha1: hash, size: bytes.length };
}
function metadata(count = 8): PreparedInstallMetadata {
  const client = artifact('client', 'client');
  const assets = Object.fromEntries(Array.from({ length: count }, (_, i) => {
    const value = artifact(`asset${i}`, `asset-${i}`); return [`minecraft/file${i}.ogg`, { hash: value.sha1, size: value.size }];
  }));
  const body = JSON.stringify({ objects: assets }, null, 2) + '\n'; const hash = sha1(body);
  const shared = artifact('shared', 'shared-library');
  const version = resolveClientVersion('child', {
    base: { id: 'base', mainClass: 'net.minecraft.client.main.Main', downloads: { client },
      assetIndex: { id: '17', url: `https://piston-meta.mojang.com/v1/packages/${hash}/17.json`, sha1: hash, size: Buffer.byteLength(body) },
      libraries: [{ name: 'org.example:base:1', downloads: { artifact: shared } }] },
    child: { id: 'child', inheritsFrom: 'base', libraries: [{ name: 'org.example:child:1', downloads: { artifact: shared } }] }
  }, { os: 'windows', arch: 'x64', osVersion: '10.0', features: {} });
  const parsed = parseAssetIndex(JSON.parse(body) as unknown); const hashes = { base: 'b'.repeat(40), child: 'c'.repeat(40) };
  return { version, assets: parsed, plan: planVanillaInstall(version, hashes, parsed), metadataSha1ByVersion: hashes, assetIndexBody: body };
}
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'oucl-batch-')); const index = new Map<string, { digest: string; size: number }>();
  const store = await ObjectStore.open(root, {
    async lookup(key) { return index.get(key); }, async remember(key, value) { index.set(key, value); }, async clear() { index.clear(); }
  }, { async hash(file) { const bytes = await readFile(file); return { size: bytes.length, sha1: sha1(bytes), sha256: createHash('sha256').update(bytes).digest('hex') }; } });
  let active = 0; let peak = 0; let calls = 0; let writes = 0;
  const physical = { async run(spec: DownloadSpec, options: TransferOptions = {}): Promise<ObjectRef> {
    const cached = await store.lookup(spec.expected, spec.anchor); if (cached) return cached;
    active++; peak = Math.max(peak, active); calls++;
    try {
      await new Promise<void>(resolve => setTimeout(resolve, 5));
      if (options.signal?.aborted) throw new DownloadError('CANCELLED');
      const staged = await store.createStaging();
      try {
        const bytes = content.get(spec.expected.digest); assert.ok(bytes); writes++;
        await writeFile(staged.file, bytes); return await store.commit(staged.id, spec.expected, spec.anchor);
      } finally { await store.discardStaging(staged.id); }
    } finally { active--; }
  } };
  const coordinator = new DownloadCoordinator(physical, store, 3);
  return { root, store, coordinator, index, stats: () => ({ active, peak, calls, writes }),
    async close() { await coordinator.close(); await store.close(); await rm(root, { recursive: true, force: true }); } };
}

test('batch imports exact metadata, bounds work, commits all independent proofs and reuses cached bytes', async () => {
  const data = metadata(25); const f = await fixture();
  try {
    const progress: number[] = []; const service = new InstallDownloadService(f.coordinator, f.store, 2);
    const result = await service.run(data, { onProgress(value) { progress.push(value.verifiedBytes); } });
    assert.equal(result.objects.size, result.plan.artifacts.length); assert.equal(f.stats().peak, 2);
    assert.equal(progress.at(-1), result.plan.totalBytes); assert.deepEqual([...progress].sort((a, b) => a - b), progress);
    const indexArtifact = result.plan.artifacts.find(entry => entry.sha1 === data.version.assetIndex!.sha1)!;
    const indexObject = result.objects.get(indexArtifact.artifactId)!;
    assert.equal(await readFile(path.join(f.root, 'objects', 'sha256', indexObject.digest.slice(0, 2), indexObject.digest), 'utf8'), data.assetIndexBody);
    const shared = result.plan.artifacts.find(entry => entry.proofs.length === 2)!; assert.ok(shared);
    for (const proof of shared.proofs) assert.ok(f.index.has(sourceKey(
      { algorithm: 'sha1', digest: shared.sha1, size: shared.size, provenanceId: proof.provenanceId },
      { kind: proof.source.kind, algorithm: 'sha1', digest: proof.source.sha1 })));
    assert.equal(f.stats().calls, result.plan.artifacts.length - 1); const written = f.stats().writes;
    await service.run(data); assert.equal(f.stats().writes, written); assert.equal(f.stats().active, 0);
  } finally { await f.close(); }
});

test('bad metadata and already aborted batches do not start a single network consumer', async () => {
  const data = metadata(); const f = await fixture();
  try {
    const service = new InstallDownloadService(f.coordinator, f.store);
    await assert.rejects(service.run({ ...data, assetIndexBody: data.assetIndexBody + ' ' }), { code: 'HASH_MISMATCH' });
    await assert.rejects(service.run({ ...data, assetIndexBody: '{private-data' }), { code: 'INVALID_TRANSFER', message: 'INVALID_TRANSFER' });
    await assert.rejects(service.run(data, { signal: AbortSignal.abort() }), { code: 'CANCELLED' });
    assert.equal(f.stats().calls, 0); assert.equal(f.index.size, 0);
  } finally { await f.close(); }
});

test('one batch cancellation joins its work while another installation finishes shared downloads', async () => {
  const data = metadata(15); const f = await fixture(); const controller = new AbortController();
  try {
    const service = new InstallDownloadService(f.coordinator, f.store, 2); let cancelled = false;
    const a = service.run(data, { signal: controller.signal, onProgress(value) {
      if (value.completedArtifacts >= 3 && !cancelled) { cancelled = true; controller.abort(); }
    } });
    const b = service.run(data);
    await assert.rejects(a, { code: 'CANCELLED' }); const result = await b;
    assert.equal(result.objects.size, result.plan.artifacts.length); assert.equal(f.stats().active, 0);
    assert.ok(f.stats().calls <= result.plan.artifacts.length); // May join existing jobs or verified cache.
  } finally { await f.close(); }
});

test('callback failures abort siblings and are redacted after all owned transfers finish', async () => {
  const data = metadata(15); const f = await fixture();
  try {
    const service = new InstallDownloadService(f.coordinator, f.store, 3);
    await assert.rejects(service.run(data, { onProgress(value) {
      if (value.completedArtifacts === 2) throw new Error('PRIVATE_PATH');
    } }), { code: 'CALLBACK_FAILED', message: 'CALLBACK_FAILED' });
    assert.equal(f.stats().active, 0);
    const result = await service.run(data); assert.equal(result.objects.size, result.plan.artifacts.length);
  } finally { await f.close(); }
});

test('an in-flight commit error takes precedence over concurrent user cancellation', async () => {
  const data = metadata(0); const f = await fixture(); const controller = new AbortController();
  try {
    const store = { lookup: f.store.lookup.bind(f.store), createStaging: f.store.createStaging.bind(f.store),
      discardStaging: f.store.discardStaging.bind(f.store), adopt: f.store.adopt.bind(f.store),
      async commit(): Promise<ObjectRef> { controller.abort(); throw new DownloadError('DISK_FULL'); } };
    await assert.rejects(new InstallDownloadService(f.coordinator, store).run(data, { signal: controller.signal }), { code: 'DISK_FULL' });
    assert.equal(f.stats().calls, 0);
  } finally { await f.close(); }
});

test('index import maps operating-system and cleanup exceptions to fixed errors', async () => {
  const data = metadata(0); const f = await fixture();
  const artifact = data.plan.artifacts.find(entry => entry.sha1 === data.version.assetIndex!.sha1)!;
  try {
    for (const [code, expected] of [['ENOSPC', 'DISK_FULL'], ['EACCES', 'DISK_PERMISSION'], ['ENOENT', 'TRANSFER_IO']]) {
      const store = { lookup: f.store.lookup.bind(f.store), commit: f.store.commit.bind(f.store), discardStaging: f.store.discardStaging.bind(f.store),
        async createStaging(): Promise<{ id: string; file: string }> { throw Object.assign(new Error('PRIVATE_PATH'), { code }); } };
      await assert.rejects(importAssetIndex(store, artifact, data.assetIndexBody), { code: expected, message: expected });
    }
    const store = { lookup: f.store.lookup.bind(f.store), createStaging: f.store.createStaging.bind(f.store), commit: f.store.commit.bind(f.store),
      async discardStaging(): Promise<void> { throw Object.assign(new Error('PRIVATE_PATH'), { code: 'EPERM' }); } };
    await assert.rejects(importAssetIndex(store, artifact, data.assetIndexBody), { code: 'DISK_PERMISSION', message: 'DISK_PERMISSION' });
  } finally { await f.close(); }
});

test('cancellation during metadata commit joins the commit and retains verified shared content', async () => {
  const data = metadata(0); const f = await fixture(); const controller = new AbortController();
  let entered: () => void = () => {}; let release: () => void = () => {};
  const started = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    const store = { lookup: f.store.lookup.bind(f.store), createStaging: f.store.createStaging.bind(f.store),
      discardStaging: f.store.discardStaging.bind(f.store), adopt: f.store.adopt.bind(f.store),
      async commit(...args: Parameters<ObjectStore['commit']>): Promise<ObjectRef> { entered(); await gate; return f.store.commit(...args); } };
    let settled = false; const result = new InstallDownloadService(f.coordinator, store).run(data, { signal: controller.signal });
    void result.then(() => { settled = true; }, () => { settled = true; });
    await started; controller.abort(); await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(settled, false);
    release(); await assert.rejects(result, { code: 'CANCELLED' }); assert.equal(f.index.size, 1); assert.equal(f.stats().calls, 0);
  } finally { release(); await f.close(); }
});

test('caller changes to the prepared plan or body cannot alter the admitted private plan', async () => {
  const data = metadata(2); const f = await fixture(); const originalBytes = data.plan.totalBytes;
  try {
    data.plan.artifacts.length = 0; let changed = false;
    const result = await new InstallDownloadService(f.coordinator, f.store).run(data, { onProgress() {
      if (!changed) { changed = true; data.assetIndexBody = 'PRIVATE_MUTATION'; data.version.libraries.length = 0; }
    } });
    assert.equal(result.plan.totalBytes, originalBytes); assert.equal(result.objects.size, result.plan.artifacts.length);
  } finally { await f.close(); }
});
