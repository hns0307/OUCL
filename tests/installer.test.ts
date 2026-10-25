import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import { StorageClient } from '../src/services/workers/storage-client.js';
import { CatalogService } from '../src/services/catalog/service.js';
import { InstallMetadataService } from '../src/services/catalog/install-metadata.js';
import { InstallerService, restoreInstallMetadata } from '../src/services/install/installer.js';
import type { MetadataReader } from '../src/services/catalog/transport.js';

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
async function fixture() {
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
  const descriptor = JSON.stringify({ id: 'fixture', mainClass: 'net.minecraft.client.main.Main', type: 'release', downloads: { client },
    javaVersion: { majorVersion: 17 }, assetIndex: { id: 'fixture', url: indexUrl, sha1: indexHash, size: Buffer.byteLength(indexBody) },
    libraries: [{ name: 'org.example:library:1', downloads: { artifact: library, classifiers: { 'natives-windows': native } }, natives: { windows: 'natives-windows' } }],
    arguments: { game: ['--username', '${auth_player_name}', '--gameDir', '${game_directory}'], jvm: ['-cp', '${classpath}', '-Djava.library.path=${natives_directory}'] } });
  const descriptorHash = sha1(descriptor); const descriptorUrl = `https://piston-meta.mojang.com/v1/packages/${descriptorHash}/fixture.json`;
  const manifest = JSON.stringify({ versions: [{ id: 'fixture', type: 'release', url: descriptorUrl, sha1: descriptorHash,
    time: '2026-01-01T00:00:00+00:00', releaseTime: '2026-01-01T00:00:00+00:00' }] });
  const reader: MetadataReader = { async read(url, expected) {
    const body = url === descriptorUrl ? descriptor : url === indexUrl ? indexBody : manifest;
    const digest = sha1(body); if (expected) assert.equal(digest, expected);
    return { body, sha1: digest, sha256: createHash('sha256').update(body).digest('hex') };
  } };
  const originalFetch = globalThis.fetch; let requests = 0; let delayed = false;
  globalThis.fetch = async (url, options) => {
    requests++; if (delayed) await new Promise<void>(resolve => setTimeout(resolve, 100));
    if (options?.signal?.aborted) throw new DOMException('cancelled', 'AbortError');
    const bytes = bodies.get(String(url)); assert.ok(bytes, 'fixture URL not found');
    return new Response(new Uint8Array(bytes), { headers: { 'content-length': String(bytes.length) } });
  };
  const createService = (repository: StorageClient): InstallerService => new InstallerService(repository, entry, new InstallMetadataService(new CatalogService(reader, repository), reader));
  const service = createService(storage);
  return { root, storage, service, createService, metadataDirectory, dataDirectory, requests: () => requests, delay: () => { delayed = true; },
    async close() { await service.close(); globalThis.fetch = originalFetch; await storage.close(); await rm(root, { recursive: true, force: true }); } };
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

test('unknown existing shared entries are preserved and leave a recovery state rather than ready', async () => {
  const f = await fixture();
  try {
    const indexes = path.join(f.dataDirectory, 'store', 'views', rootId, 'assets', 'indexes'); await mkdir(indexes, { recursive: true });
    const foreign = path.join(indexes, 'fixture.json');
    const { writeFile } = await import('node:fs/promises'); await writeFile(foreign, 'foreign contents');
    const accepted = await f.service.create(request(40), input); const result = await finished(f.service, accepted.taskId);
    assert.equal(result.task.execution.state, 'needsRecovery'); assert.equal(result.instance?.state, 'needsRecovery');
    assert.equal(await readFile(foreign, 'utf8'), 'foreign contents');
  } finally { await f.close(); }
});
