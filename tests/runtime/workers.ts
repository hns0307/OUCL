import { app } from 'electron';
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setInterval, clearInterval, setTimeout, clearTimeout } from 'node:timers';
import { StorageClient } from '../../src/services/workers/storage-client.js';
import { HashPool } from '../../src/services/workers/hash-pool.js';
import { controlTask } from '../../src/core/task/machine.js';
import { ObjectStore } from '../../src/services/objects/store.js';
import { ArtifactTransfer } from '../../src/services/download/artifact-transfer.js';
import { HttpTransfer } from '../../src/services/download/http.js';
import { sourceKey } from '../../src/services/objects/provenance.js';
import { DownloadCoordinator } from '../../src/services/download/coordinator.js';
import { InstallDownloadService } from '../../src/services/install/downloads.js';
import { resolveClientVersion } from '../../src/core/version/resolve.js';
import { parseAssetIndex } from '../../src/core/install/assets.js';
import { planVanillaInstall } from '../../src/core/install/plan.js';
import { NativeExtractor } from '../../src/services/workers/native-extractor.js';
import { crc32 } from 'node:zlib';

const root = process.argv[2]; const entry = process.argv[3];
assert.ok(root && path.basename(root).startsWith('oucl-runtime-workers-') && entry && path.isAbsolute(entry));
app.setPath('userData', path.join(root, 'profile'));
const deadline = setTimeout(() => { app.exit(1); }, 30000);

void app.whenReady().then(async () => {
  let client: StorageClient | undefined;
  let objects: ObjectStore | undefined;
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
    await rm(file);
    client = await StorageClient.open(entry, storeDirectory);
    const objectsDirectory = path.join(root, 'store'); await mkdir(objectsDirectory);
    objects = await ObjectStore.open(objectsDirectory, client, pool);
    const fixture = Buffer.from('runtime object fixture');
    const expected = { algorithm: 'sha1' as const, digest: createHash('sha1').update(fixture).digest('hex'), size: fixture.length, provenanceId: 'fixture:a' };
    const anchor = { kind: 'mojang-version' as const, algorithm: 'sha1' as const, digest: 'a'.repeat(40) };
    const stagedA = await objects.createStaging(); const stagedB = await objects.createStaging();
    await writeFile(stagedA.file, fixture); await writeFile(stagedB.file, fixture);
    const objectA = await objects.commit(stagedA.id, expected, anchor);
    const objectB = await objects.commit(stagedB.id, { ...expected, provenanceId: 'fixture:b' }, anchor);
    assert.equal(objectA.digest, objectB.digest); assert.notEqual(objectA.sourceKey, objectB.sourceKey);
    await client.clear(); assert.equal(await objects.lookup(expected, anchor), undefined);
    assert.equal(await objects.rebuildIndex(), 2);
    assert.equal((await objects.lookup(expected, anchor))?.digest, objectA.digest);
    assert.equal((await client.get(ownerId, task.taskId))?.execution.state, 'needsRecovery');
    const transferSpec = { url: 'https://piston-data.mojang.com/objects/runtime-fixture/client.jar',
      expected: { ...expected, provenanceId: 'fixture:download' }, anchor };
    let transferRequests = 0; const halfway = Math.floor(fixture.length / 2);
    const transferHttp = new HttpTransfer(async (_url, options) => {
      transferRequests++;
      if (transferRequests === 1) return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(fixture.subarray(0, halfway)); controller.enqueue(fixture.subarray(halfway)); controller.close();
      } }), { headers: { 'content-length': String(fixture.length), etag: '"runtime-v1"' } });
      assert.equal(new Headers(options?.headers).get('range'), `bytes=${halfway}-`);
      return new Response(fixture.subarray(halfway), { status: 206, headers: { 'content-length': String(fixture.length - halfway),
        'content-range': `bytes ${halfway}-${fixture.length - 1}/${fixture.length}`, etag: '"runtime-v1"' } });
    });
    const stopTransfer = new AbortController();
    await assert.rejects(new ArtifactTransfer(transferHttp, client, objects).run(transferSpec,
      { signal: stopTransfer.signal, onProgress: () => { stopTransfer.abort(); } }), { code: 'CANCELLED' });
    await objects.close(); objects = undefined; await client.close(); client = undefined;
    client = await StorageClient.open(entry, storeDirectory); objects = await ObjectStore.open(objectsDirectory, client, pool);
    const physical = new ArtifactTransfer(transferHttp, client, objects);
    const transferred = await physical.run(transferSpec);
    assert.equal(transferred.digest, objectA.digest);
    assert.equal((await client.getTransfer(sourceKey(transferSpec.expected, anchor)))?.state, 'committed');
    await physical.run(transferSpec); assert.equal(transferRequests, 2);
    const shared = new DownloadCoordinator(physical, objects);
    try {
      const a = shared.request(transferSpec, { consumerId: '00000000-0000-4000-8000-000000000011' });
      const secondSource = { ...transferSpec, expected: { ...expected, provenanceId: 'fixture:independent-source' } };
      const b = shared.request(secondSource, { consumerId: '00000000-0000-4000-8000-000000000012' });
      await a.cancel(); await assert.rejects(a.result, { code: 'CANCELLED' });
      assert.equal((await b.result).digest, objectA.digest); assert.equal(transferRequests, 2);
      assert.equal((await objects.lookup(secondSource.expected, anchor))?.digest, objectA.digest);
    } finally { await shared.close(); }
    const assetIndexBody = '{\n  "objects": {}\n}\n'; const assetIndexHash = createHash('sha1').update(assetIndexBody).digest('hex');
    const version = resolveClientVersion('fixture', { fixture: { id: 'fixture', mainClass: 'net.minecraft.client.main.Main',
      downloads: { client: { url: transferSpec.url, sha1: expected.digest, size: expected.size } },
      assetIndex: { id: 'fixture', url: `https://piston-meta.mojang.com/v1/packages/${assetIndexHash}/fixture.json`, sha1: assetIndexHash, size: Buffer.byteLength(assetIndexBody) }
    } }, { os: 'windows', arch: 'x64', osVersion: '10.0', features: {} });
    const assets = parseAssetIndex(JSON.parse(assetIndexBody) as unknown); const metadataSha1ByVersion = { fixture: anchor.digest };
    let batchNetworkRequests = 0;
    const batchPhysical = new ArtifactTransfer(new HttpTransfer(async () => {
      batchNetworkRequests++; return new Response(fixture, { headers: { 'content-length': String(fixture.length) } });
    }), client, objects);
    const batchCoordinator = new DownloadCoordinator(batchPhysical, objects);
    let batchArtifactsVerified = 0;
    try {
      const batch = new InstallDownloadService(batchCoordinator, objects);
      const prepared = { version, assets, plan: planVanillaInstall(version, metadataSha1ByVersion, assets), metadataSha1ByVersion, assetIndexBody };
      const result = await batch.run(prepared); batchArtifactsVerified = result.objects.size;
      assert.equal(batchArtifactsVerified, 2); await batch.run(prepared); assert.equal(batchNetworkRequests, 1);
    } finally { await batchCoordinator.close(); }
    const nativeName = Buffer.from('lwjgl.dll'); const nativeCrc = crc32(fixture);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
    local.writeUInt32LE(nativeCrc, 14); local.writeUInt32LE(fixture.length, 18); local.writeUInt32LE(fixture.length, 22); local.writeUInt16LE(nativeName.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt32LE(nativeCrc, 16); central.writeUInt32LE(fixture.length, 20); central.writeUInt32LE(fixture.length, 24); central.writeUInt16LE(nativeName.length, 28);
    const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
    end.writeUInt32LE(central.length + nativeName.length, 12); end.writeUInt32LE(local.length + nativeName.length + fixture.length, 16);
    const nativeBytes = Buffer.concat([local, nativeName, fixture, central, nativeName, end]);
    const nativeFile = path.join(root, 'native-fixture.jar'); await writeFile(nativeFile, nativeBytes);
    const nativeOutput = path.join(root, 'native-workspace'); await mkdir(nativeOutput);
    const nativeExtractor = new NativeExtractor(entry);
    try {
      assert.deepEqual(await nativeExtractor.run(nativeOutput, [{ file: nativeFile, sha256: createHash('sha256').update(nativeBytes).digest('hex'), size: nativeBytes.length, exclude: [] }]), { files: 1, bytes: fixture.length });
      assert.deepEqual(await readFile(path.join(nativeOutput, 'lwjgl.dll')), fixture);
    } finally { await nativeExtractor.close(); }
    await rm(nativeOutput, { recursive: true }); await rm(nativeFile);
    const hashWorkersSpawned = pool.spawnedWorkers;
    assert.ok(hashWorkersSpawned <= 3, 'HASH_SESSIONS_WERE_NOT_REUSED');
    await objects.close(); objects = undefined;
    await client.close(); client = undefined; await pool.close();
    console.log('OUCL_WORKERS_RESULT:' + JSON.stringify({ status: 'PASS', electron: process.versions.electron, node: process.versions.node,
      builtWorkerUsed: true, storageAcceptanceIdempotent: true, interruptedTaskProtected: true, hashBytes: result.size,
      hashElapsedMs, hashMatched: true, parentEventLoopTicks: ticks,
      progressEvents, cancellationJoined: true, fileHandleReleased: true, objectDeduplicated: true, provenanceSeparated: true,
      objectIndexRebuilt: true, durableTaskPreserved: true, artifactTransferVerified: true,
      transferCancelledAndResumed: true, transferJournalCommitted: true, verifiedTransferReused: true,
      sharedConsumerCancellationIsolated: true, independentSourceAdopted: true, hashWorkersSpawned,
      batchArtifactsVerified, batchNetworkRequests, batchIndexImported: true, batchCachedReuse: true,
      nativeWorkerExtracted: true, nativeWorkerHandlesReleased: true }));
    clearTimeout(deadline); app.exit(0);
  } catch (error) {
    await objects?.close().catch(() => {}); await pool.close(); await client?.close().catch(() => {});
    console.log('OUCL_WORKERS_RESULT:' + JSON.stringify({ status: 'FAIL', code: error instanceof Error && 'code' in error ? error.code : 'RUNTIME_ASSERTION' }));
    clearTimeout(deadline); app.exit(1);
  }
}).catch(() => { clearTimeout(deadline); app.exit(1); });
