import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { StorageClient } from '../src/services/workers/storage-client.js';
import { InstallerService } from '../src/services/install/installer.js';
import { InstallMetadataService } from '../src/services/catalog/install-metadata.js';
import { CatalogService } from '../src/services/catalog/service.js';
import { LoaderService } from '../src/services/loaders/service.js';
import { handleLoaders } from '../src/ipc/loaders.js';
import { isLoaderResult } from '../src/shared/contracts/loaders.js';
import { WorkerError, parseStorageRequest } from '../src/services/workers/protocol.js';
const entry = new URL('../src/services/workers/entry.js', import.meta.url);
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('read-only worker receipt lookup does not admit work, change state or cross request ownership', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'oucl-loader-receipts-')); let storage = await StorageClient.open(entry, directory);
  const root = randomUUID(); const request = randomUUID(); const hash = 'a'.repeat(64);
  try {
    assert.equal(await storage.findAccepted(root, request, 'install', hash), undefined);
    const database = new DatabaseSync(path.join(directory, 'tasks.sqlite'), { readOnly: true });
    try { assert.equal(database.prepare('SELECT COUNT(*) AS count FROM requests').get()?.count, 0); }
    finally { database.close(); }
    const accepted = await storage.accept(root, request, 'install', hash);
    assert.deepEqual(await storage.findAccepted(root, request, 'install', hash), accepted);
    assert.deepEqual(await storage.get(root, accepted.taskId), accepted);
    assert.equal(await storage.findAccepted(randomUUID(), request, 'install', hash), undefined);
    await assert.rejects(storage.findAccepted(root, request, 'install', 'b'.repeat(64)), { code: 'REVISION_CONFLICT' });
    await assert.rejects(storage.findAccepted(root, request, 'download', hash), { code: 'REVISION_CONFLICT' });
    await storage.close(); storage = await StorageClient.open(entry, directory);
    assert.equal((await storage.findAccepted(root, request, 'install', hash))?.taskId, accepted.taskId);
  } finally { await storage.close(); }
});
test('all four loader receipts survive restart and offline catalog without new task or metadata effects', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'oucl-loader-replay-')); const metadata = path.join(directory, 'metadata');
  await mkdir(metadata); const games = path.join(directory, 'games'); await mkdir(games);
  let storage = await StorageClient.open(entry, metadata); const rootId = randomUUID();
  const rows = (['fabric', 'quilt', 'forge', 'neoforge'] as const).map(kind => ({ requestId: randomUUID(), input: {
    rootId, mcVersionId: kind === 'neoforge' ? '1.21.1' : '1.20.1', displayName: kind, isolation: 'on' as const,
    loader: { kind, version: { fabric: '0.16.14', quilt: '0.29.2', forge: '47.4.28', neoforge: '21.1.265' }[kind] }
  } }));
  const accepted = new Map<string, string>();
  try {
    await storage.createInstallation({ rootId, dataDirectory: games });
    for (const row of rows) accepted.set(row.requestId, (await storage.accept(rootId, row.requestId, 'install', digest(row.input))).taskId);
    await storage.close(); storage = await StorageClient.open(entry, metadata);
    const reader = { read: async (): Promise<never> => { throw new Error('UNEXPECTED_EXTERNAL_READ'); } };
    const installer = new InstallerService(storage, entry, new InstallMetadataService(new CatalogService(reader, storage), reader));
    let catalogs = 0; const service = new LoaderService({ catalog: async () => { catalogs++; throw new Error('OFFLINE_CATALOG'); } }, installer);
    try {
      for (const row of rows) {
        const payload = { rootId, minecraftVersion: row.input.mcVersionId, displayName: row.input.displayName, isolation: 'on' as const,
          loader: row.input.loader.kind, loaderVersion: row.input.loader.version };
        const result = await handleLoaders('loaders:create', { contractVersion: 1, requestId: row.requestId, payload }, true, randomUUID(), service.dispatcher());
        assert.ok(isLoaderResult(result, row.requestId, 'loaders:create')); assert.ok(result.ok); assert.equal(result.data.taskId, accepted.get(row.requestId));
        const mismatch = await handleLoaders('loaders:create', { contractVersion: 1, requestId: row.requestId, payload: { ...payload, displayName: 'changed' } }, true, randomUUID(), service.dispatcher());
        assert.ok(!mismatch.ok); assert.equal(mismatch.error.code, 'REVISION_CONFLICT');
      }
      assert.equal(catalogs, 0); assert.equal(await storage.readInstances(), undefined);
    } finally { await installer.close(); }
  } finally { await storage.close(); }
});
test('receipt worker protocol rejects arbitrary fields and invalid hashes before SQL access', () => {
  const command = { kind: 'find-accepted', ownerId: randomUUID(), requestId: randomUUID(), taskKind: 'install', payloadDigest: 'a'.repeat(64) };
  const request = { version: 1, id: randomUUID(), command }; assert.deepEqual(parseStorageRequest(request), request);
  for (const invalid of [{ ...command, sql: 'SELECT * FROM requests' }, { ...command, requestId: '../path' }, { ...command, payloadDigest: 'bad' }]) {
    assert.throws(() => parseStorageRequest({ ...request, command: invalid }), WorkerError);
  }
});
