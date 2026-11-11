import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModTaskService } from '../src/services/mods/tasks.js';
import type { StorageClient } from '../src/services/workers/storage-client.js';

test('target reads serialize and a rejected read releases the admission queue', async () => {
  const service = new ModTaskService({} as StorageClient, { scan: async () => { throw new Error('unexpected'); } },
    { check: async () => { throw new Error('unexpected'); } });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const order: string[] = [];
  const first = service.withTargetRead(async () => { order.push('first'); await gate; throw new Error('read failed'); });
  const second = service.withTargetRead(async () => { order.push('second'); return 42; });
  await Promise.resolve();
  assert.deepEqual(order, ['first']);
  release();
  await assert.rejects(first, /read failed/);
  assert.equal(await second, 42);
  assert.deepEqual(order, ['first', 'second']);
});
