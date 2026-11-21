import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { RecordStore } from '../src/services/storage/records.js';
import { StorageClient } from '../src/services/workers/storage-client.js';

test('journal larger than the 128MiB worker heap reopens without retaining historical JSON snapshots', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'oucl-storage-scale-')); let store: RecordStore | undefined; let worker: StorageClient | undefined;
  try {
    store = await RecordStore.open(directory); await store.recover();
    const payload = 'x'.repeat(768 * 1024);
    for (let revision = 0; revision < 112; revision++) await store.write('large', revision, { revision, payload }, value => value);
    await store.close(); store = undefined;
    assert.ok((await stat(path.join(directory, 'tasks.sqlite'))).size > 128 * 1024 ** 2);
    worker = await StorageClient.open(new URL('../src/services/workers/entry.js', import.meta.url), directory, 30000);
    await worker.close(); worker = undefined;
    assert.equal((await readdir(directory)).includes('owner.lock'), false);
  } finally {
    await worker?.close(); await store?.close();
    assert.equal(path.dirname(directory), path.resolve(tmpdir())); assert.ok(path.basename(directory).startsWith('oucl-storage-scale-'));
    await rm(directory, { recursive: true, force: true });
  }
});
