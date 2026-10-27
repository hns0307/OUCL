import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { InstanceFolderService } from '../src/services/install/instance-folders.js';
import type { InstanceRecord } from '../src/services/storage/instance-records.js';
import { instanceFolderFailure, isInstanceFolderRequest, isInstanceFolderResult } from '../src/shared/contracts/instance-folders.js';

const rootId = '00000000-0000-4000-8000-000000000001'; const instanceId = '00000000-0000-4000-8000-000000000002';
function record(isolation: 'on' | 'off'): InstanceRecord {
  const assetIndexBody = '{"objects":{}}\n';
  const body = JSON.stringify({ id: '1.20.1', mainClass: 'net.minecraft.client.main.Main', libraries: [],
    downloads: { client: { url: 'https://piston-data.mojang.com/objects/fixture/client.jar', sha1: 'a'.repeat(40), size: 8 } },
    assetIndex: { id: '5', url: 'https://piston-meta.mojang.com/v1/packages/fixture/5.json', sha1: createHash('sha1').update(assetIndexBody).digest('hex'), size: Buffer.byteLength(assetIndexBody) } }) + '\n';
  return { formatVersion: 2, loader: { kind: 'vanilla' }, phase: 'ready', summary: { instanceId, rootId, taskId: randomUUID(), displayName: 'Test', mcVersionId: '1.20.1', isolation, state: 'ready', revision: 1 },
    metadata: { versionDocuments: { '1.20.1': body }, metadataSha1ByVersion: { '1.20.1': createHash('sha1').update(body).digest('hex') }, assetIndexBody }, objects: {}, receipts: [] };
}

test('instance folder contract accepts only opaque identity and fixed folder keys', () => {
  const requestId = randomUUID(); const valid = { contractVersion: 1, requestId, payload: { instanceId, folder: 'mods' } };
  assert.ok(isInstanceFolderRequest(valid));
  for (const invalid of [{ ...valid, payload: { instanceId, folder: '../saves' } }, { ...valid, payload: { instanceId, folder: 'mods', path: 'C:/private' } }, { ...valid, contractVersion: 2 }]) assert.equal(isInstanceFolderRequest(invalid), false);
  assert.ok(isInstanceFolderResult({ contractVersion: 1, requestId, ok: true, data: { opened: true } }, requestId));
  assert.ok(isInstanceFolderResult(instanceFolderFailure(requestId, 'NEEDS_RECOVERY', randomUUID()), requestId));
});

for (const isolation of ['on', 'off'] as const) test(`folder resolver uses the actual ${isolation === 'on' ? 'isolated' : 'shared'} game directory`, async () => {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'oucl-instance-folder-')); const value = record(isolation);
  const game = path.join(dataDirectory, 'roots', rootId, '.minecraft'); const expectedBase = isolation === 'on' ? path.join(game, 'versions', instanceId) : game;
  await mkdir(expectedBase, { recursive: true });
  const service = new InstanceFolderService({ async readInstallation() { return { schemaVersion: 1 as const, revision: 1, data: { rootId, dataDirectory } }; }, async readInstance() { return { schemaVersion: 1 as const, revision: 1, data: value }; } });
  try { assert.equal(await service.resolve(instanceId, 'game'), await import('node:fs/promises').then(fs => fs.realpath(expectedBase)));
    assert.equal(path.dirname(await service.resolve(instanceId, 'mods')), await import('node:fs/promises').then(fs => fs.realpath(expectedBase)));
  } finally { await rm(dataDirectory, { recursive: true, force: true }); }
});

test('folder resolver rejects a linked allowlisted directory that escapes the instance', async () => {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'oucl-instance-folder-link-')); const outside = await mkdtemp(path.join(tmpdir(), 'oucl-instance-folder-outside-')); const value = record('on');
  const game = path.join(dataDirectory, 'roots', rootId, '.minecraft', 'versions', instanceId); await mkdir(game, { recursive: true });
  await symlink(outside, path.join(game, 'mods'), process.platform === 'win32' ? 'junction' : 'dir');
  const service = new InstanceFolderService({ async readInstallation() { return { schemaVersion: 1 as const, revision: 1, data: { rootId, dataDirectory } }; }, async readInstance() { return { schemaVersion: 1 as const, revision: 1, data: value }; } });
  try { await assert.rejects(service.resolve(instanceId, 'mods'), { code: 'NEEDS_RECOVERY' }); }
  finally { await rm(dataDirectory, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
