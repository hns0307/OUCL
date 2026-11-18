import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { TargetAdapter } from '../src/ipc/task-targets.js';
import type { DistributionTargetReader } from '../src/ipc/task-targets.js';
import type { ModTaskService } from '../src/services/mods/tasks.js';
import type { ModInstallTaskService } from '../src/services/mods/install-tasks.js';
import type { StorageClient } from '../src/services/workers/storage-client.js';
import { parseStorageRequest } from '../src/services/workers/protocol.js';
import type { TargetKind, TargetRequest, TargetRow } from '../src/shared/contracts/task-targets.js';

const rootId = randomUUID();
const instanceId = randomUUID();
const row = (kind: TargetKind): TargetRow => ({
  instanceId, instanceRevision: 1,
  task: { taskId: randomUUID(), kind, state: 'queued', stage: 'queued', revision: 1, bytesDone: 0 },
});
function request(kinds: TargetKind[], cursor?: string): TargetRequest {
  return { contractVersion: 1, requestId: randomUUID(), payload: { instanceId, kinds, limit: 1, ...(cursor ? { cursor } : {}) } };
}
function fixture(distribution?: DistributionTargetReader) {
  const mod = row('mod-check');
  let reads = 0;
  const storage = {
    readInstallation: async () => ({ revision: 1, data: { rootId } }),
    readModTargets: async ({ kinds }: { kinds: string[] }) => {
      reads++;
      assert.deepEqual(kinds, ['mod-check']);
      return { rootId, rootRevision: 1, items: [{ ...mod, task: { kind: 'mod-check' } }] };
    },
  } as unknown as StorageClient;
  const checks = {
    withTargetRead: async <T>(work: () => Promise<T>) => work(),
    targetTaskView: () => ({ snapshot: mod.task }),
  } as unknown as ModTaskService;
  return { adapter: new TargetAdapter(storage, checks, {} as ModInstallTaskService, distribution), reads: () => reads };
}

test('distribution targets are read alone or paginated together with Mod targets', async () => {
  const expected = row('distribution-install');
  const { adapter, reads } = fixture({ rootId, targets: async id => { assert.equal(id, instanceId); return [expected]; } });
  const trace = randomUUID();
  try {
    const distribution = await adapter.handle(request(['distribution-install']), true, 1, trace);
    assert.ok(distribution.ok);
    assert.deepEqual(distribution.data.items, [expected]);
    assert.equal(reads(), 0);
    const mixed = await adapter.handle(request(['mod-check', 'distribution-install']), true, 1, trace);
    assert.ok(mixed.ok);
    assert.deepEqual(mixed.data.items, [expected]);
    assert.ok(mixed.data.nextCursor);
    const remaining = await adapter.handle(request(['distribution-install', 'mod-check'], mixed.data.nextCursor), true, 1, trace);
    assert.ok(remaining.ok);
    assert.equal(remaining.data.items[0]?.task.kind, 'mod-check');
    assert.equal(reads(), 1);
  } finally { adapter.close(); }
});

test('missing or mismatched distribution reader rejects a mixed query before the Mod read', async () => {
  for (const reader of [undefined, { rootId: randomUUID(), targets: async () => [] }]) {
    const { adapter, reads } = fixture(reader);
    try {
      const result = await adapter.handle(request(['mod-check', 'distribution-install']), true, 1, randomUUID());
      assert.ok(!result.ok);
      assert.equal(result.error.code, reader ? 'ROOT_UNAVAILABLE' : 'UNAVAILABLE');
      assert.equal(reads(), 0);
    } finally { adapter.close(); }
  }
});

test('invalid distribution rows are rejected before a first page can hide them', async () => {
  const valid = row('distribution-install');
  for (const rows of [[valid, row('mod-install')], [valid, valid], [valid, { ...valid, instanceId: randomUUID() }]]) {
    const { adapter } = fixture({ rootId, targets: async () => rows });
    try {
      const result = await adapter.handle(request(['distribution-install']), true, 1, randomUUID());
      assert.ok(!result.ok);
      assert.equal(result.error.code, 'NEEDS_RECOVERY');
    } finally { adapter.close(); }
  }
  assert.throws(() => parseStorageRequest({
    version: 1, id: randomUUID(),
    command: { kind: 'mod-targets:read', rootId, rootRevision: 1, instanceId, kinds: ['distribution-install'] },
  }));
});
