import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { TargetAdapter } from '../src/ipc/task-targets.js';
import type { StorageClient } from '../src/services/workers/storage-client.js';
import type { ModTaskService } from '../src/services/mods/tasks.js';
import type { ModInstallTaskService } from '../src/services/mods/install-tasks.js';
import type { StoredTask } from '../src/services/storage/tasks.js';
import { createExecution } from '../src/core/task/machine.js';
const rootId = '00000000-0000-4000-8000-000000000001';
const instanceId = '00000000-0000-4000-8000-000000000002';
function request(extra: { cursor?: string; instanceId?: string; limit?: number } = {}) {
  return { contractVersion: 1 as const, requestId: randomUUID(), payload: { instanceId: extra.instanceId ?? instanceId, kinds: ['mod-check' as const], limit: extra.limit ?? 100, ...(extra.cursor ? { cursor: extra.cursor } : {}) } };
}
function fixture(count = 101) {
  let revision = 1;
  const tasks: StoredTask[] = Array.from({ length: count }, () => ({ taskId: randomUUID(), ownerId: rootId, kind: 'mod-check', execution: createExecution() }));
  const storage = { readInstallation: async () => ({ revision, data: { rootId } }), readModTargets: async () => ({ rootId, rootRevision: revision, items: tasks.map(task => ({ instanceId, instanceRevision: 1, task })) }) } as unknown as StorageClient;
  const checks = { withTargetRead: async <T>(work: () => Promise<T>) => work(), targetTaskView: (_root: string, task: StoredTask) => ({ snapshot: { taskId: task.taskId, kind: task.kind, state: task.execution.state, stage: 'preparing', revision: task.execution.revision, bytesDone: 0 } }) } as unknown as ModTaskService;
  return { adapter: new TargetAdapter(storage, checks, {} as ModInstallTaskService), changeRoot: () => { revision++; } };
}
test('target pages bind sender, filter and root generation while allowing limit changes', async () => {
  const { adapter, changeRoot } = fixture(); const trace = randomUUID();
  const first = await adapter.handle(request(), true, 1, trace); assert.ok(first.ok); assert.equal(first.data.items.length, 100);
  const cursor = first.data.nextCursor!;
  const other = await adapter.handle(request({ cursor }), true, 2, trace); assert.ok(!other.ok); assert.equal(other.error.code, 'OUT_OF_SCOPE');
  const changed = await adapter.handle(request({ cursor, instanceId: randomUUID() }), true, 1, trace); assert.ok(!changed.ok); assert.equal(changed.error.code, 'CURSOR_EXPIRED');
  const second = await adapter.handle(request({ cursor, limit: 1 }), true, 1, trace); assert.ok(second.ok); assert.equal(second.data.items.length, 1);
  const repeated = await adapter.handle(request({ cursor, limit: 1 }), true, 1, trace); assert.ok(repeated.ok);
  assert.deepEqual(repeated.data.items, second.data.items);
  changeRoot(); const expired = await adapter.handle(request({ cursor }), true, 1, trace); assert.ok(!expired.ok); assert.equal(expired.error.code, 'CURSOR_EXPIRED');
  adapter.close();
});
test('destroying sender invalidates cursor without cancelling a task', async () => {
  const { adapter } = fixture(); const trace = randomUUID(); const first = await adapter.handle(request(), true, 1, trace); assert.ok(first.ok);
  adapter.removeSender(1); const result = await adapter.handle(request({ cursor: first.data.nextCursor! }), true, 1, trace);
  assert.ok(!result.ok); assert.equal(result.error.code, 'CURSOR_EXPIRED'); adapter.close();
});

test('older snapshots are evicted together with their cursors', async () => {
  const { adapter } = fixture(); const trace = randomUUID();
  const first = await adapter.handle(request(), true, 1, trace); assert.ok(first.ok); const cursor = first.data.nextCursor!;
  for (let index = 0; index < 4; index++) assert.ok((await adapter.handle(request(), true, 1, trace)).ok);
  const evicted = await adapter.handle(request({ cursor }), true, 1, trace); assert.ok(!evicted.ok); assert.equal(evicted.error.code, 'CURSOR_EXPIRED');
  adapter.close();
});
test('snapshot count limit rejects overflow instead of truncating', async () => {
  const { adapter } = fixture(2001); const result = await adapter.handle(request(), true, 1, randomUUID());
  assert.ok(!result.ok); assert.equal(result.error.code, 'TASK_STORE_UNAVAILABLE'); adapter.close();
});
test('a cursor that expires while its root is being checked stays expired', async () => {
  let release!: () => void; let entered!: () => void; let reads = 0;
  const gate = new Promise<void>(resolve => { release = resolve; }); const waiting = new Promise<void>(resolve => { entered = resolve; });
  const task: StoredTask = { taskId: randomUUID(), ownerId: rootId, kind: 'mod-check', execution: createExecution() };
  const storage = { readInstallation: async () => { if (++reads === 3) { entered(); await gate; } return { revision: 1, data: { rootId } }; },
    readModTargets: async () => ({ rootId, rootRevision: 1, items: [task, { ...task, taskId: randomUUID() }].map(item => ({ instanceId, instanceRevision: 1, task: item })) }) } as unknown as StorageClient;
  const checks = { withTargetRead: async <T>(work: () => Promise<T>) => work(), targetTaskView: (_root: string, item: StoredTask) => ({ snapshot: {
    taskId: item.taskId, kind: item.kind, state: item.execution.state, stage: 'preparing', revision: item.execution.revision, bytesDone: 0 } }) } as unknown as ModTaskService;
  const adapter = new TargetAdapter(storage, checks, {} as ModInstallTaskService); const originalNow = Date.now; let now = originalNow();
  Date.now = () => now;
  try {
    const first = await adapter.handle(request({ limit: 1 }), true, 1, randomUUID()); assert.ok(first.ok);
    const later = adapter.handle(request({ cursor: first.data.nextCursor! }), true, 1, randomUUID()); await waiting;
    now += 30001; release(); const result = await later;
    assert.ok(!result.ok); assert.equal(result.error.code, 'CURSOR_EXPIRED');
  } finally { Date.now = originalNow; release(); adapter.close(); }
});

test('timed-out or destroyed observations cannot create late cursors or release the pending budget early', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const storage = { readInstallation: async () => ({ revision: 1, data: { rootId } }), readModTargets: async () => {
    await gate; return { rootId, rootRevision: 1, items: [] };
  } } as unknown as StorageClient;
  const checks = { withTargetRead: async <T>(work: () => Promise<T>) => work() } as unknown as ModTaskService;
  const adapter = new TargetAdapter(storage, checks, {} as ModInstallTaskService); const trace = randomUUID();
  const pending = adapter.handle(request(), true, 1, trace); await new Promise(resolve => setTimeout(resolve, 0));
  const blocked = await adapter.handle(request(), true, 1, trace); assert.ok(!blocked.ok); assert.equal(blocked.error.code, 'UNAVAILABLE');
  const timeout = await pending; assert.ok(!timeout.ok); assert.equal(timeout.error.code, 'TIMEOUT');
  const stillBlocked = await adapter.handle(request(), true, 1, trace); assert.ok(!stillBlocked.ok); assert.equal(stillBlocked.error.code, 'UNAVAILABLE');
  adapter.removeSender(1); release(); await new Promise(resolve => setTimeout(resolve, 0));
  const fresh = await adapter.handle(request(), true, 1, trace); assert.ok(fresh.ok); assert.equal(fresh.data.nextCursor, undefined);
  adapter.close();
});
