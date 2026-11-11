import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import { StorageClient } from '../src/services/workers/storage-client.js';
import { CatalogService } from '../src/services/catalog/service.js';
import { InstallMetadataService } from '../src/services/catalog/install-metadata.js';
import { InstallerService, restoreInstallMetadata } from '../src/services/install/installer.js';
import { LoaderInstallMetadataService } from '../src/services/loaders/install-metadata.js';
import { parseLoaderProfile } from '../src/core/loaders/metadata.js';
import type { MetadataReader } from '../src/services/catalog/transport.js';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { LaunchService } from '../src/services/launch/service.js';
import { GameProcessService } from '../src/services/launch/process.js';
import { ProfileService } from '../src/services/launch/profiles.js';
import { GameAdapter } from '../src/ipc/game-adapter.js';
import { InstallerAdapter } from '../src/ipc/installer-adapter.js';
import type { TaskChangedEvent } from '../src/shared/contracts/instances.js';
import { HashPool } from '../src/services/workers/hash-pool.js';
import { NativeExtractor } from '../src/services/workers/native-extractor.js';
import { FileViewService } from '../src/services/install/file-views.js';
import { verifyLaunchInputs } from '../src/services/install/launch-inputs.js';

const entry = new URL('../src/services/workers/entry.js', import.meta.url);
const rootId = '00000000-0000-4000-8000-000000000001';
const request = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sha1 = (body: Buffer | string): string => createHash('sha1').update(body).digest('hex');
function nativeJar(): Buffer {
  const name = Buffer.from('native.dll'); const body = Buffer.from('non executable native fixture'); const crc = crc32(body);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(body.length, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + body.length, 16);
  return Buffer.concat([local, name, body, central, name, end]);
}
type MetadataLoaderKind = 'fabric' | 'quilt';
async function fixture(loaderKind: MetadataLoaderKind = 'fabric', minecraftVersion = 'fixture',
  loaderVersion = loaderKind === 'fabric' ? '0.20.1' : '0.29.2') {
  const root = await mkdtemp(path.join(tmpdir(), 'oucl-installer-')); const metadataDirectory = path.join(root, 'metadata'); const dataDirectory = path.join(root, 'games');
  await mkdir(metadataDirectory); await mkdir(dataDirectory); const storage = await StorageClient.open(entry, metadataDirectory);
  await storage.createInstallation({ rootId, dataDirectory });
  const bodies = new Map<string, Buffer>();
  const artifact = (name: string, bytes: Buffer, native = false) => {
    const url = `https://libraries.minecraft.net/fixture/${name}${native ? '-natives-windows' : ''}.jar`;
    bodies.set(url, bytes); return { url, sha1: sha1(bytes), size: bytes.length };
  };
  const client = artifact('client', Buffer.from('non executable client fixture')); const library = artifact('library', Buffer.from('library fixture'));
  const native = artifact('library', nativeJar(), true); const resource = Buffer.from('asset fixture'); const hash = sha1(resource);
  bodies.set(`https://resources.download.minecraft.net/${hash.slice(0, 2)}/${hash}`, resource);
  const indexBody = JSON.stringify({ objects: { 'minecraft/sound.ogg': { hash, size: resource.length } } }, null, 2);
  const indexHash = sha1(indexBody); const indexUrl = `https://piston-meta.mojang.com/v1/packages/${indexHash}/fixture.json`;
  const descriptor = JSON.stringify({ id: minecraftVersion, mainClass: 'net.minecraft.client.main.Main', type: 'release', downloads: { client },
    javaVersion: { majorVersion: 17 }, assetIndex: { id: 'fixture', url: indexUrl, sha1: indexHash, size: Buffer.byteLength(indexBody) },
    libraries: [{ name: 'org.example:library:1', downloads: { artifact: library, classifiers: { 'natives-windows': native } }, natives: { windows: 'natives-windows' } }],
    arguments: { game: ['--username', '${auth_player_name}', '--gameDir', '${game_directory}'], jvm: ['-cp', '${classpath}', '-Djava.library.path=${natives_directory}'] } });
  const descriptorHash = sha1(descriptor); const descriptorUrl = `https://piston-meta.mojang.com/v1/packages/${descriptorHash}/${minecraftVersion}.json`;
  const manifest = JSON.stringify({ versions: [{ id: minecraftVersion, type: 'release', url: descriptorUrl, sha1: descriptorHash,
    time: '2026-01-01T00:00:00+00:00', releaseTime: '2026-01-01T00:00:00+00:00' }] });
  let metadataRequests = 0; let offline = false;
  const reader: MetadataReader = { async read(url, expected) {
    metadataRequests++; if (offline) throw new Error('fixture metadata disabled');
    const body = url === descriptorUrl ? descriptor : url === indexUrl ? indexBody : manifest;
    const digest = sha1(body); if (expected) assert.equal(digest, expected);
    return { body, sha1: digest, sha256: createHash('sha256').update(body).digest('hex') };
  } };
  const loaderBytes = Buffer.from(`${loaderKind} loader library fixture`); const loaderHash = sha1(loaderBytes);
  const loaderRepository = loaderKind === 'fabric' ? 'https://maven.fabricmc.net/' : 'https://maven.quiltmc.org/repository/release/';
  const loaderGroup = loaderKind === 'fabric' ? 'net.fabricmc' : 'org.quiltmc';
  const loaderCoordinate = `${loaderGroup}:${loaderKind}-loader:${loaderVersion}`;
  const loaderPath = `${loaderGroup.replaceAll('.', '/')}/${loaderKind}-loader/${loaderVersion}`;
  const loaderArtifact = loaderKind === 'fabric' ? 'fabric-loader' : 'quilt-loader';
  const loaderUrl = `${loaderRepository}${loaderPath}/${loaderArtifact}-${loaderVersion}.jar`; bodies.set(loaderUrl, loaderBytes);
  const loaderMainClass = loaderKind === 'fabric' ? 'net.fabricmc.loader.impl.launch.knot.KnotClient' : 'org.quiltmc.loader.impl.launch.knot.KnotClient';
  const loaderValue = { id: `${loaderArtifact}-${loaderVersion}-${minecraftVersion}`, inheritsFrom: minecraftVersion, mainClass: loaderMainClass,
    arguments: { game: [], jvm: [`-D${loaderKind}.fixture=true`] }, libraries: [{ name: loaderCoordinate, url: loaderRepository }] };
  const loaderBody = JSON.stringify(loaderValue); const loaderProfile = parseLoaderProfile(loaderKind, minecraftVersion, loaderVersion, loaderValue);
  const loaderSha256 = createHash('sha256').update(loaderBody).digest('hex');
  const originalFetch = globalThis.fetch; let requests = 0; let delayed = false;
  let notifyFetchStarted: (() => void) | undefined;
  const fetchStarted = new Promise<void>(resolve => { notifyFetchStarted = resolve; });
  globalThis.fetch = async (url, options) => {
    requests++; notifyFetchStarted?.(); notifyFetchStarted = undefined;
    if (offline) throw new Error('fixture network disabled');
    if (delayed) await new Promise<void>(resolve => setTimeout(resolve, 100));
    if (options?.signal?.aborted) throw new DOMException('cancelled', 'AbortError');
    const bytes = bodies.get(String(url)); assert.ok(bytes, 'fixture URL not found');
    return new Response(new Uint8Array(bytes), { headers: { 'content-length': String(bytes.length) } });
  };
  const createLoaderMetadata = (repository: StorageClient): LoaderInstallMetadataService => {
    const vanilla = new InstallMetadataService(new CatalogService(reader, repository), reader);
    return new LoaderInstallMetadataService(vanilla, { profile: async () => {
      metadataRequests++; if (offline) throw new Error('fixture metadata disabled');
      return { profile: loaderProfile, body: loaderBody,
        evidence: { sourceUrl: `${loaderKind === 'fabric' ? 'https://meta.fabricmc.net/v2' : 'https://meta.quiltmc.org/v3'}/versions/loader/${minecraftVersion}/${loaderVersion}/profile/json`, sha256: loaderSha256 } };
    } },
    { plan: async () => { metadataRequests++; if (offline) throw new Error('fixture metadata disabled'); return { totalBytes: loaderBytes.length, libraries: [{ path: loaderProfile.libraries[0]!.path, spec: { url: loaderUrl,
      expected: { algorithm: 'sha1', digest: loaderHash, size: loaderBytes.length, provenanceId: `loader:${loaderKind}:${loaderHash}` },
      anchor: { kind: 'loader-maven', algorithm: 'sha256', digest: 'f'.repeat(64) } } }] }; } });
  };
  const createService = (repository: StorageClient): InstallerService => new InstallerService(repository, entry,
    new InstallMetadataService(new CatalogService(reader, repository), reader), createLoaderMetadata(repository));
  const service = createService(storage);
  return { root, storage, service, createService, metadataDirectory, dataDirectory, indexHash, requests: () => requests,
    metadataRequests: () => metadataRequests, waitForFetch: () => fetchStarted, delay: () => { delayed = true; }, resume: () => { delayed = false; },
    offline: () => { offline = true; },
    async close() { await service.close(); globalThis.fetch = originalFetch; await storage.close(); assert.equal(path.dirname(root), path.resolve(tmpdir())); assert.ok(path.basename(root).startsWith('oucl-installer-')); await rm(root, { recursive: true, force: true }); } };
}
async function finished(service: InstallerService, taskId: string) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const result = await service.task(rootId, taskId);
    if (['completed', 'failed', 'cancelled', 'needsRecovery'].includes(result.task.execution.state)) return result;
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  throw new Error('INSTALLER_TEST_TIMEOUT');
}
const input = { rootId, mcVersionId: 'fixture', displayName: 'First instance', isolation: 'on' as const };

test('actual installer commits a complete private instance and reuses shared files across a second instance', async () => {
  const f = await fixture();
  try {
    const accepted = await f.service.create(request(10), input); assert.deepEqual(await f.service.create(request(10), input), accepted);
    const completed = await finished(f.service, accepted.taskId); assert.equal(completed.task.execution.state, 'completed'); assert.equal(completed.instance?.state, 'ready');
    const instanceId = completed.instance!.instanceId; const record = await f.storage.readInstance(instanceId); assert.ok(record);
    assert.equal(record.data.phase, 'ready'); assert.equal(record.data.receipts?.length, restoreInstallMetadata(record.data).plan.views.length);
    assert.ok(record.data.receipts?.some(receipt => receipt.area === 'assets' && receipt.path === 'indexes/fixture.json'));
    assert.deepEqual((await f.service.listV2(rootId))[0]?.loader, { kind: 'vanilla' });
    const directory = path.join(f.dataDirectory, 'roots', rootId, '.minecraft', 'versions', instanceId);
    const manifest = JSON.parse(await readFile(path.join(directory, 'oucl.instance.json'), 'utf8')) as { data: unknown };
    assert.deepEqual(manifest.data, record.data); assert.equal(await readFile(path.join(directory, 'natives', 'native.dll'), 'utf8'), 'non executable native fixture');
    assert.equal(await readFile(path.join(directory, `${instanceId}.jar`), 'utf8'), 'non executable client fixture');
    const count = f.requests(); assert.equal(count, 4);
    const second = await f.service.create(request(11), { ...input, displayName: 'Second instance' });
    assert.equal((await finished(f.service, second.taskId)).task.execution.state, 'completed'); assert.equal(f.requests(), count);
    await assert.rejects(f.service.cancel(rootId, accepted.taskId), { code: 'CANCEL_TOO_LATE' });
    assert.equal((await f.service.list(rootId)).filter(item => item.state === 'ready').length, 2);
    await f.service.close(); await f.storage.close();
    const reopened = await StorageClient.open(entry, f.metadataDirectory); const restarted = f.createService(reopened);
    try {
      await restarted.initialize(); assert.equal((await restarted.list(rootId)).filter(item => item.state === 'ready').length, 2);
      assert.equal((await restarted.task(rootId, accepted.taskId)).task.execution.state, 'completed');
    } finally { await restarted.close(); await reopened.close(); }
  } finally { await f.close(); }
});

test('Fabric installation uses the same transaction and reopens with its pinned loader plan', async () => {
  const f = await fixture();
  try {
    const accepted = await f.service.createLoader(request(12), { ...input, displayName: 'Fabric instance', loader: { kind: 'fabric', version: '0.20.1' } });
    const completed = await finished(f.service, accepted.taskId); assert.equal(completed.task.execution.state, 'completed'); assert.ok(completed.instance);
    const record = await f.storage.readInstance(completed.instance.instanceId); assert.equal(record?.data.loader?.kind, 'fabric');
    assert.deepEqual((await f.service.listV2(rootId))[0]?.loader, { kind: 'fabric', version: '0.20.1' });
    assert.equal(record?.data.metadata?.loader?.version, '0.20.1');
    const restored = restoreInstallMetadata(record!.data); assert.equal(restored.version.mainClass, 'net.fabricmc.loader.impl.launch.knot.KnotClient');
    assert.ok(restored.version.jvmArguments.includes('-Dfabric.fixture=true'));
    assert.ok(restored.plan.artifacts.some(item => item.sha1 === sha1(Buffer.from('fabric loader library fixture'))));
    await f.service.close(); await f.storage.close(); const reopened = await StorageClient.open(entry, f.metadataDirectory); const restarted = f.createService(reopened);
    try { await restarted.initialize(); assert.equal((await restarted.list(rootId))[0]?.state, 'ready'); }
    finally { await restarted.close(); await reopened.close(); }
  } finally { await f.close(); }
});

for (const target of [
  { kind: 'fabric' as const, minecraftVersion: '1.20.1', loaderVersion: '0.16.14', mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient' },
  { kind: 'quilt' as const, minecraftVersion: '1.20.1', loaderVersion: '0.29.2', mainClass: 'org.quiltmc.loader.impl.launch.knot.KnotClient' }
]) {
  test(`${target.kind} reference target installs privately and reopens without metadata or transfer access`, async () => {
    const f = await fixture(target.kind, target.minecraftVersion, target.loaderVersion);
    try {
      const accepted = await f.service.createLoader(request(80), { rootId, mcVersionId: target.minecraftVersion,
        displayName: `${target.kind} reference`, isolation: 'on', loader: { kind: target.kind, version: target.loaderVersion } });
      const completed = await finished(f.service, accepted.taskId); assert.equal(completed.task.execution.state, 'completed'); assert.ok(completed.instance);
      const another = await f.service.createLoader(request(81), { rootId, mcVersionId: target.minecraftVersion,
        displayName: `${target.kind} shared client`, isolation: 'on', loader: { kind: target.kind, version: target.loaderVersion } });
      assert.equal((await finished(f.service, another.taskId)).task.execution.state, 'completed');
      const stored = await f.storage.readInstance(completed.instance.instanceId); assert.ok(stored); assert.equal(stored.data.phase, 'ready');
      assert.deepEqual(stored.data.loader, { kind: target.kind, version: target.loaderVersion });
      const verified = await f.service.prepareLaunch(completed.instance.instanceId, stored.revision, new AbortController().signal);
      assert.equal(verified.prepared.version.mainClass, target.mainClass);
      assert.equal(verified.prepared.version.javaMajor, 17);
      assert.ok(verified.prepared.version.jvmArguments.includes(`-D${target.kind}.fixture=true`));
      assert.equal(verified.layout.gameDirectory, path.join(verified.layout.gameRoot, 'versions', completed.instance.instanceId));
      const transferCount = f.requests(); const metadataCount = f.metadataRequests(); f.offline();
      await f.service.close(); await f.storage.close();
      const reopened = await StorageClient.open(entry, f.metadataDirectory); const restarted = f.createService(reopened);
      try {
        await restarted.initialize(); const summaries = await restarted.listV2(rootId); assert.equal(summaries.length, 2);
        assert.deepEqual(summaries[0]?.loader, { kind: target.kind, version: target.loaderVersion });
        const record = await reopened.readInstance(completed.instance.instanceId); assert.ok(record);
        const offlineVerified = await restarted.prepareLaunch(completed.instance.instanceId, record.revision, new AbortController().signal);
        assert.equal(offlineVerified.prepared.version.mainClass, target.mainClass);
        assert.equal(f.requests(), transferCount); assert.equal(f.metadataRequests(), metadataCount);
      } finally { await restarted.close(); await reopened.close(); }
    } finally { await f.close(); }
  });

  test(`${target.kind} cancellation stays unlaunchable and a new request can install the same display name`, async () => {
    const f = await fixture(target.kind, target.minecraftVersion, target.loaderVersion); f.delay();
    try {
      const loaderInput = { rootId, mcVersionId: target.minecraftVersion, displayName: `${target.kind} cancelled`, isolation: 'on' as const,
        loader: { kind: target.kind, version: target.loaderVersion } };
      const accepted = await f.service.createLoader(request(81), loaderInput); await f.waitForFetch(); await f.service.cancel(rootId, accepted.taskId);
      const cancelled = await finished(f.service, accepted.taskId); assert.equal(cancelled.task.execution.state, 'cancelled');
      assert.equal(cancelled.instance?.state, 'cancelled'); assert.ok(cancelled.instance);
      await assert.rejects(f.service.prepareLaunch(cancelled.instance.instanceId, cancelled.instance.revision, new AbortController().signal),
        { code: 'INSTANCE_NOT_FOUND' });
      f.resume(); const retry = await f.service.createLoader(request(82), loaderInput);
      const ready = await finished(f.service, retry.taskId); assert.equal(ready.task.execution.state, 'completed'); assert.equal(ready.instance?.state, 'ready');
    } finally { await f.close(); }
  });
}

test('request idempotency rejects changed payload and same-name admission never overwrites an instance', async () => {
  const f = await fixture();
  try {
    const first = f.service.create(request(20), input);
    await assert.rejects(f.service.create(request(20), { ...input, displayName: 'Changed' }), { code: 'REVISION_CONFLICT' });
    const accepted = await first; await finished(f.service, accepted.taskId);
    await assert.rejects(f.service.create(request(21), input), { code: 'NAME_CONFLICT' });
    await assert.rejects(f.service.create(request(21), input), { code: 'NAME_CONFLICT' });
    assert.equal((await f.service.list(rootId)).length, 1);
  } finally { await f.close(); }
});

test('cancelled install stays unready, joins transfers and a new retry can reuse the original display name', async () => {
  const f = await fixture(); f.delay();
  try {
    const accepted = await f.service.create(request(30), input); await f.service.cancel(rootId, accepted.taskId);
    const cancelled = await finished(f.service, accepted.taskId); assert.equal(cancelled.task.execution.state, 'cancelled'); assert.equal(cancelled.instance?.state, 'cancelled');
    const retry = await f.service.create(request(31), input);
    assert.equal((await finished(f.service, retry.taskId)).task.execution.state, 'completed');
  } finally { await f.close(); }
});

test('same index ID with different bytes is preserved and stops safely rather than becoming ready', async () => {
  const f = await fixture();
  try {
    const indexes = path.join(f.dataDirectory, 'store', 'views', rootId, 'assets', 'indexes'); await mkdir(indexes, { recursive: true });
    const foreign = path.join(indexes, 'fixture.json');
    // Exercise the active ordinary-directory fallback too when Windows cannot create a junction.
    const activeIndexes = path.join(f.dataDirectory, 'roots', rootId, '.minecraft', 'assets', 'indexes');
    await mkdir(activeIndexes, { recursive: true });
    const activeForeign = path.join(activeIndexes, 'fixture.json');
    const existingIndex = JSON.stringify({ objects: {} }); assert.notEqual(sha1(existingIndex), f.indexHash);
    const { writeFile } = await import('node:fs/promises'); await writeFile(foreign, existingIndex); await writeFile(activeForeign, existingIndex);
    const accepted = await f.service.create(request(40), input); const result = await finished(f.service, accepted.taskId);
    assert.equal(result.task.execution.state, 'needsRecovery'); assert.equal(result.instance?.state, 'needsRecovery');
    assert.equal(await readFile(foreign, 'utf8'), existingIndex); assert.equal(await readFile(activeForeign, 'utf8'), existingIndex);
  } finally { await f.close(); }
});

class FakeGame extends EventEmitter {
  stdout = new PassThrough(); stderr = new PassThrough(); stdin = new PassThrough(); kills = 0;
  kill(): boolean { this.kills++; queueMicrotask(() => { this.emit('close', null, 'SIGKILL'); }); return true; }
}
const measuredJava = { executable: 'D:\\Fixture\\java.exe', major: 17 as const, version: '17.0.12', vendor: 'fixture', architecture: 'x64' as const, os: 'windows' as const };
async function gameFinished(service: LaunchService, taskId: string) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const value = await service.task(rootId, taskId);
    if (value && ['completed', 'failed', 'cancelled', 'needsRecovery'].includes(value.task.execution.state)) return value;
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  throw new Error('GAME_TASK_TIMEOUT');
}
test('installed objects stay owned once while launch tasks, subscriptions, natural exit and session history persist', async () => {
  const f = await fixture(); const child = new FakeGame(); let game: LaunchService | undefined; let adapter: InstallerAdapter | undefined;
  try {
    const installed = await f.service.create(request(50), input); const ready = await finished(f.service, installed.taskId); assert.ok(ready.instance);
    const profiles = new ProfileService(f.storage, { probe: async () => measuredJava });
    const account = await profiles.createOffline(request(51), { displayName: '成员', gameName: 'Player_1' });
    await f.storage.writeSettings(0, { memoryMiB: 3072, isolationDefault: false });
    const processes = new GameProcessService({ probe: { probe: async () => measuredJava }, start: (_file, args, options) => {
      assert.equal(options.shell, false); assert.ok(args.includes('Player_1')); assert.ok(args.includes('-Xmx3072M')); queueMicrotask(() => { child.emit('spawn'); }); return child as unknown as ChildProcessWithoutNullStreams;
    } });
    let javaPrepared = false;
    game = new LaunchService(f.storage, profiles, f.service, processes, () => 16 * 1024 ** 3, { ensure: async (major, taskId, signal) => {
      assert.equal(major, 17); assert.ok(taskId); assert.equal(signal.aborted, false); javaPrepared = true; return profiles.registerJava(measuredJava.executable);
    } }); await game.initialize();
    const extra = new GameAdapter(game, async () => rootId); adapter = new InstallerAdapter(f.service, f.storage, extra);
    const payload = { instanceId: ready.instance.instanceId, accountId: account.accountId, expectedRevision: ready.instance.revision };
    const accepted = await game.launch(request(52), payload); assert.deepEqual(await game.launch(request(52), payload), accepted);
    const events: TaskChangedEvent[] = []; const dispatch = adapter.dispatcher(1, event => { events.push(event); });
    const subscription = await dispatch('tasks:subscribe', { taskId: accepted.taskId }, request(53)); assert.equal(subscription.snapshot.kind, 'launch');
    const launched = await gameFinished(game, accepted.taskId); assert.equal(launched.task.execution.state, 'completed'); assert.equal(javaPrepared, true);
    const queried = await dispatch('tasks:get', { taskId: accepted.taskId }, request(54)); assert.ok(queried.result && 'sessionId' in queried.result); assert.equal(queried.result.sessionId, accepted.taskId);
    await new Promise<void>(resolve => setTimeout(resolve, 160)); assert.ok(subscription.snapshot.state === 'completed' || events.some(event => event.payload.state === 'completed'));
    assert.equal((await game.session(rootId, accepted.taskId)).state, 'running'); assert.equal(await game.close(), false); assert.equal(child.kills, 0);
    await assert.rejects(game.launch(request(52), { ...payload, expectedRevision: payload.expectedRevision + 1 }), { code: 'REVISION_CONFLICT' });
    await assert.rejects(game.cancel(rootId, accepted.taskId), { code: 'CANCEL_TOO_LATE' });
    child.emit('close', 0, null); assert.equal((await processes.wait(accepted.taskId)).state, 'exited'); assert.equal(await game.close(), true);
    assert.equal((await f.storage.readGameSessions())?.data.items[0]?.snapshot.exitCode, 0);
    await f.service.close(); await f.storage.close();
    const reopened = await StorageClient.open(entry, f.metadataDirectory); const restartedInstaller = f.createService(reopened);
    const restarted = new LaunchService(reopened, new ProfileService(reopened), restartedInstaller);
    try { await restarted.initialize(); assert.equal((await restarted.session(rootId, accepted.taskId)).exitCode, 0); assert.equal((await restarted.task(rootId, accepted.taskId))?.task.execution.state, 'completed'); }
    finally { await restarted.close(); await restartedInstaller.close(); await reopened.close(); }
  } finally { child.emit('close', 0, null); adapter?.close(); await game?.close(); await f.close(); }
});
test('explicit stop is durable, cannot act without confirmation and waits for the actual owned process close', async () => {
  const f = await fixture(); const child = new FakeGame(); let game: LaunchService | undefined;
  try {
    const ready = await finished(f.service, (await f.service.create(request(60), input)).taskId); assert.ok(ready.instance);
    const profiles = new ProfileService(f.storage, { probe: async () => measuredJava }); await profiles.registerJava(measuredJava.executable);
    const account = await profiles.createOffline(request(61), { displayName: '成员', gameName: 'Player_2' });
    const processes = new GameProcessService({ probe: { probe: async () => measuredJava }, start: () => { queueMicrotask(() => { child.emit('spawn'); }); return child as unknown as ChildProcessWithoutNullStreams; } });
    game = new LaunchService(f.storage, profiles, f.service, processes, () => 16 * 1024 ** 3); await game.initialize();
    const launched = await game.launch(request(62), { instanceId: ready.instance.instanceId, accountId: account.accountId, expectedRevision: ready.instance.revision }); await gameFinished(game, launched.taskId);
    await assert.rejects(game.stop(request(63), launched.taskId, 'force', false), { code: 'CONFIRMATION_REQUIRED' });
    await assert.rejects(game.stop(request(63), launched.taskId, 'graceful', true), { code: 'STOP_UNSUPPORTED' }); assert.equal(child.kills, 0);
    const stopped = await game.stop(request(64), launched.taskId, 'force', true); assert.equal((await gameFinished(game, stopped.taskId)).task.execution.state, 'completed'); assert.equal(child.kills, 1);
    assert.deepEqual(await game.stop(request(64), launched.taskId, 'force', true), stopped); assert.equal(child.kills, 1);
    assert.equal((await game.session(rootId, launched.taskId)).state, 'exited'); assert.equal(await game.close(), true);
  } finally { child.emit('close', 0, null); await game?.close(); await f.close(); }
});

test('new inherited isolation captures the saved default and remains stable after settings change and retry', async () => {
  const f = await fixture();
  try {
    await f.storage.writeSettings(0, { memoryMiB: 2048, isolationDefault: false });
    const chosen = { ...input, isolation: 'inherit' as const }; const accepted = await f.service.create(request(70), chosen);
    const installed = await finished(f.service, accepted.taskId); assert.equal(installed.instance?.isolation, 'off');
    await f.storage.writeSettings(1, { memoryMiB: 2048, isolationDefault: true });
    assert.deepEqual(await f.service.create(request(70), chosen), accepted);
    assert.equal((await f.service.list(rootId))[0]?.isolation, 'off');
  } finally { await f.close(); }
});

test('launch rejects changed revisions, inventories, native trees, profiles and unknown constraints under the real lease', async () => {
  for (const scenario of ['revision', 'inventory', 'native', 'profile', 'unknown', 'after-permit'] as const) {
    const f = await fixture(); let game: LaunchService | undefined; let starts = 0; let probes = 0; let verifies = 0;
    let prepared!: Awaited<ReturnType<InstallerService['prepareLaunch']>>;
    try {
      const accepted = await f.service.create(request(80), input); const ready = await finished(f.service, accepted.taskId); assert.ok(ready.instance);
      const instanceId = ready.instance.instanceId; const revision = ready.instance.revision;
      const profiles = new ProfileService(f.storage, { probe: async () => measuredJava });
      const account = await profiles.createOffline(request(81), { displayName: 'Test', gameName: 'Player_1' }); await profiles.registerJava(measuredJava.executable);
      const installer = {
        prepareLaunch: async (...args: Parameters<InstallerService['prepareLaunch']>) => {
          prepared = await f.service.prepareLaunch(...args);
          if (scenario === 'unknown') { const mods = path.join(prepared.layout.gameDirectory, 'mods'); await mkdir(mods, { recursive: true }); await writeFile(path.join(mods, 'unknown.jar'), 'not a jar'); }
          return prepared;
        },
        inspectLaunchMods: f.service.inspectLaunchMods.bind(f.service),
        verifyPreparedLaunch: async (...args: Parameters<InstallerService['verifyPreparedLaunch']>) => {
          if (++verifies === 2 && scenario === 'after-permit') {
            const current = (await f.storage.readInstance(instanceId))!;
            await f.storage.writeInstance(instanceId, current.revision, { ...current.data, summary: { ...current.data.summary, revision: current.revision + 1 } });
          }
          return f.service.verifyPreparedLaunch(...args);
        },
      };
      const processes = new GameProcessService({ probe: { probe: async () => {
        if (++probes === 1) {
          if (scenario === 'revision') {
            const current = (await f.storage.readInstance(instanceId))!;
            await f.storage.writeInstance(instanceId, current.revision, { ...current.data, summary: { ...current.data.summary, revision: current.revision + 1 } });
          }
          if (scenario === 'inventory') { const mods = path.join(prepared.layout.gameDirectory, 'mods'); await mkdir(mods, { recursive: true }); await writeFile(path.join(mods, 'late.jar'), 'changed'); }
          if (scenario === 'native') await writeFile(path.join(prepared.layout.versionDirectory, 'natives', 'added.dll'), 'changed');
          if (scenario === 'profile') await profiles.createOffline(request(82), { displayName: 'Changed', gameName: 'Player_2' });
        }
        return measuredJava;
      } }, start: () => { starts++; throw new Error('UNEXPECTED_SPAWN'); } });
      game = new LaunchService(f.storage, profiles, installer, processes, () => 16 * 1024 ** 3); await game.initialize();
      const launched = await game.launch(request(83), { instanceId, accountId: account.accountId, expectedRevision: revision });
      const outcome = await gameFinished(game, launched.taskId);
      assert.equal(starts, 0, scenario);
      assert.equal(outcome.task.execution.state, scenario === 'native' || scenario === 'after-permit' ? 'needsRecovery' : 'failed', scenario);
      assert.equal(outcome.session.spawned, false, scenario);
      await assert.rejects(readFile(path.join(prepared.layout.gameDirectory, 'oucl.session.lock')), { code: 'ENOENT' });
    } finally { await game?.close(); await f.close(); }
  }
});

test('accepted cancellation drains locked verification and a lost commit-permit acknowledgement never spawns', async () => {
  for (const scenario of ['cancel', 'lost-permit'] as const) {
    const f = await fixture(); let game: LaunchService | undefined; let release!: () => void; let entered!: () => void; let starts = 0;
    const started = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
    let directory = '';
    const originalUpdate = f.storage.update.bind(f.storage);
    try {
      const installed = await f.service.create(request(90), input); const ready = await finished(f.service, installed.taskId); assert.ok(ready.instance);
      const profiles = new ProfileService(f.storage, { probe: async () => measuredJava });
      const account = await profiles.createOffline(request(91), { displayName: 'Test', gameName: 'Player_1' }); await profiles.registerJava(measuredJava.executable);
      const installer = {
        prepareLaunch: async (...args: Parameters<InstallerService['prepareLaunch']>) => { const result = await f.service.prepareLaunch(...args); directory = result.layout.gameDirectory; return result; },
        inspectLaunchMods: f.service.inspectLaunchMods.bind(f.service),
        verifyPreparedLaunch: async (...args: Parameters<InstallerService['verifyPreparedLaunch']>) => {
          if (scenario === 'cancel') { entered(); await gate; }
          return f.service.verifyPreparedLaunch(...args);
        },
      };
      if (scenario === 'lost-permit') f.storage.update = async (...args) => {
        const result = await originalUpdate(...args);
        if (args[3].state === 'committing') throw Object.assign(new Error('LOST_ACK'), { code: 'TIMEOUT' });
        return result;
      };
      const processes = new GameProcessService({ probe: { probe: async () => measuredJava }, start: () => { starts++; throw new Error('UNEXPECTED'); } });
      game = new LaunchService(f.storage, profiles, installer, processes, () => 16 * 1024 ** 3); await game.initialize();
      const task = await game.launch(request(92), { instanceId: ready.instance.instanceId, accountId: account.accountId, expectedRevision: ready.instance.revision });
      if (scenario === 'cancel') { await started; await game.cancel(rootId, task.taskId); assert.ok(await readFile(path.join(directory, 'oucl.session.lock'))); release(); }
      const result = await gameFinished(game, task.taskId);
      assert.equal(result.task.execution.state, scenario === 'cancel' ? 'cancelled' : 'needsRecovery');
      assert.equal(starts, 0); assert.equal(result.session.spawned, false);
      await assert.rejects(readFile(path.join(directory, 'oucl.session.lock')), { code: 'ENOENT' });
    } finally { release?.(); await game?.close(); f.storage.update = originalUpdate; await f.close(); }
  }
});

test('prepared launch final verification succeeds with every materialization and extraction capability disabled', async () => {
  const f = await fixture(); const hashes = new HashPool(entry); let writes = 0;
  try {
    const task = await f.service.create(request(95), input); const ready = await finished(f.service, task.taskId); assert.ok(ready.instance);
    const signal = new AbortController().signal;
    const witness = await f.service.prepareLaunch(ready.instance.instanceId, ready.instance.revision, signal);
    const views = new FileViewService(witness.layout.storeDirectory, { lookup: async () => { throw new Error('UNEXPECTED_STORE_LOOKUP'); } }, hashes);
    views.materialize = async () => { writes++; throw new Error('UNEXPECTED_MATERIALIZE'); };
    const extractor = new NativeExtractor(entry); extractor.run = async () => { writes++; throw new Error('UNEXPECTED_EXTRACT'); };
    const record = (await f.storage.readInstance(ready.instance.instanceId))!;
    const result = await verifyLaunchInputs({ dataDirectory: f.dataDirectory, rootId, hashes, extractor, views }, record, witness.prepared, signal, undefined, witness.nativeFiles);
    assert.deepEqual(result.nativeFiles, witness.nativeFiles); assert.ok(result.nativeFiles.length > 0); assert.equal(writes, 0);
  } finally { await hashes.close(); await f.close(); }
});
